import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  VOLUME_AUDIT_RULE_VERSION,
  type CriticAffectedObject,
  type CriticEvidence,
  type CriticFindingDimension,
  type CriticSeverity,
  type CriticSourceRef,
  type QualityDimension,
  type VolumeAuditCoverageItem,
  type VolumeAuditFinding,
  type VolumeAuditReport,
  type VolumeAuditSignoffRequest,
  type VolumeAuditSummary,
  type VolumeAuditSummaryVolume,
  type VolumeAuditWorkspace,
} from "@novel-brain/contracts";
import {
  evaluateVolumeAudit,
  type VolumeAuditFindingCandidate,
  type VolumeAuditInput,
} from "@novel-brain/core";
import {
  auditLogs,
  chapterVersions,
  chapters,
  characterArcs,
  createDatabaseClient,
  createDatabasePool,
  entities,
  findIdempotentResource,
  foreshadows,
  goldenThreeLocks,
  outlineNodes,
  plotThreads,
  powerRealms,
  qualityFindings,
  qualityReports,
  rememberIdempotentResource,
  timelineEvents,
  users,
  volumeAuditReports,
  withTenantTransaction,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import type { WorksAuditContext } from "../works/works.repository";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type ChapterRecord = InferSelectModel<typeof chapters>;
type OutlineNodeRecord = InferSelectModel<typeof outlineNodes>;
type QualityFindingRecord = InferSelectModel<typeof qualityFindings>;
type VolumeAuditReportRecord = InferSelectModel<typeof volumeAuditReports>;

export interface VolumeAuditWorkContext {
  workId: string;
  branchId: string;
}

export type VolumeAuditReadResult =
  { kind: "not_found" } | { kind: "ok"; workspace: VolumeAuditWorkspace };

export type VolumeAuditRunResult =
  | { kind: "not_found" }
  | { kind: "volume_not_found" }
  | { kind: "empty_volume" }
  | { kind: "ok"; report: VolumeAuditReport };

export type VolumeAuditSignoffResult =
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "stale" }
  | { kind: "blocked" }
  | { kind: "golden_three_required" }
  | { kind: "ok"; report: VolumeAuditReport };

@Injectable()
export class VolumeAuditRepository implements OnModuleDestroy {
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

