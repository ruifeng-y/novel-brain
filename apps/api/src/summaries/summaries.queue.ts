import { randomUUID } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  SUMMARY_REBUILD_JOB,
  WORKER_QUEUE_NAME,
  type SummaryRebuildJob,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class SummaryRebuildQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<SummaryRebuildJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<SummaryRebuildJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(payload: SummaryRebuildJob): Promise<void> {
    await this.queue.add(SUMMARY_REBUILD_JOB, payload, {
      jobId: `${payload.runId}-${randomUUID()}`,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });
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
