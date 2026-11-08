import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  GENERATE_CHAPTER_JOB,
  WORKER_QUEUE_NAME,
  type GenerateChapterJob,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class BatchPlanChildQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<GenerateChapterJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<GenerateChapterJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueueChapter(payload: GenerateChapterJob, priority: number): Promise<void> {
    await this.queue.add(GENERATE_CHAPTER_JOB, payload, {
      jobId: `batch-child:${payload.jobId}`,
      priority,
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