  async workspace(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<VolumeAuditReadResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const context = await loadContext(transaction, userId, workId, branchId);
      if (!context) {
        return { kind: "not_found" };
      }
      return {
        kind: "ok",
        workspace: await this.buildWorkspace(transaction, userId, context),
      };
    });
  }

  async run(
    userId: string,
    workId: string,
    branchId: string,
    volumeNodeId: string,
    idempotencyKey: string,
    audit: WorksAuditContext,
  ): Promise<VolumeAuditRunResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, branchId);
      const context = await loadContext(transaction, userId, workId, branchId);
      if (!context) {
        return { kind: "not_found" };
      }
      const existing = await findIdempotentResource(
        transaction,
        userId,
        "volume-audit",
        idempotencyKey,
      );
      if (existing) {
        const [report] = await transaction
          .select()
          .from(volumeAuditReports)
          .where(
            and(
              eq(volumeAuditReports.id, existing.resourceId),
              eq(volumeAuditReports.userId, userId),
              eq(volumeAuditReports.workId, context.workId),
              eq(volumeAuditReports.branchId, context.branchId),
            ),
          )
          .limit(1);
        if (report) {
          const [volume] = await transaction
            .select({ title: outlineNodes.title })
            .from(outlineNodes)
            .where(eq(outlineNodes.id, report.volumeNodeId))
            .limit(1);
          return { kind: "ok", report: toReport(report, volume?.title ?? "卷") };
        }
      }
      const nodes = await loadNodes(transaction, userId, context);
      const volumeNode = nodes.find((node) => node.id === volumeNodeId);
      if (!volumeNode || volumeNode.level !== "volume") {
        return { kind: "volume_not_found" };
      }
      const chapterNodes = descendantChapterNodes(nodes, volumeNodeId);
      if (chapterNodes.length === 0) {
        return { kind: "empty_volume" };
      }
      const chapterIds = chapterNodes
        .map((node) => node.chapterId)
        .filter((chapterId): chapterId is string => Boolean(chapterId));
      if (chapterIds.length === 0) {
        return { kind: "empty_volume" };
      }
      const chapterRows = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            inArray(chapters.id, chapterIds),
          ),
        )
        .orderBy(asc(chapters.number));
      if (chapterRows.length === 0) {
        return { kind: "empty_volume" };
      }
      const versionIds = chapterRows
        .map((chapter) => chapter.currentVersionId)
        .filter((versionId): versionId is string => Boolean(versionId));
      const versions =
        versionIds.length > 0
          ? await transaction
              .select()
              .from(chapterVersions)
              .where(inArray(chapterVersions.id, versionIds))
          : [];
      const versionById = new Map(versions.map((version) => [version.id, version]));
      const reportRows =
        versionIds.length > 0
          ? await transaction
              .select()
              .from(qualityReports)
              .where(
                and(
                  eq(qualityReports.userId, userId),
                  eq(qualityReports.workId, context.workId),
                  eq(qualityReports.branchId, context.branchId),
                  inArray(qualityReports.chapterVersionId, versionIds),
                ),
              )
              .orderBy(desc(qualityReports.createdAt))
          : [];
      const latestReportByVersion = new Map<string, string>();
      for (const report of reportRows) {
        if (!latestReportByVersion.has(report.chapterVersionId)) {
          latestReportByVersion.set(report.chapterVersionId, report.id);
        }
      }
      const findingRows =
        versionIds.length > 0
          ? await transaction
              .select()
              .from(qualityFindings)
              .where(
                and(
                  eq(qualityFindings.userId, userId),
                  eq(qualityFindings.workId, context.workId),
                  eq(qualityFindings.branchId, context.branchId),
                  eq(qualityFindings.status, "open"),
                  inArray(qualityFindings.chapterVersionId, versionIds),
                ),
              )
              .orderBy(asc(qualityFindings.createdAt))
          : [];
      const findingsByVersion = new Map<string, QualityFindingRecord[]>();
      for (const finding of findingRows) {
        const group = findingsByVersion.get(finding.chapterVersionId) ?? [];
        group.push(finding);
        findingsByVersion.set(finding.chapterVersionId, group);
      }
      const ledgerEntries = await loadLedgerEntries(transaction, userId, context, chapterRows);
      const powerRealmRows = await transaction
        .select()
        .from(powerRealms)
        .where(
          and(
            eq(powerRealms.userId, userId),
            eq(powerRealms.workId, context.workId),
            eq(powerRealms.branchId, context.branchId),
          ),
        )
        .orderBy(asc(powerRealms.rank));
      const timelineRows = await transaction
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.userId, userId),
            eq(timelineEvents.workId, context.workId),
            eq(timelineEvents.branchId, context.branchId),
          ),
        )
        .orderBy(asc(timelineEvents.storyTimeSortKey));
      const characterRows = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "character"),
            isNull(entities.deletedAt),
          ),
        )
        .orderBy(asc(entities.name));
      const protagonist =
        characterRows.find((character) => character.tags.includes("主角")) ??
        characterRows[0] ??
        null;
      const antagonists = characterRows.filter((character) => character.tags.includes("反派"));

      const auditInput: VolumeAuditInput = {
        volume: {
          title: volumeNode.title,
          chapterFrom: chapterRows[0]!.number,
          chapterTo: chapterRows.at(-1)!.number,
        },
        chapters: chapterRows.map((chapter) => {
          const version = chapter.currentVersionId
            ? (versionById.get(chapter.currentVersionId) ?? null)
            : null;
          return {
            id: chapter.id,
            versionId: version?.id ?? null,
            number: chapter.number,
            title: chapter.title,
            content: version?.content ?? "",
            outlineGoal: readBriefString(chapter.brief, "goal"),
            outlineLocation: readBriefString(chapter.brief, "location"),
            qualityFindings: (version ? (findingsByVersion.get(version.id) ?? []) : []).map(
              toUpstreamFinding,
            ),
          };
        }),
        ledgerEntries,
        powerRealms: powerRealmRows.map((realm) => ({
          id: realm.id,
          pathId: realm.pathId,
          name: realm.name,
          rank: realm.rank,
        })),
        timelineEvents: timelineRows.map((event) => ({
          id: event.id,
          eventText: event.eventText,
          validFromChapter: event.validFromChapter,
          storyTimeSortKey: event.storyTimeSortKey,
          locator: `${event.era} · ${event.storyTimeLabel}`,
        })),
        protagonist: protagonist ? { id: protagonist.id, name: protagonist.name } : null,
        antagonists: antagonists.map((antagonist) => ({
          id: antagonist.id,
          name: antagonist.name,
        })),
      };
      const evaluation = evaluateVolumeAudit(auditInput);
      const now = new Date();
      const reportId = uuidv7();
      const createdAt = now.toISOString();
      const findings = evaluation.findings.map((finding) =>
        toPersistedFinding(finding, context, createdAt),
      );
      const coverage: VolumeAuditCoverageItem[] = chapterRows.map((chapter) => {
        const version = chapter.currentVersionId
          ? (versionById.get(chapter.currentVersionId) ?? null)
          : null;
        return {
          chapterId: chapter.id,
          chapterNumber: chapter.number,
          title: chapter.title,
          chapterVersionId: version?.id ?? null,
          wordCount: chapter.wordCount,
          qualityReportId: version ? (latestReportByVersion.get(version.id) ?? null) : null,
          qualityFindingCount: version ? (findingsByVersion.get(version.id) ?? []).length : 0,
        };
      });
      const [record] = await transaction
        .insert(volumeAuditReports)
        .values({
          id: reportId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          volumeNodeId,
          chapterFrom: auditInput.volume.chapterFrom,
          chapterTo: auditInput.volume.chapterTo,
          ruleVersion: VOLUME_AUDIT_RULE_VERSION,
          sourceHash: createHash("sha256").update(stableJson(auditInput)).digest("hex"),
          status: evaluation.status,
          findings,
          coverage,
          summary: evaluation.summary,
          version: 1,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!record) {
        throw new Error("Failed to persist volume audit report");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "volume_audit.completed",
        targetType: "volume_audit",
        targetId: reportId,
        decision: evaluation.status === "blocked" ? "blocked" : "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      await rememberIdempotentResource(transaction, userId, "volume-audit", idempotencyKey, {
        resourceType: "volume_audit_report",
        resourceId: reportId,
      });
      return { kind: "ok", report: toReport(record, volumeNode.title) };
    });
  }

  async signoff(
    userId: string,
    workId: string,
    branchId: string,
    auditId: string,
    input: VolumeAuditSignoffRequest,
    audit: WorksAuditContext,
  ): Promise<VolumeAuditSignoffResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, branchId);
      const context = await loadContext(transaction, userId, workId, branchId);
      if (!context) {
        return { kind: "not_found" };
      }
      const [report] = await transaction
        .select()
        .from(volumeAuditReports)
        .where(
          and(
            eq(volumeAuditReports.id, auditId),
            eq(volumeAuditReports.userId, userId),
            eq(volumeAuditReports.workId, context.workId),
            eq(volumeAuditReports.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!report) {
        return { kind: "not_found" };
      }
      if (report.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (await isReportStale(transaction, userId, context, report)) {
        return { kind: "stale" };
      }
      if (input.decision === "accepted") {
        if (report.status === "blocked") {
          return { kind: "blocked" };
        }
        if (!(await goldenThreeLocked(transaction, userId, context))) {
          return { kind: "golden_three_required" };
        }
      }
      const now = new Date();
      const [updated] = await transaction
        .update(volumeAuditReports)
        .set({
          signoffDecision: input.decision,
          signoffRationale: input.rationale,
          signedOffBy: userId,
          signedOffAt: now,
          version: report.version + 1,
        })
        .where(
          and(eq(volumeAuditReports.id, report.id), eq(volumeAuditReports.version, report.version)),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "volume_audit.signed_off",
        targetType: "volume_audit",
        targetId: auditId,
        decision: input.decision,
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      const [volumeNode] = await transaction
        .select({ title: outlineNodes.title })
        .from(outlineNodes)
        .where(eq(outlineNodes.id, updated.volumeNodeId))
        .limit(1);
      return {
        kind: "ok",
        report: toReport(updated, volumeNode?.title ?? "卷"),
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async buildWorkspace(
    transaction: DatabaseTransaction,
    userId: string,
    context: VolumeAuditWorkContext,
  ): Promise<VolumeAuditWorkspace> {
    const nodes = await loadNodes(transaction, userId, context);
    const chapterRows = await transaction
      .select()
      .from(chapters)
      .where(
        and(
          eq(chapters.userId, userId),
          eq(chapters.workId, context.workId),
          eq(chapters.branchId, context.branchId),
        ),
      );
    const chapterById = new Map(chapterRows.map((chapter) => [chapter.id, chapter]));
    const reports = await transaction
      .select()
      .from(volumeAuditReports)
      .where(
        and(
          eq(volumeAuditReports.userId, userId),
          eq(volumeAuditReports.workId, context.workId),
          eq(volumeAuditReports.branchId, context.branchId),
        ),
      )
      .orderBy(desc(volumeAuditReports.createdAt));
    const latestByVolume = new Map<string, string>();
    for (const report of reports) {
      if (!latestByVolume.has(report.volumeNodeId)) {
        latestByVolume.set(report.volumeNodeId, report.id);
      }
    }
    const volumes: VolumeAuditSummaryVolume[] = nodes
      .filter((node) => node.level === "volume")
      .map((volume) => {
        const chapterNodes = descendantChapterNodes(nodes, volume.id);
        const volumeChapters = chapterNodes
          .map((node) => (node.chapterId ? chapterById.get(node.chapterId) : undefined))
          .filter((chapter): chapter is ChapterRecord => Boolean(chapter))
          .sort((left, right) => left.number - right.number);
        if (volumeChapters.length === 0) {
          return null;
        }
        return {
          nodeId: volume.id,
          title: volume.title,
          chapterFrom: volumeChapters[0]!.number,
          chapterTo: volumeChapters.at(-1)!.number,
          chapterCount: volumeChapters.length,
          writtenChapters: volumeChapters.filter((chapter) => chapter.currentVersionId).length,
          latestReportId: latestByVolume.get(volume.id) ?? null,
        };
      })
      .filter((volume): volume is VolumeAuditSummaryVolume => Boolean(volume))
      .sort((left, right) => left.chapterFrom - right.chapterFrom);
    const latestRecord = reports[0];
    const latestVolumeTitle = latestRecord
      ? nodes.find((node) => node.id === latestRecord.volumeNodeId)?.title
      : undefined;
    const signer = latestRecord?.signedOffBy
      ? await loadUser(transaction, latestRecord.signedOffBy)
      : null;
    return {
      workId: context.workId,
      branchId: context.branchId,
      goldenThreeLocked: await goldenThreeLocked(transaction, userId, context),
      volumes,
      latestReport: latestRecord ? toReport(latestRecord, latestVolumeTitle ?? "卷") : null,
      signoffUser: signer,
    };
  }
}

async function loadContext(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
): Promise<VolumeAuditWorkContext | undefined> {
  const [row] = await transaction
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
  return row;
}

async function loadNodes(
  transaction: DatabaseTransaction,
  userId: string,
  context: VolumeAuditWorkContext,
): Promise<OutlineNodeRecord[]> {
  return transaction
    .select()
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.userId, userId),
        eq(outlineNodes.workId, context.workId),
        eq(outlineNodes.branchId, context.branchId),
      ),
    )
    .orderBy(asc(outlineNodes.sortOrder), asc(outlineNodes.createdAt));
}

function descendantChapterNodes(
  nodes: OutlineNodeRecord[],
  volumeNodeId: string,
): OutlineNodeRecord[] {
  const children = new Map<string | null, OutlineNodeRecord[]>();
  for (const node of nodes) {
    const group = children.get(node.parentId) ?? [];
    group.push(node);
    children.set(node.parentId, group);
  }
  const result: OutlineNodeRecord[] = [];
  const queue = [volumeNodeId];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    for (const child of children.get(parentId) ?? []) {
      if (child.level === "chapter") {
        result.push(child);
      }
      queue.push(child.id);
    }
  }
  return result.sort((left, right) => left.sortOrder - right.sortOrder);
}

