import { Injectable } from "@nestjs/common";
import type { AccountDeletionCreateRequest, AccountDeletionRequest } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthRateLimiterService } from "../auth/auth-rate-limiter.service";
import type { LifecycleAuditContext } from "./account-lifecycle.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AccountLifecycleRepository } from "./account-lifecycle.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AccountPurgeQueue } from "./account-purge.queue";

@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly repository: AccountLifecycleRepository,
    private readonly purgeQueue: AccountPurgeQueue,
    private readonly rateLimiter: AuthRateLimiterService,
  ) {}

  async createExport(userId: string, audit: LifecycleAuditContext, idempotencyKey?: string) {
    await this.rateLimiter.consumeAccountExport(userId, audit.ip);
    return this.repository.createExportReceipt(userId, audit, idempotencyKey);
  }

  async downloadExport(userId: string, receiptId: string) {
    const receipt = await this.repository.downloadExport(userId, receiptId);
    if (receipt === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导出记录不存在或无权访问");
    }
    if (receipt === "expired") {
      throw new ApiError(400, "ACCOUNT_EXPORT_EXPIRED", "导出文件已过期，请重新导出");
    }
    return receipt;
  }

  async requestDeletion(input: {
    userId: string;
    sessionId: string;
    request: AccountDeletionCreateRequest;
    audit: LifecycleAuditContext;
    idempotencyKey?: string;
  }): Promise<AccountDeletionRequest> {
    const deletion = await this.repository.createDeletionRequest(input);
    if (deletion === "export_required") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "请先导出账号数据");
    }
    if (deletion === "export_expired") {
      throw new ApiError(400, "ACCOUNT_EXPORT_EXPIRED", "导出文件已过期，请重新导出");
    }
    if (deletion === "export_stale") {
      throw new ApiError(400, "ACCOUNT_EXPORT_STALE", "账号或作品已发生变化，请重新导出");
    }
    await this.purgeQueue.enqueue(deletion.id, deletion.purgeAfter);
    return deletion;
  }

  async getDeletion(userId: string): Promise<AccountDeletionRequest> {
    const deletion = await this.repository.getDeletionRequest(userId);
    if (!deletion) {
      throw new ApiError(404, "ACCOUNT_DELETION_NOT_FOUND", "当前没有账号注销申请");
    }
    return deletion;
  }

  async recoverDeletion(
    userId: string,
    audit: LifecycleAuditContext,
  ): Promise<AccountDeletionRequest> {
    const deletion = await this.repository.recoverDeletionRequest({ userId, audit });
    if (deletion === "not_found") {
      throw new ApiError(404, "ACCOUNT_DELETION_NOT_FOUND", "当前没有账号注销申请");
    }
    if (deletion === "expired") {
      throw new ApiError(410, "ACCOUNT_DELETION_RECOVERY_EXPIRED", "账号恢复期已结束");
    }
    if (deletion === "invalid_state") {
      throw new ApiError(409, "ACCOUNT_DELETION_INVALID_STATE", "当前状态不能恢复账号");
    }
    await this.purgeQueue.cancel(deletion.id);
    return deletion;
  }
}
