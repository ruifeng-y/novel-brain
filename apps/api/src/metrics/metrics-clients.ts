import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { WORKER_QUEUE_NAME } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class MetricsRuntimeRedisService implements OnModuleDestroy {
  readonly redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === "ready") {
      await this.redis.quit();
      return;
    }
    this.redis.disconnect();
  }
}

@Injectable()
export class MetricsQueueConnectionService implements OnModuleDestroy {
  readonly queue: Queue;
  private readonly redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
    this.queue = new Queue(WORKER_QUEUE_NAME, { connection: this.redis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    if (this.redis.status === "ready") {
      await this.redis.quit();
      return;
    }
    this.redis.disconnect();
  }
}
