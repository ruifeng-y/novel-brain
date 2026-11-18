import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Pool } from "pg";

import {
  createDatabaseClient,
  createDatabasePool,
  evalCases,
  evalGates,
  evalRuns,
  evalScores,
  withTenantTransaction,
  type DatabaseClient,
} from "@novel-brain/db";
import type {
  QualityBenchmarkDataset,
  QualityBenchmarkReport,
  QualityBenchmarkRun,
  QualityRegressionReport,
  ReleaseQualityRubric,
} from "@novel-brain/quality-benchmark";

@Injectable()
export class EvalRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async saveRun(input: {
    userId: string;
    dataset: QualityBenchmarkDataset;
    rubric: ReleaseQualityRubric;
    run: QualityBenchmarkRun;
    report: QualityBenchmarkReport;
  }): Promise<void> {
    const { userId, dataset, rubric, run, report } = input;
    await withTenantTransaction(this.db, userId, async (transaction) => {
      const existing = await transaction
        .select({ id: evalRuns.id })
        .from(evalRuns)
        .where(and(eq(evalRuns.userId, userId), eq(evalRuns.runKey, run.runId)))
        .limit(1);
      if (existing.length > 0) {
        return;
      }
      if (dataset.manifest.entries.length > 0) {
        await transaction
          .insert(evalCases)
          .values(
            dataset.manifest.entries.map((entry) => ({
              id: uuidv7(),
              datasetSha256: dataset.manifest.datasetSha256,
              datasetVersion: dataset.manifest.datasetVersion,
              caseKey: entry.id,
              kind: entry.kind,
              genre: entry.genre,
              difficulty: entry.difficulty,
              sourceVersion: entry.sourceVersion,
              sourceHash: entry.sourceHash,
              knownIssues: entry.knownIssues as unknown as Array<Record<string, unknown>>,
            })),
          )
          .onConflictDoNothing();
      }
      const evalRunId = uuidv7();
      await transaction.insert(evalRuns).values({
        id: evalRunId,
        userId,
        runKey: run.runId,
        datasetSha256: run.datasetSha256,
        rubricVersion: run.rubricVersion,
        rubricSha256: rubric.sha256,
        status: report.status,
        reportSha256: report.sha256,
        provenance: run.provenance as unknown as Record<string, unknown>,
        report: report as unknown as Record<string, unknown>,
        continuityEvaluation: run.continuityEvaluation as unknown as Record<string, unknown>,
      });
      if (run.scores.length > 0) {
        await transaction.insert(evalScores).values(
          run.scores.map((score) => ({
            id: uuidv7(),
            userId,
            runId: evalRunId,
            sampleId: score.sampleId,
            dimension: score.dimension,
            scorerType: score.scorerType,
            scorerId: score.scorerId,
            value: score.value,
            confidence: score.confidence,
            evidenceQuote: score.evidenceQuote,
          })),
        );
      }
    });
  }

  async reportByRunKey(
    userId: string,
    runKey: string,
  ): Promise<QualityBenchmarkReport | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [row] = await transaction
        .select({ report: evalRuns.report })
        .from(evalRuns)
        .where(and(eq(evalRuns.userId, userId), eq(evalRuns.runKey, runKey)))
        .limit(1);
      return row?.report as unknown as QualityBenchmarkReport | undefined;
    });
  }

  async saveGate(input: {
    userId: string;
    baselineRunKey: string;
    candidateRunKey: string;
    result: QualityRegressionReport;
  }): Promise<void> {
    const { userId, baselineRunKey, candidateRunKey, result } = input;
    await withTenantTransaction(this.db, userId, async (transaction) => {
      const rows = await transaction
        .select({ id: evalRuns.id, runKey: evalRuns.runKey })
        .from(evalRuns)
        .where(eq(evalRuns.userId, userId));
      const baseline = rows.find((row) => row.runKey === baselineRunKey);
      const candidate = rows.find((row) => row.runKey === candidateRunKey);
      if (!baseline || !candidate) {
        throw new Error("EVAL_RUN_NOT_FOUND");
      }
      await transaction
        .insert(evalGates)
        .values({
          id: uuidv7(),
          userId,
          baselineRunId: baseline.id,
          candidateRunId: candidate.id,
          rolloutAllowed: result.rolloutAllowed,
          blockers: [...result.blockers],
          changedProvenance: [...result.changedProvenance],
          p0Baseline: result.p0.baseline,
          p0Candidate: result.p0.candidate,
        })
        .onConflictDoNothing();
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
