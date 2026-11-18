import {
  createContinuityPlan,
  generateContinuityFixture,
  sha256CanonicalJson,
} from "@novel-brain/continuity-benchmark";

import { createApprovedQualityBenchmarkDataset } from "../src/dataset";
import type { QualityBenchmarkRun, QualityMetricScore } from "../src/evaluator";
import { executeQualityBenchmarkCandidate } from "../src/execute";
import { createReleaseQualityRubric } from "../src/rubric";

export const qualityDataset = createApprovedQualityBenchmarkDataset();
export const qualityRubric = createReleaseQualityRubric();
export const qualityReviewPolicy = {
  interRaterVarianceThreshold: 0.1,
  owner: "release-owner",
  rationale: "contract-test-only policy",
  decidedAt: "2026-11-18T00:00:00.000Z",
} as const;
const qualityBlindPacketSha256 = sha256CanonicalJson({
  datasetSha256: qualityDataset.manifest.datasetSha256,
  rubricSha256: qualityRubric.sha256,
});
const continuityFixture = generateContinuityFixture({
  plan: createContinuityPlan({
    seed: qualityDataset.manifest.seed,
    tier: qualityDataset.manifest.continuityTier,
  }),
  sourceCommit: qualityDataset.manifest.sourceCommit,
});
const continuityFindings = continuityFixture.defects.map((defect) => ({
  defectId: defect.id,
  family: defect.family,
  severity: defect.severity,
  chapterNumber: defect.chapterNumber,
  branchId: defect.branchId,
  entityIds: defect.entityIds,
  sourceFactId: defect.sourceFactId,
  versionNodeId: defect.versionNodeId,
  evidence: defect.evidence,
}));

export function createQualityRun(input: {
  runId: string;
  promptVersion?: string;
  contextCompilerVersion?: string;
  agentContractVersion?: string;
  configHash?: string;
  p0Count?: number;
  outline?: number;
  hookProse?: number;
}): QualityBenchmarkRun {
  const samples = [...qualityDataset.chapterSamples, ...qualityDataset.adversarialCases];
  const outline = input.outline ?? 0.95;
  const hookProse = input.hookProse ?? 4.5;
  const humanScores: QualityMetricScore[] = samples.flatMap((sample) => {
    const evidenceQuote = sample.text.slice(0, Math.min(16, sample.text.length));
    const evidenceQuotes = sample.requiredBeats;
    return [
      score(
        sample.id,
        "outline_adherence",
        "human_blind",
        "reviewer-a",
        outline,
        evidenceQuote,
        evidenceQuotes,
      ),
      score(
        sample.id,
        "outline_adherence",
        "human_blind",
        "reviewer-b",
        outline,
        evidenceQuote,
        evidenceQuotes,
      ),
      score(
        sample.id,
        "hook_prose_score",
        "human_blind",
        "reviewer-a",
        hookProse,
        evidenceQuote,
        evidenceQuotes,
      ),
      score(
        sample.id,
        "hook_prose_score",
        "human_blind",
        "reviewer-b",
        hookProse,
        evidenceQuote,
        evidenceQuotes,
      ),
    ];
  });
  const missingP0Ids = new Set(
    continuityFindings
      .filter((finding) => finding.severity === "P0")
      .slice(0, input.p0Count ?? 0)
      .map((finding) => finding.defectId),
  );
  return executeQualityBenchmarkCandidate({
    dataset: qualityDataset,
    rubric: qualityRubric,
    candidate: {
      schemaVersion: 1,
      candidateId: input.runId,
      datasetSha256: qualityDataset.manifest.datasetSha256,
      rubricVersion: qualityRubric.rubricVersion,
      provenance: {
        codeCommit: "abc1234",
        model: "deepseek-chat",
        promptVersion: input.promptVersion ?? "prompt-v1",
        contextCompilerVersion: input.contextCompilerVersion ?? "context-v1",
        agentContractVersion: input.agentContractVersion ?? "agent-v1",
        configHash: input.configHash ?? "1".repeat(64),
      },
      continuityFindings: continuityFindings.filter(
        (finding) => !missingP0Ids.has(finding.defectId),
      ),
      humanScores,
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
    },
  });
}

function score(
  sampleId: string,
  dimension: QualityMetricScore["dimension"],
  scorerType: QualityMetricScore["scorerType"],
  scorerId: string,
  value: number,
  evidenceQuote: string,
  evidenceQuotes: readonly string[],
): QualityMetricScore {
  return {
    sampleId,
    dimension,
    scorerType,
    scorerId,
    value,
    evidenceQuote,
    evidenceQuotes,
    confidence: 0.9,
    ...(scorerType === "human_blind"
      ? {
          reviewerAttestationId: `attestation:${scorerId}`,
          reviewedAt: "2026-11-18T00:00:00.000Z",
          blindPacketSha256: qualityBlindPacketSha256,
        }
      : {}),
  };
}
