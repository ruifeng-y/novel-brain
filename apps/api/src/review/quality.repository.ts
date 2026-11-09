import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  chapterBriefSchema,
  CRITIC_RULE_VERSION,
  QUALITY_RUBRIC_VERSION,
  type CriticAnnotation,
  type CriticAnnotationListQuery,
  type CriticAnnotationPatchRequest,
  type CriticEvidence,
  type CriticFinding,
  type CriticFindingCode,
  type CriticFindingDimension,
  type CriticVerifyRequest,
  type QualityDimension,
  type QualityReport,
  type QualityWorkspace,
} from "@novel-brain/contracts";
import {
  evaluateCritic,
  type CriticEvaluationInput,
  type CriticFactInput,
} from "@novel-brain/core";
import {
  auditLogs,
  chapterVersions,
  chapters,
  characterKnowledgeStates,
  characterProfiles,
  createDatabaseClient,
  createDatabasePool,
  entities,
  facts as canonicalFacts,
  findIdempotentResource,
  mapNodes,
  outlineNodes,
  qualityFindings,
  qualityReports,
  rememberIdempotentResource,
  styleBaselines,
  timelineEvents,
  withTenantTransaction,
  workBranches,
  works,
  type DatabaseClient,
  type QualityDimensionJson,
} from "@novel-brain/db";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import type { WorksAuditContext } from "../works/works.repository";
import {
  listOpenQualityFindings,
  qualityGateFromFindings,
  type OpenQualityFinding,
} from "./quality-gate";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type ChapterRecord = InferSelectModel<typeof chapters>;
type ChapterVersionRecord = InferSelectModel<typeof chapterVersions>;
type QualityReportRecord = InferSelectModel<typeof qualityReports>;
type QualityFindingRecord = InferSelectModel<typeof qualityFindings>;

export type QualityVerifyResult =
  | { kind: "not_found" }
  | { kind: "version_required" }
  | { kind: "version_conflict" }
  | { kind: "ok"; workspace: QualityWorkspace };

export type QualityReadResult = { kind: "not_found" } | { kind: "ok"; workspace: QualityWorkspace };

export type AnnotationUpdateResult =
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "not_dismissible" }
  | { kind: "invalid_state"; status: string }
  | { kind: "ok"; annotation: CriticAnnotation };

@Injectable()
export class QualityRepository implements OnModuleDestroy {
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

  async verify(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: CriticVerifyRequest,
    idempotencyKey: string,
    audit: WorksAuditContext,
  ): Promise<QualityVerifyResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
      const chapter = await loadChapter(transaction, userId, workId, branchId, chapterId, true);
      if (!chapter) {
        return { kind: "not_found" };
      }
      if (!chapter.version) {
        return { kind: "version_required" };
      }
      if (input.chapterVersionId && input.chapterVersionId !== chapter.version.id) {
        return { kind: "version_conflict" };
      }
      const existing = await findIdempotentResource(
        transaction,
        userId,
        "quality-verify",
        idempotencyKey,
      );
      if (existing) {
        const [report] = await transaction
          .select()
          .from(qualityReports)
          .where(
            and(
              eq(qualityReports.id, existing.resourceId),
              eq(qualityReports.userId, userId),
              eq(qualityReports.workId, workId),
              eq(qualityReports.branchId, branchId),
              eq(qualityReports.chapterId, chapterId),
              eq(qualityReports.chapterVersionId, chapter.version.id),
            ),
          )
          .limit(1);
        if (!report) {
          return { kind: "version_conflict" };
        }
        return {
          kind: "ok",
          workspace: await buildWorkspace(transaction, userId, report, chapter),
        };
      }

