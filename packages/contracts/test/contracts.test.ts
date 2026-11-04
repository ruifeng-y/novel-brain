import { describe, expect, it } from "vitest";

import { GENERATE_CHAPTER_JOB, generateChapterJobSchema, readinessResponseSchema } from "../src";

describe("shared contracts", () => {
  it("accepts the readiness envelope shared by Web and API", () => {
    const response = readinessResponseSchema.parse({
      data: {
        status: "ready",
        service: "api",
        timestamp: "2026-11-04T08:00:00.000Z",
        checks: [
          { name: "database", status: "up", latencyMs: 4 },
          { name: "queue", status: "up", latencyMs: 2 },
        ],
      },
      requestId: "req_contract",
      meta: {},
    });

    expect(response.data.status).toBe("ready");
  });

  it("accepts the typed worker job consumed by the worker", () => {
    const job = generateChapterJobSchema.parse({
      jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
      jobType: GENERATE_CHAPTER_JOB,
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
      actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
      modelConfigId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
      idempotencyKey: "generate-chapter-1",
      budget: {
        maxCostCny: 2.5,
        maxTokens: 30_000,
        maxRevisionRounds: 2,
      },
      checkpoint: {
        step: "prepare",
        payload: {},
      },
    });

    expect(job.jobType).toBe("generate_chapter");
  });

  it("rejects a job without an idempotency key", () => {
    expect(() =>
      generateChapterJobSchema.parse({
        jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
        jobType: GENERATE_CHAPTER_JOB,
      }),
    ).toThrow();
  });

  it("rejects UUID v4 business identifiers and unknown checkpoint steps", () => {
    const baseJob = {
      jobId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      jobType: GENERATE_CHAPTER_JOB,
      workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
      chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
      actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
      modelConfigId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
      idempotencyKey: "generate-chapter-1",
      budget: {
        maxCostCny: 2.5,
        maxTokens: 30_000,
        maxRevisionRounds: 2,
      },
      checkpoint: {
        step: "prepare",
        payload: {},
      },
    };

    expect(() => generateChapterJobSchema.parse(baseJob)).toThrow();
    expect(() =>
      generateChapterJobSchema.parse({
        ...baseJob,
        jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
        checkpoint: { step: "unknown", payload: {} },
      }),
    ).toThrow();
  });
});
