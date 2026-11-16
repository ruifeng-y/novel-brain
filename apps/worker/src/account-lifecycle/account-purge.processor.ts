import { Inject, Injectable } from "@nestjs/common";
import type { AccountPurgeJob } from "@novel-brain/contracts";
import { OBJECT_STORAGE, type ObjectStorage } from "@novel-brain/storage";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerAccountPurgeRepository } from "./account-purge.repository";
import type { AccountPurgeResult } from "./account-purge.repository";

@Injectable()
export class AccountPurgeProcessor {
  constructor(
    private readonly repository: WorkerAccountPurgeRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async process(job: AccountPurgeJob): Promise<AccountPurgeResult> {
    const objectKeys = await this.repository.listExportObjectKeys(job.deletionRequestId);
    try {
      await this.storage.deleteObjects(objectKeys);
    } catch {
      const message = "账号永久删除未完成：导出文件对象删除失败";
      await this.repository.markObjectDeletionFailed(job.deletionRequestId, message);
      throw new Error(`ACCOUNT_PURGE_RETRYABLE: ${message}`);
    }
    const result = await this.repository.purge(job.deletionRequestId);
    if (result.kind === "failed" && result.failure.retryable) {
      throw new Error(`${result.failure.code}: ${result.failure.message}`);
    }
    return result;
  }

  async listDueRequestIds(): Promise<string[]> {
    return this.repository.listDueRequestIds();
  }

  async cleanupExpiredExportReceipts(): Promise<number> {
    return this.repository.cleanupExpiredExportReceipts();
  }
}
