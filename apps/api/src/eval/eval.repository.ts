import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import type { Pool } from "pg";

import {
  createDatabaseClient,
  createDatabasePool,
  evalCases,
  evalGates,
  evalReleaseDecisions,
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
  ProviderCanaryDecision,
  ProviderRollbackDecision,
  ReleaseQualityRubric,
} from "@novel-brain/quality-benchmark";
import { createRollbackDecision } from "@novel-brain/quality-benchmark";

export interface StoredReleaseDecision {
  id: string;
  decision: ProviderCanaryDecision | ProviderRollbackDecision;
}

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

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
  }): Promise<QualityBenchmarkReport> {
    const { userId, dataset, rubric, run, report } = input;
    return withTenantTransaction(this.db, userId, async (transaction) => {
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
      const [inserted] = await transaction
        .insert(evalRuns)
        .values({
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
          continuityFindings: run.continuityFindings as unknown as Array<Record<string, unknown>>,
          continuityEvaluation: run.continuityEvaluation as unknown as Record<string, unknown>,
        })
        .onConflictDoNothing({
          target: [evalRuns.userId, evalRuns.runKey],
        })
        .returning({ id: evalRuns.id });
      if (!inserted) {
        const [existing] = await transaction
          .select({ report: evalRuns.report })
          .from(evalRuns)
          .where(and(eq(evalRuns.userId, userId), eq(evalRuns.runKey, run.runId)))
          .limit(1);
        if (!existing) {
          throw new Error("EVAL_RUN_PERSISTENCE_CONFLICT");
        }
        return existing.report as unknown as QualityBenchmarkReport;
      }
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
            evidenceQuotes: [...(score.evidenceQuotes ?? [])],
            reviewerAttestationId: score.reviewerAttestationId ?? null,
            reviewedAt: score.reviewedAt ? new Date(score.reviewedAt) : null,
            blindPacketSha256: score.blindPacketSha256 ?? null,
          })),
        );
      }
      return report;
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
  }): Promise<QualityRegressionReport> {
    const { userId, baselineRunKey, candidateRunKey, result } = input;
    const p0Baseline = result.p0.baseline;
    const p0Candidate = result.p0.candidate;
    if (p0Baseline === null || p0Candidate === null) {
      throw new Error("EVAL_GATE_P0_METRIC_MISSING");
    }
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const rows = await transaction
        .select({ id: evalRuns.id, runKey: evalRuns.runKey })
        .from(evalRuns)
        .where(eq(evalRuns.userId, userId));
      const baseline = rows.find((row) => row.runKey === baselineRunKey);
      const candidate = rows.find((row) => row.runKey === candidateRunKey);
      if (!baseline || !candidate) {
        throw new Error("EVAL_RUN_NOT_FOUND");
      }
      const [inserted] = await transaction
        .insert(evalGates)
        .values({
          id: uuidv7(),
          userId,
          baselineRunId: baseline.id,
          candidateRunId: candidate.id,
          rolloutAllowed: result.rolloutAllowed,
          blockers: [...result.blockers],
          changedProvenance: [...result.changedProvenance],
          p0Baseline,
          p0Candidate,
        })
        .onConflictDoNothing()
        .returning({
          rolloutAllowed: evalGates.rolloutAllowed,
          blockers: evalGates.blockers,
          changedProvenance: evalGates.changedProvenance,
          p0Baseline: evalGates.p0Baseline,
          p0Candidate: evalGates.p0Candidate,
        });
      if (inserted) {
        return gateResult(result, inserted);
      }
      const [existing] = await transaction
        .select({
          rolloutAllowed: evalGates.rolloutAllowed,
          blockers: evalGates.blockers,
          changedProvenance: evalGates.changedProvenance,
          p0Baseline: evalGates.p0Baseline,
          p0Candidate: evalGates.p0Candidate,
        })
        .from(evalGates)
        .where(
          and(
            eq(evalGates.userId, userId),
            eq(evalGates.baselineRunId, baseline.id),
            eq(evalGates.candidateRunId, candidate.id),
          ),
        )
        .for("update")
        .limit(1);
      if (!existing) {
        throw new Error("EVAL_GATE_PERSISTENCE_CONFLICT");
      }
      return gateResult(result, existing);
    });
  }

  async saveReleaseDecision(input: {
    userId: string;
    decision: ProviderCanaryDecision | ProviderRollbackDecision;
  }): Promise<StoredReleaseDecision> {
    const { userId, decision } = input;
    return withTenantTransaction(this.db, userId, (transaction) =>
      this.saveDecisionInTransaction(transaction, userId, decision),
    );
  }

  async releaseDecisionById(
    userId: string,
    decisionId: string,
  ): Promise<StoredReleaseDecision | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [row] = await transaction
        .select({
          id: evalReleaseDecisions.id,
          evidence: evalReleaseDecisions.evidence,
        })
        .from(evalReleaseDecisions)
        .where(
          and(eq(evalReleaseDecisions.userId, userId), eq(evalReleaseDecisions.id, decisionId)),
        )
        .limit(1);
      return row
        ? {
            id: row.id,
            decision: row.evidence as unknown as ProviderCanaryDecision | ProviderRollbackDecision,
          }
        : undefined;
    });
  }

  async rollbackRelease(input: {
    userId: string;
    currentDecisionId: string;
    actorId: string;
    reason: string;
    createdAt: string;
  }): Promise<StoredReleaseDecision> {
    const { userId, currentDecisionId, actorId, reason, createdAt } = input;
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [currentRow] = await transaction
        .select({
          id: evalReleaseDecisions.id,
          evidence: evalReleaseDecisions.evidence,
          createdAt: evalReleaseDecisions.createdAt,
        })
        .from(evalReleaseDecisions)
        .where(
          and(
            eq(evalReleaseDecisions.userId, userId),
            eq(evalReleaseDecisions.id, currentDecisionId),
          ),
        )
        .limit(1);
      if (!currentRow) {
        throw new Error("EVAL_RELEASE_DECISION_NOT_FOUND");
      }
      const current = currentRow.evidence as unknown as
        ProviderCanaryDecision | ProviderRollbackDecision;
      if (current.action !== "canary") {
        throw new Error("EVAL_RELEASE_DECISION_NOT_FOUND");
      }
      const [latest] = await transaction
        .select({ id: evalReleaseDecisions.id })
        .from(evalReleaseDecisions)
        .where(
          and(
            eq(evalReleaseDecisions.userId, userId),
            eq(evalReleaseDecisions.channelKey, current.channelKey),
          ),
        )
        .orderBy(desc(evalReleaseDecisions.createdAt), desc(evalReleaseDecisions.id))
        .for("update")
        .limit(1);
      if (latest?.id !== currentDecisionId) {
        throw new Error("EVAL_RELEASE_DECISION_NOT_ACTIVE");
      }
      const [previousRow] = await transaction
        .select({
          id: evalReleaseDecisions.id,
          evidence: evalReleaseDecisions.evidence,
        })
        .from(evalReleaseDecisions)
        .where(
          and(
            eq(evalReleaseDecisions.userId, userId),
            eq(evalReleaseDecisions.channelKey, current.channelKey),
            inArray(evalReleaseDecisions.status, ["approved", "rolled_back"]),
            or(
              lt(evalReleaseDecisions.createdAt, currentRow.createdAt),
              and(
                eq(evalReleaseDecisions.createdAt, currentRow.createdAt),
                lt(evalReleaseDecisions.id, currentDecisionId),
              ),
            ),
          ),
        )
        .orderBy(desc(evalReleaseDecisions.createdAt), desc(evalReleaseDecisions.id))
        .for("update")
        .limit(1);
      if (!previousRow) {
        throw new Error("EVAL_PREVIOUS_APPROVED_RELEASE_NOT_FOUND");
      }
      const previous = previousRow.evidence as unknown as
        ProviderCanaryDecision | ProviderRollbackDecision;
      if (
        (previous.action !== "canary" && previous.action !== "rollback") ||
        (previous.status !== "approved" && previous.status !== "rolled_back")
      ) {
        throw new Error("EVAL_PREVIOUS_APPROVED_RELEASE_NOT_FOUND");
      }
      const decision = createRollbackDecision({
        current: {
          id: currentRow.id,
          status: current.status,
          channelKey: current.channelKey,
          releaseVersion: current.releaseVersion,
          pin: current.pin,
          limits: current.limits,
          cohort: current.cohort,
        },
        previousApproved: {
          id: previousRow.id,
          status: previous.status,
          channelKey: previous.channelKey,
          releaseVersion: previous.releaseVersion,
          pin: previous.pin,
          limits: previous.limits,
          cohort: previous.cohort,
        },
        actorId,
        reason,
        createdAt,
      });
      const rollbackCreatedAt = new Date(createdAt).getTime();
      if (
        !Number.isFinite(rollbackCreatedAt) ||
        rollbackCreatedAt < currentRow.createdAt.getTime()
      ) {
        throw new Error("EVAL_RELEASE_DECISION_TIME_INVALID");
      }
      return this.saveDecisionInTransaction(transaction, userId, decision);
    });
  }

  async activeRelease(
    userId: string,
    channelKey: string,
  ): Promise<StoredReleaseDecision | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [row] = await transaction
        .select({
          id: evalReleaseDecisions.id,
          evidence: evalReleaseDecisions.evidence,
        })
        .from(evalReleaseDecisions)
        .where(
          and(
            eq(evalReleaseDecisions.userId, userId),
            eq(evalReleaseDecisions.channelKey, channelKey),
            inArray(evalReleaseDecisions.status, ["approved", "rolled_back"]),
          ),
        )
        .orderBy(desc(evalReleaseDecisions.createdAt), desc(evalReleaseDecisions.id))
        .limit(1);
      return row
        ? {
            id: row.id,
            decision: row.evidence as unknown as ProviderCanaryDecision | ProviderRollbackDecision,
          }
        : undefined;
    });
  }

  private async saveDecisionInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    decision: ProviderCanaryDecision | ProviderRollbackDecision,
  ): Promise<StoredReleaseDecision> {
    const [inserted] = await transaction
      .insert(evalReleaseDecisions)
      .values({
        id: uuidv7(),
        userId,
        channelKey: decision.channelKey,
        releaseVersion: decision.releaseVersion,
        action: decision.action,
        status: decision.status,
        decisionSha256: decision.sha256,
        policySha256: decision.action === "canary" ? decision.policySha256 : null,
        cohortSha256: decision.action === "canary" ? decision.cohort.sha256 : null,
        configHash: decision.pin.configHash,
        promptVersion: decision.pin.promptVersion,
        model: decision.pin.model,
        previousDecisionId: decision.action === "rollback" ? decision.previousDecisionId : null,
        rollbackTargetDecisionId:
          decision.action === "rollback" ? decision.rollbackTargetDecisionId : null,
        evidence: decision as unknown as Record<string, unknown>,
        createdAt: new Date(decision.createdAt),
      })
      .onConflictDoNothing({
        target: [evalReleaseDecisions.userId, evalReleaseDecisions.decisionSha256],
      })
      .returning({ id: evalReleaseDecisions.id });
    if (inserted) {
      return { id: inserted.id, decision };
    }
    const [existing] = await transaction
      .select({
        id: evalReleaseDecisions.id,
        evidence: evalReleaseDecisions.evidence,
      })
      .from(evalReleaseDecisions)
      .where(
        and(
          eq(evalReleaseDecisions.userId, userId),
          eq(evalReleaseDecisions.decisionSha256, decision.sha256),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error("EVAL_RELEASE_DECISION_CONFLICT");
    }
    return {
      id: existing.id,
      decision: existing.evidence as unknown as ProviderCanaryDecision | ProviderRollbackDecision,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function gateResult(
  result: QualityRegressionReport,
  stored: {
    rolloutAllowed: boolean;
    blockers: string[];
    changedProvenance: string[];
    p0Baseline: number;
    p0Candidate: number;
  },
): QualityRegressionReport {
  return {
    ...result,
    rolloutAllowed: stored.rolloutAllowed,
    blockers: stored.blockers,
    changedProvenance: stored.changedProvenance as QualityRegressionReport["changedProvenance"],
    p0: {
      baseline: stored.p0Baseline,
      candidate: stored.p0Candidate,
      regressed: stored.p0Candidate > stored.p0Baseline,
    },
  };
}
