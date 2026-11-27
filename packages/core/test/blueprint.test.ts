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
      maxCostCny: 0.6,
    });
    expect(estimate.ruleVersion).toBe("blueprint-estimate-v1");
  });
});
