import { sha256Json } from "@novel-brain/continuity-benchmark";

import type {
  QualityAdversarialCase,
  QualityBenchmarkDataset,
  QualityChapterSample,
} from "./dataset";
import { verifyQualityBenchmarkDataset } from "./dataset";
import type {
  QualityBenchmarkDimensionId,
  QualityDimensionDefinition,
  QualityScorerType,
  ReleaseQualityRubric,
} from "./rubric";
import { verifyReleaseQualityRubric } from "./rubric";

export interface QualityMetricScore {
  sampleId: string;
  dimension: QualityBenchmarkDimensionId;
  scorerType: QualityScorerType;
  scorerId: string;
  value: number;
  evidenceQuote: string;
}

export interface QualityBenchmarkDecision {
  id: "interRaterVarianceThreshold";
  approved: boolean;
  owner: string;
  rationale: string;
  approvedValue: number;
  decidedAt: string;
}

export interface QualityBenchmarkRun {
  schemaVersion: 1;
  runId: string;
  datasetSha256: string;
  rubricVersion: string;
  provenance: {
    codeCommit: string;
    model: string;
    promptVersion: string;
    contextCompilerVersion: string;
    agentContractVersion: string;
  };
  scores: readonly QualityMetricScore[];
  decisions: readonly QualityBenchmarkDecision[];
}

export interface QualityMetricResult {
  id: QualityBenchmarkDimensionId;
  label: string;
  value: number;
  unit: QualityDimensionDefinition["unit"];
  threshold: QualityDimensionDefinition["threshold"];
  passed: boolean;
}

export interface QualityBenchmarkReport {
  schemaVersion: 1;
  status: "passed" | "blocked";
  releaseGate: {
    passed: boolean;
    blockers: readonly string[];
  };
  metrics: readonly QualityMetricResult[];
  humanReview: {
    reviewerCount: number;
    maxVariance: number;
    varianceThreshold: number | null;
  };
  provenance: QualityBenchmarkRun["provenance"];
  datasetSha256: string;
  rubricVersion: string;
  sha256: string;
}

type BenchmarkSample = QualityChapterSample | QualityAdversarialCase;

export function evaluateQualityBenchmarkRun(input: {
  dataset: QualityBenchmarkDataset;
  rubric: ReleaseQualityRubric;
  run: QualityBenchmarkRun;
}): QualityBenchmarkReport {
  const { dataset, rubric, run } = input;
  const blockers = new Set<string>();
  const sampleById = new Map(
    [...dataset.chapterSamples, ...dataset.adversarialCases].map((sample) => [sample.id, sample]),
  );
  if (run.datasetSha256 !== dataset.manifest.datasetSha256) {
    blockers.add("dataset-hash-mismatch");
  }
  if (!verifyQualityBenchmarkDataset(dataset)) {
    blockers.add("dataset-digest-mismatch");
  }
  if (run.rubricVersion !== rubric.rubricVersion) {
    blockers.add("rubric-version-mismatch");
  }
  if (!verifyReleaseQualityRubric(rubric)) {
    blockers.add("rubric-digest-mismatch");
  }
  if (Object.values(run.provenance).some((value) => value.trim().length === 0)) {
    blockers.add("run-provenance-incomplete");
  }

  const scoresByDimension = new Map<QualityBenchmarkDimensionId, QualityMetricScore[]>();
  const dimensionById = new Map(rubric.dimensions.map((dimension) => [dimension.id, dimension]));
  const scoreKeys = new Set<string>();
  for (const score of run.scores) {
    const sample = sampleById.get(score.sampleId);
    const dimension = dimensionById.get(score.dimension);
    const scoreKey = `${score.sampleId}:${score.dimension}:${score.scorerType}:${score.scorerId}`;
    if (
      !sample ||
      !dimension ||
      !isFiniteScore(score.value) ||
      score.scorerId.trim().length === 0 ||
      !evidenceExistsInSample(sample, score.evidenceQuote)
    ) {
      blockers.add("score-evidence-invalid");
      continue;
    }
    if (scoreKeys.has(scoreKey)) {
      blockers.add("duplicate-score");
      continue;
    }
    scoreKeys.add(scoreKey);
    if (!scoreWithinRange(dimension, score.value)) {
      blockers.add("score-range-invalid");
      continue;
    }
    scoresByDimension.set(score.dimension, [
      ...(scoresByDimension.get(score.dimension) ?? []),
      score,
    ]);
  }

  const metrics = rubric.dimensions.map((dimension) => {
    const result = measureDimension({
      dataset,
      dimension,
      scores: scoresByDimension.get(dimension.id) ?? [],
      blockers,
    });
    if (!result.passed) {
      blockers.add(`threshold-failed:${dimension.id}`);
    }
    return result;
  });

  const humanScores = run.scores.filter((score) => score.scorerType === "human_blind");
  const reviewerCount = new Set(humanScores.map((score) => score.scorerId)).size;
  const varianceThreshold = approvedVarianceThreshold(run.decisions);
  const maxVariance = computeMaxVariance(humanScores);
  if (varianceThreshold === null) {
    blockers.add("decision-required:interRaterVarianceThreshold");
  } else if (maxVariance > varianceThreshold) {
    blockers.add("inter-rater-variance-above-threshold");
  }

  const blockerList = [...blockers].sort();
  const reportWithoutHash = {
    schemaVersion: 1 as const,
    status: blockerList.length === 0 ? ("passed" as const) : ("blocked" as const),
    releaseGate: {
      passed: blockerList.length === 0,
      blockers: blockerList,
    },
    metrics,
    humanReview: {
      reviewerCount,
      maxVariance,
      varianceThreshold,
    },
    provenance: run.provenance,
    datasetSha256: run.datasetSha256,
    rubricVersion: run.rubricVersion,
  };
  return {
    ...reportWithoutHash,
    sha256: sha256Json(reportWithoutHash),
  };
}

