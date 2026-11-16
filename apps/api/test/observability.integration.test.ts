import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { JOB_METRICS_KEY, MODEL_METRICS_KEY, runtimeMetricsBucketKey } from "@novel-brain/core";
import Redis from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";

describe("observability HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "observability-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "observability-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = "http://localhost:3000";
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1";
    delete process.env.STORAGE_HEALTH_URL;

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl);
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  beforeEach(async () => {
    await databasePool.query("TRUNCATE TABLE users CASCADE");
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("keeps liveness, dependency readiness and Prometheus metrics distinct", async () => {
    await request(app.getHttpServer()).get("/api/v1/health").expect(200);
    const ready = await request(app.getHttpServer()).get("/api/v1/health/ready").expect(200);
    expect(ready.body.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "database", status: "up" }),
        expect.objectContaining({ name: "queue", status: "up" }),
      ]),
    );

    const jobMetricsKey = runtimeMetricsBucketKey(JOB_METRICS_KEY, new Date());
    const modelMetricsKey = runtimeMetricsBucketKey(MODEL_METRICS_KEY, new Date());
    await redis.hset(jobMetricsKey, "generate_chapter:failed", "2");
    await redis.hset(modelMetricsKey, {
      "calls:succeeded": "4",
      "latency_sum_ms:succeeded": "3200",
      "input_tokens:succeeded": "400",
      "output_tokens:succeeded": "200",
      "cost_cny:succeeded": "0.5",
    });
    const metrics = await request(app.getHttpServer()).get("/api/v1/metrics").expect(200);
    expect(metrics.headers["content-type"]).toContain("text/plain");
    expect(metrics.text).toContain("novelbrain_api_request_duration_seconds");
    expect(metrics.text).toContain("novelbrain_worker_queue_jobs");
    expect(metrics.text).toContain("novelbrain_jobs_window");
    expect(metrics.text).toContain("novelbrain_model_cost_cny_window");
    expect(metrics.text).toContain("novelbrain_dependency_up");
    expect(metrics.text).toContain(
      'novelbrain_jobs_window{job_type="generate_chapter",status="failed"} 2',
    );
    expect(metrics.text).toContain("novelbrain_model_latency_ms_overall 800");
  });
});

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const adminPool = createDatabasePool(adminUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}

function isDuplicateDatabase(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P04";
}
