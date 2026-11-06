import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapters,
  characterArcs,
  createDatabaseClient,
  createDatabasePool,
  entities,
  findIdempotentResource,
  foreshadows,
  plotThreads,
  rememberIdempotentResource,
  timelineEvents,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
  type StoryLedgerEvidenceJson,
  type StoryLedgerHistoryJson,
} from "@novel-brain/db";
import type {
  CharacterArc,
  DomainRef,
  Foreshadow,
  PlotThread,
  StoryLedgerChapterRef,
  StoryLedgerEntry,
  StoryLedgerEntryCreateRequest,
  StoryLedgerEntryPatchRequest,
  StoryLedgerEventRef,
  StoryLedgerEvidence,
  StoryLedgerLifecycleAction,
  StoryLedgerStatus,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

type PlotThreadRecord = InferSelectModel<typeof plotThreads>;
type ForeshadowRecord = InferSelectModel<typeof foreshadows>;
type CharacterArcRecord = InferSelectModel<typeof characterArcs>;
type ChapterRecord = InferSelectModel<typeof chapters>;
type EntityRecord = InferSelectModel<typeof entities>;
type TimelineEventRecord = InferSelectModel<typeof timelineEvents>;

export interface StoryLedgerWorkContext {
  workId: string;
  branchId: string;
}

export interface StoryLedgerAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type StoryLedgerMutationRecord = {
  entry: StoryLedgerEntry;
  versionNodeId: string;
  auditId: string;
};

export type StoryLedgerWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "source_required" }
  | { kind: "reference_invalid"; message: string }
  | { kind: "kind_mismatch" };

export interface StoryLedgerSnapshot {
  entries: StoryLedgerEntry[];
  writtenThroughChapter: number;
}

interface LedgerReferenceMaps {
  chapters: Map<string, ChapterRecord>;
  events: Map<string, { event: TimelineEventRecord; label: string }>;
  entities: Map<string, EntityRecord>;
}

interface LoadedLedger {
  entries: StoryLedgerEntry[];
  writtenThroughChapter: number;
}

