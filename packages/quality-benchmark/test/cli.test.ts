import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createContinuityPlan, generateContinuityFixture } from "@novel-brain/continuity-benchmark";
import { describe, expect, it } from "vitest";

import { runQualityBenchmarkCli } from "../src/cli";
import { createQualityRun } from "./helpers";

describe("quality benchmark cli", () => {
  it("writes dataset, rubric, evaluation and regression artifacts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quality-benchmark-"));
    try {
      const datasetPath = path.join(directory, "dataset.json");
      const rubricPath = path.join(directory, "rubric.json");
      const baselineCandidatePath = path.join(directory, "baseline-candidate.json");
      const candidateCandidatePath = path.join(directory, "candidate-candidate.json");
      const baselineRunPath = path.join(directory, "baseline-run.json");
      const candidateRunPath = path.join(directory, "candidate-run.json");
      const baselineReportPath = path.join(directory, "baseline-report.json");
      const candidateReportPath = path.join(directory, "candidate-report.json");
      const regressionPath = path.join(directory, "regression.json");

      await runQualityBenchmarkCli(["dataset", "--output", datasetPath]);
      await runQualityBenchmarkCli(["rubric", "--output", rubricPath]);
      const fixture = generateContinuityFixture({
        plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
        sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
      });
      const baseline = createQualityRun({ runId: "baseline" });
      const candidate = createQualityRun({
        runId: "candidate",
        promptVersion: "prompt-v2",
      });
      const continuityFindings = fixture.defects.map((defect) => ({
        family: defect.family,
        severity: defect.severity,
        chapterNumber: defect.chapterNumber,
        branchId: defect.branchId,
        entityIds: defect.entityIds,
        sourceFactId: defect.sourceFactId,
        versionNodeId: defect.versionNodeId,
        evidence: defect.evidence,
      }));
      await writeFile(
        baselineCandidatePath,
        `${JSON.stringify(candidateArtifact(baseline, continuityFindings), null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        candidateCandidatePath,
        `${JSON.stringify(candidateArtifact(candidate, continuityFindings), null, 2)}\n`,
        "utf8",
      );

      for (const [candidatePath, runPath, reportPath] of [
        [baselineCandidatePath, baselineRunPath, baselineReportPath],
        [candidateCandidatePath, candidateRunPath, candidateReportPath],
      ] as const) {
        await runQualityBenchmarkCli([
          "execute",
          "--dataset",
          datasetPath,
          "--rubric",
          rubricPath,
          "--candidate",
          candidatePath,
          "--output",
          runPath,
        ]);
        await runQualityBenchmarkCli([
          "evaluate",
          "--dataset",
          datasetPath,
          "--rubric",
          rubricPath,
          "--run",
          runPath,
          "--output",
          reportPath,
        ]);
      }
      await runQualityBenchmarkCli([
        "regress",
        "--baseline",
        baselineReportPath,
        "--candidate",
        candidateReportPath,
        "--output",
        regressionPath,
      ]);

      const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as {
        chapterSamples: unknown[];
        adversarialCases: unknown[];
      };
      const report = JSON.parse(await readFile(candidateReportPath, "utf8")) as {
        status: string;
      };
      const regression = JSON.parse(await readFile(regressionPath, "utf8")) as {
        rolloutAllowed: boolean;
      };
      expect(dataset.chapterSamples).toHaveLength(180);
      expect(dataset.adversarialCases).toHaveLength(24);
      expect(report.status).toBe("passed");
      expect(regression.rolloutAllowed).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function candidateArtifact(
  run: ReturnType<typeof createQualityRun>,
  continuityFindings: readonly Record<string, unknown>[],
) {
  return {
    schemaVersion: 1,
    candidateId: run.runId,
    datasetSha256: run.datasetSha256,
    rubricVersion: run.rubricVersion,
    provenance: run.provenance,
    continuityFindings,
    humanScores: run.scores.filter((score) => score.scorerType === "human_blind"),
    decisions: run.decisions,
  };
}
