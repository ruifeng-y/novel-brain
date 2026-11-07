import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  batchPlanMetadataSchema,
  type BatchPlanCounts,
  type BatchPlanMetadata,
  type BatchPlanSummary,
  type BatchWorkItem,
  type GenerationJobStatus,
} from "@novel-brain/contracts";
import type { BuiltBatchPlan } from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";

type BatchPlanTransaction = Pick<PoolClient, "query">;

export interface BatchPlanContext {
  workId: string;
  branchId: string;
}

export interface OutlineNodeSource {
  id: string;
  level: "book" | "volume" | "act" | "chapter" | "scene";
  parentId: string | null;
  version: number;
  sortOrder: number;
  chapterId: string | null;
}

export interface ChapterSource {
  id: string;
  number: number;
  version: number;
  canonCommitted: boolean;
}

export interface BatchPlanSources {
  nodes: OutlineNodeSource[];
  chapters: ChapterSource[];
}

export interface BatchPlanJobRecord {
  id: string;
  workId: string;
  branchId: string;
  userId: string;
  status: GenerationJobStatus;
  idempotencyKey: string;
  metadata: BatchPlanMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface BatchPlanPersistInput {
  userId: string;
  context: BatchPlanContext;
  idempotencyKey: string;
  requestHash: string;
  build: (sources: BatchPlanSources) => { built: BuiltBatchPlan; metadata: BatchPlanMetadata };
}

export interface BatchPlanCreateResult {
  summary: BatchPlanSummary;
  replayed: boolean;
}

export interface BatchPlanItemFilters {
  type?: BatchWorkItem["type"];
  status?: BatchWorkItem["status"];
}

export interface BatchPlanItemPage {
  items: BatchWorkItem[];
  nextCursor: string | null;
}

interface JobRow {
  id: string;
  work_id: string;
  branch_id: string;
  user_id: string;
  status: string;
  idempotency_key: string;
  orchestration: unknown;
  created_at: Date;
  updated_at: Date;
}

interface OutlineNodeRow {
  id: string;
  level: OutlineNodeSource["level"];
  parent_id: string | null;
  version: number;
  sort_order: number;
  chapter_id: string | null;
}

interface ChapterRow {
  id: string;
  number: number;
  version: number;
  canon_committed: boolean;
}

interface WorkItemRow {
  id: string;
  job_id: string;
  work_id: string;
  branch_id: string;
  user_id: string;
  item_type: BatchWorkItem["type"];
  work_item_key: string;
  parent_key: string | null;
  chapter_id: string | null;
  outline_node_id: string | null;
  status: BatchWorkItem["status"];
  attempt: number;
  priority: number;
  priority_class: BatchWorkItem["priorityClass"];
  sort_order: number;
  input_version: unknown;
  dependencies: unknown;
  output_refs: unknown;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class BatchPlanRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl, {
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<BatchPlanContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const result = await transaction.query<{ work_id: string; branch_id: string }>(
        `SELECT w.id AS work_id, b.id AS branch_id
         FROM works w
         INNER JOIN work_branches b
           ON b.work_id = w.id AND b.user_id = w.user_id
         WHERE w.id = $1
           AND w.user_id = $2
           AND b.id = $3
           AND w.deleted_at IS NULL`,
        [workId, userId, branchId],
      );
      const row = result.rows[0];
      return row ? { workId: row.work_id, branchId: row.branch_id } : undefined;
    });
  }

  async createPlan(input: BatchPlanPersistInput): Promise<BatchPlanCreateResult> {
    return this.withTenant(input.userId, async (transaction) => {
      await lockIdempotency(
        transaction,
        input.userId,
        input.context.workId,
        input.context.branchId,
        input.idempotencyKey,
      );
      const existing = await findByIdempotency(
        transaction,
        input.userId,
        input.context.workId,
        input.context.branchId,
        input.idempotencyKey,
      );
      if (existing) {
        if (existing.metadata.requestHash !== input.requestHash) {
          throw new BatchPlanRepositoryError(
            "BATCH_PLAN_IDEMPOTENCY_CONFLICT",
            "同一 Idempotency-Key 不能提交不同的批量计划",
          );
        }
        const counts = await aggregateCounts(transaction, input.userId, existing.id);
        return {
          summary: summaryFrom(existing, counts),
          replayed: true,
        };
      }

      const sources = await loadSources(
        transaction,
        input.userId,
        input.context.workId,
        input.context.branchId,
      );
      const { built, metadata } = input.build(sources);
      const now = new Date();
      await insertRootJob(transaction, {
        userId: input.userId,
        context: input.context,
        idempotencyKey: input.idempotencyKey,
        metadata,
        built,
        now,
      });
      await insertWorkItems(transaction, {
        userId: input.userId,
        context: input.context,
        built,
        now,
      });
      const planId = built.items[0]?.planId;
      if (!planId) {
        throw new BatchPlanRepositoryError("BATCH_PLAN_INVALID", "批量计划没有工作项");
      }
      return {
        summary: {
          id: planId,
          jobId: planId,
          workId: input.context.workId,
          branchId: input.context.branchId,
          userId: input.userId,
          status: "queued",
          scope: metadata.scope,
          approvalMode: metadata.approvalMode,
          priorityClass: metadata.priorityClass,
          idempotencyKey: input.idempotencyKey,
          counts: built.counts,
          scheduling: built.scheduling,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
        replayed: false,
      };
    });
  }

  async getPlan(
    userId: string,
    context: BatchPlanContext,
    planId: string,
  ): Promise<BatchPlanSummary | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const record = await findPlan(transaction, userId, context, planId);
      if (!record) {
        return undefined;
      }
      const counts = await aggregateCounts(transaction, userId, planId);
      return summaryFrom(record, counts);
    });
  }

  async listItems(
    userId: string,
    context: BatchPlanContext,
    planId: string,
    filters: BatchPlanItemFilters,
    cursor: string | undefined,
    limit: number,
  ): Promise<BatchPlanItemPage | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const record = await findPlan(transaction, userId, context, planId);
      if (!record) {
        return undefined;
      }
      let cursorSortOrder: number | null = null;
      let cursorId: string | null = null;
      if (cursor) {
        const cursorRow = await transaction.query<{ sort_order: number; id: string }>(
          `SELECT sort_order, id
           FROM job_work_items
           WHERE job_id = $1 AND user_id = $2 AND id = $3`,
          [planId, userId, cursor],
        );
        const row = cursorRow.rows[0];
        if (!row) {
          throw new BatchPlanRepositoryError("BATCH_PLAN_INVALID", "批量计划游标无效");
        }
        cursorSortOrder = row.sort_order;
        cursorId = row.id;
      }
      const result = await transaction.query<WorkItemRow>(
        `SELECT i.id, i.job_id, i.work_id, i.branch_id, i.user_id, i.item_type,
                i.work_item_key, p.work_item_key AS parent_key, i.chapter_id,
                i.outline_node_id, i.status, i.attempt, i.priority, i.priority_class,
                i.sort_order, i.input_version, i.dependencies, i.output_refs,
                i.error_code, i.error_message, i.created_at, i.updated_at
         FROM job_work_items i
         LEFT JOIN job_work_items p ON p.id = i.parent_id
         WHERE i.job_id = $1
           AND i.user_id = $2
           AND ($3::text IS NULL OR i.item_type = $3)
           AND ($4::text IS NULL OR i.status = $4)
           AND (
             $5::integer IS NULL
             OR (i.sort_order, i.id) > ($5::integer, $6::uuid)
           )
         ORDER BY i.sort_order, i.id
         LIMIT $7`,
        [
          planId,
          userId,
          filters.type ?? null,
          filters.status ?? null,
          cursorSortOrder,
          cursorId,
          limit + 1,
        ],
      );
      const hasMore = result.rows.length > limit;
      const page = hasMore ? result.rows.slice(0, limit) : result.rows;
      return {
        items: page.map(toWorkItem),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      };
    });
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: BatchPlanTransaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

