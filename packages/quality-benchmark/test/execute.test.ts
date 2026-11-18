import { describe, expect, it } from "vitest";

import { createContinuityPlan, generateContinuityFixture } from "@novel-brain/continuity-benchmark";

import { evaluateQualityBenchmarkRun } from "../src/evaluator";
import { executeQualityBenchmarkCandidate } from "../src/execute";
import { createQualityRun, qualityDataset, qualityRubric } from "./helpers";

describe("quality benchmark execution", () => {
  it("runs the deterministic continuity evaluator instead of trusting supplied scores", () => {
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
      sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
    });
    const humanRun = createQualityRun({ runId: "candidate-human" });
    const run = executeQualityBenchmarkCandidate({
      dataset: qualityDataset,
      rubric: qualityRubric,
      candidate: {
        schemaVersion: 1,
        candidateId: "candidate-1",
        datasetSha256: qualityDataset.manifest.datasetSha256,
        rubricVersion: qualityRubric.rubricVersion,
        provenance: humanRun.provenance,
        continuityFindings: fixture.defects.map((defect) => ({
          family: defect.family,
          severity: defect.severity,
          chapterNumber: defect.chapterNumber,
          branchId: defect.branchId,
          entityIds: defect.entityIds,
          sourceFactId: defect.sourceFactId,
          versionNodeId: defect.versionNodeId,
          evidence: defect.evidence,
        })),
        humanScores: humanRun.scores.filter((score) => score.scorerType === "human_blind"),
        decisions: humanRun.decisions,
      },
    });
    const report = evaluateQualityBenchmarkRun({
      dataset: qualityDataset,
      rubric: qualityRubric,
      run,
    });

    expect(run.continuityEvaluation?.releaseGate.passed).toBe(true);
    expect(run.scores.filter((score) => score.scorerType === "deterministic")).not.toHaveLength(0);
    expect(report.status).toBe("passed");
  });

  it("turns a missing P0 finding into a failing deterministic score", () => {
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
      sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
    });
    const humanRun = createQualityRun({ runId: "candidate-human" });
    const missingP0 = fixture.defects.find((defect) => defect.severity === "P0")!;
    const run = executeQualityBenchmarkCandidate({
      dataset: qualityDataset,
      rubric: qualityRubric,
      candidate: {
        schemaVersion: 1,
        candidateId: "candidate-missing-p0",
        datasetSha256: qualityDataset.manifest.datasetSha256,
        rubricVersion: qualityRubric.rubricVersion,
        provenance: humanRun.provenance,
        continuityFindings: fixture.defects
          .filter((defect) => defect.id !== missingP0.id)
          .map((defect) => ({
            family: defect.family,
            severity: defect.severity,
            chapterNumber: defect.chapterNumber,
            branchId: defect.branchId,
            entityIds: defect.entityIds,
            sourceFactId: defect.sourceFactId,
            versionNodeId: defect.versionNodeId,
            evidence: defect.evidence,
          })),
        humanScores: humanRun.scores.filter((score) => score.scorerType === "human_blind"),
        decisions: humanRun.decisions,
      },
    });
    const report = evaluateQualityBenchmarkRun({
      dataset: qualityDataset,
      rubric: qualityRubric,
      run,
    });

    expect(report.status).toBe("blocked");
    expect(report.releaseGate.blockers).toContain("threshold-failed:p0_fact_loss");
  });
});
