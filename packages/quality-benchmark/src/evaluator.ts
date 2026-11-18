import { sha256CanonicalJson } from "@novel-brain/continuity-benchmark";
import {
  evaluateContinuityFindings,
  generateContinuityFixture,
  createContinuityPlan,
  verifyContinuityEvaluation,
  type ContinuityEvaluation,
  type ContinuityFinding,
} from "@novel-brain/continuity-benchmark";

import type {
  QualityAdversarialCase,
  QualityBenchmarkDataset,
  QualityChapterSample,
} from "./dataset";
import { createApprovedQualityBenchmarkDataset, verifyQualityBenchmarkDataset } from "./dataset";
import { APPROVED_QUALITY_BENCHMARK_DATASET_SHA256 } from "./dataset";
import { createDeterministicQualityScores } from "./deterministic-scores";
import type {
  QualityBenchmarkDimensionId,
  QualityBenchmarkReviewPolicy,
  QualityDimensionDefinition,
  QualityScorerType,
  ReleaseQualityRubric,
} from "./rubric";
import { createReleaseQualityRubric, verifyReleaseQualityRubric } from "./rubric";
import { APPROVED_QUALITY_RUBRIC_SHA256 } from "./rubric";

export interface QualityMetricScore {
  sampleId: string;
  dimension: QualityBenchmarkDimensionId;
  scorerType: QualityScorerType;
  scorerId: string;
  value: number;
  evidenceQuote: string;
  evidenceQuotes?: readonly string[];
  confidence: number;
  reviewerAttestationId?: string;
  reviewedAt?: string;
  blindPacketSha256?: string;
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
    configHash: string;
  };
  scores: readonly QualityMetricScore[];
  decisions: readonly QualityBenchmarkDecision[];
  continuityFindings: readonly ContinuityFinding[];
  continuityEvaluation: ContinuityEvaluation;
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
  runId: string;
  status: "passed" | "blocked";
  releaseGate: {
    passed: boolean;
    blockers: readonly string[];
  };
  metrics: readonly QualityMetricResult[];
  humanReview: {
    reviewerCount: number;
    attestationCount: number;
    maxVariance: number;
    varianceThreshold: number | null;
    reviewPolicySha256: string | null;
  };
  provenance: QualityBenchmarkRun["provenance"];
  scores: readonly QualityMetricScore[];
  decisions: readonly QualityBenchmarkDecision[];
  continuityFindings: readonly ContinuityFinding[];
  continuityEvaluation: ContinuityEvaluation | null;
  datasetSha256: string;
  rubricSha256: string;
  rubricVersion: string;
  sha256: string;
}

type BenchmarkSample = QualityChapterSample | QualityAdversarialCase;