@Injectable()
export class StoryLedgerRepository implements OnModuleDestroy {
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
  ): Promise<StoryLedgerWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
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
            eq(workBranches.status, "active"),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async snapshot(userId: string, context: StoryLedgerWorkContext): Promise<StoryLedgerSnapshot> {
    return this.withTenant(userId, (transaction) => this.loadLedger(transaction, userId, context));
  }

  async create(
    userId: string,
    context: StoryLedgerWorkContext,
    input: StoryLedgerEntryCreateRequest,
    idempotencyKey: string,
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerWriteResult<StoryLedgerMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const existing = await findIdempotentResource(
        transaction,
        userId,
        "story-ledger-create",
        idempotencyKey,
      );
      if (existing) {
        const ledger = await this.loadLedger(transaction, userId, context);
        const entry = ledger.entries.find((candidate) => candidate.id === existing.resourceId);
        if (entry) {
          const [node] = await transaction
            .select({ id: versionNodes.id })
            .from(versionNodes)
            .where(
              and(
                eq(versionNodes.objectId, entry.id),
                sql`${versionNodes.payload}->>'action' = 'ledger.entry_created'`,
              ),
            )
            .orderBy(asc(versionNodes.createdAt))
            .limit(1);
          const [auditRow] = await transaction
            .select({ id: auditLogs.id })
            .from(auditLogs)
            .where(
              and(eq(auditLogs.targetId, entry.id), eq(auditLogs.action, "ledger.entry_created")),
            )
            .orderBy(asc(auditLogs.createdAt))
            .limit(1);
          if (node && auditRow) {
            return {
              kind: "ok",
              value: { entry, versionNodeId: node.id, auditId: auditRow.id },
            };
          }
        }
      }
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      const maps = await loadReferenceMaps(transaction, userId, context, {
        chapterIds: compact([input.sourceChapterId]),
        eventIds: compact([input.sourceEventId, ...input.prerequisiteEventIds]),
        entityIds: kindEntityIds(input),
      });
      const referenceIssue = validateCreateReferences(input, maps);
      if (referenceIssue) {
        return referenceIssue;
      }
      const sourceChapter = input.sourceChapterId
        ? chapterRef(maps.chapters.get(input.sourceChapterId))
        : null;
      const sourceEvent = input.sourceEventId
        ? eventRef(maps.events.get(input.sourceEventId))
        : null;
      const evidence = input.evidence.map(toEvidenceJson);
      const history: StoryLedgerHistoryJson[] =
        input.status === "planted"
          ? [
              {
                id: uuidv7(),
                action: "setup",
                fromStatus: "planned",
                toStatus: "planted",
                chapter: sourceChapter,
                event: sourceEvent,
                reason: input.reason!.trim(),
                evidence,
                actorId: userId,
                createdAt: new Date().toISOString(),
              },
            ]
          : [];
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const now = new Date();
      const common = {
        id,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        title: input.title,
        summary: input.summary,
        status: input.status,
        responsibleRole: input.responsibleRole,
        sourceChapterId: input.sourceChapterId,
        sourceEventId: input.sourceEventId,
        targetFromChapter: input.targetWindow.fromChapter,
        targetToChapter: input.targetWindow.toChapter,
        prerequisiteEventIds: input.prerequisiteEventIds,
        evidence,
        history,
        version: 1,
        versionNodeId,
        createdAt: now,
        updatedAt: now,
      };
      await appendLedgerVersion(
        transaction,
        userId,
        context,
        parentNodeId,
        versionNodeId,
        input.kind,
        id,
        1,
        "ledger.entry_created",
        "创建剧情账本条目",
        now,
        { status: input.status, title: input.title },
      );
      switch (input.kind) {
        case "plot_thread":
          await transaction.insert(plotThreads).values({
            ...common,
            threadType: input.threadType,
            stakes: input.stakes,
            tension: input.tension,
          });
          break;
        case "foreshadow":
          await transaction.insert(foreshadows).values({
            ...common,
            importance: input.importance,
            readerPromise: input.readerPromise,
            relatedCharacterIds: input.relatedCharacterIds,
            relatedFactionIds: input.relatedFactionIds,
          });
          break;
        case "character_arc":
          await transaction.insert(characterArcs).values({
            ...common,
            characterId: input.characterId,
            startState: input.startState,
            desire: input.desire,
            fear: input.fear,
            lie: input.lie,
            truth: input.truth,
            endState: input.endState,
          });
          break;
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "ledger.entry_created",
        input.kind,
        id,
      );
      const entry = await this.findEntryInTransaction(transaction, userId, context, input.kind, id);
      if (!entry) {
        throw new Error("Created ledger entry could not be read");
      }
      await rememberIdempotentResource(transaction, userId, "story-ledger-create", idempotencyKey, {
        resourceType: "story_ledger_entry",
        resourceId: entry.id,
      });
      return { kind: "ok", value: { entry, versionNodeId, auditId } };
    });
  }

  async patch(
    userId: string,
    context: StoryLedgerWorkContext,
    entryId: string,
    input: StoryLedgerEntryPatchRequest,
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerWriteResult<StoryLedgerMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const loaded = await findStoredEntry(transaction, userId, context, entryId, true);
      if (!loaded) {
        return { kind: "not_found" };
      }
      if (loaded.kind !== input.kind) {
        return { kind: "kind_mismatch" };
      }
      if (loaded.row.version !== input.version) {
        return { kind: "version_conflict" };
      }
      const nextSourceChapterId =
        input.sourceChapterId === undefined ? loaded.row.sourceChapterId : input.sourceChapterId;
      const nextSourceEventId =
        input.sourceEventId === undefined ? loaded.row.sourceEventId : input.sourceEventId;
      if (
        needsSource(loaded.row.status as StoryLedgerStatus) &&
        !nextSourceChapterId &&
        !nextSourceEventId
      ) {
        return { kind: "source_required" };
      }
      const nextPrerequisiteEventIds =
        input.prerequisiteEventIds === undefined
          ? loaded.row.prerequisiteEventIds
          : input.prerequisiteEventIds;
      const maps = await loadReferenceMaps(transaction, userId, context, {
        chapterIds: compact([nextSourceChapterId]),
        eventIds: compact([nextSourceEventId, ...nextPrerequisiteEventIds]),
        entityIds: patchEntityIds(input, loaded),
      });
      const referenceIssue = validatePatchReferences(
        input,
        nextSourceChapterId,
        nextSourceEventId,
        nextPrerequisiteEventIds,
        loaded,
        maps,
      );
      if (referenceIssue) {
        return referenceIssue;
      }
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      const now = new Date();
      const base = {
        title: input.title ?? loaded.row.title,
        summary: input.summary ?? loaded.row.summary,
        responsibleRole: input.responsibleRole ?? loaded.row.responsibleRole,
        sourceChapterId: nextSourceChapterId,
        sourceEventId: nextSourceEventId,
        targetFromChapter: input.targetWindow?.fromChapter ?? loaded.row.targetFromChapter,
        targetToChapter: input.targetWindow?.toChapter ?? loaded.row.targetToChapter,
        prerequisiteEventIds: nextPrerequisiteEventIds,
        evidence:
          input.evidence === undefined ? loaded.row.evidence : input.evidence.map(toEvidenceJson),
        version: loaded.row.version + 1,
        versionNodeId,
        updatedAt: now,
      };
      await appendLedgerVersion(
        transaction,
        userId,
        context,
        parentNodeId,
        versionNodeId,
        input.kind,
        entryId,
        loaded.row.version + 1,
        "ledger.entry_updated",
        "更新剧情账本条目",
        now,
        { status: loaded.row.status },
      );
      switch (input.kind) {
        case "plot_thread": {
          const row = loaded.row as PlotThreadRecord;
          await transaction
            .update(plotThreads)
            .set({
              ...base,
              threadType: input.threadType ?? row.threadType,
              stakes: input.stakes ?? row.stakes,
              tension: input.tension === undefined ? row.tension : input.tension,
            })
            .where(and(eq(plotThreads.id, entryId), eq(plotThreads.version, row.version)));
          break;
        }
        case "foreshadow": {
          const row = loaded.row as ForeshadowRecord;
          await transaction
            .update(foreshadows)
            .set({
              ...base,
              importance: input.importance ?? row.importance,
              readerPromise: input.readerPromise ?? row.readerPromise,
              relatedCharacterIds: input.relatedCharacterIds ?? row.relatedCharacterIds,
              relatedFactionIds: input.relatedFactionIds ?? row.relatedFactionIds,
            })
            .where(and(eq(foreshadows.id, entryId), eq(foreshadows.version, row.version)));
          break;
        }
        case "character_arc": {
          const row = loaded.row as CharacterArcRecord;
          await transaction
            .update(characterArcs)
            .set({
              ...base,
              characterId: input.characterId ?? row.characterId,
              startState: input.startState ?? row.startState,
              desire: input.desire ?? row.desire,
              fear: input.fear ?? row.fear,
              lie: input.lie ?? row.lie,
              truth: input.truth ?? row.truth,
              endState: input.endState ?? row.endState,
            })
            .where(and(eq(characterArcs.id, entryId), eq(characterArcs.version, row.version)));
          break;
        }
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "ledger.entry_updated",
        input.kind,
        entryId,
      );
      const entry = await this.findEntryInTransaction(
        transaction,
        userId,
        context,
        input.kind,
        entryId,
      );
      if (!entry) {
        throw new Error("Updated ledger entry could not be read");
      }
      return { kind: "ok", value: { entry, versionNodeId, auditId } };
    });
  }

  async transition(
    userId: string,
    context: StoryLedgerWorkContext,
    entryId: string,
    input: {
      version: number;
      action: StoryLedgerLifecycleAction;
      nextStatus: StoryLedgerStatus;
      chapterId: string | null;
      eventId: string | null;
      reason: string;
      evidence: StoryLedgerEvidence[];
      targetWindow?: { fromChapter: number; toChapter: number } | undefined;
    },
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerWriteResult<StoryLedgerMutationRecord>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const loaded = await findStoredEntry(transaction, userId, context, entryId, true);
      if (!loaded) {
        return { kind: "not_found" };
      }
      if (loaded.row.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (
        input.action !== "defer" &&
        !input.chapterId &&
        !input.eventId &&
        !loaded.row.sourceChapterId &&
        !loaded.row.sourceEventId
      ) {
        return { kind: "source_required" };
      }
      const maps = await loadReferenceMaps(transaction, userId, context, {
        chapterIds: compact([input.chapterId]),
        eventIds: compact([input.eventId]),
        entityIds: [],
      });
      if (input.chapterId && !maps.chapters.has(input.chapterId)) {
        return { kind: "reference_invalid", message: "来源章节不存在或不属于当前创作线" };
      }
      if (input.eventId && !maps.events.has(input.eventId)) {
        return { kind: "reference_invalid", message: "来源事件不存在或不属于当前创作线" };
      }
      const chapter = input.chapterId
        ? chapterRef(maps.chapters.get(input.chapterId))
        : loaded.entry.sourceChapter;
      const event = input.eventId
        ? eventRef(maps.events.get(input.eventId))
        : loaded.entry.sourceEvent;
      const newEvidence = input.evidence.map(toEvidenceJson);
      const historyEntry: StoryLedgerHistoryJson = {
        id: uuidv7(),
        action: input.action,
        fromStatus: loaded.row.status,
        toStatus: input.nextStatus,
        chapter: input.chapterId ? chapter : null,
        event: input.eventId ? event : null,
        reason: input.reason,
        evidence: newEvidence,
        actorId: userId,
        createdAt: new Date().toISOString(),
      };
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      const now = new Date();
      const evidence =
        newEvidence.length > 0 ? [...loaded.row.evidence, ...newEvidence] : loaded.row.evidence;
      const history = [...loaded.row.history, historyEntry];
      const sourceChapterId = input.chapterId ?? loaded.row.sourceChapterId;
      const sourceEventId = input.eventId ?? loaded.row.sourceEventId;
      const targetFromChapter = input.targetWindow?.fromChapter ?? loaded.row.targetFromChapter;
      const targetToChapter = input.targetWindow?.toChapter ?? loaded.row.targetToChapter;
      const version = loaded.row.version + 1;
      const auditAction = `ledger.${input.action}`;
      await appendLedgerVersion(
        transaction,
        userId,
        context,
        parentNodeId,
        versionNodeId,
        loaded.kind,
        entryId,
        version,
        auditAction,
        lifecycleMessage(input.action),
        now,
        {
          fromStatus: loaded.row.status,
          toStatus: input.nextStatus,
          reason: input.reason,
        },
      );
      switch (loaded.kind) {
        case "plot_thread":
          await transaction
            .update(plotThreads)
            .set({
              status: input.nextStatus,
              sourceChapterId,
              sourceEventId,
              targetFromChapter,
              targetToChapter,
              evidence,
              history,
              version,
              versionNodeId,
              updatedAt: now,
            })
            .where(and(eq(plotThreads.id, entryId), eq(plotThreads.version, loaded.row.version)));
          break;
        case "foreshadow":
          await transaction
            .update(foreshadows)
            .set({
              status: input.nextStatus,
              sourceChapterId,
              sourceEventId,
              targetFromChapter,
              targetToChapter,
              evidence,
              history,
              version,
              versionNodeId,
              updatedAt: now,
            })
            .where(and(eq(foreshadows.id, entryId), eq(foreshadows.version, loaded.row.version)));
          break;
        case "character_arc":
          await transaction
            .update(characterArcs)
            .set({
              status: input.nextStatus,
              sourceChapterId,
              sourceEventId,
              targetFromChapter,
              targetToChapter,
              evidence,
              history,
              version,
              versionNodeId,
              updatedAt: now,
            })
            .where(
              and(eq(characterArcs.id, entryId), eq(characterArcs.version, loaded.row.version)),
            );
          break;
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        auditAction,
        loaded.kind,
        entryId,
      );
      const entry = await this.findEntryInTransaction(
        transaction,
        userId,
        context,
        loaded.kind,
        entryId,
      );
      if (!entry) {
        throw new Error("Transitioned ledger entry could not be read");
      }
      return { kind: "ok", value: { entry, versionNodeId, auditId } };
    });
  }

  async remove(
    userId: string,
    context: StoryLedgerWorkContext,
    entryId: string,
    version: number,
    reason: string,
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerWriteResult<{ entryId: string; versionNodeId: string; auditId: string }>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const loaded = await findStoredEntry(transaction, userId, context, entryId, true);
      if (!loaded) {
        return { kind: "not_found" };
      }
      if (loaded.row.version !== version) {
        return { kind: "version_conflict" };
      }
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      const now = new Date();
      const nextVersion = version + 1;
      await appendLedgerVersion(
        transaction,
        userId,
        context,
        parentNodeId,
        versionNodeId,
        loaded.kind,
        entryId,
        nextVersion,
        "ledger.entry_deleted",
        "移除剧情账本条目",
        now,
        { reason },
      );
      switch (loaded.kind) {
        case "plot_thread":
          await transaction
            .update(plotThreads)
            .set({ deletedAt: now, version: nextVersion, versionNodeId, updatedAt: now })
            .where(and(eq(plotThreads.id, entryId), eq(plotThreads.version, version)));
          break;
        case "foreshadow":
          await transaction
            .update(foreshadows)
            .set({ deletedAt: now, version: nextVersion, versionNodeId, updatedAt: now })
            .where(and(eq(foreshadows.id, entryId), eq(foreshadows.version, version)));
          break;
        case "character_arc":
          await transaction
            .update(characterArcs)
            .set({ deletedAt: now, version: nextVersion, versionNodeId, updatedAt: now })
            .where(and(eq(characterArcs.id, entryId), eq(characterArcs.version, version)));
          break;
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      const auditId = await writeAudit(
        transaction,
        userId,
        audit,
        "ledger.entry_deleted",
        loaded.kind,
        entryId,
      );
      return { kind: "ok", value: { entryId, versionNodeId, auditId } };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async findEntryInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: StoryLedgerWorkContext,
    kind: StoryLedgerEntry["kind"],
    entryId: string,
  ): Promise<StoryLedgerEntry | undefined> {
    const snapshot = await this.loadLedger(transaction, userId, context);
    return snapshot.entries.find((entry) => entry.kind === kind && entry.id === entryId);
  }

  private async loadLedger(
    transaction: DatabaseTransaction,
    userId: string,
    context: StoryLedgerWorkContext,
  ): Promise<LoadedLedger> {
    const threadRows = await transaction
      .select()
      .from(plotThreads)
      .where(
        and(
          eq(plotThreads.userId, userId),
          eq(plotThreads.workId, context.workId),
          eq(plotThreads.branchId, context.branchId),
          sql`${plotThreads.deletedAt} is null`,
        ),
      )
      .orderBy(asc(plotThreads.createdAt));
    const foreshadowRows = await transaction
      .select()
      .from(foreshadows)
      .where(
        and(
          eq(foreshadows.userId, userId),
          eq(foreshadows.workId, context.workId),
          eq(foreshadows.branchId, context.branchId),
          sql`${foreshadows.deletedAt} is null`,
        ),
      )
      .orderBy(asc(foreshadows.createdAt));
    const arcRows = await transaction
      .select()
      .from(characterArcs)
      .where(
        and(
          eq(characterArcs.userId, userId),
          eq(characterArcs.workId, context.workId),
          eq(characterArcs.branchId, context.branchId),
          sql`${characterArcs.deletedAt} is null`,
        ),
      )
      .orderBy(asc(characterArcs.createdAt));
    const writtenThroughChapter = await writtenThrough(transaction, userId, context);
    const rows = [
      ...threadRows.map((row) => ({ kind: "plot_thread" as const, row })),
      ...foreshadowRows.map((row) => ({ kind: "foreshadow" as const, row })),
      ...arcRows.map((row) => ({ kind: "character_arc" as const, row })),
    ].sort((left, right) => left.row.createdAt.getTime() - right.row.createdAt.getTime());
    const chapterIds = rows.flatMap(({ row }) => compact([row.sourceChapterId]));
    const eventIds = rows.flatMap(({ row }) => [
      ...compact([row.sourceEventId]),
      ...row.prerequisiteEventIds,
    ]);
    const entityIds = rows.flatMap(({ kind, row }) => {
      if (kind === "foreshadow") {
        const foreshadow = row as ForeshadowRecord;
        return [...foreshadow.relatedCharacterIds, ...foreshadow.relatedFactionIds];
      }
      if (kind === "character_arc") {
        return [(row as CharacterArcRecord).characterId];
      }
      return [];
    });
    const maps = await loadReferenceMaps(transaction, userId, context, {
      chapterIds,
      eventIds,
      entityIds,
    });
    const entries = rows.map(({ kind, row }) => {
      if (kind === "plot_thread") {
        return toPlotThread(row as PlotThreadRecord, maps);
      }
      if (kind === "foreshadow") {
        return toForeshadow(row as ForeshadowRecord, maps);
      }
      return toCharacterArc(row as CharacterArcRecord, maps);
    });
    return { entries, writtenThroughChapter };
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

async function findStoredEntry(
  transaction: DatabaseTransaction,
  userId: string,
  context: StoryLedgerWorkContext,
  entryId: string,
  forUpdate: boolean,
): Promise<
  | {
      kind: "plot_thread";
      row: PlotThreadRecord;
      entry: StoryLedgerEntry;
    }
  | {
      kind: "foreshadow";
      row: ForeshadowRecord;
      entry: StoryLedgerEntry;
    }
  | {
      kind: "character_arc";
      row: CharacterArcRecord;
      entry: StoryLedgerEntry;
    }
  | undefined
> {
  const threadQuery = transaction
    .select()
    .from(plotThreads)
    .where(
      and(
        eq(plotThreads.id, entryId),
        eq(plotThreads.userId, userId),
        eq(plotThreads.workId, context.workId),
        eq(plotThreads.branchId, context.branchId),
        sql`${plotThreads.deletedAt} is null`,
      ),
    )
    .limit(1);
  const foreshadowQuery = transaction
    .select()
    .from(foreshadows)
    .where(
      and(
        eq(foreshadows.id, entryId),
        eq(foreshadows.userId, userId),
        eq(foreshadows.workId, context.workId),
        eq(foreshadows.branchId, context.branchId),
        sql`${foreshadows.deletedAt} is null`,
      ),
    )
    .limit(1);
  const arcQuery = transaction
    .select()
    .from(characterArcs)
    .where(
      and(
        eq(characterArcs.id, entryId),
        eq(characterArcs.userId, userId),
        eq(characterArcs.workId, context.workId),
        eq(characterArcs.branchId, context.branchId),
        sql`${characterArcs.deletedAt} is null`,
      ),
    )
    .limit(1);
  const [thread] = await (forUpdate ? threadQuery.for("update") : threadQuery);
  const [foreshadow] = await (forUpdate ? foreshadowQuery.for("update") : foreshadowQuery);
  const [arc] = await (forUpdate ? arcQuery.for("update") : arcQuery);
  if (thread) {
    const maps = await loadReferenceMaps(transaction, userId, context, {
      chapterIds: compact([thread.sourceChapterId]),
      eventIds: compact([thread.sourceEventId, ...thread.prerequisiteEventIds]),
      entityIds: [],
    });
    return { kind: "plot_thread", row: thread, entry: toPlotThread(thread, maps) };
  }
  if (foreshadow) {
    const maps = await loadReferenceMaps(transaction, userId, context, {
      chapterIds: compact([foreshadow.sourceChapterId]),
      eventIds: compact([foreshadow.sourceEventId, ...foreshadow.prerequisiteEventIds]),
      entityIds: [...foreshadow.relatedCharacterIds, ...foreshadow.relatedFactionIds],
    });
    return { kind: "foreshadow", row: foreshadow, entry: toForeshadow(foreshadow, maps) };
  }
  if (arc) {
    const maps = await loadReferenceMaps(transaction, userId, context, {
      chapterIds: compact([arc.sourceChapterId]),
      eventIds: compact([arc.sourceEventId, ...arc.prerequisiteEventIds]),
      entityIds: [arc.characterId],
    });
    return { kind: "character_arc", row: arc, entry: toCharacterArc(arc, maps) };
  }
  return undefined;
}

async function loadReferenceMaps(
  transaction: DatabaseTransaction,
  userId: string,
  context: StoryLedgerWorkContext,
  ids: { chapterIds: string[]; eventIds: string[]; entityIds: string[] },
): Promise<LedgerReferenceMaps> {
  const chapterIds = unique(ids.chapterIds);
  const eventIds = unique(ids.eventIds);
  const entityIds = unique(ids.entityIds);
  const chapterRows =
    chapterIds.length === 0
      ? []
      : await transaction
          .select()
          .from(chapters)
          .where(
            and(
              inArray(chapters.id, chapterIds),
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
            ),
          );
  const eventRows =
    eventIds.length === 0
      ? []
      : await transaction
          .select({ event: timelineEvents, label: entities.name })
          .from(timelineEvents)
          .innerJoin(entities, eq(entities.id, timelineEvents.id))
          .where(
            and(
              inArray(timelineEvents.id, eventIds),
              eq(timelineEvents.userId, userId),
              eq(timelineEvents.workId, context.workId),
              eq(timelineEvents.branchId, context.branchId),
            ),
          );
  const entityRows =
    entityIds.length === 0
      ? []
      : await transaction
          .select()
          .from(entities)
          .where(
            and(
              inArray(entities.id, entityIds),
              eq(entities.userId, userId),
              eq(entities.workId, context.workId),
              eq(entities.branchId, context.branchId),
              sql`${entities.deletedAt} is null`,
            ),
          );
  return {
    chapters: new Map(chapterRows.map((row) => [row.id, row])),
    events: new Map(eventRows.map((row) => [row.event.id, row])),
    entities: new Map(entityRows.map((row) => [row.id, row])),
  };
}

function validateCreateReferences(
  input: StoryLedgerEntryCreateRequest,
  maps: LedgerReferenceMaps,
): { kind: "source_required" } | { kind: "reference_invalid"; message: string } | null {
  if (needsSource(input.status) && !input.sourceChapterId && !input.sourceEventId) {
    return { kind: "source_required" };
  }
  if (input.sourceChapterId && !maps.chapters.has(input.sourceChapterId)) {
    return { kind: "reference_invalid", message: "来源章节不存在或不属于当前创作线" };
  }
  if (input.sourceEventId && !maps.events.has(input.sourceEventId)) {
    return { kind: "reference_invalid", message: "来源事件不存在或不属于当前创作线" };
  }
  if (input.prerequisiteEventIds.some((id) => !maps.events.has(id))) {
    return { kind: "reference_invalid", message: "前置事件不存在或不属于当前创作线" };
  }
  if (input.kind === "foreshadow") {
    const characterIssue = validateEntityTypes(
      input.relatedCharacterIds,
      "character",
      maps,
      "关联人物",
    );
    if (characterIssue) {
      return characterIssue;
    }
    return validateEntityTypes(input.relatedFactionIds, "faction", maps, "关联势力");
  }
  if (input.kind === "character_arc") {
    return validateEntityTypes([input.characterId], "character", maps, "人物弧主角");
  }
  return null;
}

function validatePatchReferences(
  input: StoryLedgerEntryPatchRequest,
  sourceChapterId: string | null,
  sourceEventId: string | null,
  prerequisiteEventIds: string[],
  loaded: {
    kind: StoryLedgerEntry["kind"];
    row: PlotThreadRecord | ForeshadowRecord | CharacterArcRecord;
  },
  maps: LedgerReferenceMaps,
): { kind: "source_required" } | { kind: "reference_invalid"; message: string } | null {
  if (needsSource(loaded.row.status as StoryLedgerStatus) && !sourceChapterId && !sourceEventId) {
    return { kind: "source_required" };
  }
  if (sourceChapterId && !maps.chapters.has(sourceChapterId)) {
    return { kind: "reference_invalid", message: "来源章节不存在或不属于当前创作线" };
  }
  if (sourceEventId && !maps.events.has(sourceEventId)) {
    return { kind: "reference_invalid", message: "来源事件不存在或不属于当前创作线" };
  }
  if (prerequisiteEventIds.some((id) => !maps.events.has(id))) {
    return { kind: "reference_invalid", message: "前置事件不存在或不属于当前创作线" };
  }
  if (input.kind === "foreshadow") {
    const characterIds =
      input.relatedCharacterIds ??
      (loaded.kind === "foreshadow" ? (loaded.row as ForeshadowRecord).relatedCharacterIds : []);
    const factionIds =
      input.relatedFactionIds ??
      (loaded.kind === "foreshadow" ? (loaded.row as ForeshadowRecord).relatedFactionIds : []);
    const characterIssue = validateEntityTypes(characterIds, "character", maps, "关联人物");
    if (characterIssue) {
      return characterIssue;
    }
    return validateEntityTypes(factionIds, "faction", maps, "关联势力");
  }
  if (input.kind === "character_arc") {
    const characterId =
      input.characterId ??
      (loaded.kind === "character_arc" ? (loaded.row as CharacterArcRecord).characterId : null);
    if (characterId) {
      return validateEntityTypes([characterId], "character", maps, "人物弧主角");
    }
  }
  return null;
}

function validateEntityTypes(
  ids: string[],
  type: string,
  maps: LedgerReferenceMaps,
  label: string,
): { kind: "reference_invalid"; message: string } | null {
  if (ids.some((id) => maps.entities.get(id)?.type !== type)) {
    return { kind: "reference_invalid", message: `${label}引用不存在或类型不正确` };
  }
  return null;
}

function toPlotThread(row: PlotThreadRecord, maps: LedgerReferenceMaps): PlotThread {
  return {
    ...baseEntry(row, maps),
    kind: "plot_thread",
    threadType: row.threadType as PlotThread["threadType"],
    stakes: row.stakes,
    tension: row.tension,
  };
}

function toForeshadow(row: ForeshadowRecord, maps: LedgerReferenceMaps): Foreshadow {
  return {
    ...baseEntry(row, maps),
    kind: "foreshadow",
    importance: row.importance as Foreshadow["importance"],
    readerPromise: row.readerPromise,
    relatedCharacters: row.relatedCharacterIds
      .filter((id) => maps.entities.get(id)?.type === "character")
      .map((id) => entityRef(id, maps, row.branchId)),
    relatedFactions: row.relatedFactionIds
      .filter((id) => maps.entities.get(id)?.type === "faction")
      .map((id) => entityRef(id, maps, row.branchId)),
  };
}

function toCharacterArc(row: CharacterArcRecord, maps: LedgerReferenceMaps): CharacterArc {
  return {
    ...baseEntry(row, maps),
    kind: "character_arc",
    character: entityRef(row.characterId, maps, row.branchId),
    startState: row.startState,
    desire: row.desire,
    fear: row.fear,
    lie: row.lie,
    truth: row.truth,
    endState: row.endState,
  };
}

function baseEntry(
  row: PlotThreadRecord | ForeshadowRecord | CharacterArcRecord,
  maps: LedgerReferenceMaps,
) {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    title: row.title,
    summary: row.summary,
    status: row.status as StoryLedgerStatus,
    responsibleRole: row.responsibleRole as StoryLedgerEntry["responsibleRole"],
    sourceChapter: row.sourceChapterId ? chapterRef(maps.chapters.get(row.sourceChapterId)) : null,
    sourceEvent: row.sourceEventId ? eventRef(maps.events.get(row.sourceEventId)) : null,
    targetWindow: {
      fromChapter: row.targetFromChapter,
      toChapter: row.targetToChapter,
    },
    prerequisiteEvents: row.prerequisiteEventIds
      .map((id) => eventRef(maps.events.get(id)))
      .filter((ref): ref is StoryLedgerEventRef => ref !== null),
    evidence: row.evidence as StoryLedgerEvidence[],
    history: row.history as StoryLedgerEntry["history"],
    version: row.version,
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function chapterRef(chapter: ChapterRecord | undefined): StoryLedgerChapterRef | null {
  if (!chapter) {
    return null;
  }
  return { id: chapter.id, number: chapter.number, title: chapter.title };
}

function eventRef(
  value: { event: TimelineEventRecord; label: string } | undefined,
): StoryLedgerEventRef | null {
  if (!value) {
    return null;
  }
  return {
    eventId: value.event.id,
    label: value.label,
    chapterNumber: value.event.validFromChapter,
    validFromChapter: value.event.validFromChapter,
    validToChapter: value.event.validToChapter,
  };
}

function entityRef(id: string, maps: LedgerReferenceMaps, fallbackBranchId: string): DomainRef {
  const entity = maps.entities.get(id);
  return {
    type: (entity?.type ?? "character") as DomainRef["type"],
    id,
    branchId: entity?.branchId ?? fallbackBranchId,
    label: entity?.name ?? "",
    version: null,
  };
}

function toEvidenceJson(evidence: StoryLedgerEvidence): StoryLedgerEvidenceJson {
  return {
    kind: evidence.kind,
    sourceId: evidence.sourceId,
    label: evidence.label,
    quote: evidence.quote,
    locator: evidence.locator,
    confidence: evidence.confidence,
    strength: evidence.strength,
  };
}

function kindEntityIds(input: StoryLedgerEntryCreateRequest): string[] {
  if (input.kind === "foreshadow") {
    return [...input.relatedCharacterIds, ...input.relatedFactionIds];
  }
  if (input.kind === "character_arc") {
    return [input.characterId];
  }
  return [];
}

function patchEntityIds(
  input: StoryLedgerEntryPatchRequest,
  loaded: {
    kind: StoryLedgerEntry["kind"];
    row: PlotThreadRecord | ForeshadowRecord | CharacterArcRecord;
  },
): string[] {
  if (input.kind === "foreshadow") {
    const row = loaded.kind === "foreshadow" ? (loaded.row as ForeshadowRecord) : null;
    return [
      ...(input.relatedCharacterIds ?? row?.relatedCharacterIds ?? []),
      ...(input.relatedFactionIds ?? row?.relatedFactionIds ?? []),
    ];
  }
  if (input.kind === "character_arc") {
    const fallback =
      loaded.kind === "character_arc" ? (loaded.row as CharacterArcRecord).characterId : null;
    return compact([input.characterId ?? fallback]);
  }
  return [];
}

async function writtenThrough(
  transaction: DatabaseTransaction,
  userId: string,
  context: StoryLedgerWorkContext,
): Promise<number> {
  const [row] = await transaction
    .select({ max: sql<number | null>`max(${chapters.number})` })
    .from(chapters)
    .where(
      and(
        eq(chapters.userId, userId),
        eq(chapters.workId, context.workId),
        eq(chapters.branchId, context.branchId),
        or(
          gt(chapters.wordCount, 0),
          inArray(chapters.status, [
            "writing",
            "waiting_review",
            "changes_requested",
            "approved",
            "locked",
            "published",
          ]),
        ),
      ),
    );
  return Number(row?.max ?? 0);
}

async function appendLedgerVersion(
  transaction: DatabaseTransaction,
  userId: string,
  context: StoryLedgerWorkContext,
  parentNodeId: string,
  versionNodeId: string,
  objectType: StoryLedgerEntry["kind"],
  objectId: string,
  objectVersion: number,
  action: string,
  message: string,
  now: Date,
  payload: Record<string, unknown>,
): Promise<void> {
  await transaction.insert(versionNodes).values({
    id: versionNodeId,
    workId: context.workId,
    branchId: context.branchId,
    userId,
    parentNodeId,
    nodeType: "ledger_version",
    objectType,
    objectId,
    objectVersion,
    payload: { action, ...payload },
    actorId: userId,
    message,
    createdAt: now,
  });
}

async function advanceBranchHead(
  transaction: DatabaseTransaction,
  context: StoryLedgerWorkContext,
  versionNodeId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: StoryLedgerWorkContext,
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
    throw new Error("Ledger branch is missing its version head");
  }
  return branch.headNodeId;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: StoryLedgerAuditContext,
  action: string,
  targetType: string,
  targetId: string,
): Promise<string> {
  const id = uuidv7();
  await transaction.insert(auditLogs).values({
    id,
    actorId: userId,
    action,
    targetType,
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
  return id;
}

function lifecycleMessage(action: StoryLedgerLifecycleAction): string {
  switch (action) {
    case "setup":
      return "埋设剧情账本条目";
    case "progress":
      return "推进剧情账本条目";
    case "payoff":
      return "回收剧情账本条目";
    case "fail_payoff":
      return "标记失败回收";
    case "abandon":
      return "放弃剧情账本条目";
    case "defer":
      return "延期剧情账本条目";
  }
}

function needsSource(status: StoryLedgerStatus): boolean {
  return ["planted", "progressed", "paid_off", "failed_payoff", "abandoned"].includes(status);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
