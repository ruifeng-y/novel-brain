import { Injectable } from "@nestjs/common";
import {
  compareQualityBenchmarkRuns,
  createApprovedQualityBenchmarkDataset,
  createReleaseQualityRubric,
  evaluateQualityBenchmarkRun,
  executeQualityBenchmarkCandidate,
  type QualityBenchmarkCandidate,
  type QualityBenchmarkReport,
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

  async run(userId: string, candidate: QualityBenchmarkCandidate): Promise<QualityBenchmarkReport> {
    const existing = await this.repository.reportByRunKey(userId, candidate.candidateId);
    if (existing) {
      return existing;
    }
    const { dataset, rubric } = this.registry();
    const run = executeQualityBenchmarkCandidate({ dataset, rubric, candidate });
    const report = evaluateQualityBenchmarkRun({ dataset, rubric, run });
    await this.repository.saveRun({ userId, dataset, rubric, run, report });
    return report;
  }

  async gate(
    userId: string,
    baselineRunKey: string,
    candidateRunKey: string,
  ): Promise<QualityRegressionReport> {
    const [baseline, candidate] = await Promise.all([
      this.repository.reportByRunKey(userId, baselineRunKey),
      this.repository.reportByRunKey(userId, candidateRunKey),
    ]);
    if (!baseline || !candidate) {
      throw new Error("EVAL_RUN_NOT_FOUND");
    }
    const result = compareQualityBenchmarkRuns({ baseline, candidate });
    await this.repository.saveGate({
      userId,
      baselineRunKey,
      candidateRunKey,
      result,
    });
    return result;
  }
}
