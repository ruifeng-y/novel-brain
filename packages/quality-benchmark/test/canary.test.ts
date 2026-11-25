import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@novel-brain/continuity-benchmark";

import {
  createCanaryDecision,
  createRollbackDecision,
  type ProviderCanaryPolicy,
  type ReleaseVersionPin,
} from "../src/canary";

const PIN: ReleaseVersionPin = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  promptVersion: "m1-writing-prompts-v1",
  promptHash: "4e0ad7d7ce883b32a83be12ea7d7593bfeeafc4374e88c22404ed056f70af1cd",
  smokePromptHash: "d".repeat(64),
  contextCompilerVersion: "m1-context-v1",
  agentContractVersion: "agent-m3-06b-v1",
  configHash: "a".repeat(64),
};

const REGRESSION = {
  schemaVersion: 1 as const,
  rolloutAllowed: true,
  blockers: [],
  changedProvenance: ["promptVersion"] as const,
  candidateProvenance: {
    codeCommit: "abc1234",
    model: "deepseek-chat",
    promptVersion: "m1-writing-prompts-v1",
    contextCompilerVersion: "m1-context-v1",
    agentContractVersion: "agent-m3-06b-v1",
    configHash: "a".repeat(64),
  },
  p0: { baseline: 0, candidate: 0, regressed: false },
  baselineSha256: "b".repeat(64),
  candidateSha256: "c".repeat(64),
};

const SMOKE = {
  schemaVersion: 1 as const,
  runId: "smoke-run-1",
  status: "succeeded" as const,
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  requestedModel: "deepseek-chat",
  responseModel: "deepseek-flash",
  promptVersion: "m1-writing-prompts-v1",
  contextCompilerVersion: "m1-context-v1",
  agentContractVersion: "agent-m3-06b-v1",
  configHash: "a".repeat(64),
  promptHash: "d".repeat(64),
  startedAt: "2026-11-18T00:00:00.000Z",
  finishedAt: "2026-11-18T00:00:01.000Z",
  latencyMs: 1_000,
  timeoutMs: 15_000,
  costCny: 0.001,
  attempts: 1,
  networkCalls: 1,
  providerRequestId: "provider-request-1",
};

function canaryPolicy(
  releaseVersion: string,
  overrides: Partial<ProviderCanaryPolicy> = {},
): ProviderCanaryPolicy {
  const policy = {
    schemaVersion: 1,
    policyVersion: "provider-canary-v1",
    channelKey: "internal-release",
    releaseVersion,
    cohortId: "internal-reviewers",
    subjectIds: ["subject-a"],
    maxCostCny: 0.01,
    maxLatencyMs: 10_000,
    maxAttempts: 2,
    timeoutMs: 15_000,
    pin: PIN,
  } satisfies ProviderCanaryPolicy;
  return { ...policy, ...overrides };
}

