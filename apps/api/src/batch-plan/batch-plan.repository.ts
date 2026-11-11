import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  batchPlanMetadataSchema,
  generationCheckpointSchema,
  WORKER_JOB_STEPS,
  type BatchPlanCounts,
  type BatchPlanMetadata,
  type BatchPlanSummary,
  type BatchCostReport,
  type BatchCostReportGroup,
  type BatchCostReportGroupBy,
  type BatchWorkItem,
  type GenerationJobStatus,
} from "@novel-brain/contracts";
import {
  canCancelBatchPlan,
  canPauseBatchPlan,
  canResumeBatchPlan,
  canRetryBatchPlan,
  canStartBatchPlan,
  resolveRecoveryStep,
  type BuiltBatchPlan,
} from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

type BatchPlanTransaction = Pick<PoolClient, "query">;

export interface BatchPlanContext {
  workId: string;
  branchId: string;
}

export interface BatchPlanWorkContext extends BatchPlanContext {
  chapterLengthTarget: number;
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
  wordCount: number;
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
  context: BatchPlanWorkContext;
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

export interface BatchPlanAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type BatchPlanControlAction = "start" | "pause" | "resume" | "cancel" | "retry";

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
  word_count: number;
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
  ): Promise<BatchPlanWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const result = await transaction.query<{
        work_id: string;
        branch_id: string;
        chapter_length_target: number;
      }>(
        `SELECT w.id AS work_id, b.id AS branch_id, w.chapter_length_target
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
      return row
        ? {
            workId: row.work_id,
            branchId: row.branch_id,
            chapterLengthTarget: row.chapter_length_target,
          }
        : undefined;
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
          costBudgetPolicy: metadata.costBudgetPolicy,
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

  async getCostReport(
    userId: string,
    context: BatchPlanContext,
    planId: string,
    groupBy: BatchCostReportGroupBy,
  ): Promise<BatchCostReport | null> {
    return this.withTenant(userId, async (transaction) => {
      const plan = await findPlan(transaction, userId, context, planId);
      if (!plan) {
        return null;
      }
      const totals = await transaction.query<{
        chapters: string;
        calls: string;
        failed_calls: string;
        input_tokens: string;
        output_tokens: string;
        reserved_cost: string;
        settled_cost: string;
      }>(
        `SELECT count(DISTINCT child.chapter_id)::text AS chapters,
                count(call.id)::text AS calls,
                count(call.id) FILTER (WHERE call.status = 'failed')::text AS failed_calls,
                COALESCE(sum(call.input_tokens), 0)::text AS input_tokens,
                COALESCE(sum(call.output_tokens), 0)::text AS output_tokens,
                COALESCE((
                  SELECT sum(reservation.reserved_cost_cny)
                  FROM cost_reservations reservation
                  INNER JOIN jobs reserved_child ON reserved_child.id = reservation.job_id
                  WHERE reserved_child.parent_job_id = $1
                ), 0)::text AS reserved_cost,
                COALESCE((
                  SELECT sum(reservation.settled_cost_cny)
                  FROM cost_reservations reservation
                  INNER JOIN jobs settled_child ON settled_child.id = reservation.job_id
                  WHERE settled_child.parent_job_id = $1 AND reservation.status = 'settled'
                ), 0)::text AS settled_cost
         FROM jobs child
         LEFT JOIN model_calls call ON call.job_id = child.id
         WHERE child.parent_job_id = $1 AND child.user_id = $2`,
        [planId, userId],
      );
      const total = totals.rows[0]!;
      const groups = await costGroups(transaction, userId, planId, groupBy);
      const hardStops = await transaction.query<{
        job_id: string;
        chapter_id: string | null;
        code: string;
        message: string;
        occurred_at: Date;
      }>(
        `SELECT event.job_id, child.chapter_id,
                COALESCE(event.payload ->> 'code', 'JOB_BUDGET_EXCEEDED') AS code,
                COALESCE(event.payload ->> 'message', '任务已达到成本上限') AS message,
                event.occurred_at
         FROM job_events event
         INNER JOIN jobs child ON child.id = event.job_id
         WHERE child.user_id = $2
           AND (child.id = $1 OR child.parent_job_id = $1)
           AND event.event_type = 'job.budget.exceeded'
         ORDER BY event.occurred_at DESC
         LIMIT 100`,
        [planId, userId],
      );
      const policy = plan.metadata.costBudgetPolicy;
      const perTenThousandCharactersLimitCny =
        policy.perTenThousandCharsMaxCostCny === null
          ? null
          : roundCost(
              (plan.metadata.projectedCharacters / 10_000) * policy.perTenThousandCharsMaxCostCny,
            );
      const taskLimitCandidates = [policy.taskMaxCostCny, perTenThousandCharactersLimitCny].filter(
        (limit): limit is number => limit !== null,
      );
      const taskLimit = taskLimitCandidates.length === 0 ? null : Math.min(...taskLimitCandidates);
      const used = roundCost(Number(total.reserved_cost) + Number(total.settled_cost));
      const remainingCostCny = taskLimit === null ? null : Math.max(0, roundCost(taskLimit - used));
      return {
        planId,
        workId: context.workId,
        currency: "CNY",
        generatedAt: new Date().toISOString(),
        totals: {
          chapters: Number(total.chapters),
          calls: Number(total.calls),
          failedCalls: Number(total.failed_calls),
          inputTokens: Number(total.input_tokens),
          outputTokens: Number(total.output_tokens),
          reservedCostCny: roundCost(Number(total.reserved_cost)),
          settledCostCny: roundCost(Number(total.settled_cost)),
        },
        budget: {
          policy,
          projectedCharacters: plan.metadata.projectedCharacters,
          perTenThousandCharactersLimitCny,
          remainingCostCny,
          status:
            remainingCostCny !== null && remainingCostCny <= 0
              ? "exhausted"
              : remainingCostCny !== null &&
                  taskLimit !== null &&
                  remainingCostCny <= taskLimit * 0.1
                ? "near_limit"
                : "ok",
        },
        groups,
        hardStops: hardStops.rows.map((row) => ({
          jobId: row.job_id,
          chapterId: row.chapter_id,
          code: row.code,
          message: row.message,
          occurredAt: row.occurred_at.toISOString(),
        })),
      };
    });
  }

  async controlPlan(input: {
    userId: string;
    context: BatchPlanContext;
    planId: string;
    action: BatchPlanControlAction;
    idempotencyKey: string;
    reason: string;
    audit: BatchPlanAuditContext;
  }): Promise<BatchPlanSummary | undefined> {
    return this.withTenant(input.userId, async (transaction) => {
      const plan = await lockPlan(transaction, input.userId, input.context, input.planId);
      if (!plan) {
        return undefined;
      }
      const scope = `batch_plan.${input.action}.${input.planId}`;
      const existing = await findIdempotentAction(
        transaction,
        input.userId,
        scope,
        input.idempotencyKey,
      );
      if (existing) {
        const counts = await aggregateCounts(transaction, input.userId, input.planId);
        return summaryFrom(plan, counts);
      }

      switch (input.action) {
        case "start":
          await startPlan(transaction, plan, input.userId, input.reason);
          break;
        case "pause":
          await pausePlan(transaction, plan, input.userId, input.reason);
          break;
        case "resume":
          await resumePlan(transaction, plan, input.userId, input.reason);
          break;
        case "cancel":
          await cancelPlan(transaction, plan, input.userId, input.reason);
          break;
        case "retry":
          await retryFailedPlan(transaction, plan, input.userId, input.reason, input.audit);
          break;
      }

      await rememberIdempotentAction(
        transaction,
        input.userId,
        scope,
        input.idempotencyKey,
        input.planId,
      );
      await insertAuditLog(transaction, {
        userId: input.userId,
        planId: input.planId,
        action: `batch_plan.${input.action}`,
        audit: input.audit,
      });
      const updated = await reloadPlan(transaction, input.userId, input.context, input.planId);
      if (!updated) {
        return undefined;
      }
      const counts = await aggregateCounts(transaction, input.userId, input.planId);
      return summaryFrom(updated, counts);
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
      `SELECT c.id, c.number, c.version, c.word_count,
              (cc.id IS NOT NULL) AS canon_committed
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
      wordCount: row.word_count,
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
    paused: 0,
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
    costBudgetPolicy: record.metadata.costBudgetPolicy,
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
       0, 'plan', $5, $6, $7::jsonb, $8::jsonb,
       $9::jsonb, $10::jsonb, NULL, 'book', 'book',
       NULL, NULL, NULL, NULL, $11, $11
     )`,
    [
      planId,
      input.context.workId,
      input.context.branchId,
      input.userId,
      input.built.scheduling.priority,
      input.idempotencyKey,
      JSON.stringify({
        ...input.metadata.costBudgetPolicy,
        projectedCharacters: input.metadata.projectedCharacters,
        perTenThousandCharactersLimitCny:
          input.metadata.costBudgetPolicy.perTenThousandCharsMaxCostCny === null
            ? null
            : roundCost(
                (input.metadata.projectedCharacters / 10_000) *
                  input.metadata.costBudgetPolicy.perTenThousandCharsMaxCostCny,
              ),
      }),
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

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}

async function costGroups(
  transaction: BatchPlanTransaction,
  userId: string,
  planId: string,
  groupBy: BatchCostReportGroupBy,
): Promise<BatchCostReportGroup[]> {
  let query: string;
  switch (groupBy) {
    case "volume":
      query = `
        SELECT volume.outline_node_id::text AS key,
               COALESCE(node.title, '未分卷') AS label,
               count(DISTINCT child.chapter_id)::text AS chapters,
               count(call.id)::text AS calls,
               count(call.id) FILTER (WHERE call.status = 'failed')::text AS failed_calls,
               COALESCE(sum(call.input_tokens), 0)::text AS input_tokens,
               COALESCE(sum(call.output_tokens), 0)::text AS output_tokens,
               COALESCE(sum(call.cost_cny), 0)::text AS cost_cny
        FROM jobs child
        INNER JOIN job_work_items chapter_item
          ON chapter_item.job_id = child.parent_job_id
         AND chapter_item.user_id = child.user_id
         AND chapter_item.item_type = 'chapter'
         AND chapter_item.chapter_id = child.chapter_id
        INNER JOIN job_work_items volume
          ON volume.id = chapter_item.parent_id
         AND volume.user_id = child.user_id
         AND volume.item_type = 'volume'
        LEFT JOIN outline_nodes node ON node.id = volume.outline_node_id
        LEFT JOIN model_calls call ON call.job_id = child.id
        WHERE child.parent_job_id = $1 AND child.user_id = $2
        GROUP BY volume.outline_node_id, node.title
        ORDER BY node.title NULLS LAST`;
      break;
    case "chapter":
      query = `
        SELECT child.chapter_id::text AS key,
               '第 ' || chapter.number || ' 章 · ' || chapter.title AS label,
               count(DISTINCT child.chapter_id)::text AS chapters,
               count(call.id)::text AS calls,
               count(call.id) FILTER (WHERE call.status = 'failed')::text AS failed_calls,
               COALESCE(sum(call.input_tokens), 0)::text AS input_tokens,
               COALESCE(sum(call.output_tokens), 0)::text AS output_tokens,
               COALESCE(sum(call.cost_cny), 0)::text AS cost_cny
        FROM jobs child
        INNER JOIN chapters chapter ON chapter.id = child.chapter_id
        LEFT JOIN model_calls call ON call.job_id = child.id
        WHERE child.parent_job_id = $1 AND child.user_id = $2
        GROUP BY child.chapter_id, chapter.number, chapter.title
        ORDER BY chapter.number`;
      break;
    case "model":
      query = `
        SELECT COALESCE(call.model, '未调用') AS key,
               COALESCE(call.model, '未调用') AS label,
               count(DISTINCT child.chapter_id)::text AS chapters,
               count(call.id)::text AS calls,
               count(call.id) FILTER (WHERE call.status = 'failed')::text AS failed_calls,
               COALESCE(sum(call.input_tokens), 0)::text AS input_tokens,
               COALESCE(sum(call.output_tokens), 0)::text AS output_tokens,
               COALESCE(sum(call.cost_cny), 0)::text AS cost_cny
        FROM jobs child
        LEFT JOIN model_calls call ON call.job_id = child.id
        WHERE child.parent_job_id = $1 AND child.user_id = $2
        GROUP BY call.model
        ORDER BY cost_cny DESC`;
      break;
    case "time":
      query = `
        SELECT COALESCE(to_char(date_trunc('day', call.created_at), 'YYYY-MM-DD'), '未调用')
                 AS key,
               COALESCE(to_char(date_trunc('day', call.created_at), 'YYYY-MM-DD'), '未调用')
                 AS label,
               count(DISTINCT child.chapter_id)::text AS chapters,
               count(call.id)::text AS calls,
               count(call.id) FILTER (WHERE call.status = 'failed')::text AS failed_calls,
               COALESCE(sum(call.input_tokens), 0)::text AS input_tokens,
               COALESCE(sum(call.output_tokens), 0)::text AS output_tokens,
               COALESCE(sum(call.cost_cny), 0)::text AS cost_cny
        FROM jobs child
        LEFT JOIN model_calls call ON call.job_id = child.id
        WHERE child.parent_job_id = $1 AND child.user_id = $2
        GROUP BY date_trunc('day', call.created_at)
        ORDER BY date_trunc('day', call.created_at) NULLS LAST`;
      break;
  }
  const result = await transaction.query<{
    key: string;
    label: string;
    chapters: string;
    calls: string;
    failed_calls: string;
    input_tokens: string;
    output_tokens: string;
    cost_cny: string;
  }>(query, [planId, userId]);
  return result.rows.map((row) => ({
    key: row.key,
    label: row.label,
    chapters: Number(row.chapters),
    calls: Number(row.calls),
    failedCalls: Number(row.failed_calls),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    costCny: roundCost(Number(row.cost_cny)),
  }));
}

async function lockPlan(
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
       AND w.deleted_at IS NULL
     FOR UPDATE OF j`,
    [planId, userId, context.workId, context.branchId],
  );
  return result.rows[0] ? toJobRecord(result.rows[0]) : null;
}

