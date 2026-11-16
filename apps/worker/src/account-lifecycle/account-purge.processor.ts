import { Injectable } from "@nestjs/common";
import type { AccountPurgeJob } from "@novel-brain/contracts";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerAccountPurgeRepository } from "./account-purge.repository";
import type { AccountPurgeResult } from "./account-purge.repository";

@Injectable()
export class AccountPurgeProcessor {
  constructor(private readonly repository: WorkerAccountPurgeRepository) {}

  async process(job: AccountPurgeJob): Promise<AccountPurgeResult> {
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
