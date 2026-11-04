import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

import type { DependencyProbe } from "./health.probes";

@Injectable()
export class QueueProbeService implements DependencyProbe, OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }

    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      connectTimeout: 2_000,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (attempt) => (attempt > 1 ? null : 200),
    });
  }

  async check(): Promise<void> {
    if (this.redis.status === "wait" || this.redis.status === "end") {
      await this.redis.connect();
    }
    await this.redis.ping();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === "ready") {
      await this.redis.quit();
      return;
    }
    this.redis.disconnect();
  }
}
