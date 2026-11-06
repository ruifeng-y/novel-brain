import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  SummaryLevel,
  SummaryRebuildJob,
  SummaryRecord,
  SummarySourceRange,
} from "@novel-brain/contracts";
import {
  auditLogs,
  canonCommits,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  facts,
  outlineNodes,
  summaryRebuildItems,
  summaryRebuildRuns,
  summaryRecords,
  toSummaryRecordContract,
  volumeContracts,
  works,
  type DatabaseClient,
  type SummaryRebuildRunRow,
  type SummaryRecordRow,
} from "@novel-brain/db";
import {
  buildSummaryProjection,
  type SummaryProjection,
  type SummarySourceRange as CoreSummarySourceRange,
} from "@novel-brain/core";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type OutlineNodeRecord = InferSelectModel<typeof outlineNodes>;
type SummaryRebuildItemRecord = InferSelectModel<typeof summaryRebuildItems>;

export interface ClaimedSummaryItem {
  item: SummaryRebuildItemRecord;
  run: SummaryRebuildRunRow;
}

@Injectable()
export class WorkerSummaryRepository implements OnModuleDestroy {
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

  async withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(
           hashtext('novelbrain:summary-rebuild'),
           hashtext($1::text)
         ) AS locked`,
        [runId],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) {
        return undefined;
      }
      return await operation();
    } finally {
      let unlockFailed = false;
      if (locked) {
        await client
          .query(
            `SELECT pg_advisory_unlock(
               hashtext('novelbrain:summary-rebuild'),
               hashtext($1::text)
             )`,
            [runId],
          )
          .catch(() => {
            unlockFailed = true;
          });
      }
      client.release(unlockFailed);
    }
  }

  async loadRun(job: SummaryRebuildJob): Promise<SummaryRebuildRunRow | undefined> {
    return this.withTenant(job.actorId, async (transaction) => {
      const [run] = await transaction
        .select({ run: summaryRebuildRuns })
        .from(summaryRebuildRuns)
        .innerJoin(
          works,
          and(eq(works.id, summaryRebuildRuns.workId), eq(works.userId, job.actorId)),
        )
        .where(
          and(
            eq(summaryRebuildRuns.id, job.runId),
            eq(summaryRebuildRuns.userId, job.actorId),
            eq(summaryRebuildRuns.workId, job.workId),
            eq(summaryRebuildRuns.branchId, job.branchId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return run?.run;
    });
  }

  async ensurePlan(run: SummaryRebuildRunRow): Promise<SummaryRebuildItemRecord[]> {
    return this.withTenant(run.userId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`summary-rebuild-plan:${run.id}`}))`,
      );
      const existing = await transaction
        .select()
        .from(summaryRebuildItems)
        .where(eq(summaryRebuildItems.runId, run.id))
        .orderBy(asc(summaryRebuildItems.ordinal));
      if (existing.length > 0) {
        return existing;
      }
      const nodes = await transaction
        .select()
        .from(outlineNodes)
        .where(
          and(
            eq(outlineNodes.userId, run.userId),
            eq(outlineNodes.workId, run.workId),
            eq(outlineNodes.branchId, run.branchId),
          ),
        )
        .orderBy(asc(outlineNodes.createdAt));
      const requested = new Set(run.levels as SummaryLevel[]);
      const planned = nodes
        .flatMap((node) => {
          const level = summaryLevel(node.level);
          return level && requested.has(level) ? [{ node, level }] : [];
        })
        .sort(
          (left, right) =>
            summaryLevelRank(left.level) - summaryLevelRank(right.level) ||
            left.node.createdAt.getTime() - right.node.createdAt.getTime() ||
            left.node.id.localeCompare(right.node.id),
        );
      if (planned.length === 0) {
        await transaction
          .update(summaryRebuildRuns)
          .set({
            status: "completed",
            totalItems: 0,
            checkpointRevision: 0,
            updatedAt: new Date(),
            finishedAt: new Date(),
          })
          .where(eq(summaryRebuildRuns.id, run.id));
        return [];
      }
      const created = await transaction
        .insert(summaryRebuildItems)
        .values(
          planned.map(({ node, level }, ordinal) => ({
            id: uuidv7(),
            runId: run.id,
            workId: run.workId,
            branchId: run.branchId,
            userId: run.userId,
            ordinal,
            level,
            scopeId: node.id,
          })),
        )
        .returning();
      await transaction
        .update(summaryRebuildRuns)
        .set({
          totalItems: created.length,
          updatedAt: new Date(),
        })
        .where(eq(summaryRebuildRuns.id, run.id));
      return created.sort((left, right) => left.ordinal - right.ordinal);
    });
  }

  async claimNextItem(runId: string, userId: string): Promise<ClaimedSummaryItem | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [run] = await transaction
        .select()
        .from(summaryRebuildRuns)
        .where(and(eq(summaryRebuildRuns.id, runId), eq(summaryRebuildRuns.userId, userId)))
        .for("update")
        .limit(1);
      if (!run || run.status === "completed" || run.status === "cancelled") {
        return undefined;
      }
      const [item] = await transaction
        .select()
        .from(summaryRebuildItems)
        .where(
          and(
            eq(summaryRebuildItems.runId, runId),
            eq(summaryRebuildItems.userId, userId),
            inArray(summaryRebuildItems.status, ["pending", "running", "failed"]),
          ),
        )
        .orderBy(asc(summaryRebuildItems.ordinal))
        .limit(1);
      if (!item) {
        await transaction
          .update(summaryRebuildRuns)
          .set({
            status: "completed",
            updatedAt: new Date(),
            finishedAt: run.finishedAt ?? new Date(),
            errorCode: null,
            errorMessage: null,
          })
          .where(eq(summaryRebuildRuns.id, run.id));
        return undefined;
      }
      const [claimed] = await transaction
        .update(summaryRebuildItems)
        .set({
          status: "running",
          attempts: item.attempts + 1,
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(summaryRebuildItems.id, item.id))
        .returning();
      if (!claimed) {
        throw new Error("Failed to claim summary rebuild item");
      }
      const [updatedRun] = await transaction
        .update(summaryRebuildRuns)
        .set({
          status: "running",
          failedItems:
            item.status === "failed" ? Math.max(0, run.failedItems - 1) : run.failedItems,
          updatedAt: new Date(),
          finishedAt: null,
          errorCode: null,
          errorMessage: null,
        })
        .where(eq(summaryRebuildRuns.id, run.id))
        .returning();
      return updatedRun ? { item: claimed, run: updatedRun } : undefined;
    });
  }

  async buildProjection(
    run: SummaryRebuildRunRow,
    item: SummaryRebuildItemRecord,
  ): Promise<SummaryProjection> {
    return this.withTenant(run.userId, async (transaction) => {
      const [node] = await transaction
        .select()
        .from(outlineNodes)
        .where(
          and(
            eq(outlineNodes.id, item.scopeId),
            eq(outlineNodes.userId, run.userId),
            eq(outlineNodes.workId, run.workId),
            eq(outlineNodes.branchId, run.branchId),
          ),
        )
        .limit(1);
      if (!node) {
        throw new Error("Summary scope no longer exists");
      }
      if (item.level === "chapter") {
        return buildChapterProjection(transaction, run, node, "chapter");
      }
      return buildRollupProjection(transaction, run, node, item.level as SummaryLevel);
    });
  }

  async commitItem(input: {
    run: SummaryRebuildRunRow;
    item: SummaryRebuildItemRecord;
    projection: SummaryProjection;
  }): Promise<SummaryRecord> {
    return this.withTenant(input.run.userId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`summary-branch:${input.run.branchId}`}))`,
      );
      const [existing] = await transaction
        .select()
        .from(summaryRecords)
        .where(
          and(
            eq(summaryRecords.branchId, input.run.branchId),
            eq(summaryRecords.level, input.item.level),
            eq(summaryRecords.scopeId, input.item.scopeId),
          ),
        )
        .for("update")
        .limit(1);
      const now = new Date();
      const changed =
        !existing ||
        existing.inputHash !== input.projection.inputHash ||
        existing.contentHash !== input.projection.contentHash ||
        existing.compilerVersion !== input.run.compilerVersion ||
        existing.modelVersion !== input.run.modelVersion;
      let summary: SummaryRecordRow | undefined;
      if (existing) {
        [summary] = await transaction
          .update(summaryRecords)
          .set({
            title: await summaryTitle(transaction, input.run, input.item),
            chapterId: await summaryChapterId(transaction, input.item.scopeId),
            content: input.projection.content,
            status: "fresh",
            version: changed ? existing.version + 1 : existing.version,
            contentHash: input.projection.contentHash,
            inputHash: input.projection.inputHash,
            compilerVersion: input.run.compilerVersion,
            modelVersion: input.run.modelVersion,
            sourceRanges: input.projection.sourceRanges,
            fromChapter: input.projection.fromChapter,
            toChapter: input.projection.toChapter,
            generatedAt: changed ? now : existing.generatedAt,
            invalidatedAt: null,
            invalidationReason: null,
            updatedAt: now,
          })
          .where(eq(summaryRecords.id, existing.id))
          .returning();
      } else {
        [summary] = await transaction
          .insert(summaryRecords)
          .values({
            id: uuidv7(),
            workId: input.run.workId,
            branchId: input.run.branchId,
            userId: input.run.userId,
            level: input.item.level,
            scopeId: input.item.scopeId,
            chapterId: await summaryChapterId(transaction, input.item.scopeId),
            title: await summaryTitle(transaction, input.run, input.item),
            content: input.projection.content,
            status: "fresh",
            version: 1,
            contentHash: input.projection.contentHash,
            inputHash: input.projection.inputHash,
            compilerVersion: input.run.compilerVersion,
            modelVersion: input.run.modelVersion,
            sourceRanges: input.projection.sourceRanges,
            fromChapter: input.projection.fromChapter,
            toChapter: input.projection.toChapter,
            generatedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
      }
      if (!summary) {
        throw new Error("Failed to persist summary projection");
      }
      await transaction
        .update(summaryRebuildItems)
        .set({
          status: "succeeded",
          inputHash: input.projection.inputHash,
          outputSummaryId: summary.id,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
          finishedAt: now,
        })
        .where(eq(summaryRebuildItems.id, input.item.id));
      const [run] = await transaction
        .update(summaryRebuildRuns)
        .set({
          completedItems: sql`${summaryRebuildRuns.completedItems} + 1`,
          checkpointRevision: sql`${summaryRebuildRuns.checkpointRevision} + 1`,
          totalItems: input.run.totalItems,
          updatedAt: now,
        })
        .where(eq(summaryRebuildRuns.id, input.run.id))
        .returning();
      if (run && run.completedItems + run.failedItems >= run.totalItems) {
        await transaction
          .update(summaryRebuildRuns)
          .set({
            status: run.failedItems > 0 ? "failed" : "completed",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(summaryRebuildRuns.id, run.id));
        if (run.failedItems === 0) {
          await transaction.insert(auditLogs).values({
            id: uuidv7(),
            actorId: input.run.userId,
            action: "summaries.rebuild_completed",
            targetType: "summary_rebuild",
            targetId: run.id,
            decision: "allowed",
            correlationId: run.id,
            ip: "worker",
            userAgent: "summary-rebuild-worker",
          });
        }
      }
      return toSummaryRecordContract(summary);
    });
  }

  async failItem(input: {
    run: SummaryRebuildRunRow;
    item: SummaryRebuildItemRecord;
    code: string;
    message: string;
  }): Promise<void> {
    await this.withTenant(input.run.userId, async (transaction) => {
      const now = new Date();
      await transaction
        .update(summaryRebuildItems)
        .set({
          status: "failed",
          errorCode: input.code,
          errorMessage: input.message,
          updatedAt: now,
          finishedAt: now,
        })
        .where(eq(summaryRebuildItems.id, input.item.id));
      await transaction
        .update(summaryRebuildRuns)
        .set({
          status: "failed",
          failedItems: sql`${summaryRebuildRuns.failedItems} + 1`,
          errorCode: input.code,
          errorMessage: input.message,
          updatedAt: now,
          finishedAt: now,
        })
        .where(eq(summaryRebuildRuns.id, input.run.id));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
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

async function buildChapterProjection(
  transaction: DatabaseTransaction,
  run: SummaryRebuildRunRow,
  node: OutlineNodeRecord,
  level: SummaryLevel,
): Promise<SummaryProjection> {
  if (!node.chapterId) {
    throw new Error("Chapter summary scope has no chapter");
  }
  const [chapter] = await transaction
    .select()
    .from(chapters)
    .where(
      and(
        eq(chapters.id, node.chapterId),
        eq(chapters.userId, run.userId),
        eq(chapters.workId, run.workId),
        eq(chapters.branchId, run.branchId),
      ),
    )
    .limit(1);
  if (!chapter) {
    throw new Error("Chapter summary source no longer exists");
  }
  const [version] = chapter.currentVersionId
    ? await transaction
        .select()
        .from(chapterVersions)
        .where(eq(chapterVersions.id, chapter.currentVersionId))
        .limit(1)
    : [];
  const factRows = await transaction
    .select({
      fact: facts,
      commitVersionNodeId: canonCommits.versionNodeId,
    })
    .from(facts)
    .innerJoin(canonCommits, eq(canonCommits.id, facts.canonCommitId))
    .where(
      and(
        eq(facts.chapterId, chapter.id),
        eq(facts.userId, run.userId),
        eq(facts.workId, run.workId),
        eq(facts.branchId, run.branchId),
        eq(facts.status, "active"),
      ),
    )
    .orderBy(asc(facts.createdAt));
  const sourceRanges: SummarySourceRange[] = [
    {
      nodeId: node.id,
      versionNodeId: node.versionNodeId,
      objectVersion: node.version,
      chapterFrom: chapter.number,
      chapterTo: chapter.number,
    },
  ];
  if (version) {
    sourceRanges.push({
      nodeId: chapter.id,
      versionNodeId: version.versionNodeId,
      objectVersion: version.version,
      chapterFrom: chapter.number,
      chapterTo: chapter.number,
    });
  }
  for (const row of factRows) {
    sourceRanges.push({
      nodeId: row.fact.id,
      versionNodeId: row.commitVersionNodeId,
      objectVersion: 1,
      chapterFrom: row.fact.validFromChapter,
      chapterTo: chapter.number,
    });
  }
  return buildSummaryProjection({
    level,
    title: chapter.title,
    outlineSummary: node.summary,
    chapterNumber: chapter.number,
    chapterTitle: chapter.title,
    manuscript: version?.content ?? "",
    facts: factRows.map((row) => `${row.fact.subject} ${row.fact.predicate} ${row.fact.object}`),
    sourceRanges: dedupeRanges(sourceRanges),
  });
}

async function buildRollupProjection(
  transaction: DatabaseTransaction,
  run: SummaryRebuildRunRow,
  node: OutlineNodeRecord,
  level: SummaryLevel,
): Promise<SummaryProjection> {
  const nodes = await transaction
    .select()
    .from(outlineNodes)
    .where(
      and(
        eq(outlineNodes.userId, run.userId),
        eq(outlineNodes.workId, run.workId),
        eq(outlineNodes.branchId, run.branchId),
      ),
    );
  const descendants = collectDescendantIds(nodes, node.id);
  const chapterNodes = nodes.filter(
    (candidate) =>
      descendants.has(candidate.id) &&
      candidate.level === "chapter" &&
      candidate.chapterId !== null,
  );
  const chapterRows = chapterNodes.length
    ? await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, run.userId),
            eq(chapters.workId, run.workId),
            eq(chapters.branchId, run.branchId),
            inArray(
              chapters.id,
              chapterNodes.map((candidate) => candidate.chapterId!),
            ),
          ),
        )
        .orderBy(asc(chapters.number))
    : [];
  const nodeByChapterId = new Map(
    chapterNodes.map((candidate) => [candidate.chapterId!, candidate]),
  );
  const childProjections: Array<{
    title: string;
    content: string;
    fromChapter: number;
    toChapter: number | null;
    sourceRanges: SummarySourceRange[];
  }> = [];
  for (const chapter of chapterRows) {
    const chapterNode = nodeByChapterId.get(chapter.id);
    if (!chapterNode) {
      continue;
    }
    const projection = await buildChapterProjection(transaction, run, chapterNode, "chapter");
    childProjections.push({
      title: chapter.title,
      content: projection.content,
      fromChapter: projection.fromChapter,
      toChapter: projection.toChapter,
      sourceRanges: projection.sourceRanges,
    });
  }
  const [contract] =
    node.level === "volume"
      ? await transaction
          .select()
          .from(volumeContracts)
          .where(eq(volumeContracts.nodeId, node.id))
          .limit(1)
      : [];
  const sourceRanges = dedupeRanges([
    {
      nodeId: node.id,
      versionNodeId: node.versionNodeId,
      objectVersion: node.version,
      chapterFrom: childProjections[0]?.fromChapter ?? 1,
      chapterTo: childProjections.at(-1)?.toChapter ?? null,
    },
    ...childProjections.flatMap((summary) => summary.sourceRanges.map(toCoreSourceRange)),
  ]);
  return buildSummaryProjection({
    level,
    title: node.title,
    outlineSummary: node.summary,
    ...(contract
      ? {
          contractText: [
            contract.objective,
            contract.conflict,
            ...contract.turningPoints,
            ...contract.exitConditions,
          ].join("；"),
        }
      : {}),
    childSummaries: childProjections.map((summary) => ({
      label: summary.title,
      content: summary.content,
      fromChapter: summary.fromChapter,
      toChapter: summary.toChapter,
    })),
    sourceRanges,
  });
}

async function summaryTitle(
  transaction: DatabaseTransaction,
  run: SummaryRebuildRunRow,
  item: SummaryRebuildItemRecord,
): Promise<string> {
  if (item.level === "chapter") {
    const [chapter] = await transaction
      .select({ title: chapters.title })
      .from(outlineNodes)
      .innerJoin(chapters, eq(chapters.id, outlineNodes.chapterId))
      .where(
        and(
          eq(outlineNodes.id, item.scopeId),
          eq(outlineNodes.userId, run.userId),
          eq(outlineNodes.branchId, run.branchId),
        ),
      )
      .limit(1);
    if (chapter) {
      return chapter.title;
    }
  }
  const [node] = await transaction
    .select({ title: outlineNodes.title })
    .from(outlineNodes)
    .where(eq(outlineNodes.id, item.scopeId))
    .limit(1);
  return node?.title || item.level;
}

async function summaryChapterId(
  transaction: DatabaseTransaction,
  scopeId: string,
): Promise<string | null> {
  const [node] = await transaction
    .select({ chapterId: outlineNodes.chapterId })
    .from(outlineNodes)
    .where(eq(outlineNodes.id, scopeId))
    .limit(1);
  return node?.chapterId ?? null;
}

function summaryLevel(level: string): SummaryLevel | null {
  switch (level) {
    case "chapter":
      return "chapter";
    case "act":
      return "stage";
    case "volume":
      return "volume";
    case "book":
      return "book";
    default:
      return null;
  }
}

function summaryLevelRank(level: SummaryLevel): number {
  return { chapter: 0, stage: 1, volume: 2, book: 3 }[level];
}

function collectDescendantIds(nodes: OutlineNodeRecord[], parentId: string): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    for (const node of nodes) {
      if (node.parentId !== id || result.has(node.id)) {
        continue;
      }
      result.add(node.id);
      visit(node.id);
    }
  };
  visit(parentId);
  return result;
}

function dedupeRanges(ranges: SummarySourceRange[]): SummarySourceRange[] {
  const seen = new Set<string>();
  return ranges.filter((range) => {
    const key = [
      range.nodeId,
      range.versionNodeId ?? "",
      range.objectVersion,
      range.chapterFrom,
      range.chapterTo ?? "",
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function toCoreSourceRange(range: SummarySourceRange): CoreSummarySourceRange {
  return {
    nodeId: range.nodeId,
    versionNodeId: range.versionNodeId,
    objectVersion: range.objectVersion,
    chapterFrom: range.chapterFrom,
    chapterTo: range.chapterTo,
  };
}
