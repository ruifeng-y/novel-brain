import { describe, expect, it } from "vitest";

import {
  createApprovedQualityBenchmarkDataset,
  createQualityBenchmarkDataset,
  verifyQualityBenchmarkDataset,
} from "../src/dataset";

describe("quality benchmark dataset", () => {
  it("pins three genres, difficulty coverage and long-horizon adversarial cases", () => {
    const first = createApprovedQualityBenchmarkDataset();
    const second = createApprovedQualityBenchmarkDataset();

    expect(first).toEqual(second);
    expect(first.manifest).toMatchObject({
      datasetVersion: "quality-benchmark-v1",
      rubricVersion: "adr-0022-v1",
      chapterSampleCount: 180,
      adversarialCaseCount: 24,
      genres: ["仙侠", "历史", "都市"],
    });
    expect(first.chapterSamples).toHaveLength(180);
    expect(first.adversarialCases).toHaveLength(24);
    for (const genre of ["仙侠", "历史", "都市"] as const) {
      expect(first.chapterSamples.filter((sample) => sample.genre === genre)).toHaveLength(60);
    }
    expect(new Set(first.chapterSamples.map((sample) => sample.difficulty))).toEqual(
      new Set(["easy", "medium", "hard"]),
    );
    expect(first.manifest.datasetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyQualityBenchmarkDataset(first)).toBe(true);
    expect(first.manifest.continuityFixtureSha256).toBe(first.adversarialCases[0]?.sourceHash);
    for (const entry of first.manifest.entries) {
      expect(entry.sourceVersion.length).toBeGreaterThan(0);
      expect(entry.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
      expect(entry.knownIssues.length).toBeGreaterThanOrEqual(0);
    }
    for (const sample of first.chapterSamples) {
      expect(sample.text.length).toBeGreaterThan(100);
      expect(sample.sourceHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    for (const adversarial of first.adversarialCases) {
      expect(adversarial.sourceFactId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(adversarial.versionNodeId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(adversarial.knownIssues).toHaveLength(1);
    }
  });

  it("detects dataset content that no longer matches the manifest digest", () => {
    const dataset = createApprovedQualityBenchmarkDataset();
    const tampered = structuredClone(dataset);
    tampered.chapterSamples[0]!.text += "tampered";

    expect(verifyQualityBenchmarkDataset(tampered)).toBe(false);
    const schemaTampered = structuredClone(dataset);
    schemaTampered.schemaVersion = 2 as 1;
    expect(verifyQualityBenchmarkDataset(schemaTampered)).toBe(false);
  });

  it("rejects invalid seeds and source commits", () => {
    expect(() =>
      createQualityBenchmarkDataset({
        seed: -1,
        sourceCommit: "abc1234",
        continuityTier: "minimum",
      }),
    ).toThrow("SEED_INVALID");
    expect(() =>
      createQualityBenchmarkDataset({
        seed: 1,
        sourceCommit: "not-a-commit",
        continuityTier: "minimum",
      }),
    ).toThrow("SOURCE_COMMIT_INVALID");
  });
});
