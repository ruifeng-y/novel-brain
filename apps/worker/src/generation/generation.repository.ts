import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  contextPackManifestSchema,
  contextPackVersionSchema,
  WORKER_JOB_STEPS,
  type ContextPackManifest,
  type GenerateChapterJob,
  type GenerationCost,
  type WorkerJobStep,
} from "@novel-brain/contracts";
import {
  agentRuns,
  chapterVersions,
  chapters,
  characterKnowledgeStates,
  contextPackVersions,
  costReservations,
  createDatabaseClient,
  createDatabasePool,
  entities,
  facts as canonicalFacts,
  jobCheckpoints,
  jobEvents,
  jobStepAttempts,
  jobSteps,
  jobs,
  modelCalls,
  modelConfigs,
  promptVersions,
  refreshFactProposals,
  releaseBudgetInTransaction,
  reserveBudgetInTransaction,
  settleBudgetInTransaction,
  storyBibles,
  storyBibleVersions,
  storyBibleWorldRules,
  summaryRecords,
  usageRecords,
  users,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
  type FactProposalCandidate,
} from "@novel-brain/db";
import { M0_COST_PER_TOKEN_CNY, type GenerationResult } from "@novel-brain/ai";
import {
  outputRefsFromStepOutput,
  resolveRecoveryStep,
  type ChapterContextInput,
  type RecoveryStepStatus,
} from "@novel-brain/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type JobRecord = InferSelectModel<typeof jobs>;
export type JobStepRecord = InferSelectModel<typeof jobSteps>;
export type ModelConfigRecord = InferSelectModel<typeof modelConfigs>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface LoadedGenerationJob {
  job: JobRecord;
  modelConfig: ModelConfigRecord;
}

export interface WorkerContextSources {
  chapter: InferSelectModel<typeof chapters>;
  branch: {
    id: string;
    status: "active" | "archived";
    headNodeId: string | null;
  };
  storyBible: InferSelectModel<typeof storyBibles>;
  worldRules: Array<{
    id: string;
    name: string;
    constraint: string;
    scope: string;
    exceptions: string[];
  }>;
  styleSample?: string;
  settings: Array<{
    id: string;
    type: string;
    name: string;
    aliases: string[];
    summary: string;
    description: string;
    tags: string[];
    attributes: Record<string, unknown>;
    source: string;
    sourceChapterNumber?: number;
    validFromChapter?: number;
    validToChapter?: number | null;
  }>;
  previousVersions: ChapterContextInput["previousVersions"];
  summaries: Array<{
    id: string;
    level: "chapter" | "stage" | "volume" | "book";
    label: string;
    content: string;
    branchId: string;
    fromChapter: number;
    toChapter: number | null;
    status: "fresh" | "stale" | "rebuilding";
  }>;
  povCharacterId?: string;
  knowledge?: {
    facts: Array<{
      id: string;
      subject: string;
      predicate: string;
      object: string;
      validFromChapter: number;
      validToChapter: number | null;
    }>;
    states: Array<{
      objectiveFactId: string;
      state: "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown";
      claimedContent: string | null;
      validFromChapter: number;
      validToChapter: number | null;
    }>;
  };
}

export interface StartedModelCall {
  runId: string;
  promptVersionId: string;
  modelCallId: string;
  reservationId: string;
  reservationKey: string;
  attempt: number;
}

const factSourceChapters = alias(chapters, "fact_source_chapters");

@Injectable()
export class WorkerGenerationRepository implements OnModuleDestroy {
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

