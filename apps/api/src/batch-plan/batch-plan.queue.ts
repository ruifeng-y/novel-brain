import { randomUUID } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { BATCH_TICK_JOB, WORKER_QUEUE_NAME, type BatchTickJob } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class BatchPlanQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<BatchTickJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<BatchTickJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueueTick(payload: BatchTickJob): Promise<void> {
    await this.queue.add(BATCH_TICK_JOB, payload, {
      jobId: `${payload.planId}-${randomUUID()}`,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
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