async function loadLedgerEntries(
  transaction: DatabaseTransaction,
  userId: string,
  context: VolumeAuditWorkContext,
  chapterRows: ChapterRecord[],
): Promise<VolumeAuditInput["ledgerEntries"]> {
  const chapterNumberById = new Map(chapterRows.map((chapter) => [chapter.id, chapter.number]));
  const [threads, shadows, arcs, events] = await Promise.all([
    transaction
      .select()
      .from(plotThreads)
      .where(
        and(
          eq(plotThreads.userId, userId),
          eq(plotThreads.workId, context.workId),
          eq(plotThreads.branchId, context.branchId),
          isNull(plotThreads.deletedAt),
        ),
      ),
    transaction
      .select()
      .from(foreshadows)
      .where(
        and(
          eq(foreshadows.userId, userId),
          eq(foreshadows.workId, context.workId),
          eq(foreshadows.branchId, context.branchId),
          isNull(foreshadows.deletedAt),
        ),
      ),
    transaction
      .select()
      .from(characterArcs)
      .where(
        and(
          eq(characterArcs.userId, userId),
          eq(characterArcs.workId, context.workId),
          eq(characterArcs.branchId, context.branchId),
          isNull(characterArcs.deletedAt),
        ),
      ),
    transaction
      .select()
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.userId, userId),
          eq(timelineEvents.workId, context.workId),
          eq(timelineEvents.branchId, context.branchId),
        ),
      ),
  ]);
  const eventById = new Map(events.map((event) => [event.id, event]));
  return [
    ...threads.map((entry) => ({
      id: entry.id,
      kind: "plot_thread" as const,
      title: entry.title,
      summary: entry.summary,
      status: entry.status as VolumeAuditInput["ledgerEntries"][number]["status"],
      importance: "must" as const,
      sourceChapterNumber: entry.sourceChapterId
        ? (chapterNumberById.get(entry.sourceChapterId) ?? null)
        : null,
      targetWindow: { fromChapter: entry.targetFromChapter, toChapter: entry.targetToChapter },
      history: entry.history.map((item) => ({
        action: item.action,
        chapterNumber: item.chapter?.number ?? null,
        eventId: item.event?.eventId ?? null,
        reason: item.reason,
        evidence: item.evidence.map((evidence) => ({ strength: evidence.strength })),
      })),
      prerequisiteEvents: entry.prerequisiteEventIds.map((eventId) => {
        const event = eventById.get(eventId);
        return {
          eventId,
          chapterNumber: null,
          validFromChapter: event?.validFromChapter ?? null,
          validToChapter: event?.validToChapter ?? null,
        };
      }),
    })),
    ...shadows.map((entry) => ({
      id: entry.id,
      kind: "foreshadow" as const,
      title: entry.title,
      summary: entry.summary,
      status: entry.status as VolumeAuditInput["ledgerEntries"][number]["status"],
      importance: entry.importance as "must" | "optional",
      sourceChapterNumber: entry.sourceChapterId
        ? (chapterNumberById.get(entry.sourceChapterId) ?? null)
        : null,
      targetWindow: { fromChapter: entry.targetFromChapter, toChapter: entry.targetToChapter },
      history: entry.history.map((item) => ({
        action: item.action,
        chapterNumber: item.chapter?.number ?? null,
        eventId: item.event?.eventId ?? null,
        reason: item.reason,
        evidence: item.evidence.map((evidence) => ({ strength: evidence.strength })),
      })),
      prerequisiteEvents: entry.prerequisiteEventIds.map((eventId) => {
        const event = eventById.get(eventId);
        return {
          eventId,
          chapterNumber: null,
          validFromChapter: event?.validFromChapter ?? null,
          validToChapter: event?.validToChapter ?? null,
        };
      }),
    })),
    ...arcs.map((entry) => ({
      id: entry.id,
      kind: "character_arc" as const,
      title: entry.title,
      summary: entry.summary,
      status: entry.status as VolumeAuditInput["ledgerEntries"][number]["status"],
      importance: "must" as const,
      sourceChapterNumber: entry.sourceChapterId
        ? (chapterNumberById.get(entry.sourceChapterId) ?? null)
        : null,
      targetWindow: { fromChapter: entry.targetFromChapter, toChapter: entry.targetToChapter },
      history: entry.history.map((item) => ({
        action: item.action,
        chapterNumber: item.chapter?.number ?? null,
        eventId: item.event?.eventId ?? null,
        reason: item.reason,
        evidence: item.evidence.map((evidence) => ({ strength: evidence.strength })),
      })),
      prerequisiteEvents: entry.prerequisiteEventIds.map((eventId) => {
        const event = eventById.get(eventId);
        return {
          eventId,
          chapterNumber: null,
          validFromChapter: event?.validFromChapter ?? null,
          validToChapter: event?.validToChapter ?? null,
        };
      }),
    })),
  ];
}

