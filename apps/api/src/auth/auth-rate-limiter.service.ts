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
const IDEMPOTENT_RATE_LIMIT_SCRIPT = `
local claimed = redis.call("SET", KEYS[1], "1", "NX", "EX", ARGV[1])
if not claimed then
  return {0, 0, 0}
end
local userCount = redis.call("INCR", KEYS[2])
if userCount == 1 then
  redis.call("EXPIRE", KEYS[2], ARGV[2])
end
local ipCount = redis.call("INCR", KEYS[3])
if ipCount == 1 then
  redis.call("EXPIRE", KEYS[3], ARGV[3])
end
return {1, userCount, ipCount}
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

  async consumePasswordResetRequest(email: string, ip: string): Promise<void> {
    await this.assertWithinLimits([
      { key: `password-reset:email:minute:${sha256(email)}`, limit: 1, ttlSeconds: 60 },
      { key: `password-reset:email:hour:${sha256(email)}`, limit: 5, ttlSeconds: 3_600 },
      { key: `password-reset:ip:minute:${sha256(ip)}`, limit: 5, ttlSeconds: 60 },
      { key: `password-reset:ip:hour:${sha256(ip)}`, limit: 30, ttlSeconds: 3_600 },
    ]);
  }

  async consumePasswordResetAttempt(tokenHash: string, ip: string): Promise<void> {
    await this.assertWithinLimits([
      { key: `password-reset:token:${tokenHash}`, limit: 10, ttlSeconds: 3_600 },
      { key: `password-reset:attempt-ip:${sha256(ip)}`, limit: 30, ttlSeconds: 3_600 },
    ]);
  }

  async consumeAccountExport(userId: string, ip: string, idempotencyKey?: string): Promise<void> {
    if (idempotencyKey) {
      await this.ensureConnected();
      const [claimed, userCount, ipCount] = (await this.redis.eval(
        IDEMPOTENT_RATE_LIMIT_SCRIPT,
        3,
        `account-export:idempotency:${sha256(`${userId}:account-export:${idempotencyKey}`)}`,
        `account-export:user:hour:${sha256(userId)}`,
        `account-export:ip:hour:${sha256(ip)}`,
        "86400",
        "3600",
        "3600",
      )) as [number, number, number];
      if (claimed === 1 && (userCount > 3 || ipCount > 20)) {
        throw new ApiError(429, "AUTH_RATE_LIMITED", "请求过于频繁，请稍后再试", {
          retryAfterSeconds: 3_600,
        });
      }
      return;
    }
    await this.assertWithinLimits([
      { key: `account-export:user:hour:${sha256(userId)}`, limit: 3, ttlSeconds: 3_600 },
      { key: `account-export:ip:hour:${sha256(ip)}`, limit: 20, ttlSeconds: 3_600 },
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
    await this.ensureConnected();

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

  private async ensureConnected(): Promise<void> {
    if (this.redis.status === "wait" || this.redis.status === "end") {
      await this.redis.connect();
    }
  }
}
