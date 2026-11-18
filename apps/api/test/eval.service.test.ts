import { vi, describe, expect, it } from "vitest";

import { createContinuityPlan, generateContinuityFixture } from "@novel-brain/continuity-benchmark";
import {
  createApprovedQualityBenchmarkDataset,
  createReleaseQualityRubric,
  type QualityBenchmarkCandidate,
  type QualityMetricScore,
} from "@novel-brain/quality-benchmark";

import type { EvalRepository } from "../src/eval/eval.repository";
import { EvalService } from "../src/eval/eval.service";

describe("EvalService", () => {
  it("executes the approved benchmark before persisting a run", async () => {
    const dataset = createApprovedQualityBenchmarkDataset();
    const rubric = createReleaseQualityRubric();
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({ seed: 20261118, tier: "full" }),
      sourceCommit: "38a85cb3f45bc9d1a6f8bcf66f5b5d50c16132ca",
    });
    const repository = {
      reportByRunKey: vi.fn().mockResolvedValue(undefined),
      saveRun: vi.fn().mockResolvedValue(undefined),
      saveGate: vi.fn().mockResolvedValue(undefined),
    };
    const service = new EvalService(repository as unknown as EvalRepository);
    const candidate: QualityBenchmarkCandidate = {
      schemaVersion: 1,
      candidateId: "candidate-1",
      datasetSha256: dataset.manifest.datasetSha256,
      rubricVersion: rubric.rubricVersion,
      provenance: {
        codeCommit: "abc1234",
        model: "deepseek-chat",
        promptVersion: "prompt-v1",
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

    const report = await service.run("user-1", candidate);

    expect(report.status).toBe("passed");
    expect(repository.saveRun).toHaveBeenCalledOnce();
    expect(repository.saveRun.mock.calls[0]?.[0].report).toBe(report);
  });
});

function createHumanScores(dataset: ReturnType<typeof createApprovedQualityBenchmarkDataset>) {
  const samples = [...dataset.chapterSamples, ...dataset.adversarialCases];
  return samples.flatMap((sample): QualityMetricScore[] => {
    const evidenceQuote = sample.text.slice(0, Math.min(16, sample.text.length));
    return [
      humanScore(sample.id, "outline_adherence", "reviewer-a", 0.95, evidenceQuote),
      humanScore(sample.id, "outline_adherence", "reviewer-b", 0.95, evidenceQuote),
      humanScore(sample.id, "hook_prose_score", "reviewer-a", 4.5, evidenceQuote),
      humanScore(sample.id, "hook_prose_score", "reviewer-b", 4.5, evidenceQuote),
    ];
  });
}

function humanScore(
  sampleId: string,
  dimension: QualityMetricScore["dimension"],
  scorerId: string,
  value: number,
  evidenceQuote: string,
): QualityMetricScore {
  return {
    sampleId,
    dimension,
    scorerType: "human_blind",
    scorerId,
    value,
    confidence: 0.9,
    evidenceQuote,
  };
}