      const criticInput = await loadCriticInput(
        transaction,
        userId,
        workId,
        branchId,
        chapter.chapter,
        chapter.version,
      );
      const evaluation = evaluateCritic(criticInput);
      const now = new Date();
      const reportId = uuidv7();
      const sourceHash = createHash("sha256").update(stableJson(criticInput)).digest("hex");
      await transaction
        .update(qualityFindings)
        .set({
          status: "superseded",
          ignoredReason: null,
          dismissedBy: null,
          dismissedAt: null,
          version: sql`${qualityFindings.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(qualityFindings.userId, userId),
            eq(qualityFindings.workId, workId),
            eq(qualityFindings.branchId, branchId),
            eq(qualityFindings.chapterId, chapterId),
            eq(qualityFindings.status, "open"),
          ),
        );
      const [report] = await transaction
        .insert(qualityReports)
        .values({
          id: reportId,
          workId,
          branchId,
          userId,
          chapterId,
          chapterVersionId: chapter.version.id,
          rubricVersion: QUALITY_RUBRIC_VERSION,
          ruleVersion: CRITIC_RULE_VERSION,
          sourceHash,
          dimensions: evaluation.dimensions,
          summary: reportSummary(evaluation.dimensions),
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!report) {
        throw new Error("Failed to persist quality report");
      }
      if (evaluation.findings.length > 0) {
        await transaction.insert(qualityFindings).values(
          evaluation.findings.map((finding) => ({
            id: uuidv7(),
            reportId,
            workId,
            branchId,
            userId,
            chapterId,
            chapterVersionId: chapter.version!.id,
            dimension: finding.dimension,
            qualityDimension: finding.qualityDimension,
            severity: finding.severity,
            structural: finding.structural,
            code: finding.code,
            dedupeKey: finding.dedupeKey,
            evidence: finding.evidence as unknown as QualityDimensionJson["evidence"],
            sourceRefs: finding.sourceRefs as unknown as Array<Record<string, unknown>>,
            affectedObjects: finding.affectedObjects as unknown as Array<Record<string, unknown>>,
            recommendation: finding.recommendation,
            status: "open",
            version: 1,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "critic.verification_created",
        targetType: "chapter",
        targetId: chapterId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      await rememberIdempotentResource(transaction, userId, "quality-verify", idempotencyKey, {
        resourceType: "quality_report",
        resourceId: report.id,
      });
      return {
        kind: "ok",
        workspace: await buildWorkspace(transaction, userId, report, chapter),
      };
    });
  }

  async workspace(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<QualityReadResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const chapter = await loadChapter(transaction, userId, workId, branchId, chapterId, false);
      if (!chapter) {
        return { kind: "not_found" };
      }
      const report = chapter.version
        ? await latestReport(transaction, userId, workId, branchId, chapterId, chapter.version.id)
        : undefined;
      return {
        kind: "ok",
        workspace: await buildWorkspace(transaction, userId, report, chapter),
      };
    });
  }

  async annotations(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    query: CriticAnnotationListQuery,
  ): Promise<
    | { kind: "not_found" }
    | { kind: "ok"; data: CriticAnnotation[]; nextCursor: string | null }
    | { kind: "invalid_cursor" }
  > {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const chapter = await loadChapter(transaction, userId, workId, branchId, chapterId, false);
      if (!chapter) {
        return { kind: "not_found" };
      }
      const scope = and(
        eq(qualityFindings.userId, userId),
        eq(qualityFindings.workId, workId),
        eq(qualityFindings.branchId, branchId),
        eq(qualityFindings.chapterId, chapterId),
      );
      const cursor = query.cursor
        ? (
            await transaction
              .select({ id: qualityFindings.id, createdAt: qualityFindings.createdAt })
              .from(qualityFindings)
              .where(and(scope, eq(qualityFindings.id, query.cursor)))
              .limit(1)
          )[0]
        : undefined;
      if (query.cursor && !cursor) {
        return { kind: "invalid_cursor" };
      }
      const rows = await transaction
        .select()
        .from(qualityFindings)
        .where(
          and(
            scope,
            cursor
              ? or(
                  lt(qualityFindings.createdAt, cursor.createdAt),
                  and(
                    eq(qualityFindings.createdAt, cursor.createdAt),
                    lt(qualityFindings.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(qualityFindings.createdAt), desc(qualityFindings.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      return {
        kind: "ok",
        data: page.map(toAnnotation),
        nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async updateAnnotation(
    userId: string,
    workId: string,
    branchId: string,
    annotationId: string,
    input: CriticAnnotationPatchRequest,
    audit: WorksAuditContext,
  ): Promise<AnnotationUpdateResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
      const [row] = await transaction
        .select()
        .from(qualityFindings)
        .where(
          and(
            eq(qualityFindings.id, annotationId),
            eq(qualityFindings.userId, userId),
            eq(qualityFindings.workId, workId),
            eq(qualityFindings.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        return { kind: "not_found" };
      }
      if (row.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (row.status === "superseded") {
        return { kind: "invalid_state", status: row.status };
      }
      const now = new Date();
      if (input.action === "dismiss") {
        if (row.status === "dismissed" && row.ignoredReason === input.reason) {
          return { kind: "ok", annotation: toAnnotation(row) };
        }
        if (row.severity === "P0" || row.severity === "P1" || row.structural) {
          return { kind: "not_dismissible" };
        }
        const [updated] = await transaction
          .update(qualityFindings)
          .set({
            status: "dismissed",
            ignoredReason: input.reason ?? "",
            dismissedBy: userId,
            dismissedAt: now,
            version: row.version + 1,
            updatedAt: now,
          })
          .where(and(eq(qualityFindings.id, row.id), eq(qualityFindings.version, row.version)))
          .returning();
        if (!updated) {
          return { kind: "version_conflict" };
        }
        await writeFindingAudit(transaction, userId, audit, "critic.finding_dismissed", row.id);
        return { kind: "ok", annotation: toAnnotation(updated) };
      }
      if (row.status !== "dismissed") {
        return { kind: "invalid_state", status: row.status };
      }
      const [updated] = await transaction
        .update(qualityFindings)
        .set({
          status: "open",
          ignoredReason: null,
          dismissedBy: null,
          dismissedAt: null,
          version: row.version + 1,
          updatedAt: now,
        })
        .where(and(eq(qualityFindings.id, row.id), eq(qualityFindings.version, row.version)))
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await writeFindingAudit(transaction, userId, audit, "critic.finding_reopened", row.id);
      return { kind: "ok", annotation: toAnnotation(updated) };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

async function loadChapter(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
  lock: boolean,
): Promise<{ chapter: ChapterRecord; version: ChapterVersionRecord | null } | undefined> {
  const base = transaction
    .select({ chapter: chapters })
    .from(chapters)
    .innerJoin(works, and(eq(works.id, chapters.workId), eq(works.userId, chapters.userId)))
    .innerJoin(
      workBranches,
      and(
        eq(workBranches.id, chapters.branchId),
        eq(workBranches.workId, chapters.workId),
        eq(workBranches.userId, chapters.userId),
      ),
    )
    .where(
      and(
        eq(chapters.id, chapterId),
        eq(chapters.workId, workId),
        eq(chapters.branchId, branchId),
        eq(chapters.userId, userId),
        isNull(works.deletedAt),
      ),
    )
    .limit(1);
  const rows = await (lock ? base.for("update") : base);
  const row = rows[0];
  if (!row) {
    return undefined;
  }
  const version = row.chapter.currentVersionId
    ? (
        await transaction
          .select()
          .from(chapterVersions)
          .where(eq(chapterVersions.id, row.chapter.currentVersionId))
          .limit(1)
      )[0]
    : undefined;
  return { chapter: row.chapter, version: version ?? null };
}

async function loadCriticInput(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapter: ChapterRecord,
  version: ChapterVersionRecord,
): Promise<CriticEvaluationInput> {
  const brief = chapterBriefSchema.safeParse(chapter.brief);
  const parsedBrief = brief.success ? brief.data : null;
  const entityRows = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.workId, workId),
        eq(entities.branchId, branchId),
        isNull(entities.deletedAt),
      ),
    )
    .orderBy(entities.createdAt);
  const entityById = new Map(entityRows.map((entity) => [entity.id, entity]));
  const povName = parsedBrief?.pov ?? "";
  const pov =
    entityRows.find((entity) => entity.type === "character" && entity.name === povName) ?? null;
  const canonicalFactRows = await transaction
    .select()
    .from(canonicalFacts)
    .where(
      and(
        eq(canonicalFacts.userId, userId),
        eq(canonicalFacts.workId, workId),
        eq(canonicalFacts.branchId, branchId),
        eq(canonicalFacts.status, "active"),
        sql`${canonicalFacts.validFromChapter} <= ${chapter.number}`,
        or(
          isNull(canonicalFacts.validToChapter),
          gte(canonicalFacts.validToChapter, chapter.number),
        ),
      ),
    )
    .orderBy(canonicalFacts.createdAt);
  const facts: CriticFactInput[] = canonicalFactRows.map((fact) => ({
    id: fact.id,
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    sourceChapterNumber: fact.validFromChapter,
    validFromChapter: fact.validFromChapter,
    validToChapter: fact.validToChapter,
    sourceType: "fact",
    sourceLabel: `${fact.subject} · ${fact.predicate}`,
  }));
  const syntheticKnowledge: CriticEvaluationInput["knowledgeStates"] = [];
  for (const entity of entityRows.filter((row) => row.status === "locked")) {
    const data = asRecord(entity.attributes);
    if (entity.type === "character" && typeof data.bodyState === "string") {
      facts.push({
        id: entity.id,
        subject: entity.name,
        predicate: "身体状态",
        object: data.bodyState,
        sourceChapterNumber: 1,
        validFromChapter: 1,
        validToChapter: null,
        sourceType: "character",
        sourceLabel: `${entity.name} · 身体状态`,
      });
    }
    if (entity.type === "world_rule" && typeof data.rule === "string") {
      facts.push({
        id: entity.id,
        subject: entity.name,
        predicate: "世界规则",
        object: data.rule,
        sourceChapterNumber: 1,
        validFromChapter: 1,
        validToChapter: null,
        sourceType: "world_rule",
        sourceLabel: entity.name,
      });
    }
    if (entity.type === "character" && typeof data.knowledgeBoundary === "string") {
      const secret = data.knowledgeBoundary
        .replace(/^.*?不知道/u, "")
        .replace(/[。.]$/u, "")
        .trim();
      if (secret && data.knowledgeBoundary.includes("不知道")) {
        syntheticKnowledge.push({
          id: entity.id,
          characterId: entity.id,
          characterName: entity.name,
          objectiveFactId: entity.id,
          state: "unknown",
          claimedContent: secret,
          validFromChapter: 1,
          validToChapter: null,
        });
      }
    }
  }
  const knowledgeRows = await transaction
    .select()
    .from(characterKnowledgeStates)
    .where(
      and(
        eq(characterKnowledgeStates.userId, userId),
        eq(characterKnowledgeStates.workId, workId),
        eq(characterKnowledgeStates.branchId, branchId),
        sql`${characterKnowledgeStates.validFromChapter} <= ${chapter.number}`,
        or(
          isNull(characterKnowledgeStates.validToChapter),
          gte(characterKnowledgeStates.validToChapter, chapter.number),
        ),
      ),
    )
    .orderBy(characterKnowledgeStates.validFromChapter);
  const knowledgeStates: CriticEvaluationInput["knowledgeStates"] = [
    ...syntheticKnowledge,
    ...knowledgeRows.map((state) => ({
      id: state.id,
      characterId: state.characterId,
      characterName: entityById.get(state.characterId)?.name ?? "未知人物",
      objectiveFactId: state.objectiveFactId,
      state: state.state as CriticEvaluationInput["knowledgeStates"][number]["state"],
      claimedContent: state.claimedContent,
      validFromChapter: state.validFromChapter,
      validToChapter: state.validToChapter,
    })),
  ];
  const timelineRows = await transaction
    .select()
    .from(timelineEvents)
    .where(
      and(
        eq(timelineEvents.userId, userId),
        eq(timelineEvents.workId, workId),
        eq(timelineEvents.branchId, branchId),
        or(
          isNull(timelineEvents.validToChapter),
          gte(timelineEvents.validToChapter, chapter.number),
        ),
      ),
    )
    .orderBy(timelineEvents.storyTimeSortKey);
  const locationRows = await transaction
    .select()
    .from(mapNodes)
    .where(
      and(
        eq(mapNodes.userId, userId),
        eq(mapNodes.workId, workId),
        eq(mapNodes.branchId, branchId),
        sql`${mapNodes.validFromChapter} <= ${chapter.number}`,
        or(isNull(mapNodes.validToChapter), gte(mapNodes.validToChapter, chapter.number)),
      ),
    )
    .orderBy(mapNodes.name);
  const voiceRows = await transaction
    .select({
      profile: characterProfiles,
      entity: entities,
    })
    .from(characterProfiles)
    .innerJoin(entities, eq(entities.id, characterProfiles.entityId))
    .where(
      and(
        eq(characterProfiles.userId, userId),
        eq(characterProfiles.workId, workId),
        eq(characterProfiles.branchId, branchId),
        isNull(entities.deletedAt),
      ),
    )
    .orderBy(entities.name);
  const [outlineNode] = await transaction
    .select()
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.userId, userId),
        eq(outlineNodes.workId, workId),
        eq(outlineNodes.branchId, branchId),
        eq(outlineNodes.chapterId, chapter.id),
      ),
    )
    .limit(1);
  const [styleBaseline] = await transaction
    .select()
    .from(styleBaselines)
    .where(
      and(
        eq(styleBaselines.userId, userId),
        eq(styleBaselines.workId, workId),
        eq(styleBaselines.branchId, branchId),
      ),
    )
    .orderBy(desc(styleBaselines.createdAt))
    .limit(1);
  const excerpts =
    styleBaseline && Array.isArray(styleBaseline.profile.excerpts)
      ? styleBaseline.profile.excerpts
          .map((entry) => (typeof entry.excerpt === "string" ? entry.excerpt : ""))
          .filter(Boolean)
      : [];

  return {
    chapter: {
      id: chapter.id,
      versionId: version.id,
      number: chapter.number,
      title: chapter.title,
      content: version.content,
      povCharacterId: pov?.id ?? null,
      povCharacterName: pov?.name ?? parsedBrief?.pov ?? null,
      goal: parsedBrief?.goal ?? "",
      location: parsedBrief?.location ?? "",
      requiredBeats: parsedBrief?.sceneBeats ?? [],
      requiredFacts: parsedBrief?.requiredFacts ?? [],
      outlineNodeId: outlineNode?.id ?? null,
    },
    facts,
    timelineEvents: timelineRows.map((event) => ({
      id: event.id,
      eventText: event.eventText,
      validFromChapter: event.validFromChapter,
      validToChapter: event.validToChapter,
      locator: `${event.era} · ${event.storyTimeLabel}`,
    })),
    knowledgeStates,
    locations: locationRows.map((location) => ({
      id: location.id,
      name: location.name,
      aliases: [],
      validFromChapter: location.validFromChapter,
      validToChapter: location.validToChapter,
    })),
    voices: voiceRows
      .filter(({ profile }) => profile.voiceGuide.trim() || profile.voiceSample.trim())
      .map(({ profile, entity }) => ({
        id: entity.id,
        characterId: entity.id,
        characterName: entity.name,
        voiceGuide: profile.voiceGuide,
        voiceSample: profile.voiceSample,
      })),
    styleBaseline:
      styleBaseline && excerpts.length > 0
        ? {
            id: styleBaseline.id,
            versionNodeId: styleBaseline.versionNodeId,
            excerpts,
          }
        : null,
  };
}

async function latestReport(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
  chapterVersionId: string,
): Promise<QualityReportRecord | undefined> {
  const [report] = await transaction
    .select()
    .from(qualityReports)
    .where(
      and(
        eq(qualityReports.userId, userId),
        eq(qualityReports.workId, workId),
        eq(qualityReports.branchId, branchId),
        eq(qualityReports.chapterId, chapterId),
        eq(qualityReports.chapterVersionId, chapterVersionId),
      ),
    )
    .orderBy(desc(qualityReports.createdAt))
    .limit(1);
  return report;
}

async function buildWorkspace(
  transaction: DatabaseTransaction,
  userId: string,
  report: QualityReportRecord | undefined,
  chapter: { chapter: ChapterRecord; version: ChapterVersionRecord | null },
): Promise<QualityWorkspace> {
  const reportFindings = report
    ? await transaction
        .select()
        .from(qualityFindings)
        .where(eq(qualityFindings.reportId, report.id))
        .orderBy(desc(qualityFindings.severity), qualityFindings.code)
    : [];
  const openFindings: OpenQualityFinding[] = chapter.version
    ? await listOpenQualityFindings(transaction, userId, chapter.chapter.id, chapter.version.id)
    : [];
  const gate = qualityGateFromFindings(
    openFindings,
    report
      ? {
          state:
            report.rubricVersion === QUALITY_RUBRIC_VERSION &&
            report.ruleVersion === CRITIC_RULE_VERSION
              ? "fresh"
              : "stale",
          reportId: report.id,
        }
      : { state: "missing", reportId: null },
  );
  return {
    report: report ? toReport(report) : null,
    findings: reportFindings.map(toFinding),
    annotations: reportFindings.map(toAnnotation),
    gate,
  };
}

function toReport(record: QualityReportRecord): QualityReport {
  return {
    id: record.id,
    workId: record.workId,
    branchId: record.branchId,
    chapterId: record.chapterId,
    chapterVersionId: record.chapterVersionId,
    rubricVersion: QUALITY_RUBRIC_VERSION,
    ruleVersion: CRITIC_RULE_VERSION,
    sourceHash: record.sourceHash,
    dimensions: record.dimensions.map((dimension) => ({
      dimension: dimension.dimension as QualityDimension,
      label: dimension.label,
      score: dimension.score,
      rationale: dimension.rationale,
      evidence: dimension.evidence as unknown as CriticEvidence[],
    })),
    summary: record.summary,
    createdAt: record.createdAt.toISOString(),
  };
}

function toFinding(record: QualityFindingRecord): CriticFinding {
  return {
    id: record.id,
    reportId: record.reportId,
    workId: record.workId,
    branchId: record.branchId,
    chapterId: record.chapterId,
    chapterVersionId: record.chapterVersionId,
    dimension: record.dimension as CriticFindingDimension,
    qualityDimension: record.qualityDimension as QualityDimension,
    severity: record.severity as CriticFinding["severity"],
    structural: record.structural,
    code: record.code as CriticFindingCode,
    evidence: record.evidence as unknown as CriticEvidence[],
    sourceRefs: record.sourceRefs as CriticFinding["sourceRefs"],
    affectedObjects: record.affectedObjects as CriticFinding["affectedObjects"],
    recommendation: record.recommendation,
    status: record.status as CriticFinding["status"],
    ignoredReason: record.ignoredReason,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toAnnotation(record: QualityFindingRecord): CriticAnnotation {
  const finding = toFinding(record);
  const evidence = finding.evidence[0];
  if (!evidence) {
    throw new Error("Quality finding is missing its primary evidence");
  }
  return {
    findingId: finding.id,
    chapterId: finding.chapterId,
    chapterVersionId: finding.chapterVersionId,
    dimension: finding.dimension,
    qualityDimension: finding.qualityDimension,
    severity: finding.severity,
    structural: finding.structural,
    code: finding.code,
    quote: evidence.quote,
    startOffset: evidence.startOffset,
    endOffset: evidence.endOffset,
    recommendation: finding.recommendation,
    status: finding.status,
    ignoredReason: finding.ignoredReason,
    version: finding.version,
  };
}

async function writeFindingAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: WorksAuditContext,
  action: string,
  findingId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType: "quality_finding",
    targetId: findingId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

function reportSummary(dimensions: QualityDimensionJson[]): string {
  const lowest = [...dimensions].sort((left, right) => left.score - right.score)[0];
  if (!lowest) {
    return "本章质量报告已生成。";
  }
  return `本章六维已记录，最低项为${lowest.label}（${lowest.score}/5）。`;
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