async function reloadPlan(
  transaction: BatchPlanTransaction,
  userId: string,
  context: BatchPlanContext,
  planId: string,
): Promise<BatchPlanJobRecord | null> {
  return findPlan(transaction, userId, context, planId);
}

async function startPlan(
  transaction: BatchPlanTransaction,
  plan: BatchPlanJobRecord,
  userId: string,
  reason: string,
): Promise<void> {
  if (plan.status === "running") {
    return;
  }
  if (!canStartBatchPlan(plan.status)) {
    throw new BatchPlanRepositoryError(
      "BATCH_PLAN_INVALID",
      `批量计划状态 ${plan.status} 不能开始`,
      { status: plan.status },
    );
  }
  await updatePlanStatus(transaction, plan.id, userId, {
    status: "running",
    currentStep: "execute",
    errorCode: null,
    errorMessage: null,
    started: true,
    finished: false,
  });
  await appendPlanEvent(transaction, plan, "job.preparing", {
    status: "running",
    reason,
  });
}

async function pausePlan(
  transaction: BatchPlanTransaction,
  plan: BatchPlanJobRecord,
  userId: string,
  reason: string,
): Promise<void> {
  if (plan.status === "paused") {
    return;
  }
  if (!canPauseBatchPlan(plan.status)) {
    throw new BatchPlanRepositoryError(
      "BATCH_PLAN_INVALID",
      `批量计划状态 ${plan.status} 不能暂停`,
      { status: plan.status },
    );
  }
  await updatePlanStatus(transaction, plan.id, userId, {
    status: "paused",
    currentStep: "paused",
    errorCode: null,
    errorMessage: null,
    finished: false,
  });
  await transaction.query(
    `UPDATE job_work_items
     SET status = 'paused', updated_at = now()
     WHERE job_id = $1 AND user_id = $2 AND status IN ('pending', 'ready', 'running')`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE jobs
     SET status = 'paused', updated_at = now()
     WHERE parent_job_id = $1
       AND user_id = $2
       AND type = 'generate_chapter'
       AND status IN ('queued', 'preparing', 'running')`,
    [plan.id, userId],
  );
  await appendPlanEvent(transaction, plan, "job.paused", {
    status: "paused",
    reason,
  });
}

async function resumePlan(
  transaction: BatchPlanTransaction,
  plan: BatchPlanJobRecord,
  userId: string,
  reason: string,
): Promise<void> {
  if (plan.status === "running") {
    return;
  }
  if (!canResumeBatchPlan(plan.status)) {
    throw new BatchPlanRepositoryError(
      "BATCH_PLAN_INVALID",
      `批量计划状态 ${plan.status} 不能恢复`,
      { status: plan.status },
    );
  }
  await transaction.query(
    `UPDATE job_work_items
     SET status = 'pending', updated_at = now()
     WHERE job_id = $1 AND user_id = $2 AND status = 'paused'`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE job_work_items
     SET status = 'ready', updated_at = now()
     WHERE job_id = $1
       AND user_id = $2
       AND item_type = 'step'
       AND status = 'pending'
       AND dependencies = '[]'::jsonb`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE job_work_items step
     SET status = 'ready', updated_at = now()
     WHERE step.job_id = $1
       AND step.user_id = $2
       AND step.item_type = 'step'
       AND step.status = 'pending'
       AND EXISTS (
         SELECT 1
         FROM job_work_items volume
         WHERE volume.job_id = step.job_id
           AND volume.user_id = step.user_id
           AND volume.item_type = 'volume'
           AND volume.status = 'succeeded'
           AND step.dependencies ? volume.work_item_key
       )`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE jobs
     SET status = 'queued', updated_at = now()
     WHERE parent_job_id = $1
       AND user_id = $2
       AND type = 'generate_chapter'
       AND status = 'paused'`,
    [plan.id, userId],
  );
  await updatePlanStatus(transaction, plan.id, userId, {
    status: "running",
    currentStep: "execute",
    errorCode: null,
    errorMessage: null,
    finished: false,
  });
  await appendPlanEvent(transaction, plan, "job.resumed", {
    status: "running",
    reason,
  });
}

