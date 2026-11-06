import { randomUUID } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { WORKER_QUEUE_NAME, WRITE_ACTION_JOB, type WriteActionJob } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class WritingActionQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<WriteActionJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<WriteActionJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(payload: WriteActionJob): Promise<void> {
    await this.queue.add(WRITE_ACTION_JOB, payload, {
      jobId: `${payload.jobId}-${randomUUID()}`,
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
