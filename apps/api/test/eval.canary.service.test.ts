import { describe, expect, it, vi } from "vitest";

import type {
  ProviderCanaryDecision,
  ProviderCanaryPolicy,
  ProviderRollbackDecision,
  QualityRegressionReport,
} from "@novel-brain/quality-benchmark";

import type { EvalRepository } from "../src/eval/eval.repository";
import { EvalService } from "../src/eval/eval.service";

const PIN = {
  provider: "deepseek" as const,
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  promptVersion: "m1-writing-prompts-v1",
  promptHash: "4e0ad7d7ce883b32a83be12ea7d7593bfeeafc4374e88c22404ed056f70af1cd",
  smokePromptHash: "d".repeat(64),
  contextCompilerVersion: "m1-context-v1",
  agentContractVersion: "agent-m3-06b-v1",
  configHash: "a".repeat(64),
};

const POLICY: ProviderCanaryPolicy = {
  schemaVersion: 1,
  policyVersion: "provider-canary-v1",
  channelKey: "internal-release",
  releaseVersion: "2026-11-18.1",
  cohortId: "internal-reviewers",
  subjectIds: ["subject-b", "subject-a"],
  maxCostCny: 0.01,
  maxLatencyMs: 10_000,
  maxAttempts: 2,
  timeoutMs: 15_000,
  pin: PIN,
};

const REGRESSION: QualityRegressionReport = {
  schemaVersion: 1,
  rolloutAllowed: true,
  blockers: [],
  changedProvenance: ["promptVersion"],
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

describe("EvalService release canary", () => {
  it("records an approved deterministic canary decision", async () => {
    const repository = {
      saveReleaseDecision: vi.fn(async (input: { decision: ProviderCanaryDecision }) => ({
        id: "decision-1",
        decision: input.decision,
      })),
    };
    const service = new EvalService(repository as unknown as EvalRepository);
    vi.spyOn(service, "gate").mockResolvedValue(REGRESSION);

    const stored = await service.canary({
      userId: "user-1",
      policy: POLICY,
      smoke: SMOKE,
      baselineRunKey: "baseline",
      candidateRunKey: "candidate",
      createdAt: "2026-11-18T00:01:00.000Z",
    });

    expect(stored.decision.status).toBe("approved");
    expect(stored.decision.action).toBe("canary");
    expect(repository.saveReleaseDecision).toHaveBeenCalledOnce();
  });

  it("appends a rollback decision using the previous approved pin", async () => {
    const current: ProviderCanaryDecision = {
      schemaVersion: 1,
      action: "canary",
      status: "blocked",
      channelKey: "internal-release",
      releaseVersion: "2026-11-18.1",
      policySha256: "e".repeat(64),
      cohort: {
        id: "internal-reviewers",
        subjectIds: ["subject-a"],
        sha256: "f".repeat(64),
      },
      smokeSha256: "1".repeat(64),
      regressionSha256: "2".repeat(64),
      pin: PIN,
      limits: {
        maxCostCny: 0.01,
        maxLatencyMs: 10_000,
        maxAttempts: 2,
        timeoutMs: 15_000,
      },
      evidence: { policy: POLICY, smoke: SMOKE, quality: REGRESSION },
      blockers: ["quality-regression-blocked"],
      createdAt: "2026-11-18T00:02:00.000Z",
      sha256: "3".repeat(64),
    };
    const previous: ProviderCanaryDecision = {
      ...current,
      status: "approved",
      releaseVersion: "2026-11-17.1",
      pin: { ...PIN, promptVersion: "prompt-v2" },
      blockers: [],
      sha256: "4".repeat(64),
    };
    const repository = {
      rollbackRelease: vi.fn(async () => ({
        id: "decision-rollback",
        decision: {
          schemaVersion: 1,
          action: "rollback",
          status: "rolled_back",
          channelKey: current.channelKey,
          releaseVersion: current.releaseVersion,
          previousDecisionId: "decision-current",
          rollbackTargetDecisionId: "decision-previous",
          pin: previous.pin,
          limits: previous.limits,
          cohort: previous.cohort,
          actorId: "release-owner",
          reason: "p0 regression",
          historicalMetadataMutated: false,
          createdAt: "2026-11-18T00:03:00.000Z",
          sha256: "5".repeat(64),
        } satisfies ProviderRollbackDecision,
      })),
    };
    const service = new EvalService(repository as unknown as EvalRepository);

    const stored = await service.rollback({
      userId: "user-1",
      currentDecisionId: "decision-current",
      actorId: "release-owner",
      reason: "p0 regression",
      createdAt: "2026-11-18T00:03:00.000Z",
    });

    expect(stored.decision).toMatchObject({
      action: "rollback",
      status: "rolled_back",
      pin: previous.pin,
      previousDecisionId: "decision-current",
      rollbackTargetDecisionId: "decision-previous",
      historicalMetadataMutated: false,
    });
  });
});