  async withJobLock<T>(jobId: string, operation: () => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(
           hashtext('novelbrain:generation-job'),
           hashtext($1::text)
         ) AS locked`,
        [jobId],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) {
        return undefined;
      }
      return await operation();
    } finally {
      let unlockFailed = false;
      if (locked) {
        await client
          .query(
            `SELECT pg_advisory_unlock(
               hashtext('novelbrain:generation-job'),
               hashtext($1::text)
             )`,
            [jobId],
          )
          .catch(() => {
            unlockFailed = true;
          });
      }
      client.release(unlockFailed);
    }
  }

  async loadJob(payload: GenerateChapterJob): Promise<LoadedGenerationJob | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [row] = await transaction
        .select({ job: jobs, modelConfig: modelConfigs })
        .from(jobs)
        .innerJoin(
          modelConfigs,
          and(eq(modelConfigs.id, jobs.modelConfigId), eq(modelConfigs.userId, jobs.userId)),
        )
        .innerJoin(works, and(eq(works.id, jobs.workId), eq(works.userId, jobs.userId)))
        .where(
          and(
            eq(jobs.id, payload.jobId),
            eq(jobs.userId, payload.actorId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      return row;
    });
  }

  async loadSources(payload: GenerateChapterJob): Promise<WorkerContextSources | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [chapter] = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, payload.chapterId),
            eq(chapters.workId, payload.workId),
            eq(chapters.branchId, payload.branchId),
            eq(chapters.userId, payload.actorId),
          ),
        )
        .limit(1);
      if (!chapter) {
        return undefined;
      }
      const [branch] = await transaction
        .select({
          id: workBranches.id,
          status: workBranches.status,
          headNodeId: workBranches.headNodeId,
        })
        .from(workBranches)
        .where(
          and(
            eq(workBranches.id, payload.branchId),
            eq(workBranches.workId, payload.workId),
            eq(workBranches.userId, payload.actorId),
          ),
        )
        .limit(1);
      if (!branch) {
        return undefined;
      }
      const [storyBible] = await transaction
        .select()
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.workId, payload.workId),
            eq(storyBibles.branchId, payload.branchId),
            eq(storyBibles.userId, payload.actorId),
            eq(storyBibles.status, "locked"),
          ),
        )
        .limit(1);
      if (!storyBible) {
        return undefined;
      }
      const [storyBibleVersion] = await transaction
        .select({ id: storyBibleVersions.id })
        .from(storyBibleVersions)
        .where(
          and(
            eq(storyBibleVersions.storyBibleId, storyBible.id),
            eq(storyBibleVersions.userId, payload.actorId),
            eq(storyBibleVersions.version, storyBible.version),
          ),
        )
        .limit(1);
      const worldRules = storyBibleVersion
        ? await transaction
            .select()
            .from(storyBibleWorldRules)
            .where(
              and(
                eq(storyBibleWorldRules.storyBibleVersionId, storyBibleVersion.id),
                eq(storyBibleWorldRules.userId, payload.actorId),
              ),
            )
            .orderBy(asc(storyBibleWorldRules.name))
        : [];
      const [work] = await transaction
        .select({ settings: works.settings })
        .from(works)
        .where(
          and(
            eq(works.id, payload.workId),
            eq(works.userId, payload.actorId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      const settings = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, payload.workId),
            eq(entities.branchId, payload.branchId),
            eq(entities.userId, payload.actorId),
            eq(entities.status, "locked"),
            isNull(entities.deletedAt),
          ),
        )
        .orderBy(asc(entities.type), asc(entities.name));
      const submittedFacts = await transaction
        .select({
          fact: canonicalFacts,
          sourceChapterNumber: factSourceChapters.number,
        })
        .from(canonicalFacts)
        .innerJoin(
          factSourceChapters,
          and(
            eq(factSourceChapters.id, canonicalFacts.chapterId),
            eq(factSourceChapters.workId, canonicalFacts.workId),
            eq(factSourceChapters.branchId, canonicalFacts.branchId),
            eq(factSourceChapters.userId, canonicalFacts.userId),
          ),
        )
        .where(
          and(
            eq(canonicalFacts.workId, payload.workId),
            eq(canonicalFacts.branchId, payload.branchId),
            eq(canonicalFacts.userId, payload.actorId),
            eq(canonicalFacts.status, "active"),
          ),
        )
        .orderBy(asc(canonicalFacts.createdAt));
      const previousVersions = await transaction
        .select({
          chapterId: chapters.id,
          chapterNumber: chapters.number,
          chapterTitle: chapters.title,
          versionId: chapterVersions.id,
          content: chapterVersions.content,
        })
        .from(chapters)
        .innerJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.workId, payload.workId),
            eq(chapters.branchId, payload.branchId),
            eq(chapters.userId, payload.actorId),
            sql`${chapters.number} < ${chapter.number}`,
          ),
        )
        .orderBy(desc(chapters.number))
        .limit(3);
      const summaries = await transaction
        .select()
        .from(summaryRecords)
        .where(
          and(
            eq(summaryRecords.userId, payload.actorId),
            eq(summaryRecords.workId, payload.workId),
            eq(summaryRecords.branchId, payload.branchId),
            eq(summaryRecords.status, "fresh"),
            sql`${summaryRecords.toChapter} is not null and ${summaryRecords.toChapter} < ${chapter.number}`,
          ),
        )
        .orderBy(desc(summaryRecords.fromChapter))
        .limit(8);
      const povName = chapter.brief?.pov;
      const hasPov = typeof povName === "string" && povName.trim().length > 0;
      const povCharacter =
        typeof povName === "string"
          ? settings.find((setting) => setting.type === "character" && setting.name === povName)
          : undefined;
      const knowledgeStates = povCharacter
        ? await transaction
            .select()
            .from(characterKnowledgeStates)
            .where(
              and(
                eq(characterKnowledgeStates.characterId, povCharacter.id),
                eq(characterKnowledgeStates.workId, payload.workId),
                eq(characterKnowledgeStates.branchId, payload.branchId),
                eq(characterKnowledgeStates.userId, payload.actorId),
              ),
            )
            .orderBy(asc(characterKnowledgeStates.validFromChapter))
        : [];
      return {
        chapter,
        branch: {
          id: branch.id,
          status: branch.status === "archived" ? "archived" : "active",
          headNodeId: branch.headNodeId,
        },
        storyBible,
        worldRules: worldRules.map((rule) => ({
          id: rule.id,
          name: rule.name,
          constraint: rule.constraint,
          scope: rule.scope,
          exceptions: rule.exceptions,
        })),
        settings: [
          ...settings.map((setting) => ({
            id: setting.id,
            type: setting.type,
            name: setting.name,
            aliases: setting.aliases,
            summary: setting.summary,
            description: setting.description,
            tags: setting.tags,
            attributes: setting.attributes,
            source: setting.source,
          })),
          ...submittedFacts.map((fact) => ({
            id: fact.fact.id,
            type: "fact",
            name: fact.fact.subject,
            aliases: [],
            summary: `${fact.fact.predicate}：${fact.fact.object}`,
            description: "",
            tags: [],
            attributes: {
              subject: fact.fact.subject,
              predicate: fact.fact.predicate,
              object: fact.fact.object,
              risk: fact.fact.risk,
              sourceChapterId: fact.fact.chapterId,
              factProposalId: fact.fact.factProposalId,
            },
            source: "canon",
            sourceChapterNumber: fact.sourceChapterNumber,
            validFromChapter: fact.fact.validFromChapter,
            validToChapter: fact.fact.validToChapter,
          })),
        ],
        ...(typeof work?.settings.styleSample === "string"
          ? { styleSample: work.settings.styleSample }
          : {}),
        previousVersions,
        summaries: summaries.map((summary) => ({
          id: summary.id,
          level: summary.level as "chapter" | "stage" | "volume" | "book",
          label: summary.title,
          content: summary.content,
          branchId: summary.branchId,
          fromChapter: summary.fromChapter,
          toChapter: summary.toChapter,
          status: summary.status as "fresh" | "stale" | "rebuilding",
        })),
        ...(povCharacter ? { povCharacterId: povCharacter.id } : {}),
        ...(hasPov
          ? {
              knowledge: {
                facts: submittedFacts.map(({ fact }) => ({
                  id: fact.id,
                  subject: fact.subject,
                  predicate: fact.predicate,
                  object: fact.object,
                  validFromChapter: fact.validFromChapter,
                  validToChapter: fact.validToChapter,
                })),
                states: knowledgeStates.map((state) => ({
                  objectiveFactId: state.objectiveFactId,
                  state: state.state as
                    "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown",
                  claimedContent: state.claimedContent,
                  validFromChapter: state.validFromChapter,
                  validToChapter: state.validToChapter,
                })),
              },
            }
          : {}),
      };
    });
  }

  async begin(payload: GenerateChapterJob): Promise<JobRecord | "terminal" | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, payload.jobId), eq(jobs.userId, payload.actorId)))
        .for("update")
        .limit(1);
      if (!current) {
        return undefined;
      }
      if (
        current.status === "completed" ||
        current.status === "waiting_review" ||
        current.status === "failed" ||
        current.status === "cancelled"
      ) {
        return "terminal";
      }
      const now = new Date();
      const [job] = await transaction
        .update(jobs)
        .set({
          status: "preparing",
          startedAt: current.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(jobs.id, current.id))
        .returning();
      if (!job) {
        throw new Error("Failed to start generation job");
      }
      await appendEvent(transaction, job, "job.preparing", {
        status: "preparing",
        checkpoint: job.checkpoint,
      });
      return job;
    });
  }

  async resumeStep(payload: GenerateChapterJob): Promise<WorkerJobStep> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const steps = await transaction
        .select({ stepKey: jobSteps.stepKey, status: jobSteps.status })
        .from(jobSteps)
        .where(eq(jobSteps.jobId, payload.jobId));
      return resolveRecoveryStep(
        WORKER_JOB_STEPS,
        steps.map((step) => ({
          stepKey: step.stepKey,
          status: step.status as RecoveryStepStatus,
        })),
      ).step;
    });
  }

  async isCancelled(payload: GenerateChapterJob): Promise<boolean> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select({ status: jobs.status })
        .from(jobs)
        .where(and(eq(jobs.id, payload.jobId), eq(jobs.userId, payload.actorId)))
        .limit(1);
      return job?.status === "cancelled";
    });
  }

  async startStep(
    payload: GenerateChapterJob,
    step: string,
    inputHash: string,
    progress: number,
  ): Promise<JobStepRecord> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, payload.jobId), eq(jobs.userId, payload.actorId)))
        .for("update")
        .limit(1);
      if (!job) {
        throw new Error("Generation job no longer exists");
      }
      const interrupted = await transaction
        .select({
          callId: modelCalls.id,
          runId: modelCalls.agentRunId,
          reservationKey: costReservations.idempotencyKey,
        })
        .from(modelCalls)
        .innerJoin(costReservations, eq(costReservations.id, modelCalls.costReservationId))
        .where(
          and(
            eq(modelCalls.jobId, job.id),
            eq(modelCalls.stepKey, step),
            eq(modelCalls.status, "started"),
            eq(costReservations.status, "reserved"),
          ),
        );
      const now = new Date();
      for (const call of interrupted) {
        await releaseBudgetInTransaction(transaction, {
          userId: job.userId,
          jobId: job.id,
          idempotencyKey: call.reservationKey,
          failureClass: "unknown",
        });
        await transaction
          .update(modelCalls)
          .set({
            status: "failed",
            failureClass: "unknown",
            errorCode: "WORKER_INTERRUPTED",
            escalationReason: "Worker 中断后已释放预留，可从断点重试",
            finishedAt: now,
          })
          .where(eq(modelCalls.id, call.callId));
        await transaction
          .update(agentRuns)
          .set({
            status: "failed",
            failureClass: "unknown",
            escalationReason: "Worker 中断后已释放预留，可从断点重试",
            finishedAt: now,
          })
          .where(eq(agentRuns.id, call.runId));
      }
      const [existing] = await transaction
        .select()
        .from(jobSteps)
        .where(and(eq(jobSteps.jobId, payload.jobId), eq(jobSteps.stepKey, step)))
        .limit(1);
      const [jobStep] = existing
        ? await transaction
            .update(jobSteps)
            .set({
              status: "running",
              attempt: existing.attempt + 1,
              inputHash,
              errorCode: null,
              errorMessage: null,
              startedAt: now,
              finishedAt: null,
            })
            .where(eq(jobSteps.id, existing.id))
            .returning()
        : await transaction
            .insert(jobSteps)
            .values({
              id: uuidv7(),
              jobId: job.id,
              workId: job.workId,
              branchId: job.branchId,
              userId: job.userId,
              stepKey: step,
              status: "running",
              attempt: 1,
              inputHash,
              startedAt: now,
            })
            .returning();
      if (!jobStep) {
        throw new Error("Failed to start job step");
      }
      await transaction.insert(jobStepAttempts).values({
        id: uuidv7(),
        jobId: job.id,
        workId: job.workId,
        branchId: job.branchId,
        userId: job.userId,
        stepKey: step,
        attempt: jobStep.attempt,
        status: "running",
        inputHash,
        checkpointRevision: job.checkpointVersion,
        startedAt: now,
      });
      const [updatedJob] = await transaction
        .update(jobs)
        .set({
          status: "running",
          currentStep: step,
          progress,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      if (!updatedJob) {
        throw new Error("Failed to update generation job");
      }
      await appendEvent(transaction, updatedJob, "job.step.started", {
        step,
        progress,
        attempt: jobStep.attempt,
      });
      return jobStep;
    });
  }

  async succeedStep(input: {
    payload: GenerateChapterJob;
    step: string;
    progress: number;
    output: Record<string, unknown>;
    cost: GenerationCost;
    checkpointPayload: Record<string, unknown>;
  }): Promise<JobRecord> {
    return this.withTenant(input.payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.payload.jobId), eq(jobs.userId, input.payload.actorId)))
        .for("update")
        .limit(1);
      if (!job) {
        throw new Error("Generation job no longer exists");
      }
      const [jobStep] = await transaction
        .select()
        .from(jobSteps)
        .where(and(eq(jobSteps.jobId, input.payload.jobId), eq(jobSteps.stepKey, input.step)))
        .limit(1);
      if (!jobStep) {
        throw new Error("Generation step was not started");
      }
      const now = new Date();
      const outputRefs = outputRefsFromStepOutput(input.output);
      await transaction
        .update(jobSteps)
        .set({
          status: "succeeded",
          output: input.output,
          outputRefs,
          cost: input.cost,
          errorCode: null,
          errorMessage: null,
          finishedAt: now,
        })
        .where(and(eq(jobSteps.jobId, input.payload.jobId), eq(jobSteps.stepKey, input.step)));
      const revision = job.checkpointVersion + 1;
      const checkpoint = {
        schemaVersion: 1,
        revision,
        step: input.step,
        inputHash: jobStep.inputHash,
        outputRefs,
        payload: input.checkpointPayload,
      };
      const [updated] = await transaction
        .update(jobs)
        .set({
          progress: input.progress,
          currentStep: input.step,
          checkpoint,
          checkpointVersion: revision,
          cost: job.cost,
          errorCode: null,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      if (!updated) {
        throw new Error("Failed to checkpoint generation job");
      }
      await transaction.insert(jobCheckpoints).values({
        id: uuidv7(),
        jobId: job.id,
        workId: job.workId,
        branchId: job.branchId,
        userId: job.userId,
        stepKey: input.step,
        schemaVersion: 1,
        revision,
        attempt: jobStep.attempt,
        inputHash: jobStep.inputHash,
        outputRefs,
        payload: checkpoint,
        createdAt: now,
      });
      await transaction
        .update(jobStepAttempts)
        .set({
          status: "succeeded",
          outputRefs,
          checkpointRevision: revision,
          errorCode: null,
          errorMessage: null,
          finishedAt: now,
        })
        .where(
          and(
            eq(jobStepAttempts.jobId, job.id),
            eq(jobStepAttempts.stepKey, input.step),
            eq(jobStepAttempts.attempt, jobStep.attempt),
          ),
        );
      await appendEvent(transaction, updated, "job.step.succeeded", {
        step: input.step,
        progress: input.progress,
        attempt: jobStep.attempt,
        outputRefs,
        checkpoint,
      });
      await appendEvent(transaction, updated, "job.progress", {
        step: input.step,
        progress: input.progress,
        cost: job.cost,
      });
      return updated;
    });
  }

  async failStep(input: {
    payload: GenerateChapterJob;
    step: string;
    code: string;
    message: string;
    terminal?: boolean;
  }): Promise<void> {
    await this.withTenant(input.payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.payload.jobId), eq(jobs.userId, input.payload.actorId)))
        .for("update")
        .limit(1);
      if (!job) {
        return;
      }
      const [jobStep] = await transaction
        .select()
        .from(jobSteps)
        .where(and(eq(jobSteps.jobId, input.payload.jobId), eq(jobSteps.stepKey, input.step)))
        .limit(1);
      const now = new Date();
      const previousCheckpoint = job.checkpoint as {
        payload?: Record<string, unknown>;
        outputRefs?: Array<{ type: string; id: string }>;
      };
      const revision = job.checkpointVersion + 1;
      const checkpoint = {
        schemaVersion: 1,
        revision,
        step: input.step,
        inputHash: jobStep?.inputHash ?? null,
        outputRefs: previousCheckpoint.outputRefs ?? [],
        payload: previousCheckpoint.payload ?? {},
      };
      if (jobStep) {
        await transaction
          .update(jobSteps)
          .set({
            status: "failed",
            errorCode: input.code,
            errorMessage: input.message,
            finishedAt: now,
          })
          .where(eq(jobSteps.id, jobStep.id));
        await transaction
          .update(jobStepAttempts)
          .set({
            status: "failed",
            checkpointRevision: revision,
            errorCode: input.code,
            errorMessage: input.message,
            finishedAt: now,
          })
          .where(
            and(
              eq(jobStepAttempts.jobId, job.id),
              eq(jobStepAttempts.stepKey, input.step),
              eq(jobStepAttempts.attempt, jobStep.attempt),
            ),
          );
      }
      await transaction.insert(jobCheckpoints).values({
        id: uuidv7(),
        jobId: job.id,
        workId: job.workId,
        branchId: job.branchId,
        userId: job.userId,
        stepKey: input.step,
        schemaVersion: 1,
        revision,
        attempt: jobStep?.attempt ?? 0,
        inputHash: jobStep?.inputHash ?? null,
        outputRefs: previousCheckpoint.outputRefs ?? [],
        payload: checkpoint,
        errorCode: input.code,
        errorMessage: input.message,
        createdAt: now,
      });
      const keepCancelled = job.status === "cancelled";
      const terminal = input.terminal !== false || keepCancelled;
      const status = keepCancelled ? "cancelled" : terminal ? "failed" : "running";
      const [failed] = await transaction
        .update(jobs)
        .set({
          status,
          currentStep: input.step,
          checkpoint,
          checkpointVersion: revision,
          errorCode: input.code,
          errorMessage: input.message,
          finishedAt: terminal ? now : null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      if (!failed) {
        return;
      }
      await appendEvent(transaction, failed, "job.step.failed", {
        step: input.step,
        attempt: jobStep?.attempt ?? 0,
        error: { code: input.code, message: input.message },
        checkpoint,
      });
      if (terminal && !keepCancelled) {
        await appendEvent(transaction, failed, "job.failed", {
          status: "failed",
          error: { code: input.code, message: input.message },
          checkpoint,
        });
      }
    });
  }

  async complete(payload: GenerateChapterJob): Promise<void> {
    await this.withTenant(payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, payload.jobId), eq(jobs.userId, payload.actorId)))
        .for("update")
        .limit(1);
      if (!job) {
        return;
      }
      const now = new Date();
      const [completed] = await transaction
        .update(jobs)
        .set({
          status: "waiting_review",
          progress: 100,
          currentStep: "await_review",
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      if (!completed) {
        return;
      }
      await transaction
        .update(chapters)
        .set({
          status: "waiting_review",
          updatedAt: now,
        })
        .where(
          and(
            eq(chapters.id, payload.chapterId),
            eq(chapters.userId, payload.actorId),
            eq(chapters.workId, payload.workId),
            eq(chapters.branchId, payload.branchId),
          ),
        );
      await appendEvent(transaction, completed, "job.waiting_review", {
        status: "waiting_review",
        progress: 100,
        checkpoint: completed.checkpoint,
      });
    });
  }

  async persistContextPack(input: {
    payload: GenerateChapterJob;
    pack: ContextPackManifest;
  }): Promise<string> {
    return this.withTenant(input.payload.actorId, async (transaction) => {
      const [existing] = await transaction
        .select({ id: contextPackVersions.id })
        .from(contextPackVersions)
        .where(eq(contextPackVersions.jobId, input.payload.jobId))
        .orderBy(desc(contextPackVersions.version))
        .limit(1);
      if (existing) {
        return existing.id;
      }
      const id = uuidv7();
      await transaction.insert(contextPackVersions).values({
        id,
        jobId: input.payload.jobId,
        chapterId: input.payload.chapterId,
        workId: input.payload.workId,
        branchId: input.payload.branchId,
        userId: input.payload.actorId,
        version: 1,
        compilerVersion: input.pack.compilerVersion,
        tokenBudget: input.pack.tokenBudget,
        tokenUsed: input.pack.tokenUsed,
        selected: input.pack.selected,
        evicted: input.pack.evicted,
        sourceRefs: input.pack.sourceRefs,
        snapshot: input.pack,
      });
      return id;
    });
  }

  async saveGeneratedVersion(input: {
    payload: GenerateChapterJob;
    step: "draft" | "revise";
    content: string;
  }): Promise<{ id: string; version: number }> {
    return this.withTenant(input.payload.actorId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.payload.branchId}))`,
      );
      const [existing] = await transaction
        .select({ id: chapterVersions.id, version: chapterVersions.version })
        .from(chapterVersions)
        .where(
          and(
            eq(chapterVersions.generationJobId, input.payload.jobId),
            eq(chapterVersions.generationStep, input.step),
          ),
        )
        .limit(1);
      if (existing) {
        return existing;
      }
      const [chapter] = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, input.payload.chapterId),
            eq(chapters.workId, input.payload.workId),
            eq(chapters.branchId, input.payload.branchId),
            eq(chapters.userId, input.payload.actorId),
          ),
        )
        .for("update")
        .limit(1);
      if (!chapter) {
        throw new Error("Chapter no longer exists");
      }
      const [branch] = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            eq(workBranches.id, input.payload.branchId),
            eq(workBranches.workId, input.payload.workId),
            eq(workBranches.userId, input.payload.actorId),
          ),
        )
        .for("update")
        .limit(1);
      if (!branch?.headNodeId) {
        throw new Error("Generation branch is missing its version head");
      }
      const [latest] = await transaction
        .select({ version: sql<number>`coalesce(max(${chapterVersions.version}), 0)` })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, chapter.id));
      const versionNumber = Number(latest?.version ?? 0) + 1;
      const now = new Date();
      const versionId = uuidv7();
      const versionNodeId = uuidv7();
      const contentHash = createHash("sha256").update(input.content).digest("hex");
      const wordCount = countWords(input.content);
      const source = input.step === "draft" ? "generated_draft" : "generated_revised";
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: chapter.workId,
        branchId: chapter.branchId,
        userId: input.payload.actorId,
        parentNodeId: branch.headNodeId,
        nodeType: "chapter_version",
        objectType: "chapter",
        objectId: chapter.id,
        objectVersion: versionNumber,
        payload: {
          contentHash,
          wordCount,
          source,
          jobId: input.payload.jobId,
          step: input.step,
        },
        actorId: input.payload.actorId,
        message: input.step === "draft" ? "保存生成草稿" : "保存修订稿",
        createdAt: now,
      });
      await transaction.insert(chapterVersions).values({
        id: versionId,
        workId: chapter.workId,
        branchId: chapter.branchId,
        userId: input.payload.actorId,
        chapterId: chapter.id,
        version: versionNumber,
        content: input.content,
        contentHash,
        versionNodeId,
        source,
        generationJobId: input.payload.jobId,
        generationStep: input.step,
        createdAt: now,
      });
      await transaction
        .update(chapters)
        .set({
          status: "writing",
          currentVersionId: versionId,
          wordCount,
          version: chapter.version + 1,
          updatedAt: now,
        })
        .where(eq(chapters.id, chapter.id));
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, branch.id));
      return { id: versionId, version: versionNumber };
    });
  }

  async recordAgentRun(input: {
    payload: GenerateChapterJob;
    step: "draft" | "verify" | "revise";
    role: string;
    inputHash: string;
    output: string;
    citations: unknown[];
    usage: Record<string, unknown>;
    startedAt: Date;
  }): Promise<void> {
    await this.withTenant(input.payload.actorId, async (transaction) => {
      await transaction
        .insert(agentRuns)
        .values({
          id: uuidv7(),
          jobId: input.payload.jobId,
          workId: input.payload.workId,
          branchId: input.payload.branchId,
          userId: input.payload.actorId,
          stepKey: input.step,
          role: input.role,
          status: "succeeded",
          inputHash: input.inputHash,
          output: input.output,
          citations: input.citations,
          usage: input.usage,
          startedAt: input.startedAt,
          finishedAt: new Date(),
        })
        .onConflictDoNothing();
    });
  }

  async beginModelCall(input: {
    payload: GenerateChapterJob;
    step: "draft" | "verify" | "revise";
    attempt: number;
    role: "writer" | "critic" | "reviser";
    prompt: string;
    system: string;
    citations: unknown[];
    estimatedTokens: number;
    estimatedCostCny: number;
    parameters: Record<string, unknown>;
  }): Promise<StartedModelCall> {
    return this.withTenant(input.payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.payload.jobId), eq(jobs.userId, input.payload.actorId)))
        .for("update")
        .limit(1);
      if (!job) {
        throw new Error("Generation job no longer exists");
      }
      const [modelConfig] = await transaction
        .select()
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.id, input.payload.modelConfigId),
            eq(modelConfigs.userId, input.payload.actorId),
          ),
        )
        .limit(1);
      if (!modelConfig) {
        throw new Error("Model configuration no longer exists");
      }

      const now = new Date();
      const promptHash = sha256(input.prompt);
      const systemHash = sha256(input.system);
      const inputHash = sha256(`${input.system}\u0000${input.prompt}`);
      const promptVersion = await upsertPromptVersion(transaction, {
        payload: input.payload,
        step: input.step,
        role: input.role,
        promptHash,
        systemHash,
        inputHash,
        now,
      });
      const run = await upsertAgentRun(transaction, {
        payload: input.payload,
        step: input.step,
        role: input.role,
        promptVersionId: promptVersion.id,
        modelConfigId: modelConfig.id,
        provider: modelConfig.provider,
        model: modelConfig.model,
        inputHash,
        inputSummary: {
          promptBytes: Buffer.byteLength(input.prompt, "utf8"),
          systemBytes: Buffer.byteLength(input.system, "utf8"),
        },
        citations: input.citations,
        now,
      });
      const reservationKey = `generation:${input.step}:attempt:${input.attempt}`;
      const reservation = await reserveBudgetInTransaction(transaction, {
        userId: input.payload.actorId,
        workId: input.payload.workId,
        branchId: input.payload.branchId,
        jobId: input.payload.jobId,
        agentRunId: run.id,
        idempotencyKey: reservationKey,
        estimatedTokens: input.estimatedTokens,
        estimatedCostCny: input.estimatedCostCny,
        now,
      });
      const [modelCall] = await transaction
        .insert(modelCalls)
        .values({
          id: uuidv7(),
          userId: input.payload.actorId,
          workId: input.payload.workId,
          branchId: input.payload.branchId,
          chapterId: input.payload.chapterId,
          jobId: input.payload.jobId,
          agentRunId: run.id,
          promptVersionId: promptVersion.id,
          costReservationId: reservation.reservation.id,
          stepKey: input.step,
          attempt: input.attempt,
          status: "started",
          provider: modelConfig.provider,
          model: modelConfig.model,
          parameters: input.parameters,
          configHash: sha256(
            `${modelConfig.provider}\u0000${modelConfig.model}\u0000${modelConfig.baseUrl}\u0000${modelConfig.version}`,
          ),
          inputHash,
          inputSummary: {
            promptBytes: Buffer.byteLength(input.prompt, "utf8"),
            systemBytes: Buffer.byteLength(input.system, "utf8"),
            estimatedTokens: input.estimatedTokens,
          },
          inputTokens: 0,
          outputTokens: 0,
          costCny: 0,
          startedAt: now,
        })
        .returning({ id: modelCalls.id });
      if (!modelCall) {
        throw new Error("Model call insert returned no row");
      }
      return {
        runId: run.id,
        promptVersionId: promptVersion.id,
        modelCallId: modelCall.id,
        reservationId: reservation.reservation.id,
        reservationKey,
        attempt: input.attempt,
      };
    });
  }

  async completeModelCall(input: {
    payload: GenerateChapterJob;
    step: "draft" | "verify" | "revise";
    call: StartedModelCall;
    result: GenerationResult;
  }): Promise<void> {
    const inputTokens = input.result.usage.inputTokens;
    const outputTokens = input.result.usage.outputTokens;
    const totalTokens = inputTokens + outputTokens;
    const costCny = calculateCost(totalTokens);
    const outputHash = sha256(input.result.text);
    await this.withTenant(input.payload.actorId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, input.payload.jobId), eq(jobs.userId, input.payload.actorId)))
        .for("update")
        .limit(1);
      if (!job) {
        throw new Error("Generation job no longer exists");
      }
      await settleBudgetInTransaction(transaction, {
        userId: input.payload.actorId,
        jobId: input.payload.jobId,
        idempotencyKey: input.call.reservationKey,
        actualTokens: totalTokens,
        actualCostCny: costCny,
      });
      const now = new Date();
      await transaction
        .update(modelCalls)
        .set({
          status: "succeeded",
          outputHash,
          outputSummary: {
            outputBytes: Buffer.byteLength(input.result.text, "utf8"),
            finishReason: input.result.finishReason,
          },
          inputTokens,
          outputTokens,
          costCny,
          providerRequestId: input.result.providerRequestId ?? null,
          finishedAt: now,
        })
        .where(eq(modelCalls.id, input.call.modelCallId));
      await transaction
        .update(agentRuns)
        .set({
          status: "succeeded",
          outputHash,
          outputSummary: {
            outputBytes: Buffer.byteLength(input.result.text, "utf8"),
          },
          usage: { inputTokens, outputTokens, costCny },
          failureClass: null,
          escalationReason: null,
          finishedAt: now,
        })
        .where(eq(agentRuns.id, input.call.runId));
      await transaction
        .insert(usageRecords)
        .values({
          id: uuidv7(),
          userId: input.payload.actorId,
          workId: input.payload.workId,
          jobId: input.payload.jobId,
          stepKey: input.step,
          model: input.result.model,
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          costCny,
        })
        .onConflictDoNothing();
    });
  }

  async failModelCall(input: {
    payload: GenerateChapterJob;
    step: "draft" | "verify" | "revise";
    call: StartedModelCall;
    failureClass: string;
    errorCode: string;
    message: string;
    escalationReason: string;
  }): Promise<void> {
    await this.withTenant(input.payload.actorId, async (transaction) => {
      await releaseBudgetInTransaction(transaction, {
        userId: input.payload.actorId,
        jobId: input.payload.jobId,
        idempotencyKey: input.call.reservationKey,
        failureClass: input.failureClass as
          | "provider"
          | "timeout"
          | "rate_limit"
          | "schema"
          | "policy"
          | "budget"
          | "cancelled"
          | "unknown",
      });
      const now = new Date();
      await transaction
        .update(modelCalls)
        .set({
          status: "failed",
          failureClass: input.failureClass,
          errorCode: input.errorCode,
          escalationReason: input.escalationReason,
          finishedAt: now,
        })
        .where(eq(modelCalls.id, input.call.modelCallId));
      await transaction
        .update(agentRuns)
        .set({
          status: "failed",
          failureClass: input.failureClass,
          escalationReason: input.escalationReason,
          finishedAt: now,
        })
        .where(eq(agentRuns.id, input.call.runId));
    });
  }

  async recordBudgetFailure(input: {
    payload: GenerateChapterJob;
    step: "draft" | "verify" | "revise";
    attempt: number;
    role: "writer" | "critic" | "reviser";
    prompt: string;
    system: string;
    estimatedTokens: number;
    estimatedCostCny: number;
    errorCode: string;
    message: string;
    escalationReason: string;
  }): Promise<void> {
    await this.withTenant(input.payload.actorId, async (transaction) => {
      const now = new Date();
      const promptHash = sha256(input.prompt);
      const systemHash = sha256(input.system);
      const inputHash = sha256(`${input.system}\u0000${input.prompt}`);
      const promptVersion = await upsertPromptVersion(transaction, {
        payload: input.payload,
        step: input.step,
        role: input.role,
        promptHash,
        systemHash,
        inputHash,
        now,
      });
      const [modelConfig] = await transaction
        .select()
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.id, input.payload.modelConfigId),
            eq(modelConfigs.userId, input.payload.actorId),
          ),
        )
        .limit(1);
      const run = await upsertAgentRun(transaction, {
        payload: input.payload,
        step: input.step,
        role: input.role,
        promptVersionId: promptVersion.id,
        modelConfigId: modelConfig?.id ?? null,
        provider: modelConfig?.provider ?? "unknown",
        model: modelConfig?.model ?? "unknown",
        inputHash,
        inputSummary: {
          promptBytes: Buffer.byteLength(input.prompt, "utf8"),
          systemBytes: Buffer.byteLength(input.system, "utf8"),
        },
        citations: [],
        now,
      });
      const [reservation] = await transaction
        .insert(costReservations)
        .values({
          id: uuidv7(),
          userId: input.payload.actorId,
          workId: input.payload.workId,
          branchId: input.payload.branchId,
          jobId: input.payload.jobId,
          agentRunId: run.id,
          idempotencyKey: `generation:${input.step}:attempt:${input.attempt}`,
          status: "released",
          reservedTokens: input.estimatedTokens,
          reservedCostCny: input.estimatedCostCny,
          settledTokens: 0,
          settledCostCny: 0,
          failureClass: "budget",
          createdAt: now,
        })
        .returning({ id: costReservations.id });
      if (!reservation) {
        throw new Error("Budget failure reservation insert returned no row");
      }
      await transaction.insert(modelCalls).values({
        id: uuidv7(),
        userId: input.payload.actorId,
        workId: input.payload.workId,
        branchId: input.payload.branchId,
        chapterId: input.payload.chapterId,
        jobId: input.payload.jobId,
        agentRunId: run.id,
        promptVersionId: promptVersion.id,
        costReservationId: reservation.id,
        stepKey: input.step,
        attempt: input.attempt,
        status: "failed",
        provider: modelConfig?.provider ?? "unknown",
        model: modelConfig?.model ?? "unknown",
        parameters: { operation: input.step },
        configHash: sha256(
          `${modelConfig?.provider ?? "unknown"}\u0000${modelConfig?.model ?? "unknown"}\u0000${modelConfig?.baseUrl ?? ""}\u0000${modelConfig?.version ?? 0}`,
        ),
        inputHash,
        inputSummary: {
          promptBytes: Buffer.byteLength(input.prompt, "utf8"),
          systemBytes: Buffer.byteLength(input.system, "utf8"),
        },
        inputTokens: 0,
        outputTokens: 0,
        costCny: 0,
        failureClass: "budget",
        errorCode: input.errorCode,
        escalationReason: input.escalationReason,
        startedAt: now,
        finishedAt: now,
      });
      await transaction
        .update(agentRuns)
        .set({
          status: "failed",
          failureClass: "budget",
          escalationReason: input.escalationReason,
          finishedAt: now,
        })
        .where(eq(agentRuns.id, run.id));
    });
  }

  async recordUsage(input: {
    payload: GenerateChapterJob;
    step: "draft" | "verify" | "revise";
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCny: number;
  }): Promise<void> {
    await this.withTenant(input.payload.actorId, async (transaction) => {
      await transaction
        .insert(usageRecords)
        .values({
          id: uuidv7(),
          userId: input.payload.actorId,
          workId: input.payload.workId,
          jobId: input.payload.jobId,
          stepKey: input.step,
          model: input.model,
          promptTokens: input.inputTokens,
          completionTokens: input.outputTokens,
          costCny: input.costCny,
        })
        .onConflictDoNothing();
    });
  }

  async findStepOutput(
    payload: GenerateChapterJob,
    step: string,
  ): Promise<Record<string, unknown> | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [record] = await transaction
        .select({ output: jobSteps.output })
        .from(jobSteps)
        .where(and(eq(jobSteps.jobId, payload.jobId), eq(jobSteps.stepKey, step)))
        .limit(1);
      return record?.output;
    });
  }

  async findGeneratedDraft(payload: GenerateChapterJob): Promise<string | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [version] = await transaction
        .select({ content: chapterVersions.content })
        .from(chapterVersions)
        .where(
          and(
            eq(chapterVersions.generationJobId, payload.jobId),
            eq(chapterVersions.generationStep, "draft"),
          ),
        )
        .limit(1);
      return version?.content;
    });
  }

  async findLatestGeneratedVersion(
    payload: GenerateChapterJob,
  ): Promise<{ id: string; content: string } | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [version] = await transaction
        .select({ id: chapterVersions.id, content: chapterVersions.content })
        .from(chapterVersions)
        .where(eq(chapterVersions.generationJobId, payload.jobId))
        .orderBy(desc(chapterVersions.version))
        .limit(1);
      return version;
    });
  }

  async persistFactProposals(input: {
    payload: GenerateChapterJob;
    sourceVersionId: string;
    candidates: FactProposalCandidate[];
  }): Promise<string[]> {
    return this.withTenant(input.payload.actorId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.payload.chapterId}))`,
      );
      const [actor] = await transaction
        .select({ displayName: users.displayName })
        .from(users)
        .where(and(eq(users.id, input.payload.actorId), isNull(users.deletedAt)))
        .limit(1);
      if (!actor) {
        throw new Error("Generation actor no longer exists");
      }
      const proposals = await refreshFactProposals(transaction, {
        workId: input.payload.workId,
        branchId: input.payload.branchId,
        userId: input.payload.actorId,
        chapterId: input.payload.chapterId,
        sourceVersionId: input.sourceVersionId,
        actorName: actor.displayName,
        candidates: input.candidates,
        newId: uuidv7,
      });
      return proposals
        .filter((proposal) => proposal.sourceVersionId === input.sourceVersionId)
        .map((proposal) => proposal.id);
    });
  }

  async loadContextPack(
    payload: GenerateChapterJob,
    contextPackId: string,
  ): Promise<ContextPackManifest | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [pack] = await transaction
        .select()
        .from(contextPackVersions)
        .where(
          and(
            eq(contextPackVersions.id, contextPackId),
            eq(contextPackVersions.jobId, payload.jobId),
            eq(contextPackVersions.userId, payload.actorId),
          ),
        )
        .limit(1);
      if (!pack) {
        return undefined;
      }
      const snapshot = pack.snapshot as Record<string, unknown>;
      if (typeof snapshot.manifestHash === "string") {
        return contextPackManifestSchema.parse(snapshot);
      }
      const contract = contextPackVersionSchema.parse({
        id: pack.id,
        jobId: pack.jobId,
        version: pack.version,
        compilerVersion: pack.compilerVersion,
        tokenBudget: pack.tokenBudget,
        tokenUsed: pack.tokenUsed,
        selected: pack.selected,
        evicted: pack.evicted,
        sourceRefs: pack.sourceRefs,
        createdAt: pack.createdAt.toISOString(),
      });
      return legacyManifest(payload, contract);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

function legacyManifest(
  payload: GenerateChapterJob,
  contract: {
    compilerVersion: string;
    tokenBudget: number;
    tokenUsed: number;
    selected: ContextPackManifest["selected"];
    evicted: ContextPackManifest["evicted"];
    sourceRefs: ContextPackManifest["sourceRefs"];
  },
): ContextPackManifest {
  const emptyLayer = {
    selectedCount: 0,
    selectedTokens: 0,
    evictedCount: 0,
    evictedTokens: 0,
  };
  return {
    compilerVersion: contract.compilerVersion,
    manifestHash: "0".repeat(64),
    task: "chapter_draft",
    chapterId: payload.chapterId,
    chapterNumber: 1,
    povCharacterId: null,
    branchId: payload.branchId,
    tokenBudget: contract.tokenBudget,
    tokenUsed: contract.tokenUsed,
    effectiveTokenBudget: contract.tokenBudget,
    selected: contract.selected,
    evicted: contract.evicted,
    sourceRefs: contract.sourceRefs,
    budget: {
      requestedTokenBudget: contract.tokenBudget,
      effectiveTokenBudget: contract.tokenBudget,
      modelContextWindowTokens: null,
      reservedOutputTokens: 0,
      tokenUsed: contract.tokenUsed,
      tokenRemaining: Math.max(0, contract.tokenBudget - contract.tokenUsed),
      tokenEstimator: "legacy",
      layers: {
        P0: emptyLayer,
        P1: emptyLayer,
        P2: emptyLayer,
        P3: emptyLayer,
        P4: emptyLayer,
      },
    },
  };
}

async function appendEvent(
  transaction: DatabaseTransaction,
  job: JobRecord,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const [latest] = await transaction
    .select({ sequence: sql<number>`coalesce(max(${jobEvents.sequence}), 0)` })
    .from(jobEvents)
    .where(eq(jobEvents.jobId, job.id));
  await transaction.insert(jobEvents).values({
    id: uuidv7(),
    jobId: job.id,
    workId: job.workId,
    branchId: job.branchId,
    userId: job.userId,
    sequence: Number(latest?.sequence ?? 0) + 1,
    eventType,
    payload,
    occurredAt: new Date(),
  });
}

function countWords(content: string): number {
  return Array.from(content.replace(/\s/gu, "")).length;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function calculateCost(tokens: number): number {
  return Number((tokens * M0_COST_PER_TOKEN_CNY).toFixed(8));
}

async function upsertPromptVersion(
  transaction: DatabaseTransaction,
  input: {
    payload: GenerateChapterJob;
    step: string;
    role: "writer" | "critic" | "reviser";
    promptHash: string;
    systemHash: string;
    inputHash: string;
    now: Date;
  },
): Promise<{ id: string }> {
  const key = `generation.${input.step}`;
  const [existing] = await transaction
    .select({ id: promptVersions.id })
    .from(promptVersions)
    .where(
      and(
        eq(promptVersions.jobId, input.payload.jobId),
        eq(promptVersions.stepKey, input.step),
        eq(promptVersions.key, key),
        eq(promptVersions.promptHash, input.promptHash),
      ),
    )
    .limit(1);
  if (existing) {
    return existing;
  }
  const [latest] = await transaction
    .select({ version: sql<number>`coalesce(max(${promptVersions.version}), 0)` })
    .from(promptVersions)
    .where(
      and(
        eq(promptVersions.jobId, input.payload.jobId),
        eq(promptVersions.stepKey, input.step),
        eq(promptVersions.key, key),
      ),
    );
  const [created] = await transaction
    .insert(promptVersions)
    .values({
      id: uuidv7(),
      jobId: input.payload.jobId,
      workId: input.payload.workId,
      branchId: input.payload.branchId,
      userId: input.payload.actorId,
      stepKey: input.step,
      key,
      version: Number(latest?.version ?? 0) + 1,
      role: input.role,
      promptHash: input.promptHash,
      systemHash: input.systemHash,
      inputHash: input.inputHash,
      createdBy: input.payload.actorId,
      createdAt: input.now,
    })
    .returning({ id: promptVersions.id });
  if (!created) {
    throw new Error("Prompt version insert returned no row");
  }
  return created;
}

async function upsertAgentRun(
  transaction: DatabaseTransaction,
  input: {
    payload: GenerateChapterJob;
    step: string;
    role: "writer" | "critic" | "reviser";
    promptVersionId: string;
    modelConfigId: string | null;
    provider: string;
    model: string;
    inputHash: string;
    inputSummary: Record<string, unknown>;
    citations: unknown[];
    now: Date;
  },
): Promise<{ id: string }> {
  const [existing] = await transaction
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(eq(agentRuns.jobId, input.payload.jobId), eq(agentRuns.stepKey, input.step)))
    .limit(1);
  if (existing) {
    await transaction
      .update(agentRuns)
      .set({
        chapterId: input.payload.chapterId,
        promptVersionId: input.promptVersionId,
        modelConfigId: input.modelConfigId,
        role: input.role,
        status: "running",
        provider: input.provider,
        model: input.model,
        inputHash: input.inputHash,
        inputSummary: input.inputSummary,
        citations: input.citations,
        output: "",
        outputHash: null,
        outputSummary: {},
        usage: {},
        failureClass: null,
        escalationReason: null,
        startedAt: input.now,
        finishedAt: null,
      })
      .where(eq(agentRuns.id, existing.id));
    return existing;
  }
  const [created] = await transaction
    .insert(agentRuns)
    .values({
      id: uuidv7(),
      jobId: input.payload.jobId,
      workId: input.payload.workId,
      branchId: input.payload.branchId,
      userId: input.payload.actorId,
      chapterId: input.payload.chapterId,
      promptVersionId: input.promptVersionId,
      modelConfigId: input.modelConfigId,
      stepKey: input.step,
      role: input.role,
      status: "running",
      provider: input.provider,
      model: input.model,
      inputHash: input.inputHash,
      inputSummary: input.inputSummary,
      output: "",
      citations: input.citations,
      usage: {},
      startedAt: input.now,
    })
    .returning({ id: agentRuns.id });
  if (!created) {
    throw new Error("Agent run insert returned no row");
  }
  return created;
}
