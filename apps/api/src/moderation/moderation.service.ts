import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import type { ModerationCaseListQuery } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  ModerationAppealAlreadySubmittedError,
  ModerationAppealLimitReachedError,
  ModerationAppealNotRequiredError,
  ModerationAppealNotFoundError,
  ModerationCaseNotFoundError,
  ModerationContextNotFoundError,
  ModerationRepository,
  type ModerationContext,
} from "./moderation.repository";

@Injectable()
export class ModerationService {
  constructor(private readonly repository: ModerationRepository) {}

  list(userId: string, context: ModerationContext, query: ModerationCaseListQuery) {
    return this.withErrors(() => this.repository.list(userId, context, query));
  }

  submitAppeal(
    userId: string,
    context: ModerationContext,
    caseId: string,
    request: unknown,
    idempotencyKey: string,
  ) {
    const key = idempotencyKey.trim();
    if (!key || key.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的 Idempotency-Key");
    }
    const requestHash = sha256(JSON.stringify(request));
    return this.withErrors(async () => {
      const result = await this.repository.submitAppeal(
        userId,
        context,
        caseId,
        request,
        key,
        requestHash,
      );
      if (result === "conflict") {
        throw new ApiError(
          409,
          "MODERATION_APPEAL_IDEMPOTENCY_CONFLICT",
          "相同 Idempotency-Key 不能提交不同的申诉",
        );
      }
      return result;
    });
  }

  withdrawAppeal(userId: string, context: ModerationContext, caseId: string, appealId: string) {
    return this.withErrors(() => this.repository.withdrawAppeal(userId, context, caseId, appealId));
  }

  private async withErrors<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ModerationContextNotFoundError) {
        throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在或无权访问");
      }
      if (error instanceof ModerationCaseNotFoundError) {
        throw new ApiError(404, "MODERATION_CASE_NOT_FOUND", "内容安全记录不存在");
      }
      if (error instanceof ModerationAppealNotRequiredError) {
        throw new ApiError(409, "MODERATION_APPEAL_NOT_REQUIRED", "当前记录没有需要申诉的提示");
      }
      if (error instanceof ModerationAppealAlreadySubmittedError) {
        throw new ApiError(409, "MODERATION_APPEAL_ALREADY_SUBMITTED", "当前记录已有待处理申诉");
      }
      if (error instanceof ModerationAppealLimitReachedError) {
        throw new ApiError(
          409,
          "MODERATION_APPEAL_LIMIT_REACHED",
          "这条内容安全记录的申诉次数已达上限",
        );
      }
      if (error instanceof ModerationAppealNotFoundError) {
        throw new ApiError(404, "MODERATION_APPEAL_NOT_FOUND", "申诉记录不存在");
      }
      throw error;
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
