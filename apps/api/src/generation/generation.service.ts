import { Injectable } from "@nestjs/common";
import {
  contextPackPreviewSchema,
  contextPackVersionSchema,
  generateChapterJobSchema,
  generationBudgetSchema,
  generationCheckpointSchema,
  generationCostSchema,
  generationJobSchema,
  jobEventSchema,
  type ContextPackPreview,
  type GenerateChapterJob,
  type GenerateChapterRequest,
  type GenerationJob,
  type JobEvent,
} from "@novel-brain/contracts";
import { compileChapterContext, ContextBudgetExceededError } from "@novel-brain/core";
import { Observable } from "rxjs";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  GenerationRepository,
  isTerminal,
  type GenerationBranchContext,
  type GenerationSources,
  type GenerationWorkContext,
  type JobWithContextPack,
} from "./generation.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { GenerationQueue } from "./generation.queue";

const COMPILER_VERSION = "m0-context-v1";

@Injectable()
export class GenerationService {
  constructor(
    private readonly repository: GenerationRepository,
    private readonly queue: GenerationQueue,
  ) {}

  async start(
    userId: string,
    context: GenerationWorkContext,
    idempotencyKey: string,
    request: GenerateChapterRequest,
  ): Promise<GenerationJob> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    const existing = await this.repository.findByIdempotencyKey(userId, context, normalizedKey);
    if (existing) {
      return this.toJobContract(existing);
    }
    const sources = await this.requireSources(userId, context);
    try {
      compileGenerationContext(sources, request.budget.maxTokens);
    } catch (error) {
      if (error instanceof ContextBudgetExceededError) {
        throw new ApiError(400, "JOB_BUDGET_EXCEEDED", "上下文超过本章生成预算", {
          requiredTokens: error.requiredTokens,
          tokenBudget: error.tokenBudget,
        });
      }
      throw error;
    }
    const result = await this.repository.createQueuedJob({
      userId,
      context,
      modelConfigId: sources.modelConfig.id,
      idempotencyKey: normalizedKey,
      request,
    });
    if (result.created) {
      await this.queue.enqueue(toWorkerJob(userId, result.value));
    }
    return this.toJobContract(result.value);
  }

  async get(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
  ): Promise<GenerationJob> {
    const record = await this.repository.findJob(userId, context, jobId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "生成任务不存在或无权访问");
    }
    return this.toJobContract(record);
  }

  async list(userId: string, context: GenerationWorkContext): Promise<GenerationJob[]> {
    if (!(await this.repository.findWorkContext(userId, context))) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return (await this.repository.listJobs(userId, context)).map((record) =>
      this.toJobContract(record),
    );
  }

  async contextPreview(
    userId: string,
    context: GenerationWorkContext,
    tokenBudget: number,
  ): Promise<ContextPackPreview> {
    const sources = await this.requireSources(userId, context);
    try {
      return contextPackPreviewSchema.parse(compileGenerationContext(sources, tokenBudget));
    } catch (error) {
      if (error instanceof ContextBudgetExceededError) {
        throw new ApiError(400, "JOB_BUDGET_EXCEEDED", "上下文超过本章生成预算", {
          requiredTokens: error.requiredTokens,
          tokenBudget: error.tokenBudget,
        });
      }
      throw error;
    }
  }

  async cancel(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
  ): Promise<GenerationJob> {
    const record = await this.repository.cancelJob(userId, context, jobId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "生成任务不存在或无权访问");
    }
    return this.toJobContract(record);
  }

  async retry(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
  ): Promise<GenerationJob> {
    const record = await this.repository.retryJob(userId, context, jobId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "生成任务不存在或无权访问");
    }
    if (record.job.status === "queued") {
      await this.queue.enqueue(toWorkerJob(userId, record));
    }
    return this.toJobContract(record);
  }

  streamEvents(
    userId: string,
    context: GenerationBranchContext,
    jobId: string,
    lastEventId?: string,
  ): Observable<JobEvent> {
    return new Observable<JobEvent>((subscriber) => {
      let active = true;
      let cursor = lastEventId;
      void (async () => {
        while (active) {
          const record = await this.repository.findJob(userId, context, jobId);
          if (!record) {
            throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "生成任务不存在或无权访问");
          }
          const events = await this.repository.listEvents(userId, context, jobId, cursor);
          for (const event of events) {
            cursor = event.id;
            subscriber.next(
              jobEventSchema.parse({
                eventId: event.id,
                type: event.eventType,
                occurredAt: event.occurredAt.toISOString(),
                data: event.payload,
              }),
            );
          }
          if (isTerminal(record.job.status) && events.length === 0) {
            subscriber.complete();
            return;
          }
          await delay(250);
        }
      })().catch((error: unknown) => subscriber.error(error));
      return () => {
        active = false;
      };
    });
  }

  private async requireSources(
    userId: string,
    context: GenerationWorkContext,
  ): Promise<GenerationSources> {
    const sources = await this.repository.loadSources(userId, context);
    if (!sources) {
      throw new ApiError(
        400,
        "BIBLE_NOT_READY",
        "生成前需要锁定故事圣经、确认基础设定并配置正文模型",
      );
    }
    const lockedTypes = new Set(sources.settings.map((setting) => setting.type));
    const brief = sources.chapter.brief as {
      goal?: string;
      pov?: string;
      location?: string;
      sceneBeats?: unknown[];
      requiredFacts?: unknown[];
    };
    if (
      !lockedTypes.has("world_rule") ||
      !lockedTypes.has("character") ||
      !lockedTypes.has("golden_finger") ||
      !brief.goal ||
      !brief.pov ||
      !brief.location ||
      !Array.isArray(brief.sceneBeats) ||
      brief.sceneBeats.length === 0 ||
      !Array.isArray(brief.requiredFacts) ||
      brief.requiredFacts.length === 0
    ) {
      throw new ApiError(400, "BIBLE_NOT_READY", "生成前需要补全本章章纲和已确认设定");
    }
    return sources;
  }

  private toJobContract(record: JobWithContextPack): GenerationJob {
    const contextPack = record.contextPack
      ? contextPackVersionSchema.parse({
          id: record.contextPack.id,
          jobId: record.contextPack.jobId,
          version: record.contextPack.version,
          compilerVersion: record.contextPack.compilerVersion,
          tokenBudget: record.contextPack.tokenBudget,
          tokenUsed: record.contextPack.tokenUsed,
          selected: record.contextPack.selected,
          evicted: record.contextPack.evicted,
          sourceRefs: record.contextPack.sourceRefs,
          createdAt: record.contextPack.createdAt.toISOString(),
        })
      : null;
    return generationJobSchema.parse({
      id: record.job.id,
      type: record.job.type,
      workId: record.job.workId,
      branchId: record.job.branchId,
      chapterId: record.job.chapterId,
      status: record.job.status,
      progress: record.job.progress,
      currentStep: record.job.currentStep,
      budget: generationBudgetSchema.parse(record.job.budget),
      cost: generationCostSchema.parse(record.job.cost),
      checkpoint: generationCheckpointSchema.parse(record.job.checkpoint),
      error:
        record.job.errorCode && record.job.errorMessage
          ? { code: record.job.errorCode, message: record.job.errorMessage }
          : null,
      contextPack,
      createdAt: record.job.createdAt.toISOString(),
      startedAt: record.job.startedAt?.toISOString() ?? null,
      finishedAt: record.job.finishedAt?.toISOString() ?? null,
    });
  }
}