export class BatchPlanRepositoryError extends Error {
  constructor(
    readonly code: "BATCH_PLAN_INVALID" | "BATCH_PLAN_IDEMPOTENCY_CONFLICT",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BatchPlanRepositoryError";
  }
}

async function findByIdempotency(
  transaction: BatchPlanTransaction,
  userId: string,
  workId: string,
  branchId: string,
  idempotencyKey: string,
): Promise<BatchPlanJobRecord | null> {
  const result = await transaction.query<JobRow>(
    `SELECT j.id, j.work_id, j.branch_id, j.user_id, j.status, j.idempotency_key,
            j.orchestration, j.created_at, j.updated_at
     FROM jobs j
     INNER JOIN works w ON w.id = j.work_id AND w.user_id = j.user_id
     WHERE j.user_id = $1
       AND j.work_id = $2
       AND j.branch_id = $3
       AND j.idempotency_key = $4
       AND j.type = 'batch_plan'
       AND w.deleted_at IS NULL
     LIMIT 1`,
    [userId, workId, branchId, idempotencyKey],
  );
  return result.rows[0] ? toJobRecord(result.rows[0]) : null;
}

async function findPlan(
  transaction: BatchPlanTransaction,
  userId: string,
  context: BatchPlanContext,
  planId: string,
): Promise<BatchPlanJobRecord | null> {
  const result = await transaction.query<JobRow>(
    `SELECT j.id, j.work_id, j.branch_id, j.user_id, j.status, j.idempotency_key,
            j.orchestration, j.created_at, j.updated_at
     FROM jobs j
     INNER JOIN works w ON w.id = j.work_id AND w.user_id = j.user_id
     WHERE j.id = $1
       AND j.user_id = $2
       AND j.work_id = $3
       AND j.branch_id = $4
       AND j.type = 'batch_plan'
       AND w.deleted_at IS NULL`,
    [planId, userId, context.workId, context.branchId],
  );
  return result.rows[0] ? toJobRecord(result.rows[0]) : null;
}

