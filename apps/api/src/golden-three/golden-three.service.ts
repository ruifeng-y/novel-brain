import { Injectable } from "@nestjs/common";
import type {
  GoldenThreeCandidateBatchRequest,
  GoldenThreeContinuationRequest,
  GoldenThreeGenerateRequest,
  GoldenThreeGenerationJob,
  GoldenThreeLockRequest,
  GoldenThreeReviewBatchRequest,
  GoldenThreeSelectionRequest,
  GoldenThreeWorkspace,
} from "@novel-brain/contracts";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GoldenThreeRepository, type GoldenThreeContext } from "@novel-brain/golden-three";

import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GoldenThreeQueue } from "./golden-three.queue";

@Injectable()
export class GoldenThreeService {
  constructor(
    private readonly repository: GoldenThreeRepository,
    private readonly queue: GoldenThreeQueue,
  ) {}

  async workspace(userId: string, workId: string, branchId: string): Promise<GoldenThreeWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.repository.workspace(userId, context);
  }

  async createCandidates(
    userId: string,
    workId: string,
    branchId: string,
    idempotencyKey: string | undefined,
    input: GoldenThreeCandidateBatchRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWorkspace> {
    if (!idempotencyKey?.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少 Idempotency-Key");
    }
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.createCandidates(
      userId,
      context,
      idempotencyKey.trim(),
      input,
      audit,
    );
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    if (result.kind === "candidates_exist") {
      throw new ApiError(
        409,
        "GOLDEN_THREE_CANDIDATES_EXIST",
        "当前创作线已经有黄金三章候选，请在新创作线中重新生成",
      );
    }
    if (result.kind === "reference_invalid") {
      throw new ApiError(400, "GOLDEN_THREE_INVALID_CANDIDATES", result.message);
    }
    if (result.kind === "generation_in_progress") {
      throw new ApiError(
        409,
        "GOLDEN_THREE_GENERATION_IN_PROGRESS",
        "当前创作线正在生成黄金三章，请稍后刷新",
        { retryable: true },
      );
    }
    if (result.kind === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "候选已被其他操作更新，请刷新后重试");
    }
    return this.repository.workspace(userId, context);
  }

  async submitReviews(
    userId: string,
    workId: string,
    branchId: string,
    candidateId: string,
    input: GoldenThreeReviewBatchRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.submitReviews(userId, context, candidateId, input, audit);
    if (result.kind !== "ok") {
      throw this.writeError(result);
    }
    return this.repository.workspace(userId, context);
  }

  async generateCandidates(
    userId: string,
    workId: string,
    branchId: string,
    idempotencyKey: string | undefined,
    input: GoldenThreeGenerateRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeGenerationJob> {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.enqueueGeneration(
      userId,
      context,
      normalizedKey,
      input,
      audit,
    );
    if (result.kind === "candidates_exist") {
      throw new ApiError(
        409,
        "GOLDEN_THREE_CANDIDATES_EXIST",
        "当前创作线已经有黄金三章候选，请在新创作线中重新生成",
      );
    }
    if (result.kind === "chapters_empty") {
      throw new ApiError(
        409,
        "GOLDEN_THREE_CHAPTERS_EMPTY",
        `第 ${result.chapterNumbers.join("、")} 章还没有正文，请先保存章节版本再生成候选`,
        { chapterNumbers: result.chapterNumbers, retryable: true },
      );
    }
    if (result.kind === "model_config_missing") {
      throw new ApiError(409, "GOLDEN_THREE_MODEL_REQUIRED", "请先配置用于写作的作者模型");
    }
    if (result.kind === "model_generation_failed") {
      throw new ApiError(502, "GOLDEN_THREE_GENERATION_FAILED", result.message, {
        failureClass: result.failureClass,
        retryable: true,
      });
    }
    if (result.kind === "generation_in_progress") {
      throw new ApiError(
        409,
        "GOLDEN_THREE_GENERATION_IN_PROGRESS",
        "当前创作线正在生成黄金三章，请稍后刷新",
        { retryable: true },
      );
    }
    if (
      !result.replayed ||
      result.job.status === "queued" ||
      result.job.status === "preparing" ||
      result.job.status === "running"
    ) {
      await this.queue.enqueue(result.worker);
    }
    return result.job;
  }

  async generationJob(
    userId: string,
    workId: string,
    branchId: string,
    jobId: string,
  ): Promise<GoldenThreeGenerationJob> {
    const context = await this.requireContext(userId, workId, branchId);
    const loaded = await this.repository.generationJob(userId, context, jobId);
    if (!loaded) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "生成任务不存在或无权访问");
    }
    if (loaded.job.status === "queued") {
      await this.queue.enqueue(loaded.worker);
    }
    return loaded.job;
  }

  async selectCandidate(
    userId: string,
    workId: string,
    branchId: string,
    candidateId: string,
    input: GoldenThreeSelectionRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.selectCandidate(
      userId,
      context,
      candidateId,
      input,
      audit,
    );
    if (result.kind !== "ok") {
      throw this.writeError(result);
    }
    return this.repository.workspace(userId, context);
  }

  async lockCandidate(
    userId: string,
    workId: string,
    branchId: string,
    candidateId: string,
    input: GoldenThreeLockRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.lockCandidate(userId, context, candidateId, input, audit);
    if (result.kind !== "ok") {
      throw this.writeError(result);
    }
    return this.repository.workspace(userId, context);
  }

  async recordContinuation(
    userId: string,
    workId: string,
    branchId: string,
    candidateId: string,
    input: GoldenThreeContinuationRequest,
    audit: WorksAuditContext,
  ): Promise<GoldenThreeWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.recordContinuation(
      userId,
      context,
      candidateId,
      input,
      audit,
    );
    if (result.kind !== "ok") {
      throw this.writeError(result);
    }
    return this.repository.workspace(userId, context);
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<GoldenThreeContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }

  private writeError(
    result: Exclude<Awaited<ReturnType<GoldenThreeRepository["submitReviews"]>>, { kind: "ok" }>,
  ): ApiError {
    switch (result.kind) {
      case "not_found":
        return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "候选不存在或无权访问");
      case "candidates_exist":
        return new ApiError(
          409,
          "GOLDEN_THREE_CANDIDATES_EXIST",
          "当前创作线已经有黄金三章候选，请在新创作线中重新生成",
        );
      case "chapters_empty":
        return new ApiError(
          409,
          "GOLDEN_THREE_CHAPTERS_EMPTY",
          `第 ${result.chapterNumbers.join("、")} 章还没有正文，请先保存章节版本再生成候选`,
          { chapterNumbers: result.chapterNumbers, retryable: true },
        );
      case "reference_invalid":
        return new ApiError(400, "GOLDEN_THREE_INVALID_CANDIDATES", result.message);
      case "evidence_invalid":
        return new ApiError(400, "VALIDATION_INVALID", result.message);
      case "version_conflict":
        return new ApiError(409, "VERSION_CONFLICT", "候选已被其他操作更新，请刷新后重试");
      case "candidate_locked":
        return new ApiError(409, "GOLDEN_THREE_CANDIDATE_LOCKED", "候选已经锁定，不能继续修改");
      case "selection_required":
        return new ApiError(409, "GOLDEN_THREE_SELECTION_REQUIRED", "请先选定一个候选方向");
      case "continuation_required":
        return new ApiError(
          409,
          "GOLDEN_THREE_CONTINUATION_REQUIRED",
          "请先生成或登记第 2、3 章续写",
        );
      case "model_config_missing":
        return new ApiError(409, "GOLDEN_THREE_MODEL_REQUIRED", "请先配置用于写作的作者模型");
      case "model_generation_failed":
        return new ApiError(502, "GOLDEN_THREE_GENERATION_FAILED", "作者模型生成失败，请稍后重试", {
          failureClass: result.failureClass,
          retryable: true,
        });
      case "review_incomplete":
        return new ApiError(409, "GOLDEN_THREE_REVIEW_FAILED", "六维评审尚未完成", {
          completed: result.completed,
        });
      case "review_failed":
        return new ApiError(409, "GOLDEN_THREE_REVIEW_FAILED", "必需评审维度未达到 4/5，不能锁定", {
          failedDimensions: result.failedDimensions,
        });
      case "already_locked":
        return new ApiError(409, "GOLDEN_THREE_ALREADY_LOCKED", "黄金三章已经锁定");
      case "generation_in_progress":
        return new ApiError(
          409,
          "GOLDEN_THREE_GENERATION_IN_PROGRESS",
          "当前创作线正在生成黄金三章，请稍后刷新",
          { retryable: true },
        );
    }
  }
}
