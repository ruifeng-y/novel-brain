import type { TargetComparison } from "./targets";

export interface ReportFixtureManifest {
  logicalCharacters: number;
  chapterCount: number;
  volumeCount: number;
  branchCount: number;
  sha256: string;
  objectCount?: number;
  objectChecksums?: string[];
  branchTopology?: {
    parallelBranchCount: number;
    divergenceDepth: number;
    branches: Array<{
      name: string;
      divergenceChapter: number;
      branchChapterCount: number;
    }>;
  };
  versionNodeTypes?: Record<string, number>;
}

export interface ReportWorkloadManifest {
  apiConcurrency: number;
  durationSeconds: number;
}

export interface RecoveryEvidence {
  status: "passed" | "failed";
  measuredRpoHours: number;
  measuredRtoHours: number;
  databaseIntegrity: boolean;
  objectIntegrity: boolean;
  evidencePath: string;
}

export interface BenchmarkDecision {
  id: string;
  approved: boolean;
  owner?: string;
  rationale?: string;
  approvedThreshold?: number | string | boolean | null;
  decidedAt?: string;
}

export interface ReportEnvironmentManifest {
  sourceCommit?: string;
  baseline: {
    certificationEligible: boolean;
  };
}

export interface BenchmarkReportInput {
  sourceCommit: string;
  fixtureManifest: ReportFixtureManifest;
  workloadManifest: ReportWorkloadManifest;
  targetComparison: TargetComparison;
  recovery: RecoveryEvidence | null;
  decisions: readonly BenchmarkDecision[];
  environment?: ReportEnvironmentManifest | null;
  artifactsConsistent?: boolean;
  queryPlansVerified?: boolean;
  failureInjectionVerified?: boolean;
  artifactHashes?: Record<string, string>;
  rawArtifacts: readonly string[];
}

export interface BenchmarkReport {
  formatVersion: 1;
  sourceCommit: string;
  generatedAt: string;
  status: "passed" | "blocked";
  tenMReady: boolean;
  blockerCount: number;
  blockers: string[];
  fixtureManifest: ReportFixtureManifest;
  workloadManifest: ReportWorkloadManifest;
  targetComparison: TargetComparison;
  recovery: RecoveryEvidence | null;
  decisions: readonly BenchmarkDecision[];
  environment: ReportEnvironmentManifest | null;
  artifactsConsistent: boolean;
  queryPlansVerified: boolean;
  failureInjectionVerified: boolean;
  artifactHashes: Record<string, string>;
  rawArtifacts: readonly string[];
}