function toJobRecord(row: JobRow): BatchPlanJobRecord {
  return {
    id: row.id,
    workId: row.work_id,
    branchId: row.branch_id,
    userId: row.user_id,
    status: row.status as GenerationJobStatus,
    idempotencyKey: row.idempotency_key,
    metadata: batchPlanMetadataSchema.parse(row.orchestration),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadSources(
  transaction: BatchPlanTransaction,
  userId: string,
  workId: string,
  branchId: string,
): Promise<BatchPlanSources> {
  const [nodes, chapters] = await Promise.all([
    transaction.query<OutlineNodeRow>(
      `SELECT id, level, parent_id, version, sort_order, chapter_id
       FROM outline_nodes
       WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
       ORDER BY sort_order, id`,
      [userId, workId, branchId],
    ),
    transaction.query<ChapterRow>(
      `SELECT c.id, c.number, c.version, (cc.id IS NOT NULL) AS canon_committed
       FROM chapters c
       LEFT JOIN canon_commits cc
         ON cc.chapter_id = c.id AND cc.user_id = c.user_id
       WHERE c.user_id = $1 AND c.work_id = $2 AND c.branch_id = $3
       ORDER BY c.number, c.id`,
      [userId, workId, branchId],
    ),
  ]);
  return {
    nodes: nodes.rows.map((row) => ({
      id: row.id,
      level: row.level,
      parentId: row.parent_id,
      version: row.version,
      sortOrder: row.sort_order,
      chapterId: row.chapter_id,
    })),
    chapters: chapters.rows.map((row) => ({
      id: row.id,
      number: row.number,
      version: row.version,
      canonCommitted: row.canon_committed,
    })),
  };
}

async function aggregateCounts(
  transaction: BatchPlanTransaction,
  userId: string,
  planId: string,
): Promise<BatchPlanCounts> {
  const result = await transaction.query<{ item_type: string; status: string; count: string }>(
    `SELECT item_type, status, count(*)::text AS count
     FROM job_work_items
     WHERE job_id = $1 AND user_id = $2
     GROUP BY item_type, status`,
    [planId, userId],
  );
  const counts = emptyCounts();
  for (const row of result.rows) {
    const count = Number(row.count);
    counts.total += count;
    if (row.item_type in counts) {
      counts[row.item_type as BatchWorkItem["type"]] += count;
    }
    if (row.status in counts) {
      counts[row.status as BatchWorkItem["status"]] += count;
    }
  }
  return counts;
}

function emptyCounts(): BatchPlanCounts {
  return {
    total: 0,
    book: 0,
    volume: 0,
    chapter: 0,
    step: 0,
    pending: 0,
    ready: 0,
    running: 0,
    waiting_review: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
}

function summaryFrom(record: BatchPlanJobRecord, counts: BatchPlanCounts): BatchPlanSummary {
  return {
    id: record.id,
    jobId: record.id,
    workId: record.workId,
    branchId: record.branchId,
    userId: record.userId,
    status: record.status,
    scope: record.metadata.scope,
    approvalMode: record.metadata.approvalMode,
    priorityClass: record.metadata.priorityClass,
    idempotencyKey: record.idempotencyKey,
    counts,
    scheduling: record.metadata.scheduling,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function lockIdempotency(
  transaction: BatchPlanTransaction,
  userId: string,
  workId: string,
  branchId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('novelbrain:batch-plan'),
       hashtext($1)
     )`,
    [`${userId}:${workId}:${branchId}:${idempotencyKey}`],
  );
}

async function insertRootJob(
  transaction: BatchPlanTransaction,
  input: {
    userId: string;
    context: BatchPlanContext;
    idempotencyKey: string;
    metadata: BatchPlanMetadata;
    built: BuiltBatchPlan;
    now: Date;
  },
): Promise<void> {
  const planId = input.built.items[0]?.planId;
  if (!planId) {
    throw new BatchPlanRepositoryError("BATCH_PLAN_INVALID", "批量计划没有工作项");
  }
  await transaction.query(
    `INSERT INTO jobs (
       id, work_id, branch_id, user_id, chapter_id, model_config_id, type, status,
       progress, current_step, priority, idempotency_key, budget, checkpoint,
       orchestration, cost, parent_job_id, job_type, work_item_key,
       error_code, error_message, started_at, finished_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, NULL, NULL, 'batch_plan', 'queued',
       0, 'plan', $5, $6, '{}'::jsonb, $7::jsonb,
       $8::jsonb, $9::jsonb, NULL, 'book', 'book',
       NULL, NULL, NULL, NULL, $10, $10
     )`,
    [
      planId,
      input.context.workId,
      input.context.branchId,
      input.userId,
      input.built.scheduling.priority,
      input.idempotencyKey,
      JSON.stringify({
        step: "plan",
        payload: {
          requestHash: input.metadata.requestHash,
          planVersion: input.metadata.schemaVersion,
        },
      }),
      JSON.stringify(input.metadata),
      JSON.stringify({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 }),
      input.now,
    ],
  );
}

async function insertWorkItems(
  transaction: BatchPlanTransaction,
  input: {
    userId: string;
    context: BatchPlanContext;
    built: BuiltBatchPlan;
    now: Date;
  },
): Promise<void> {
  const planId = input.built.items[0]?.planId;
  if (!planId) {
    return;
  }
  const idByKey = new Map(input.built.items.map((item) => [item.key, item.id]));
  const chunkSize = 500;
  for (let offset = 0; offset < input.built.items.length; offset += chunkSize) {
    const chunk = input.built.items.slice(offset, offset + chunkSize);
    const values: unknown[] = [];
    const placeholders = chunk.map((item, index) => {
      const base = index * 25;
      values.push(
        item.id,
        planId,
        input.context.workId,
        input.context.branchId,
        input.userId,
        item.parentKey ? (idByKey.get(item.parentKey) ?? null) : null,
        item.type,
        item.key,
        `${planId}:${item.key}`,
        item.chapterId,
        item.outlineNodeId,
        item.status,
        item.attempt,
        item.priority,
        item.priorityClass,
        item.sortOrder,
        JSON.stringify(item.inputVersion),
        JSON.stringify(item.dependsOn),
        JSON.stringify(item.outputRefs),
        JSON.stringify({}),
        JSON.stringify({}),
        item.errorCode,
        item.errorMessage,
        input.now,
        input.now,
      );
      return `(${Array.from({ length: 25 }, (_, column) => `$${base + column + 1}`).join(", ")})`;
    });
    await transaction.query(
      `INSERT INTO job_work_items (
         id, job_id, work_id, branch_id, user_id, parent_id, item_type,
         work_item_key, idempotency_key, chapter_id, outline_node_id, status,
         attempt, priority, priority_class, sort_order, input_version,
         dependencies, output_refs, cost, checkpoint, error_code, error_message,
         created_at, updated_at
       ) VALUES ${placeholders.join(", ")}`,
      values,
    );
  }
}

function toWorkItem(row: WorkItemRow): BatchWorkItem {
  return {
    id: row.id,
    planId: row.job_id,
    workId: row.work_id,
    branchId: row.branch_id,
    userId: row.user_id,
    key: row.work_item_key,
    type: row.item_type,
    parentKey: row.parent_key,
    chapterId: row.chapter_id,
    outlineNodeId: row.outline_node_id,
    status: row.status,
    attempt: row.attempt,
    priority: row.priority,
    priorityClass: row.priority_class,
    sortOrder: row.sort_order,
    inputVersion: row.input_version as BatchWorkItem["inputVersion"],
    dependsOn: row.dependencies as string[],
    outputRefs: row.output_refs as BatchWorkItem["outputRefs"],
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
