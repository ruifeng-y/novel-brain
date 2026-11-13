import { createHash } from "node:crypto";

import {
  AiProviderError,
  M0_COST_PER_TOKEN_CNY,
  type AiGateway,
  type GenerationResult,
} from "@novel-brain/ai";
import type {
  GenerateGoldenThreeJob,
  GoldenThreeCandidateBatchRequest,
  GoldenThreeChapterPinInput,
  GoldenThreeContinuationRequest,
  GoldenThreeContinuationStyleSource,
  GoldenThreeGateBlockerCode,
  GoldenThreeGenerateRequest,
  GoldenThreeGenerationJob,
  GoldenThreeJobCheckpoint,
  GoldenThreeLockRequest,
  GoldenThreeReviewDimension,
  GoldenThreeReviewBatchRequest,
  GoldenThreeStrategy,
  GoldenThreeSelectionRequest,
  GoldenThreeWorkspace,
  ContextPackPreview,
} from "@novel-brain/contracts";
import {
  GENERATE_GOLDEN_THREE_JOB,
  generateGoldenThreeJobSchema,
  goldenThreeContinuationStyleSourceSchema,
  goldenThreeGenerationJobSchema,
  goldenThreeJobCheckpointSchema,
} from "@novel-brain/contracts";
import {
  auditLogs,
  agentRuns,
  chapterVersions,
  chapters,
  costReservations,
  contextPackVersions,
  createDatabaseClient,
  createDatabasePool,
  goldenThreeCandidates,
  goldenThreeLocks,
  goldenThreeReviews,
  jobCheckpoints,
  jobEvents,
  jobStepAttempts,
  jobSteps,
  jobs,
  modelCalls,
  modelConfigs,
  promptVersions,
  styleBaselines,
  versionNodes,
  withTenantTransaction,
  workBranches,
  works,
  usageRecords,
  calculateModelCallCost,
  type DatabaseClient,
  type GoldenThreeChapterPinJson,
} from "@novel-brain/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

const GOLDEN_THREE_TOKEN_BUDGET = 12_000;
const GOLDEN_THREE_MAX_OUTPUT_TOKENS = 1_600;
const GOLDEN_THREE_DEFAULT_MAX_COST_CNY = 0.2;

export const GOLDEN_THREE_CONTEXT_COMPILER = Symbol("GOLDEN_THREE_CONTEXT_COMPILER");

export interface GoldenThreeAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface GoldenThreeJobScope {
  jobId: string;
  workId: string;
  branchId: string;
  chapterId: string;
}

export interface GoldenThreeContextCompiler {
  compile(
    userId: string,
    input: GoldenThreeJobScope,
    tokenBudget: number,
  ): Promise<ContextPackPreview>;
}

export interface GoldenThreeProviderFactory {
  create(config: InferSelectModel<typeof modelConfigs>): AiGateway;
}

interface GoldenThreePreparedCall {
  workId: string;
  branchId: string;
  strategy: GoldenThreeStrategy;
  label: string;
  system: string;
  prompt: string;
  promptHash: string;
  promptVersionId: string;
  agentRunId: string;
  reservationId: string;
  modelCallId: string;
  stepKey: string;
  modelProvider: string;
  model: string;
  configHash: string;
  reservedTokens: number;
  reservedCostCny: number;
  jobId: string;
  contextPackId: string;
  checkpointRevision: number;
  leaseVersion: number;
}

interface GoldenThreeCompletedCall extends GoldenThreePreparedCall {
  result: GenerationResult;
  content: string;
  contentHash: string;
  wordCount: number;
  inputTokens: number;
  outputTokens: number;
  costCny: number;
}

class GoldenThreeLeaseLostError extends Error {}

const goldenThreeGenerationStrategies: Array<{
  strategy: GoldenThreeStrategy;
  label: string;
}> = [
  { strategy: "hook_focus", label: "候选 A · 钩子优先" },
  { strategy: "character_focus", label: "候选 B · 人物优先" },
  { strategy: "world_focus", label: "候选 C · 世界规则优先" },
];

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type GoldenThreeCandidateRecord = InferSelectModel<typeof goldenThreeCandidates>;
export type GoldenThreeReviewRecord = InferSelectModel<typeof goldenThreeReviews>;
export type GoldenThreeLockRecord = InferSelectModel<typeof goldenThreeLocks>;
export type StyleBaselineRecord = InferSelectModel<typeof styleBaselines>;

export interface GoldenThreeContext {
  workId: string;
  branchId: string;
}

export type GoldenThreeWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "candidates_exist" }
  | { kind: "chapters_empty"; chapterNumbers: number[] }
  | { kind: "model_config_missing" }
  | { kind: "model_generation_failed"; message: string; failureClass: string }
  | { kind: "reference_invalid"; message: string }
  | { kind: "evidence_invalid"; message: string }
  | { kind: "version_conflict" }
  | { kind: "candidate_locked" }
  | { kind: "selection_required" }
  | { kind: "continuation_required" }
  | { kind: "review_incomplete"; completed: number }
  | { kind: "review_failed"; failedDimensions: GoldenThreeReviewDimension[] }
  | { kind: "already_locked" }
  | { kind: "generation_in_progress" };

export type GoldenThreeEnqueueResult =
  | {
      kind: "ok";
      job: GoldenThreeGenerationJob;
      worker: GenerateGoldenThreeJob;
      replayed: boolean;
    }
  | { kind: "candidates_exist" }
  | { kind: "chapters_empty"; chapterNumbers: number[] }
  | { kind: "model_config_missing" }
  | { kind: "model_generation_failed"; message: string; failureClass: string }
  | { kind: "generation_in_progress" };

export class GoldenThreeRepository {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor(
    private readonly contextCompiler: GoldenThreeContextCompiler,
    private readonly providerFactory: GoldenThreeProviderFactory,
    private readonly generationStepHook?: (stepKey: string) => void | Promise<void>,
  ) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<GoldenThreeContext | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [context] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async enqueueGeneration(
    userId: string,
    context: GoldenThreeContext,
    idempotencyKey: string,
    input: GoldenThreeGenerateRequest,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeEnqueueResult> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [sameKey] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, "agent_workflow"),
            eq(jobs.goldenThreeGenerationKey, idempotencyKey),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .limit(1);
      if (sameKey) {
        if (sameKey.status === "failed") {
          return {
            kind: "model_generation_failed" as const,
            message: sameKey.errorMessage ?? "黄金三章生成失败",
            failureClass:
              typeof sameKey.checkpoint.failureClass === "string"
                ? sameKey.checkpoint.failureClass
                : "unknown",
          };
        }
        return {
          kind: "ok" as const,
          job: toGoldenThreeGenerationJob(sameKey),
          worker: toGoldenThreeWorkerJob(sameKey),
          replayed: true,
        };
      }

      const [existingCandidate] = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (existingCandidate) {
        return { kind: "candidates_exist" as const };
      }