async function cancelPlan(
  transaction: BatchPlanTransaction,
  plan: BatchPlanJobRecord,
  userId: string,
  reason: string,
): Promise<void> {
  if (plan.status === "cancelled") {
    return;
  }
  if (!canCancelBatchPlan(plan.status)) {
    throw new BatchPlanRepositoryError(
      "BATCH_PLAN_INVALID",
      `批量计划状态 ${plan.status} 不能取消`,
      { status: plan.status },
    );
  }
  await updatePlanStatus(transaction, plan.id, userId, {
    status: "cancelled",
    currentStep: "cancelled",
    errorCode: "JOB_CANCELLED",
    errorMessage: "批量计划已取消，已完成章节和检查点保留",
    finished: true,
  });
  await transaction.query(
    `UPDATE job_work_items
     SET status = 'cancelled', updated_at = now()
     WHERE job_id = $1
       AND user_id = $2
       AND status NOT IN ('succeeded', 'waiting_review', 'failed', 'skipped', 'cancelled')`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE jobs
     SET status = 'cancelled', error_code = 'JOB_CANCELLED',
         error_message = '批量计划已取消', finished_at = now(), updated_at = now()
     WHERE parent_job_id = $1
       AND user_id = $2
       AND type = 'generate_chapter'
       AND status NOT IN ('completed', 'waiting_review', 'failed', 'cancelled')`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE cost_reservations
     SET status = 'released', failure_class = 'cancelled', settled_at = now()
     WHERE user_id = $2
       AND status = 'reserved'
       AND job_id IN (
         SELECT id FROM jobs WHERE parent_job_id = $1 AND user_id = $2
       )`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE model_calls
     SET status = 'failed', failure_class = 'cancelled',
         error_code = 'JOB_CANCELLED', finished_at = now()
     WHERE user_id = $2
       AND status = 'started'
       AND job_id IN (
         SELECT id FROM jobs WHERE parent_job_id = $1 AND user_id = $2
       )`,
    [plan.id, userId],
  );
  await transaction.query(
    `UPDATE agent_runs
     SET status = 'failed', failure_class = 'cancelled',
         escalation_reason = '批量计划已取消', finished_at = now()
     WHERE user_id = $2
       AND status = 'running'
       AND job_id IN (
         SELECT id FROM jobs WHERE parent_job_id = $1 AND user_id = $2
       )`,
    [plan.id, userId],
  );
  await appendPlanEvent(transaction, plan, "job.canceled", {
    status: "cancelled",
    reason,
  });
}

async function retryFailedPlan(
  transaction: BatchPlanTransaction,
  plan: BatchPlanJobRecord,
  userId: string,
  reason: string,
  audit: BatchPlanAuditContext,
): Promise<void> {
  if (!canRetryBatchPlan(plan.status)) {
    throw new BatchPlanRepositoryError(
      "BATCH_PLAN_INVALID",
      `批量计划状态 ${plan.status} 不能重试`,
      { status: plan.status },
    );
  }
  const firstStepKey = plan.metadata.stepKeys[0] ?? WORKER_JOB_STEPS[0];
  const failedChildren = await transaction.query<{
    id: string;
    work_id: string;
    branch_id: string;
    user_id: string;
    chapter_id: string;
    status: string;
    current_step: string;
    checkpoint: unknown;
    checkpoint_version: number;
  }>(
    `SELECT id, work_id, branch_id, user_id, chapter_id, status, current_step,
            checkpoint, checkpoint_version
     FROM jobs
     WHERE parent_job_id = $1 AND user_id = $2
       AND type = 'generate_chapter' AND status = 'failed'
     FOR UPDATE`,
    [plan.id, userId],
  );
  const resumeStepByChapter = new Map<string, string>();
  const recoveryByChild = new Map<
    string,
    {
      resumeStep: string;
      previousCheckpoint: ReturnType<typeof generationCheckpointSchema.parse>;
      checkpointVersion: number;
      checkpoint: ReturnType<typeof generationCheckpointSchema.parse>;
    }
  >();
  for (const child of failedChildren.rows) {
    const steps = await transaction.query<{ step_key: string; status: string }>(
      `SELECT step_key, status FROM job_steps WHERE job_id = $1 AND user_id = $2`,
      [child.id, userId],
    );
    const resumeStep = resolveRecoveryStep(
      WORKER_JOB_STEPS,
      steps.rows.map((step) => ({
        stepKey: step.step_key,
        status: step.status as
          "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled",
      })),
    ).step;
    const previousCheckpoint = generationCheckpointSchema.parse(child.checkpoint);
    const checkpointVersion = child.checkpoint_version + 1;
    const checkpoint = generationCheckpointSchema.parse({
      schemaVersion: 1,
      revision: checkpointVersion,
      step: resumeStep,
      inputHash: previousCheckpoint.inputHash,
      outputRefs: previousCheckpoint.outputRefs,
      payload: previousCheckpoint.payload,
    });
    resumeStepByChapter.set(child.chapter_id, resumeStep);
    recoveryByChild.set(child.id, {
      resumeStep,
      previousCheckpoint,
      checkpointVersion,
      checkpoint,
    });
  }

  const failedChapters = await transaction.query<{ id: string; chapter_id: string | null }>(
    `SELECT id, chapter_id
     FROM job_work_items
     WHERE job_id = $1 AND user_id = $2 AND item_type = 'chapter' AND status = 'failed'`,
    [plan.id, userId],
  );
  for (const chapter of failedChapters.rows) {
    const resumeStep =
      (chapter.chapter_id ? resumeStepByChapter.get(chapter.chapter_id) : undefined) ??
      firstStepKey;
    await transaction.query(
      `UPDATE job_work_items SET status = 'pending', attempt = attempt + 1, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [chapter.id, userId],
    );
    if (chapter.chapter_id) {
      await transaction.query(
        `UPDATE job_work_items
         SET status = CASE
           WHEN work_item_key = $3 THEN 'ready'
           WHEN status IN ('failed', 'running') THEN 'pending'
           ELSE status
         END,
         updated_at = now()
         WHERE job_id = $1 AND user_id = $2 AND item_type = 'step' AND chapter_id = $4`,
        [plan.id, userId, `step:${chapter.chapter_id}:${resumeStep}`, chapter.chapter_id],
      );
    }
  }
  await transaction.query(
    `UPDATE job_work_items SET status = 'pending', updated_at = now()
     WHERE job_id = $1 AND user_id = $2 AND item_type = 'volume' AND status = 'failed'`,
    [plan.id, userId],
  );

  for (const child of failedChildren.rows) {
    const recovery = recoveryByChild.get(child.id);
    if (!recovery) {
      continue;
    }
    const { resumeStep, checkpointVersion, checkpoint } = recovery;
    await transaction.query(
      `INSERT INTO job_checkpoints (
         id, job_id, work_id, branch_id, user_id, step_key, schema_version,
         revision, attempt, input_hash, output_refs, payload, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 0, $8, $9::jsonb, $10::jsonb, now())
       ON CONFLICT (job_id, revision) DO NOTHING`,
      [
        uuidv7(),
        child.id,
        child.work_id,
        child.branch_id,
        child.user_id,
        resumeStep,
        checkpointVersion,
        checkpoint.inputHash,
        JSON.stringify(checkpoint.outputRefs),
        JSON.stringify(checkpoint),
      ],
    );
    await transaction.query(
      `UPDATE jobs
       SET status = 'queued', current_step = $2, checkpoint = $3::jsonb,
           checkpoint_version = $4, error_code = NULL, error_message = NULL,
           finished_at = NULL, updated_at = now()
       WHERE id = $1 AND user_id = $5`,
      [child.id, resumeStep, JSON.stringify(checkpoint), checkpointVersion, userId],
    );
    await transaction.query(
      `INSERT INTO job_recoveries (
         id, job_id, work_id, branch_id, user_id, actor_id, action, reason,
         idempotency_key, from_status, from_checkpoint_version, checkpoint_version,
         resume_step, correlation_id, created_at
       ) VALUES ($1, $2, $3, $4, $5, $5, 'retry', $6, $7, 'failed', $8, $9, $10, $11, now())
       ON CONFLICT (job_id, idempotency_key) DO NOTHING`,
      [
        uuidv7(),
        child.id,
        child.work_id,
        child.branch_id,
        child.user_id,
        reason,
        `batch-retry:${plan.id}:${child.id}`,
        child.checkpoint_version,
        checkpointVersion,
        resumeStep,
        audit.requestId,
      ],
    );
  }
  await updatePlanStatus(transaction, plan.id, userId, {
    status: "running",
    currentStep: "execute",
    errorCode: null,
    errorMessage: null,
    finished: false,
  });
  await appendPlanEvent(transaction, plan, "job.recovered", {
    status: "running",
    reason,
    resumedChapters: failedChapters.rows.length,
  });
}