function toUpstreamFinding(record: QualityFindingRecord) {
  return {
    id: record.id,
    chapterId: record.chapterId,
    chapterVersionId: record.chapterVersionId,
    chapterNumber: 0,
    code: record.code as VolumeAuditInput["chapters"][number]["qualityFindings"][number]["code"],
    dimension: record.dimension as CriticFindingDimension,
    qualityDimension: record.qualityDimension as QualityDimension,
    severity: record.severity as CriticSeverity,
    structural: record.structural,
    evidence: record.evidence as unknown as CriticEvidence[],
    sourceRefs: record.sourceRefs as unknown as CriticSourceRef[],
    affectedObjects: record.affectedObjects as unknown as CriticAffectedObject[],
    recommendation: record.recommendation,
  };
}

function toPersistedFinding(
  finding: VolumeAuditFindingCandidate,
  context: VolumeAuditWorkContext,
  createdAt: string,
): VolumeAuditFinding {
  return {
    id: uuidv7(),
    workId: context.workId,
    branchId: context.branchId,
    chapterId: finding.chapterId,
    chapterVersionId: finding.chapterVersionId,
    chapterNumber: finding.chapterNumber,
    dimension: finding.dimension,
    qualityDimension: finding.qualityDimension,
    severity: finding.severity,
    structural: finding.structural,
    code: finding.code,
    evidence: finding.evidence,
    sourceRefs: finding.sourceRefs,
    affectedObjects: finding.affectedObjects,
    recommendation: finding.recommendation,
    upstreamFindingId: finding.upstreamFindingId,
    createdAt,
  };
}

