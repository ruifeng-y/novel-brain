import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runQualityBenchmarkCli } from "../src/cli";
import { createQualityRun } from "./helpers";

describe("quality benchmark cli", () => {
  it("writes dataset, rubric, evaluation and regression artifacts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quality-benchmark-"));
    try {
      const datasetPath = path.join(directory, "dataset.json");
      const rubricPath = path.join(directory, "rubric.json");
      const baselineRunPath = path.join(directory, "baseline-run.json");
      const candidateRunPath = path.join(directory, "candidate-run.json");
      const baselineReportPath = path.join(directory, "baseline-report.json");
      const candidateReportPath = path.join(directory, "candidate-report.json");
      const regressionPath = path.join(directory, "regression.json");

      await runQualityBenchmarkCli([
        "dataset",
        "--seed",
        "20261118",
        "--source-commit",
        "abc1234",
        "--tier",
        "minimum",
        "--output",
        datasetPath,
      ]);
      await runQualityBenchmarkCli(["rubric", "--output", rubricPath]);
      await writeFile(
        baselineRunPath,
        `${JSON.stringify(createQualityRun({ runId: "baseline" }), null, 2)}\n`,
        "utf8",
      );
      await writeFile(
        candidateRunPath,
        `${JSON.stringify(
          createQualityRun({
            runId: "candidate",
            promptVersion: "prompt-v2",
          }),
          null,
          2,
        )}\n`,
        "utf8",
      );

      for (const [runPath, reportPath] of [
        [baselineRunPath, baselineReportPath],
        [candidateRunPath, candidateReportPath],
      ] as const) {
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
