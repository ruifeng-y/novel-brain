import type { ContinuityEvaluation } from "@novel-brain/continuity-benchmark";

import type { QualityAdversarialCase, QualityBenchmarkDataset } from "./dataset";
import type { QualityMetricScore } from "./evaluator";

export function createDeterministicQualityScores(
  dataset: QualityBenchmarkDataset,
  continuityEvaluation: ContinuityEvaluation,
): QualityMetricScore[] {
  const missingDefects = new Map(
    continuityEvaluation.missingFindings.map((defect) => [defect.id, defect]),
  );
  const totalConflicts =
    continuityEvaluation.missingFindings.length + continuityEvaluation.unexpectedFindings.length;
  const samples = [...dataset.chapterSamples, ...dataset.adversarialCases];
  return samples.flatMap((sample, sampleIndex) => {
    const evidenceQuote = sample.text.slice(0, Math.min(16, sample.text.length));
    const defectId = sample.kind === "long_horizon_case" ? adversarialDefectId(sample) : null;
    const missingDefect = defectId ? missingDefects.get(defectId) : undefined;
    return [
      deterministicScore(
        sample.id,
        "p0_fact_loss",
        missingDefect?.severity === "P0" ? 1 : 0,
        evidenceQuote,
      ),
      deterministicScore(
        sample.id,
        "knowledge_boundary_violation",
        missingDefect?.family === "knowledge_boundary" ? 1 : 0,
        evidenceQuote,
      ),
      deterministicScore(
        sample.id,
        "continuity_conflicts_per_50k",
        sampleIndex === 0 ? totalConflicts : 0,
        evidenceQuote,
      ),
    ];
  });
}

function adversarialDefectId(sample: QualityAdversarialCase): string {
  return sample.id.replace(/^long-horizon:/u, "");
}

function deterministicScore(
  sampleId: string,
  dimension: QualityMetricScore["dimension"],
  value: number,
  evidenceQuote: string,
): QualityMetricScore {
  return {
    sampleId,
    dimension,
    scorerType: "deterministic",
    scorerId: "continuity-benchmark",
    value,
    evidenceQuote,
    confidence: 1,
  };
}
