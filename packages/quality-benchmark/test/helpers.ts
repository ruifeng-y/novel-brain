import { createApprovedQualityBenchmarkDataset } from "../src/dataset";
import type { QualityBenchmarkRun, QualityMetricScore } from "../src/evaluator";
import { createReleaseQualityRubric } from "../src/rubric";

export const qualityDataset = createApprovedQualityBenchmarkDataset();
export const qualityRubric = createReleaseQualityRubric();

export function createQualityRun(input: {
  runId: string;
  promptVersion?: string;
  contextCompilerVersion?: string;
  agentContractVersion?: string;
  p0Count?: number;
  outline?: number;
  hookProse?: number;
  conflictCount?: number;
}): QualityBenchmarkRun {
  const samples = [...qualityDataset.chapterSamples, ...qualityDataset.adversarialCases];
  const p0Count = input.p0Count ?? 0;
  const outline = input.outline ?? 0.95;
  const hookProse = input.hookProse ?? 4.5;
  const conflictCount = input.conflictCount ?? 0;
  const scores: QualityMetricScore[] = samples.flatMap((sample, index) => {
    const evidenceQuote = sample.text.slice(0, Math.min(16, sample.text.length));
    return [
      score(
        sample.id,
        "p0_fact_loss",
        "deterministic",
        "deterministic-gate",
        index < p0Count ? 1 : 0,
        evidenceQuote,
      ),
      score(
        sample.id,
        "knowledge_boundary_violation",
        "deterministic",
        "deterministic-gate",
        0,
        evidenceQuote,
      ),
      score(
        sample.id,
        "continuity_conflicts_per_50k",
        "deterministic",
        "deterministic-gate",
        conflictCount,
        evidenceQuote,
      ),
      score(sample.id, "outline_adherence", "human_blind", "reviewer-a", outline, evidenceQuote),
      score(sample.id, "outline_adherence", "human_blind", "reviewer-b", outline, evidenceQuote),
      score(sample.id, "hook_prose_score", "human_blind", "reviewer-a", hookProse, evidenceQuote),
      score(sample.id, "hook_prose_score", "human_blind", "reviewer-b", hookProse, evidenceQuote),
    ];
  });
  return {
    schemaVersion: 1,
    runId: input.runId,
    datasetSha256: qualityDataset.manifest.datasetSha256,
    rubricVersion: qualityRubric.rubricVersion,
    provenance: {
      codeCommit: "abc1234",
      model: "deepseek-chat",
      promptVersion: input.promptVersion ?? "prompt-v1",
      contextCompilerVersion: input.contextCompilerVersion ?? "context-v1",
      agentContractVersion: input.agentContractVersion ?? "agent-v1",
    },
    scores,
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

function score(
  sampleId: string,
  dimension: QualityMetricScore["dimension"],
  scorerType: QualityMetricScore["scorerType"],
  scorerId: string,
  value: number,
  evidenceQuote: string,
): QualityMetricScore {
  return {
    sampleId,
    dimension,
    scorerType,
    scorerId,
    value,
    evidenceQuote,
    confidence: 0.9,
  };
}
