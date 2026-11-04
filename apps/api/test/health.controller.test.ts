import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { readinessResponseSchema } from "@novel-brain/contracts";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HealthController } from "../src/health/health.controller";
import { DATABASE_PROBE, QUEUE_PROBE } from "../src/health/health.probes";
import { HealthService } from "../src/health/health.service";

describe("health API", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  async function createApp(databaseCheck: () => Promise<void>, queueCheck: () => Promise<void>) {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        { provide: DATABASE_PROBE, useValue: { check: databaseCheck } },
        { provide: QUEUE_PROBE, useValue: { check: queueCheck } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    return app;
  }

  it("reports liveness without dependency checks", async () => {
    const appUnderTest = await createApp(
      vi.fn().mockRejectedValue(new Error("database unavailable")),
      vi.fn().mockRejectedValue(new Error("queue unavailable")),
    );

    const response = await request(appUnderTest.getHttpServer()).get("/api/v1/health").expect(200);

    expect(response.body.data.status).toBe("ok");
    expect(response.body.data.service).toBe("api");
    expect(response.body.requestId).toMatch(/^req_/);
  });

  it("reports readiness when database and queue are available", async () => {
    const appUnderTest = await createApp(
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockResolvedValue(undefined),
    );

    const response = await request(appUnderTest.getHttpServer())
      .get("/api/v1/health/ready")
      .expect(200);

    const parsed = readinessResponseSchema.parse(response.body);
    expect(parsed.data.status).toBe("ready");
    expect(parsed.data.checks.map((check) => check.status)).toEqual(["up", "up"]);
  });

  it("fails readiness when a required dependency is unavailable", async () => {
    const appUnderTest = await createApp(
      vi.fn().mockResolvedValue(undefined),
      vi.fn().mockRejectedValue(new Error("queue unavailable")),
    );

    const response = await request(appUnderTest.getHttpServer())
      .get("/api/v1/health/ready")
      .expect(503);

    const parsed = readinessResponseSchema.parse(response.body);
    expect(parsed.data.status).toBe("not_ready");
    expect(parsed.data.checks).toContainEqual(
      expect.objectContaining({ name: "queue", status: "down" }),
    );
  });
});
