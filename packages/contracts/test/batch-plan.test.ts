import { describe, expect, it } from "vitest";

import { batchPlanCreateRequestSchema, WORKER_JOB_STEPS } from "../src";

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
});
