import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  BATCH_REVIEW_PREDICATE_VERSION,
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
  calculateBatchBudgetAllocation,
  deriveChapterWorkItemStatus,
  derivePlanExecutionStatus,
  deriveVolumeWorkItemStatus,
  detectForcedHumanReviewEvents,
  evaluateBatchReviewEligibility,
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
      const budgetUsage = await batchBudgetUsage(transaction, plan, chapterId);
      const budgetAllocation = calculateBatchBudgetAllocation({
        chapterMaxCostCny: plan.metadata.costBudgetPolicy.chapterMaxCostCny,
        volumeMaxCostCny: plan.metadata.costBudgetPolicy.volumeMaxCostCny,
        taskMaxCostCny: plan.metadata.costBudgetPolicy.taskMaxCostCny,
        perTenThousandCharsMaxCostCny: plan.metadata.costBudgetPolicy.perTenThousandCharsMaxCostCny,
        projectedCharacters: plan.metadata.projectedCharacters,
        taskCostUsedCny: budgetUsage.taskCostUsedCny,
        volumeCostUsedCny: budgetUsage.volumeCostUsedCny,
      });
      if (budgetAllocation.allowedCostCny <= 0) {
        throw new BatchPlanExecutionError(
          "BATCH_BUDGET_EXHAUSTED",
          "批量任务已达到成本上限，后续章节已暂停",
          {
            bindingScope: budgetAllocation.bindingScope,
            taskCostUsedCny: budgetUsage.taskCostUsedCny,
            volumeCostUsedCny: budgetUsage.volumeCostUsedCny,
          },
        );
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
            maxCostCny: budgetAllocation.allowedCostCny,
            maxTokens: 30_000,
            maxRevisionRounds: 2,
            bindingScope: budgetAllocation.bindingScope,
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
      let volumeReviewQueued = false;
      if (nextChapterStatus === "waiting_review") {
        const review = await reconcileChapterReview(transaction, plan, chapterId, chapter.id);
        if (
          review === "auto_approved" ||
          review === "volume_deferred" ||
          review === "volume_review_queued"
        ) {
          await transaction.query(
            `UPDATE job_work_items SET status = 'succeeded', updated_at = now()
             WHERE id = $1 AND user_id = $2`,
            [chapter.id, userId],
          );
        }
        volumeReviewQueued = review === "volume_review_queued";
      }

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
          const nextVolumeStatus = volumeReviewQueued
            ? "waiting_review"
            : deriveVolumeWorkItemStatus(siblings.rows.map((row) => row.status));
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

  async pausePlanForBudget(
    userId: string,
    plan: WorkerBatchPlanContext,
    failure: { code: string; message: string; details: Record<string, unknown> },
  ): Promise<void> {
    await this.withTenant(userId, async (transaction) => {
      await transaction.query(
        `UPDATE jobs
         SET status = 'paused', current_step = 'budget', error_code = $2,
             error_message = $3, updated_at = now()
         WHERE id = $1 AND user_id = $4`,
        [plan.id, failure.code, failure.message, userId],
      );
      await transaction.query(
        `UPDATE job_work_items
         SET status = CASE WHEN status = 'running' THEN 'paused' ELSE status END,
             updated_at = now()
         WHERE job_id = $1 AND user_id = $2`,
        [plan.id, userId],
      );
      await appendPlanEvent(transaction, plan, "job.budget.exceeded", {
        code: failure.code,
        message: failure.message,
        ...failure.details,
      });
    });
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
    readonly code: "MODEL_CONFIG_REQUIRED" | "CHILD_JOB_MISSING" | "BATCH_BUDGET_EXHAUSTED",
    message: string,
    readonly details: Record<string, unknown> = {},
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

async function batchBudgetUsage(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
): Promise<{ taskCostUsedCny: number; volumeCostUsedCny: number }> {
  const task = await transaction.query<{ cost_cny: string }>(
    `SELECT COALESCE(sum((cost ->> 'costCny')::numeric), 0)::text AS cost_cny
     FROM jobs
     WHERE parent_job_id = $1 AND user_id = $2`,
    [plan.id, plan.userId],
  );
  const volume = await transaction.query<{ cost_cny: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, level, chapter_id
       FROM outline_nodes
       WHERE chapter_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
       UNION ALL
       SELECT parent.id, parent.parent_id, parent.level, parent.chapter_id
       FROM outline_nodes parent
       INNER JOIN ancestors child ON child.parent_id = parent.id
       WHERE parent.user_id = $2 AND parent.work_id = $3 AND parent.branch_id = $4
     ), volume_node AS (
       SELECT id FROM ancestors WHERE level = 'volume' LIMIT 1
     ), volume_item AS (
       SELECT id FROM job_work_items
       WHERE job_id = $5 AND user_id = $2 AND item_type = 'volume'
         AND outline_node_id = (SELECT id FROM volume_node)
       LIMIT 1
     ), volume_chapters AS (
       SELECT chapter_id FROM job_work_items
       WHERE job_id = $5 AND user_id = $2 AND item_type = 'chapter'
         AND parent_id = (SELECT id FROM volume_item)
     )
     SELECT COALESCE(sum((job.cost ->> 'costCny')::numeric), 0)::text AS cost_cny
     FROM jobs job
     INNER JOIN volume_chapters chapter ON chapter.chapter_id = job.chapter_id
     WHERE job.parent_job_id = $5 AND job.user_id = $2`,
    [chapterId, plan.userId, plan.workId, plan.branchId, plan.id],
  );
  return {
    taskCostUsedCny: Number(task.rows[0]?.cost_cny ?? 0),
    volumeCostUsedCny: Number(volume.rows[0]?.cost_cny ?? 0),
  };
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

async function reconcileChapterReview(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
  workItemId: string,
): Promise<"queued" | "auto_approved" | "volume_deferred" | "volume_review_queued" | "none"> {
  const result = await transaction.query<{
    id: string;
    number: number;
    title: string;
    version: number;
    current_version_id: string | null;
  }>(
    `SELECT id, number, title, version, current_version_id
     FROM chapters
     WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
    [chapterId, plan.userId, plan.workId, plan.branchId],
  );
  const chapter = result.rows[0];
  if (!chapter) {
    return "none";
  }
  const quality = await reviewQualityFacts(
    transaction,
    plan.userId,
    plan.workId,
    plan.branchId,
    chapterId,
    chapter.current_version_id,
  );
  const outlineReady = await outlineReviewReady(transaction, plan, chapterId);
  const riskApprovalReady = await riskApprovalReviewReady(transaction, plan, chapterId);
  const safety = await reviewSafetyFacts(transaction, plan, chapterId, chapter.current_version_id);
  const hasGoldenThreeLock = await goldenThreeLocked(transaction, plan, chapter.number);
  const volumeLastChapterNumber = await volumeLastChapterNumberFor(transaction, plan, chapterId);
  if (
    volumeLastChapterNumber !== null &&
    chapter.number === volumeLastChapterNumber &&
    plan.metadata.approvalMode !== "per_chapter"
  ) {
    await queueVolumeReview(transaction, plan, chapterId, workItemId, chapter.number);
    return "volume_review_queued";
  }
  if (
    plan.metadata.approvalMode === "per_volume" &&
    volumeLastChapterNumber !== null &&
    chapter.number < volumeLastChapterNumber
  ) {
    return "volume_deferred";
  }
  const eligibility = evaluateBatchReviewEligibility({
    approvalMode: plan.metadata.approvalMode,
    targetType: "chapter",
    chapterNumber: chapter.number,
    volumeLastChapterNumber,
    readiness: {
      canProceed: outlineReady && riskApprovalReady,
      status: outlineReady && riskApprovalReady ? "ready" : "not_ready",
      outlineReady,
      riskApprovalReady,
    },
    quality: {
      reportState: quality.reportState,
      canApprove: quality.canApprove,
      scores: quality.scores,
      severities: quality.severities,
      structuralFindingCount: quality.structuralFindingCount,
    },
    hasGoldenThreeLock,
    forcedHumanReviewEvents: detectForcedHumanReviewEvents({
      chapterContent: safety.content,
      highRiskFacts: safety.highRiskFacts,
    }),
  });
  if (eligibility.eligible) {
    const approved = await transaction.query(
      `UPDATE chapters
       SET status = 'approved', version = version + 1, updated_at = now()
       WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
         AND version = $5 AND status = 'waiting_review'
       RETURNING id`,
      [chapterId, plan.userId, plan.workId, plan.branchId, chapter.version],
    );
    if (approved.rows.length === 0) {
      await insertChapterReviewItem(transaction, plan, workItemId, chapter, {
        risk: "high",
        reasons: [
          {
            code: "READINESS_BLOCKED",
            message: "章节在自动审批前发生变化，请人工确认最新版本。",
          },
        ],
        quality,
      });
      return "queued";
    }
    await transaction.query(
      `INSERT INTO review_decisions (
         id, work_id, branch_id, user_id, chapter_id, chapter_version_id,
         action, actor_id, actor_name, reason, decided_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'approve', $4, $7, $8, now())`,
      [
        uuidv7(),
        plan.workId,
        plan.branchId,
        plan.userId,
        chapterId,
        chapter.current_version_id,
        "NovelBrain 自动审核",
        `低风险章节按 ${BATCH_REVIEW_PREDICATE_VERSION} 自动通过`,
      ],
    );
    await transaction.query(
      `INSERT INTO audit_logs (
         id, actor_id, action, target_type, target_id, decision,
         correlation_id, ip, user_agent, created_at
       ) VALUES ($1, $2, 'batch_review.auto_approved', 'chapter', $3, 'allowed', $4, $5, $6, now())`,
      [
        uuidv7(),
        plan.userId,
        chapterId,
        `batch-auto:${plan.id}:${chapterId}`,
        "worker",
        "batch-review-predicate",
      ],
    );
    return "auto_approved";
  }

  const reasons = eligibility.reasons.map((code) => ({
    code,
    message: reviewReasonMessage(code),
  }));
  await insertChapterReviewItem(transaction, plan, workItemId, chapter, {
    risk: eligibility.risk,
    reasons,
    quality,
  });
  return "queued";
}

interface ReviewChapterRow {
  id: string;
  number: number;
  title: string;
  version: number;
  current_version_id: string | null;
}

async function insertChapterReviewItem(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  workItemId: string,
  chapter: ReviewChapterRow,
  input: {
    risk: "low" | "medium" | "high";
    reasons: Array<{ code: string; message: string }>;
    quality: Awaited<ReturnType<typeof reviewQualityFacts>>;
  },
): Promise<void> {
  const scoreAverage =
    input.quality.scores.length > 0
      ? input.quality.scores.reduce((total, score) => total + score, 0) /
        input.quality.scores.length
      : null;
  await transaction.query(
    `INSERT INTO batch_review_items (
       id, plan_id, work_item_id, work_id, branch_id, user_id,
       target_type, target_id, chapter_id, chapter_version_id, target_version,
       chapter_number, chapter_title, volume_title, status, risk, risk_reasons,
       quality, claimed_by, claimed_at, version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       'chapter', $7, $7, $8, $9,
       $10, $11, NULL, 'pending', $12, $13::jsonb,
       $14::jsonb, NULL, NULL, 1, now(), now()
     )
     ON CONFLICT (plan_id, work_item_id) DO NOTHING`,
    [
      uuidv7(),
      plan.id,
      workItemId,
      plan.workId,
      plan.branchId,
      plan.userId,
      chapter.id,
      chapter.current_version_id,
      chapter.version,
      chapter.number,
      chapter.title,
      input.risk,
      JSON.stringify(input.reasons),
      JSON.stringify({
        reportState: input.quality.reportState,
        canApprove: input.quality.canApprove,
        scoreAverage,
        blockerCount: input.quality.severities.filter(
          (severity) => severity === "P0" || severity === "P1",
        ).length,
      }),
    ],
  );
}

async function queueVolumeReview(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
  chapterWorkItemId: string,
  chapterNumber: number,
): Promise<void> {
  const volume = await transaction.query<{
    volume_node_id: string;
    volume_title: string;
    volume_work_item_id: string;
    target_version: number;
  }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, level, title
       FROM outline_nodes
       WHERE chapter_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
       UNION ALL
       SELECT parent.id, parent.parent_id, parent.level, parent.title
       FROM outline_nodes parent
       INNER JOIN ancestors child ON child.parent_id = parent.id
       WHERE parent.user_id = $2 AND parent.work_id = $3 AND parent.branch_id = $4
     )
     SELECT ancestors.id AS volume_node_id,
            ancestors.title AS volume_title,
            item.id AS volume_work_item_id,
            COALESCE((item.input_version ->> 'outlineVersion')::integer, 1) AS target_version
     FROM ancestors
     INNER JOIN job_work_items item
       ON item.id = (SELECT parent_id FROM job_work_items WHERE id = $5 AND user_id = $2)
     WHERE ancestors.level = 'volume'
     LIMIT 1`,
    [chapterId, plan.userId, plan.workId, plan.branchId, chapterWorkItemId],
  );
  const row = volume.rows[0];
  if (!row) {
    return;
  }
  await transaction.query(
    `UPDATE job_work_items
     SET status = 'waiting_review', updated_at = now()
     WHERE id = $1 AND user_id = $2`,
    [row.volume_work_item_id, plan.userId],
  );
  await transaction.query(
    `INSERT INTO batch_review_items (
       id, plan_id, work_item_id, work_id, branch_id, user_id,
       target_type, target_id, chapter_id, chapter_version_id, target_version,
       chapter_number, chapter_title, volume_title, status, risk, risk_reasons,
       quality, claimed_by, claimed_at, version, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       'volume', $7, NULL, NULL, $8,
       $9, NULL, $10, 'pending', 'high', $11::jsonb,
       $12::jsonb, NULL, NULL, 1, now(), now()
     )
     ON CONFLICT (plan_id, work_item_id) DO NOTHING`,
    [
      uuidv7(),
      plan.id,
      row.volume_work_item_id,
      plan.workId,
      plan.branchId,
      plan.userId,
      row.volume_node_id,
      row.target_version,
      chapterNumber,
      row.volume_title,
      JSON.stringify([
        {
          code: "VOLUME_BOUNDARY",
          message: "卷末必须由作者人工确认。",
        },
        ...(plan.metadata.approvalMode === "per_volume"
          ? [
              {
                code: "MANUAL_APPROVAL_MODE",
                message: "当前批量计划采用逐卷审批。",
              },
            ]
          : []),
      ]),
      JSON.stringify({
        reportState: "missing",
        canApprove: false,
        scoreAverage: null,
        blockerCount: 0,
      }),
    ],
  );
}

async function reviewQualityFacts(
  transaction: BatchTransaction,
  userId: string,
  workId: string,
  branchId: string,
  chapterId: string,
  chapterVersionId: string | null,
): Promise<{
  reportState: "fresh" | "missing" | "stale";
  canApprove: boolean;
  scores: number[];
  severities: Array<"P0" | "P1" | "P2" | "P3">;
  structuralFindingCount: number;
}> {
  if (!chapterVersionId) {
    return {
      reportState: "missing",
      canApprove: false,
      scores: [],
      severities: [],
      structuralFindingCount: 0,
    };
  }
  const report = await transaction.query<{
    rubric_version: string;
    rule_version: string;
    dimensions: Array<{ score?: number }>;
  }>(
    `SELECT rubric_version, rule_version, dimensions
     FROM quality_reports
     WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
       AND chapter_id = $4 AND chapter_version_id = $5
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, workId, branchId, chapterId, chapterVersionId],
  );
  const latest = report.rows[0];
  const findings = await transaction.query<{ severity: string; structural: boolean }>(
    `SELECT severity, structural
     FROM quality_findings
     WHERE user_id = $1 AND chapter_id = $2 AND chapter_version_id = $3 AND status = 'open'`,
    [userId, chapterId, chapterVersionId],
  );
  const severities = findings.rows.map((row) => row.severity as "P0" | "P1" | "P2" | "P3");
  const reportState = !latest
    ? "missing"
    : latest.rubric_version !== "m1-quality-rubric-v1" ||
        latest.rule_version !== "m1-critic-rules-v1"
      ? "stale"
      : "fresh";
  const scores = (latest?.dimensions ?? [])
    .map((dimension) => dimension.score)
    .filter((score): score is number => typeof score === "number");
  return {
    reportState,
    canApprove:
      reportState === "fresh" &&
      !severities.some((severity) => severity === "P0" || severity === "P1"),
    scores,
    severities,
    structuralFindingCount: findings.rows.filter((finding) => finding.structural).length,
  };
}

