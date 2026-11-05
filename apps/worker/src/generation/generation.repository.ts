import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  contextPackVersionSchema,
  type GenerateChapterJob,
  type GenerationCost,
} from "@novel-brain/contracts";
import {
  agentRuns,
  chapterVersions,
  chapters,
  contextPackVersions,
  createDatabaseClient,
  createDatabasePool,
  entities,
  jobCheckpoints,
  jobEvents,
  jobSteps,
  jobs,
  modelConfigs,
  storyBibles,
  usageRecords,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type { ChapterContextInput, CompiledContextPack } from "@novel-brain/core";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
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
  storyBible: InferSelectModel<typeof storyBibles>;
  settings: Array<InferSelectModel<typeof entities>>;
  previousVersions: ChapterContextInput["previousVersions"];
}

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

  async loadJob(payload: GenerateChapterJob): Promise<LoadedGenerationJob | undefined> {
    return this.withTenant(payload.actorId, async (transaction) => {
      const [row] = await transaction
        .select({ job: jobs, modelConfig: modelConfigs })
        .from(jobs)
        .innerJoin(
          modelConfigs,
          and(
            eq(modelConfigs.id, jobs.modelConfigId),
            eq(modelConfigs.userId, jobs.userId),
            isNull(modelConfigs.deletedAt),
          ),
        )
        .innerJoin(works, and(eq(works.id, jobs.workId), eq(works.userId, jobs.userId)))
        .where(
          and(
            eq(jobs.id, payload.jobId),
            eq(jobs.userId, payload.actorId),
            eq(jobs.workId, payload.workId),
            eq(jobs.branchId, payload.branchId),
            eq(jobs.chapterId, payload.chapterId),
            eq(jobs.modelConfigId, payload.modelConfigId),
            eq(jobs.idempotencyKey, payload.idempotencyKey),
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
      return { chapter, storyBible, settings, previousVersions };
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
      const [existing] = await transaction
        .select()
        .from(jobSteps)
        .where(and(eq(jobSteps.jobId, payload.jobId), eq(jobSteps.stepKey, step)))
        .limit(1);
      const now = new Date();
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
      const now = new Date();
      await transaction
        .update(jobSteps)
        .set({
          status: "succeeded",
          output: input.output,
          cost: input.cost,
          finishedAt: now,
        })
        .where(and(eq(jobSteps.jobId, input.payload.jobId), eq(jobSteps.stepKey, input.step)));
      const nextCost = addCost(job.cost as Partial<GenerationCost>, input.cost);
      const checkpoint = { step: input.step, payload: input.checkpointPayload };
      const [updated] = await transaction
        .update(jobs)
        .set({
          progress: input.progress,
          currentStep: input.step,
          checkpoint,
          cost: nextCost,
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
        payload: checkpoint,
        createdAt: now,
      });
      await appendEvent(transaction, updated, "job.step.succeeded", {
        step: input.step,
        progress: input.progress,
        checkpoint,
      });
      await appendEvent(transaction, updated, "job.progress", {
        step: input.step,
        progress: input.progress,
        cost: nextCost,
      });
      return updated;
    });
  }

  async failStep(input: {
    payload: GenerateChapterJob;
    step: string;
    code: string;
    message: string;
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
      const now = new Date();
      const previousCheckpoint = job.checkpoint as { payload?: Record<string, unknown> };
      const checkpoint = {
        step: input.step,
        payload: previousCheckpoint.payload ?? {},
      };
      await transaction
        .update(jobSteps)
        .set({
          status: "failed",
          errorCode: input.code,
          errorMessage: input.message,
          finishedAt: now,
        })
        .where(and(eq(jobSteps.jobId, input.payload.jobId), eq(jobSteps.stepKey, input.step)));
      await transaction.insert(jobCheckpoints).values({
        id: uuidv7(),
        jobId: job.id,
        workId: job.workId,
        branchId: job.branchId,
        userId: job.userId,
        stepKey: input.step,
        payload: checkpoint,
        createdAt: now,
      });
      const [failed] = await transaction
        .update(jobs)
        .set({
          status: "failed",
          currentStep: input.step,
          checkpoint,
          errorCode: input.code,
          errorMessage: input.message,
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      if (!failed) {
        return;
      }
      await appendEvent(transaction, failed, "job.step.failed", {
        step: input.step,
        error: { code: input.code, message: input.message },
        checkpoint,
      });
      await appendEvent(transaction, failed, "job.failed", {
        status: "failed",
        error: { code: input.code, message: input.message },
        checkpoint,
      });
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
          status: "completed",
          progress: 100,
          currentStep: "revise",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, job.id))
        .returning();
      if (!completed) {
        return;
      }
      await appendEvent(transaction, completed, "job.completed", {
        status: "completed",
        progress: 100,
        checkpoint: completed.checkpoint,
      });
    });
  }

  async persistContextPack(input: {
    payload: GenerateChapterJob;
    pack: CompiledContextPack;
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
        snapshot: {
          compilerVersion: input.pack.compilerVersion,
          tokenBudget: input.pack.tokenBudget,
          tokenUsed: input.pack.tokenUsed,
          selected: input.pack.selected,
          evicted: input.pack.evicted,
          sourceRefs: input.pack.sourceRefs,
        },
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
      await transaction.insert(agentRuns).values({
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
      });
    });
  }

  async recordUsage(input: {
    payload: GenerateChapterJob;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costCny: number;
  }): Promise<void> {
    await this.withTenant(input.payload.actorId, async (transaction) => {
      await transaction.insert(usageRecords).values({
        id: uuidv7(),
        userId: input.payload.actorId,
        workId: input.payload.workId,
        jobId: input.payload.jobId,
        model: input.model,
        promptTokens: input.inputTokens,
        completionTokens: input.outputTokens,
        costCny: input.costCny,
      });
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

  async loadContextPack(
    payload: GenerateChapterJob,
    contextPackId: string,
  ): Promise<CompiledContextPack | undefined> {
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
      return {
        compilerVersion: contract.compilerVersion,
        tokenBudget: contract.tokenBudget,
        tokenUsed: contract.tokenUsed,
        selected: contract.selected,
        evicted: contract.evicted,
        sourceRefs: contract.sourceRefs,
      };
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

function addCost(current: Partial<GenerationCost>, delta: GenerationCost): GenerationCost {
  const inputTokens = Number(current.inputTokens ?? 0) + delta.inputTokens;
  const outputTokens = Number(current.outputTokens ?? 0) + delta.outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    costCny: Number((Number(current.costCny ?? 0) + delta.costCny).toFixed(8)),
  };
}

function countWords(content: string): number {
  return Array.from(content.replace(/\s/gu, "")).length;
}
