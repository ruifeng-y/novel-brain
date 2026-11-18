import { Injectable } from "@nestjs/common";
import { sha256CanonicalJson } from "@novel-brain/continuity-benchmark";
import {
  compareQualityBenchmarkRuns,
  createCanaryDecision,
  createApprovedQualityBenchmarkDataset,
  createReleaseQualityRubric,
  evaluateQualityBenchmarkRun,
  executeQualityBenchmarkCandidate,
  type ProviderCanaryPolicy,
  type ProviderSmokeEvidence,
  type QualityBenchmarkCandidate,
  type QualityBenchmarkReport,
  type QualityBenchmarkReviewPolicy,
  type QualityRegressionReport,
} from "@novel-brain/quality-benchmark";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EvalRepository, type StoredReleaseDecision } from "./eval.repository";

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
    return this.repository.saveGate({
      userId,
      baselineRunKey,
      candidateRunKey,
      result,
    });
  }

  async canary(input: {
    userId: string;
    policy: ProviderCanaryPolicy;
    smoke: ProviderSmokeEvidence;
    baselineRunKey: string;
    candidateRunKey: string;
    reviewPolicy?: QualityBenchmarkReviewPolicy | null;
    createdAt?: string;
  }): Promise<StoredReleaseDecision> {
    const regression = await this.gate(
      input.userId,
      input.baselineRunKey,
      input.candidateRunKey,
      input.reviewPolicy,
    );
    const decision = createCanaryDecision({
      policy: input.policy,
      smoke: input.smoke,
      regression,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
    return this.repository.saveReleaseDecision({
      userId: input.userId,
      decision,
    });
  }

  async rollback(input: {
    userId: string;
    currentDecisionId: string;
    reason: string;
    actorId: string;
    createdAt?: string;
  }): Promise<StoredReleaseDecision> {
    return this.repository.rollbackRelease({
      userId: input.userId,
      currentDecisionId: input.currentDecisionId,
      actorId: input.actorId,
      reason: input.reason,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }

  activeRelease(userId: string, channelKey: string): Promise<StoredReleaseDecision | undefined> {
    return this.repository.activeRelease(userId, channelKey);
  }
}

function qualityRunIdentity(
  candidate: QualityBenchmarkCandidate,
  reviewPolicy: QualityBenchmarkReviewPolicy | null,
): string {
  return `${candidate.candidateId}:${sha256CanonicalJson({ candidate, reviewPolicy })}`;
}
