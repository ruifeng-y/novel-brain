import { sha256CanonicalJson } from "@novel-brain/continuity-benchmark";
import { resolveWritingRelease } from "@novel-brain/ai";
import {
  PROVIDER_CANARY_CHANNEL,
  providerCanaryPolicySchema,
  providerReleaseLimitsSchema,
  type ProviderCanaryPolicy as ProviderCanaryPolicyContract,
  type ProviderReleaseLimits,
  type ProviderReleaseVersionPin,
} from "@novel-brain/contracts";

import type { QualityRegressionReport } from "./regression";

export type ReleaseVersionPin = ProviderReleaseVersionPin;
export type ProviderCanaryPolicy = ProviderCanaryPolicyContract;
export type { ProviderReleaseLimits };

export interface ProviderSmokeEvidence {
  schemaVersion: 1;
  runId: string;
  status: "succeeded" | "failed" | "skipped";
  provider: string;
  baseUrl: string;
  model: string;
  promptVersion: string;
  contextCompilerVersion: string;
  agentContractVersion: string;
  configHash: string;
  promptHash: string;
  startedAt: string;
  finishedAt: string;
  latencyMs: number;
  timeoutMs: number;
  costCny: number;
  attempts: number;
  networkCalls: number;
  providerRequestId?: string;
  failureClass?: string;
  reason?: string;
}

export interface ProviderCanaryDecision {
  schemaVersion: 1;
  action: "canary";
  status: "approved" | "blocked";
  channelKey: string;
  releaseVersion: string;
  policySha256: string;
  cohort: {
    id: string;
    subjectIds: readonly string[];
    sha256: string;
  };
  smokeSha256: string;
  regressionSha256: string;
  pin: ReleaseVersionPin;
  limits: ProviderReleaseLimits;
  evidence: {
    policy: ProviderCanaryPolicy;
    smoke: ProviderSmokeEvidence;
    quality: QualityRegressionReport;
  };
  blockers: readonly string[];
  createdAt: string;
  sha256: string;
}

export interface ReleaseDecisionReference {
  id: string;
  status: "approved" | "blocked" | "rolled_back";
  channelKey: string;
  releaseVersion: string;
  pin: ReleaseVersionPin;
  limits: ProviderReleaseLimits;
  cohort: ProviderCanaryDecision["cohort"];
}

export interface ProviderRollbackDecision {
  schemaVersion: 1;
  action: "rollback";
  status: "rolled_back";
  channelKey: string;
  releaseVersion: string;
  previousDecisionId: string;
  rollbackTargetDecisionId: string;
  pin: ReleaseVersionPin;
  limits: ProviderReleaseLimits;
  cohort: ProviderCanaryDecision["cohort"];
  actorId: string;
  reason: string;
  historicalMetadataMutated: false;
  createdAt: string;
  sha256: string;
}

