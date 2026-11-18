import { describe, expect, it } from "vitest";

import { evaluateQualityBenchmarkRun, type QualityBenchmarkRun } from "../src/evaluator";
import { createQualityRun, qualityDataset as dataset, qualityRubric as rubric } from "./helpers";

describe("quality benchmark evaluator", () => {
  it("passes complete human and deterministic evidence against ADR thresholds", () => {
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: createQualityRun({ runId: "quality-run-1" }),
    });

    expect(report.status).toBe("passed");
    expect(report.releaseGate.passed).toBe(true);
    expect(report.releaseGate.blockers).toEqual([]);
    expect(report.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "p0_fact_loss", value: 0, passed: true }),
        expect.objectContaining({ id: "knowledge_boundary_violation", value: 0, passed: true }),
        expect.objectContaining({ id: "outline_adherence", value: 0.95, passed: true }),
        expect.objectContaining({ id: "hook_prose_score", value: 4.5, passed: true }),
        expect.objectContaining({ id: "continuity_conflicts_per_50k", value: 0, passed: true }),
      ]),
    );
    expect(report.humanReview.reviewerCount).toBe(2);
    expect(report.humanReview.maxVariance).toBe(0);
    expect(report.runId).toBe("quality-run-1");
    expect(report.scores.length).toBeGreaterThan(0);
    expect(report.decisions).toHaveLength(1);
  });

  it("blocks model-only judgement and missing inter-rater variance approval", () => {
    const run = createQualityRun({ runId: "model-only" });
    const modelOnly: QualityBenchmarkRun = {
      ...run,
      scores: run.scores.map((score) =>
        score.scorerType === "human_blind"
          ? {
              ...score,
              scorerType: "model_assisted",
              scorerId: "model-critic",
            }
          : score,
      ),
      decisions: [],
    };
    const report = evaluateQualityBenchmarkRun({ dataset, rubric, run: modelOnly });

    expect(report.status).toBe("blocked");
    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining([
        "decision-required:interRaterVarianceThreshold",
        "human-blind-evidence-missing",
      ]),
    );
  });

  it("blocks any ADR threshold regression even when aggregate quality looks high", () => {
    const run = createQualityRun({ runId: "failing-run" });
    const failingRun: QualityBenchmarkRun = {
      ...run,
      scores: run.scores.map((score, index) => {
        if (score.dimension === "outline_adherence") {
          return { ...score, value: 0.8 };
        }
        if (score.dimension === "hook_prose_score") {
          return { ...score, value: 3.5 };
        }
        if (score.dimension === "p0_fact_loss" && index < 2) {
          return { ...score, value: 1 };
        }
        return score;
      }),
    };
    const report = evaluateQualityBenchmarkRun({ dataset, rubric, run: failingRun });

    expect(report.status).toBe("blocked");
    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining([
        "threshold-failed:p0_fact_loss",
        "threshold-failed:outline_adherence",
        "threshold-failed:hook_prose_score",
      ]),
    );
  });

  it("blocks tampered dataset or rubric artifacts", () => {
    const tamperedDataset = structuredClone(dataset);
    tamperedDataset.chapterSamples[0]!.text += "tampered";
    const tamperedRubric = structuredClone(rubric);
    tamperedRubric.dimensions[0]!.threshold.value = 1;

    const report = evaluateQualityBenchmarkRun({
      dataset: tamperedDataset,
      rubric: tamperedRubric,
      run: createQualityRun({ runId: "tampered-artifacts" }),
    });

    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining(["dataset-digest-mismatch", "rubric-digest-mismatch"]),
    );
  });

  it("blocks duplicate scores and values outside the rubric score range", () => {
    const run = createQualityRun({ runId: "invalid-scores" });
    const hookIndex = run.scores.findIndex((score) => score.dimension === "hook_prose_score");
    const invalidScores = run.scores.map((score, index) =>
      index === hookIndex ? { ...score, value: 6 } : score,
    );
    invalidScores.push(invalidScores[hookIndex]!);
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: { ...run, scores: invalidScores },
    });

    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining(["score-range-invalid", "duplicate-score"]),
    );
  });
});
