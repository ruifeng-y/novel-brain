import path from "node:path";

import { readJsonArtifact, writeJsonArtifact } from "@novel-brain/continuity-benchmark";

import {
  APPROVED_QUALITY_BENCHMARK_DATASET_SHA256,
  verifyQualityBenchmarkDataset,
  type QualityBenchmarkDataset,
} from "./dataset";
import {
  evaluateQualityBenchmarkRun,
  type QualityBenchmarkReport,
  type QualityBenchmarkRun,
} from "./evaluator";
import { executeQualityBenchmarkCandidate, type QualityBenchmarkCandidate } from "./execute";
import { compareQualityBenchmarkRuns, type QualityRegressionReport } from "./regression";
import {
  APPROVED_QUALITY_RUBRIC_SHA256,
  verifyReleaseQualityRubric,
  type QualityBenchmarkReviewPolicy,
  type ReleaseQualityRubric,
} from "./rubric";

export interface QualityBenchmarkCliResult {
  command: string;
  outputs: readonly string[];
  passed: boolean;
}

export async function runQualityBenchmarkCli(
  argv: readonly string[],
): Promise<QualityBenchmarkCliResult> {
  const { command, options } = parseArguments(argv);
  switch (command) {
    case "dataset": {
      const dataset = await readJsonArtifact<QualityBenchmarkDataset>(
        resolvePath(options.source ?? "docs/quality/quality-benchmark-v1.dataset.json"),
      );
      if (
        !verifyQualityBenchmarkDataset(dataset) ||
        dataset.manifest.datasetSha256 !== APPROVED_QUALITY_BENCHMARK_DATASET_SHA256
      ) {
        throw new Error("QUALITY_DATASET_NOT_APPROVED");
      }
      const output = resolvePath(
        options.output ?? `artifacts/quality/benchmark/${dataset.manifest.seed}/dataset.json`,
      );
      await writeJsonArtifact(output, dataset);
      return { command, outputs: [output], passed: true };
    }
    case "rubric": {
      const rubric = await readJsonArtifact<ReleaseQualityRubric>(
        resolvePath(options.source ?? "docs/quality/quality-benchmark-v1.rubric.json"),
      );
      if (!verifyReleaseQualityRubric(rubric) || rubric.sha256 !== APPROVED_QUALITY_RUBRIC_SHA256) {
        throw new Error("QUALITY_RUBRIC_NOT_APPROVED");
      }
      const output = resolvePath(options.output ?? "artifacts/quality/benchmark/rubric.json");
      await writeJsonArtifact(output, rubric);
      return { command, outputs: [output], passed: true };
    }
    case "execute": {
      const dataset = await readJsonArtifact<QualityBenchmarkDataset>(
        resolvePath(required(options, "dataset")),
      );
      const rubric = await readJsonArtifact<ReleaseQualityRubric>(
        resolvePath(required(options, "rubric")),
      );
      const candidate = await readJsonArtifact<QualityBenchmarkCandidate>(
        resolvePath(required(options, "candidate")),
      );
      const output = resolvePath(
        options.output ??
          path.join(path.dirname(resolvePath(required(options, "candidate"))), "quality-run.json"),
      );
      await writeJsonArtifact(
        output,
        executeQualityBenchmarkCandidate({ dataset, rubric, candidate }),
      );
      return { command, outputs: [output], passed: true };
    }
    case "evaluate": {
      const dataset = await readJsonArtifact<QualityBenchmarkDataset>(
        resolvePath(required(options, "dataset")),
      );
      const rubric = await readJsonArtifact<ReleaseQualityRubric>(
        resolvePath(required(options, "rubric")),
      );
      const run = await readJsonArtifact<QualityBenchmarkRun>(
        resolvePath(required(options, "run")),
      );
      const output = resolvePath(
        options.output ??
          path.join(path.dirname(resolvePath(required(options, "run"))), "quality-report.json"),
      );
      const reviewPolicy = await optionalReviewPolicy(options);
      const report = evaluateQualityBenchmarkRun({
        dataset,
        rubric,
        run,
        ...(reviewPolicy ? { reviewPolicy } : {}),
      });
      await writeJsonArtifact(output, report);
      return { command, outputs: [output], passed: report.status === "passed" };
    }
    case "regress": {
      const baseline = await readJsonArtifact<QualityBenchmarkReport>(
        resolvePath(required(options, "baseline")),
      );
      const candidate = await readJsonArtifact<QualityBenchmarkReport>(
        resolvePath(required(options, "candidate")),
      );
      const output = resolvePath(
        options.output ??
          path.join(path.dirname(resolvePath(required(options, "candidate"))), "regression.json"),
      );
      const reviewPolicy = await optionalReviewPolicy(options);
      const report: QualityRegressionReport = compareQualityBenchmarkRuns({
        baseline,
        candidate,
        ...(reviewPolicy ? { reviewPolicy } : {}),
      });
      await writeJsonArtifact(output, report);
      return { command, outputs: [output], passed: report.rolloutAllowed };
    }
    default:
      throw new Error("Usage: quality <dataset|rubric|execute|evaluate|regress> [options]");
  }
}

function parseArguments(argv: readonly string[]): {
  command: string | undefined;
  options: Record<string, string>;
} {
  const [command, ...rest] = argv;
  const options: Record<string, string> = {};
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument ?? ""}`);
    }
    const name = argument.slice(2);
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

function required(options: Record<string, string>, name: string): string {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

async function optionalReviewPolicy(
  options: Record<string, string>,
): Promise<QualityBenchmarkReviewPolicy | null> {
  const value = options["review-policy"];
  return value ? readJsonArtifact<QualityBenchmarkReviewPolicy>(resolvePath(value)) : null;
}

function resolvePath(value: string): string {
  return path.resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const result = await runQualityBenchmarkCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("cli.js") || process.argv[1]?.endsWith("cli.ts")) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