describe("provider canary release decision", () => {
  it("approves an allowed DeepSeek response alias with model identity audit evidence", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-25.1"),
      smoke: {
        ...SMOKE,
        requestedModel: "deepseek-chat",
        responseModel: "deepseek-flash",
      },
      regression: REGRESSION,
      createdAt: "2026-11-25T00:01:00.000Z",
    });

    expect(decision.status).toBe("approved");
    expect(decision.blockers).toEqual([]);
    expect(decision.modelIdentity).toEqual({
      policyModel: "deepseek-chat",
      requestedModel: "deepseek-chat",
      responseModel: "deepseek-flash",
      resolution: "alias",
      ruleId: "deepseek-chat-flash-alias",
      approved: true,
    });
  });

  it("blocks an unapproved DeepSeek response model without silently accepting it", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-25.2"),
      smoke: {
        ...SMOKE,
        requestedModel: "deepseek-chat",
        responseModel: "deepseek-unapproved",
      },
      regression: REGRESSION,
      createdAt: "2026-11-25T00:02:00.000Z",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain("smoke-response-model-unapproved");
    expect(decision.modelIdentity).toEqual({
      policyModel: "deepseek-chat",
      requestedModel: "deepseek-chat",
      responseModel: "deepseek-unapproved",
      resolution: "unapproved",
      ruleId: null,
      approved: false,
    });
  });

  it("strips fields outside the sanitized smoke evidence contract", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-25.3"),
      smoke: {
        ...SMOKE,
        apiKey: "sk-must-not-persist",
        prompt: "private prompt",
        manuscript: "private manuscript",
      },
      regression: REGRESSION,
      createdAt: "2026-11-25T00:03:00.000Z",
    });

    expect(decision.status).toBe("approved");
    expect(decision.evidence.smoke).toEqual(SMOKE);
    expect(decision.smokeSha256).toBe(sha256CanonicalJson(SMOKE));
    expect(JSON.stringify(decision)).not.toContain("sk-must-not-persist");
    expect(JSON.stringify(decision)).not.toContain("private prompt");
    expect(JSON.stringify(decision)).not.toContain("private manuscript");
  });

  it("records invalid smoke evidence explicitly without retaining untrusted fields", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-25.4"),
      smoke: {
        ...SMOKE,
        latencyMs: -1,
        apiKey: "sk-invalid-must-not-persist",
        prompt: "invalid private prompt",
      },
      regression: REGRESSION,
      createdAt: "2026-11-25T00:04:00.000Z",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain("smoke-evidence-invalid");
    expect(decision.evidence.smoke).toMatchObject({
      schemaVersion: 1,
      status: "invalid",
      failureReason: "PROVIDER_SMOKE_EVIDENCE_INVALID",
    });
    expect(JSON.stringify(decision)).not.toContain("sk-invalid-must-not-persist");
    expect(JSON.stringify(decision)).not.toContain("invalid private prompt");
  });

  it("approves a deterministic internal cohort with passing smoke and quality evidence", () => {
    const input = {
      policy: canaryPolicy("2026-11-18.1", {
        subjectIds: ["subject-b", "subject-a"],
      }),
      smoke: SMOKE,
      regression: REGRESSION,
      createdAt: "2026-11-18T00:01:00.000Z",
    };

    const decision = createCanaryDecision(input);
    const reordered = createCanaryDecision({
      ...input,
      policy: {
        ...input.policy,
        subjectIds: ["subject-a", "subject-b"],
      },
    });

    expect(decision.status).toBe("approved");
    expect(decision.blockers).toEqual([]);
    expect(decision.cohort.subjectIds).toEqual(["subject-a", "subject-b"]);
    expect(decision.cohort.sha256).toBe(reordered.cohort.sha256);
    expect(decision.smokeSha256).toBe(sha256CanonicalJson(SMOKE));
    expect(decision.regressionSha256).toBe(sha256CanonicalJson(REGRESSION));
    expect(decision.evidence.policy).toEqual(input.policy);
    expect(decision.modelIdentity).toEqual({
      policyModel: "deepseek-chat",
      requestedModel: "deepseek-chat",
      responseModel: "deepseek-flash",
      resolution: "alias",
      ruleId: "deepseek-chat-flash-alias",
      approved: true,
    });
    expect(decision.limits).toEqual({
      maxCostCny: 0.01,
      maxLatencyMs: 10_000,
      maxAttempts: 2,
      timeoutMs: 15_000,
    });
  });

  it("blocks mismatched versions and bounded execution violations", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-18.2", {
        maxCostCny: 0.0001,
        maxLatencyMs: 500,
        maxAttempts: 1,
        timeoutMs: 1_000,
        pin: { ...PIN, model: "deepseek-reasoner" },
      }),
      smoke: {
        ...SMOKE,
        attempts: 2,
        costCny: 0.001,
        latencyMs: 1_000,
        timeoutMs: 15_000,
        networkCalls: 0,
      },
      regression: {
        ...REGRESSION,
        rolloutAllowed: false,
        blockers: ["candidate-release-gate-failed"],
      },
      createdAt: "2026-11-18T00:02:00.000Z",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        "smoke-model-mismatch",
        "smoke-network-call-missing",
        "smoke-cost-limit-exceeded",
        "smoke-latency-limit-exceeded",
        "smoke-attempt-limit-exceeded",
        "smoke-timeout-limit-exceeded",
        "quality-regression-blocked",
      ]),
    );
    expect(decision.modelIdentity).toEqual({
      policyModel: "deepseek-reasoner",
      requestedModel: "deepseek-chat",
      responseModel: "deepseek-flash",
      resolution: "unapproved",
      ruleId: null,
      approved: false,
    });
  });

  it("rolls back by creating a new decision with the previous approved pin", () => {
    const previous = {
      id: "decision-approved",
      status: "approved" as const,
      channelKey: "internal-release",
      releaseVersion: "2026-11-17.1",
      pin: { ...PIN, promptVersion: "prompt-v2" },
      limits: {
        maxCostCny: 0.01,
        maxLatencyMs: 10_000,
        maxAttempts: 2,
        timeoutMs: 15_000,
      },
      cohort: {
        id: "internal-reviewers",
        subjectIds: ["subject-a"],
        sha256: "6".repeat(64),
      },
    };
    const current = {
      id: "decision-current",
      status: "blocked" as const,
      channelKey: "internal-release",
      releaseVersion: "2026-11-18.1",
      pin: PIN,
      limits: {
        maxCostCny: 0.01,
        maxLatencyMs: 10_000,
        maxAttempts: 2,
        timeoutMs: 15_000,
      },
      cohort: {
        id: "internal-reviewers",
        subjectIds: ["subject-a"],
        sha256: "6".repeat(64),
      },
    };

    const rollback = createRollbackDecision({
      current,
      previousApproved: previous,
      actorId: "release-owner",
      reason: "p0 regression",
      createdAt: "2026-11-18T00:03:00.000Z",
    });

    expect(rollback.action).toBe("rollback");
    expect(rollback.status).toBe("rolled_back");
    expect(rollback.pin).toEqual(previous.pin);
    expect(rollback.limits).toEqual(previous.limits);
    expect(rollback.previousDecisionId).toBe(current.id);
    expect(rollback.rollbackTargetDecisionId).toBe(previous.id);
    expect(rollback.historicalMetadataMutated).toBe(false);
    expect(current.pin).toEqual(PIN);
  });

  it("rejects prompt bundle hashes that are not registered", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-18.3", {
        pin: { ...PIN, promptHash: "0".repeat(64) },
      }),
      smoke: SMOKE,
      regression: REGRESSION,
      createdAt: "2026-11-18T00:04:00.000Z",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain("canary-policy-invalid");
  });

  it("blocks quality evidence produced under a different release config", () => {
    const decision = createCanaryDecision({
      policy: canaryPolicy("2026-11-18.4"),
      smoke: SMOKE,
      regression: {
        ...REGRESSION,
        candidateProvenance: {
          ...REGRESSION.candidateProvenance,
          configHash: "9".repeat(64),
        },
      },
      createdAt: "2026-11-18T00:05:00.000Z",
    });

    expect(decision.blockers).toContain("quality-provenance-mismatch");
  });
});
