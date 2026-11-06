import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  chapterBriefSchema,
  STYLE_DRIFT_RULE_VERSION,
  type StyleDriftCheckRequest,
  type StyleDriftFinding,
  type StyleDriftReport,
  type StyleDriftWorkspace,
  type StyleProfile,
  type StyleProfileApproveRequest,
  type StyleProfileCreateRequest,
  type StyleProfileSourceType,
} from "@novel-brain/contracts";
import {
  evaluateStyleDrift,
  measureStyleText,
  type StyleGrowthMarkerInput,
} from "@novel-brain/core";
import {
  auditLogs,
  chapters,
  chapterVersions,
  characterArcs,
  createDatabaseClient,
  createDatabasePool,
  entities,
  findIdempotentResource,
  goldenThreeLocks,
  rememberIdempotentResource,
  styleBaselines,
  styleDriftFindings,
  styleDriftReports,
  styleProfiles,
  versionNodes,
  workBranches,
  works,
  withTenantTransaction,
  type DatabaseClient,
  type StyleDriftGrowthEvidenceJson,
  type StyleProfileJson,
} from "@novel-brain/db";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import type { WorksAuditContext } from "../works/works.repository";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type StyleProfileRecord = InferSelectModel<typeof styleProfiles>;
type StyleDriftReportRecord = InferSelectModel<typeof styleDriftReports>;
type StyleDriftFindingRecord = InferSelectModel<typeof styleDriftFindings>;
type ChapterRecord = InferSelectModel<typeof chapters>;
type ChapterVersionRecord = InferSelectModel<typeof chapterVersions>;
type CharacterArcRecord = InferSelectModel<typeof characterArcs>;

export interface StyleWorkContext {
  workId: string;
  branchId: string;
}

export type StyleWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "source_not_approved" }
  | { kind: "baseline_unapproved" }
  | { kind: "baseline_required" }
  | { kind: "version_conflict" }
  | { kind: "invalid_state"; status: string }
  | { kind: "reference_invalid"; message: string }
  | { kind: "chapter_version_required" }
  | { kind: "no_chapters" };

interface ResolvedProfileSource {
  sourceId: string;
  sourceVersionId: string;
  sourceVersionNodeId: string | null;
  sourceLabel: string;
  profile: StyleProfileJson;
  autoApproved: boolean;
  approvalRationale: string | null;
}

interface LoadedChapter {
  chapter: ChapterRecord;
  version: ChapterVersionRecord;
}

