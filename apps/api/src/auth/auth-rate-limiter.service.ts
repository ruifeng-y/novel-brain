import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

import { ApiError } from "../common/api-error";
import { sha256 } from "./auth-crypto";

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

@Injectable()
export class AuthRateLimiterService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error("REDIS_URL is required");
    }
    this.redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (attempt) => (attempt > 1 ? null : 200),
    });
  }

  async consumeRegistrationCode(email: string, ip: string): Promise<void> {
    await this.assertWithinLimits([
      { key: `register:email:minute:${sha256(email)}`, limit: 1, ttlSeconds: 60 },
      { key: `register:email:day:${sha256(email)}`, limit: 10, ttlSeconds: 86_400 },
      { key: `register:ip:minute:${sha256(ip)}`, limit: 5, ttlSeconds: 60 },
      { key: `register:ip:day:${sha256(ip)}`, limit: 50, ttlSeconds: 86_400 },
    ]);
  }

  async consumeLogin(email: string, ip: string): Promise<void> {
    await this.assertWithinLimits([
      { key: `login:identity:${sha256(`${email}:${ip}`)}`, limit: 10, ttlSeconds: 900 },
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === "ready") {
      await this.redis.quit();
    } else {
      this.redis.disconnect();
    }
  }

  private async assertWithinLimits(
    buckets: Array<{ key: string; limit: number; ttlSeconds: number }>,
  ): Promise<void> {
    if (this.redis.status === "wait" || this.redis.status === "end") {
      await this.redis.connect();
    }

    for (const bucket of buckets) {
      const count = Number(
        await this.redis.eval(RATE_LIMIT_SCRIPT, 1, bucket.key, String(bucket.ttlSeconds)),
      );
      if (count > bucket.limit) {
        throw new ApiError(429, "AUTH_RATE_LIMITED", "请求过于频繁，请稍后再试", {
          retryAfterSeconds: bucket.ttlSeconds,
        });
      }
    }
  }
}
