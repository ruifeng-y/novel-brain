import { createHash } from "node:crypto";

import type {
  BatchReviewAction,
  BatchReviewDecision,
  BatchReviewDecisionData,
  BatchReviewDecisionResult,
  BatchReviewFinding,
  BatchReviewQueueCounts,
  BatchReviewQueueItem,
  BatchReviewQueueQuery,
  BatchReviewRiskReason,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

import type { WorksAuditContext } from "../works/works.repository";

type Transaction = Pick<PoolClient, "query">;

export interface BatchReviewContext {
  workId: string;
  branchId: string;
}

export interface BatchReviewAuditContext extends WorksAuditContext {
  userId: string;
}

export interface BatchReviewQueuePage {
  items: BatchReviewQueueItem[];
  nextCursor: string | null;
  counts: BatchReviewQueueCounts;
}

export interface BatchReviewDecisionOutcome {
  data: BatchReviewDecisionData;
  replayed: boolean;
  planIds: string[];
}

interface QueueRow {
  id: string;
  plan_id: string;
  work_item_id: string;
  target_type: "chapter" | "volume";
  target_id: string;
  chapter_id: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  volume_title: string | null;
  status: BatchReviewQueueItem["status"];
  risk: BatchReviewQueueItem["risk"];
  risk_reasons: BatchReviewRiskReason[];
  quality: BatchReviewQueueItem["quality"];
  claimed_by: string | null;
  claimed_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

interface DecisionQueueRow extends QueueRow {
  chapter_version_id: string | null;
  target_version: number;
}

interface DecisionBatchRow {
  id: string;
  request_hash: string;
  response: BatchReviewDecisionData;
}

const queueColumns = `
  id, plan_id, work_item_id, target_type, target_id, chapter_id,
  chapter_number, chapter_title, volume_title, status, risk, risk_reasons,
  quality, claimed_by, claimed_at, version, created_at, updated_at
`;

export class BatchReviewRepositoryError extends Error {
  constructor(
    readonly code:
      | "BATCH_REVIEW_CONTEXT_NOT_FOUND"
      | "BATCH_REVIEW_CLAIM_CONFLICT"
      | "BATCH_REVIEW_IDEMPOTENCY_CONFLICT",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BatchReviewRepositoryError";
  }
}

export class BatchReviewRepository {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  async listQueue(
    userId: string,
    context: BatchReviewContext,
    query: BatchReviewQueueQuery,
  ): Promise<BatchReviewQueuePage | null> {
    return this.withTenant(userId, async (transaction) => {
      if (!(await contextExists(transaction, userId, context))) {
        return null;
      }
      const cursorId = query.cursor ?? "ffffffff-ffff-7fff-bfff-ffffffffffff";
      const result = await transaction.query<QueueRow>(
        `SELECT ${queueColumns}
         FROM batch_review_items
         WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
           AND id < $4
           AND ($5::text IS NULL OR status = $5)
           AND ($6::text IS NULL OR risk = $6)
           AND ($7::text IS NULL OR target_type = $7)
         ORDER BY id DESC
         LIMIT $8`,
        [
          userId,
          context.workId,
          context.branchId,
          cursorId,
          query.status ?? null,
          query.risk ?? null,
          query.targetType ?? null,
          query.limit + 1,
        ],
      );
      const hasMore = result.rows.length > query.limit;
      const rows = hasMore ? result.rows.slice(0, query.limit) : result.rows;
      const versionIds = rows.flatMap((row) => (row.chapter_id ? [row.chapter_id] : []));
      const findingRows =
        versionIds.length === 0
          ? []
          : (
              await transaction.query<{
                id: string;
                chapter_id: string;
                severity: BatchReviewFinding["severity"];
                code: BatchReviewFinding["code"];
                quality_dimension: BatchReviewFinding["qualityDimension"];
                recommendation: string;
                quote: string | null;
              }>(
                `SELECT id, chapter_id, severity, code, quality_dimension,
                        recommendation, evidence -> 0 ->> 'quote' AS quote
                 FROM quality_findings
                 WHERE user_id = $1 AND chapter_id = ANY($2::uuid[])
                   AND status = 'open'
                 ORDER BY chapter_id, created_at`,
                [userId, versionIds],
              )
            ).rows;
      const findingsByChapter = new Map<string, BatchReviewFinding[]>();
      for (const finding of findingRows) {
        const group = findingsByChapter.get(finding.chapter_id) ?? [];
        if (group.length < 20) {
          group.push({
            id: finding.id,
            severity: finding.severity,
            code: finding.code,
            qualityDimension: finding.quality_dimension,
            recommendation: finding.recommendation,
            quote: finding.quote,
          });
          findingsByChapter.set(finding.chapter_id, group);
        }
      }
      const countResult = await transaction.query<{
        total: string;
        pending: string;
        claimed: string;
        high_risk: string;
        stale: string;
      }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'pending')::text AS pending,
                count(*) FILTER (WHERE status = 'claimed')::text AS claimed,
                count(*) FILTER (WHERE risk = 'high')::text AS high_risk,
                count(*) FILTER (WHERE status = 'stale')::text AS stale
         FROM batch_review_items
         WHERE user_id = $1 AND work_id = $2 AND branch_id = $3`,
        [userId, context.workId, context.branchId],
      );
      const counts = countResult.rows[0];
      return {
        items: rows.map((row) =>
          mapQueueItem(row, row.chapter_id ? (findingsByChapter.get(row.chapter_id) ?? []) : []),
        ),
        nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
        counts: {
          total: Number(counts?.total ?? 0),
          pending: Number(counts?.pending ?? 0),
          claimed: Number(counts?.claimed ?? 0),
          highRisk: Number(counts?.high_risk ?? 0),
          stale: Number(counts?.stale ?? 0),
        },
      };
    });
  }

  async claim(
    userId: string,
    context: BatchReviewContext,
    itemIds: string[],
  ): Promise<BatchReviewQueueItem[] | null> {
    return this.withTenant(userId, async (transaction) => {
      if (!(await contextExists(transaction, userId, context))) {
        return null;
      }
      await lockBranch(transaction, context.branchId);
      const claimed: BatchReviewQueueItem[] = [];
      for (const itemId of itemIds) {
        const result = await transaction.query<QueueRow>(
          `SELECT ${queueColumns}
           FROM batch_review_items
           WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
           FOR UPDATE`,
          [itemId, userId, context.workId, context.branchId],
        );
        const current = result.rows[0];
        if (!current) {
          throw new BatchReviewRepositoryError(
            "BATCH_REVIEW_CLAIM_CONFLICT",
            "审核项不存在或已失效",
            { itemId },
          );
        }
        if (current.status === "claimed" && current.claimed_by === userId) {
          claimed.push(mapQueueItem(current));
          continue;
        }
        if (current.status !== "pending") {
          throw new BatchReviewRepositoryError(
            "BATCH_REVIEW_CLAIM_CONFLICT",
            "审核项已被领取或处理",
            { itemId, status: current.status },
          );
        }
        const updated = await transaction.query<QueueRow>(
          `UPDATE batch_review_items
           SET status = 'claimed', claimed_by = $2, claimed_at = now(),
               version = version + 1, updated_at = now()
           WHERE id = $1 AND user_id = $2
           RETURNING ${queueColumns}`,
          [itemId, userId],
        );
        claimed.push(mapQueueItem(updated.rows[0]!));
      }
      return claimed;
    });
  }

  async decide(
    userId: string,
    context: BatchReviewContext,
    idempotencyKey: string,
    decisions: BatchReviewDecision[],
    audit: BatchReviewAuditContext,
  ): Promise<BatchReviewDecisionOutcome | null> {
    return this.withTenant(userId, async (transaction) => {
      if (!(await contextExists(transaction, userId, context))) {
        return null;
      }
      await lockBranch(transaction, context.branchId);
      await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `batch-review:${userId}:${context.workId}:${context.branchId}:${idempotencyKey}`,
      ]);
      const requestHash = hashDecisionRequest(decisions);
      const existing = await transaction.query<DecisionBatchRow>(
        `SELECT id, request_hash, response
         FROM batch_review_decision_batches
         WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 AND idempotency_key = $4`,
        [userId, context.workId, context.branchId, idempotencyKey],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) {
          throw new BatchReviewRepositoryError(
            "BATCH_REVIEW_IDEMPOTENCY_CONFLICT",
            "相同 Idempotency-Key 不能提交不同的审核决策",
          );
        }
        const replayedPlans = await transaction.query<{ plan_id: string }>(
          `SELECT DISTINCT item.plan_id
           FROM batch_review_decisions decision
           INNER JOIN batch_review_items item ON item.id = decision.queue_item_id
           WHERE decision.batch_id = $1 AND decision.user_id = $2`,
          [existing.rows[0].id, userId],
        );
        return {
          data: existing.rows[0].response,
          replayed: true,
          planIds: replayedPlans.rows.map((row) => row.plan_id),
        };
      }

      const batchId = uuidv7();
      await transaction.query(
        `INSERT INTO batch_review_decision_batches (
           id, work_id, branch_id, user_id, idempotency_key, request_hash, response, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, now())`,
        [batchId, context.workId, context.branchId, userId, idempotencyKey, requestHash],
      );
      const actorName = await actorDisplayName(transaction, userId);
      const results: BatchReviewDecisionResult[] = [];
      const planIds = new Set<string>();
      for (const decision of decisions) {
        try {
          const outcome = await applyDecision(transaction, {
            userId,
            context,
            batchId,
            decision,
            batchSize: decisions.length,
            audit,
            actorName,
          });
          results.push(outcome.result);
          if (outcome.planId) {
            planIds.add(outcome.planId);
          }
        } catch (error) {
          if (!(error instanceof BatchReviewRepositoryError)) {
            throw error;
          }
          results.push({
            itemId: decision.itemId,
            status: "failed",
            errorCode: error.code,
            message: error.message,
            item: null,
          });
        }
      }
      const data: BatchReviewDecisionData = {
        results,
        succeeded: results.filter(
          (result) => result.status === "approved" || result.status === "rejected",
        ).length,
        failed: results.filter((result) => result.status === "failed").length,
      };
      await transaction.query(
        `UPDATE batch_review_decision_batches
         SET response = $2::jsonb
         WHERE id = $1 AND user_id = $3`,
        [batchId, JSON.stringify(data), userId],
      );
      if (planIds.size > 0) {
        await transaction.query(
          `UPDATE jobs
           SET status = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM job_work_items failed_item
                   WHERE failed_item.job_id = jobs.id
                     AND failed_item.user_id = $1
                     AND failed_item.item_type = 'volume'
                     AND failed_item.status = 'failed'
                 ) THEN 'failed'
                 ELSE 'running'
               END,
               current_step = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM job_work_items failed_item
                   WHERE failed_item.job_id = jobs.id
                     AND failed_item.user_id = $1
                     AND failed_item.item_type = 'volume'
                     AND failed_item.status = 'failed'
                 ) THEN 'failed'
                 ELSE 'execute'
               END,
               finished_at = CASE
                 WHEN EXISTS (
                   SELECT 1 FROM job_work_items failed_item
                   WHERE failed_item.job_id = jobs.id
                     AND failed_item.user_id = $1
                     AND failed_item.item_type = 'volume'
                     AND failed_item.status = 'failed'
                 ) THEN now()
                 ELSE NULL
               END,
               updated_at = now()
           WHERE user_id = $1
             AND status NOT IN ('completed', 'failed', 'cancelled')
             AND id = ANY($2::uuid[])`,
          [userId, [...planIds]],
        );
      }
      return { data, replayed: false, planIds: [...planIds] };
    });
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: Transaction) => Promise<T>,
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

async function applyDecision(
  transaction: Transaction,
  input: {
    userId: string;
    context: BatchReviewContext;
    batchId: string;
    decision: BatchReviewDecision;
    batchSize: number;
    audit: BatchReviewAuditContext;
    actorName: string;
  },
): Promise<{ result: BatchReviewDecisionResult; planId: string | null }> {
  const queue = await transaction.query<DecisionQueueRow>(
    `SELECT ${queueColumns}, chapter_version_id, target_version
     FROM batch_review_items
     WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
     FOR UPDATE`,
    [input.decision.itemId, input.userId, input.context.workId, input.context.branchId],
  );
  const item = queue.rows[0];
  if (!item) {
    return failure(input.decision.itemId, "REVIEW_ITEM_NOT_FOUND", "审核项不存在或无权访问");
  }
  if (input.decision.action === "approve" && item.risk !== "low" && input.batchSize > 1) {
    return failure(
      input.decision.itemId,
      "BATCH_REVIEW_HIGH_RISK_REQUIRES_INDIVIDUAL_REVIEW",
      "高风险或需留意事项必须逐项确认",
      mapQueueItem(item),
    );
  }
  if (item.version !== input.decision.expectedVersion) {
    return failure(
      input.decision.itemId,
      "VERSION_CONFLICT",
      "审核项已被其他操作更新，请刷新后重试",
      mapQueueItem(item),
    );
  }
  if (item.status === "claimed" && item.claimed_by !== input.userId) {
    return failure(
      input.decision.itemId,
      "REVIEW_CLAIMED_BY_OTHER",
      "审核项已被其他操作领取",
      mapQueueItem(item),
    );
  }
  if (item.status !== "claimed") {
    return failure(
      input.decision.itemId,
      "REVIEW_ITEM_NOT_CLAIMED",
      "请先领取审核项再提交决策",
      mapQueueItem(item),
    );
  }

  const stale = await targetIsStale(transaction, input.userId, input.context, item);
  if (stale) {
    const updated = await transaction.query<QueueRow>(
      `UPDATE batch_review_items
       SET status = 'stale', version = version + 1, updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING ${queueColumns}`,
      [item.id, input.userId],
    );
    return failure(
      input.decision.itemId,
      "REVIEW_TARGET_STALE",
      "章节或质量报告已变化，请刷新审核队列",
      mapQueueItem(updated.rows[0]!),
    );
  }

  const qualityError =
    input.decision.action === "approve"
      ? await approveTarget(transaction, input.userId, input.context, item, {
          decision: input.decision,
          batchId: input.batchId,
          actorName: input.actorName,
          audit: input.audit,
        })
      : await rejectTarget(transaction, input.userId, input.context, item, {
          decision: input.decision,
          batchId: input.batchId,
          actorName: input.actorName,
          audit: input.audit,
        });
  if (qualityError) {
    await transaction.query(
      `INSERT INTO audit_logs (
         id, actor_id, action, target_type, target_id, decision,
         correlation_id, ip, user_agent, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'denied', $6, $7, $8, now())`,
      [
        uuidv7(),
        input.userId,
        `batch_review.${input.decision.action}`,
        item.target_type,
        item.target_id,
        input.audit.requestId,
        input.audit.ip,
        input.audit.userAgent,
      ],
    );
    return failure(
      input.decision.itemId,
      qualityError.code,
      qualityError.message,
      mapQueueItem(item),
    );
  }

  const nextStatus = input.decision.action === "approve" ? "approved" : "rejected";
  const updated = await transaction.query<QueueRow>(
    `UPDATE batch_review_items
     SET status = $2, version = version + 1, updated_at = now()
     WHERE id = $1 AND user_id = $3
     RETURNING ${queueColumns}`,
    [item.id, nextStatus, input.userId],
  );
  await transaction.query(
    `INSERT INTO batch_review_decisions (
       id, batch_id, queue_item_id, work_id, branch_id, user_id,
       target_type, target_id, chapter_id, action, risk, reason,
       actor_id, actor_name, expected_version, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now()
     )`,
    [
      uuidv7(),
      input.batchId,
      item.id,
      input.context.workId,
      input.context.branchId,
      input.userId,
      item.target_type,
      item.target_id,
      item.chapter_id,
      input.decision.action,
      item.risk,
      input.decision.reason ?? defaultDecisionReason(input.decision.action),
      input.userId,
      input.actorName,
      input.decision.expectedVersion,
    ],
  );
  await transaction.query(
    `UPDATE job_work_items
     SET status = $2, updated_at = now()
     WHERE id = $1 AND user_id = $3`,
    [item.work_item_id, input.decision.action === "approve" ? "succeeded" : "failed", input.userId],
  );
  await transaction.query(
    `INSERT INTO audit_logs (
       id, actor_id, action, target_type, target_id, decision,
       correlation_id, ip, user_agent, created_at
     ) VALUES ($1, $2, $3, $4, $5, 'allowed', $6, $7, $8, now())`,
    [
      uuidv7(),
      input.userId,
      `batch_review.${input.decision.action}`,
      item.target_type,
      item.target_id,
      input.audit.requestId,
      input.audit.ip,
      input.audit.userAgent,
    ],
  );
  return {
    result: {
      itemId: item.id,
      status: nextStatus,
      errorCode: null,
      message:
        nextStatus === "approved" ? "审核项已批准" : "审核项已驳回，后续可进入修改或重新生成",
      item: mapQueueItem(updated.rows[0]!),
    },
    planId: item.plan_id,
  };
}

async function approveTarget(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  item: DecisionQueueRow,
  input: {
    decision: BatchReviewDecision;
    batchId: string;
    actorName: string;
    audit: BatchReviewAuditContext;
  },
): Promise<{ code: string; message: string } | null> {
  if (item.target_type === "volume") {
    const chapters = await volumeChapters(
      transaction,
      userId,
      context,
      item.target_id,
      item.plan_id,
    );
    for (const chapter of chapters) {
      const gate = await qualityBlocker(transaction, userId, context, chapter);
      if (gate) {
        return gate;
      }
    }
    if (
      chapters.some(
        (chapter) =>
          chapter.status !== "waiting_review" &&
          chapter.status !== "approved" &&
          chapter.status !== "locked",
      )
    ) {
      return {
        code: "REVIEW_TARGET_STALE",
        message: "卷内章节状态已变化，请刷新审核队列",
      };
    }
    for (const chapter of chapters) {
      await approveChapter(transaction, userId, context, chapter, input);
    }
    return null;
  }
  const chapter = await chapterTarget(transaction, userId, context, item.chapter_id!);
  if (!chapter) {
    return { code: "REVIEW_TARGET_STALE", message: "章节已不存在" };
  }
  const gate = await qualityBlocker(transaction, userId, context, chapter);
  if (gate) {
    return gate;
  }
  await approveChapter(transaction, userId, context, chapter, input);
  return null;
}

async function rejectTarget(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  item: DecisionQueueRow,
  input: {
    decision: BatchReviewDecision;
    batchId: string;
    actorName: string;
    audit: BatchReviewAuditContext;
  },
): Promise<{ code: string; message: string } | null> {
  if (item.target_type === "volume") {
    const chapters = await volumeChapters(
      transaction,
      userId,
      context,
      item.target_id,
      item.plan_id,
    );
    if (
      chapters.some(
        (chapter) =>
          chapter.status !== "waiting_review" &&
          chapter.status !== "approved" &&
          chapter.status !== "rejected",
      )
    ) {
      return {
        code: "REVIEW_TARGET_STALE",
        message: "卷内章节状态已变化，请刷新审核队列",
      };
    }
    for (const chapter of chapters) {
      await rejectChapter(transaction, userId, chapter, input);
    }
    return null;
  }
  const chapter = await chapterTarget(transaction, userId, context, item.chapter_id!);
  if (chapter) {
    await rejectChapter(transaction, userId, chapter, input);
  }
  return null;
}

interface ChapterTarget {
  id: string;
  version: number;
  status: string;
  current_version_id: string | null;
}

async function chapterTarget(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  chapterId: string,
): Promise<ChapterTarget | null> {
  const result = await transaction.query<ChapterTarget>(
    `SELECT id, version, status, current_version_id
     FROM chapters
     WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
     FOR UPDATE`,
    [chapterId, userId, context.workId, context.branchId],
  );
  return result.rows[0] ?? null;
}

async function volumeChapters(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  volumeNodeId: string,
  planId: string,
): Promise<ChapterTarget[]> {
  const result = await transaction.query<ChapterTarget>(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM outline_nodes
       WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
       UNION ALL
       SELECT child.id
       FROM outline_nodes child
       INNER JOIN descendants parent ON child.parent_id = parent.id
       WHERE child.user_id = $2 AND child.work_id = $3 AND child.branch_id = $4
     )
     SELECT c.id, c.version, c.status, c.current_version_id
     FROM chapters c
     INNER JOIN outline_nodes node ON node.chapter_id = c.id
     INNER JOIN job_work_items item
       ON item.job_id = $5 AND item.chapter_id = c.id AND item.user_id = $2
      AND item.item_type = 'chapter'
     WHERE node.id IN (SELECT id FROM descendants)
       AND c.user_id = $2 AND c.work_id = $3 AND c.branch_id = $4
     ORDER BY c.number
     FOR UPDATE OF c`,
    [volumeNodeId, userId, context.workId, context.branchId, planId],
  );
  return result.rows;
}

async function qualityBlocker(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  chapter: ChapterTarget,
): Promise<{ code: string; message: string } | null> {
  if (!chapter.current_version_id) {
    return { code: "QUALITY_GATE_BLOCKED", message: "本章还没有可审核的正文版本" };
  }
  const report = await transaction.query<{
    id: string;
    rubric_version: string;
    rule_version: string;
  }>(
    `SELECT id, rubric_version, rule_version
     FROM quality_reports
     WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
       AND chapter_id = $4 AND chapter_version_id = $5
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, context.workId, context.branchId, chapter.id, chapter.current_version_id],
  );
  const latest = report.rows[0];
  if (
    !latest ||
    latest.rubric_version !== "m1-quality-rubric-v1" ||
    latest.rule_version !== "m1-critic-rules-v1"
  ) {
    return {
      code: "QUALITY_GATE_BLOCKED",
      message: "请先检查本章，生成当前版本的质量报告后再批准",
    };
  }
  const blockers = await transaction.query<{ severity: string }>(
    `SELECT severity
     FROM quality_findings
     WHERE user_id = $1 AND chapter_id = $2 AND chapter_version_id = $3
       AND status = 'open' AND severity IN ('P0', 'P1')
     LIMIT 1`,
    [userId, chapter.id, chapter.current_version_id],
  );
  if (blockers.rows.length > 0) {
    return {
      code: "QUALITY_GATE_BLOCKED",
      message: "本章还有阻断级质量问题，请修订后再批准",
    };
  }
  return null;
}

async function approveChapter(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  chapter: ChapterTarget,
  input: {
    decision: BatchReviewDecision;
    batchId: string;
    actorName: string;
    audit: BatchReviewAuditContext;
  },
): Promise<void> {
  if (chapter.status === "approved" || chapter.status === "locked") {
    return;
  }
  const updated = await transaction.query(
    `UPDATE chapters
     SET status = 'approved', version = version + 1, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND version = $3 AND status = 'waiting_review'
     RETURNING id`,
    [chapter.id, userId, chapter.version],
  );
  if (updated.rows.length === 0) {
    throw new BatchReviewRepositoryError(
      "BATCH_REVIEW_CLAIM_CONFLICT",
      "章节状态已变化，请刷新审核队列",
    );
  }
  await insertChapterReviewDecision(transaction, userId, context, chapter, input, "approve");
}

async function rejectChapter(
  transaction: Transaction,
  userId: string,
  chapter: ChapterTarget,
  input: {
    decision: BatchReviewDecision;
    batchId: string;
    actorName: string;
    audit: BatchReviewAuditContext;
  },
): Promise<void> {
  if (chapter.status === "rejected") {
    return;
  }
  const updated = await transaction.query(
    `UPDATE chapters
     SET status = 'rejected', version = version + 1, updated_at = now()
     WHERE id = $1 AND user_id = $2 AND version = $3
     RETURNING id`,
    [chapter.id, userId, chapter.version],
  );
  if (updated.rows.length === 0) {
    throw new BatchReviewRepositoryError(
      "BATCH_REVIEW_CLAIM_CONFLICT",
      "章节状态已变化，请刷新审核队列",
    );
  }
  await insertChapterReviewDecision(
    transaction,
    userId,
    { workId: "", branchId: "" },
    chapter,
    input,
    "reject",
  );
}

async function insertChapterReviewDecision(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  chapter: ChapterTarget,
  input: {
    decision: BatchReviewDecision;
    actorName: string;
  },
  action: BatchReviewAction,
): Promise<void> {
  const chapterContext = await transaction.query<{ work_id: string; branch_id: string }>(
    "SELECT work_id, branch_id FROM chapters WHERE id = $1 AND user_id = $2",
    [chapter.id, userId],
  );
  const row = chapterContext.rows[0];
  await transaction.query(
    `INSERT INTO review_decisions (
       id, work_id, branch_id, user_id, chapter_id, chapter_version_id,
       action, actor_id, actor_name, reason, decided_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $4, $8, $9, now())`,
    [
      uuidv7(),
      row?.work_id ?? context.workId,
      row?.branch_id ?? context.branchId,
      userId,
      chapter.id,
      chapter.current_version_id,
      action,
      input.actorName,
      input.decision.reason ?? defaultDecisionReason(action),
    ],
  );
}

async function targetIsStale(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
  item: DecisionQueueRow,
): Promise<boolean> {
  if (item.target_type === "chapter" && item.chapter_id) {
    const result = await transaction.query<{
      version: number;
      current_version_id: string | null;
    }>("SELECT version, current_version_id FROM chapters WHERE id = $1 AND user_id = $2", [
      item.chapter_id,
      userId,
    ]);
    const chapter = result.rows[0];
    return (
      !chapter ||
      chapter.version !== item.target_version ||
      chapter.current_version_id !== item.chapter_version_id
    );
  }
  if (item.target_type === "volume") {
    const result = await transaction.query<{ version: number }>(
      `SELECT version FROM outline_nodes
       WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
      [item.target_id, userId, context.workId, context.branchId],
    );
    return !result.rows[0] || result.rows[0].version !== item.target_version;
  }
  return false;
}

