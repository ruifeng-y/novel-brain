export const REQUIRED_FAILURE_SCENARIOS = [
  "worker_termination_before_checkpoint",
  "worker_termination_after_checkpoint",
  "api_restart_during_sse",
  "redis_outage",
  "postgres_restart",
  "slow_query_connection_exhaustion",
  "provider_timeout",
  "provider_rate_limit_429",
  "disk_pressure",
  "interrupted_import",
  "interrupted_index_build",
  "missing_object",
  "corrupt_object",
  "partial_backup",
  "interrupted_restore",
  "stale_branch_head_compare",
  "stale_branch_head_apply",
  "duplicate_job_events",
  "retry_races",
] as const;

export type RequiredFailureScenario = (typeof REQUIRED_FAILURE_SCENARIOS)[number];

export interface FailureInjectionScenarioResult {
  id: RequiredFailureScenario;
  status: "passed" | "failed";
  evidencePath: string;
  evidenceSha256: string;
  observedAt: string;
  message?: string;
}

export interface FailureInjectionEvidence {
  status: "passed" | "failed";
  runId: string;
  sourceCommit: string;
  scenarios: FailureInjectionScenarioResult[];
}

export function validateFailureInjectionEvidenceShape(
  evidence: FailureInjectionEvidence,
  expected: { runId: string; sourceCommit: string },
): boolean {
  if (
    evidence.status !== "passed" ||
    evidence.runId !== expected.runId ||
    evidence.sourceCommit !== expected.sourceCommit
  ) {
    return false;
  }
  const byId = new Map(evidence.scenarios.map((scenario) => [scenario.id, scenario]));
  if (
    byId.size !== REQUIRED_FAILURE_SCENARIOS.length ||
    evidence.scenarios.length !== REQUIRED_FAILURE_SCENARIOS.length
  ) {
    return false;
  }
  return REQUIRED_FAILURE_SCENARIOS.every((id) => {
    const scenario = byId.get(id);
    return (
      scenario?.status === "passed" &&
      scenario.evidencePath.trim().length > 0 &&
      /^[a-f0-9]{64}$/u.test(scenario.evidenceSha256) &&
      scenario.observedAt.trim().length > 0
    );
  });
}
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function verifyFailureInjectionEvidence(
  evidence: FailureInjectionEvidence,
  expected: { runId: string; sourceCommit: string },
  evidenceRoot: string,
): Promise<boolean> {
  if (!validateFailureInjectionEvidenceShape(evidence, expected)) {
    return false;
  }
  const resolvedRoot = path.resolve(evidenceRoot);
  for (const scenario of evidence.scenarios) {
    const evidencePath = path.resolve(resolvedRoot, scenario.evidencePath);
    if (evidencePath !== resolvedRoot && !evidencePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      return false;
    }
    const bytes = await readFile(evidencePath).catch(() => null);
    if (!bytes) {
      return false;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== scenario.evidenceSha256) {
      return false;
    }
    let detail: {
      runId?: unknown;
      sourceCommit?: unknown;
      scenario?: unknown;
      status?: unknown;
    };
    try {
      detail = JSON.parse(bytes.toString("utf8")) as typeof detail;
    } catch {
      return false;
    }
    if (
      detail.runId !== expected.runId ||
      detail.sourceCommit !== expected.sourceCommit ||
      detail.scenario !== scenario.id ||
      detail.status !== "passed"
    ) {
      return false;
    }
  }
  return true;
}
