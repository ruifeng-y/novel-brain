import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluateQualityBenchmarkRun } from "../../packages/quality-benchmark/src/evaluator";
import {
  createQualityRun,
  qualityDataset,
  qualityRubric,
} from "../../packages/quality-benchmark/test/helpers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relativePath) => JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
const readText = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

const policyPath = "docs/quality/evidence/m3-240/review-policy.json";

function twoReviewerVariance(values) {
  if (values.length !== 2)
    throw new Error(`expected two reviewer scores, received ${values.length}`);
  return (values[0] - values[1]) ** 2 / 4;
}

describe("M3-240 approved inter-rater variance threshold", () => {
  it("records the approved policy, release handling and warning rationale", () => {
    const policy = readJson(policyPath);
    const rubric = readJson("docs/quality/quality-benchmark-v1.rubric.json");

    expect(policy).toMatchObject({
      schemaVersion: 1,
      issue: 240,
      decisionId: "interRaterVarianceThreshold",
      interRaterVarianceThreshold: 0.1,
      owner: "product-owner",
      decidedAt: "2026-11-26T00:00:00+08:00",
      releaseGate: {
        comparison: "maxVariance > interRaterVarianceThreshold",
        blocker: "inter-rater-variance-above-threshold",
        releaseStatus: "blocked",
        waiverAllowed: false,
      },
      completionTimeWarningDecision: {
        warning: "reviewer-completion-times-identical",
        accepted: true,
      },
    });
    expect(policy.rationale).toContain("half-step");
    expect(policy.completionTimeWarningDecision.rationale).toContain("提交");
    expect(policy.frozenEvidence.rubricSha256).toBe(rubric.sha256);
    expect(rubric.reviewPolicy).toBeNull();
  });

  it("binds the approved policy to the frozen 816-score evidence", () => {
    const policy = readJson(policyPath);
    const evidence = readJson("docs/quality/evidence/m3-239/human-scores.json");
    const validation = readJson("docs/quality/evidence/m3-239/validation.json");
    const groups = new Map();

    for (const score of evidence.humanScores) {
      const key = `${score.sampleId}:${score.dimension}`;
      groups.set(key, [...(groups.get(key) ?? []), score.value]);
    }

    const observedMaxVariance = Math.max(
      ...[...groups.values()].map((values) => twoReviewerVariance(values)),
    );
    expect(evidence.humanScores).toHaveLength(816);
    expect(groups.size).toBe(408);
    expect(observedMaxVariance).toBe(0);
    expect(observedMaxVariance).toBe(validation.observedMaxVariance);
    expect(policy.frozenEvidence).toEqual({
      reviewId: evidence.reviewId,
      datasetSha256: evidence.datasetSha256,
      rubricSha256: evidence.rubricSha256,
      gateBlindPacketSha256: evidence.gateBlindPacketSha256,
      humanScoreRows: evidence.humanScores.length,
      sampleDimensionPairs: groups.size,
      observedMaxVariance,
    });
  });

  it("uses the evaluator to allow a half-step and block a full-step disagreement", () => {
    const policy = readJson(policyPath);
    const run = createQualityRun({
      runId: "m3-240-policy-current",
      outline: 1,
      hookProse: 2,
    });
    const report = evaluateQualityBenchmarkRun({
      dataset: qualityDataset,
      rubric: qualityRubric,
      run,
      reviewPolicy: policy,
    });
    const targetScore = run.scores.find(
      (score) =>
        score.scorerType === "human_blind" &&
        score.scorerId === "reviewer-b" &&
        score.dimension === "hook_prose_score",
    );
    const halfStepRun = {
      ...run,
      scores: run.scores.map((score) =>
        score === targetScore ? { ...score, value: score.value + 0.5 } : score,
      ),
    };
    const halfStepReport = evaluateQualityBenchmarkRun({
      dataset: qualityDataset,
      rubric: qualityRubric,
      run: halfStepRun,
      reviewPolicy: policy,
    });
    const breachedRun = {
      ...run,
      scores: run.scores.map((score) =>
        score === targetScore ? { ...score, value: score.value + 1 } : score,
      ),
    };
    const breachedReport = evaluateQualityBenchmarkRun({
      dataset: qualityDataset,
      rubric: qualityRubric,
      run: breachedRun,
      reviewPolicy: policy,
    });

    expect(report.humanReview.maxVariance).toBe(0);
    expect(report.humanReview.varianceThreshold).toBe(0.1);
    expect(report.releaseGate.blockers).not.toContain("inter-rater-variance-above-threshold");
    expect(halfStepReport.humanReview.maxVariance).toBe(0.0625);
    expect(halfStepReport.releaseGate.blockers).not.toContain(
      "inter-rater-variance-above-threshold",
    );
    expect(breachedReport.humanReview.maxVariance).toBe(0.25);
    expect(breachedReport.releaseGate.blockers).toContain(policy.releaseGate.blocker);
  });

  it("updates release evidence without clearing the remaining quality blockers", () => {
    const releaseEvidence = readJson("docs/implementation/v1-release-evidence.json");
    const humanReviewGate = releaseEvidence.gates.find((gate) => gate.id === "human-blind-review");
    const checklist = readText("docs/implementation/v1-release-checklist.md");

    expect(releaseEvidence.releaseStatus).toBe("blocked");
    expect(humanReviewGate.status).toBe("blocked");
    expect(humanReviewGate.rationale).toContain("approved threshold 0.1");
    expect(humanReviewGate.rationale).toContain("hook/prose");
    expect(humanReviewGate.rationale).not.toContain("threshold remains unapproved");
    expect(humanReviewGate.evidence).toContain(policyPath);
    expect(checklist).toContain(policyPath);
    expect(checklist).not.toContain("Approve and record the inter-rater variance threshold");
  });

  it("keeps EVAL-002 bounded on final release CI while recording threshold evidence", () => {
    const capabilityEvidence = readJson(
      "docs/implementation/m3-236-non-ui-capability-evidence.json",
    );
    const traceability = readText("docs/planning/v1-capability-traceability.md");

    expect(capabilityEvidence.evidence["variance-threshold-policy"]).toEqual({
      kind: "guardrail",
      path: "scripts/test/m3-240-variance-threshold.test.mjs",
    });
    expect(capabilityEvidence.capabilities["EVAL-002"]).toMatchObject({
      status: "implemented",
      evidence: expect.arrayContaining(["variance-threshold-policy"]),
      gap: {
        issue: "#242",
      },
    });
    expect(capabilityEvidence.capabilities["CONT-001"].gap.issue).toBe("#273");
    expect(traceability).toMatch(/\| EVAL-002 \| 评分 rubric\/阈值\/回归 \| V1 \| implemented \|/u);
    expect(traceability).toContain(policyPath);
  });
});