async function reviewSafetyFacts(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
  chapterVersionId: string | null,
): Promise<{
  content: string;
  highRiskFacts: Array<{ subject: string; predicate: string; object: string }>;
}> {
  const content = chapterVersionId
    ? await transaction.query<{ content: string }>(
        `SELECT content FROM chapter_versions
         WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
        [chapterVersionId, plan.userId, plan.workId, plan.branchId],
      )
    : { rows: [] };
  const facts = await transaction.query<{
    subject: string;
    predicate: string;
    object: string;
  }>(
    `SELECT subject, predicate, object
     FROM fact_proposals
     WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
       AND chapter_id = $4 AND status = 'proposed' AND risk = 'high'
     ORDER BY created_at
     LIMIT 20`,
    [plan.userId, plan.workId, plan.branchId, chapterId],
  );
  return {
    content: content.rows[0]?.content ?? "",
    highRiskFacts: facts.rows,
  };
}

async function outlineReviewReady(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
): Promise<boolean> {
  const result = await transaction.query<{ ready: boolean }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, locked
       FROM outline_nodes
       WHERE chapter_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
       UNION ALL
       SELECT parent.id, parent.parent_id, parent.locked
       FROM outline_nodes parent
       INNER JOIN ancestors child ON child.parent_id = parent.id
       WHERE parent.user_id = $2 AND parent.work_id = $3 AND parent.branch_id = $4
     )
     SELECT count(*) > 0 AND bool_and(locked) AS ready FROM ancestors`,
    [chapterId, plan.userId, plan.workId, plan.branchId],
  );
  return result.rows[0]?.ready === true;
}