async function updatePlanStatus(
  transaction: BatchPlanTransaction,
  planId: string,
  userId: string,
  input: {
    status: string;
    currentStep: string;
    errorCode: string | null;
    errorMessage: string | null;
    started?: boolean;
    finished: boolean;
  },
): Promise<void> {
  await transaction.query(
    `UPDATE jobs
     SET status = $3,
         current_step = $4,
         error_code = $5,
         error_message = $6,
         started_at = CASE WHEN $7 THEN COALESCE(started_at, now()) ELSE started_at END,
         finished_at = CASE WHEN $8 THEN now() ELSE NULL END,
         updated_at = now()
     WHERE id = $1 AND user_id = $2 AND type = 'batch_plan'`,
    [
      planId,
      userId,
      input.status,
      input.currentStep,
      input.errorCode,
      input.errorMessage,
      input.started === true,
      input.finished,
    ],
  );
}

async function appendPlanEvent(
  transaction: BatchPlanTransaction,
  plan: BatchPlanJobRecord,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await transaction.query(
    `INSERT INTO job_events (
       id, job_id, work_id, branch_id, user_id, sequence, event_type, payload, occurred_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       COALESCE((SELECT max(sequence) FROM job_events WHERE job_id = $2), 0) + 1,
       $6, $7::jsonb, now()
     )
     ON CONFLICT (job_id, sequence) DO NOTHING`,
    [
      uuidv7(),
      plan.id,
      plan.workId,
      plan.branchId,
      plan.userId,
      eventType,
      JSON.stringify(payload),
    ],
  );
}