export function createCanaryDecision(input: {
  policy: ProviderCanaryPolicy;
  smoke: ProviderSmokeEvidence;
  regression: QualityRegressionReport;
  createdAt: string;
}): ProviderCanaryDecision {
  const { policy, smoke, regression, createdAt } = input;
  const blockers = new Set<string>();
  const normalizedSubjectIds = [...policy.subjectIds].map((id) => id.trim()).sort();
  if (
    !providerCanaryPolicySchema.safeParse(policy).success ||
    !isValidPinBaseUrl(policy.pin) ||
    !isRegisteredWritingRelease(policy.pin) ||
    !/^[a-f0-9]{64}$/u.test(policy.pin.configHash) ||
    !/^[a-f0-9]{64}$/u.test(policy.pin.promptHash) ||
    !/^[a-f0-9]{64}$/u.test(policy.pin.smokePromptHash)
  ) {
    blockers.add("canary-policy-invalid");
  }
  const uniqueSubjectIds = [...new Set(normalizedSubjectIds)];
  if (uniqueSubjectIds.length !== normalizedSubjectIds.length) {
    blockers.add("cohort-subject-duplicate");
  }
  if (smoke.status !== "succeeded") {
    blockers.add("smoke-not-succeeded");
  }
  if (smoke.networkCalls < 1) {
    blockers.add("smoke-network-call-missing");
  }
  for (const key of [
    "provider",
    "baseUrl",
    "model",
    "promptVersion",
    "contextCompilerVersion",
    "agentContractVersion",
    "configHash",
  ] as const) {
    if (smoke[key] !== policy.pin[key]) {
      blockers.add(`smoke-${kebabCase(key)}-mismatch`);
    }
  }
  if (smoke.promptHash !== policy.pin.smokePromptHash) {
    blockers.add("smoke-prompt-hash-mismatch");
  }
  if (smoke.costCny > policy.maxCostCny) {
    blockers.add("smoke-cost-limit-exceeded");
  }
  if (smoke.latencyMs > policy.maxLatencyMs) {
    blockers.add("smoke-latency-limit-exceeded");
  }
  if (smoke.attempts > policy.maxAttempts) {
    blockers.add("smoke-attempt-limit-exceeded");
  }
  if (smoke.timeoutMs > policy.timeoutMs) {
    blockers.add("smoke-timeout-limit-exceeded");
  }
  if (
    !Number.isFinite(smoke.latencyMs) ||
    smoke.latencyMs < 0 ||
    !Number.isFinite(smoke.costCny) ||
    smoke.costCny < 0 ||
    !Number.isInteger(smoke.attempts) ||
    smoke.attempts < 1 ||
    !Number.isInteger(smoke.networkCalls) ||
    smoke.networkCalls < 0 ||
    !Number.isFinite(smoke.timeoutMs) ||
    smoke.timeoutMs <= 0
  ) {
    blockers.add("smoke-evidence-invalid");
  }
  if (!regression.rolloutAllowed || regression.blockers.length > 0) {
    blockers.add("quality-regression-blocked");
  }
  if (
    regression.candidateProvenance.model !== policy.pin.model ||
    regression.candidateProvenance.promptVersion !== policy.pin.promptVersion ||
    regression.candidateProvenance.contextCompilerVersion !== policy.pin.contextCompilerVersion ||
    regression.candidateProvenance.agentContractVersion !== policy.pin.agentContractVersion ||
    regression.candidateProvenance.configHash !== policy.pin.configHash
  ) {
    blockers.add("quality-provenance-mismatch");
  }
  const limits = {
    maxCostCny: policy.maxCostCny,
    maxLatencyMs: policy.maxLatencyMs,
    maxAttempts: policy.maxAttempts,
    timeoutMs: policy.timeoutMs,
  };

  const decisionWithoutHash = {
    schemaVersion: 1 as const,
    action: "canary" as const,
    status: blockers.size === 0 ? ("approved" as const) : ("blocked" as const),
    channelKey: policy.channelKey,
    releaseVersion: policy.releaseVersion,
    policySha256: sha256CanonicalJson(policy),
    cohort: {
      id: policy.cohortId,
      subjectIds: uniqueSubjectIds,
      sha256: sha256CanonicalJson({
        cohortId: policy.cohortId,
        subjectIds: uniqueSubjectIds,
      }),
    },
    smokeSha256: sha256CanonicalJson(smoke),
    regressionSha256: sha256CanonicalJson(regression),
    pin: { ...policy.pin },
    limits,
    evidence: {
      policy,
      smoke,
      quality: regression,
    },
    blockers: [...blockers].sort(),
    createdAt,
  };
  return {
    ...decisionWithoutHash,
    sha256: sha256CanonicalJson(decisionWithoutHash),
  };
}

export function createRollbackDecision(input: {
  current: ReleaseDecisionReference;
  previousApproved: ReleaseDecisionReference;
  actorId: string;
  reason: string;
  createdAt: string;
}): ProviderRollbackDecision {
  const { current, previousApproved, actorId, reason, createdAt } = input;
  if (
    (previousApproved.status !== "approved" && previousApproved.status !== "rolled_back") ||
    previousApproved.id === current.id ||
    previousApproved.channelKey !== current.channelKey ||
    current.channelKey !== PROVIDER_CANARY_CHANNEL ||
    !providerReleaseLimitsSchema.safeParse(previousApproved.limits).success ||
    !actorId.trim() ||
    !reason.trim()
  ) {
    throw new Error("ROLLBACK_TARGET_INVALID");
  }
  const decisionWithoutHash = {
    schemaVersion: 1 as const,
    action: "rollback" as const,
    status: "rolled_back" as const,
    channelKey: current.channelKey,
    releaseVersion: current.releaseVersion,
    previousDecisionId: current.id,
    rollbackTargetDecisionId: previousApproved.id,
    pin: { ...previousApproved.pin },
    limits: { ...previousApproved.limits },
    cohort: previousApproved.cohort,
    actorId,
    reason,
    historicalMetadataMutated: false as const,
    createdAt,
  };
  return {
    ...decisionWithoutHash,
    sha256: sha256CanonicalJson(decisionWithoutHash),
  };
}

function kebabCase(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => `-${character.toLowerCase()}`);
}

function isValidPinBaseUrl(pin: ReleaseVersionPin): boolean {
  try {
    const url = new URL(pin.baseUrl);
    if (url.protocol !== "https:") {
      return false;
    }
    return pin.baseUrl === "https://api.deepseek.com";
  } catch {
    return false;
  }
}

function isRegisteredWritingRelease(pin: ReleaseVersionPin): boolean {
  try {
    resolveWritingRelease(pin);
    return true;
  } catch {
    return false;
  }
}
