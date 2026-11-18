import { verifyQualityBenchmarkReport, type QualityBenchmarkReport } from "./evaluator";
import {
  APPROVED_QUALITY_BENCHMARK_DATASET_SHA256,
  RELEASE_QUALITY_RUBRIC_VERSION,
} from "./dataset";
import { APPROVED_QUALITY_RUBRIC_SHA256, type QualityBenchmarkReviewPolicy } from "./rubric";

export interface QualityRegressionReport {
  schemaVersion: 1;
  rolloutAllowed: boolean;
  blockers: readonly string[];
  changedProvenance: readonly (keyof QualityBenchmarkReport["provenance"])[];
  candidateProvenance: QualityBenchmarkReport["provenance"];
  p0: {
    baseline: number | null;
    candidate: number | null;
    regressed: boolean;
  };
  baselineSha256: string;
  candidateSha256: string;
}

export function compareQualityBenchmarkRuns(input: {
  baseline: QualityBenchmarkReport;
  candidate: QualityBenchmarkReport;
  reviewPolicy?: QualityBenchmarkReviewPolicy | null;
}): QualityRegressionReport {
  const { baseline, candidate } = input;
  const blockers = new Set<string>();
  if (baseline.datasetSha256 !== candidate.datasetSha256) {
    blockers.add("dataset-hash-mismatch");
  }
  if (baseline.rubricVersion !== candidate.rubricVersion) {
    blockers.add("rubric-version-mismatch");
  }
  if (!candidate.releaseGate.passed) {
    blockers.add("candidate-release-gate-failed");
  }
  if (!baseline.releaseGate.passed) {
    blockers.add("baseline-release-gate-failed");
  }
  if (
    !verifyQualityBenchmarkReport(baseline, input.reviewPolicy) ||
    !verifyQualityBenchmarkReport(candidate, input.reviewPolicy)
  ) {
    blockers.add("report-invalid");
  }
  if (baseline.sha256 === candidate.sha256 || baseline.runId === candidate.runId) {
    blockers.add("candidate-not-distinct");
  }
  if (
    baseline.datasetSha256 !== APPROVED_QUALITY_BENCHMARK_DATASET_SHA256 ||
    candidate.datasetSha256 !== APPROVED_QUALITY_BENCHMARK_DATASET_SHA256
  ) {
    blockers.add("dataset-not-approved");
  }
  if (
    baseline.rubricVersion !== RELEASE_QUALITY_RUBRIC_VERSION ||
    candidate.rubricVersion !== RELEASE_QUALITY_RUBRIC_VERSION ||
    baseline.rubricSha256 !== APPROVED_QUALITY_RUBRIC_SHA256 ||
    candidate.rubricSha256 !== APPROVED_QUALITY_RUBRIC_SHA256
  ) {
    blockers.add("rubric-not-approved");
  }

  const baselineP0 = metricValue(baseline, "p0_fact_loss");
  const candidateP0 = metricValue(candidate, "p0_fact_loss");
  if (baselineP0 === undefined) {
    blockers.add("metric-missing:p0_fact_loss");
  }
  if (candidateP0 === undefined) {
    blockers.add("metric-missing:p0_fact_loss");
  }
  const regressed =
    baselineP0 !== undefined && candidateP0 !== undefined && candidateP0 > baselineP0;
  if (regressed) {
    blockers.add("p0-regression");
  }

  const blockerList = [...blockers].sort();
  return {
    schemaVersion: 1,
    rolloutAllowed: blockerList.length === 0,
    blockers: blockerList,
    changedProvenance: changedProvenance(baseline.provenance, candidate.provenance),
    candidateProvenance: candidate.provenance,
    p0: {
      baseline: baselineP0 ?? null,
      candidate: candidateP0 ?? null,
      regressed,
    },
    baselineSha256: baseline.sha256,
    candidateSha256: candidate.sha256,
  };
}

function metricValue(
  report: QualityBenchmarkReport,
  dimension: QualityBenchmarkReport["metrics"][number]["id"],
): number | undefined {
  return report.metrics.find((metric) => metric.id === dimension)?.value;
}

function changedProvenance(
  baseline: QualityBenchmarkReport["provenance"],
  candidate: QualityBenchmarkReport["provenance"],
): (keyof QualityBenchmarkReport["provenance"])[] {
  return (Object.keys(baseline) as (keyof QualityBenchmarkReport["provenance"])[])
    .filter((key) => baseline[key] !== candidate[key])
    .sort();
}
