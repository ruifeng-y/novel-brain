import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { createDatabasePool } from "@novel-brain/db";
import { WORKER_QUEUE_NAME } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";
import type { Pool } from "pg";

@Injectable()
export class MetricsPoolService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
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
