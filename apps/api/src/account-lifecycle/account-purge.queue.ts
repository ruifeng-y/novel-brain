import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { ACCOUNT_PURGE_JOB, WORKER_QUEUE_NAME, type AccountPurgeJob } from "@novel-brain/contracts";
import {
  ACCOUNT_PURGE_JOB_ATTEMPTS,
  ACCOUNT_PURGE_RETRY_DELAY_MS,
  accountPurgeJobId,
} from "@novel-brain/core";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class AccountPurgeQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<AccountPurgeJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<AccountPurgeJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(deletionRequestId: string, purgeAfter: string): Promise<void> {
    const delay = Math.max(0, new Date(purgeAfter).getTime() - Date.now());
    await this.queue.add(
      ACCOUNT_PURGE_JOB,
      {
        jobType: ACCOUNT_PURGE_JOB,
        deletionRequestId,
        workId: null,
        branchId: null,
        idempotencyKey: `account-purge-${deletionRequestId}`,
        checkpoint: {
          schemaVersion: 1,
          revision: 0,
          step: "prepare",
        },
      },
      {
        jobId: accountPurgeJobId(deletionRequestId),
        delay,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: ACCOUNT_PURGE_JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: ACCOUNT_PURGE_RETRY_DELAY_MS },
      },
    );
  }

  async cancel(deletionRequestId: string): Promise<void> {
    const job = await this.queue.getJob(accountPurgeJobId(deletionRequestId));
    if (job) {
      await job.remove().catch(() => undefined);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    if (this.connection.status === "ready") {
      await this.connection.quit();
    } else {
      this.connection.disconnect();
    }
  }
}