      const configuredStaleJobMs = Number(process.env.GOLDEN_THREE_STALE_JOB_MS ?? "");
      const staleJobMs =
        Number.isFinite(configuredStaleJobMs) && configuredStaleJobMs >= 60_000
          ? configuredStaleJobMs
          : 15 * 60 * 1_000;
      const staleBefore = new Date(Date.now() - staleJobMs);
      const [active] = await transaction
        .select({ id: jobs.id, startedAt: jobs.startedAt })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, "agent_workflow"),
            inArray(jobs.status, ["queued", "preparing", "running"]),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .limit(1);
      if (active?.startedAt && active.startedAt < staleBefore) {
        await expireStaleGoldenThreeJob(
          transaction,
          userId,
          active.id,
          context.workId,
          context.branchId,
        );
      } else if (active) {
        return { kind: "generation_in_progress" as const };
      }

      const [chapter] = await transaction
        .select({ chapter: chapters, version: chapterVersions })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.number, 1),
          ),
        )
        .limit(1);
      if (!chapter?.version || chapter.version.content.trim().length === 0) {
        return { kind: "chapters_empty" as const, chapterNumbers: [1] };
      }

      const [modelConfig] = await transaction
        .select()
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.userId, userId),
            isNull(modelConfigs.deletedAt),
            sql`${modelConfigs.purposes} @> '["writing"]'::jsonb`,
          ),
        )
        .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt))
        .limit(1);
      if (!modelConfig) {
        return { kind: "model_config_missing" as const };
      }

      const candidateCount = input.candidateCount;
      const maxCostCny = Number(
        process.env.GOLDEN_THREE_MAX_COST_CNY ?? GOLDEN_THREE_DEFAULT_MAX_COST_CNY,
      );
      if (!Number.isFinite(maxCostCny) || maxCostCny <= 0) {
        return {
          kind: "model_generation_failed" as const,
          message: "黄金三章生成预算不足",
          failureClass: "budget",
        };
      }
      const maxTokens =
        (GOLDEN_THREE_TOKEN_BUDGET + GOLDEN_THREE_MAX_OUTPUT_TOKENS) * candidateCount;
      const jobId = uuidv7();
      const batchId = uuidv7();
      const now = new Date();
      const checkpoint: GoldenThreeJobCheckpoint = {
        schemaVersion: 1,
        revision: 0,
        stage: "queued",
        batchId,
        stepKey: null,
        contextPackId: null,
        completedStepKeys: [],
        failureClass: null,
      };
      await transaction.insert(jobs).values({
        id: jobId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        chapterId: chapter.chapter.id,
        modelConfigId: modelConfig.id,
        type: "agent_workflow",
        status: "queued",
        progress: 0,
        currentStep: "preparing",
        idempotencyKey,
        goldenThreeGenerationKey: idempotencyKey,
        budget: { maxTokens, maxCostCny, maxRevisionRounds: 0 },
        checkpoint,
        checkpointVersion: 1,
        orchestration: {
          kind: "golden_three_generation",
          candidateCount,
        },
        goldenThreeLeaseVersion: 1,
        cost: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          costCny: 0,
        },
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(jobEvents).values({
        id: uuidv7(),
        jobId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        sequence: 1,
        eventType: "job.created",
        payload: { candidateCount },
        occurredAt: now,
      });
      await writeAudit(transaction, userId, audit, "golden_three.generation_queued", jobId);
      const [created] = await transaction.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (!created) {
        throw new Error("Golden three queued job could not be reloaded");
      }
      return {
        kind: "ok" as const,
        job: toGoldenThreeGenerationJob(created),
        worker: toGoldenThreeWorkerJob(created),
        replayed: false,
      };
    });
  }

  async generationJob(
    userId: string,
    context: GoldenThreeContext,
    jobId: string,
  ): Promise<GoldenThreeGenerationJob | undefined> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, "agent_workflow"),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .limit(1);
      return job ? toGoldenThreeGenerationJob(job) : undefined;
    });
  }

  async runQueuedGeneration(
    payload: GenerateGoldenThreeJob,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeWriteResult<{ batchId: string }>> {
    const claimed = await withTenantTransaction(this.db, payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, payload.jobId),
            eq(jobs.userId, payload.actorId),
            eq(jobs.workId, payload.workId),
            eq(jobs.branchId, payload.branchId),
            eq(jobs.type, "agent_workflow"),
            eq(jobs.goldenThreeGenerationKey, payload.idempotencyKey),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .for("update")
        .limit(1);
      if (!job) {
        return { kind: "not_found" as const };
      }
      if (job.status === "completed") {
        return {
          kind: "completed" as const,
          batchId:
            typeof job.checkpoint.batchId === "string"
              ? job.checkpoint.batchId
              : payload.checkpoint.batchId,
        };
      }
      if (job.status === "failed" || job.status === "canceled") {
        return {
          kind: "failed" as const,
          message: job.errorMessage ?? "黄金三章生成任务已失败",
          failureClass:
            typeof job.checkpoint.failureClass === "string"
              ? job.checkpoint.failureClass
              : "unknown",
        };
      }
      const now = new Date();
      const durableCheckpoint = parseGoldenThreeCheckpoint(job);
      const checkpoint = goldenThreeJobCheckpointSchema.parse({
        ...durableCheckpoint,
        revision: job.checkpointVersion + 1,
        stage: "preparing",
        failureClass: null,
      });
      await transaction
        .update(jobs)
        .set({
          status: "running",
          progress: Math.max(job.progress, 5),
          currentStep: "preparing",
          checkpoint,
          checkpointVersion: checkpoint.revision,
          goldenThreeLeaseVersion: job.goldenThreeLeaseVersion + 1,
          startedAt: job.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(jobs.id, payload.jobId));
      const [sequence] = await transaction
        .select({ value: sql<number>`coalesce(max(${jobEvents.sequence}), 0)` })
        .from(jobEvents)
        .where(eq(jobEvents.jobId, payload.jobId));
      await transaction.insert(jobEvents).values({
        id: uuidv7(),
        jobId: payload.jobId,
        workId: payload.workId,
        branchId: payload.branchId,
        userId: payload.actorId,
        sequence: Number(sequence?.value ?? 0) + 1,
        eventType: "job.preparing",
        payload: { candidateCount: payload.candidateCount },
        occurredAt: now,
      });
      return { kind: "claimed" as const };
    });
    if (claimed.kind === "not_found") {
      return claimed;
    }
    if (claimed.kind === "completed") {
      return { kind: "ok", value: { batchId: claimed.batchId } };
    }
    if (claimed.kind === "failed") {
      return {
        kind: "model_generation_failed",
        message: claimed.message,
        failureClass: claimed.failureClass,
      };
    }
    return this.generateCandidates(
      payload.actorId,
      { workId: payload.workId, branchId: payload.branchId },
      payload.idempotencyKey,
      { candidateCount: payload.candidateCount },
      audit,
      payload.jobId,
    );
  }

  async workspace(userId: string, context: GoldenThreeContext): Promise<GoldenThreeWorkspace> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      const candidateRows = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .orderBy(asc(goldenThreeCandidates.createdAt), asc(goldenThreeCandidates.label));
      const candidateIds = candidateRows.map((candidate) => candidate.id);
      const reviewRows =
        candidateIds.length === 0
          ? []
          : await transaction
              .select()
              .from(goldenThreeReviews)
              .where(inArray(goldenThreeReviews.candidateId, candidateIds))
              .orderBy(asc(goldenThreeReviews.createdAt));
      const [activeGenerationJob] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, "agent_workflow"),
            inArray(jobs.status, ["queued", "preparing", "running"]),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .orderBy(desc(jobs.createdAt))
        .limit(1);
      const [lockRecord] = await transaction
        .select()
        .from(goldenThreeLocks)
        .where(
          and(
            eq(goldenThreeLocks.userId, userId),
            eq(goldenThreeLocks.workId, context.workId),
            eq(goldenThreeLocks.branchId, context.branchId),
          ),
        )
        .limit(1);
      const [styleRecord] = lockRecord
        ? await transaction
            .select()
            .from(styleBaselines)
            .where(eq(styleBaselines.id, lockRecord.styleBaselineId))
            .limit(1)
        : [undefined];
      const reviewsByCandidate = new Map<string, GoldenThreeReviewRecord[]>();
      for (const review of reviewRows) {
        const group = reviewsByCandidate.get(review.candidateId) ?? [];
        group.push(review);
        reviewsByCandidate.set(review.candidateId, group);
      }
      const continuationByCandidate = await readLatestContinuations(
        transaction,
        userId,
        context,
        candidateRows.map((candidate) => candidate.id),
      );

      const candidates = candidateRows.map((candidate) => {
        const reviews = reviewsByCandidate.get(candidate.id) ?? [];
        const failedDimensions = reviews
          .filter((review) => review.required && review.score < 4)
          .map((review) => review.dimension as GoldenThreeReviewDimension);
        return {
          id: candidate.id,
          batchId: candidate.batchId,
          workId: candidate.workId,
          branchId: candidate.branchId,
          label: candidate.label,
          strategy: candidate.strategy as "hook_focus" | "character_focus" | "world_focus",
          status: candidate.status as "draft" | "reviewed" | "selected" | "locked",
          version: candidate.version,
          prompt: {
            key: candidate.promptKey,
            version: candidate.promptVersion,
            hash: candidate.promptHash,
          },
          model: {
            provider: candidate.modelProvider,
            model: candidate.model,
            parameters: candidate.modelParameters,
          },
          context: {
            packVersionId: candidate.contextPackVersionId,
            manifestHash: candidate.contextManifestHash,
          },
          pins: candidate.chapterPins,
          continuation: continuationByCandidate.get(candidate.id) ?? null,
          trace:
            candidate.generationJobId && candidate.agentRunId && candidate.modelCallId
              ? {
                  jobId: candidate.generationJobId,
                  agentRunId: candidate.agentRunId,
                  modelCallId: candidate.modelCallId,
                }
              : null,
          reviews: reviews.map((review) => ({
            id: review.id,
            candidateId: review.candidateId,
            dimension: review.dimension as GoldenThreeReviewDimension,
            score: review.score,
            evidence: {
              chapterId: review.evidenceChapterId,
              chapterVersionId: review.evidenceChapterVersionId,
              passage: review.evidencePassage,
              locator: review.evidenceLocator,
            },
            reviewerOrigin: review.reviewerOrigin as "model" | "author" | "critic",
            required: review.required,
            passed: review.score >= 4,
            createdAt: review.createdAt.toISOString(),
            updatedAt: review.updatedAt.toISOString(),
          })),
          reviewSummary: {
            completed: reviews.length,
            total: 6 as const,
            requiredFailed: failedDimensions.length,
            failedDimensions,
          },
          createdAt: candidate.createdAt.toISOString(),
          updatedAt: candidate.updatedAt.toISOString(),
        };
      });

      const selectedCandidateId =
        candidates.find((candidate) => candidate.status === "selected")?.id ??
        candidates.find((candidate) => candidate.status === "locked")?.id ??
        null;
      let gateCandidateId = selectedCandidateId;
      if (lockRecord) {
        gateCandidateId = lockRecord.candidateId;
      }
      const selectedCandidate =
        candidates.find((candidate) => candidate.id === gateCandidateId) ?? null;
      const blockers: Array<{
        code: GoldenThreeGateBlockerCode;
        message: string;
        dimension: GoldenThreeReviewDimension | null;
      }> = [];
      if (lockRecord) {
        blockers.push({
          code: "CANDIDATE_LOCKED",
          message: "黄金三章已经锁定，后续修改需要另开创作线。",
          dimension: null,
        });
      } else if (candidates.length === 0) {
        blockers.push({
          code: "NO_CANDIDATES",
          message: "还没有可比较的黄金三章候选。",
          dimension: null,
        });
      } else if (!selectedCandidate) {
        blockers.push({
          code: "NO_SELECTION",
          message: "请先选定一个候选方向。",
          dimension: null,
        });
      } else if (selectedCandidate.reviewSummary.completed < 6) {
        blockers.push({
          code: "REVIEW_INCOMPLETE",
          message: "六维评审尚未完成。",
          dimension: null,
        });
      } else {
        for (const dimension of selectedCandidate.reviewSummary.failedDimensions) {
          blockers.push({
            code: "REQUIRED_DIMENSION_FAILED",
            message: "必需评审维度未达到 4/5。",
            dimension,
          });
        }
        if (!selectedCandidate.continuation) {
          blockers.push({
            code: "CONTINUATION_REQUIRED",
            message: "选定方向后还需要生成或登记第 2、3 章续写。",
            dimension: null,
          });
        }
      }

      return {
        workId: context.workId,
        branchId: context.branchId,
        candidates,
        selectedCandidateId,
        activeGenerationJob: activeGenerationJob
          ? toGoldenThreeGenerationJob(activeGenerationJob)
          : null,
        lock: lockRecord
          ? {
              id: lockRecord.id,
              workId: lockRecord.workId,
              branchId: lockRecord.branchId,
              candidateId: lockRecord.candidateId,
              versionNodeId: lockRecord.versionNodeId,
              styleBaselineId: lockRecord.styleBaselineId,
              chapterPins: lockRecord.chapterPins,
              override:
                lockRecord.overridePolicy && lockRecord.overrideRationale
                  ? {
                      policy: "author_override_v1" as const,
                      rationale: lockRecord.overrideRationale,
                    }
                  : null,
              lockedBy: lockRecord.lockedBy,
              lockedAt: lockRecord.createdAt.toISOString(),
            }
          : null,
        styleBaseline: styleRecord
          ? {
              id: styleRecord.id,
              workId: styleRecord.workId,
              branchId: styleRecord.branchId,
              sourceType: "golden_three" as const,
              sourceId: styleRecord.sourceId,
              version: styleRecord.version,
              versionNodeId: styleRecord.versionNodeId,
              profile: styleRecord.profile as NonNullable<
                GoldenThreeWorkspace["styleBaseline"]
              >["profile"],
              createdAt: styleRecord.createdAt.toISOString(),
            }
          : null,
        gate: {
          candidateId: gateCandidateId,
          canLock: !lockRecord && blockers.length === 0,
          blockers,
          failedDimensions: selectedCandidate?.reviewSummary.failedDimensions ?? [],
        },
      };
    });
  }

  async createCandidates(
    userId: string,
    context: GoldenThreeContext,
    idempotencyKey: string,
    input: GoldenThreeCandidateBatchRequest,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeWriteResult<{ batchId: string }>> {
    const configuredStaleJobMs = Number(process.env.GOLDEN_THREE_STALE_JOB_MS ?? "");
    const staleJobMs =
      Number.isFinite(configuredStaleJobMs) && configuredStaleJobMs >= 60_000
        ? configuredStaleJobMs
        : 15 * 60 * 1_000;
    const staleBefore = new Date(Date.now() - (Number.isFinite(staleJobMs) ? staleJobMs : 0));
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [activeGeneration] = await transaction
        .select({ id: jobs.id, startedAt: jobs.startedAt })
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, "agent_workflow"),
            inArray(jobs.status, ["queued", "preparing", "running"]),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .limit(1);
      if (activeGeneration?.startedAt && activeGeneration.startedAt < staleBefore) {
        await expireStaleGoldenThreeJob(
          transaction,
          userId,
          activeGeneration.id,
          context.workId,
          context.branchId,
        );
      } else if (activeGeneration) {
        return { kind: "generation_in_progress" as const };
      }
      const existingForKey = await transaction
        .select({ batchId: goldenThreeCandidates.batchId })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
            eq(goldenThreeCandidates.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existingForKey[0]) {
        return { kind: "ok", value: { batchId: existingForKey[0].batchId } };
      }
      const [existingCandidate] = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (existingCandidate) {
        return { kind: "candidates_exist" as const };
      }

      const pinsByVersionId = await resolvePins(
        transaction,
        userId,
        context,
        input.candidates.flatMap((candidate) => candidate.pins),
      );
      if (!pinsByVersionId.ok) {
        return { kind: "reference_invalid", message: pinsByVersionId.message };
      }
      const contextPackIds = input.candidates.flatMap((candidate) =>
        candidate.context.packVersionId ? [candidate.context.packVersionId] : [],
      );
      if (contextPackIds.length > 0) {
        const packs = await transaction
          .select({ id: contextPackVersions.id })
          .from(contextPackVersions)
          .where(
            and(
              inArray(contextPackVersions.id, contextPackIds),
              eq(contextPackVersions.userId, userId),
              eq(contextPackVersions.workId, context.workId),
              eq(contextPackVersions.branchId, context.branchId),
            ),
          );
        if (packs.length !== new Set(contextPackIds).size) {
          return {
            kind: "reference_invalid",
            message: "候选引用的上下文快照不存在或不属于当前创作线",
          };
        }
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const batchId = uuidv7();
      const now = new Date();
      const candidateIds: string[] = [];
      for (const candidate of input.candidates) {
        const pins = candidate.pins
          .map((pin) => {
            const resolved = pinsByVersionId.byVersionId.get(pin.chapterVersionId);
            if (!resolved) {
              return null;
            }
            return resolved satisfies GoldenThreeChapterPinJson;
          })
          .filter((pin): pin is GoldenThreeChapterPinJson => pin !== null)
          .sort((left, right) => left.chapterNumber - right.chapterNumber);
        if (pins.length !== 1 || pins[0]?.chapterNumber !== 1) {
          return {
            kind: "reference_invalid",
            message: "黄金三章候选只能固定第 1 章；第 2、3 章在作者选定后登记",
          };
        }
        const id = uuidv7();
        candidateIds.push(id);
        await transaction.insert(goldenThreeCandidates).values({
          id,
          batchId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          idempotencyKey,
          label: candidate.label,
          strategy: candidate.strategy,
          status: "draft",
          version: 1,
          promptKey: candidate.prompt.key,
          promptVersion: candidate.prompt.version,
          promptHash: candidate.prompt.hash,
          modelProvider: candidate.model.provider,
          model: candidate.model.model,
          modelParameters: candidate.model.parameters,
          contextPackVersionId: candidate.context.packVersionId,
          contextManifestHash: candidate.context.manifestHash,
          chapterPins: pins,
          createdAt: now,
          updatedAt: now,
        });
      }
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_candidate_batch",
        objectId: batchId,
        objectVersion: 1,
        payload: { action: "golden_three.candidates_created", candidateIds },
        actorId: userId,
        message: "创建黄金三章候选",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "golden_three.candidates_created",
        targetType: "golden_three_batch",
        targetId: batchId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { kind: "ok", value: { batchId } };
    });
  }

  async generateCandidates(
    userId: string,
    context: GoldenThreeContext,
    idempotencyKey: string,
    input: GoldenThreeGenerateRequest,
    audit: GoldenThreeAuditContext,
    resumeJobId?: string,
  ): Promise<GoldenThreeWriteResult<{ batchId: string }>> {
    const strategies = goldenThreeGenerationStrategies.slice(0, input.candidateCount);
    const configuredStaleJobMs = Number(process.env.GOLDEN_THREE_STALE_JOB_MS ?? "");
    const staleJobMs =
      Number.isFinite(configuredStaleJobMs) && configuredStaleJobMs >= 60_000
        ? configuredStaleJobMs
        : 15 * 60 * 1_000;
    const staleBefore = new Date(Date.now() - (Number.isFinite(staleJobMs) ? staleJobMs : 0));
    const resumeJob = resumeJobId
      ? await withTenantTransaction(this.db, userId, async (transaction) => {
          const [job] = await transaction
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.id, resumeJobId),
                eq(jobs.userId, userId),
                eq(jobs.workId, context.workId),
                eq(jobs.branchId, context.branchId),
                eq(jobs.goldenThreeGenerationKey, idempotencyKey),
                sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
              ),
            )
            .limit(1);
          return job;
        })
      : undefined;
    if (resumeJobId && !resumeJob) {
      return { kind: "not_found" };
    }
    const resumeCheckpoint = resumeJob ? parseGoldenThreeCheckpoint(resumeJob) : undefined;
    const existingRun =
      resumeJobId !== undefined
        ? ({ kind: "none" } as const)
        : await withTenantTransaction(this.db, userId, async (transaction) => {
            await lockBranch(transaction, context.branchId);
            const [sameKey] = await transaction
              .select({
                id: jobs.id,
                status: jobs.status,
                checkpoint: jobs.checkpoint,
                startedAt: jobs.startedAt,
              })
              .from(jobs)
              .where(
                and(
                  eq(jobs.userId, userId),
                  eq(jobs.workId, context.workId),
                  eq(jobs.branchId, context.branchId),
                  eq(jobs.type, "agent_workflow"),
                  eq(jobs.goldenThreeGenerationKey, idempotencyKey),
                  sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
                ),
              )
              .limit(1);
            if (sameKey) {
              return { kind: "same_key" as const, job: sameKey };
            }
            const [active] = await transaction
              .select({ id: jobs.id, startedAt: jobs.startedAt })
              .from(jobs)
              .where(
                and(
                  eq(jobs.userId, userId),
                  eq(jobs.workId, context.workId),
                  eq(jobs.branchId, context.branchId),
                  eq(jobs.type, "agent_workflow"),
                  inArray(jobs.status, ["queued", "preparing", "running"]),
                  sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
                ),
              )
              .limit(1);
            if (active?.startedAt && active.startedAt < staleBefore) {
              await expireStaleGoldenThreeJob(
                transaction,
                userId,
                active.id,
                context.workId,
                context.branchId,
              );
              return { kind: "none" as const };
            }
            return active ? { kind: "in_progress" as const } : { kind: "none" as const };
          });
    if (existingRun.kind === "in_progress") {
      return { kind: "generation_in_progress" };
    }
    if (existingRun.kind === "same_key") {
      if (
        ["queued", "preparing", "running"].includes(existingRun.job.status) &&
        existingRun.job.startedAt &&
        existingRun.job.startedAt < staleBefore
      ) {
        await withTenantTransaction(this.db, userId, async (transaction) => {
          await expireStaleGoldenThreeJob(
            transaction,
            userId,
            existingRun.job.id,
            context.workId,
            context.branchId,
          );
        });
        return {
          kind: "model_generation_failed",
          message: "上一次黄金三章生成已超时",
          failureClass: "timeout",
        };
      }
      if (existingRun.job.status === "completed") {
        const batchId =
          typeof existingRun.job.checkpoint.batchId === "string"
            ? existingRun.job.checkpoint.batchId
            : undefined;
        if (batchId) {
          return { kind: "ok", value: { batchId } };
        }
      }
      if (existingRun.job.status === "failed") {
        return {
          kind: "model_generation_failed",
          message: "作者模型生成失败",
          failureClass:
            typeof existingRun.job.checkpoint.failureClass === "string"
              ? existingRun.job.checkpoint.failureClass
              : "unknown",
        };
      }
      return { kind: "generation_in_progress" };
    }
    const preflight = await withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existingCandidate] = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (existingCandidate) {
        return { kind: "candidates_exist" as const };
      }
      const [chapter] = await transaction
        .select({ chapter: chapters, version: chapterVersions })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.number, 1),
          ),
        )
        .limit(1);
      if (!chapter?.version || chapter.version.content.trim().length === 0) {
        return { kind: "chapters_empty" as const, chapterNumbers: [1] };
      }
      const resumeModelConfigId = resumeJob?.modelConfigId;
      const [modelConfig] = resumeModelConfigId
        ? await transaction
            .select()
            .from(modelConfigs)
            .where(
              and(
                eq(modelConfigs.id, resumeModelConfigId),
                eq(modelConfigs.userId, userId),
                isNull(modelConfigs.deletedAt),
              ),
            )
            .limit(1)
        : await transaction
            .select()
            .from(modelConfigs)
            .where(
              and(
                eq(modelConfigs.userId, userId),
                isNull(modelConfigs.deletedAt),
                sql`${modelConfigs.purposes} @> '["writing"]'::jsonb`,
              ),
            )
            .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt))
            .limit(1);
      if (!modelConfig) {
        return { kind: "model_config_missing" as const };
      }
      const [versionRow] = await transaction
        .select({ maxVersion: sql<number>`coalesce(max(${chapterVersions.version}), 0)` })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, chapter.chapter.id));
      return {
        kind: "ok" as const,
        replay: false,
        batchId: resumeCheckpoint?.batchId ?? uuidv7(),
        chapter: chapter.chapter,
        chapterVersion: chapter.version,
        modelConfig,
        nextVersion: Number(versionRow?.maxVersion ?? 0) + 1,
      };
    });
    if (preflight.kind !== "ok") {
      return preflight;
    }
    if (preflight.replay) {
      return { kind: "ok", value: { batchId: preflight.batchId } };
    }
    const payload = preflight as {
      chapter: InferSelectModel<typeof chapters>;
      modelConfig: InferSelectModel<typeof modelConfigs>;
      nextVersion: number;
    };
    const chapter = payload.chapter;
    const modelConfig = payload.modelConfig;
    const nextVersion = payload.nextVersion;
    const batchId = preflight.batchId;
    const jobId = resumeJobId ?? uuidv7();
    const contextPackId = resumeCheckpoint?.contextPackId ?? uuidv7();
    const maxCostCny = Number(
      process.env.GOLDEN_THREE_MAX_COST_CNY ?? GOLDEN_THREE_DEFAULT_MAX_COST_CNY,
    );
    if (!Number.isFinite(maxCostCny) || maxCostCny <= 0) {
      await withTenantTransaction(this.db, userId, async (transaction) => {
        await recordGoldenThreeInitializationFailure(transaction, {
          userId,
          workId: context.workId,
          branchId: context.branchId,
          chapterId: chapter.id,
          modelConfigId: modelConfig.id,
          jobId,
          idempotencyKey,
          maxTokens: GOLDEN_THREE_MAX_OUTPUT_TOKENS * strategies.length,
          maxCostCny: Number.isFinite(maxCostCny) ? maxCostCny : 0,
          candidateCount: strategies.length,
          failureClass: "budget",
          message: "黄金三章生成预算不足",
          contextPackId,
        });
      });
      return {
        kind: "model_generation_failed",
        message: "黄金三章生成预算不足",
        failureClass: "budget",
      };
    }
    let contextPack: ContextPackPreview;
    try {
      contextPack = await this.contextCompiler.compile(
        userId,
        {
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          chapterId: chapter.id,
        },
        GOLDEN_THREE_TOKEN_BUDGET,
      );
    } catch {
      await withTenantTransaction(this.db, userId, async (transaction) => {
        await recordGoldenThreeInitializationFailure(transaction, {
          userId,
          workId: context.workId,
          branchId: context.branchId,
          chapterId: chapter.id,
          modelConfigId: modelConfig.id,
          jobId,
          idempotencyKey,
          maxTokens: GOLDEN_THREE_MAX_OUTPUT_TOKENS * strategies.length,
          maxCostCny,
          candidateCount: strategies.length,
          failureClass: "unknown",
          message: "黄金三章上下文编译失败",
          contextPackId,
        });
      });
      return {
        kind: "model_generation_failed",
        message: "黄金三章上下文编译失败",
        failureClass: "unknown",
      };
    }
    const contextManifestHash = contextPack.manifestHash ?? hashValue(JSON.stringify(contextPack));
    const maxOutputTokens = GOLDEN_THREE_MAX_OUTPUT_TOKENS * strategies.length;
    const maxInputTokens = contextPack.tokenUsed * strategies.length;
    const maxTokens = maxInputTokens + maxOutputTokens;
    const estimatedCostCny = calculateModelCallCost(maxTokens, M0_COST_PER_TOKEN_CNY);
    if (estimatedCostCny > maxCostCny) {
      await withTenantTransaction(this.db, userId, async (transaction) => {
        await recordGoldenThreeInitializationFailure(transaction, {
          userId,
          workId: context.workId,
          branchId: context.branchId,
          chapterId: chapter.id,
          modelConfigId: modelConfig.id,
          jobId,
          idempotencyKey,
          maxTokens,
          maxCostCny,
          candidateCount: strategies.length,
          failureClass: "budget",
          message: "黄金三章生成预算不足",
          contextPackId,
          contextPack,
          contextManifestHash,
        });
      });
      return {
        kind: "model_generation_failed",
        message: "黄金三章生成预算不足",
        failureClass: "budget",
      };
    }
    const modelProvider =
      process.env.MODEL_CONNECTION_TESTER === "fake" ? "fake" : modelConfig.provider;
    const configHash = hashValue(
      `${modelProvider}\u0000${modelConfig.model}\u0000${modelConfig.baseUrl}\u0000${modelConfig.version}`,
    );
    const promptPlans = strategies.map((strategy) => {
      const system = goldenThreeSystemPrompt(strategy.strategy);
      const prompt = goldenThreeUserPrompt(strategy.strategy, chapter, contextPack);
      return {
        strategy: strategy.strategy,
        label: strategy.label,
        system,
        prompt,
        promptHash: hashValue(`${system}\n${prompt}`),
        inputHash: hashValue(prompt),
        systemHash: hashValue(system),
      };
    });
    let provider: AiGateway;
    try {
      provider = this.providerFactory.create(modelConfig);
    } catch (error) {
      const failureClass = goldenThreeFailureClass(error, "provider");
      await withTenantTransaction(this.db, userId, async (transaction) => {
        await recordGoldenThreeInitializationFailure(transaction, {
          userId,
          workId: context.workId,
          branchId: context.branchId,
          chapterId: chapter.id,
          modelConfigId: modelConfig.id,
          jobId,
          idempotencyKey,
          maxTokens,
          maxCostCny,
          candidateCount: strategies.length,
          failureClass,
          message: "作者模型初始化失败",
          contextPackId,
          contextPack,
          contextManifestHash,
        });
      });
      return {
        kind: "model_generation_failed",
        message: "作者模型初始化失败",
        failureClass,
      };
    }
    const prepared = await withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existingCandidate] = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (existingCandidate) {
        return { kind: "candidates_exist" as const };
      }
      let prepareCheckpointRevision = 1;
      const [existingJob] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, "agent_workflow"),
            eq(jobs.goldenThreeGenerationKey, idempotencyKey),
            sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
          ),
        )
        .limit(1);
      if (existingJob) {
        const resumable =
          existingJob.id === resumeJobId &&
          ["queued", "preparing", "running"].includes(existingJob.status);
        if (!resumable) {
          if (existingJob.status === "failed") {
            return {
              kind: "model_generation_failed" as const,
              message: "同一幂等键的生成任务已存在",
              failureClass:
                typeof existingJob.checkpoint.failureClass === "string"
                  ? existingJob.checkpoint.failureClass
                  : "unknown",
            };
          }
          return { kind: "generation_in_progress" as const };
        }
        const now = new Date();
        prepareCheckpointRevision = existingJob.checkpointVersion + 1;
        await transaction
          .update(jobs)
          .set({
            status: "running",
            progress: Math.max(existingJob.progress, 5),
            currentStep: "generating_candidates",
            budget: { maxTokens, maxCostCny, maxRevisionRounds: 0 },
            checkpoint: {
              schemaVersion: 1,
              revision: prepareCheckpointRevision,
              stage: "generating_candidates",
              batchId,
              stepKey: "prepare",
              contextPackId,
              completedStepKeys: resumeCheckpoint?.completedStepKeys ?? [],
              failureClass: null,
            },
            checkpointVersion: prepareCheckpointRevision,
            startedAt: existingJob.startedAt ?? now,
            updatedAt: now,
          })
          .where(eq(jobs.id, existingJob.id));
      } else {
        const [activeJob] = await transaction
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.userId, userId),
              eq(jobs.workId, context.workId),
              eq(jobs.branchId, context.branchId),
              eq(jobs.type, "agent_workflow"),
              inArray(jobs.status, ["queued", "preparing", "running"]),
              sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
            ),
          )
          .limit(1);
        if (activeJob) {
          return { kind: "generation_in_progress" as const };
        }
        const now = new Date();
        await transaction.insert(jobs).values({
          id: jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          chapterId: chapter.id,
          modelConfigId: modelConfig.id,
          type: "agent_workflow",
          status: "running",
          progress: 5,
          currentStep: "generating_candidates",
          idempotencyKey,
          goldenThreeGenerationKey: idempotencyKey,
          budget: { maxTokens, maxCostCny, maxRevisionRounds: 0 },
          checkpoint: {
            schemaVersion: 1,
            revision: 1,
            stage: "generating_candidates",
            batchId,
            stepKey: "prepare",
            contextPackId,
            completedStepKeys: [],
            failureClass: null,
          },
          checkpointVersion: 1,
          orchestration: { kind: "golden_three_generation", candidateCount: strategies.length },
          goldenThreeLeaseVersion: 1,
          cost: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            costCny: 0,
          },
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      const now = new Date();
      await transaction
        .insert(contextPackVersions)
        .values({
          id: contextPackId,
          jobId,
          chapterId: chapter.id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          version: 1,
          compilerVersion: contextPack.compilerVersion,
          tokenBudget: contextPack.tokenBudget,
          tokenUsed: contextPack.tokenUsed,
          selected: contextPack.selected,
          evicted: contextPack.evicted,
          sourceRefs: contextPack.sourceRefs,
          snapshot: { ...contextPack, manifestHash: contextManifestHash },
          createdAt: now,
        })
        .onConflictDoNothing();
      await transaction.insert(jobCheckpoints).values({
        id: uuidv7(),
        jobId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        stepKey: "prepare",
        schemaVersion: 1,
        revision: prepareCheckpointRevision,
        attempt: 0,
        outputRefs: [],
        payload: {
          contextPackId,
          manifestHash: contextManifestHash,
          candidateCount: strategies.length,
        },
        createdAt: now,
      });
      const [eventSequence] = await transaction
        .select({ value: sql<number>`coalesce(max(${jobEvents.sequence}), 0)` })
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId));
      await transaction.insert(jobEvents).values({
        id: uuidv7(),
        jobId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        sequence: Number(eventSequence?.value ?? 0) + 1,
        eventType: existingJob ? "job.resumed" : "job.created",
        payload: { contextPackId, candidateCount: strategies.length },
        occurredAt: now,
      });
      const calls: GoldenThreePreparedCall[] = [];
      const completed: GoldenThreeCompletedCall[] = [];
      const leaseVersion = existingJob?.goldenThreeLeaseVersion ?? 1;
      const checkpointBase = prepareCheckpointRevision;
      for (const [planIndex, plan] of promptPlans.entries()) {
        const stepKey = `golden_three.candidate.${plan.strategy}`;
        const [existingStep] = await transaction
          .select()
          .from(jobSteps)
          .where(
            and(
              eq(jobSteps.jobId, jobId),
              eq(jobSteps.userId, userId),
              eq(jobSteps.workId, context.workId),
              eq(jobSteps.branchId, context.branchId),
              eq(jobSteps.stepKey, stepKey),
            ),
          )
          .limit(1);
        if (existingStep?.status === "succeeded") {
          const modelCallId =
            typeof existingStep.output.modelCallId === "string"
              ? existingStep.output.modelCallId
              : undefined;
          const [savedCall] = modelCallId
            ? await transaction
                .select()
                .from(modelCalls)
                .where(
                  and(
                    eq(modelCalls.id, modelCallId),
                    eq(modelCalls.userId, userId),
                    eq(modelCalls.jobId, jobId),
                  ),
                )
                .limit(1)
            : [];
          const [savedRun] = savedCall
            ? await transaction
                .select()
                .from(agentRuns)
                .where(
                  and(
                    eq(agentRuns.id, savedCall.agentRunId),
                    eq(agentRuns.userId, userId),
                    eq(agentRuns.jobId, jobId),
                  ),
                )
                .limit(1)
            : [];
          if (
            !savedCall ||
            !savedRun ||
            savedRun.status !== "succeeded" ||
            typeof savedRun.output !== "string" ||
            savedRun.output.trim().length === 0
          ) {
            return {
              kind: "model_generation_failed" as const,
              message: "黄金三章检查点缺少可恢复的候选正文",
              failureClass: "schema",
            };
          }
          const content = savedRun.output.trim();
          completed.push({
            workId: context.workId,
            branchId: context.branchId,
            strategy: plan.strategy,
            label: plan.label,
            system: plan.system,
            prompt: plan.prompt,
            promptHash: plan.promptHash,
            promptVersionId: savedCall.promptVersionId,
            agentRunId: savedCall.agentRunId,
            reservationId: savedCall.costReservationId,
            modelCallId: savedCall.id,
            stepKey,
            modelProvider: savedCall.provider,
            model: savedCall.model,
            configHash: savedCall.configHash,
            reservedTokens: savedCall.inputTokens + savedCall.outputTokens,
            reservedCostCny: savedCall.costCny,
            jobId,
            contextPackId,
            checkpointRevision: checkpointBase + planIndex + 1,
            leaseVersion,
            result: {
              text: content,
              model: savedCall.model,
              usage: {
                inputTokens: savedCall.inputTokens,
                outputTokens: savedCall.outputTokens,
              },
              finishReason: "stop",
              ...(savedCall.providerRequestId
                ? { providerRequestId: savedCall.providerRequestId }
                : {}),
            },
            content,
            contentHash: savedCall.outputHash ?? hashValue(content),
            wordCount: countWords(content),
            inputTokens: savedCall.inputTokens,
            outputTokens: savedCall.outputTokens,
            costCny: savedCall.costCny,
          });
          continue;
        }
        if (existingStep) {
          const staleCalls = await transaction
            .select()
            .from(modelCalls)
            .where(
              and(
                eq(modelCalls.jobId, jobId),
                eq(modelCalls.userId, userId),
                eq(modelCalls.stepKey, stepKey),
              ),
            );
          for (const stale of staleCalls) {
            await transaction.delete(modelCalls).where(eq(modelCalls.id, stale.id));
            await transaction.delete(agentRuns).where(eq(agentRuns.id, stale.agentRunId));
            await transaction
              .delete(costReservations)
              .where(eq(costReservations.id, stale.costReservationId));
            await transaction
              .delete(promptVersions)
              .where(eq(promptVersions.id, stale.promptVersionId));
          }
          await transaction
            .delete(jobStepAttempts)
            .where(and(eq(jobStepAttempts.jobId, jobId), eq(jobStepAttempts.stepKey, stepKey)));
          await transaction
            .delete(jobSteps)
            .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stepKey, stepKey)));
        }
        const promptVersionId = uuidv7();
        const agentRunId = uuidv7();
        const reservationId = uuidv7();
        const modelCallId = uuidv7();
        const reservedTokens = contextPack.tokenUsed + GOLDEN_THREE_MAX_OUTPUT_TOKENS;
        const reservedCostCny = calculateModelCallCost(reservedTokens, M0_COST_PER_TOKEN_CNY);
        await transaction.insert(jobSteps).values({
          id: uuidv7(),
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          stepKey,
          status: "pending",
          attempt: 0,
          inputHash: plan.inputHash,
          createdAt: now,
        });
        await transaction.insert(jobStepAttempts).values({
          id: uuidv7(),
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          stepKey,
          attempt: 1,
          status: "pending",
          inputHash: plan.inputHash,
          checkpointRevision: 1,
          startedAt: now,
          createdAt: now,
        });
        await transaction.insert(promptVersions).values({
          id: promptVersionId,
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          stepKey,
          key: "golden-three-opening",
          version: 1,
          role: "writer",
          promptHash: plan.promptHash,
          systemHash: plan.systemHash,
          inputHash: plan.inputHash,
          contextPackId,
          compilerVersion: contextPack.compilerVersion,
          createdBy: userId,
          createdAt: now,
        });
        await transaction.insert(agentRuns).values({
          id: agentRunId,
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          chapterId: chapter.id,
          promptVersionId,
          modelConfigId: modelConfig.id,
          stepKey,
          role: "writer",
          status: "running",
          provider: modelProvider,
          model: modelConfig.model,
          inputHash: plan.inputHash,
          inputSummary: {
            strategy: plan.strategy,
            promptKey: "golden-three-opening",
            promptVersion: 1,
            contextManifestHash,
          },
          startedAt: now,
        });
        await transaction.insert(costReservations).values({
          id: reservationId,
          userId,
          workId: context.workId,
          branchId: context.branchId,
          jobId,
          agentRunId,
          idempotencyKey: stepKey,
          status: "reserved",
          reservedTokens,
          reservedCostCny,
          createdAt: now,
        });
        await transaction.insert(modelCalls).values({
          id: modelCallId,
          userId,
          workId: context.workId,
          branchId: context.branchId,
          chapterId: chapter.id,
          jobId,
          agentRunId,
          promptVersionId,
          costReservationId: reservationId,
          stepKey,
          attempt: 1,
          status: "started",
          provider: modelProvider,
          model: modelConfig.model,
          parameters: {
            strategy: plan.strategy,
            maxTokens: GOLDEN_THREE_MAX_OUTPUT_TOKENS,
          },
          configHash,
          inputHash: plan.inputHash,
          inputSummary: {
            promptKey: "golden-three-opening",
            promptVersion: 1,
            contextManifestHash,
          },
          startedAt: now,
          createdAt: now,
        });
        calls.push({
          workId: context.workId,
          branchId: context.branchId,
          strategy: plan.strategy,
          label: plan.label,
          system: plan.system,
          prompt: plan.prompt,
          promptHash: plan.promptHash,
          promptVersionId,
          agentRunId,
          reservationId,
          modelCallId,
          stepKey,
          modelProvider,
          model: modelConfig.model,
          configHash,
          reservedTokens,
          reservedCostCny,
          jobId,
          contextPackId,
          checkpointRevision: checkpointBase + planIndex + 1,
          leaseVersion,
        });
      }
      return { kind: "ok" as const, calls, completed };
    });
    if (prepared.kind !== "ok") {
      return prepared;
    }
    const firstCall = prepared.calls[0] ?? prepared.completed[0];
    if (!firstCall) {
      return {
        kind: "model_generation_failed",
        message: "黄金三章生成任务未准备完成",
        failureClass: "unknown",
      };
    }
    const completed: GoldenThreeCompletedCall[] = [...prepared.completed];
    for (const call of prepared.calls) {
      let result: GenerationResult;
      try {
        const leaseActive = await withTenantTransaction(this.db, userId, async (transaction) => {
          if (!(await goldenThreeLeaseActive(transaction, userId, call))) {
            return false;
          }
          await transaction
            .update(jobSteps)
            .set({
              status: "running",
              attempt: 1,
              startedAt: new Date(),
            })
            .where(
              and(
                eq(jobSteps.jobId, call.jobId),
                eq(jobSteps.userId, userId),
                eq(jobSteps.workId, call.workId),
                eq(jobSteps.branchId, call.branchId),
                eq(jobSteps.stepKey, call.stepKey),
              ),
            );
          await transaction
            .update(jobStepAttempts)
            .set({
              status: "running",
              startedAt: new Date(),
            })
            .where(
              and(
                eq(jobStepAttempts.jobId, call.jobId),
                eq(jobStepAttempts.userId, userId),
                eq(jobStepAttempts.workId, call.workId),
                eq(jobStepAttempts.branchId, call.branchId),
                eq(jobStepAttempts.stepKey, call.stepKey),
                eq(jobStepAttempts.attempt, 1),
              ),
            );
          return true;
        });
        if (!leaseActive) {
          return { kind: "generation_in_progress" };
        }
        result = await provider.generateText({
          model: modelConfig.model,
          system: call.system,
          prompt: call.prompt,
          operation: "draft",
          maxTokens: GOLDEN_THREE_MAX_OUTPUT_TOKENS,
        });
      } catch (error) {
        const failureClass = goldenThreeFailureClass(error, "unknown");
        await withTenantTransaction(this.db, userId, async (transaction) => {
          await recordGoldenThreeCallFailure(transaction, userId, call, failureClass, completed);
        });
        return {
          kind: "model_generation_failed",
          message: "作者模型调用失败",
          failureClass,
        };
      }
      const content = result.text.trim();
      if (content.length === 0) {
        const leaseLost = await withTenantTransaction(this.db, userId, async (transaction) =>
          recordGoldenThreeResultFailure(
            transaction,
            userId,
            call,
            completed,
            "schema",
            result,
            content,
          ),
        );
        if (leaseLost) {
          return { kind: "generation_in_progress" };
        }
        return {
          kind: "model_generation_failed",
          message: "作者模型返回空正文",
          failureClass: "schema",
        };
      }
      const actualTokens = result.usage.inputTokens + result.usage.outputTokens;
      const actualCostCny = calculateModelCallCost(actualTokens, M0_COST_PER_TOKEN_CNY);
      if (actualTokens > call.reservedTokens || actualCostCny > call.reservedCostCny) {
        const leaseLost = await withTenantTransaction(this.db, userId, async (transaction) =>
          recordGoldenThreeResultFailure(
            transaction,
            userId,
            call,
            completed,
            "budget",
            result,
            content,
          ),
        );
        if (leaseLost) {
          return { kind: "generation_in_progress" };
        }
        return {
          kind: "model_generation_failed",
          message: "作者模型实际用量超过预留预算",
          failureClass: "budget",
        };
      }
      try {
        completed.push(
          await withTenantTransaction(this.db, userId, async (transaction) =>
            recordGoldenThreeCallSuccess(transaction, userId, call, result, content),
          ),
        );
      } catch (error) {
        if (error instanceof GoldenThreeLeaseLostError) {
          await withTenantTransaction(this.db, userId, async (transaction) => {
            await recordGoldenThreeLeaseLostUsage(transaction, userId, call, result, content);
          });
          return { kind: "generation_in_progress" };
        }
        await withTenantTransaction(this.db, userId, async (transaction) => {
          await recordGoldenThreeCallFailure(
            transaction,
            userId,
            call,
            "unknown",
            completed,
            result,
          );
        });
        return {
          kind: "model_generation_failed",
          message: "生成结果保存失败，请重试",
          failureClass: "unknown",
        };
      }
      await this.generationStepHook?.(call.stepKey);
    }

    try {
      return await withTenantTransaction(this.db, userId, async (transaction) => {
        await lockBranch(transaction, context.branchId);
        if (!(await goldenThreeLeaseActive(transaction, userId, firstCall))) {
          return { kind: "generation_in_progress" as const };
        }
        const [existingCandidate] = await transaction
          .select({ id: goldenThreeCandidates.id })
          .from(goldenThreeCandidates)
          .where(
            and(
              eq(goldenThreeCandidates.userId, userId),
              eq(goldenThreeCandidates.workId, context.workId),
              eq(goldenThreeCandidates.branchId, context.branchId),
            ),
          )
          .limit(1);
        if (existingCandidate) {
          await recordGoldenThreePostCallFailure(
            transaction,
            userId,
            firstCall,
            completed,
            "policy",
          );
          return {
            kind: "model_generation_failed",
            message: "生成期间已创建其他黄金三章候选",
            failureClass: "policy",
          };
        }
        const now = new Date();
        const totalInputTokens = completed.reduce((sum, entry) => sum + entry.inputTokens, 0);
        const totalOutputTokens = completed.reduce((sum, entry) => sum + entry.outputTokens, 0);
        const totalTokens = totalInputTokens + totalOutputTokens;
        const totalCostCny = calculateModelCallCost(totalTokens, M0_COST_PER_TOKEN_CNY);
        let headNodeId = await requireBranchHead(transaction, userId, context);
        let versionNumber = nextVersion;
        const candidateIds: string[] = [];
        for (const entry of completed) {
          const { content, contentHash, wordCount } = entry;
          const versionId = uuidv7();
          const versionNodeId = uuidv7();
          await transaction.insert(versionNodes).values({
            id: versionNodeId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            parentNodeId: headNodeId,
            nodeType: "chapter_version",
            objectType: "chapter",
            objectId: chapter.id,
            objectVersion: versionNumber,
            payload: {
              contentHash,
              wordCount,
              source: "golden_three_model_generation",
              strategy: entry.strategy,
              candidateBatchId: batchId,
              generationJobId: jobId,
            },
            actorId: userId,
            message: "生成第 1 章黄金三章候选",
            createdAt: now,
          });
          await transaction.insert(chapterVersions).values({
            id: versionId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            chapterId: chapter.id,
            version: versionNumber,
            content,
            contentHash,
            versionNodeId,
            source: "golden_three_model_generation",
            createdAt: now,
          });
          headNodeId = versionNodeId;
          const pin: GoldenThreeChapterPinJson = {
            chapterId: chapter.id,
            chapterNumber: chapter.number,
            chapterTitle: chapter.title,
            chapterVersionId: versionId,
            chapterVersion: versionNumber,
            versionNodeId,
            contentHash,
            wordCount,
            content,
          };
          versionNumber += 1;
          const candidateId = uuidv7();
          candidateIds.push(candidateId);
          await transaction.insert(goldenThreeCandidates).values({
            id: candidateId,
            batchId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            idempotencyKey,
            label: entry.label,
            strategy: entry.strategy,
            status: "draft",
            version: 1,
            promptKey: "golden-three-opening",
            promptVersion: 1,
            promptHash: entry.promptHash,
            modelProvider: entry.modelProvider,
            model: entry.result.model,
            modelParameters: {
              strategy: entry.strategy,
              maxTokens: GOLDEN_THREE_MAX_OUTPUT_TOKENS,
            },
            contextPackVersionId: contextPackId,
            contextManifestHash,
            chapterPins: [pin],
            generationJobId: jobId,
            agentRunId: entry.agentRunId,
            modelCallId: entry.modelCallId,
            createdAt: now,
            updatedAt: now,
          });
        }
        const batchNodeId = uuidv7();
        await transaction.insert(versionNodes).values({
          id: batchNodeId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          parentNodeId: headNodeId,
          nodeType: "outline_version",
          objectType: "golden_three_candidate_batch",
          objectId: batchId,
          objectVersion: 1,
          payload: {
            action: "golden_three.candidates_generated",
            candidateIds,
            jobId,
            contextPackId,
            modelCallCount: candidateIds.length,
          },
          actorId: userId,
          message: "生成黄金三章候选",
          createdAt: now,
        });
        await advanceBranchHead(transaction, context, batchNodeId, now);
        const completedStepKeys = [...new Set(completed.map((entry) => entry.stepKey))];
        const checkpointRevision =
          Math.max(0, ...completed.map((entry) => entry.checkpointRevision)) + 1;
        await transaction
          .update(jobs)
          .set({
            status: "completed",
            progress: 100,
            currentStep: "completed",
            checkpoint: {
              schemaVersion: 1,
              revision: checkpointRevision,
              stage: "completed",
              batchId,
              stepKey: "commit",
              contextPackId,
              completedStepKeys,
              failureClass: null,
            },
            checkpointVersion: checkpointRevision,
            cost: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              totalTokens,
              costCny: totalCostCny,
            },
            finishedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(jobs.id, jobId),
              eq(jobs.userId, userId),
              eq(jobs.workId, context.workId),
              eq(jobs.branchId, context.branchId),
            ),
          );
        await transaction.insert(jobCheckpoints).values({
          id: uuidv7(),
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          stepKey: "completed",
          schemaVersion: 1,
          revision: checkpointRevision,
          attempt: 1,
          outputRefs: completed.map((entry) => ({
            type: "model_call",
            id: entry.modelCallId,
          })),
          payload: {
            contextPackId,
            batchId,
            candidateIds,
            stage: "completed",
          },
          createdAt: now,
        });
        const completedSequence = await nextGoldenThreeJobEventSequence(transaction, jobId);
        await transaction.insert(jobEvents).values({
          id: uuidv7(),
          jobId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          sequence: completedSequence,
          eventType: "job.completed",
          payload: { batchId, candidateIds, contextPackId },
          occurredAt: now,
        });
        await writeAudit(transaction, userId, audit, "golden_three.candidates_generated", batchId);
        return { kind: "ok", value: { batchId } };
      });
    } catch {
      const leaseActive = await withTenantTransaction(this.db, userId, async (transaction) =>
        goldenThreeLeaseActive(transaction, userId, firstCall),
      );
      if (!leaseActive) {
        return { kind: "generation_in_progress" };
      }
      await withTenantTransaction(this.db, userId, async (transaction) => {
        await recordGoldenThreePostCallFailure(
          transaction,
          userId,
          firstCall,
          completed,
          "unknown",
        );
      });
      return {
        kind: "model_generation_failed",
        message: "生成结果提交失败，请重试",
        failureClass: "unknown",
      };
    }
  }
  async submitReviews(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeReviewBatchRequest,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      for (const review of input.reviews) {
        const pin = candidate.chapterPins.find(
          (entry) =>
            entry.chapterId === review.evidence.chapterId &&
            entry.chapterVersionId === review.evidence.chapterVersionId,
        );
        if (!pin || !pin.content.includes(review.evidence.passage)) {
          return {
            kind: "evidence_invalid",
            message: "评审证据必须来自候选固定的章节版本原文",
          };
        }
      }
      const now = new Date();
      for (const review of input.reviews) {
        await transaction
          .insert(goldenThreeReviews)
          .values({
            id: uuidv7(),
            candidateId: candidate.id,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            dimension: review.dimension,
            score: review.score,
            evidenceChapterId: review.evidence.chapterId,
            evidenceChapterVersionId: review.evidence.chapterVersionId,
            evidencePassage: review.evidence.passage,
            evidenceLocator: review.evidence.locator,
            reviewerOrigin: review.reviewerOrigin,
            required: true,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [goldenThreeReviews.candidateId, goldenThreeReviews.dimension],
            set: {
              score: review.score,
              evidenceChapterId: review.evidence.chapterId,
              evidenceChapterVersionId: review.evidence.chapterVersionId,
              evidencePassage: review.evidence.passage,
              evidenceLocator: review.evidence.locator,
              reviewerOrigin: review.reviewerOrigin,
              required: true,
              updatedAt: now,
            },
          });
      }
      const [updated] = await transaction
        .update(goldenThreeCandidates)
        .set({
          status: candidate.status === "selected" ? "selected" : "reviewed",
          version: candidate.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(goldenThreeCandidates.id, candidate.id),
            eq(goldenThreeCandidates.version, candidate.version),
          ),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_review",
        objectId: candidate.id,
        objectVersion: updated.version,
        payload: {
          action: "golden_three.reviews_recorded",
          candidateId: candidate.id,
          dimensions: input.reviews.map((review) => review.dimension),
        },
        actorId: userId,
        message: "提交黄金三章六维评审",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.reviews_recorded", candidate.id);
      return { kind: "ok", value: { candidateId: candidate.id } };
    });
  }

  async selectCandidate(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeSelectionRequest,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      const selectedCandidates = await transaction
        .select({ id: goldenThreeCandidates.id })
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
            eq(goldenThreeCandidates.status, "selected"),
          ),
        );
      const now = new Date();
      for (const previous of selectedCandidates) {
        if (previous.id === candidate.id) {
          continue;
        }
        const [count] = await transaction
          .select({ value: sql<number>`count(*)::int` })
          .from(goldenThreeReviews)
          .where(eq(goldenThreeReviews.candidateId, previous.id));
        await transaction
          .update(goldenThreeCandidates)
          .set({
            status: Number(count?.value ?? 0) >= 6 ? "reviewed" : "draft",
            updatedAt: now,
          })
          .where(eq(goldenThreeCandidates.id, previous.id));
      }
      const [updated] = await transaction
        .update(goldenThreeCandidates)
        .set({
          status: "selected",
          version: candidate.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(goldenThreeCandidates.id, candidate.id),
            eq(goldenThreeCandidates.version, candidate.version),
          ),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_candidate",
        objectId: candidate.id,
        objectVersion: updated.version,
        payload: { action: "golden_three.candidate_selected", candidateId: candidate.id },
        actorId: userId,
        message: "作者选定黄金三章候选",
        createdAt: now,
      });
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.candidate_selected", candidate.id);
      return { kind: "ok", value: { candidateId: candidate.id } };
    });
  }

  async recordContinuation(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeContinuationRequest,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string; versionNodeId: string }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (candidate.status !== "selected") {
        return { kind: "selection_required" };
      }

      let requestedPins = input.pins;
      if (!requestedPins) {
        const rows = await transaction
          .select({ chapter: chapters, version: chapterVersions })
          .from(chapters)
          .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
          .where(
            and(
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
              inArray(chapters.number, [2, 3]),
            ),
          );
        const missing = [2, 3].filter((number) => {
          const row = rows.find((candidateRow) => candidateRow.chapter.number === number);
          return !row?.version || row.version.content.trim().length === 0;
        });
        if (missing.length > 0) {
          return { kind: "chapters_empty", chapterNumbers: missing };
        }
        requestedPins = rows
          .sort((left, right) => left.chapter.number - right.chapter.number)
          .map((row) => ({
            chapterId: row.chapter.id,
            chapterVersionId: row.version!.id,
            expectedContentHash: row.version!.contentHash,
          }));
      }

      const resolved = await resolvePins(transaction, userId, context, requestedPins);
      if (!resolved.ok) {
        return { kind: "reference_invalid", message: resolved.message };
      }
      const pins = requestedPins
        .map((pin) => resolved.byVersionId.get(pin.chapterVersionId))
        .filter((pin): pin is GoldenThreeChapterPinJson => Boolean(pin))
        .sort((left, right) => left.chapterNumber - right.chapterNumber);
      if (pins.length !== 2 || pins.map((pin) => pin.chapterNumber).join(",") !== "2,3") {
        return {
          kind: "reference_invalid",
          message: "黄金三章续写必须登记第 2、3 章",
        };
      }
      const [selectionNode] = await transaction
        .select({ id: versionNodes.id })
        .from(versionNodes)
        .where(
          and(
            eq(versionNodes.userId, userId),
            eq(versionNodes.workId, context.workId),
            eq(versionNodes.branchId, context.branchId),
            eq(versionNodes.objectType, "golden_three_candidate"),
            eq(versionNodes.objectId, candidate.id),
            sql`${versionNodes.payload}->>'action' = 'golden_three.candidate_selected'`,
          ),
        )
        .orderBy(desc(versionNodes.createdAt))
        .limit(1);
      const sourcePin = candidate.chapterPins[0];
      if (!selectionNode || !sourcePin) {
        return { kind: "selection_required" };
      }
      const styleSource: GoldenThreeContinuationStyleSource = {
        candidateId: candidate.id,
        selectionVersionNodeId: selectionNode.id,
        strategy: candidate.strategy as GoldenThreeStrategy,
        candidateLabel: candidate.label,
        chapterId: sourcePin.chapterId,
        chapterNumber: sourcePin.chapterNumber,
        chapterVersionId: sourcePin.chapterVersionId,
        chapterVersionNodeId: sourcePin.versionNodeId,
        chapterTitle: sourcePin.chapterTitle,
        contentHash: sourcePin.contentHash,
        excerpt: sourcePin.content.slice(0, 600),
      };

      const now = new Date();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "outline_version",
        objectType: "golden_three_continuation",
        objectId: candidate.id,
        objectVersion: candidate.version + 1,
        payload: {
          action: "golden_three.continuation_recorded",
          candidateId: candidate.id,
          pins,
          styleSource,
        },
        actorId: userId,
        message: "登记黄金三章第 2、3 章续写",
        createdAt: now,
      });
      const [updated] = await transaction
        .update(goldenThreeCandidates)
        .set({ version: candidate.version + 1, updatedAt: now })
        .where(
          and(
            eq(goldenThreeCandidates.id, candidate.id),
            eq(goldenThreeCandidates.version, candidate.version),
          ),
        )
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(
        transaction,
        userId,
        audit,
        "golden_three.continuation_recorded",
        candidate.id,
      );
      return { kind: "ok", value: { candidateId: candidate.id, versionNodeId } };
    });
  }

  async lockCandidate(
    userId: string,
    context: GoldenThreeContext,
    candidateId: string,
    input: GoldenThreeLockRequest,
    audit: GoldenThreeAuditContext,
  ): Promise<GoldenThreeWriteResult<{ candidateId: string; alreadyLocked: boolean }>> {
    return withTenantTransaction(this.db, userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existingLock] = await transaction
        .select()
        .from(goldenThreeLocks)
        .where(
          and(
            eq(goldenThreeLocks.userId, userId),
            eq(goldenThreeLocks.workId, context.workId),
            eq(goldenThreeLocks.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (existingLock) {
        if (existingLock.candidateId !== candidateId) {
          return { kind: "already_locked" };
        }
        return {
          kind: "ok",
          value: { candidateId: existingLock.candidateId, alreadyLocked: true },
        };
      }
      const [candidate] = await transaction
        .select()
        .from(goldenThreeCandidates)
        .where(
          and(
            eq(goldenThreeCandidates.id, candidateId),
            eq(goldenThreeCandidates.userId, userId),
            eq(goldenThreeCandidates.workId, context.workId),
            eq(goldenThreeCandidates.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!candidate) {
        return { kind: "not_found" };
      }
      if (candidate.status === "locked") {
        return { kind: "candidate_locked" };
      }
      if (candidate.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (candidate.status !== "selected") {
        return { kind: "selection_required" };
      }
      const reviews = await transaction
        .select()
        .from(goldenThreeReviews)
        .where(eq(goldenThreeReviews.candidateId, candidate.id))
        .orderBy(asc(goldenThreeReviews.dimension));
      if (reviews.length < 6) {
        return { kind: "review_incomplete", completed: reviews.length };
      }
      const failedDimensions = reviews
        .filter((review) => review.required && review.score < 4)
        .map((review) => review.dimension as GoldenThreeReviewDimension);
      if (failedDimensions.length > 0 && !input.override) {
        return { kind: "review_failed", failedDimensions };
      }
      const continuation = (
        await readLatestContinuations(transaction, userId, context, [candidate.id])
      ).get(candidate.id);
      if (!continuation) {
        return { kind: "continuation_required" };
      }
      const chapterPins = [...candidate.chapterPins, ...continuation.pins];
      const resolvedPins = await resolvePins(
        transaction,
        userId,
        context,
        chapterPins.map((pin) => ({
          chapterId: pin.chapterId,
          chapterVersionId: pin.chapterVersionId,
          expectedContentHash: pin.contentHash,
        })),
      );
      if (!resolvedPins.ok) {
        return { kind: "reference_invalid", message: resolvedPins.message };
      }
      const pins = chapterPins
        .map((pin) => resolvedPins.byVersionId.get(pin.chapterVersionId))
        .filter((pin): pin is GoldenThreeChapterPinJson => Boolean(pin))
        .sort((left, right) => left.chapterNumber - right.chapterNumber);
      if (pins.length !== 3 || pins.map((pin) => pin.chapterNumber).join(",") !== "1,2,3") {
        return { kind: "reference_invalid", message: "候选固定的章节版本已失效" };
      }

      const now = new Date();
      const lockId = uuidv7();
      const styleBaselineId = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        parentNodeId: headNodeId,
        nodeType: "snapshot",
        objectType: "golden_three_lock",
        objectId: lockId,
        objectVersion: 1,
        payload: {
          action: "golden_three.locked",
          candidateId: candidate.id,
          styleBaselineId,
          chapterVersionIds: pins.map((pin) => pin.chapterVersionId),
          override: input.override ?? null,
          failedDimensions,
        },
        actorId: userId,
        message: "锁定黄金三章",
        createdAt: now,
      });
      await transaction.insert(styleBaselines).values({
        id: styleBaselineId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        sourceType: "golden_three",
        sourceId: lockId,
        version: 1,
        profile: {
          strategy: candidate.strategy,
          candidateLabel: candidate.label,
          excerpts: pins.map((pin) => ({
            chapterId: pin.chapterId,
            chapterVersionId: pin.chapterVersionId,
            excerpt: pin.content.slice(0, 600),
          })),
        },
        versionNodeId,
        createdBy: userId,
        createdAt: now,
      });
      await transaction.insert(goldenThreeLocks).values({
        id: lockId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        candidateId: candidate.id,
        versionNodeId,
        styleBaselineId,
        chapterPins: pins,
        reviewSnapshot: reviews.map((review) => ({
          dimension: review.dimension,
          score: review.score,
          evidenceChapterId: review.evidenceChapterId,
          evidenceChapterVersionId: review.evidenceChapterVersionId,
          evidencePassage: review.evidencePassage,
          evidenceLocator: review.evidenceLocator,
          reviewerOrigin: review.reviewerOrigin,
          required: review.required,
          passed: review.score >= 4,
        })),
        overridePolicy: input.override?.policy ?? null,
        overrideRationale: input.override?.rationale ?? null,
        lockedBy: userId,
        createdAt: now,
      });
      for (const pin of pins) {
        await transaction
          .update(chapters)
          .set({
            status: "locked",
            currentVersionId: pin.chapterVersionId,
            wordCount: pin.wordCount,
            version: sql`${chapters.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(chapters.id, pin.chapterId),
              eq(chapters.userId, userId),
              eq(chapters.workId, context.workId),
              eq(chapters.branchId, context.branchId),
            ),
          );
      }
      await transaction
        .update(goldenThreeCandidates)
        .set({ status: "locked", version: candidate.version + 1, updatedAt: now })
        .where(eq(goldenThreeCandidates.id, candidate.id));
      await advanceBranchHead(transaction, context, versionNodeId, now);
      await writeAudit(transaction, userId, audit, "golden_three.locked", lockId);
      return { kind: "ok", value: { candidateId: candidate.id, alreadyLocked: false } };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

async function recordGoldenThreeInitializationFailure(
  transaction: DatabaseTransaction,
  input: {
    userId: string;
    workId: string;
    branchId: string;
    chapterId: string;
    modelConfigId: string;
    jobId: string;
    idempotencyKey: string;
    maxTokens: number;
    maxCostCny: number;
    candidateCount: number;
    failureClass: string;
    message: string;
    contextPackId: string;
    contextPack?: ContextPackPreview;
    contextManifestHash?: string;
  },
): Promise<void> {
  await lockBranch(transaction, input.branchId);
  const [existing] = await transaction
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, input.userId),
        eq(jobs.workId, input.workId),
        eq(jobs.branchId, input.branchId),
        eq(jobs.type, "agent_workflow"),
        eq(jobs.goldenThreeGenerationKey, input.idempotencyKey),
        sql`${jobs.orchestration}->>'kind' = 'golden_three_generation'`,
      ),
    )
    .limit(1);
  if (existing) {
    const now = new Date();
    await transaction
      .update(jobs)
      .set({
        status: "failed",
        progress: 0,
        currentStep: "failed",
        checkpoint: {
          schemaVersion: 1,
          revision: 1,
          stage: "failed",
          batchId: uuidv7(),
          stepKey: "failed",
          contextPackId: input.contextPack ? input.contextPackId : null,
          completedStepKeys: [],
          failureClass: input.failureClass,
        },
        checkpointVersion: 1,
        errorCode: "GOLDEN_THREE_GENERATION_FAILED",
        errorMessage: input.message,
        finishedAt: now,
        updatedAt: now,
      })
      .where(eq(jobs.id, existing.id));
    const [sequence] = await transaction
      .select({ value: sql<number>`coalesce(max(${jobEvents.sequence}), 0)` })
      .from(jobEvents)
      .where(eq(jobEvents.jobId, existing.id));
    await transaction.insert(jobEvents).values({
      id: uuidv7(),
      jobId: existing.id,
      workId: input.workId,
      branchId: input.branchId,
      userId: input.userId,
      sequence: Number(sequence?.value ?? 0) + 1,
      eventType: "job.failed",
      payload: { failureClass: input.failureClass },
      occurredAt: now,
    });
    return;
  }
  const now = new Date();
  await transaction.insert(jobs).values({
    id: input.jobId,
    workId: input.workId,
    branchId: input.branchId,
    userId: input.userId,
    chapterId: input.chapterId,
    modelConfigId: input.modelConfigId,
    type: "agent_workflow",
    status: "failed",
    progress: 0,
    currentStep: "failed",
    idempotencyKey: input.idempotencyKey,
    goldenThreeGenerationKey: input.idempotencyKey,
    budget: {
      maxTokens: input.maxTokens,
      maxCostCny: input.maxCostCny,
      maxRevisionRounds: 0,
    },
    checkpoint: {
      contextPackId: input.contextPack ? input.contextPackId : null,
      stage: "failed",
      failureClass: input.failureClass,
    },
    checkpointVersion: 1,
    orchestration: {
      kind: "golden_three_generation",
      candidateCount: input.candidateCount,
    },
    goldenThreeLeaseVersion: 1,
    cost: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costCny: 0,
    },
    errorCode: "GOLDEN_THREE_GENERATION_FAILED",
    errorMessage: input.message,
    startedAt: now,
    finishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  if (input.contextPack) {
    await transaction
      .insert(contextPackVersions)
      .values({
        id: input.contextPackId,
        jobId: input.jobId,
        chapterId: input.chapterId,
        workId: input.workId,
        branchId: input.branchId,
        userId: input.userId,
        version: 1,
        compilerVersion: input.contextPack.compilerVersion,
        tokenBudget: input.contextPack.tokenBudget,
        tokenUsed: input.contextPack.tokenUsed,
        selected: input.contextPack.selected,
        evicted: input.contextPack.evicted,
        sourceRefs: input.contextPack.sourceRefs,
        snapshot: {
          ...input.contextPack,
          manifestHash: input.contextManifestHash,
        },
        createdAt: now,
      })
      .onConflictDoNothing();
  }
  const [checkpointRevisionRow] = await transaction
    .select({ revision: sql<number>`coalesce(max(${jobCheckpoints.revision}), 0)::int` })
    .from(jobCheckpoints)
    .where(eq(jobCheckpoints.jobId, input.jobId));
  await transaction.insert(jobCheckpoints).values({
    id: uuidv7(),
    jobId: input.jobId,
    workId: input.workId,
    branchId: input.branchId,
    userId: input.userId,
    stepKey: "failed",
    schemaVersion: 1,
    revision: Number(checkpointRevisionRow?.revision ?? 0) + 1,
    attempt: 0,
    outputRefs: [],
    payload: {
      contextPackId: input.contextPack ? input.contextPackId : null,
      failureClass: input.failureClass,
      stage: "failed",
    },
    errorCode: "GOLDEN_THREE_GENERATION_FAILED",
    errorMessage: input.message,
    createdAt: now,
  });
  const sequence = await nextGoldenThreeJobEventSequence(transaction, input.jobId);
  await transaction.insert(jobEvents).values({
    id: uuidv7(),
    jobId: input.jobId,
    workId: input.workId,
    branchId: input.branchId,
    userId: input.userId,
    sequence,
    eventType: "job.failed",
    payload: { failureClass: input.failureClass },
    occurredAt: now,
  });
}

async function goldenThreeLeaseActive(
  transaction: DatabaseTransaction,
  userId: string,
  call: GoldenThreePreparedCall,
): Promise<boolean> {
  const [job] = await transaction
    .select({
      status: jobs.status,
      leaseVersion: jobs.goldenThreeLeaseVersion,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, call.jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, call.workId),
        eq(jobs.branchId, call.branchId),
      ),
    )
    .for("update")
    .limit(1);
  return job?.status === "running" && job.leaseVersion === call.leaseVersion;
}

async function recordGoldenThreeCallSuccess(
  transaction: DatabaseTransaction,
  userId: string,
  call: GoldenThreePreparedCall,
  result: GenerationResult,
  content: string,
): Promise<GoldenThreeCompletedCall> {
  if (!(await goldenThreeLeaseActive(transaction, userId, call))) {
    throw new GoldenThreeLeaseLostError("Golden three generation lease was lost");
  }
  const now = new Date();
  const contentHash = hashValue(content);
  const wordCount = countWords(content);
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  const costCny = calculateModelCallCost(inputTokens + outputTokens, M0_COST_PER_TOKEN_CNY);
  const [jobRow] = await transaction
    .select({ checkpoint: jobs.checkpoint, checkpointVersion: jobs.checkpointVersion })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, call.jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, call.workId),
        eq(jobs.branchId, call.branchId),
      ),
    )
    .limit(1);
  const previousCheckpoint = goldenThreeJobCheckpointSchema.safeParse(jobRow?.checkpoint);
  const completedStepKeys = [
    ...new Set([
      ...(previousCheckpoint.success ? previousCheckpoint.data.completedStepKeys : []),
      call.stepKey,
    ]),
  ];
  await transaction
    .update(modelCalls)
    .set({
      status: "succeeded",
      provider: call.modelProvider,
      model: result.model,
      outputHash: contentHash,
      outputSummary: { contentHash, wordCount },
      inputTokens,
      outputTokens,
      costCny,
      providerRequestId: result.providerRequestId ?? null,
      finishedAt: now,
    })
    .where(
      and(
        eq(modelCalls.id, call.modelCallId),
        eq(modelCalls.userId, userId),
        eq(modelCalls.workId, call.workId),
        eq(modelCalls.branchId, call.branchId),
        eq(modelCalls.jobId, call.jobId),
      ),
    );
  await transaction
    .update(agentRuns)
    .set({
      status: "succeeded",
      provider: call.modelProvider,
      model: result.model,
      outputHash: contentHash,
      output: content,
      outputSummary: { contentHash, wordCount },
      usage: { inputTokens, outputTokens, costCny },
      finishedAt: now,
    })
    .where(
      and(
        eq(agentRuns.id, call.agentRunId),
        eq(agentRuns.userId, userId),
        eq(agentRuns.workId, call.workId),
        eq(agentRuns.branchId, call.branchId),
        eq(agentRuns.jobId, call.jobId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({
      status: "settled",
      settledTokens: inputTokens + outputTokens,
      settledCostCny: costCny,
      settledAt: now,
    })
    .where(
      and(
        eq(costReservations.id, call.reservationId),
        eq(costReservations.userId, userId),
        eq(costReservations.workId, call.workId),
        eq(costReservations.branchId, call.branchId),
        eq(costReservations.jobId, call.jobId),
      ),
    );
  await transaction
    .update(jobSteps)
    .set({
      status: "succeeded",
      attempt: 1,
      output: { modelCallId: call.modelCallId, contentHash, wordCount },
      outputRefs: [{ type: "model_call", id: call.modelCallId }],
      cost: { inputTokens, outputTokens, costCny },
      finishedAt: now,
    })
    .where(
      and(
        eq(jobSteps.jobId, call.jobId),
        eq(jobSteps.userId, userId),
        eq(jobSteps.workId, call.workId),
        eq(jobSteps.branchId, call.branchId),
        eq(jobSteps.stepKey, call.stepKey),
      ),
    );
  await transaction
    .update(jobStepAttempts)
    .set({
      status: "succeeded",
      outputRefs: [{ type: "model_call", id: call.modelCallId }],
      checkpointRevision: call.checkpointRevision,
      finishedAt: now,
    })
    .where(
      and(
        eq(jobStepAttempts.jobId, call.jobId),
        eq(jobStepAttempts.userId, userId),
        eq(jobStepAttempts.workId, call.workId),
        eq(jobStepAttempts.branchId, call.branchId),
        eq(jobStepAttempts.stepKey, call.stepKey),
        eq(jobStepAttempts.attempt, 1),
      ),
    );
  await transaction.insert(jobCheckpoints).values({
    id: uuidv7(),
    jobId: call.jobId,
    workId: call.workId,
    branchId: call.branchId,
    userId,
    stepKey: call.stepKey,
    schemaVersion: 1,
    revision: call.checkpointRevision,
    attempt: 1,
    inputHash: call.promptHash,
    outputRefs: [{ type: "model_call", id: call.modelCallId }],
    payload: {
      contextPackId: call.contextPackId,
      stepKey: call.stepKey,
      modelCallId: call.modelCallId,
      contentHash,
      wordCount,
      stage: "model_step_completed",
    },
    createdAt: now,
  });
  await transaction
    .update(jobs)
    .set({
      currentStep: call.stepKey,
      checkpointVersion: call.checkpointRevision,
      checkpoint: {
        schemaVersion: 1,
        revision: call.checkpointRevision,
        stage: "generating_candidates",
        batchId: previousCheckpoint.success ? previousCheckpoint.data.batchId : uuidv7(),
        stepKey: call.stepKey,
        contextPackId: call.contextPackId,
        completedStepKeys,
        failureClass: null,
      },
      progress: Math.min(90, 5 + call.checkpointRevision * 20),
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, call.jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, call.workId),
        eq(jobs.branchId, call.branchId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({
      status: "settled",
      settledTokens: inputTokens + outputTokens,
      settledCostCny: costCny,
      failureClass: "timeout",
      settledAt: now,
    })
    .where(
      and(
        eq(costReservations.id, call.reservationId),
        eq(costReservations.userId, userId),
        eq(costReservations.jobId, call.jobId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({
      status: "released",
      settledTokens: 0,
      settledCostCny: 0,
      failureClass: "timeout",
      settledAt: null,
    })
    .where(
      and(
        eq(costReservations.jobId, call.jobId),
        eq(costReservations.userId, userId),
        eq(costReservations.status, "reserved"),
        sql`${costReservations.id} <> ${call.reservationId}`,
      ),
    );
  await transaction.insert(usageRecords).values({
    id: uuidv7(),
    userId,
    workId: call.workId,
    jobId: call.jobId,
    stepKey: call.stepKey,
    model: result.model,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    costCny,
    createdAt: now,
  });
  return {
    ...call,
    result,
    content,
    contentHash,
    wordCount,
    inputTokens,
    outputTokens,
    costCny,
  };
}

async function recordGoldenThreeCallFailure(
  transaction: DatabaseTransaction,
  userId: string,
  call: GoldenThreePreparedCall,
  failureClass: string,
  completed: GoldenThreeCompletedCall[],
  result?: GenerationResult,
): Promise<void> {
  if (!(await goldenThreeLeaseActive(transaction, userId, call))) {
    return;
  }
  const now = new Date();
  const inputTokens = result?.usage.inputTokens ?? 0;
  const outputTokens = result?.usage.outputTokens ?? 0;
  const costCny = result
    ? calculateModelCallCost(inputTokens + outputTokens, M0_COST_PER_TOKEN_CNY)
    : 0;
  const content = result?.text.trim() ?? "";
  const contentHash = content ? hashValue(content) : null;
  const completedInputTokens = completed.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const completedOutputTokens = completed.reduce((sum, entry) => sum + entry.outputTokens, 0);
  const totalInputTokens = completedInputTokens + inputTokens;
  const totalOutputTokens = completedOutputTokens + outputTokens;
  const totalTokens = totalInputTokens + totalOutputTokens;
  const totalCostCny = calculateModelCallCost(totalTokens, M0_COST_PER_TOKEN_CNY);
  await transaction
    .update(modelCalls)
    .set({
      status: "failed",
      failureClass,
      errorCode: "GOLDEN_THREE_GENERATION_FAILED",
      ...(result ? { outputHash: contentHash, inputTokens, outputTokens, costCny } : {}),
      finishedAt: now,
    })
    .where(
      and(
        eq(modelCalls.id, call.modelCallId),
        eq(modelCalls.userId, userId),
        eq(modelCalls.workId, call.workId),
        eq(modelCalls.branchId, call.branchId),
        eq(modelCalls.jobId, call.jobId),
      ),
    );
  await transaction
    .update(agentRuns)
    .set({
      status: "failed",
      failureClass,
      outputSummary: { message: "作者模型生成失败" },
      ...(result
        ? {
            output: content,
            outputHash: contentHash,
            usage: { inputTokens, outputTokens, costCny },
          }
        : {}),
      finishedAt: now,
    })
    .where(
      and(
        eq(agentRuns.id, call.agentRunId),
        eq(agentRuns.userId, userId),
        eq(agentRuns.workId, call.workId),
        eq(agentRuns.branchId, call.branchId),
        eq(agentRuns.jobId, call.jobId),
      ),
    );
  await transaction
    .update(modelCalls)
    .set({
      status: "failed",
      failureClass: "cancelled",
      errorCode: "GOLDEN_THREE_GENERATION_CANCELLED",
      finishedAt: now,
    })
    .where(
      and(
        eq(modelCalls.userId, userId),
        eq(modelCalls.workId, call.workId),
        eq(modelCalls.branchId, call.branchId),
        eq(modelCalls.jobId, call.jobId),
        eq(modelCalls.status, "started"),
      ),
    );
  await transaction
    .update(agentRuns)
    .set({
      status: "failed",
      failureClass: "cancelled",
      outputSummary: { message: "生成任务已停止" },
      finishedAt: now,
    })
    .where(
      and(
        eq(agentRuns.userId, userId),
        eq(agentRuns.workId, call.workId),
        eq(agentRuns.branchId, call.branchId),
        eq(agentRuns.jobId, call.jobId),
        eq(agentRuns.status, "running"),
      ),
    );
  await transaction
    .update(costReservations)
    .set({
      status: result ? "settled" : "released",
      failureClass,
      ...(result
        ? {
            settledTokens: inputTokens + outputTokens,
            settledCostCny: costCny,
            settledAt: now,
          }
        : {}),
    })
    .where(
      and(
        eq(costReservations.id, call.reservationId),
        eq(costReservations.userId, userId),
        eq(costReservations.workId, call.workId),
        eq(costReservations.branchId, call.branchId),
        eq(costReservations.jobId, call.jobId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({ status: "released", failureClass })
    .where(
      and(
        eq(costReservations.userId, userId),
        eq(costReservations.workId, call.workId),
        eq(costReservations.branchId, call.branchId),
        eq(costReservations.jobId, call.jobId),
        eq(costReservations.status, "reserved"),
      ),
    );
  await transaction
    .update(jobSteps)
    .set({
      status: "failed",
      errorCode: "GOLDEN_THREE_GENERATION_FAILED",
      errorMessage: "作者模型生成失败",
      finishedAt: now,
    })
    .where(
      and(
        eq(jobSteps.jobId, call.jobId),
        eq(jobSteps.userId, userId),
        eq(jobSteps.workId, call.workId),
        eq(jobSteps.branchId, call.branchId),
        eq(jobSteps.stepKey, call.stepKey),
      ),
    );
  await transaction
    .update(jobSteps)
    .set({ status: "skipped", finishedAt: now })
    .where(
      and(
        eq(jobSteps.jobId, call.jobId),
        eq(jobSteps.userId, userId),
        eq(jobSteps.workId, call.workId),
        eq(jobSteps.branchId, call.branchId),
        eq(jobSteps.status, "pending"),
      ),
    );
  await transaction
    .update(jobStepAttempts)
    .set({
      status: "failed",
      errorCode: "GOLDEN_THREE_GENERATION_FAILED",
      errorMessage: "作者模型生成失败",
      checkpointRevision: call.checkpointRevision,
      finishedAt: now,
    })
    .where(
      and(
        eq(jobStepAttempts.jobId, call.jobId),
        eq(jobStepAttempts.userId, userId),
        eq(jobStepAttempts.workId, call.workId),
        eq(jobStepAttempts.branchId, call.branchId),
        eq(jobStepAttempts.stepKey, call.stepKey),
        eq(jobStepAttempts.attempt, 1),
      ),
    );
  await transaction
    .update(jobStepAttempts)
    .set({ status: "skipped", finishedAt: now })
    .where(
      and(
        eq(jobStepAttempts.jobId, call.jobId),
        eq(jobStepAttempts.userId, userId),
        eq(jobStepAttempts.workId, call.workId),
        eq(jobStepAttempts.branchId, call.branchId),
        eq(jobStepAttempts.status, "pending"),
      ),
    );
  if (result) {
    await transaction.insert(usageRecords).values({
      id: uuidv7(),
      userId,
      workId: call.workId,
      jobId: call.jobId,
      stepKey: call.stepKey,
      model: result.model,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      costCny,
      createdAt: now,
    });
  }
  await transaction
    .update(jobs)
    .set({
      status: "failed",
      currentStep: "failed",
      errorCode: "GOLDEN_THREE_GENERATION_FAILED",
      errorMessage: "作者模型生成失败，请稍后重试",
      checkpoint: {
        contextPackId: call.contextPackId,
        stage: "failed",
        failureClass,
      },
      checkpointVersion: call.checkpointRevision,
      cost: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens,
        costCny: totalCostCny,
      },
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, call.jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, call.workId),
        eq(jobs.branchId, call.branchId),
      ),
    );
  await transaction.insert(jobCheckpoints).values({
    id: uuidv7(),
    jobId: call.jobId,
    workId: call.workId,
    branchId: call.branchId,
    userId,
    stepKey: call.stepKey,
    schemaVersion: 1,
    revision: call.checkpointRevision,
    attempt: 1,
    inputHash: call.promptHash,
    outputRefs: result ? [{ type: "model_call", id: call.modelCallId }] : [],
    payload: {
      contextPackId: call.contextPackId,
      failureClass,
      stage: "failed",
    },
    errorCode: "GOLDEN_THREE_GENERATION_FAILED",
    errorMessage: "作者模型生成失败",
    createdAt: now,
  });
  const sequence = await nextGoldenThreeJobEventSequence(transaction, call.jobId);
  await transaction.insert(jobEvents).values({
    id: uuidv7(),
    jobId: call.jobId,
    workId: call.workId,
    branchId: call.branchId,
    userId,
    sequence,
    eventType: "job.failed",
    payload: { failureClass, stepKey: call.stepKey },
    occurredAt: now,
  });
}

async function recordGoldenThreeLeaseLostUsage(
  transaction: DatabaseTransaction,
  userId: string,
  call: GoldenThreePreparedCall,
  result: GenerationResult,
  content: string,
): Promise<void> {
  const now = new Date();
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  const costCny = calculateModelCallCost(inputTokens + outputTokens, M0_COST_PER_TOKEN_CNY);
  const contentHash = content ? hashValue(content) : null;
  await transaction
    .update(modelCalls)
    .set({
      status: "failed",
      failureClass: "timeout",
      errorCode: "JOB_ATTEMPTS_EXHAUSTED",
      outputHash: contentHash,
      inputTokens,
      outputTokens,
      costCny,
      providerRequestId: result.providerRequestId ?? null,
      finishedAt: now,
    })
    .where(
      and(
        eq(modelCalls.id, call.modelCallId),
        eq(modelCalls.userId, userId),
        eq(modelCalls.workId, call.workId),
        eq(modelCalls.branchId, call.branchId),
        eq(modelCalls.jobId, call.jobId),
      ),
    );
  await transaction
    .update(agentRuns)
    .set({
      status: "failed",
      failureClass: "timeout",
      output: content,
      outputHash: contentHash,
      outputSummary: { contentHash, wordCount: countWords(content) },
      usage: { inputTokens, outputTokens, costCny },
      finishedAt: now,
    })
    .where(
      and(
        eq(agentRuns.id, call.agentRunId),
        eq(agentRuns.userId, userId),
        eq(agentRuns.workId, call.workId),
        eq(agentRuns.branchId, call.branchId),
        eq(agentRuns.jobId, call.jobId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({
      status: "settled",
      settledTokens: inputTokens + outputTokens,
      settledCostCny: costCny,
      failureClass: "timeout",
      settledAt: now,
    })
    .where(
      and(
        eq(costReservations.id, call.reservationId),
        eq(costReservations.userId, userId),
        eq(costReservations.jobId, call.jobId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({
      status: "released",
      settledTokens: 0,
      settledCostCny: 0,
      failureClass: "timeout",
      settledAt: null,
    })
    .where(
      and(
        eq(costReservations.jobId, call.jobId),
        eq(costReservations.userId, userId),
        eq(costReservations.status, "reserved"),
        sql`${costReservations.id} <> ${call.reservationId}`,
      ),
    );
  await transaction.insert(usageRecords).values({
    id: uuidv7(),
    userId,
    workId: call.workId,
    jobId: call.jobId,
    stepKey: call.stepKey,
    model: result.model,
    promptTokens: inputTokens,
    completionTokens: outputTokens,
    costCny,
    createdAt: now,
  });
  const [usage] = await transaction
    .select({
      inputTokens: sql<number>`coalesce(sum(${usageRecords.promptTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.completionTokens}), 0)::int`,
      costCny: sql<number>`coalesce(sum(${usageRecords.costCny}), 0)`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.jobId, call.jobId),
        eq(usageRecords.userId, userId),
        eq(usageRecords.workId, call.workId),
      ),
    );
  await transaction
    .update(jobs)
    .set({
      cost: {
        inputTokens: Number(usage?.inputTokens ?? 0),
        outputTokens: Number(usage?.outputTokens ?? 0),
        totalTokens: Number(usage?.inputTokens ?? 0) + Number(usage?.outputTokens ?? 0),
        costCny: Number(usage?.costCny ?? 0),
      },
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, call.jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, call.workId),
        eq(jobs.branchId, call.branchId),
      ),
    );
}

async function recordGoldenThreeResultFailure(
  transaction: DatabaseTransaction,
  userId: string,
  call: GoldenThreePreparedCall,
  completed: GoldenThreeCompletedCall[],
  failureClass: string,
  result: GenerationResult,
  content: string,
): Promise<boolean> {
  if (await goldenThreeLeaseActive(transaction, userId, call)) {
    await recordGoldenThreeCallFailure(transaction, userId, call, failureClass, completed, result);
    return false;
  }
  await recordGoldenThreeLeaseLostUsage(transaction, userId, call, result, content);
  return true;
}

async function recordGoldenThreePostCallFailure(
  transaction: DatabaseTransaction,
  userId: string,
  call: GoldenThreePreparedCall,
  completed: GoldenThreeCompletedCall[],
  failureClass: string,
): Promise<void> {
  if (!(await goldenThreeLeaseActive(transaction, userId, call))) {
    return;
  }
  const now = new Date();
  const inputTokens = completed.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const outputTokens = completed.reduce((sum, entry) => sum + entry.outputTokens, 0);
  const totalTokens = inputTokens + outputTokens;
  const costCny = calculateModelCallCost(totalTokens, M0_COST_PER_TOKEN_CNY);
  const revision = completed.length + 2;
  await transaction
    .update(jobs)
    .set({
      status: "failed",
      currentStep: "failed",
      errorCode: "GOLDEN_THREE_GENERATION_FAILED",
      errorMessage: "生成结果提交失败，请重试",
      checkpoint: {
        contextPackId: call.contextPackId,
        stage: "failed",
        failureClass,
      },
      checkpointVersion: revision,
      cost: {
        inputTokens,
        outputTokens,
        totalTokens,
        costCny,
      },
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, call.jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, call.workId),
        eq(jobs.branchId, call.branchId),
      ),
    );
  await transaction.insert(jobCheckpoints).values({
    id: uuidv7(),
    jobId: call.jobId,
    workId: call.workId,
    branchId: call.branchId,
    userId,
    stepKey: "failed",
    schemaVersion: 1,
    revision,
    attempt: 1,
    inputHash: call.promptHash,
    outputRefs: completed.map((entry) => ({
      type: "model_call",
      id: entry.modelCallId,
    })),
    payload: {
      contextPackId: call.contextPackId,
      failureClass,
      stage: "failed",
    },
    errorCode: "GOLDEN_THREE_GENERATION_FAILED",
    errorMessage: "生成结果提交失败",
    createdAt: now,
  });
  const sequence = await nextGoldenThreeJobEventSequence(transaction, call.jobId);
  await transaction.insert(jobEvents).values({
    id: uuidv7(),
    jobId: call.jobId,
    workId: call.workId,
    branchId: call.branchId,
    userId,
    sequence,
    eventType: "job.failed",
    payload: { failureClass },
    occurredAt: now,
  });
}

async function expireStaleGoldenThreeJob(
  transaction: DatabaseTransaction,
  userId: string,
  jobId: string,
  workId: string,
  branchId: string,
): Promise<void> {
  const [job] = await transaction
    .select({ checkpointVersion: jobs.checkpointVersion })
    .from(jobs)
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, workId),
        eq(jobs.branchId, branchId),
      ),
    )
    .for("update")
    .limit(1);
  if (!job) {
    return;
  }
  const now = new Date();
  const revision = job.checkpointVersion + 1;
  const [usage] = await transaction
    .select({
      inputTokens: sql<number>`coalesce(sum(${usageRecords.promptTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${usageRecords.completionTokens}), 0)::int`,
      costCny: sql<number>`coalesce(sum(${usageRecords.costCny}), 0)`,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.jobId, jobId),
        eq(usageRecords.userId, userId),
        eq(usageRecords.workId, workId),
      ),
    );
  const [event] = await transaction
    .select({ sequence: sql<number>`coalesce(max(${jobEvents.sequence}), 0)::int` })
    .from(jobEvents)
    .where(
      and(
        eq(jobEvents.jobId, jobId),
        eq(jobEvents.userId, userId),
        eq(jobEvents.workId, workId),
        eq(jobEvents.branchId, branchId),
      ),
    );
  await transaction
    .update(costReservations)
    .set({ status: "released", failureClass: "timeout" })
    .where(
      and(
        eq(costReservations.jobId, jobId),
        eq(costReservations.userId, userId),
        eq(costReservations.workId, workId),
        eq(costReservations.branchId, branchId),
        eq(costReservations.status, "reserved"),
      ),
    );
  await transaction
    .update(modelCalls)
    .set({
      status: "failed",
      failureClass: "timeout",
      errorCode: "JOB_ATTEMPTS_EXHAUSTED",
      finishedAt: now,
    })
    .where(
      and(
        eq(modelCalls.jobId, jobId),
        eq(modelCalls.userId, userId),
        eq(modelCalls.workId, workId),
        eq(modelCalls.branchId, branchId),
        eq(modelCalls.status, "started"),
      ),
    );
  await transaction
    .update(agentRuns)
    .set({
      status: "failed",
      failureClass: "timeout",
      outputSummary: { message: "生成任务超时" },
      finishedAt: now,
    })
    .where(
      and(
        eq(agentRuns.jobId, jobId),
        eq(agentRuns.userId, userId),
        eq(agentRuns.workId, workId),
        eq(agentRuns.branchId, branchId),
        eq(agentRuns.status, "running"),
      ),
    );
  await transaction
    .update(jobSteps)
    .set({
      status: "failed",
      errorCode: "JOB_ATTEMPTS_EXHAUSTED",
      errorMessage: "生成任务超时",
      finishedAt: now,
    })
    .where(
      and(
        eq(jobSteps.jobId, jobId),
        eq(jobSteps.userId, userId),
        eq(jobSteps.workId, workId),
        eq(jobSteps.branchId, branchId),
        eq(jobSteps.status, "running"),
      ),
    );
  await transaction
    .update(jobSteps)
    .set({ status: "skipped", finishedAt: now })
    .where(
      and(
        eq(jobSteps.jobId, jobId),
        eq(jobSteps.userId, userId),
        eq(jobSteps.workId, workId),
        eq(jobSteps.branchId, branchId),
        eq(jobSteps.status, "pending"),
      ),
    );
  await transaction
    .update(jobStepAttempts)
    .set({
      status: "failed",
      errorCode: "JOB_ATTEMPTS_EXHAUSTED",
      errorMessage: "生成任务超时",
      checkpointRevision: revision,
      finishedAt: now,
    })
    .where(
      and(
        eq(jobStepAttempts.jobId, jobId),
        eq(jobStepAttempts.userId, userId),
        eq(jobStepAttempts.workId, workId),
        eq(jobStepAttempts.branchId, branchId),
        eq(jobStepAttempts.status, "running"),
      ),
    );
  await transaction
    .update(jobStepAttempts)
    .set({ status: "skipped", checkpointRevision: revision, finishedAt: now })
    .where(
      and(
        eq(jobStepAttempts.jobId, jobId),
        eq(jobStepAttempts.userId, userId),
        eq(jobStepAttempts.workId, workId),
        eq(jobStepAttempts.branchId, branchId),
        eq(jobStepAttempts.status, "pending"),
      ),
    );
  await transaction
    .update(jobs)
    .set({
      status: "failed",
      currentStep: "failed",
      goldenThreeLeaseVersion: sql`${jobs.goldenThreeLeaseVersion} + 1`,
      checkpointVersion: revision,
      checkpoint: { stage: "failed", failureClass: "timeout" },
      cost: {
        inputTokens: Number(usage?.inputTokens ?? 0),
        outputTokens: Number(usage?.outputTokens ?? 0),
        totalTokens: Number(usage?.inputTokens ?? 0) + Number(usage?.outputTokens ?? 0),
        costCny: Number(usage?.costCny ?? 0),
      },
      errorCode: "JOB_ATTEMPTS_EXHAUSTED",
      errorMessage: "生成任务超时，可重新发起",
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.userId, userId),
        eq(jobs.workId, workId),
        eq(jobs.branchId, branchId),
      ),
    );
  await transaction.insert(jobCheckpoints).values({
    id: uuidv7(),
    jobId,
    workId,
    branchId,
    userId,
    stepKey: "failed",
    schemaVersion: 1,
    revision,
    attempt: 1,
    outputRefs: [],
    payload: { stage: "failed", failureClass: "timeout" },
    errorCode: "JOB_ATTEMPTS_EXHAUSTED",
    errorMessage: "生成任务超时",
    createdAt: now,
  });
  await transaction.insert(jobEvents).values({
    id: uuidv7(),
    jobId,
    workId,
    branchId,
    userId,
    sequence: Number(event?.sequence ?? 0) + 1,
    eventType: "job.failed",
    payload: { failureClass: "timeout", staleRecovery: true },
    occurredAt: now,
  });
}

async function resolvePins(
  transaction: DatabaseTransaction,
  userId: string,
  context: GoldenThreeContext,
  requestedPins: GoldenThreeChapterPinInput[],
): Promise<
  { ok: true; byVersionId: Map<string, GoldenThreeChapterPinJson> } | { ok: false; message: string }
> {
  const versionIds = [...new Set(requestedPins.map((pin) => pin.chapterVersionId))];
  const rows = await transaction
    .select({
      chapter: chapters,
      version: chapterVersions,
      versionNodeId: chapterVersions.versionNodeId,
    })
    .from(chapterVersions)
    .innerJoin(chapters, eq(chapters.id, chapterVersions.chapterId))
    .where(
      and(
        inArray(chapterVersions.id, versionIds),
        eq(chapterVersions.userId, userId),
        eq(chapterVersions.workId, context.workId),
        eq(chapterVersions.branchId, context.branchId),
        eq(chapters.userId, userId),
        eq(chapters.workId, context.workId),
        eq(chapters.branchId, context.branchId),
      ),
    );
  if (rows.length !== versionIds.length) {
    return { ok: false, message: "候选固定的章节版本不存在或不属于当前创作线" };
  }
  const byVersionId = new Map<string, GoldenThreeChapterPinJson>();
  for (const row of rows) {
    const requested = requestedPins.find((pin) => pin.chapterVersionId === row.version.id);
    if (
      !requested ||
      requested.chapterId !== row.chapter.id ||
      (requested.expectedContentHash && requested.expectedContentHash !== row.version.contentHash)
    ) {
      return { ok: false, message: "候选固定的章节版本与内容指纹不一致" };
    }
    byVersionId.set(row.version.id, {
      chapterId: row.chapter.id,
      chapterNumber: row.chapter.number,
      chapterTitle: row.chapter.title,
      chapterVersionId: row.version.id,
      chapterVersion: row.version.version,
      versionNodeId: row.versionNodeId,
      contentHash: row.version.contentHash,
      wordCount: countWords(row.version.content),
      content: row.version.content,
    });
  }
  return { ok: true, byVersionId };
}

async function readLatestContinuations(
  transaction: DatabaseTransaction,
  userId: string,
  context: GoldenThreeContext,
  candidateIds: string[],
): Promise<
  Map<
    string,
    {
      versionNodeId: string;
      pins: GoldenThreeChapterPinJson[];
      styleSource: GoldenThreeContinuationStyleSource;
      createdAt: string;
    }
  >
> {
  const continuations = new Map<
    string,
    {
      versionNodeId: string;
      pins: GoldenThreeChapterPinJson[];
      styleSource: GoldenThreeContinuationStyleSource;
      createdAt: string;
    }
  >();
  if (candidateIds.length === 0) {
    return continuations;
  }
  const rows = await transaction
    .select({
      id: versionNodes.id,
      objectId: versionNodes.objectId,
      payload: versionNodes.payload,
      createdAt: versionNodes.createdAt,
    })
    .from(versionNodes)
    .where(
      and(
        eq(versionNodes.userId, userId),
        eq(versionNodes.workId, context.workId),
        eq(versionNodes.branchId, context.branchId),
        eq(versionNodes.objectType, "golden_three_continuation"),
        inArray(versionNodes.objectId, candidateIds),
      ),
    )
    .orderBy(desc(versionNodes.createdAt));
  for (const row of rows) {
    if (continuations.has(row.objectId)) {
      continue;
    }
    const payload = row.payload;
    if (
      typeof payload !== "object" ||
      payload === null ||
      !Array.isArray((payload as { pins?: unknown }).pins)
    ) {
      continue;
    }
    const styleSource = goldenThreeContinuationStyleSourceSchema.safeParse(
      (payload as { styleSource?: unknown }).styleSource,
    );
    if (!styleSource.success) {
      continue;
    }
    continuations.set(row.objectId, {
      versionNodeId: row.id,
      pins: (payload as { pins: GoldenThreeChapterPinJson[] }).pins,
      styleSource: styleSource.data,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return continuations;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function nextGoldenThreeJobEventSequence(
  transaction: DatabaseTransaction,
  jobId: string,
): Promise<number> {
  const [event] = await transaction
    .select({ sequence: sql<number>`coalesce(max(${jobEvents.sequence}), 0)::int` })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, jobId));
  return Number(event?.sequence ?? 0) + 1;
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: GoldenThreeContext,
): Promise<string> {
  const [branch] = await transaction
    .select()
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("Golden three branch is missing its version head");
  }
  return branch.headNodeId;
}

async function advanceBranchHead(
  transaction: DatabaseTransaction,
  context: GoldenThreeContext,
  versionNodeId: string,
  now: Date,
): Promise<void> {
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: GoldenThreeAuditContext,
  action: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType: "golden_three",
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

function toGoldenThreeGenerationJob(job: InferSelectModel<typeof jobs>): GoldenThreeGenerationJob {
  return goldenThreeGenerationJobSchema.parse({
    id: job.id,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    candidateCount: goldenThreeCandidateCount(job),
    error:
      job.errorCode && job.errorMessage ? { code: job.errorCode, message: job.errorMessage } : null,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  });
}

function toGoldenThreeWorkerJob(job: InferSelectModel<typeof jobs>): GenerateGoldenThreeJob {
  return generateGoldenThreeJobSchema.parse({
    jobId: job.id,
    jobType: GENERATE_GOLDEN_THREE_JOB,
    workId: job.workId,
    branchId: job.branchId,
    chapterId: job.chapterId,
    actorId: job.userId,
    modelConfigId: job.modelConfigId,
    idempotencyKey: job.idempotencyKey,
    candidateCount: goldenThreeCandidateCount(job),
    budget: job.budget,
    checkpoint: parseGoldenThreeCheckpoint(job),
  });
}

function goldenThreeCandidateCount(job: InferSelectModel<typeof jobs>): 2 | 3 {
  const count = job.orchestration?.candidateCount;
  return count === 2 ? 2 : 3;
}

function parseGoldenThreeCheckpoint(job: InferSelectModel<typeof jobs>): GoldenThreeJobCheckpoint {
  const parsed = goldenThreeJobCheckpointSchema.safeParse(job.checkpoint);
  if (parsed.success) {
    return parsed.data;
  }
  const stage: GoldenThreeJobCheckpoint["stage"] =
    job.status === "failed"
      ? "failed"
      : job.status === "completed"
        ? "completed"
        : job.status === "running"
          ? "generating_candidates"
          : job.status === "preparing"
            ? "preparing"
            : "queued";
  return {
    schemaVersion: 1,
    revision: job.checkpointVersion,
    stage,
    batchId: typeof job.checkpoint.batchId === "string" ? job.checkpoint.batchId : uuidv7(),
    stepKey: typeof job.currentStep === "string" ? job.currentStep : null,
    contextPackId:
      typeof job.checkpoint.contextPackId === "string" ? job.checkpoint.contextPackId : null,
    completedStepKeys: Array.isArray(job.checkpoint.completedStepKeys)
      ? job.checkpoint.completedStepKeys.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
    failureClass:
      typeof job.checkpoint.failureClass === "string" ? job.checkpoint.failureClass : null,
  };
}

function goldenThreeFailureClass(error: unknown, fallback: string): string {
  if (error instanceof AiProviderError) {
    return error.failureClass;
  }
  if (
    error instanceof Error &&
    error.name === "AiProviderError" &&
    "failureClass" in error &&
    typeof error.failureClass === "string"
  ) {
    return error.failureClass;
  }
  return fallback;
}

function goldenThreeSystemPrompt(strategy: GoldenThreeStrategy): string {
  const focus =
    strategy === "hook_focus"
      ? "优先强化开篇钩子与章末追读"
      : strategy === "character_focus"
        ? "优先强化主角动机、代价与人物吸引力"
        : "优先展示世界规则、核心冲突与读者承诺";
  return `你是中文网络小说开篇写作代理。只输出第一章正文，不解释创作过程。${focus}。`;
}

function goldenThreeUserPrompt(
  strategy: GoldenThreeStrategy,
  chapter: { number: number; title: string },
  contextPack: { selected: Array<{ label: string; content: string }> },
): string {
  const context = contextPack.selected
    .map((entry) => `【${entry.label}】\n${entry.content}`)
    .join("\n\n");
  return `为第 ${chapter.number} 章《${chapter.title}》写开篇候选正文。\n创作方向：${strategy}。\n\n可用上下文：\n${context}\n\n要求：只输出正文，约 2000–3000 字。`;
}

function countWords(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