@Injectable()
export class StyleRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StyleWorkContext | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [context] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      return context;
    });
  }

  async workspace(userId: string, context: StyleWorkContext): Promise<StyleDriftWorkspace> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const profileRows = await transaction
        .select()
        .from(styleProfiles)
        .where(
          and(
            eq(styleProfiles.userId, userId),
            eq(styleProfiles.workId, context.workId),
            eq(styleProfiles.branchId, context.branchId),
          ),
        )
        .orderBy(asc(styleProfiles.createdAt), asc(styleProfiles.version));
      const [chapterReport, volumeReport, crossVolumeReport] = await Promise.all([
        latestReport(transaction, userId, context, "chapter"),
        latestReport(transaction, userId, context, "volume"),
        latestReport(transaction, userId, context, "cross_volume"),
      ]);
      return {
        profiles: profileRows.map(toProfile),
        latestChapterReport: chapterReport ? await hydrateReport(transaction, chapterReport) : null,
        latestVolumeReport: volumeReport ? await hydrateReport(transaction, volumeReport) : null,
        latestCrossVolumeReport: crossVolumeReport
          ? await hydrateReport(transaction, crossVolumeReport)
          : null,
      };
    });
  }

  async createProfile(
    userId: string,
    context: StyleWorkContext,
    input: StyleProfileCreateRequest,
    idempotencyKey: string,
    audit: WorksAuditContext,
  ): Promise<StyleWriteResult<StyleProfile>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const existing = await findIdempotentResource(
        transaction,
        userId,
        "style-profiles",
        idempotencyKey,
      );
      if (existing) {
        const [profile] = await transaction
          .select()
          .from(styleProfiles)
          .where(
            and(
              eq(styleProfiles.id, existing.resourceId),
              eq(styleProfiles.userId, userId),
              eq(styleProfiles.workId, context.workId),
              eq(styleProfiles.branchId, context.branchId),
            ),
          )
          .limit(1);
        if (profile) {
          return { kind: "ok", value: toProfile(profile) };
        }
      }
      if (input.scope === "character") {
        const [character] = await transaction
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.id, input.scopeId!),
              eq(entities.userId, userId),
              eq(entities.workId, context.workId),
              eq(entities.branchId, context.branchId),
              eq(entities.type, "character"),
              isNull(entities.deletedAt),
            ),
          )
          .limit(1);
        if (!character) {
          return {
            kind: "reference_invalid",
            message: "声线基线引用的人物不存在或不属于当前创作线",
          };
        }
      }
      const resolved = await resolveProfileSource(transaction, userId, context, input);
      if (resolved.kind !== "ok") {
        return resolved;
      }
      const [versionRow] = await transaction
        .select({ max: sql<number | null>`max(${styleProfiles.version})` })
        .from(styleProfiles)
        .where(
          and(
            eq(styleProfiles.userId, userId),
            eq(styleProfiles.workId, context.workId),
            eq(styleProfiles.branchId, context.branchId),
            eq(styleProfiles.scope, input.scope),
            eq(styleProfiles.dimension, input.dimension),
            input.scope === "character"
              ? eq(styleProfiles.scopeId, input.scopeId!)
              : isNull(styleProfiles.scopeId),
          ),
        );
      const version = Number(versionRow?.max ?? 0) + 1;
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const now = new Date();
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId,
        nodeType: "snapshot",
        objectType: "style_profile",
        objectId: id,
        objectVersion: version,
        payload: {
          action: "style.profile_created",
          scope: input.scope,
          scopeId: input.scopeId,
          dimension: input.dimension,
          sourceType: input.source.type,
          sourceId: resolved.value.sourceId,
          sourceVersionId: resolved.value.sourceVersionId,
          approvalStatus: resolved.value.autoApproved ? "approved" : "pending",
        },
        actorId: userId,
        message: "建立声线与风格基线",
        createdAt: now,
      });
      const [created] = await transaction
        .insert(styleProfiles)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          scope: input.scope,
          scopeId: input.scopeId,
          dimension: input.dimension,
          name: input.name,
          version,
          approvalStatus: resolved.value.autoApproved ? "approved" : "pending",
          sourceType: input.source.type,
          sourceId: resolved.value.sourceId,
          sourceVersionId: resolved.value.sourceVersionId,
          sourceVersionNodeId: resolved.value.sourceVersionNodeId,
          sourceLabel: resolved.value.sourceLabel,
          profile: resolved.value.profile,
          approvalRationale: resolved.value.approvalRationale,
          approvedBy: resolved.value.autoApproved ? userId : null,
          approvedAt: resolved.value.autoApproved ? now : null,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create style profile");
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "style.profile_created", created.id);
      await rememberIdempotentResource(transaction, userId, "style-profiles", idempotencyKey, {
        resourceType: "style_profile",
        resourceId: created.id,
      });
      return { kind: "ok", value: toProfile(created) };
    });
  }

  async approveProfile(
    userId: string,
    context: StyleWorkContext,
    profileId: string,
    input: StyleProfileApproveRequest,
    audit: WorksAuditContext,
  ): Promise<StyleWriteResult<StyleProfile>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [profile] = await transaction
        .select()
        .from(styleProfiles)
        .where(
          and(
            eq(styleProfiles.id, profileId),
            eq(styleProfiles.userId, userId),
            eq(styleProfiles.workId, context.workId),
            eq(styleProfiles.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!profile) {
        return { kind: "not_found" };
      }
      if (profile.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (profile.approvalStatus !== "pending") {
        return { kind: "invalid_state", status: profile.approvalStatus };
      }
      const now = new Date();
      await transaction
        .update(styleProfiles)
        .set({
          approvalStatus: "superseded",
          approvedBy: null,
          approvedAt: null,
          approvalRationale: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(styleProfiles.userId, userId),
            eq(styleProfiles.workId, context.workId),
            eq(styleProfiles.branchId, context.branchId),
            eq(styleProfiles.scope, profile.scope),
            eq(styleProfiles.dimension, profile.dimension),
            profile.scopeId
              ? eq(styleProfiles.scopeId, profile.scopeId)
              : isNull(styleProfiles.scopeId),
            eq(styleProfiles.approvalStatus, "approved"),
          ),
        );
      const nextVersion = profile.version + 1;
      const versionNodeId = uuidv7();
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId,
        nodeType: "snapshot",
        objectType: "style_profile",
        objectId: profile.id,
        objectVersion: nextVersion,
        payload: {
          action: "style.profile_approved",
          rationale: input.rationale,
          sourceType: profile.sourceType,
          sourceId: profile.sourceId,
          sourceVersionId: profile.sourceVersionId,
        },
        actorId: userId,
        message: "批准声线与风格基线",
        createdAt: now,
      });
      const [approved] = await transaction
        .update(styleProfiles)
        .set({
          approvalStatus: "approved",
          approvalRationale: input.rationale,
          approvedBy: userId,
          approvedAt: now,
          version: nextVersion,
          versionNodeId,
          updatedAt: now,
        })
        .where(and(eq(styleProfiles.id, profile.id), eq(styleProfiles.version, profile.version)))
        .returning();
      if (!approved) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "style.profile_approved", approved.id);
      return { kind: "ok", value: toProfile(approved) };
    });
  }

  async checkDrift(
    userId: string,
    context: StyleWorkContext,
    input: StyleDriftCheckRequest,
    audit: WorksAuditContext,
  ): Promise<StyleWriteResult<StyleDriftReport>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const loaded = await loadChaptersForCheck(transaction, userId, context, input);
      if (loaded.kind !== "ok") {
        return loaded;
      }
      const first = loaded.value[0];
      if (!first) {
        return { kind: "no_chapters" };
      }
      const baseline = await resolveApprovedBaseline(transaction, userId, context, first.chapter);
      if (baseline.kind !== "ok") {
        return baseline;
      }
      const growthMarkers =
        baseline.value.scope === "character" && baseline.value.scopeId
          ? await loadGrowthMarkers(
              transaction,
              userId,
              context,
              baseline.value.scopeId,
              loaded.value[0]!.chapter.number,
              loaded.value.at(-1)!.chapter.number,
            )
          : [];
      const evaluation = evaluateStyleDrift({
        scope: input.scope,
        chapters: loaded.value.map((entry) => ({
          id: entry.chapter.id,
          versionId: entry.version.id,
          number: entry.chapter.number,
          title: entry.chapter.title,
          content: entry.version.content,
        })),
        baseline: {
          id: baseline.value.id,
          version: baseline.value.version,
          scope: baseline.value.scope as "work" | "character",
          scopeId: baseline.value.scopeId,
          dimension: baseline.value.dimension as "character_voice" | "prose",
          guides: baseline.value.profile.guides,
          samples: baseline.value.profile.samples,
        },
        growthMarkers,
        model: input.model,
        prompt: input.prompt,
      });
      const now = new Date();
      const reportId = uuidv7();
      const chapterId = input.scope === "chapter" ? first.chapter.id : null;
      const chapterVersionId = input.scope === "chapter" ? first.version.id : null;
      const fromChapter = input.scope === "chapter" ? first.chapter.number : input.fromChapter!;
      const toChapter = input.scope === "chapter" ? first.chapter.number : input.toChapter!;
      const sourceHash = createHash("sha256")
        .update(
          stableJson({
            baselineId: baseline.value.id,
            baselineVersion: baseline.value.version,
            chapters: loaded.value.map((entry) => ({
              id: entry.version.id,
              contentHash: entry.version.contentHash,
            })),
            growthMarkers,
            model: input.model,
            prompt: input.prompt,
          }),
        )
        .digest("hex");
      const [report] = await transaction
        .insert(styleDriftReports)
        .values({
          id: reportId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          scope: input.scope,
          chapterId,
          chapterVersionId,
          baselineProfileId: baseline.value.id,
          baselineVersion: baseline.value.version,
          baselineDimension: baseline.value.dimension,
          baselineSourceType: baseline.value.sourceType,
          ruleVersion: STYLE_DRIFT_RULE_VERSION,
          modelProvider: input.model.provider,
          model: input.model.model,
          modelParameters: input.model.parameters,
          promptKey: input.prompt.key,
          promptVersion: input.prompt.version,
          profileVersion: baseline.value.version,
          windowFromChapter: fromChapter,
          windowToChapter: toChapter,
          sourceHash,
          summary: evaluation.summary,
          trend: evaluation.trend,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!report) {
        throw new Error("Failed to create style drift report");
      }
      if (evaluation.findings.length > 0) {
        await transaction.insert(styleDriftFindings).values(
          evaluation.findings.map((finding) => ({
            id: uuidv7(),
            reportId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            baselineProfileId: baseline.value.id,
            baselineVersion: baseline.value.version,
            dimension: finding.dimension,
            classification: finding.classification,
            severity: finding.classification === "drift" ? "P2" : "P3",
            code: finding.code,
            chapterId: finding.chapterId,
            chapterVersionId: finding.chapterVersionId,
            quote: finding.quote,
            startOffset: finding.startOffset,
            endOffset: finding.endOffset,
            locator: finding.locator,
            explanation: finding.explanation,
            recommendation: finding.recommendation,
            growthEvidence: finding.growthEvidence,
            createdAt: now,
          })),
        );
      }
      await writeAudit(transaction, userId, audit, "style.drift_checked", report.id);
      return { kind: "ok", value: await hydrateReport(transaction, report) };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

async function resolveProfileSource(
  transaction: DatabaseTransaction,
  userId: string,
  context: StyleWorkContext,
  input: StyleProfileCreateRequest,
): Promise<StyleWriteResult<ResolvedProfileSource>> {
  if (input.source.type === "golden_three") {
    const [styleBaseline] = await transaction
      .select()
      .from(styleBaselines)
      .where(
        and(
          eq(styleBaselines.id, input.source.id),
          eq(styleBaselines.userId, userId),
          eq(styleBaselines.workId, context.workId),
          eq(styleBaselines.branchId, context.branchId),
        ),
      )
      .limit(1);
    if (!styleBaseline) {
      return { kind: "source_not_approved" };
    }
    if (input.source.versionId !== styleBaseline.id) {
      return {
        kind: "reference_invalid",
        message: "黄金三章基线来源与固定版本不一致",
      };
    }
    const [lock] = await transaction
      .select({ id: goldenThreeLocks.id })
      .from(goldenThreeLocks)
      .where(
        and(
          eq(goldenThreeLocks.userId, userId),
          eq(goldenThreeLocks.workId, context.workId),
          eq(goldenThreeLocks.branchId, context.branchId),
          eq(goldenThreeLocks.styleBaselineId, styleBaseline.id),
        ),
      )
      .limit(1);
    if (!lock) {
      return { kind: "source_not_approved" };
    }
    const excerpts = styleBaseline.profile.excerpts;
    const samples = excerpts.map((entry, index) => ({
      chapterId: entry.chapterId,
      chapterVersionId: entry.chapterVersionId,
      excerpt: entry.excerpt,
      locator: `黄金三章 · 样本 ${index + 1}`,
    }));
    return {
      kind: "ok",
      value: {
        sourceId: styleBaseline.id,
        sourceVersionId: styleBaseline.id,
        sourceVersionNodeId: styleBaseline.versionNodeId,
        sourceLabel: input.source.label,
        profile: {
          guides: [defaultGuide(input.dimension)],
          samples,
          metrics: measureStyleText(samples.map((sample) => sample.excerpt).join("\n")),
        },
        autoApproved: true,
        approvalRationale: "来源是作者已锁定并批准的黄金三章风格基线。",
      },
    };
  }

  const [source] = await transaction
    .select({ chapter: chapters, version: chapterVersions })
    .from(chapterVersions)
    .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
    .where(
      and(
        eq(chapterVersions.id, input.source.versionId),
        eq(chapterVersions.userId, userId),
        eq(chapterVersions.workId, context.workId),
        eq(chapterVersions.branchId, context.branchId),
        eq(chapters.userId, userId),
        eq(chapters.workId, context.workId),
        eq(chapters.branchId, context.branchId),
      ),
    )
    .limit(1);
  if (!source) {
    return {
      kind: "reference_invalid",
      message: "基线来源章节版本不存在或不属于当前创作线",
    };
  }
  if (input.source.id !== source.version.id) {
    return {
      kind: "reference_invalid",
      message: "基线来源标识与固定章节版本不一致",
    };
  }
  if (
    input.source.type === "approved_chapter_version" &&
    !["approved", "locked", "published"].includes(source.chapter.status)
  ) {
    return { kind: "source_not_approved" };
  }
  const sample = {
    chapterId: source.chapter.id,
    chapterVersionId: source.version.id,
    excerpt: source.version.content.slice(0, 2_000),
    locator: `第 ${source.chapter.number} 章 · 第 1 段`,
  };
  return {
    kind: "ok",
    value: {
      sourceId: source.version.id,
      sourceVersionId: source.version.id,
      sourceVersionNodeId: source.version.versionNodeId,
      sourceLabel: input.source.label,
      profile: {
        guides: [defaultGuide(input.dimension)],
        samples: [sample],
        metrics: measureStyleText(sample.excerpt),
      },
      autoApproved: false,
      approvalRationale: null,
    },
  };
}

async function loadChaptersForCheck(
  transaction: DatabaseTransaction,
  userId: string,
  context: StyleWorkContext,
  input: StyleDriftCheckRequest,
): Promise<StyleWriteResult<LoadedChapter[]>> {
  const rows =
    input.scope === "chapter"
      ? await transaction
          .select({ chapter: chapters, version: chapterVersions })
          .from(chapters)
          .innerJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
          .where(
            and(
              eq(chapters.id, input.chapterId!),
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
            ),
          )
      : await transaction
          .select({ chapter: chapters, version: chapterVersions })
          .from(chapters)
          .innerJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
          .where(
            and(
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
              gte(chapters.number, input.fromChapter!),
              lte(chapters.number, input.toChapter!),
            ),
          )
          .orderBy(asc(chapters.number));
  if (rows.length === 0) {
    return input.scope === "chapter"
      ? { kind: "chapter_version_required" }
      : { kind: "no_chapters" };
  }
  return { kind: "ok", value: rows };
}

async function resolveApprovedBaseline(
  transaction: DatabaseTransaction,
  userId: string,
  context: StyleWorkContext,
  firstChapter: ChapterRecord,
): Promise<StyleWriteResult<StyleProfileRecord>> {
  const approved = await transaction
    .select()
    .from(styleProfiles)
    .where(
      and(
        eq(styleProfiles.userId, userId),
        eq(styleProfiles.workId, context.workId),
        eq(styleProfiles.branchId, context.branchId),
        eq(styleProfiles.approvalStatus, "approved"),
      ),
    )
    .orderBy(desc(styleProfiles.version), desc(styleProfiles.createdAt));
  if (approved.length === 0) {
    const [any] = await transaction
      .select({ id: styleProfiles.id })
      .from(styleProfiles)
      .where(
        and(
          eq(styleProfiles.userId, userId),
          eq(styleProfiles.workId, context.workId),
          eq(styleProfiles.branchId, context.branchId),
        ),
      )
      .limit(1);
    return any ? { kind: "baseline_unapproved" } : { kind: "baseline_required" };
  }
  const brief = chapterBriefSchema.safeParse(firstChapter.brief);
  const povName = brief.success ? brief.data.pov : "";
  const [pov] = povName
    ? await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "character"),
            eq(entities.name, povName),
            isNull(entities.deletedAt),
          ),
        )
        .limit(1)
    : [];
  const selected =
    (pov
      ? approved.find(
          (profile) =>
            profile.scope === "character" &&
            profile.scopeId === pov.id &&
            profile.dimension === "character_voice",
        )
      : undefined) ??
    approved.find((profile) => profile.scope === "work" && profile.dimension === "prose") ??
    approved[0];
  return selected ? { kind: "ok", value: selected } : { kind: "baseline_required" };
}