async function findIdempotentAction(
  transaction: BatchPlanTransaction,
  userId: string,
  scope: string,
  idempotencyKey: string,
): Promise<{ resourceId: string } | null> {
  const result = await transaction.query<{ resource_id: string }>(
    `SELECT resource_id
     FROM idempotency_records
     WHERE user_id = $1 AND scope = $2 AND idempotency_key = $3
     LIMIT 1`,
    [userId, scope, idempotencyKey],
  );
  const row = result.rows[0];
  return row ? { resourceId: row.resource_id } : null;
}

async function rememberIdempotentAction(
  transaction: BatchPlanTransaction,
  userId: string,
  scope: string,
  idempotencyKey: string,
  planId: string,
): Promise<void> {
  await transaction.query(
    `INSERT INTO idempotency_records (
       id, user_id, scope, idempotency_key, resource_type, resource_id, created_at
     ) VALUES ($1, $2, $3, $4, 'batch_plan', $5, now())
     ON CONFLICT (user_id, scope, idempotency_key) DO NOTHING`,
    [uuidv7(), userId, scope, idempotencyKey, planId],
  );
}

async function insertAuditLog(
  transaction: BatchPlanTransaction,
  input: {
    userId: string;
    planId: string;
    action: string;
    audit: BatchPlanAuditContext;
  },
): Promise<void> {
  await transaction.query(
    `INSERT INTO audit_logs (
       id, actor_id, action, target_type, target_id, decision,
       correlation_id, ip, user_agent, created_at
     ) VALUES ($1, $2, $3, 'job', $4, 'allowed', $5, $6, $7, now())`,
    [
      uuidv7(),
      input.userId,
      input.action,
      input.planId,
      input.audit.requestId,
      input.audit.ip,
      input.audit.userAgent,
    ],
  );
}
