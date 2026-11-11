import { describe, expect, it } from "vitest";

import { calculateBatchBudgetAllocation } from "../src/batch-cost";

describe("batch budget allocation", () => {
  it("uses the tightest chapter, volume, task and per-ten-thousand-character cap", () => {
    expect(
      calculateBatchBudgetAllocation({
        chapterMaxCostCny: 2.5,
        volumeMaxCostCny: 100,
        taskMaxCostCny: 200,
        perTenThousandCharsMaxCostCny: 20,
        projectedCharacters: 25_000,
        taskCostUsedCny: 198.5,
        volumeCostUsedCny: 99.4,
      }),
    ).toEqual({
      allowedCostCny: 0.6,
      bindingScope: "volume",
      projectedCharacters: 25_000,
      perTenThousandCharactersLimitCny: 50,
    });
  });

  it("fails closed when every remaining cumulative budget is exhausted", () => {
    expect(
      calculateBatchBudgetAllocation({
        chapterMaxCostCny: 2.5,
        volumeMaxCostCny: 10,
        taskMaxCostCny: 20,
        perTenThousandCharsMaxCostCny: null,
        projectedCharacters: 10_000,
        taskCostUsedCny: 20,
        volumeCostUsedCny: 10,
      }),
    ).toMatchObject({
      allowedCostCny: 0,
      bindingScope: "task",
    });
  });
});