async function loadGrowthMarkers(
  transaction: DatabaseTransaction,
  userId: string,
  context: StyleWorkContext,
  characterId: string,
  fromChapter: number,
  toChapter: number,
): Promise<StyleGrowthMarkerInput[]> {
  const rows = await transaction
    .select()
    .from(characterArcs)
    .where(
      and(
        eq(characterArcs.userId, userId),
        eq(characterArcs.workId, context.workId),
        eq(characterArcs.branchId, context.branchId),
        eq(characterArcs.characterId, characterId),
        inArray(characterArcs.status, ["planted", "progressed", "paid_off"]),
        isNull(characterArcs.deletedAt),
        lte(characterArcs.targetFromChapter, toChapter),
        gte(characterArcs.targetToChapter, fromChapter),
      ),
    )
    .orderBy(asc(characterArcs.targetFromChapter));
  return rows.map((arc: CharacterArcRecord) => ({
    id: arc.id,
    characterId: arc.characterId,
    fromChapter: arc.targetFromChapter,
    toChapter: arc.targetToChapter,
    startState: arc.startState,
    endState: arc.endState,
    reason: arc.summary || arc.title,
  }));
}

async function latestReport(
  transaction: DatabaseTransaction,
  userId: string,
  context: StyleWorkContext,
  scope: "chapter" | "volume" | "cross_volume",
): Promise<StyleDriftReportRecord | undefined> {
  const [report] = await transaction
    .select()
    .from(styleDriftReports)
    .where(
      and(
        eq(styleDriftReports.userId, userId),
        eq(styleDriftReports.workId, context.workId),
        eq(styleDriftReports.branchId, context.branchId),
        eq(styleDriftReports.scope, scope),
      ),
    )
    .orderBy(desc(styleDriftReports.createdAt))
    .limit(1);
  return report;
}

