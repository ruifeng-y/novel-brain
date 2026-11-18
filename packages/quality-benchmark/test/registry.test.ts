import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  APPROVED_QUALITY_BENCHMARK_DATASET_SHA256,
  createApprovedQualityBenchmarkDataset,
} from "../src/dataset";
import { APPROVED_QUALITY_RUBRIC_SHA256, createReleaseQualityRubric } from "../src/rubric";

describe("frozen quality benchmark registry", () => {
  it("matches the committed manifest and rubric snapshots", async () => {
    const manifest = JSON.parse(
      await readFile(
        path.resolve(process.cwd(), "docs/quality/quality-benchmark-v1.manifest.json"),
        "utf8",
      ),
    );
    const dataset = JSON.parse(
      await readFile(
        path.resolve(process.cwd(), "docs/quality/quality-benchmark-v1.dataset.json"),
        "utf8",
      ),
    );
    const rubric = JSON.parse(
      await readFile(
        path.resolve(process.cwd(), "docs/quality/quality-benchmark-v1.rubric.json"),
        "utf8",
      ),
    );

    expect(manifest).toEqual(createApprovedQualityBenchmarkDataset().manifest);
    expect(dataset).toEqual(createApprovedQualityBenchmarkDataset());
    expect(rubric).toEqual(createReleaseQualityRubric());
    expect(manifest.datasetSha256).toBe(APPROVED_QUALITY_BENCHMARK_DATASET_SHA256);
    expect(rubric.sha256).toBe(APPROVED_QUALITY_RUBRIC_SHA256);
  });
});
