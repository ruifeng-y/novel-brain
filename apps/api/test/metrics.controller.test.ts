import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MetricsController } from "../src/metrics/metrics.controller";
import { OPERATIONAL_METRICS_SOURCE } from "../src/metrics/operational-metrics.source";
import { PrometheusMetricsService } from "../src/metrics/prometheus-metrics.service";

describe("metrics API", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("collects a fresh snapshot before rendering prometheus text", async () => {
    const collect = vi.fn().mockResolvedValue({
      dependencies: { database: true, queue: true, storage: true },
      queue: {
        counts: { wait: 2, active: 1, delayed: 0, failed: 1, completed: 4, paused: 0 },
        oldestAgeSeconds: { wait: 45 },
      },
      jobs: [{ jobType: "generate_chapter", status: "completed", count: 4 }],
      modelCalls: [],
      storage: { configured: true, available: true, objectCount: 3, bytes: 1024 },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        PrometheusMetricsService,
        { provide: OPERATIONAL_METRICS_SOURCE, useValue: { collect } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const response = await request(app.getHttpServer()).get("/api/v1/metrics").expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.text).toContain('novelbrain_worker_queue_jobs{state="wait"} 2');
    expect(response.text).toContain("novelbrain_storage_available 1");
    expect(collect).toHaveBeenCalledOnce();
  });
});
