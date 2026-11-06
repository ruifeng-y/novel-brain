import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  chapterVersions,
  chapters,
  contextPackVersions,
  createDatabaseClient,
  createDatabasePool,
  entities,
  facts as canonicalFacts,
  jobEvents,
  jobs,
  modelConfigs,
  storyBibles,
  storyBibleVersions,
  storyBibleWorldRules,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type {
  ContextPackEviction,
  ContextPackSelected,
  ContextSourceRef,
  GenerateChapterRequest,
} from "@novel-brain/contracts";
import { GENERATE_CHAPTER_JOB } from "@novel-brain/contracts";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type JobRecord = InferSelectModel<typeof jobs>;
export type ContextPackRecord = InferSelectModel<typeof contextPackVersions>;
export type JobEventRecord = InferSelectModel<typeof jobEvents>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface GenerationWorkContext {
  workId: string;
  branchId: string;
  chapterId: string;
}

export interface GenerationBranchContext {
  workId: string;
  branchId: string;
}

export interface GenerationSources {
  chapter: InferSelectModel<typeof chapters>;
  storyBible: InferSelectModel<typeof storyBibles>;
  worldRules: Array<{
    id: string;
    name: string;
    constraint: string;
    scope: string;
    exceptions: string[];
  }>;
  styleSample?: string;
  settings: GenerationSettingSource[];
  previousVersions: Array<{
    chapterId: string;
    chapterNumber: number;
    chapterTitle: string;
    versionId: string;
    content: string;
  }>;
  modelConfig: InferSelectModel<typeof modelConfigs>;
}

export interface GenerationSettingSource {
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
}

export interface JobWithContextPack {
  job: JobRecord;
  contextPack: ContextPackRecord | null;
}

export interface PersistedContextPack {
  compilerVersion: string;
  tokenBudget: number;
  tokenUsed: number;
  selected: ContextPackSelected[];
  evicted: ContextPackEviction[];
  sourceRefs: ContextSourceRef[];
}

const factSourceChapters = alias(chapters, "fact_source_chapters");

@Injectable()
export class GenerationRepository implements OnModuleDestroy {
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

  async findWorkContext(userId: string, context: GenerationWorkContext): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [row] = await transaction
        .select({ id: chapters.id })
        .from(chapters)
        .innerJoin(works, and(eq(works.id, chapters.workId), eq(works.userId, chapters.userId)))
        .innerJoin(
          workBranches,
          and(
            eq(workBranches.id, chapters.branchId),
            eq(workBranches.workId, chapters.workId),
            eq(workBranches.userId, chapters.userId),
          ),
        )
        .where(
          and(
            eq(chapters.id, context.chapterId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.userId, userId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      return Boolean(row);
    });
  }

