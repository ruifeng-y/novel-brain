import { describe, expect, it } from "vitest";

import { sha256Json } from "@novel-brain/continuity-benchmark";

import { evaluateQualityBenchmarkRun, type QualityBenchmarkRun } from "../src/evaluator";
import {
  createQualityRun,
  qualityDataset as dataset,
  qualityReviewPolicy,
  qualityRubric as rubric,
} from "./helpers";

describe("quality benchmark evaluator", () => {
  it("passes complete human and deterministic evidence against ADR thresholds", () => {
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: createQualityRun({ runId: "quality-run-1" }),
      reviewPolicy: qualityReviewPolicy,
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
    expect(report.humanReview.attestationCount).toBe(2);
    expect(report.humanReview.maxVariance).toBe(0);
    expect(report.humanReview.reviewPolicySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.runId).toBe("quality-run-1");
    expect(report.scores.length).toBeGreaterThan(0);
    expect(report.decisions).toHaveLength(1);
  });

  it("blocks model-only judgement even with a trusted review policy", () => {
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
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: modelOnly,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.status).toBe("blocked");
    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining(["human-blind-evidence-missing"]),
    );
    expect(report.releaseGate.blockers).not.toContain(
      "decision-required:interRaterVarianceThreshold",
    );
  });

  it("ignores candidate-recorded decisions when no trusted review policy is supplied", () => {
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: createQualityRun({ runId: "candidate-self-approved" }),
    });

    expect(report.status).toBe("blocked");
    expect(report.releaseGate.blockers).toContain("decision-required:interRaterVarianceThreshold");
  });

  it("blocks human scores without reviewer attestations", () => {
    const run = createQualityRun({ runId: "missing-attestation" });
    const firstHumanIndex = run.scores.findIndex((score) => score.scorerType === "human_blind");
    const scores = run.scores.map((score, index) =>
      index === firstHumanIndex ? { ...score, reviewerAttestationId: "" } : score,
    );
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: { ...run, scores },
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.releaseGate.blockers).toContain("human-attestation-invalid");
  });

  it("binds human scores to the frozen blind packet", () => {
    const run = createQualityRun({ runId: "wrong-blind-packet" });
    const firstHumanIndex = run.scores.findIndex((score) => score.scorerType === "human_blind");
    const scores = run.scores.map((score, index) =>
      index === firstHumanIndex ? { ...score, blindPacketSha256: "0".repeat(64) } : score,
    );
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: { ...run, scores },
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.releaseGate.blockers).toContain("human-attestation-invalid");
  });

  it("requires outline evidence for every frozen required beat", () => {
    const run = createQualityRun({ runId: "incomplete-outline-evidence" });
    const firstOutlineIndex = run.scores.findIndex(
      (score) => score.dimension === "outline_adherence",
    );
    const firstOutline = run.scores[firstOutlineIndex]!;
    const sample = [...dataset.chapterSamples, ...dataset.adversarialCases].find(
      (candidate) => candidate.id === firstOutline.sampleId,
    )!;
    const scores = run.scores.map((score, index) =>
      index === firstOutlineIndex
        ? { ...score, evidenceQuotes: sample.requiredBeats.slice(0, 1) }
        : score,
    );
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: { ...run, scores },
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.releaseGate.blockers).toContain("score-evidence-invalid");
  });

  it("blocks any ADR threshold regression even when aggregate quality looks high", () => {
    const run = createQualityRun({ runId: "failing-run", p0Count: 1 });
    const failingRun: QualityBenchmarkRun = {
      ...run,
      scores: run.scores.map((score) => {
        if (score.dimension === "outline_adherence") {
          return { ...score, value: 0.8 };
        }
        if (score.dimension === "hook_prose_score") {
          return { ...score, value: 3.5 };
        }
        return score;
      }),
    };
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: failingRun,
      reviewPolicy: qualityReviewPolicy,
    });

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
      reviewPolicy: qualityReviewPolicy,
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
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.releaseGate.blockers).toEqual(
      expect.arrayContaining(["score-range-invalid", "duplicate-score"]),
    );
  });

  it("blocks a run that was not produced by the continuity execution seam", () => {
    const run = createQualityRun({ runId: "unexecuted" });
    const unexecuted = { ...run } as Partial<typeof run>;
    delete unexecuted.continuityEvaluation;
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: unexecuted as typeof run,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.releaseGate.blockers).toContain("continuity-evaluation-invalid");
  });

  it("recomputes continuity evidence instead of trusting a self-consistent evaluation", () => {
    const run = createQualityRun({ runId: "forged-continuity-evaluation" });
    const forgedEvaluation = structuredClone(run.continuityEvaluation);
    forgedEvaluation.missingFindings = [];
    forgedEvaluation.unexpectedFindings = [];
    forgedEvaluation.releaseGate = {
      passed: true,
      blockers: [],
      p0FalseNegatives: 0,
      knowledgeBoundaryFalseNegatives: 0,
    };
    const withoutDigest = Object.fromEntries(
      Object.entries(forgedEvaluation).filter(([key]) => key !== "sha256"),
    );
    const evaluationWithDigest = {
      ...withoutDigest,
      sha256: sha256Json(withoutDigest),
    };
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: {
        ...run,
        continuityFindings: [],
        continuityEvaluation: evaluationWithDigest,
      },
      reviewPolicy: qualityReviewPolicy,
    });

    expect(report.releaseGate.blockers).toContain("continuity-evaluation-invalid");
  });

  it("replaces caller-supplied deterministic scores with recomputed evidence", () => {
    const run = createQualityRun({ runId: "forged-deterministic-score" });
    const scores = run.scores.map((score) =>
      score.scorerType === "deterministic" && score.dimension === "p0_fact_loss"
        ? { ...score, value: 1 }
        : score,
    );
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: { ...run, scores },
      reviewPolicy: qualityReviewPolicy,
    });

    expect(
      report.scores.find(
        (score) => score.scorerType === "deterministic" && score.dimension === "p0_fact_loss",
      )?.value,
    ).toBe(0);
    expect(report.releaseGate.passed).toBe(true);
  });
});