function toReport(record: VolumeAuditReportRecord, volumeTitle: string): VolumeAuditReport {
  return {
    id: record.id,
    workId: record.workId,
    branchId: record.branchId,
    volumeNodeId: record.volumeNodeId,
    volumeTitle,
    chapterFrom: record.chapterFrom,
    chapterTo: record.chapterTo,
    ruleVersion: VOLUME_AUDIT_RULE_VERSION,
    sourceHash: record.sourceHash,
    status: record.status as VolumeAuditReport["status"],
    findings: record.findings.map((finding) => ({
      ...finding,
      workId: record.workId,
      branchId: record.branchId,
      dimension: finding.dimension as CriticFindingDimension,
      qualityDimension: finding.qualityDimension as QualityDimension,
      severity: finding.severity as CriticSeverity,
      code: finding.code as VolumeAuditFinding["code"],
      evidence: finding.evidence as unknown as CriticEvidence[],
      sourceRefs: finding.sourceRefs as unknown as CriticSourceRef[],
      affectedObjects: finding.affectedObjects as unknown as CriticAffectedObject[],
    })),
    coverage: record.coverage,
    summary: record.summary as VolumeAuditSummary,
    signoff:
      record.signoffDecision && record.signoffRationale && record.signedOffBy && record.signedOffAt
        ? {
            decision: record.signoffDecision as "accepted" | "changes_requested",
            rationale: record.signoffRationale,
            signedOffBy: record.signedOffBy,
            signedOffAt: record.signedOffAt.toISOString(),
          }
        : null,
    version: record.version,
    createdAt: record.createdAt.toISOString(),
  };
}