async function hydrateReport(
  transaction: DatabaseTransaction,
  report: StyleDriftReportRecord,
): Promise<StyleDriftReport> {
  const findings = await transaction
    .select()
    .from(styleDriftFindings)
    .where(eq(styleDriftFindings.reportId, report.id))
    .orderBy(asc(styleDriftFindings.chapterId), asc(styleDriftFindings.startOffset));
  return {
    id: report.id,
    workId: report.workId,
    branchId: report.branchId,
    scope: report.scope as StyleDriftReport["scope"],
    chapterId: report.chapterId,
    window: { fromChapter: report.windowFromChapter, toChapter: report.windowToChapter },
    baseline: {
      id: report.baselineProfileId,
      version: report.baselineVersion,
      dimension: report.baselineDimension as StyleDriftReport["baseline"]["dimension"],
      sourceType: report.baselineSourceType as StyleProfileSourceType,
    },
    profileVersion: report.profileVersion,
    ruleVersion: STYLE_DRIFT_RULE_VERSION,
    model: {
      provider: report.modelProvider,
      model: report.model,
      parameters: report.modelParameters,
    },
    prompt: { key: report.promptKey, version: report.promptVersion },
    summary: report.summary,
    findings: findings.map(toFinding),
    trend: report.trend,
    createdAt: report.createdAt.toISOString(),
  };
}

