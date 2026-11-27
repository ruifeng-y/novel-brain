import { describe, expect, it } from "vitest";

import { estimateBlueprint } from "../src/blueprint";

describe("estimateBlueprint", () => {
  it("scales the long blueprint deterministically from chapter length", () => {
    const estimate = estimateBlueprint({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 4000,
      modelRatePerTokenCny: 0.000002,
    });

    expect(estimate.planned).toEqual({ volumes: 5, chapters: 60, scenes: 120 });
    expect(estimate.estimatedTokens).toBe(198000);
    expect(estimate.defaultBudget).toEqual({
      maxTokens: 238000,
      maxCostCny: 1,
    });
    expect(estimate.ruleVersion).toBe("blueprint-estimate-v1");
  });

  it.each([
    ["short", 40000, 48000, 0.5],
    ["medium", 100000, 120000, 0.5],
    ["long", 180000, 216000, 1],
    ["epic", 300000, 360000, 1],
  ] as const)("uses the deterministic %s scale budget", (scaleTarget, tokens, maxTokens, cost) => {
    const estimate = estimateBlueprint({
      genre: "urban",
      scaleTarget,
      chapterLengthTarget: 3000,
      modelRatePerTokenCny: 0.000002,
    });

    expect(estimate.estimatedTokens).toBe(tokens);
    expect(estimate.defaultBudget).toEqual({ maxTokens, maxCostCny: cost });
  });

  it("clamps chapter length factor to 0.8 and 1.5", () => {
    expect(
      estimateBlueprint({
        genre: "history",
        scaleTarget: "short",
        chapterLengthTarget: 1000,
        modelRatePerTokenCny: 0.000002,
      }).estimatedTokens,
    ).toBe(32000);
    expect(
      estimateBlueprint({
        genre: "xianxia",
        scaleTarget: "short",
        chapterLengthTarget: 12000,
        modelRatePerTokenCny: 0.000002,
      }).estimatedTokens,
    ).toBe(60000);
  });

  it("falls back to the M0 model rate when no current rate is available", () => {
    const fallback = estimateBlueprint({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    });
    const explicit = estimateBlueprint({
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
      modelRatePerTokenCny: 0.000002,
    });

    expect(fallback.estimatedCostCny).toBe(explicit.estimatedCostCny);
    expect(fallback.defaultBudget).toEqual(explicit.defaultBudget);
  });
});
