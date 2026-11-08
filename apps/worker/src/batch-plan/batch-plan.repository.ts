import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  batchPlanMetadataSchema,
  generateChapterJobSchema,
  generationCheckpointSchema,
  type BatchPlanMetadata,
  type BatchWorkItemStatus,
  type GenerateChapterJob,
  type GenerationJobStatus,
} from "@novel-brain/contracts";
import {
  applyBatchWorkItemStatus,
  deriveChapterWorkItemStatus,
  derivePlanExecutionStatus,
  deriveVolumeWorkItemStatus,
  isBatchPlanTerminal,
} from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

type BatchTransaction = Pick<PoolClient, "query">;

export interface WorkerBatchPlanContext {
  id: string;
  workId: string;
  branchId: string;
  userId: string;
  status: GenerationJobStatus;
  progress: number;
  metadata: BatchPlanMetadata;
}

export interface ClaimedChapter {
  chapterId: string;
  chapterItemKey: string;
  firstStepKey: string;
  resumed: boolean;
}

export interface ChildJobRecord {
  id: string;
  work_id: string;
  branch_id: string;
  user_id: string;
  chapter_id: string;
  model_config_id: string;
  type: string;
  status: GenerationJobStatus;
  current_step: string;
  idempotency_key: string;
  budget: unknown;
  checkpoint: unknown;
  checkpoint_version: number;
}

export interface PlanTickResult {
  continue: boolean;
  processed: boolean;
  status: GenerationJobStatus;
}

interface PlanRow {
  id: string;
  work_id: string;
  branch_id: string;
  user_id: string;
  status: string;
  progress: number;
  orchestration: unknown;
}

interface ChapterItemRow {
  id: string;
  work_item_key: string;
  chapter_id: string | null;
  parent_id: string | null;
  status: BatchWorkItemStatus;
}

interface StepItemRow {
  id: string;
  work_item_key: string;
  status: BatchWorkItemStatus;
}

@Injectable()
export class WorkerBatchPlanRepository implements OnModuleDestroy {
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

  async loadPlan(userId: string, planId: string): Promise<WorkerBatchPlanContext | null> {
    return this.withTenant(userId, async (transaction) => {
      const result = await transaction.query<PlanRow>(
        `SELECT j.id, j.work_id, j.branch_id, j.user_id, j.status, j.progress, j.orchestration
         FROM jobs j
         INNER JOIN works w ON w.id = j.work_id AND w.user_id = j.user_id
         WHERE j.id = $1
           AND j.user_id = $2
           AND j.type = 'batch_plan'
           AND w.deleted_at IS NULL`,
        [planId, userId],
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        workId: row.work_id,
        branchId: row.branch_id,
        userId: row.user_id,
        status: row.status as GenerationJobStatus,
        progress: row.progress,
        metadata: batchPlanMetadataSchema.parse(row.orchestration),
      };
    });
  }

  async findParentPlan(userId: string, jobId: string): Promise<string | null> {
    return this.withTenant(userId, async (transaction) => {
      const result = await transaction.query<{ parent_job_id: string | null }>(
        `SELECT parent_job_id
         FROM jobs
         WHERE id = $1 AND user_id = $2 AND type = 'generate_chapter'
         LIMIT 1`,
        [jobId, userId],
      );
      return result.rows[0]?.parent_job_id ?? null;
    });
  }

  async claimChapter(
    userId: string,
    planId: string,
  ): Promise<ClaimedChapter | "inactive" | "none"> {
    return this.withTenant(userId, async (transaction) => {
      const plan = await lockPlan(transaction, userId, planId);
      if (!plan) {
        return "inactive";
      }
      if (!["queued", "preparing", "running"].includes(plan.status)) {
        return "inactive";
      }
      const firstStepKey = plan.metadata.stepKeys[0];
      if (!firstStepKey) {
        return "none";
      }
      const result = await transaction.query<{
        step_id: string;
        step_key: string;
        step_status: BatchWorkItemStatus;
        chapter_id: string;
        chapter_key: string;
      }>(
        `SELECT s.id AS step_id, s.work_item_key AS step_key, s.status AS step_status,
                s.chapter_id, c.work_item_key AS chapter_key
         FROM job_work_items s
         INNER JOIN job_work_items c
           ON c.job_id = s.job_id
          AND c.user_id = s.user_id
          AND c.work_item_key = 'chapter:' || s.chapter_id
         WHERE s.job_id = $1
           AND s.user_id = $3
           AND s.item_type = 'step'
           AND s.work_item_key LIKE 'step:%:' || $2
           AND s.status IN ('ready', 'running')
           AND c.status IN ('pending', 'ready', 'running')
         ORDER BY s.sort_order, s.id
         FOR UPDATE OF s SKIP LOCKED
         LIMIT 1`,
        [planId, firstStepKey, userId],
      );
      const row = result.rows[0];
      if (!row) {
        return "none";
      }
      await transaction.query(
        `UPDATE job_work_items SET status = 'running', updated_at = now()
         WHERE id = $1 AND user_id = $2`,
        [row.step_id, userId],
      );
      await transaction.query(
        `UPDATE job_work_items
         SET status = 'running', updated_at = now()
         WHERE job_id = $1 AND user_id = $3
           AND work_item_key = $2 AND status IN ('pending', 'ready')`,
        [planId, row.chapter_key, userId],
      );
      return {
        chapterId: row.chapter_id,
        chapterItemKey: row.chapter_key,
        firstStepKey,
        resumed: row.step_status === "running",
      };
    });
  }

