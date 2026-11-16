import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { WORKER_QUEUE_NAME } from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";

@Injectable()
export class MetricsRuntimeRedisService implements OnModuleDestroy {
  readonly redis: Redis;

  constructor() {
    this.redis = createMetricsRedis();
  }

  async onModuleDestroy(): Promise<void> {
    await closeMetricsRedis(this.redis);
  }
}

@Injectable()
export class MetricsQueueConnectionService implements OnModuleDestroy {
  readonly queue: Queue;
  private readonly redis: Redis;

  constructor() {
    this.redis = createMetricsRedis();
    this.queue = new Queue(WORKER_QUEUE_NAME, { connection: this.redis });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await closeMetricsRedis(this.redis);
  }
}

function createMetricsRedis(): Redis {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
  });
}

async function closeMetricsRedis(redis: Redis): Promise<void> {
  if (redis.status === "ready") {
    await redis.quit();
    return;
  }
  redis.disconnect();
}
