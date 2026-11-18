import { describe, expect, it } from "vitest";

import { sha256Json } from "@novel-brain/continuity-benchmark";

import { evaluateQualityBenchmarkRun } from "../src/evaluator";
import { compareQualityBenchmarkRuns } from "../src/regression";
import {
  createQualityRun,
  qualityDataset as dataset,
  qualityReviewPolicy,
  qualityRubric as rubric,
} from "./helpers";

const baselineRun = createQualityRun({
  runId: "baseline",
  promptVersion: "prompt-v1",
  contextCompilerVersion: "context-v1",
  agentContractVersion: "agent-v1",
});
const baseline = evaluateQualityBenchmarkRun({
  dataset,
  rubric,
  run: baselineRun,
  reviewPolicy: qualityReviewPolicy,
});

describe("quality benchmark regression gate", () => {
  it("allows rollout after a prompt change when the same suite still passes", () => {
    const candidateRun = createQualityRun({
      runId: "candidate",
      promptVersion: "prompt-v2",
      contextCompilerVersion: "context-v2",
      agentContractVersion: "agent-v2",
    });
    const candidate = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: candidateRun,
      reviewPolicy: qualityReviewPolicy,
    });
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(true);
    expect(regression.blockers).toEqual([]);
    expect(regression.changedProvenance).toEqual([
      "agentContractVersion",
      "contextCompilerVersion",
      "promptVersion",
    ]);
  });

  it("blocks rollout on P0 regression or a failed candidate release gate", () => {
    const candidateRun = createQualityRun({
      runId: "candidate-regression",
      promptVersion: "prompt-v2",
      contextCompilerVersion: "context-v2",
      agentContractVersion: "agent-v2",
      p0Count: 1,
      outline: 0.8,
    });
    const candidate = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: candidateRun,
      reviewPolicy: qualityReviewPolicy,
    });
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toEqual(
      expect.arrayContaining(["candidate-release-gate-failed", "p0-regression"]),
    );
    expect(regression.p0).toEqual({
      baseline: 0,
      candidate: 1,
      regressed: true,
    });
  });

  it("blocks rollout when the candidate is the same run as the baseline", () => {
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate: baseline,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toContain("candidate-not-distinct");
  });

  it("blocks tampered baseline or candidate reports", () => {
    const candidate = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: createQualityRun({ runId: "candidate" }),
      reviewPolicy: qualityReviewPolicy,
    });
    const tampered = structuredClone(candidate);
    tampered.metrics[0]!.value = 99;
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate: tampered,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toContain("report-invalid");
  });

  it("rejects self-consistent reports with missing approved metrics", () => {
    const forged = structuredClone(baseline);
    forged.runId = "forged-empty-report";
    forged.metrics = [];
    forged.releaseGate = { passed: true, blockers: [] };
    forged.status = "passed";
    forged.sha256 = reportDigest(forged);

    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate: forged,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toEqual(
      expect.arrayContaining(["report-invalid", "metric-missing:p0_fact_loss"]),
    );
    expect(regression.p0.candidate).toBeNull();
  });

  it("rejects self-consistent reports whose metrics do not match their evidence", () => {
    const forged = structuredClone(baseline);
    forged.metrics = forged.metrics.map((metric) =>
      metric.id === "p0_fact_loss" ? { ...metric, value: 1 } : metric,
    );
    forged.sha256 = reportDigest(forged);

    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate: forged,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toContain("report-invalid");
  });

  it("does not trust a threshold embedded in the report", () => {
    const forged = structuredClone(baseline);
    forged.humanReview = {
      ...forged.humanReview,
      varianceThreshold: 999,
    };
    forged.sha256 = reportDigest(forged);

    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate: forged,
      reviewPolicy: qualityReviewPolicy,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toContain("report-invalid");
  });
});

function reportDigest(report: ReturnType<typeof evaluateQualityBenchmarkRun>): string {
  return sha256Json(Object.fromEntries(Object.entries(report).filter(([key]) => key !== "sha256")));
}
