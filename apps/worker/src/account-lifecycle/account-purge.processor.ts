import { Injectable } from "@nestjs/common";
import {
  ACCOUNT_PURGE_JOB,
  ACCOUNT_PURGE_TICK_JOB,
  workerJobSchema,
  type AccountPurgeJob,
} from "@novel-brain/contracts";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerAccountPurgeRepository } from "./account-purge.repository";

@Injectable()
export class AccountPurgeProcessor {
  constructor(private readonly repository: WorkerAccountPurgeRepository) {}

  async process(job: AccountPurgeJob): Promise<void> {
    const result = await this.repository.purge(job.deletionRequestId);
    if (result.kind === "failed") {
      throw new Error(`${result.failure.code}: ${result.failure.message}`);
    }
  }

  async listDueRequestIds(): Promise<string[]> {
    return this.repository.listDueRequestIds();
  }
}

export function parseAccountPurgeJob(data: unknown): AccountPurgeJob | null {
  const parsed = workerJobSchema.safeParse(data);
  return parsed.success && parsed.data.jobType === ACCOUNT_PURGE_JOB ? parsed.data : null;
}

export function isAccountPurgeTick(data: unknown): boolean {
  const parsed = workerJobSchema.safeParse(data);
  return parsed.success && parsed.data.jobType === ACCOUNT_PURGE_TICK_JOB;
}
