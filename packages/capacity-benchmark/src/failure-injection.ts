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
  observedAt: string;
  message?: string;
}

export interface FailureInjectionEvidence {
  status: "passed" | "failed";
  runId: string;
  sourceCommit: string;
  scenarios: FailureInjectionScenarioResult[];
}

export function validateFailureInjectionEvidence(
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
      scenario.observedAt.trim().length > 0
    );
  });
}