function toWorkerJob(userId: string, record: JobWithContextPack): GenerateChapterJob {
  return generateChapterJobSchema.parse({
    jobId: record.job.id,
    jobType: "generate_chapter",
    workId: record.job.workId,
    branchId: record.job.branchId,
    chapterId: record.job.chapterId,
    actorId: userId,
    modelConfigId: record.job.modelConfigId,
    idempotencyKey: record.job.idempotencyKey,
    budget: record.job.budget,
    checkpoint: record.job.checkpoint,
  });
}

export function compileGenerationContext(
  sources: GenerationSources,
  tokenBudget: number,
): ContextPackPreview {
  const brief = sources.chapter.brief as {
    goal?: string;
    pov?: string;
    location?: string;
    sceneBeats?: string[];
    requiredFacts?: string[];
  };
  const compiled = compileChapterContext(
    {
      chapter: {
        id: sources.chapter.id,
        number: sources.chapter.number,
        title: sources.chapter.title,
        brief,
      },
      storyBible: {
        id: sources.storyBible.id,
        cards: sources.storyBible.cards,
        worldRules: sources.worldRules,
      },
      ...(sources.styleSample ? { styleSample: sources.styleSample } : {}),
      styleSampleId: sources.chapter.workId,
      settings: sources.settings.map((setting) => ({
        id: setting.id,
        type: setting.type,
        name: setting.name,
        aliases: setting.aliases,
        summary: setting.summary,
        description: setting.description,
        tags: setting.tags,
        attributes: setting.attributes,
        ...(setting.sourceChapterNumber
          ? { sourceChapterNumber: setting.sourceChapterNumber }
          : {}),
        ...(setting.validFromChapter ? { validFromChapter: setting.validFromChapter } : {}),
        validToChapter: setting.validToChapter ?? null,
      })),
      previousVersions: sources.previousVersions,
    },
    tokenBudget,
    COMPILER_VERSION,
  );
  return contextPackPreviewSchema.parse(compiled);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
