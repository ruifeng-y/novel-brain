import { describe, expect, it } from "vitest";

import { evaluateQualityBenchmarkRun } from "../src/evaluator";
import { compareQualityBenchmarkRuns } from "../src/regression";
import { createQualityRun, qualityDataset as dataset, qualityRubric as rubric } from "./helpers";

const baselineRun = createQualityRun({
  runId: "baseline",
  promptVersion: "prompt-v1",
  contextCompilerVersion: "context-v1",
  agentContractVersion: "agent-v1",
});
const baseline = evaluateQualityBenchmarkRun({ dataset, rubric, run: baselineRun });

describe("quality benchmark regression gate", () => {
  it("allows rollout after a prompt change when the same suite still passes", () => {
    const candidateRun = createQualityRun({
      runId: "candidate",
      promptVersion: "prompt-v2",
      contextCompilerVersion: "context-v2",
      agentContractVersion: "agent-v2",
    });
    const candidate = evaluateQualityBenchmarkRun({ dataset, rubric, run: candidateRun });
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate,
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
    const candidate = evaluateQualityBenchmarkRun({ dataset, rubric, run: candidateRun });
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate,
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

  it("blocks tampered baseline or candidate reports", () => {
    const candidate = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run: createQualityRun({ runId: "candidate" }),
    });
    const tampered = structuredClone(candidate);
    tampered.metrics[0]!.value = 99;
    const regression = compareQualityBenchmarkRuns({
      baseline,
      candidate: tampered,
    });

    expect(regression.rolloutAllowed).toBe(false);
    expect(regression.blockers).toContain("report-digest-mismatch");
  });
});