function toProfile(record: StyleProfileRecord): StyleProfile {
  return {
    id: record.id,
    workId: record.workId,
    branchId: record.branchId,
    scope: record.scope as StyleProfile["scope"],
    scopeId: record.scopeId,
    dimension: record.dimension as StyleProfile["dimension"],
    name: record.name,
    version: record.version,
    approvalStatus: record.approvalStatus as StyleProfile["approvalStatus"],
    source: {
      type: record.sourceType as StyleProfileSourceType,
      id: record.sourceId,
      versionId: record.sourceVersionId,
      versionNodeId: record.sourceVersionNodeId,
      label: record.sourceLabel,
    },
    profile: record.profile,
    approval:
      record.approvalStatus === "approved" &&
      record.approvedBy &&
      record.approvedAt &&
      record.approvalRationale
        ? {
            approvedBy: record.approvedBy,
            approvedAt: record.approvedAt.toISOString(),
            rationale: record.approvalRationale,
          }
        : null,
    versionNodeId: record.versionNodeId,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toFinding(record: StyleDriftFindingRecord): StyleDriftFinding {
  return {
    id: record.id,
    code: record.code as StyleDriftFinding["code"],
    classification: record.classification as StyleDriftFinding["classification"],
    severity: record.severity as StyleDriftFinding["severity"],
    dimension: record.dimension as StyleDriftFinding["dimension"],
    chapterId: record.chapterId,
    chapterVersionId: record.chapterVersionId,
    quote: record.quote,
    startOffset: record.startOffset,
    endOffset: record.endOffset,
    locator: record.locator,
    explanation: record.explanation,
    recommendation: record.recommendation,
    growthEvidence: record.growthEvidence as StyleDriftGrowthEvidenceJson | null,
  };
}

function defaultGuide(dimension: "character_voice" | "prose"): string {
  return dimension === "character_voice"
    ? "对照已批准样本保持人物句长、感叹强度和对话密度。"
    : "对照已批准样本保持叙述句长、感叹强度和对话密度。";
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: StyleWorkContext,
): Promise<string> {
  const [branch] = await transaction
    .select({ headNodeId: workBranches.headNodeId })
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("Style branch is missing its version head");
  }
  return branch.headNodeId;
}

async function advanceBranchHead(
  transaction: DatabaseTransaction,
  context: StyleWorkContext,
  versionNodeId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: WorksAuditContext,
  action: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType: "style_profile",
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      return nested;
    }
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}
