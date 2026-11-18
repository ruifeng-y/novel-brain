import {
  createContinuityPlan,
  evaluateContinuityFindings,
  generateContinuityFixture,
  type ContinuityEvaluation,
  type ContinuityFinding,
} from "@novel-brain/continuity-benchmark";

import type { QualityAdversarialCase, QualityBenchmarkDataset } from "./dataset";
import type {
  QualityBenchmarkDecision,
  QualityBenchmarkRun,
  QualityMetricScore,
} from "./evaluator";
import type { ReleaseQualityRubric } from "./rubric";

export interface QualityBenchmarkCandidate {
  schemaVersion: 1;
  candidateId: string;
  datasetSha256: string;
  rubricVersion: string;
  provenance: QualityBenchmarkRun["provenance"];
  continuityFindings: readonly ContinuityFinding[];
  humanScores: readonly QualityMetricScore[];
  decisions: readonly QualityBenchmarkDecision[];
}

export function executeQualityBenchmarkCandidate(input: {
  dataset: QualityBenchmarkDataset;
  rubric: ReleaseQualityRubric;
  candidate: QualityBenchmarkCandidate;
}): QualityBenchmarkRun & { continuityEvaluation: ContinuityEvaluation } {
  const { dataset, rubric, candidate } = input;
  if (candidate.datasetSha256 !== dataset.manifest.datasetSha256) {
    throw new Error("DATASET_HASH_MISMATCH");
  }
  if (candidate.rubricVersion !== rubric.rubricVersion) {
    throw new Error("RUBRIC_VERSION_MISMATCH");
  }
  const fixture = generateContinuityFixture({
    plan: createContinuityPlan({
      seed: dataset.manifest.seed,
      tier: dataset.manifest.continuityTier,
    }),
    sourceCommit: dataset.manifest.sourceCommit,
  });
  if (fixture.digest.sha256 !== dataset.manifest.continuityFixtureSha256) {
    throw new Error("CONTINUITY_FIXTURE_MISMATCH");
  }
  const continuityEvaluation = evaluateContinuityFindings({
    fixture,
    findings: candidate.continuityFindings,
  });
  const missingDefects = new Map(
    continuityEvaluation.missingFindings.map((defect) => [defect.id, defect]),
  );
  const samples = [...dataset.chapterSamples, ...dataset.adversarialCases];
  const deterministicScores = samples.flatMap((sample, sampleIndex) => {
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
        sampleIndex === 0 ? continuityEvaluation.unexpectedFindings.length : 0,
        evidenceQuote,
      ),
    ];
  });

  return {
    schemaVersion: 1,
    runId: candidate.candidateId,
    datasetSha256: candidate.datasetSha256,
    rubricVersion: candidate.rubricVersion,
    provenance: candidate.provenance,
    scores: [...deterministicScores, ...candidate.humanScores],
    decisions: candidate.decisions,
    continuityEvaluation,
  };
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