async function isReportStale(
  transaction: DatabaseTransaction,
  userId: string,
  context: VolumeAuditWorkContext,
  report: VolumeAuditReportRecord,
): Promise<boolean> {
  const chapterIds = report.coverage.map((coverage) => coverage.chapterId);
  if (chapterIds.length === 0) {
    return false;
  }
  const rows = await transaction
    .select({ id: chapters.id, currentVersionId: chapters.currentVersionId })
    .from(chapters)
    .where(
      and(
        eq(chapters.userId, userId),
        eq(chapters.workId, context.workId),
        eq(chapters.branchId, context.branchId),
        inArray(chapters.id, chapterIds),
      ),
    );
  const currentById = new Map(rows.map((row) => [row.id, row.currentVersionId]));
  return report.coverage.some(
    (coverage) => (currentById.get(coverage.chapterId) ?? null) !== coverage.chapterVersionId,
  );
}

async function goldenThreeLocked(
  transaction: DatabaseTransaction,
  userId: string,
  context: VolumeAuditWorkContext,
): Promise<boolean> {
  const [row] = await transaction
    .select({ id: goldenThreeLocks.id })
    .from(goldenThreeLocks)
    .where(
      and(
        eq(goldenThreeLocks.userId, userId),
        eq(goldenThreeLocks.workId, context.workId),
        eq(goldenThreeLocks.branchId, context.branchId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function loadUser(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<{ id: string; displayName: string } | null> {
  const [row] = await transaction
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

function readBriefString(value: unknown, key: string): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "";
  }
  const record = value as Record<string, unknown>;
  return typeof record[key] === "string" ? record[key] : "";
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
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
