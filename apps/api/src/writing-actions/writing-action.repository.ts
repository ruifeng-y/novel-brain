import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapterVersions,
  chapters,
  contextPackVersions,
  createDatabaseClient,
  createDatabasePool,
  jobCheckpoints,
  jobEvents,
  jobRecoveries,
  jobSteps,
  jobs,
  modelConfigs,
  workBranches,
  writingActions,
  type DatabaseClient,
} from "@novel-brain/db";
import {
  WRITE_ACTION_JOB,
  WRITING_ACTION_STEPS,
  contextPackManifestSchema,
  contextPackVersionSchema,
  writingActionCheckpointSchema,
  writingActionJobSchema,
  writingActionOutputSchema,
  writeActionJobSchema,
  type ContextPackVersion,
  type JobEvent,
  type JobRecoveryRequest,
  type WriteActionJob,
  type WritingActionJob,
  type WritingActionRequest,
} from "@novel-brain/contracts";
import { resolveRecoveryStep, type RecoveryStepStatus } from "@novel-brain/core";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type WritingActionJobRecord = InferSelectModel<typeof jobs>;
export type WritingActionOutputRecord = InferSelectModel<typeof writingActions>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface WritingActionWorkContext {
  workId: string;
  branchId: string;
  chapterId: string;
}

export interface WritingActionBranchContext {
  workId: string;
  branchId: string;
}

export interface WritingActionAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface WritingActionWithOutput {
  job: WritingActionJobRecord;
  output: WritingActionOutputWithContent | null;
  contextPack: ContextPackVersion | null;
}

export interface WritingActionOutputWithContent {
  row: WritingActionOutputRecord;
  chapterContent: string | null;
}

export type WritingActionCreationContext =
  | {
      chapter: InferSelectModel<typeof chapters>;
      sourceVersion: InferSelectModel<typeof chapterVersions>;
      branch: InferSelectModel<typeof workBranches>;
      modelConfigId: string;
    }
  | "not_found"
  | "not_editable"
  | "source_invalid"
  | "branch_stale"
  | "model_missing";

export interface WritingActionRecoveryResult {
  job: WritingActionWithOutput;
  recoveryId: string;
  created: boolean;
}

@Injectable()
export class WritingActionRepository implements OnModuleDestroy {
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

