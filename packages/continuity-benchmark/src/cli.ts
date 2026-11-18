import path from "node:path";

import {
  buildContinuityBlindReviewPacket,
  type BlindReviewOracle,
  type BlindReviewPacket,
} from "./blind-review";
import {
  evaluateContinuityFindings,
  type ContinuityEvaluation,
  type ContinuityFinding,
} from "./evaluator";
import { generateContinuityFixture, type ContinuityFixture } from "./fixture";
import { createContinuityPlan, type ContinuityPlan, type ContinuityTier } from "./plan";
import {
  buildContinuityBenchmarkReport,
  type ContinuityBenchmarkDecision,
  type ContinuityReviewEvidence,
} from "./report";
import { readJsonArtifact, writeJsonArtifact } from "./report-io";

export interface ContinuityCliResult {
  command: string;
  outputs: readonly string[];
}

export async function runContinuityCli(argv: readonly string[]): Promise<ContinuityCliResult> {
  const { command, options } = parseArguments(argv);
  switch (command) {
    case "plan": {
      const plan = createPlanFromOptions(options);
      const output = resolvePath(
        options.output ?? `artifacts/quality/continuity/${plan.seed}-${plan.tier}/plan.json`,
      );
      await writeJsonArtifact(output, plan);
      return { command, outputs: [output] };
    }
    case "generate": {
      const plan = createPlanFromOptions(options);
      const sourceCommit = required(options, "source-commit");
      const fixture = generateContinuityFixture({ plan, sourceCommit });
      const output = resolvePath(
        options.output ?? `artifacts/quality/continuity/${plan.seed}-${plan.tier}/fixture.json`,
      );
      await writeJsonArtifact(output, fixture);
      return { command, outputs: [output] };
    }
    case "evaluate": {
      const fixturePath = resolvePath(required(options, "fixture"));
      const findingsPath = resolvePath(required(options, "findings"));
      const fixture = await readJsonArtifact<ContinuityFixture>(fixturePath);
      const findings = await readJsonArtifact<ContinuityFinding[]>(findingsPath);
      const evaluation = evaluateContinuityFindings({ fixture, findings });
      const output = resolvePath(
        options.output ?? path.join(path.dirname(findingsPath), "evaluation.json"),
      );
      await writeJsonArtifact(output, evaluation);
      return { command, outputs: [output] };
    }
    case "review-plan": {
      const fixture = await readJsonArtifact<ContinuityFixture>(
        resolvePath(required(options, "fixture")),
      );
      const samplesPerStratum = Number(required(options, "samples-per-stratum"));
      const { packet, oracle } = buildContinuityBlindReviewPacket({
        fixture,
        samplesPerStratum,
      });
      const packetOutput = resolvePath(
        options["packet-output"] ??
          path.join(path.dirname(required(options, "fixture")), "blind-review-packet.json"),
      );
      const oracleOutput = resolvePath(
        options["oracle-output"] ??
          path.join(path.dirname(packetOutput), "blind-review-oracle.json"),
      );
      await writeJsonArtifact(packetOutput, packet);
      await writeJsonArtifact(oracleOutput, oracle);
      return { command, outputs: [packetOutput, oracleOutput] };
    }
    case "report": {
      const fixture = await readJsonArtifact<ContinuityFixture>(
        resolvePath(required(options, "fixture")),
      );
      const evaluation = await readJsonArtifact<ContinuityEvaluation>(
        resolvePath(required(options, "evaluation")),
      );
      const packet = await readJsonArtifact<BlindReviewPacket>(
        resolvePath(required(options, "review-packet")),
      );
      const oracle = await readJsonArtifact<BlindReviewOracle>(
        resolvePath(required(options, "review-oracle")),
      );
      const reviewEvidence = options["review-evidence"]
        ? await readJsonArtifact<ContinuityReviewEvidence>(resolvePath(options["review-evidence"]))
        : null;
      const decisions = options.decisions
        ? await readJsonArtifact<ContinuityBenchmarkDecision[]>(resolvePath(options.decisions))
        : [];
      const report = buildContinuityBenchmarkReport({
        fixture,
        evaluation,
        blindReviewPacket: packet,
        blindReviewOracle: oracle,
        reviewEvidence,
        decisions,
      });
      const output = resolvePath(
        options.output ??
          path.join(
            path.dirname(resolvePath(required(options, "evaluation"))),
            "continuity-report.json",
          ),
      );
      await writeJsonArtifact(output, report);
      return { command, outputs: [output] };
    }
    default:
      throw new Error("Usage: continuity <plan|generate|evaluate|review-plan|report> [options]");
  }
}

function createPlanFromOptions(options: Record<string, string>): ContinuityPlan {
  return createContinuityPlan({
    seed: Number(options.seed ?? "20261118"),
    tier: (options.tier ?? "full") as ContinuityTier,
  });
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
  const result = await runContinuityCli(process.argv.slice(2));
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