export function evaluateQualityBenchmarkRun(input: {
  dataset: QualityBenchmarkDataset;
  rubric: ReleaseQualityRubric;
  run: QualityBenchmarkRun;
  reviewPolicy?: QualityBenchmarkReviewPolicy | null;
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
  if (dataset.manifest.datasetSha256 !== APPROVED_QUALITY_BENCHMARK_DATASET_SHA256) {
    blockers.add("dataset-not-approved");
  }
  if (run.rubricVersion !== rubric.rubricVersion) {
    blockers.add("rubric-version-mismatch");
  }
  if (!verifyReleaseQualityRubric(rubric)) {
    blockers.add("rubric-digest-mismatch");
  }
  if (rubric.sha256 !== APPROVED_QUALITY_RUBRIC_SHA256) {
    blockers.add("rubric-not-approved");
  }
  if (Object.values(run.provenance).some((value) => value.trim().length === 0)) {
    blockers.add("run-provenance-incomplete");
  }
  let continuityEvaluation: ContinuityEvaluation | null = null;
  try {
    if (!Array.isArray(run.continuityFindings)) {
      throw new Error("CONTINUITY_FINDINGS_INVALID");
    }
    const fixture = generateContinuityFixture({
      plan: createContinuityPlan({
        seed: dataset.manifest.seed,
        tier: dataset.manifest.continuityTier,
      }),
      sourceCommit: dataset.manifest.sourceCommit,
    });
    if (fixture.digest.sha256 !== dataset.manifest.continuityFixtureSha256) {
      blockers.add("continuity-evaluation-fixture-mismatch");
    }
    continuityEvaluation = evaluateContinuityFindings({
      fixture,
      findings: run.continuityFindings,
    });
    if (
      !run.continuityEvaluation ||
      !verifyContinuityEvaluation(run.continuityEvaluation) ||
      run.continuityEvaluation.sha256 !== continuityEvaluation.sha256
    ) {
      blockers.add("continuity-evaluation-invalid");
    }
  } catch {
    blockers.add("continuity-evaluation-invalid");
  }

  const scoresByDimension = new Map<QualityBenchmarkDimensionId, QualityMetricScore[]>();
  const dimensionById = new Map(rubric.dimensions.map((dimension) => [dimension.id, dimension]));
  const scoreKeys = new Set<string>();
  const attestationByReviewer = new Map<string, string>();
  const reviewedAtByReviewer = new Map<string, string>();
  const reviewerByAttestation = new Map<string, string>();
  const validatedScores: QualityMetricScore[] = [];
  const deterministicScores = continuityEvaluation
    ? createDeterministicQualityScores(dataset, continuityEvaluation)
    : [];
  for (const score of deterministicScores) {
    scoreKeys.add(`${score.sampleId}:${score.dimension}:${score.scorerType}:${score.scorerId}`);
    scoresByDimension.set(score.dimension, [
      ...(scoresByDimension.get(score.dimension) ?? []),
      score,
    ]);
    validatedScores.push(score);
  }
  const blindPacketSha256 = sha256CanonicalJson({
    datasetSha256: dataset.manifest.datasetSha256,
    rubricSha256: rubric.sha256,
  });
  for (const score of run.scores) {
    if (score.scorerType === "deterministic") {
      continue;
    }
    const sample = sampleById.get(score.sampleId);
    const dimension = dimensionById.get(score.dimension);
    const scoreKey = `${score.sampleId}:${score.dimension}:${score.scorerType}:${score.scorerId}`;
    if (
      !sample ||
      !dimension ||
      !isFiniteScore(score.value) ||
      score.scorerId.trim().length === 0 ||
      !Number.isFinite(score.confidence) ||
      score.confidence < 0 ||
      score.confidence > 1 ||
      !scoreEvidenceMatchesSample(sample, score)
    ) {
      blockers.add("score-evidence-invalid");
      continue;
    }
    if (score.scorerType === "human_blind") {
      const attestationId = score.reviewerAttestationId?.trim();
      if (
        !attestationId ||
        !score.reviewedAt ||
        !Number.isFinite(Date.parse(score.reviewedAt)) ||
        score.blindPacketSha256 !== blindPacketSha256 ||
        (attestationByReviewer.get(score.scorerId) ?? attestationId) !== attestationId ||
        (reviewedAtByReviewer.get(score.scorerId) ?? score.reviewedAt) !== score.reviewedAt ||
        (reviewerByAttestation.get(attestationId) ?? score.scorerId) !== score.scorerId
      ) {
        blockers.add("human-attestation-invalid");
        continue;
      }
      attestationByReviewer.set(score.scorerId, attestationId);
      reviewedAtByReviewer.set(score.scorerId, score.reviewedAt);
      reviewerByAttestation.set(attestationId, score.scorerId);
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
    validatedScores.push(score);
  }

  const metrics = rubric.dimensions.map((dimension) => {
    const result = measureDimension({
      dataset,
      dimension,
      scores: scoresByDimension.get(dimension.id) ?? [],
      continuityEvaluation,
      blockers,
    });
    if (!result.passed) {
      blockers.add(`threshold-failed:${dimension.id}`);
    }
    return result;
  });

  const humanScores = validatedScores.filter((score) => score.scorerType === "human_blind");
  const reviewerCount = new Set(humanScores.map((score) => score.scorerId)).size;
  const attestationCount = new Set(humanScores.map((score) => score.reviewerAttestationId)).size;
  const reviewPolicy = validReviewPolicy(input.reviewPolicy) ? input.reviewPolicy : null;
  const varianceThreshold = reviewPolicy?.interRaterVarianceThreshold ?? null;
  const reviewPolicySha256 = reviewPolicy ? sha256CanonicalJson(reviewPolicy) : null;
  const maxVariance = computeMaxVariance(humanScores);
  if (varianceThreshold === null) {
    blockers.add("decision-required:interRaterVarianceThreshold");
  } else if (maxVariance > varianceThreshold) {
    blockers.add("inter-rater-variance-above-threshold");
  }

  const blockerList = [...blockers].sort();
  const reportedScores = [
    ...deterministicScores,
    ...run.scores.filter((score) => score.scorerType !== "deterministic"),
  ];
  const reportWithoutHash = {
    schemaVersion: 1 as const,
    runId: run.runId,
    status: blockerList.length === 0 ? ("passed" as const) : ("blocked" as const),
    releaseGate: {
      passed: blockerList.length === 0,
      blockers: blockerList,
    },
    metrics,
    humanReview: {
      reviewerCount,
      attestationCount,
      maxVariance,
      varianceThreshold,
      reviewPolicySha256,
    },
    provenance: run.provenance,
    scores: reportedScores,
    decisions: run.decisions,
    continuityFindings: run.continuityFindings,
    continuityEvaluation,
    datasetSha256: run.datasetSha256,
    rubricSha256: rubric.sha256,
    rubricVersion: run.rubricVersion,
  };
  return {
    ...reportWithoutHash,
    sha256: sha256CanonicalJson(reportWithoutHash),
  };
}

export function verifyQualityBenchmarkReport(
  report: QualityBenchmarkReport,
  reviewPolicy?: QualityBenchmarkReviewPolicy | null,
): boolean {
  if (
    !report ||
    !Array.isArray(report.metrics) ||
    !Array.isArray(report.scores) ||
    !Array.isArray(report.continuityFindings) ||
    !report.releaseGate ||
    !Array.isArray(report.releaseGate.blockers) ||
    !report.humanReview
  ) {
    return false;
  }
  const { sha256, ...reportWithoutHash } = report;
  const metricIds = report.metrics.map((metric) => metric.id);
  const expectedMetricIds = [
    "p0_fact_loss",
    "knowledge_boundary_violation",
    "outline_adherence",
    "hook_prose_score",
    "continuity_conflicts_per_50k",
  ] as const;
  const structurallyValid =
    report.schemaVersion === 1 &&
    report.datasetSha256 === APPROVED_QUALITY_BENCHMARK_DATASET_SHA256 &&
    report.rubricVersion === "adr-0022-v1" &&
    report.rubricSha256 === APPROVED_QUALITY_RUBRIC_SHA256 &&
    expectedMetricIds.every((id) => metricIds.includes(id)) &&
    new Set(metricIds).size === expectedMetricIds.length &&
    metricIds.length === expectedMetricIds.length &&
    /^[a-f0-9]{64}$/u.test(report.provenance.configHash) &&
    report.status === (report.releaseGate.passed ? "passed" : "blocked") &&
    report.releaseGate.passed === (report.releaseGate.blockers.length === 0) &&
    sha256 === sha256CanonicalJson(reportWithoutHash);
  if (!structurallyValid) {
    return false;
  }
  try {
    const regenerated = evaluateQualityBenchmarkRun({
      dataset: createApprovedQualityBenchmarkDataset(),
      rubric: createReleaseQualityRubric(),
      run: {
        schemaVersion: 1,
        runId: report.runId,
        datasetSha256: report.datasetSha256,
        rubricVersion: report.rubricVersion,
        provenance: report.provenance,
        scores: report.scores,
        decisions: report.decisions,
        continuityFindings: report.continuityFindings,
        continuityEvaluation: report.continuityEvaluation as ContinuityEvaluation,
      },
      ...(reviewPolicy ? { reviewPolicy } : {}),
    });
    return regenerated.sha256 === report.sha256;
  } catch {
    return false;
  }
}

function measureDimension(input: {
  dataset: QualityBenchmarkDataset;
  dimension: QualityDimensionDefinition;
  scores: readonly QualityMetricScore[];
  continuityEvaluation: ContinuityEvaluation | null;
  blockers: Set<string>;
}): QualityMetricResult {
  const { dataset, dimension, scores, continuityEvaluation, blockers } = input;
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

  const value = roundMetric(measureValue(dataset, dimension, scores, continuityEvaluation));
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
  dimension: QualityDimensionDefinition,
  scores: readonly QualityMetricScore[],
  continuityEvaluation: ContinuityEvaluation | null,
): number {
  if (dimension.id === "p0_fact_loss") {
    return continuityEvaluation?.releaseGate.p0FalseNegatives ?? 0;
  }
  if (dimension.id === "knowledge_boundary_violation") {
    return continuityEvaluation?.releaseGate.knowledgeBoundaryFalseNegatives ?? 0;
  }
  if (dimension.id === "continuity_conflicts_per_50k") {
    const totalCharacters = [...dataset.chapterSamples, ...dataset.adversarialCases].reduce(
      (sum, sample) => sum + sample.text.length,
      0,
    );
    const totalConflicts = continuityEvaluation
      ? continuityEvaluation.missingFindings.length + continuityEvaluation.unexpectedFindings.length
      : 0;
    return totalCharacters === 0 ? 0 : (totalConflicts / totalCharacters) * 50_000;
  }
  const relevant = scores.filter((score) => score.scorerType === dimension.scorerType);
  if (relevant.length === 0) {
    return 0;
  }
  return relevant.reduce((sum, score) => sum + score.value, 0) / relevant.length;
}

function validReviewPolicy(
  policy: QualityBenchmarkReviewPolicy | null | undefined,
): policy is QualityBenchmarkReviewPolicy {
  return Boolean(
    policy &&
    typeof policy.owner === "string" &&
    policy.owner.trim() &&
    typeof policy.rationale === "string" &&
    policy.rationale.trim() &&
    typeof policy.decidedAt === "string" &&
    policy.decidedAt.trim() &&
    Number.isFinite(Date.parse(policy.decidedAt)) &&
    Number.isFinite(policy.interRaterVarianceThreshold) &&
    policy.interRaterVarianceThreshold >= 0,
  );
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

function scoreEvidenceMatchesSample(sample: BenchmarkSample, score: QualityMetricScore): boolean {
  const evidenceQuotes =
    score.evidenceQuotes && score.evidenceQuotes.length > 0
      ? score.evidenceQuotes
      : [score.evidenceQuote];
  if (
    evidenceQuotes.some((quote) => {
      const normalized = normalizeText(quote);
      return normalized.length === 0 || !normalizeText(sample.text).includes(normalized);
    })
  ) {
    return false;
  }
  if (score.dimension !== "outline_adherence") {
    return true;
  }
  const normalizedBeatEvidence = normalizeText(evidenceQuotes.join(" "));
  return sample.requiredBeats.every((beat) => normalizedBeatEvidence.includes(normalizeText(beat)));
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
