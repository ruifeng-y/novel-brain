import path from "node:path";

import { readJsonArtifact, writeJsonArtifact } from "@novel-brain/continuity-benchmark";

import { createQualityBenchmarkDataset, type QualityBenchmarkDataset } from "./dataset";
import {
  evaluateQualityBenchmarkRun,
  type QualityBenchmarkReport,
  type QualityBenchmarkRun,
} from "./evaluator";
import { compareQualityBenchmarkRuns, type QualityRegressionReport } from "./regression";
import { createReleaseQualityRubric, type ReleaseQualityRubric } from "./rubric";

export interface QualityBenchmarkCliResult {
  command: string;
  outputs: readonly string[];
}

export async function runQualityBenchmarkCli(
  argv: readonly string[],
): Promise<QualityBenchmarkCliResult> {
  const { command, options } = parseArguments(argv);
  switch (command) {
    case "dataset": {
      const dataset = createQualityBenchmarkDataset({
        seed: Number(options.seed ?? "20261118"),
        sourceCommit: required(options, "source-commit"),
        continuityTier: parseTier(required(options, "tier")),
      });
      const output = resolvePath(
        options.output ?? `artifacts/quality/benchmark/${dataset.manifest.seed}/dataset.json`,
      );
      await writeJsonArtifact(output, dataset);
      return { command, outputs: [output] };
    }
    case "rubric": {
      const output = resolvePath(options.output ?? "artifacts/quality/benchmark/rubric.json");
      await writeJsonArtifact(output, createReleaseQualityRubric());
      return { command, outputs: [output] };
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
      await writeJsonArtifact(output, evaluateQualityBenchmarkRun({ dataset, rubric, run }));
      return { command, outputs: [output] };
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
      const report: QualityRegressionReport = compareQualityBenchmarkRuns({
        baseline,
        candidate,
      });
      await writeJsonArtifact(output, report);
      return { command, outputs: [output] };
    }
    default:
      throw new Error("Usage: quality <dataset|rubric|evaluate|regress> [options]");
  }
}

function parseTier(value: string): "minimum" | "full" | "maximum" {
  if (value === "minimum" || value === "full" || value === "maximum") {
    return value;
  }
  throw new Error("TIER_INVALID");
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

function resolvePath(value: string): string {
  return path.resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const result = await runQualityBenchmarkCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