  async loadCreationContext(
    userId: string,
    context: WritingActionWorkContext,
    sourceVersionId: string,
  ): Promise<WritingActionCreationContext> {
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
        return "not_found";
      }
      if (!isChapterEditable(chapter.status)) {
        return "not_editable";
      }
      const [sourceVersion] = await transaction
        .select()
        .from(chapterVersions)
        .where(
          and(
            eq(chapterVersions.id, sourceVersionId),
            eq(chapterVersions.chapterId, chapter.id),
            eq(chapterVersions.workId, context.workId),
            eq(chapterVersions.branchId, context.branchId),
            eq(chapterVersions.userId, userId),
          ),
        )
        .limit(1);
      if (!sourceVersion) {
        return "source_invalid";
      }
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
        .limit(1);
      if (!branch) {
        return "not_found";
      }
      if (branch.status !== "active") {
        return "branch_stale";
      }
      const [modelConfig] = await transaction
        .select({ id: modelConfigs.id })
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
        return "model_missing";
      }
      return {
        chapter,
        sourceVersion,
        branch,
        modelConfigId: modelConfig.id,
      };
    });
  }

  async findByIdempotencyKey(
    userId: string,
    context: WritingActionWorkContext,
    idempotencyKey: string,
  ): Promise<WritingActionWithOutput | undefined> {
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
            eq(jobs.type, WRITE_ACTION_JOB),
            eq(jobs.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      return job ? this.hydrateJob(transaction, job) : undefined;
    });
  }

  async createQueuedJob(input: {
    userId: string;
    context: WritingActionWorkContext;
    modelConfigId: string;
    sourceVersionId: string;
    idempotencyKey: string;
    request: WritingActionRequest;
    audit: WritingActionAuditContext;
  }): Promise<{ created: boolean; value: WritingActionWithOutput }> {
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
            eq(jobs.type, WRITE_ACTION_JOB),
            eq(jobs.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          created: false,
          value: await this.hydrateJob(transaction, existing),
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
          sourceVersionId: input.sourceVersionId,
          modelConfigId: input.modelConfigId,
          type: WRITE_ACTION_JOB,
          status: "queued",
          progress: 0,
          currentStep: "prepare",
          idempotencyKey: input.idempotencyKey,
          action: input.request.action,
          actionInput: input.request,
          budget: input.request.budget,
          checkpoint: {
            schemaVersion: 1,
            revision: 0,
            step: "prepare",
            inputHash: null,
            outputRefs: [],
            payload: {},
          },
          cost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 },
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!job) {
        throw new Error("Failed to create writing action job");
      }
      await appendEvent(transaction, job, "job.created", {
        status: "queued",
        progress: 0,
        currentStep: "prepare",
        action: input.request.action,
      });
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "writing_action.created",
        targetType: "chapter",
        targetId: input.context.chapterId,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        createdAt: now,
      });
      return {
        created: true,
        value: {
          job,
          output: null,
          contextPack: null,
        },
      };
    });
  }

  async get(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
  ): Promise<WritingActionWithOutput | undefined> {
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
            eq(jobs.type, WRITE_ACTION_JOB),
          ),
        )
        .limit(1);
      return job ? this.hydrateJob(transaction, job) : undefined;
    });
  }

  async list(
    userId: string,
    context: WritingActionWorkContext,
  ): Promise<WritingActionWithOutput[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.userId, userId),
            eq(jobs.workId, context.workId),
            eq(jobs.branchId, context.branchId),
            eq(jobs.chapterId, context.chapterId),
            eq(jobs.type, WRITE_ACTION_JOB),
          ),
        )
        .orderBy(desc(jobs.createdAt));
      return Promise.all(rows.map((job) => this.hydrateJob(transaction, job)));
    });
  }

  async cancel(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
  ): Promise<WritingActionWithOutput | undefined> {
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
            eq(jobs.type, WRITE_ACTION_JOB),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return undefined;
      }
      if (["completed", "waiting_review", "failed", "cancelled"].includes(current.status)) {
        return this.hydrateJob(transaction, current);
      }
      const now = new Date();
      const [job] = await transaction
        .update(jobs)
        .set({
          status: "cancelled",
          errorCode: "JOB_CANCELLED",
          errorMessage: "写作动作已取消，原稿和检查点已保留",
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(jobs.id, current.id))
        .returning();
      if (!job) {
        throw new Error("Failed to cancel writing action");
      }
      await appendEvent(transaction, job, "job.canceled", {
        status: "cancelled",
        checkpoint: job.checkpoint,
      });
      return this.hydrateJob(transaction, job);
    });
  }

  async recover(input: {
    userId: string;
    context: WritingActionBranchContext;
    jobId: string;
    request: JobRecoveryRequest;
    audit: WritingActionAuditContext;
  }): Promise<WritingActionRecoveryResult | undefined> {
    return this.withTenant(input.userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.id, input.jobId),
            eq(jobs.userId, input.userId),
            eq(jobs.workId, input.context.workId),
            eq(jobs.branchId, input.context.branchId),
            eq(jobs.type, WRITE_ACTION_JOB),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return undefined;
      }
      const [existing] = await transaction
        .select()
        .from(jobRecoveries)
        .where(
          and(
            eq(jobRecoveries.jobId, current.id),
            eq(jobRecoveries.idempotencyKey, input.request.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          job: await this.hydrateJob(transaction, current),
          recoveryId: existing.id,
          created: false,
        };
      }
      if (!["failed", "cancelled", "paused"].includes(current.status)) {
        throw new WritingActionNotRecoverableError(current.status);
      }
      if (
        input.request.expectedCheckpointVersion !== undefined &&
        input.request.expectedCheckpointVersion !== current.checkpointVersion
      ) {
        throw new WritingActionRecoveryConflictError();
      }
      const steps = await transaction
        .select({ stepKey: jobSteps.stepKey, status: jobSteps.status })
        .from(jobSteps)
        .where(eq(jobSteps.jobId, current.id));
      const resume = resolveRecoveryStep(
        WRITING_ACTION_STEPS,
        steps.map((step) => ({
          stepKey: step.stepKey,
          status: step.status as RecoveryStepStatus,
        })),
      );
      const previousCheckpoint = writingActionCheckpointSchema.parse(current.checkpoint);
      const checkpointVersion = current.checkpointVersion + 1;
      const checkpoint = writingActionCheckpointSchema.parse({
        schemaVersion: 1,
        revision: checkpointVersion,
        step: resume.step,
        inputHash: previousCheckpoint.inputHash,
        outputRefs: previousCheckpoint.outputRefs,
        payload: previousCheckpoint.payload,
      });
      const now = new Date();
      const action = current.status === "paused" ? "resume" : "retry";
      const [job] = await transaction
        .update(jobs)
        .set({
          status: "queued",
          currentStep: resume.step,
          checkpoint,
          checkpointVersion,
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, current.id))
        .returning();
      if (!job) {
        throw new Error("Failed to recover writing action");
      }
      await transaction.insert(jobCheckpoints).values({
        id: uuidv7(),
        jobId: job.id,
        workId: job.workId,
        branchId: job.branchId,
        userId: job.userId,
        stepKey: resume.step,
        schemaVersion: 1,
        revision: checkpointVersion,
        attempt: 0,
        inputHash: previousCheckpoint.inputHash,
        outputRefs: previousCheckpoint.outputRefs,
        payload: checkpoint,
        createdAt: now,
      });
      const [recovery] = await transaction
        .insert(jobRecoveries)
        .values({
          id: uuidv7(),
          jobId: job.id,
          workId: job.workId,
          branchId: job.branchId,
          userId: job.userId,
          actorId: input.userId,
          action,
          reason: input.request.reason,
          idempotencyKey: input.request.idempotencyKey,
          fromStatus: current.status,
          fromCheckpointVersion: current.checkpointVersion,
          checkpointVersion,
          resumeStep: resume.step,
          correlationId: input.audit.requestId,
          createdAt: now,
        })
        .returning();
      if (!recovery) {
        throw new Error("Failed to record writing action recovery");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "writing_action.recovered",
        targetType: "job",
        targetId: job.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        createdAt: now,
      });
      await appendEvent(transaction, job, "job.recovered", {
        status: "queued",
        recoveryId: recovery.id,
        reason: input.request.reason,
        resumeStep: resume.step,
        checkpoint,
      });
      return {
        job: await this.hydrateJob(transaction, job),
        recoveryId: recovery.id,
        created: true,
      };
    });
  }

  async listEvents(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
    lastEventId?: string,
  ): Promise<JobEvent[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select()
        .from(jobEvents)
        .where(
          and(
            eq(jobEvents.jobId, jobId),
            eq(jobEvents.userId, userId),
            eq(jobEvents.workId, context.workId),
            eq(jobEvents.branchId, context.branchId),
            ...(lastEventId ? [gt(jobEvents.id, lastEventId)] : []),
          ),
        )
        .orderBy(jobEvents.sequence);
      return rows.map((row) => ({
        eventId: row.id,
        type: row.eventType as JobEvent["type"],
        occurredAt: row.occurredAt.toISOString(),
        data: row.payload,
      }));
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async hydrateJob(
    transaction: DatabaseTransaction,
    job: WritingActionJobRecord,
  ): Promise<WritingActionWithOutput> {
    const [output] = await transaction
      .select()
      .from(writingActions)
      .where(eq(writingActions.jobId, job.id))
      .limit(1);
    const chapterContent = output?.chapterVersionId
      ? ((
          await transaction
            .select({ content: chapterVersions.content })
            .from(chapterVersions)
            .where(eq(chapterVersions.id, output.chapterVersionId))
            .limit(1)
        )[0]?.content ?? null)
      : null;
    const [contextPack] = await transaction
      .select()
      .from(contextPackVersions)
      .where(eq(contextPackVersions.jobId, job.id))
      .orderBy(desc(contextPackVersions.version))
      .limit(1);
    return {
      job,
      output: output ? { row: output, chapterContent } : null,
      contextPack: contextPack ? contextPackVersionSchemaFromRecord(contextPack) : null,
    };
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

export class WritingActionRecoveryConflictError extends Error {
  constructor() {
    super("Writing action checkpoint changed before recovery");
    this.name = "WritingActionRecoveryConflictError";
  }
}

export class WritingActionNotRecoverableError extends Error {
  constructor(readonly status: string) {
    super(`Writing action in status ${status} cannot be recovered`);
    this.name = "WritingActionNotRecoverableError";
  }
}

function contextPackVersionSchemaFromRecord(
  record: InferSelectModel<typeof contextPackVersions>,
): ContextPackVersion {
  return contextPackVersionSchema.parse({
    id: record.id,
    jobId: record.jobId,
    version: record.version,
    compilerVersion: record.compilerVersion,
    tokenBudget: record.tokenBudget,
    tokenUsed: record.tokenUsed,
    selected: record.selected,
    evicted: record.evicted,
    sourceRefs: record.sourceRefs,
    createdAt: record.createdAt.toISOString(),
    ...manifestSnapshotFields(record.snapshot),
  });
}

function manifestSnapshotFields(snapshot: Record<string, unknown>): Record<string, unknown> {
  if (typeof snapshot.manifestHash !== "string") {
    return {};
  }
  const manifest = contextPackManifestSchema.parse(snapshot);
  return {
    manifestHash: manifest.manifestHash,
    task: manifest.task,
    chapterId: manifest.chapterId,
    chapterNumber: manifest.chapterNumber,
    povCharacterId: manifest.povCharacterId,
    branchId: manifest.branchId,
    effectiveTokenBudget: manifest.effectiveTokenBudget,
    budget: manifest.budget,
  };
}

function writingActionOutputFromRecord(
  record: WritingActionOutputWithContent,
): WritingActionJob["output"] {
  const row = record.row;
  const base = {
    id: row.id,
    action: row.action as WritingActionRequest["action"],
    version: row.version,
    versionNodeId: row.versionNodeId,
    sourceVersionId: row.sourceVersionId,
    chapterVersionId: row.chapterVersionId,
    affectedRange: row.affectedRange
      ? {
          originalStart: Number(row.affectedRange.originalStart),
          originalEnd: Number(row.affectedRange.originalEnd),
          start: Number(row.affectedRange.start),
          end: Number(row.affectedRange.end),
        }
      : null,
    provenance: {
      promptKey: row.promptKey,
      promptVersion: row.promptVersion,
      promptHash: row.promptHash,
      provider: row.modelProvider,
      model: row.model,
      parameters: row.modelParameters,
    },
    createdAt: row.createdAt.toISOString(),
  };
  if (row.outputKind === "chapter_text") {
    return writingActionOutputSchema.parse({
      ...base,
      kind: "chapter_text",
      content: record.chapterContent ?? "",
    });
  }
  if (row.outputKind === "title_options") {
    return writingActionOutputSchema.parse({
      ...base,
      kind: "title_options",
      titles: row.artifact.titles,
    });
  }
  if (row.outputKind === "summary") {
    return writingActionOutputSchema.parse({
      ...base,
      kind: "summary",
      summary: row.artifact.summary,
    });
  }
  return writingActionOutputSchema.parse({
    ...base,
    kind: "hooks",
    hooks: row.artifact.values,
  });
}

export function toWritingActionJobContract(record: WritingActionWithOutput): WritingActionJob {
  return writingActionJobSchema.parse({
    id: record.job.id,
    type: "write_action",
    action: record.job.action as WritingActionRequest["action"],
    workId: record.job.workId,
    branchId: record.job.branchId,
    chapterId: record.job.chapterId as string,
    sourceVersionId: record.job.sourceVersionId as string,
    status: record.job.status as WritingActionJob["status"],
    progress: record.job.progress,
    currentStep: record.job.currentStep as WritingActionJob["currentStep"],
    budget: record.job.budget as WritingActionJob["budget"],
    cost: record.job.cost as WritingActionJob["cost"],
    checkpoint: record.job.checkpoint as WritingActionJob["checkpoint"],
    output: record.output ? writingActionOutputFromRecord(record.output) : null,
    contextPack: record.contextPack,
    error:
      record.job.errorCode && record.job.errorMessage
        ? { code: record.job.errorCode, message: record.job.errorMessage }
        : null,
    createdAt: record.job.createdAt.toISOString(),
    startedAt: record.job.startedAt?.toISOString() ?? null,
    finishedAt: record.job.finishedAt?.toISOString() ?? null,
  });
}

export function toWriteActionWorkerJob(record: WritingActionWithOutput): WriteActionJob {
  return writeActionJobSchema.parse({
    jobId: record.job.id,
    jobType: "write_action",
    workId: record.job.workId,
    branchId: record.job.branchId,
    chapterId: record.job.chapterId as string,
    actorId: record.job.userId,
    modelConfigId: record.job.modelConfigId as string,
    idempotencyKey: record.job.idempotencyKey,
    action: record.job.action as WritingActionRequest["action"],
    sourceVersionId: record.job.sourceVersionId as string,
    input: record.job.actionInput as WritingActionRequest,
    budget: record.job.budget as WriteActionJob["budget"],
    checkpoint: record.job.checkpoint as WriteActionJob["checkpoint"],
  });
}

function isChapterEditable(status: string): boolean {
  return status === "planned" || status === "writing" || status === "changes_requested";
}

async function appendEvent(
  transaction: DatabaseTransaction,
  job: WritingActionJobRecord,
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
