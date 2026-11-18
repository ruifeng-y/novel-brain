import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "@novel-brain/continuity-benchmark";

import {
  createCanaryDecision,
  createRollbackDecision,
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
  model: "deepseek-chat",
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

describe("provider canary release decision", () => {
  it("approves a deterministic internal cohort with passing smoke and quality evidence", () => {
    const input = {
      policy: {
        schemaVersion: 1 as const,
        policyVersion: "provider-canary-v1" as const,
        channelKey: "internal-release",
        releaseVersion: "2026-11-18.1",
        cohortId: "internal-reviewers",
        subjectIds: ["subject-b", "subject-a"],
        maxCostCny: 0.01,
        maxLatencyMs: 10_000,
        maxAttempts: 2,
        timeoutMs: 15_000,
        pin: PIN,
      },
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
    expect(decision.limits).toEqual({
      maxCostCny: 0.01,
      maxLatencyMs: 10_000,
      maxAttempts: 2,
      timeoutMs: 15_000,
    });
  });

  it("blocks mismatched versions and bounded execution violations", () => {
    const decision = createCanaryDecision({
      policy: {
        schemaVersion: 1,
        policyVersion: "provider-canary-v1",
        channelKey: "internal-release",
        releaseVersion: "2026-11-18.2",
        cohortId: "internal-reviewers",
        subjectIds: ["subject-a"],
        maxCostCny: 0.0001,
        maxLatencyMs: 500,
        maxAttempts: 1,
        timeoutMs: 1_000,
        pin: { ...PIN, model: "deepseek-reasoner" },
      },
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
      policy: {
        schemaVersion: 1,
        policyVersion: "provider-canary-v1",
        channelKey: "internal-release",
        releaseVersion: "2026-11-18.3",
        cohortId: "internal-reviewers",
        subjectIds: ["subject-a"],
        maxCostCny: 0.01,
        maxLatencyMs: 10_000,
        maxAttempts: 2,
        timeoutMs: 15_000,
        pin: { ...PIN, promptHash: "0".repeat(64) },
      },
      smoke: SMOKE,
      regression: REGRESSION,
      createdAt: "2026-11-18T00:04:00.000Z",
    });

    expect(decision.status).toBe("blocked");
    expect(decision.blockers).toContain("canary-policy-invalid");
  });

  it("blocks quality evidence produced under a different release config", () => {
    const decision = createCanaryDecision({
      policy: {
        schemaVersion: 1,
        policyVersion: "provider-canary-v1",
        channelKey: "internal-release",
        releaseVersion: "2026-11-18.4",
        cohortId: "internal-reviewers",
        subjectIds: ["subject-a"],
        maxCostCny: 0.01,
        maxLatencyMs: 10_000,
        maxAttempts: 2,
        timeoutMs: 15_000,
        pin: PIN,
      },
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
