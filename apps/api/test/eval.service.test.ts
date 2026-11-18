import { vi, describe, expect, it } from "vitest";

import {
  createContinuityPlan,
  generateContinuityFixture,
  sha256Json,
} from "@novel-brain/continuity-benchmark";
import {
  APPROVED_QUALITY_RUBRIC_SHA256,
  createApprovedQualityBenchmarkDataset,
  type QualityBenchmarkCandidate,
  type QualityBenchmarkReport,
  type QualityMetricScore,
} from "@novel-brain/quality-benchmark";

import type { EvalRepository } from "../src/eval/eval.repository";
import { EvalService } from "../src/eval/eval.service";

const reviewPolicy = {
  interRaterVarianceThreshold: 0.1,
  owner: "release-owner",
  rationale: "trusted service-boundary policy for contract test",
  decidedAt: "2026-11-18T00:00:00.000Z",
} as const;

describe("EvalService", () => {
  it("executes the approved benchmark before persisting a run", async () => {
    const dataset = createApprovedQualityBenchmarkDataset();
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
      sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
    });
    const repository = {
      reportByRunKey: vi.fn().mockResolvedValue(undefined),
      saveRun: vi
        .fn()
        .mockImplementation(async (input: { report: QualityBenchmarkReport }) => input.report),
      saveGate: vi.fn().mockResolvedValue(undefined),
    };
    const service = new EvalService(repository as unknown as EvalRepository);
    const candidate = createCandidate(dataset, fixture, "prompt-v1");

    const report = await service.run("user-1", candidate);

    expect(report.status).toBe("blocked");
    expect(report.releaseGate.blockers).toContain("decision-required:interRaterVarianceThreshold");
    expect(repository.saveRun).toHaveBeenCalledOnce();
    expect(repository.saveRun.mock.calls[0]?.[0].report).toBe(report);
  });

  it("binds the persisted run key to the candidate provenance", async () => {
    const dataset = createApprovedQualityBenchmarkDataset();
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
      sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
    });
    const repository = {
      reportByRunKey: vi.fn().mockResolvedValue(undefined),
      saveRun: vi
        .fn()
        .mockImplementation(async (input: { report: QualityBenchmarkReport }) => input.report),
      saveGate: vi.fn().mockResolvedValue(undefined),
    };
    const service = new EvalService(repository as unknown as EvalRepository);

    await service.run("user-1", createCandidate(dataset, fixture, "prompt-v1"));
    await service.run("user-1", createCandidate(dataset, fixture, "prompt-v2"));

    const lookupKeys = repository.reportByRunKey.mock.calls.map((call) => call[1]);
    expect(lookupKeys).toHaveLength(2);
    expect(lookupKeys[0]).not.toBe("candidate-1");
    expect(lookupKeys[0]).not.toBe(lookupKeys[1]);
    expect(repository.saveRun.mock.calls[0]?.[0].run.runId).toBe(lookupKeys[0]);
    expect(repository.saveRun.mock.calls[1]?.[0].run.runId).toBe(lookupKeys[1]);
  });

  it("uses a review policy supplied outside the candidate artifact", async () => {
    const dataset = createApprovedQualityBenchmarkDataset();
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
      sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
    });
    const repository = {
      reportByRunKey: vi.fn().mockResolvedValue(undefined),
      saveRun: vi
        .fn()
        .mockImplementation(async (input: { report: QualityBenchmarkReport }) => input.report),
      saveGate: vi.fn().mockResolvedValue(undefined),
    };
    const service = new EvalService(repository as unknown as EvalRepository);
    const candidate = createCandidate(dataset, fixture, "prompt-v1");

    const blocked = await service.run("user-1", candidate);
    const report = await service.run("user-1", candidate, reviewPolicy);

    expect(blocked.status).toBe("blocked");
    expect(report.status).toBe("passed");
    expect(repository.reportByRunKey.mock.calls[0]?.[1]).not.toBe(
      repository.reportByRunKey.mock.calls[1]?.[1],
    );
  });
});

function createCandidate(
  dataset: ReturnType<typeof createApprovedQualityBenchmarkDataset>,
  fixture: ReturnType<typeof generateContinuityFixture>,
  promptVersion: string,
): QualityBenchmarkCandidate {
  return {
    schemaVersion: 1,
    candidateId: "candidate-1",
    datasetSha256: dataset.manifest.datasetSha256,
    rubricVersion: dataset.manifest.rubricVersion,
    provenance: {
      codeCommit: "abc1234",
      model: "deepseek-chat",
      promptVersion,
      contextCompilerVersion: "context-v1",
      agentContractVersion: "agent-v1",
    },
    continuityFindings: fixture.defects.map((defect) => ({
      family: defect.family,
      severity: defect.severity,
      chapterNumber: defect.chapterNumber,
      branchId: defect.branchId,
      entityIds: defect.entityIds,
      sourceFactId: defect.sourceFactId,
      versionNodeId: defect.versionNodeId,
      evidence: defect.evidence,
    })),
    humanScores: createHumanScores(dataset),
    decisions: [
      {
        id: "interRaterVarianceThreshold",
        approved: true,
        owner: "release-owner",
        rationale: "approved test variance floor",
        approvedValue: 0.1,
        decidedAt: "2026-11-18T00:00:00.000Z",
      },
    ],
  };
}

function createHumanScores(dataset: ReturnType<typeof createApprovedQualityBenchmarkDataset>) {
  const samples = [...dataset.chapterSamples, ...dataset.adversarialCases];
  const blindPacketSha256 = sha256Json({
    datasetSha256: dataset.manifest.datasetSha256,
    rubricSha256: APPROVED_QUALITY_RUBRIC_SHA256,
  });
  return samples.flatMap((sample): QualityMetricScore[] => {
    const evidenceQuote = sample.text.slice(0, Math.min(16, sample.text.length));
    return [
      humanScore(
        sample.id,
        "outline_adherence",
        "reviewer-a",
        0.95,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
      humanScore(
        sample.id,
        "outline_adherence",
        "reviewer-b",
        0.95,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
      humanScore(
        sample.id,
        "hook_prose_score",
        "reviewer-a",
        4.5,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
      humanScore(
        sample.id,
        "hook_prose_score",
        "reviewer-b",
        4.5,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
    ];
  });
}

function humanScore(
  sampleId: string,
  dimension: QualityMetricScore["dimension"],
  scorerId: string,
  value: number,
  evidenceQuote: string,
  evidenceQuotes: readonly string[],
  blindPacketSha256: string,
): QualityMetricScore {
  return {
    sampleId,
    dimension,
    scorerType: "human_blind",
    scorerId,
    value,
    confidence: 0.9,
    evidenceQuote,
    evidenceQuotes,
    blindPacketSha256,
    reviewerAttestationId: `attestation:${scorerId}`,
    reviewedAt: "2026-11-18T00:00:00.000Z",
  };
}
