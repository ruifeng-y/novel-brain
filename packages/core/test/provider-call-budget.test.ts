import { describe, expect, it } from "vitest";

import { planProviderCallBudget } from "../src";

describe("provider call budget", () => {
  it("reserves prompt tokens plus the complete provider output allowance", () => {
    expect(
      planProviderCallBudget({
        system: "abcd",
        prompt: "efgh",
        maxOutputTokens: 2_000,
      }),
    ).toEqual({
      promptTokens: 4,
      maxOutputTokens: 2_000,
      reservedTokens: 2_004,
    });
  });
});