async function riskApprovalReviewReady(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
): Promise<boolean> {
  const result = await transaction.query<{ pending: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1 FROM fact_proposals
         WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
           AND chapter_id = $4 AND status = 'proposed' AND risk = 'high'
       ) OR EXISTS (
         SELECT 1 FROM setting_change_requests
         WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
           AND status = 'pending'
       ) OR EXISTS (
         SELECT 1 FROM story_bible_change_requests
         WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
           AND status IN ('pending', 'analyzing') AND risk = 'high'
       )
     ) AS pending`,
    [plan.userId, plan.workId, plan.branchId, chapterId],
  );
  return result.rows[0]?.pending === false;
}

async function goldenThreeLocked(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterNumber: number,
): Promise<boolean> {
  if (chapterNumber > 3) {
    return true;
  }
  const result = await transaction.query<{ locked: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM golden_three_locks
       WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
     ) AS locked`,
    [plan.userId, plan.workId, plan.branchId],
  );
  return result.rows[0]?.locked === true;
}

async function volumeLastChapterNumberFor(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  chapterId: string,
): Promise<number | null> {
  const result = await transaction.query<{ last_chapter_number: number | null }>(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_id, level
       FROM outline_nodes
       WHERE chapter_id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
       UNION ALL
       SELECT parent.id, parent.parent_id, parent.level
       FROM outline_nodes parent
       INNER JOIN ancestors child ON child.parent_id = parent.id
       WHERE parent.user_id = $2 AND parent.work_id = $3 AND parent.branch_id = $4
     ), volume AS (
       SELECT id FROM ancestors WHERE level = 'volume' LIMIT 1
     ), descendants AS (
       SELECT id FROM volume
       UNION ALL
       SELECT child.id
       FROM outline_nodes child
       INNER JOIN descendants parent ON child.parent_id = parent.id
       WHERE child.user_id = $2 AND child.work_id = $3 AND child.branch_id = $4
     )
     SELECT max(c.number) AS last_chapter_number
     FROM chapters c
     INNER JOIN outline_nodes node ON node.chapter_id = c.id
     WHERE node.id IN (SELECT id FROM descendants)
       AND c.user_id = $2 AND c.work_id = $3 AND c.branch_id = $4`,
    [chapterId, plan.userId, plan.workId, plan.branchId],
  );
  return result.rows[0]?.last_chapter_number ?? null;
}

function reviewReasonMessage(code: string): string {
  switch (code) {
    case "MANUAL_APPROVAL_MODE":
      return "当前批量计划要求作者人工确认。";
    case "VOLUME_BOUNDARY":
      return "卷末章节必须由作者人工确认。";
    case "OUTLINE_NOT_LOCKED":
      return "章节大纲或上级大纲尚未锁定。";
    case "PENDING_HIGH_RISK_APPROVAL":
      return "仍有高风险事实或设定修改等待确认。";
    case "READINESS_BLOCKED":
      return "本章生成准备度尚未达到自动通过条件。";
    case "GOLDEN_THREE_UNLOCKED":
      return "黄金三章尚未锁定。";
    case "QUALITY_REPORT_MISSING":
      return "尚未生成当前章节版本的质量报告。";
    case "QUALITY_REPORT_STALE":
      return "当前质量报告已过期，需要重新检查。";
    case "UNRESOLVED_P0":
      return "本章还有未解决的阻断问题。";
    case "UNRESOLVED_P1":
      return "本章还有未解决的高风险问题。";
    case "STRUCTURAL_FINDING":
      return "本章存在结构性问题，必须人工确认。";
    case "QUALITY_BELOW_THRESHOLD":
      return "六维质量评分未全部达到自动通过门槛。";
    case "QUALITY_WARNING":
      return "本章仍有质量提醒，按低风险自动通过规则转人工。";
    case "CHARACTER_DEATH":
      return "本章涉及人物死亡或生死状态变化，必须人工确认。";
    case "GOLDEN_FINGER_UPGRADE":
      return "本章涉及金手指升级或核心能力变化，必须人工确认。";
    case "LOCKED_CANON_CHANGE":
      return "本章包含已锁定事实或高风险正史变化，必须人工确认。";
    case "BRANCH_MERGE":
      return "本章涉及分支合并，必须人工确认。";
    default:
      return "本章不满足低风险自动通过条件。";
  }
}

async function appendPlanEvent(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const event = await transaction.query<{ sequence: number }>(
    `INSERT INTO job_events (
       id, job_id, work_id, branch_id, user_id, sequence, event_type, payload, occurred_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       COALESCE((SELECT max(sequence) FROM job_events WHERE job_id = $2), 0) + 1,
       $6, $7::jsonb, now()
     )
     ON CONFLICT (job_id, sequence) DO NOTHING
     RETURNING sequence`,
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
  const sequence = event.rows[0]?.sequence;
  if (sequence === undefined) {
    return;
  }
  await appendPlanNotification(transaction, plan, eventType, sequence);
}

async function appendPlanNotification(
  transaction: BatchTransaction,
  plan: WorkerBatchPlanContext,
  eventType: string,
  sequence: number,
): Promise<void> {
  const notification =
    eventType === "job.completed"
      ? {
          type: "job_completed",
          title: "批量任务已完成",
          message: "批量计划已完成，可查看结果和成本报告。",
        }
      : eventType === "job.failed"
        ? {
            type: "job_failed",
            title: "批量任务执行失败",
            message: "批量计划需要处理失败项后重试。",
          }
        : eventType === "job.waiting_review"
          ? {
              type: "review_required",
              title: "批量任务等待审核",
              message: "批量计划有新的章节或卷边界待审核。",
            }
          : null;
  if (!notification) {
    return;
  }
  await transaction.query(
    `INSERT INTO notifications (
       id, user_id, work_id, branch_id, type, target_type, target_id,
       payload, dedupe_key, read_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, 'job', $6, $7::jsonb, $8, NULL, now())
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      uuidv7(),
      plan.userId,
      plan.workId,
      plan.branchId,
      notification.type,
      plan.id,
      JSON.stringify({
        title: notification.title,
        message: notification.message,
        href: `/workspace/${plan.workId}/batch`,
      }),
      `job:${plan.id}:${eventType}:${sequence}`,
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
