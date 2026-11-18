import {
  createContinuityPlan,
  evaluateContinuityFindings,
  generateContinuityFixture,
  type ContinuityEvaluation,
  type ContinuityFinding,
} from "@novel-brain/continuity-benchmark";

import type { QualityBenchmarkDataset } from "./dataset";
import { createDeterministicQualityScores } from "./deterministic-scores";
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
  const deterministicScores = createDeterministicQualityScores(dataset, continuityEvaluation);

  return {
    schemaVersion: 1,
    runId: candidate.candidateId,
    datasetSha256: candidate.datasetSha256,
    rubricVersion: candidate.rubricVersion,
    provenance: candidate.provenance,
    scores: [...deterministicScores, ...candidate.humanScores],
    decisions: candidate.decisions,
    continuityFindings: candidate.continuityFindings,
    continuityEvaluation,
  };
}