  async ensureChildJob(
    userId: string,
    plan: WorkerBatchPlanContext,
    chapterId: string,
  ): Promise<ChildJobRecord> {
    return this.withTenant(userId, async (transaction) => {
      const existing = await findChildJob(transaction, userId, plan.id, chapterId);
      if (existing) {
        return existing;
      }
      const model = await transaction.query<{ id: string }>(
        `SELECT id FROM model_configs
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
        [userId],
      );
      const modelConfigId = model.rows[0]?.id;
      if (!modelConfigId) {
        throw new BatchPlanExecutionError("MODEL_CONFIG_REQUIRED", "批量执行需要先配置正文模型");
      }
      const checkpoint = generationCheckpointSchema.parse({
        schemaVersion: 1,
        revision: 0,
        step: plan.metadata.stepKeys[0] ?? "prepare",
        inputHash: null,
        outputRefs: [],
        payload: {},
      });
      const id = uuidv7();
      const inserted = await transaction.query<ChildJobRecord>(
        `INSERT INTO jobs (
           id, work_id, branch_id, user_id, chapter_id, model_config_id, type, status,
           progress, current_step, priority, idempotency_key, budget, checkpoint,
           orchestration, cost, parent_job_id, job_type, work_item_key,
           error_code, error_message, started_at, finished_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, 'generate_chapter', 'queued',
           0, $7, $8, $9, $10::jsonb, $11::jsonb,
           NULL, $12::jsonb, $13, 'chapter', $14,
           NULL, NULL, NULL, NULL, now(), now()
         )
         ON CONFLICT DO NOTHING
         RETURNING id, work_id, branch_id, user_id, chapter_id, model_config_id, type,
                   status, current_step, idempotency_key, budget, checkpoint, checkpoint_version`,
        [
          id,
          plan.workId,
          plan.branchId,
          userId,
          chapterId,
          modelConfigId,
          plan.metadata.stepKeys[0] ?? "prepare",
          plan.metadata.scheduling.priority,
          `batch:${plan.id}:${chapterId}`,
          JSON.stringify({
            maxCostCny: 2.5,
            maxTokens: 30_000,
            maxRevisionRounds: 2,
          }),
          JSON.stringify(checkpoint),
          JSON.stringify({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 }),
          plan.id,
          `chapter:${chapterId}`,
        ],
      );
      const row = inserted.rows[0] ?? (await findChildJob(transaction, userId, plan.id, chapterId));
      if (!row) {
        throw new BatchPlanExecutionError("CHILD_JOB_MISSING", "批量章节任务创建失败");
      }
      return row;
    });
  }

  async syncChapterResult(
    userId: string,
    plan: WorkerBatchPlanContext,
    chapterId: string,
    child: ChildJobRecord,
  ): Promise<PlanTickResult> {
    return this.withTenant(userId, async (transaction) => {
      const chapterItem = await transaction.query<ChapterItemRow>(
        `SELECT id, work_item_key, chapter_id, parent_id, status
         FROM job_work_items
         WHERE job_id = $1 AND user_id = $3 AND work_item_key = $2
         FOR UPDATE`,
        [plan.id, `chapter:${chapterId}`, userId],
      );
      const chapter = chapterItem.rows[0];
      if (!chapter) {
        return {
          continue: !isBatchPlanTerminal(plan.status),
          processed: false,
          status: plan.status,
        };
      }
      const steps = await transaction.query<StepItemRow>(
        `SELECT id, work_item_key, status
         FROM job_work_items
         WHERE job_id = $1 AND user_id = $3 AND item_type = 'step' AND chapter_id = $2
         FOR UPDATE`,
        [plan.id, chapterId, userId],
      );
      const childSteps = await transaction.query<{
        step_key: string;
        status: string;
      }>(`SELECT step_key, status FROM job_steps WHERE job_id = $1 AND user_id = $2`, [
        child.id,
        userId,
      ]);
      const childStepByKey = new Map(childSteps.rows.map((step) => [step.step_key, step.status]));
      const chapterStatus = deriveChapterWorkItemStatus(child.status);
      for (const step of steps.rows) {
        const suffix = step.work_item_key.slice(`step:${chapterId}:`.length);
        const nextStatus = stepItemStatusForChild(child.status, childStepByKey.get(suffix));
        const status = applyBatchWorkItemStatus(step.status, nextStatus);
        await transaction.query(
          `UPDATE job_work_items SET status = $2, updated_at = now()
           WHERE id = $1 AND user_id = $3`,
          [step.id, status, userId],
        );
      }
      const nextChapterStatus = applyBatchWorkItemStatus(chapter.status, chapterStatus);
      await transaction.query(
        `UPDATE job_work_items SET status = $2, updated_at = now()
         WHERE id = $1 AND user_id = $3`,
        [chapter.id, nextChapterStatus, userId],
      );

      if (chapter.parent_id) {
        const siblings = await transaction.query<{ status: BatchWorkItemStatus }>(
          `SELECT status FROM job_work_items
           WHERE job_id = $1 AND user_id = $3 AND parent_id = $2 AND item_type = 'chapter'`,
          [plan.id, chapter.parent_id, userId],
        );
        const volume = await transaction.query<{
          id: string;
          work_item_key: string;
          status: BatchWorkItemStatus;
        }>(
          `SELECT id, work_item_key, status FROM job_work_items
           WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [chapter.parent_id, userId],
        );
        const volumeRow = volume.rows[0];
        if (volumeRow) {
          const nextVolumeStatus = deriveVolumeWorkItemStatus(
            siblings.rows.map((row) => row.status),
          );
          const volumeStatus = applyBatchWorkItemStatus(volumeRow.status, nextVolumeStatus);
          if (volumeStatus !== volumeRow.status) {
            await transaction.query(
              `UPDATE job_work_items SET status = $2, updated_at = now()
               WHERE id = $1 AND user_id = $3`,
              [volumeRow.id, volumeStatus, userId],
            );
          }
          if (volumeStatus === "succeeded") {
            await transaction.query(
              `UPDATE job_work_items
               SET status = 'ready', updated_at = now()
               WHERE job_id = $1
                 AND user_id = $3
                 AND item_type = 'step'
                 AND status = 'pending'
                 AND dependencies ? $2`,
              [plan.id, volumeRow.work_item_key, userId],
            );
          }
        }
      }
      return this.recomputePlanStatusInTransaction(transaction, plan, false);
    });
  }

  async recomputePlan(
    userId: string,
    plan: WorkerBatchPlanContext,
    stalled: boolean,
  ): Promise<PlanTickResult> {
    return this.withTenant(userId, async (transaction) =>
      this.recomputePlanStatusInTransaction(transaction, plan, stalled),
    );
  }

  private async recomputePlanStatusInTransaction(
    transaction: BatchTransaction,
    plan: WorkerBatchPlanContext,
    stalled: boolean,
  ): Promise<PlanTickResult> {
    const locked = await lockPlan(transaction, plan.userId, plan.id);
    if (!locked) {
      return { continue: false, processed: false, status: plan.status };
    }
    const chapters = await transaction.query<{ status: BatchWorkItemStatus }>(
      `SELECT status FROM job_work_items
       WHERE job_id = $1 AND user_id = $2 AND item_type = 'chapter'`,
      [plan.id, plan.userId],
    );
    const volumes = await transaction.query<{ status: BatchWorkItemStatus }>(
      `SELECT status FROM job_work_items
       WHERE job_id = $1 AND user_id = $2 AND item_type = 'volume'`,
      [plan.id, plan.userId],
    );
    const derived = derivePlanExecutionStatus({
      current: locked.status as GenerationJobStatus,
      chapterStatuses: chapters.rows.map((row) => row.status),
      volumeStatuses: volumes.rows.map((row) => row.status),
      approvalMode: locked.metadata.approvalMode,
    });
    let status = derived.status;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    if (stalled && status === "running" && chapters.rows.length > 0) {
      const activeChildren = await transaction.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM jobs
         WHERE parent_job_id = $1
           AND user_id = $2
           AND type = 'generate_chapter'
           AND status IN ('queued', 'preparing', 'running')`,
        [plan.id, plan.userId],
      );
      const active = Number(activeChildren.rows[0]?.count ?? 0);
      if (active === 0) {
        status = "failed";
        errorCode = "BATCH_PLAN_STALLED";
        errorMessage = "批量计划没有可执行工作项";
      }
    }
    const changed = status !== locked.status || derived.progress !== locked.progress;
    if (changed) {
      await transaction.query(
        `UPDATE jobs
         SET status = $2, progress = $3, current_step = $4,
             error_code = $5, error_message = $6,
             finished_at = CASE WHEN $7 THEN now() ELSE finished_at END,
             updated_at = now()
         WHERE id = $1 AND user_id = $8`,
        [
          plan.id,
          status,
          derived.progress,
          status === "running" ? "execute" : status,
          errorCode,
          errorMessage,
          isBatchPlanTerminal(status),
          plan.userId,
        ],
      );
      await appendPlanEvent(transaction, plan, eventForStatus(status), {
        status,
        progress: derived.progress,
      });
    }
    return {
      continue: status === "queued" || status === "preparing" || status === "running",
      processed: changed,
      status,
    };
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: BatchTransaction) => Promise<T>,
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

export class BatchPlanExecutionError extends Error {
  constructor(
    readonly code: "MODEL_CONFIG_REQUIRED" | "CHILD_JOB_MISSING",
    message: string,
  ) {
    super(message);
    this.name = "BatchPlanExecutionError";
  }
}

async function lockPlan(
  transaction: BatchTransaction,
  userId: string,
  planId: string,
): Promise<WorkerBatchPlanContext | null> {
  const result = await transaction.query<PlanRow>(
    `SELECT id, work_id, branch_id, user_id, status, progress, orchestration
     FROM jobs
     WHERE id = $1 AND user_id = $2 AND type = 'batch_plan'
     FOR UPDATE`,
    [planId, userId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        workId: row.work_id,
        branchId: row.branch_id,
        userId: row.user_id,
        status: row.status as GenerationJobStatus,
        progress: row.progress,
        metadata: batchPlanMetadataSchema.parse(row.orchestration),
      }
    : null;
}

async function findChildJob(
  transaction: BatchTransaction,
  userId: string,
  planId: string,
  chapterId: string,
): Promise<ChildJobRecord | null> {
  const result = await transaction.query<ChildJobRecord>(
    `SELECT id, work_id, branch_id, user_id, chapter_id, model_config_id, type,
            status, current_step, idempotency_key, budget, checkpoint, checkpoint_version
     FROM jobs
     WHERE parent_job_id = $1 AND user_id = $3
       AND chapter_id = $2 AND type = 'generate_chapter'
     LIMIT 1`,
    [planId, chapterId, userId],
  );
  return result.rows[0] ?? null;
}

function stepItemStatusForChild(
  childStatus: GenerationJobStatus,
  childStepStatus: string | undefined,
): BatchWorkItemStatus {
  if (childStatus === "waiting_review" || childStatus === "completed") {
    return "succeeded";
  }
  if (childStatus === "cancelled") {
    return "cancelled";
  }
  if (childStatus === "paused") {
    return "paused";
  }
  switch (childStepStatus) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "running":
      return "running";
    case "skipped":
      return "skipped";
    case "cancelled":
      return "cancelled";
    default:
      return "pending";
  }
}

function eventForStatus(status: GenerationJobStatus): string {
  switch (status) {
    case "waiting_review":
      return "job.waiting_review";
    case "completed":
      return "job.completed";
    case "failed":
      return "job.failed";
    case "cancelled":
      return "job.canceled";
    case "paused":
      return "job.paused";
    default:
      return "job.progress";
  }
}

async function appendPlanEvent(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
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

export function toGenerateChapterJob(child: ChildJobRecord): GenerateChapterJob {
  return generateChapterJobSchema.parse({
    jobId: child.id,
    jobType: "generate_chapter",
    workId: child.work_id,
    branchId: child.branch_id,
    chapterId: child.chapter_id,
    actorId: child.user_id,
    modelConfigId: child.model_config_id,
    idempotencyKey: child.idempotency_key,
    budget: child.budget,
    checkpoint: generationCheckpointSchema.parse(child.checkpoint),
  });
}