export function verifyQualityBenchmarkReport(report: QualityBenchmarkReport): boolean {
  const { sha256, ...reportWithoutHash } = report;
  return sha256 === sha256Json(reportWithoutHash);
}

function measureDimension(input: {
  dataset: QualityBenchmarkDataset;
  dimension: QualityDimensionDefinition;
  scores: readonly QualityMetricScore[];
  blockers: Set<string>;
}): QualityMetricResult {
  const { dataset, dimension, scores, blockers } = input;
  const samples = [...dataset.chapterSamples, ...dataset.adversarialCases];
  const sampleIds = new Set(samples.map((sample) => sample.id));
  if (dimension.scorerType === "deterministic") {
    const coveredSamples = new Set(
      scores.filter((score) => score.scorerType === "deterministic").map((score) => score.sampleId),
    );
    if ([...sampleIds].some((sampleId) => !coveredSamples.has(sampleId))) {
      blockers.add("deterministic-evidence-missing");
    }
  } else {
    const reviewersBySample = new Map<string, Set<string>>();
    for (const score of scores.filter((candidate) => candidate.scorerType === "human_blind")) {
      reviewersBySample.set(
        score.sampleId,
        new Set([...(reviewersBySample.get(score.sampleId) ?? []), score.scorerId]),
      );
    }
    if ([...sampleIds].some((sampleId) => (reviewersBySample.get(sampleId)?.size ?? 0) < 2)) {
      blockers.add("human-blind-evidence-missing");
    }
  }

  const value = roundMetric(measureValue(dataset, dimension.id, scores));
  const passed =
    dimension.threshold.operator === "min"
      ? value >= dimension.threshold.value
      : value <= dimension.threshold.value;
  return {
    id: dimension.id,
    label: dimension.label,
    value,
    unit: dimension.unit,
    threshold: dimension.threshold,
    passed,
  };
}

function measureValue(
  dataset: QualityBenchmarkDataset,
  dimension: QualityBenchmarkDimensionId,
  scores: readonly QualityMetricScore[],
): number {
  if (dimension === "continuity_conflicts_per_50k") {
    const totalCharacters = [...dataset.chapterSamples, ...dataset.adversarialCases].reduce(
      (sum, sample) => sum + sample.text.length,
      0,
    );
    const totalConflicts = scores
      .filter((score) => score.scorerType === "deterministic")
      .reduce((sum, score) => sum + score.value, 0);
    return totalCharacters === 0 ? 0 : (totalConflicts / totalCharacters) * 50_000;
  }
  const relevant =
    dimension === "p0_fact_loss" || dimension === "knowledge_boundary_violation"
      ? scores.filter((score) => score.scorerType === "deterministic")
      : scores.filter((score) => score.scorerType !== "model_assisted");
  if (relevant.length === 0) {
    return 0;
  }
  if (dimension === "p0_fact_loss" || dimension === "knowledge_boundary_violation") {
    return relevant.reduce((sum, score) => sum + score.value, 0);
  }
  return relevant.reduce((sum, score) => sum + score.value, 0) / relevant.length;
}

function approvedVarianceThreshold(decisions: readonly QualityBenchmarkDecision[]): number | null {
  const decision = decisions.find(
    (candidate) =>
      candidate.id === "interRaterVarianceThreshold" &&
      candidate.approved &&
      candidate.owner.trim().length > 0 &&
      candidate.rationale.trim().length > 0 &&
      candidate.decidedAt.trim().length > 0 &&
      Number.isFinite(candidate.approvedValue) &&
      candidate.approvedValue >= 0,
  );
  return decision?.approvedValue ?? null;
}

function computeMaxVariance(scores: readonly QualityMetricScore[]): number {
  const groups = new Map<string, number[]>();
  const humans = scores.filter((score) => score.scorerType === "human_blind");
  for (const score of humans) {
    const key = `${score.sampleId}:${score.dimension}`;
    groups.set(key, [...(groups.get(key) ?? []), score.value]);
  }
  let maximum = 0;
  for (const values of groups.values()) {
    if (values.length < 2) {
      continue;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    maximum = Math.max(maximum, variance);
  }
  return maximum;
}

function evidenceExistsInSample(sample: BenchmarkSample, evidenceQuote: string): boolean {
  const normalizedEvidence = normalizeText(evidenceQuote);
  return normalizedEvidence.length > 0 && normalizeText(sample.text).includes(normalizedEvidence);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isFiniteScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function scoreWithinRange(dimension: QualityDimensionDefinition, value: number): boolean {
  if (dimension.unit === "count" || dimension.unit === "per_50k_characters") {
    return Number.isInteger(value);
  }
  return dimension.scoreRange === null
    ? true
    : value >= dimension.scoreRange.min && value <= dimension.scoreRange.max;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
