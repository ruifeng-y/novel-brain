import type { CheckpointOutputRef } from "@novel-brain/contracts";

export const RECOVERY_AUTOMATIC_MAX_ATTEMPTS = 3;
export const RECOVERY_BACKOFF_BASE_MS = 1_000;
export const RECOVERY_BACKOFF_MAX_MS = 30_000;

export type RecoveryFailureClass =
  "provider" | "timeout" | "rate_limit" | "schema" | "policy" | "budget" | "cancelled" | "unknown";

export type RecoveryStepStatus =
  "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface RecoveryStepState {
  stepKey: string;
  status: RecoveryStepStatus;
}

export interface RecoveryStepResolution<T extends string> {
  step: T;
  completedSteps: T[];
  reason: "no_progress" | "failed_step" | "restart_inflight" | "all_succeeded";
}

export type RecoveryDecision =
  | { action: "automatic_retry"; delayMs: number; terminal: false }
  | { action: "manual_recovery"; delayMs: null; terminal: true };

export function resolveRecoveryStep<T extends string>(
  catalog: readonly T[],
  steps: readonly RecoveryStepState[],
): RecoveryStepResolution<T> {
  const first = catalog[0];
  if (!first) {
    throw new Error("Recovery step catalog must not be empty");
  }
  const byStep = new Map(steps.map((step) => [step.stepKey, step.status]));
  const completedSteps: T[] = [];
  for (const step of catalog) {
    const status = byStep.get(step);
    if (status === "succeeded" || status === "skipped") {
      completedSteps.push(step);
      continue;
    }
    return {
      step,
      completedSteps,
      reason:
        status === "failed"
          ? "failed_step"
          : status === undefined
            ? "no_progress"
            : "restart_inflight",
    };
  }
  return {
    step: catalog[catalog.length - 1] ?? first,
    completedSteps,
    reason: "all_succeeded",
  };
}

export function decideStepRecovery(input: {
  failureClass: RecoveryFailureClass;
  attempt: number;
  maxAutomaticAttempts?: number;
}): RecoveryDecision {
  const maxAttempts = input.maxAutomaticAttempts ?? RECOVERY_AUTOMATIC_MAX_ATTEMPTS;
  const retryable =
    input.failureClass === "provider" ||
    input.failureClass === "timeout" ||
    input.failureClass === "rate_limit";
  if (!retryable || input.attempt >= maxAttempts) {
    return { action: "manual_recovery", delayMs: null, terminal: true };
  }
  return {
    action: "automatic_retry",
    delayMs: Math.min(
      RECOVERY_BACKOFF_BASE_MS * 2 ** Math.max(0, input.attempt - 1),
      RECOVERY_BACKOFF_MAX_MS,
    ),
    terminal: false,
  };
}

export function outputRefsFromStepOutput(output: Record<string, unknown>): CheckpointOutputRef[] {
  const refs: CheckpointOutputRef[] = [];
  addRef(refs, "context_pack", output.contextPackId);
  addRef(refs, "chapter_version", output.chapterVersionId);
  addRef(refs, "chapter_version", output.sourceVersionId);
  if (Array.isArray(output.proposalIds)) {
    for (const proposalId of output.proposalIds) {
      addRef(refs, "fact_proposal", proposalId);
    }
  }
  addRef(refs, "canon_commit", output.canonCommitId);
  addRef(refs, "artifact", output.artifactId);
  return uniqueRefs(refs);
}

function addRef(
  refs: CheckpointOutputRef[],
  type: CheckpointOutputRef["type"],
  value: unknown,
): void {
  if (typeof value === "string" && value.length > 0) {
    refs.push({ type, id: value });
  }
}

function uniqueRefs(refs: CheckpointOutputRef[]): CheckpointOutputRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
