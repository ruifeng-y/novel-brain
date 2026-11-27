import { describe, expect, it } from "vitest";

import {
  blueprintConfirmRequestSchema,
  generateBlueprintJobSchema,
  workBlueprintSchema,
} from "../src";

describe("blueprint contracts", () => {
  it("requires an explicit author confirmation flag", () => {
    expect(() =>
      blueprintConfirmRequestSchema.parse({
        expectedVersion: 3,
        draftHash: "a".repeat(64),
        acknowledgements: [],
      }),
    ).toThrow();

    expect(
      blueprintConfirmRequestSchema.parse({
        expectedVersion: 3,
        draftHash: "a".repeat(64),
        acknowledgements: [],
        confirmed: true,
      }).confirmed,
    ).toBe(true);
  });

  it("does not allow a confirmed blueprint without author metadata", () => {
    const result = workBlueprintSchema.safeParse({
      id: "01900000-0000-7000-8000-000000000001",
      workId: "01900000-0000-7000-8000-000000000002",
      branchId: "01900000-0000-7000-8000-000000000003",
      status: "confirmed",
      version: 1,
      progress: 100,
      currentStep: "await_review",
      estimate: {},
      cost: {},
      storyBibleDraft: null,
      coreSettingsDraft: [],
      outlineDraft: null,
      missingFields: [],
      conflicts: [],
      acknowledgements: [],
      allowedActions: [],
      confirmedAt: null,
      confirmedBy: null,
      createdAt: "2026-11-27T00:00:00.000Z",
      updatedAt: "2026-11-27T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("requires every blueprint job to carry budget and checkpoint state", () => {
    const result = generateBlueprintJobSchema.safeParse({
      jobId: "01900000-0000-7000-8000-000000000001",
      jobType: "generate_blueprint",
      workId: "01900000-0000-7000-8000-000000000002",
      branchId: "01900000-0000-7000-8000-000000000003",
      actorId: "01900000-0000-7000-8000-000000000004",
      modelConfigId: "01900000-0000-7000-8000-000000000005",
      idempotencyKey: "idea-blueprint",
    });

    expect(result.success).toBe(false);
  });
});
