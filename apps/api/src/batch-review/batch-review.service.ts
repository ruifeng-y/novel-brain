import { Injectable } from "@nestjs/common";
import type {
  BatchReviewDecision,
  BatchReviewDecisionData,
  BatchReviewQueueItem,
  BatchReviewQueueQuery,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchPlanQueue } from "../batch-plan/batch-plan.queue";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchReviewRepository, BatchReviewRepositoryError } from "./batch-review.repository";
import type {
  BatchReviewAuditContext,
  BatchReviewContext,
  BatchReviewQueuePage,
} from "./batch-review.repository";

@Injectable()
export class BatchReviewService {
  constructor(
    private readonly repository: BatchReviewRepository,
    private readonly batchQueue: BatchPlanQueue,
  ) {}

  async list(
    userId: string,
    context: BatchReviewContext,
    query: BatchReviewQueueQuery,
  ): Promise<BatchReviewQueuePage> {
    const page = await this.repository.listQueue(userId, context, query);
    if (!page) {
      throw new ApiError(404, "BATCH_REVIEW_CONTEXT_NOT_FOUND", "作品或分支不存在或无权访问");
    }
    return page;
  }

  async claim(
    userId: string,
    context: BatchReviewContext,
    itemIds: string[],
  ): Promise<BatchReviewQueueItem[]> {
    try {
      const items = await this.repository.claim(userId, context, itemIds);
      if (!items) {
        throw new ApiError(404, "BATCH_REVIEW_CONTEXT_NOT_FOUND", "作品或分支不存在或无权访问");
      }
      return items;
    } catch (error) {
      throw repositoryError(error);
    }
  }

  async decide(
    userId: string,
    context: BatchReviewContext,
    idempotencyKey: string,
    decisions: BatchReviewDecision[],
    audit: BatchReviewAuditContext,
  ): Promise<{ data: BatchReviewDecisionData; replayed: boolean }> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的 Idempotency-Key");
    }
    try {
      const outcome = await this.repository.decide(userId, context, key, decisions, audit);
      if (!outcome) {
        throw new ApiError(404, "BATCH_REVIEW_CONTEXT_NOT_FOUND", "作品或分支不存在或无权访问");
      }
      for (const planId of outcome.planIds) {
        await this.batchQueue.enqueueTick({
          jobType: "batch_tick",
          planId,
          workId: context.workId,
          branchId: context.branchId,
          actorId: userId,
          idempotencyKey: `batch-review:${planId}`,
          checkpoint: { schemaVersion: 1, revision: 0, planId },
          reason: "审核决策已提交",
        });
      }
      return { data: outcome.data, replayed: outcome.replayed };
    } catch (error) {
      throw repositoryError(error);
    }
  }
}

function repositoryError(error: unknown): Error {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof BatchReviewRepositoryError) {
    const status = error.code.includes("IDEMPOTENCY") ? 409 : 409;
    return new ApiError(status, error.code, error.message, error.details);
  }
  if (error instanceof Error) {
    return error;
  }
  throw error;
}
