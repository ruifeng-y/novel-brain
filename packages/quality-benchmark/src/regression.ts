import { verifyQualityBenchmarkReport, type QualityBenchmarkReport } from "./evaluator";

export interface QualityRegressionReport {
  schemaVersion: 1;
  rolloutAllowed: boolean;
  blockers: readonly string[];
  changedProvenance: readonly (keyof QualityBenchmarkReport["provenance"])[];
  p0: {
    baseline: number;
    candidate: number;
    regressed: boolean;
  };
  baselineSha256: string;
  candidateSha256: string;
}

export function compareQualityBenchmarkRuns(input: {
  baseline: QualityBenchmarkReport;
  candidate: QualityBenchmarkReport;
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
  if (!verifyQualityBenchmarkReport(baseline) || !verifyQualityBenchmarkReport(candidate)) {
    blockers.add("report-digest-mismatch");
  }

  const baselineP0 = metricValue(baseline, "p0_fact_loss");
  const candidateP0 = metricValue(candidate, "p0_fact_loss");
  const regressed = candidateP0 > baselineP0;
  if (regressed) {
    blockers.add("p0-regression");
  }

  const blockerList = [...blockers].sort();
  return {
    schemaVersion: 1,
    rolloutAllowed: blockerList.length === 0,
    blockers: blockerList,
    changedProvenance: changedProvenance(baseline.provenance, candidate.provenance),
    p0: {
      baseline: baselineP0,
      candidate: candidateP0,
      regressed,
    },
    baselineSha256: baseline.sha256,
    candidateSha256: candidate.sha256,
  };
}

function metricValue(
  report: QualityBenchmarkReport,
  dimension: QualityBenchmarkReport["metrics"][number]["id"],
): number {
  return report.metrics.find((metric) => metric.id === dimension)?.value ?? 0;
}

function changedProvenance(
  baseline: QualityBenchmarkReport["provenance"],
  candidate: QualityBenchmarkReport["provenance"],
): (keyof QualityBenchmarkReport["provenance"])[] {
  return (Object.keys(baseline) as (keyof QualityBenchmarkReport["provenance"])[])
    .filter((key) => baseline[key] !== candidate[key])
    .sort();
}
