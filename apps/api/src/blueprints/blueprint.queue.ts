import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  GENERATE_BLUEPRINT_JOB,
  WORKER_QUEUE_NAME,
  type GenerateBlueprintJob,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class BlueprintJobQueue implements OnModuleDestroy {
  private readonly connection: Redis;
  private readonly queue: Queue<GenerateBlueprintJob>;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<GenerateBlueprintJob>(WORKER_QUEUE_NAME, {
      connection: this.connection,
    });
  }

  async enqueue(payload: GenerateBlueprintJob): Promise<void> {
    await this.queue.add(GENERATE_BLUEPRINT_JOB, payload, {
      jobId: payload.jobId,
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
