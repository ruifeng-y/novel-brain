import { Injectable } from "@nestjs/common";
import { sha256Json } from "@novel-brain/continuity-benchmark";
import {
  compareQualityBenchmarkRuns,
  createApprovedQualityBenchmarkDataset,
  createReleaseQualityRubric,
  evaluateQualityBenchmarkRun,
  executeQualityBenchmarkCandidate,
  type QualityBenchmarkCandidate,
  type QualityBenchmarkReport,
  type QualityBenchmarkReviewPolicy,
  type QualityRegressionReport,
} from "@novel-brain/quality-benchmark";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EvalRepository } from "./eval.repository";

@Injectable()
export class EvalService {
  constructor(private readonly repository: EvalRepository) {}

  registry() {
    const dataset = createApprovedQualityBenchmarkDataset();
    const rubric = createReleaseQualityRubric();
    return { dataset, rubric };
  }

  async run(
    userId: string,
    candidate: QualityBenchmarkCandidate,
    reviewPolicy?: QualityBenchmarkReviewPolicy | null,
  ): Promise<QualityBenchmarkReport> {
    const runIdentity = qualityRunIdentity(candidate, reviewPolicy ?? null);
    const existing = await this.repository.reportByRunKey(userId, runIdentity);
    if (existing) {
      return existing;
    }
    const { dataset, rubric } = this.registry();
    const run = {
      ...executeQualityBenchmarkCandidate({ dataset, rubric, candidate }),
      runId: runIdentity,
    };
    const report = evaluateQualityBenchmarkRun({
      dataset,
      rubric,
      run,
      ...(reviewPolicy ? { reviewPolicy } : {}),
    });
    return this.repository.saveRun({ userId, dataset, rubric, run, report });
  }

  async gate(
    userId: string,
    baselineRunKey: string,
    candidateRunKey: string,
    reviewPolicy?: QualityBenchmarkReviewPolicy | null,
  ): Promise<QualityRegressionReport> {
    const [baseline, candidate] = await Promise.all([
      this.repository.reportByRunKey(userId, baselineRunKey),
      this.repository.reportByRunKey(userId, candidateRunKey),
    ]);
    if (!baseline || !candidate) {
      throw new Error("EVAL_RUN_NOT_FOUND");
    }
    const result = compareQualityBenchmarkRuns({
      baseline,
      candidate,
      ...(reviewPolicy ? { reviewPolicy } : {}),
    });
    await this.repository.saveGate({
      userId,
      baselineRunKey,
      candidateRunKey,
      result,
    });
    return result;
  }
}

function qualityRunIdentity(
  candidate: QualityBenchmarkCandidate,
  reviewPolicy: QualityBenchmarkReviewPolicy | null,
): string {
  return `${candidate.candidateId}:${sha256Json(canonicalize({ candidate, reviewPolicy }))}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
