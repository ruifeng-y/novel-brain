import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { assertBenchmarkDatabaseTarget } from "./database-safety";
import {
  createBenchmarkPlan,
  digestBenchmarkManuscript,
  type BenchmarkTier,
  type BenchmarkTopology,
} from "./dataset";
import { collectEnvironmentManifest } from "./environment";
import {
  validateFailureInjectionEvidence,
  type FailureInjectionEvidence,
} from "./failure-injection";
import { runWorkload, type WorkloadSummary } from "./harness";
import { buildBenchmarkReport, type BenchmarkDecision, type RecoveryEvidence } from "./report";
import { readJsonArtifact, writeJsonArtifact } from "./report-io";
import { seedBenchmarkFixture, type FixtureManifest } from "./seed";
import { compareTargets } from "./targets";

async function main(): Promise<void> {
  const { command, options } = parseArguments(process.argv.slice(2));
  switch (command) {
    case "plan": {
      const plan = createBenchmarkPlan({
        seed: Number(options.seed ?? "20261117"),
        tier: (options.tier ?? "full") as BenchmarkTier,
        topology: (options.topology ?? "mid") as BenchmarkTopology,
        ...(options.branches ? { branchCount: Number(options.branches) } : {}),
        ...(options["growth-percent"] ? { growthPercent: Number(options["growth-percent"]) } : {}),
      });
      const digest = digestBenchmarkManuscript(plan);
      const output = options.output
        ? resolvePath(options.output)
        : resolvePath(`artifacts/capacity/${options.seed ?? plan.seed}/plan.json`);
      await writeJsonArtifact(output, { plan, digest });
      writeOutput({ output, plan, digest });
      return;
    }
    case "seed": {
      const databaseUrl = required(options, "database-url");
      const confirmDatabase = required(options, "confirm-database");
      assertBenchmarkDatabaseTarget(databaseUrl, confirmDatabase);
      const plan = createBenchmarkPlan({
        seed: Number(options.seed ?? "20261117"),
        tier: (options.tier ?? "full") as BenchmarkTier,
        topology: (options.topology ?? "mid") as BenchmarkTopology,
        ...(options.branches ? { branchCount: Number(options.branches) } : {}),
        ...(options["growth-percent"] ? { growthPercent: Number(options["growth-percent"]) } : {}),
      });
      const manifest = await seedBenchmarkFixture({
        databaseUrl,
        confirmedDatabaseName: confirmDatabase,
        plan,
        ...(options["source-commit"] ? { sourceCommit: options["source-commit"] } : {}),
      });
      const output = options.output
        ? resolvePath(options.output)
        : resolvePath(`artifacts/capacity/${plan.seed}-${plan.tier}/fixture-manifest.json`);
      await writeJsonArtifact(output, manifest);
      writeOutput({
        output,
        seed: manifest.seed,
        logicalCharacters: manifest.logicalCharacters,
        chapterCount: manifest.chapterCount,
        volumeCount: manifest.volumeCount,
        branchCount: manifest.branchCount,
        manuscriptSha256: manifest.manuscriptSha256,
        rowCounts: manifest.rowCounts,
      });
      return;
    }
    case "environment": {
      const manifest = await collectEnvironmentManifest({
        apiBaseUrl: options["api-base-url"] ?? "http://localhost:3001",
        ...(options["source-commit"] ? { sourceCommit: options["source-commit"] } : {}),
        ...(options.repository ? { repositoryPath: resolvePath(options.repository) } : {}),
        ...(options["compose-project"] ? { composeProject: options["compose-project"] } : {}),
      });
      const output = options.output
        ? resolvePath(options.output)
        : resolvePath("artifacts/capacity/environment.json");
      await writeJsonArtifact(output, manifest);
      writeOutput({ output, baseline: manifest.baseline, docker: manifest.docker });
      return;
    }
    case "workload": {
      const fixturePath = resolvePath(required(options, "fixture"));
      const databaseUrl = required(options, "database-url");
      const confirmDatabase = required(options, "confirm-database");
      assertBenchmarkDatabaseTarget(databaseUrl, confirmDatabase);
      const fixture = await readJsonArtifact<FixtureManifest>(fixturePath);
      const environmentPath = resolvePath(required(options, "environment"));
      const outputDirectory = resolvePath(options.output ?? path.dirname(fixturePath));
      const summary = await runWorkload({
        fixtureManifest: fixture,
        apiBaseUrl: options["api-base-url"] ?? "http://localhost:3001",
        databaseUrl,
        environmentPath,
        concurrency: Number(options.concurrency ?? "4"),
        durationSeconds: Number(options["duration-seconds"] ?? "60"),
        rampSeconds: Number(options["ramp-seconds"] ?? "10"),
        outputDirectory: relativePath(outputDirectory),
        ...(options.origin ? { origin: options.origin } : {}),
        ...(options["storage-metrics-url"]
          ? { storageMetricsUrl: options["storage-metrics-url"] }
          : {}),
        ...(options["compose-project"] ? { composeProject: options["compose-project"] } : {}),
      });
      writeOutput({
        summaryPath: summary.artifacts.summaryPath,
        rawSamplesPath: summary.artifacts.rawSamplesPath,
        elapsedMs: summary.elapsedMs,
        overall: summary.overall,
        targets: summary.targets,
      });
      return;
    }
    case "report": {
      const fixturePath = resolvePath(required(options, "fixture"));
      const workloadPath = resolvePath(required(options, "workload"));
      const environmentPath = resolvePath(required(options, "environment"));
      const fixture = await readJsonArtifact<FixtureManifest>(fixturePath);
      const workload = await readJsonArtifact<WorkloadSummary>(workloadPath);
      const environment = await readJsonArtifact<{
        sourceCommit?: string;
        baseline: { certificationEligible: boolean };
      }>(environmentPath);
      const environmentSha256 = createHash("sha256")
        .update(await readFile(environmentPath))
        .digest("hex");
      const recovery = options.recovery
        ? await readJsonArtifact<RecoveryEvidence>(resolvePath(options.recovery))
        : null;
      const decisions = options.decisions
        ? await readJsonArtifact<BenchmarkDecision[]>(resolvePath(options.decisions))
        : [];
      const queryPlansPath = options["query-plans"] ? resolvePath(options["query-plans"]) : null;
      const failureInjectionPath = options["failure-injection"]
        ? resolvePath(options["failure-injection"])
        : null;
      const queryPlansVerified = queryPlansPath
        ? await queryPlansMatchRun(queryPlansPath, workload.runId)
        : false;
      const failureInjectionVerified = failureInjectionPath
        ? await failureInjectionMatchesRun(
            failureInjectionPath,
            workload.runId,
            fixture.sourceCommit,
          )
        : false;
      const rawArtifactPaths = [
        fixturePath,
        workloadPath,
        environmentPath,
        resolvePath(workload.artifacts.rawSamplesPath),
        ...(options.recovery ? [resolvePath(options.recovery)] : []),
        ...(queryPlansPath ? [queryPlansPath] : []),
        ...(failureInjectionPath ? [failureInjectionPath] : []),
      ];
      const artifactHashes = await hashArtifacts(rawArtifactPaths);
      const comparison = compareTargets({
        ...workload.targets,
        measuredRpoHours: recovery?.measuredRpoHours ?? null,
        measuredRtoHours: recovery?.measuredRtoHours ?? null,
        apiConcurrency: workload.profile.apiConcurrency,
        apiErrorRate: workload.overall.errorRate,
        branchCount: fixture.branchCount,
        storageHeadroomBytes: null,
        backupCapacityIncluded: null,
        restoreDatasetTier: null,
        largeVersionCompareP95Ms: null,
      });
      const report = buildBenchmarkReport({
        sourceCommit: fixture.sourceCommit,
        fixtureManifest: {
          logicalCharacters: fixture.logicalCharacters,
          chapterCount: fixture.chapterCount,
          volumeCount: fixture.volumeCount,
          branchCount: fixture.branchCount,
          sha256: fixture.manuscriptSha256,
          objectCount: fixture.objectCount,
          objectChecksums: fixture.objectChecksums,
          branchTopology: fixture.branchTopology,
          versionNodeTypes: fixture.versionNodeTypes,
        },
        workloadManifest: {
          apiConcurrency: workload.profile.apiConcurrency,
          durationSeconds: workload.profile.durationSeconds,
        },
        workloadRunId: workload.runId,
        targetComparison: comparison,
        recovery,
        decisions,
        environment,
        artifactsConsistent:
          fixture.sourceCommit === workload.sourceCommit &&
          fixture.manuscriptSha256 === workload.fixtureSha256 &&
          environment.sourceCommit === fixture.sourceCommit,
        environmentMatchesWorkload:
          workload.environmentSha256 !== null && workload.environmentSha256 === environmentSha256,
        queryPlansVerified,
        failureInjectionVerified,
        artifactHashes: Object.fromEntries(
          [...artifactHashes].map(([artifactPath, hash]) => [relativePath(artifactPath), hash]),
        ),
        rawArtifacts: rawArtifactPaths.map(relativePath),
      });
      const output = resolvePath(
        options.output ?? path.join(path.dirname(workloadPath), "capacity-report.json"),
      );
      await writeJsonArtifact(output, report);
      writeOutput({
        output,
        status: report.status,
        tenMReady: report.tenMReady,
        blockers: report.blockers,
      });
      return;
    }
    default:
      throw new Error("Usage: capacity <plan|seed|environment|workload|report> [options]");
  }
}

function parseArguments(argv: string[]): {
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

function relativePath(value: string): string {
  return path.relative(process.cwd(), value).replaceAll("\\", "/") || ".";
}

async function hashArtifacts(paths: readonly string[]): Promise<Map<string, string>> {
  return new Map(
    await Promise.all(
      paths.map(
        async (filePath) =>
          [
            filePath,
            createHash("sha256")
              .update(await readFile(filePath))
              .digest("hex"),
          ] as const,
      ),
    ),
  );
}

async function queryPlansMatchRun(filePath: string, runId: string): Promise<boolean> {
  const text = await readFile(filePath, "utf8");
  return text.includes("Execution Time") && text.includes(`Run: ${runId}`);
}

async function failureInjectionMatchesRun(
  filePath: string,
  runId: string,
  sourceCommit: string,
): Promise<boolean> {
  const evidence = await readJsonArtifact<FailureInjectionEvidence>(filePath);
  return validateFailureInjectionEvidence(evidence, { runId, sourceCommit });
}

function writeOutput(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
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
