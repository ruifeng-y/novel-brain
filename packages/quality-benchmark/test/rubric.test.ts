import { describe, expect, it } from "vitest";

import { createReleaseQualityRubric, verifyReleaseQualityRubric } from "../src/rubric";

describe("release quality rubric", () => {
  it("encodes ADR 0022 thresholds, evidence and scorer ownership", () => {
    const rubric = createReleaseQualityRubric();

    expect(rubric).toMatchObject({
      schemaVersion: 1,
      rubricVersion: "adr-0022-v1",
      sourceAdr: "docs/adr/0022-quality-measurement-and-release-gate.md",
      decisionRequired: ["interRaterVarianceThreshold"],
    });
    expect(rubric.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyReleaseQualityRubric(rubric)).toBe(true);
    expect(rubric.dimensions.map((dimension) => dimension.id)).toEqual([
      "p0_fact_loss",
      "knowledge_boundary_violation",
      "outline_adherence",
      "hook_prose_score",
      "continuity_conflicts_per_50k",
    ]);
    expect(rubric.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "p0_fact_loss",
          threshold: { operator: "max", value: 0 },
          scorerType: "deterministic",
        }),
        expect.objectContaining({
          id: "knowledge_boundary_violation",
          threshold: { operator: "max", value: 0 },
          scorerType: "deterministic",
        }),
        expect.objectContaining({
          id: "outline_adherence",
          threshold: { operator: "min", value: 0.9 },
          scorerType: "human_blind",
        }),
        expect.objectContaining({
          id: "hook_prose_score",
          threshold: { operator: "min", value: 4 },
          scorerType: "human_blind",
          scoreRange: { min: 1, max: 5 },
        }),
        expect.objectContaining({
          id: "continuity_conflicts_per_50k",
          threshold: { operator: "max", value: 1 },
          scorerType: "deterministic",
        }),
      ]),
    );
    for (const dimension of rubric.dimensions) {
      expect(dimension.evidenceRequirements.length).toBeGreaterThan(0);
      expect(dimension.waiverOwner).toBe("release-owner");
      expect(dimension.variance).toMatchObject({
        requiredForScorers: dimension.scorerType === "human_blind" ? ["human_blind"] : [],
        maxVariance: null,
      });
    }
  });

  it("detects rubric content that no longer matches its digest", () => {
    const rubric = createReleaseQualityRubric();
    const tampered = structuredClone(rubric);
    tampered.dimensions[0]!.threshold.value = 1;

    expect(verifyReleaseQualityRubric(tampered)).toBe(false);
  });
});