export function buildBenchmarkReport(
  input: BenchmarkReportInput,
  now = new Date(),
): BenchmarkReport {
  const blockers = new Set<string>();
  if (input.fixtureManifest.logicalCharacters !== 10_000_000) {
    blockers.add("fixture-is-not-10m");
  }
  if (input.fixtureManifest.chapterCount < 3_000 || input.fixtureManifest.chapterCount > 4_000) {
    blockers.add("fixture-chapter-count-out-of-range");
  }
  if (input.fixtureManifest.volumeCount < 30 || input.fixtureManifest.volumeCount > 40) {
    blockers.add("fixture-volume-count-out-of-range");
  }
  if (
    !input.fixtureManifest.branchTopology ||
    input.fixtureManifest.branchTopology.parallelBranchCount + 1 !==
      input.fixtureManifest.branchCount ||
    input.fixtureManifest.branchTopology.branches.length !==
      input.fixtureManifest.branchTopology.parallelBranchCount
  ) {
    blockers.add("fixture-branch-topology-incomplete");
  }
  const versionNodeTypes = input.fixtureManifest.versionNodeTypes;
  if (
    !versionNodeTypes ||
    ![
      "chapter_version",
      "outline_version",
      "entity_version",
      "canon_commit",
      "change_apply",
      "branch_merge",
      "rollback",
    ].every((nodeType) => (versionNodeTypes[nodeType] ?? 0) > 0)
  ) {
    blockers.add("fixture-version-topology-incomplete");
  }
  if (
    (input.fixtureManifest.objectCount ?? 0) === 0 ||
    (input.fixtureManifest.objectChecksums?.length ?? 0) === 0
  ) {
    blockers.add("fixture-object-storage-missing");
  }
  if (!input.recovery) {
    blockers.add("recovery-evidence-missing");
  } else if (
    input.recovery.status !== "passed" ||
    !input.recovery.databaseIntegrity ||
    !input.recovery.objectIntegrity
  ) {
    blockers.add("recovery-evidence-failed");
  }
  if (!input.environment) {
    blockers.add("environment-manifest-missing");
  } else if (!input.environment.baseline.certificationEligible) {
    blockers.add("environment-not-approved-baseline");
  }
  for (const target of input.targetComparison.approved) {
    if (target.status !== "pass") {
      blockers.add(`approved-target-failed:${target.id}`);
    }
  }
  const approvedDecisions = new Set(
    input.decisions.filter(isDecisionApproved).map((decision) => decision.id),
  );
  for (const target of input.targetComparison.decisionRequired) {
    if (!approvedDecisions.has(target.id)) {
      blockers.add(`decision-required:${target.id}`);
    }
  }
  if (input.rawArtifacts.length === 0) {
    blockers.add("raw-artifacts-missing");
  }
  const artifactsConsistent = input.artifactsConsistent === true;
  if (!artifactsConsistent) {
    blockers.add("artifact-provenance-unverified");
  }
  const queryPlansVerified = input.queryPlansVerified === true;
  if (!queryPlansVerified) {
    blockers.add("query-plans-missing");
  }
  const failureInjectionVerified = input.failureInjectionVerified === true;
  if (!failureInjectionVerified) {
    blockers.add("failure-injection-evidence-missing");
  }
  const artifactHashes = input.artifactHashes ?? {};
  if (
    input.rawArtifacts.length === 0 ||
    input.rawArtifacts.some((artifact) => !/^[a-f0-9]{64}$/u.test(artifactHashes[artifact] ?? ""))
  ) {
    blockers.add("raw-artifact-hashes-missing");
  }

  const blockerList = [...blockers].sort();
  const status = blockerList.length === 0 ? "passed" : "blocked";
  return {
    formatVersion: 1,
    sourceCommit: input.sourceCommit,
    generatedAt: now.toISOString(),
    status,
    tenMReady: status === "passed",
    blockerCount: blockerList.length,
    blockers: blockerList,
    fixtureManifest: input.fixtureManifest,
    workloadManifest: input.workloadManifest,
    targetComparison: input.targetComparison,
    recovery: input.recovery,
    decisions: input.decisions,
    environment: input.environment ?? null,
    artifactsConsistent,
    queryPlansVerified,
    failureInjectionVerified,
    artifactHashes,
    rawArtifacts: input.rawArtifacts,
  };
}

function isDecisionApproved(decision: BenchmarkDecision): boolean {
  return (
    decision.approved &&
    Boolean(decision.owner?.trim()) &&
    Boolean(decision.rationale?.trim()) &&
    decision.approvedThreshold !== undefined &&
    decision.approvedThreshold !== null &&
    isValidDecisionThreshold(decision.id, decision.approvedThreshold) &&
    Boolean(decision.decidedAt)
  );
}

function isValidDecisionThreshold(id: string, threshold: number | string | boolean): boolean {
  switch (id) {
    case "p99-latency":
    case "large-version-compare":
      return typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0;
    case "api-concurrency":
    case "branch-count":
      return Number.isInteger(threshold) && Number(threshold) > 0;
    case "error-rate":
      return (
        typeof threshold === "number" &&
        Number.isFinite(threshold) &&
        threshold >= 0 &&
        threshold <= 1
      );
    case "storage-headroom":
      return typeof threshold === "number" && Number.isFinite(threshold) && threshold >= 0;
    case "backup-disk-envelope":
      return typeof threshold === "boolean";
    case "restore-dataset-tier":
      return typeof threshold === "string" && threshold.trim().length > 0;
    default:
      return false;
  }
}
