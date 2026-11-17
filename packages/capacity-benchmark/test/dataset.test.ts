import { describe, expect, it } from "vitest";

import {
  benchmarkChapterContent,
  createBenchmarkPlan,
  digestBenchmarkManuscript,
} from "../src/dataset";

describe("capacity benchmark dataset", () => {
  it("generates the canonical ten-million-character topology deterministically", () => {
    const first = createBenchmarkPlan({
      seed: 20261117,
      tier: "full",
      topology: "mid",
      branchCount: 3,
    });
    const second = createBenchmarkPlan({
      seed: 20261117,
      tier: "full",
      topology: "mid",
      branchCount: 3,
    });

    const firstDigest = digestBenchmarkManuscript(first);
    const secondDigest = digestBenchmarkManuscript(second);

    expect(first.topology).toEqual({
      chapterCount: 3_500,
      volumeCount: 35,
      chaptersPerVolume: 100,
      logicalCharacters: 10_000_000,
      minChapterCharacters: 2_500,
      maxChapterCharacters: 3_500,
    });
    expect(firstDigest).toEqual(secondDigest);
    expect(firstDigest.logicalCharacters).toBe(10_000_000);
    expect(firstDigest.chapterCount).toBe(3_500);
    expect(firstDigest.utf8Bytes).toBeGreaterThan(firstDigest.logicalCharacters);
    expect(firstDigest.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("supports the 4000-chapter boundary without changing the character total", () => {
    const plan = createBenchmarkPlan({
      seed: 7,
      tier: "boundary",
      topology: "boundary",
      branchCount: 3,
    });
    const digest = digestBenchmarkManuscript(plan);

    expect(plan.topology.chapterCount).toBe(4_000);
    expect(plan.topology.volumeCount).toBe(40);
    expect(digest.logicalCharacters).toBe(10_000_000);

    const lengths = Array.from(
      { length: plan.topology.chapterCount },
      (_, index) => Array.from(benchmarkChapterContent(plan, index + 1)).length,
    );
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(2_500);
    expect(Math.max(...lengths)).toBeLessThanOrEqual(3_500);
  });

  it("keeps growth tiers proportional without treating them as capacity claims", () => {
    const plan = createBenchmarkPlan({
      seed: 11,
      tier: "growth",
      growthPercent: 25,
      topology: "mid",
      branchCount: 3,
    });

    expect(plan.topology.chapterCount).toBe(875);
    expect(plan.topology.volumeCount).toBe(9);
    expect(plan.topology.logicalCharacters).toBe(2_500_000);
    expect(plan.certificationEligible).toBe(false);
  });

  it("rejects impossible topology and text-size combinations instead of silently changing them", () => {
    expect(() =>
      createBenchmarkPlan({
        seed: 1,
        tier: "full",
        topology: "mid",
        branchCount: 3,
        chapterCount: 10,
        volumeCount: 1,
        logicalCharacters: 10_000_000,
      }),
    ).toThrow("CHAPTER_CHARACTER_CAPACITY_EXCEEDED");
  });

  it("requires an explicit branch count for canonical tiers", () => {
    expect(() =>
      createBenchmarkPlan({
        seed: 1,
        tier: "full",
        topology: "mid",
      }),
    ).toThrow("BRANCH_COUNT_DECISION_REQUIRED");
  });
});
