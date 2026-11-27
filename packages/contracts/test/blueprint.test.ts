import { describe, expect, it } from "vitest";

import {
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  blueprintBudgetUpdateRequestSchema,
  blueprintConfirmRequestSchema,
  blueprintStoryBibleDraftSchema,
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

  it("allows a blueprint job to wait until a model config exists", () => {
    const result = generateBlueprintJobSchema.safeParse({
      jobId: "01900000-0000-7000-8000-000000000001",
      jobType: "generate_blueprint",
      workId: "01900000-0000-7000-8000-000000000002",
      branchId: "01900000-0000-7000-8000-000000000003",
      actorId: "01900000-0000-7000-8000-000000000004",
      modelConfigId: null,
      idempotencyKey: "idea-blueprint",
      budget: { maxTokens: 20000, maxCostCny: 0.1 },
      checkpoint: { step: "prepare" },
    });

    expect(result.success).toBe(true);
  });

  it("enforces the documented budget bounds and flat update request", () => {
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        maxTokens: 20000,
        maxCostCny: 0.1,
      }).success,
    ).toBe(true);
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        maxTokens: 20000,
        maxCostCny: 0.099,
      }).success,
    ).toBe(false);
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        budget: { maxTokens: 20000, maxCostCny: 0.1 },
      }).success,
    ).toBe(false);
  });

  it("wraps nine story-bible cards in the draft object", () => {
    const cards = STORY_BIBLE_CARD_KEYS.map((key) => ({
      key,
      title: STORY_BIBLE_CARD_TITLES[key],
      content: `${key} 内容`,
      complete: true,
      worldRules:
        key === "worldLaws"
          ? [
              {
                id: "01900000-0000-7000-8000-000000000010",
                name: "力量有代价",
                constraint: "任何越阶都必须付出代价。",
                scope: "全书",
                exceptions: [],
              },
            ]
          : [],
    }));

    expect(blueprintStoryBibleDraftSchema.safeParse({ cards }).success).toBe(true);
    expect(blueprintStoryBibleDraftSchema.safeParse(cards).success).toBe(false);
  });
});