  async loadSources(
    userId: string,
    context: GenerationWorkContext,
  ): Promise<GenerationSources | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [chapter] = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, context.chapterId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.userId, userId),
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
            eq(storyBibles.workId, context.workId),
            eq(storyBibles.branchId, context.branchId),
            eq(storyBibles.userId, userId),
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
            eq(storyBibleVersions.userId, userId),
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
                eq(storyBibleWorldRules.userId, userId),
              ),
            )
            .orderBy(asc(storyBibleWorldRules.name))
        : [];
      const [work] = await transaction
        .select({ settings: works.settings })
        .from(works)
        .where(and(eq(works.id, context.workId), eq(works.userId, userId), isNull(works.deletedAt)))
        .limit(1);
      const settings = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.userId, userId),
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
            eq(canonicalFacts.workId, context.workId),
            eq(canonicalFacts.branchId, context.branchId),
            eq(canonicalFacts.userId, userId),
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
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.userId, userId),
            sql`${chapters.number} < ${chapter.number}`,
          ),
        )
        .orderBy(desc(chapters.number))
        .limit(3);
      const configs = await transaction
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
      const modelConfig = configs[0];
      if (!modelConfig) {
        return undefined;
      }
      return {
        chapter,
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
        modelConfig,
      };
    });
  }

  async findByIdempotencyKey(
    userId: string,
    context: GenerationWorkContext,
    idempotencyKey: string,
  ): Promise<JobWithContextPack | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.chapterId, context.chapterId),
            eq(jobs.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (!job) {
        return undefined;
      }
      return { job, contextPack: await this.findContextPack(transaction, job.id) };
    });
  }

  async createQueuedJob(input: {
    userId: string;
    context: GenerationWorkContext;
    modelConfigId: string;
    idempotencyKey: string;
    request: GenerateChapterRequest;
  }): Promise<{ created: boolean; value: JobWithContextPack }> {
    return this.withTenant(input.userId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.context.chapterId}))`,
      );
      const [existing] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, input.userId),
            eq(jobs.chapterId, input.context.chapterId),
            eq(jobs.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          created: false,
          value: {
            job: existing,
            contextPack: await this.findContextPack(transaction, existing.id),
          },
        };
      }
      const now = new Date();
      const [job] = await transaction
        .insert(jobs)
        .values({
          id: uuidv7(),
          workId: input.context.workId,
          branchId: input.context.branchId,
          userId: input.userId,
          chapterId: input.context.chapterId,
          modelConfigId: input.modelConfigId,
          type: "generate_chapter",
          status: "queued",
          progress: 0,
          currentStep: "prepare",
          idempotencyKey: input.idempotencyKey,
          budget: input.request.budget,
          checkpoint: { step: "prepare", payload: {} },
          cost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 },
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!job) {
        throw new Error("Failed to create generation job");
      }
      await appendEvent(transaction, job, "job.created", {
        status: "queued",
        progress: 0,
        currentStep: "prepare",
      });
      return { created: true, value: { job, contextPack: null } };
    });
  }

  async findJob(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
  ): Promise<JobWithContextPack | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, GENERATE_CHAPTER_JOB),
          ),
        )
        .limit(1);
      if (!job) {
        return undefined;
      }
      return { job, contextPack: await this.findContextPack(transaction, job.id) };
    });
  }

  async listJobs(userId: string, context: GenerationWorkContext): Promise<JobWithContextPack[]> {
    return this.withTenant(userId, async (transaction) => {
      const records = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, GENERATE_CHAPTER_JOB),
            eq(jobs.chapterId, context.chapterId),
          ),
        )
        .orderBy(desc(jobs.createdAt));
      if (records.length === 0) {
        return [];
      }
      const packs = await transaction
        .select()
        .from(contextPackVersions)
        .where(
          inArray(
            contextPackVersions.jobId,
            records.map((record) => record.id),
          ),
        )
        .orderBy(desc(contextPackVersions.version));
      return records.map((job) => ({
        job,
        contextPack: packs.find((pack) => pack.jobId === job.id) ?? null,
      }));
    });
  }

  async findLatestContextPack(
    userId: string,
    context: GenerationWorkContext,
  ): Promise<ContextPackRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [pack] = await transaction
        .select()
        .from(contextPackVersions)
        .where(
          and(
            eq(contextPackVersions.userId, userId),
            eq(contextPackVersions.workId, context.workId),
            eq(contextPackVersions.branchId, context.branchId),
            eq(contextPackVersions.chapterId, context.chapterId),
          ),
        )
        .orderBy(desc(contextPackVersions.createdAt))
        .limit(1);
      return pack;
    });
  }

  async cancelJob(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
  ): Promise<JobWithContextPack | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, GENERATE_CHAPTER_JOB),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return undefined;
      }
      if (isTerminal(current.status)) {
        return { job: current, contextPack: await this.findContextPack(transaction, current.id) };
      }
      const now = new Date();
      const [job] = await transaction
        .update(jobs)
        .set({
          status: "cancelled",
          errorCode: "JOB_CANCELLED",
          errorMessage: "生成已取消，已完成的草稿和检查点已保留",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, current.id))
        .returning();
      if (!job) {
        throw new Error("Failed to cancel generation job");
      }
      await appendEvent(transaction, job, "job.canceled", {
        status: "cancelled",
        checkpoint: job.checkpoint,
      });
      return { job, contextPack: await this.findContextPack(transaction, job.id) };
    });
  }

  async retryJob(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
  ): Promise<JobWithContextPack | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.type, GENERATE_CHAPTER_JOB),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return undefined;
      }
      if (current.status !== "failed" && current.status !== "cancelled") {
        return { job: current, contextPack: await this.findContextPack(transaction, current.id) };
      }
      const now = new Date();
      const [job] = await transaction
        .update(jobs)
        .set({
          status: "queued",
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, current.id))
        .returning();
      if (!job) {
        throw new Error("Failed to retry generation job");
      }
      await appendEvent(transaction, job, "job.resumed", {
        status: "queued",
        checkpoint: job.checkpoint,
      });
      return { job, contextPack: await this.findContextPack(transaction, job.id) };
    });
  }

  async listEvents(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
    lastEventId?: string,
  ): Promise<JobEventRecord[]> {
    return this.withTenant(userId, async (transaction) => {
      let afterSequence = 0;
      if (lastEventId) {
        const [lastEvent] = await transaction
          .select({ sequence: jobEvents.sequence })
          .from(jobEvents)
          .where(
            and(
              eq(jobEvents.id, lastEventId),
              eq(jobEvents.jobId, jobId),
              eq(jobEvents.userId, userId),
            ),
          )
          .limit(1);
        afterSequence = lastEvent?.sequence ?? 0;
      }
      return transaction
        .select()
        .from(jobEvents)
        .where(
          and(
            eq(jobEvents.jobId, jobId),
            eq(jobEvents.userId, userId),
            eq(jobEvents.workId, context.workId),
            eq(jobEvents.branchId, context.branchId),
            gt(jobEvents.sequence, afterSequence),
          ),
        )
        .orderBy(asc(jobEvents.sequence));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async findContextPack(
    transaction: DatabaseTransaction,
    jobId: string,
  ): Promise<ContextPackRecord | null> {
    const [pack] = await transaction
      .select()
      .from(contextPackVersions)
      .where(eq(contextPackVersions.jobId, jobId))
      .orderBy(desc(contextPackVersions.version))
      .limit(1);
    return pack ?? null;
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

export function isTerminal(status: string): boolean {
  return (
    status === "completed" ||
    status === "waiting_review" ||
    status === "failed" ||
    status === "cancelled"
  );
}
