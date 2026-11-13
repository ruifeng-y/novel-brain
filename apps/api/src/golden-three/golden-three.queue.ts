import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  GENERATE_GOLDEN_THREE_JOB,
  WORKER_QUEUE_NAME,
  type GenerateGoldenThreeJob,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class GoldenThreeQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<GenerateGoldenThreeJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<GenerateGoldenThreeJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(payload: GenerateGoldenThreeJob): Promise<void> {
    const jobId = `golden-three-${payload.jobId}`;
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed" || state === "completed") {
        await existing.remove();
      } else {
        return;
      }
    }
    await this.queue.add(GENERATE_GOLDEN_THREE_JOB, payload, {
      jobId,
      removeOnComplete: false,
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
