import { describe, expect, it } from "vitest";

import { createContinuityPlan } from "../src/plan";

describe("continuity benchmark plan", () => {
  it("pins the canonical 3500-chapter fixture and release thresholds", () => {
    const plan = createContinuityPlan({ seed: 20261118, tier: "full" });

    expect(plan).toMatchObject({
      generatorVersion: "continuity-benchmark-v1",
      schemaVersion: 1,
      seed: 20261118,
      tier: "full",
      chapterCount: 3_500,
      volumeCount: 35,
      chaptersPerVolume: 100,
      thresholds: {
        p0FactLossMax: 0,
        knowledgeBoundaryViolationMax: 0,
        outlineAdherenceMin: 0.9,
        hookProseScoreMin: 4,
        continuityConflictsPer50kMax: 1,
      },
    });
    expect(plan.branchDivergenceChapters).toEqual([300, 1_750, 3_200]);
    expect(plan.scenarioFamilies).toContain("knowledge_boundary");
    expect(plan.scenarioFamilies).toContain("branch_divergence");
    expect(plan.decisionRequired).toEqual([
      "blindReviewSamplesPerStratum",
      "interRaterAgreementThreshold",
    ]);
  });

  it("supports the approved minimum and maximum fixture boundaries", () => {
    expect(createContinuityPlan({ seed: 1, tier: "minimum" })).toMatchObject({
      chapterCount: 3_000,
      volumeCount: 30,
      chaptersPerVolume: 100,
    });
    expect(createContinuityPlan({ seed: 1, tier: "maximum" })).toMatchObject({
      chapterCount: 4_000,
      volumeCount: 40,
      chaptersPerVolume: 100,
    });
  });

  it("rejects unsafe seeds", () => {
    expect(() => createContinuityPlan({ seed: -1, tier: "full" })).toThrow("SEED_INVALID");
    expect(() => createContinuityPlan({ seed: 1.5, tier: "full" })).toThrow("SEED_INVALID");
  });
});