async function contextExists(
  transaction: Transaction,
  userId: string,
  context: BatchReviewContext,
): Promise<boolean> {
  const result = await transaction.query(
    `SELECT 1
     FROM works w
     INNER JOIN work_branches b
       ON b.work_id = w.id AND b.user_id = w.user_id
     WHERE w.id = $1 AND b.id = $2 AND w.user_id = $3 AND w.deleted_at IS NULL
     LIMIT 1`,
    [context.workId, context.branchId, userId],
  );
  return result.rows.length > 0;
}

async function actorDisplayName(transaction: Transaction, userId: string): Promise<string> {
  const result = await transaction.query<{ display_name: string }>(
    "SELECT display_name FROM users WHERE id = $1 AND deleted_at IS NULL",
    [userId],
  );
  return result.rows[0]?.display_name ?? "作者";
}

async function lockBranch(transaction: Transaction, branchId: string): Promise<void> {
  await transaction.query("SELECT pg_advisory_xact_lock(hashtext($1))", [branchId]);
}

function mapQueueItem(row: QueueRow, findings: BatchReviewFinding[] = []): BatchReviewQueueItem {
  return {
    id: row.id,
    planId: row.plan_id,
    workItemId: row.work_item_id,
    targetType: row.target_type,
    targetId: row.target_id,
    chapterId: row.chapter_id,
    chapterNumber: row.chapter_number,
    chapterTitle: row.chapter_title,
    volumeTitle: row.volume_title,
    status: row.status,
    risk: row.risk,
    riskReasons: row.risk_reasons,
    quality: row.quality,
    findings,
    claimedBy: row.claimed_by,
    claimedAt: row.claimed_at?.toISOString() ?? null,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function failure(
  itemId: string,
  errorCode: string,
  message: string,
  item: BatchReviewQueueItem | null = null,
): { result: BatchReviewDecisionResult; planId: null } {
  return {
    result: { itemId, status: "failed", errorCode, message, item },
    planId: null,
  };
}

function defaultDecisionReason(action: BatchReviewAction): string {
  return action === "approve" ? "作者通过批量审核队列批准" : "作者通过批量审核队列驳回";
}

function hashDecisionRequest(decisions: BatchReviewDecision[]): string {
  return createHash("sha256").update(JSON.stringify(decisions)).digest("hex");
}
