import { describe, expect, it } from "vitest";

import {
  batchPlanActionRequestSchema,
  batchPlanCreateRequestSchema,
  batchTickJobSchema,
  batchWorkItemStatusSchema,
  WORKER_JOB_STEPS,
} from "../src";

describe("batch plan contracts", () => {
  it("applies safe defaults for book plans", () => {
    expect(batchPlanCreateRequestSchema.parse({ scope: { type: "book" } })).toEqual({
      scope: { type: "book" },
      approvalMode: "per_volume",
      priorityClass: "batch",
      maxConcurrency: 2,
      stepKeys: [...WORKER_JOB_STEPS],
    });
  });

  it("rejects inverted ranges and duplicate steps", () => {
    expect(() =>
      batchPlanCreateRequestSchema.parse({
        scope: { type: "range", fromChapterNumber: 10, toChapterNumber: 2 },
      }),
    ).toThrow();
    expect(() =>
      batchPlanCreateRequestSchema.parse({
        scope: { type: "book" },
        stepKeys: ["prepare", "prepare"],
      }),
    ).toThrow();
  });

  it("accepts control actions and bounded tick payloads", () => {
    expect(batchPlanActionRequestSchema.parse({ reason: "作者暂停" })).toEqual({
      reason: "作者暂停",
    });
    expect(batchPlanActionRequestSchema.parse({})).toEqual({});
    expect(batchWorkItemStatusSchema.parse("paused")).toBe("paused");
    expect(
      batchTickJobSchema.parse({
        jobType: "batch_tick",
        planId: "01a1b4ed-6396-73e2-9c10-01530a818ed7",
        workId: "01a1b4ed-6396-73e2-9c10-01530a818ed8",
        branchId: "01a1b4ed-6396-73e2-9c10-01530a818ed9",
        actorId: "01a1b4ed-6396-73e2-9c10-01530a818eda",
        idempotencyKey: "batch-tick:01a1b4ed-6396-73e2-9c10-01530a818ed7",
        checkpoint: {
          schemaVersion: 1,
          revision: 0,
          planId: "01a1b4ed-6396-73e2-9c10-01530a818ed7",
        },
      }),
    ).toMatchObject({ jobType: "batch_tick" });
  });
});
