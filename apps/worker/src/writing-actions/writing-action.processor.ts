import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  WRITING_ACTION_STEPS,
  writeActionJobSchema,
  type WriteActionJob,
  type WritingActionStep,
} from "@novel-brain/contracts";
import {
  AiProviderError,
  M0_COST_PER_TOKEN_CNY,
  type AiGateway,
  type GenerationResult,
} from "@novel-brain/ai";
import {
  compileChapterContextManifest,
  compileWritingActionPrompt,
  ContextBudgetExceededError,
  decideStepRecovery,
  PROVIDER_CALL_MAX_OUTPUT_TOKENS,
  resolveModelContextWindow,
  TargetedRevisionError,
  WRITING_ACTION_SPECS,
} from "@novel-brain/core";
import { calculateModelCallCost } from "@novel-brain/db";

import {
  BUDGET_EXHAUSTED_ESCALATION,
  BUDGET_EXHAUSTED_MESSAGE,
  BudgetedProviderCallExecutor,
  CostBudgetOverrunRecordedError,
  ProviderBudgetExceededError,
  describeProviderFailure,
} from "../generation/budgeted-provider-call";
import { AI_GATEWAY } from "../generation/generation.tokens";
import type { ByokAiGatewayFactory } from "../generation/model-provider.factory";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  WorkerGenerationRepository,
  WritingActionNotEditableError,
  WritingActionSourceInvalidError,
  type LoadedGenerationJob,
  type LoadedWritingActionSource,
  type WorkerContextSources,
} from "../generation/generation.repository";

export interface WritingActionTraceLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
}

export type WritingActionStepBoundaryHook = (step: WritingActionStep) => void | Promise<void>;
export type WritingActionModelCallBoundaryHook = () => void | Promise<void>;

const STEP_PROGRESS: Record<WritingActionStep, number> = {
  prepare: 20,
  generate: 70,
  await_review: 100,
};

type AiGatewayResolver = AiGateway | Pick<ByokAiGatewayFactory, "create">;

@Injectable()
export class WritingActionProcessor {
  private readonly providerCalls: BudgetedProviderCallExecutor;
  private traceLogger: WritingActionTraceLogger | undefined;
  private boundaryHook: WritingActionStepBoundaryHook | undefined;
  private modelCallBoundaryHook: WritingActionModelCallBoundaryHook | undefined;

  constructor(
    private readonly repository: WorkerGenerationRepository,
    @Inject(AI_GATEWAY) private readonly providerResolver: AiGatewayResolver,
  ) {
    this.providerCalls = new BudgetedProviderCallExecutor(repository);
  }

  setTraceLogger(logger: WritingActionTraceLogger): void {
    this.traceLogger = logger;
  }

  setStepBoundaryHook(hook: WritingActionStepBoundaryHook | undefined): void {
    this.boundaryHook = hook;
  }

  setModelCallBoundaryHook(hook: WritingActionModelCallBoundaryHook | undefined): void {
    this.modelCallBoundaryHook = hook;
  }

  async process(payload: WriteActionJob): Promise<void> {
    await this.repository.withJobLock(payload.jobId, () => this.processLocked(payload));
  }

  private async processLocked(payload: WriteActionJob): Promise<void> {
    const loaded = await this.repository.loadJob(payload);
    if (!loaded) {
      return;
    }
    const durable = writeActionJobSchema.parse({
      jobId: loaded.job.id,
      jobType: loaded.job.type,
      workId: loaded.job.workId,
      branchId: loaded.job.branchId,
      chapterId: loaded.job.chapterId,
      actorId: loaded.job.userId,
      modelConfigId: loaded.job.modelConfigId,
      idempotencyKey: loaded.job.idempotencyKey,
      action: loaded.job.action,
      sourceVersionId: loaded.job.sourceVersionId,
      input: loaded.job.actionInput,
      budget: loaded.job.budget,
      checkpoint: loaded.job.checkpoint,
    });
    const started = await this.repository.begin(durable);
    if (started === "terminal" || !started) {
      return;
    }
    const resumeStep = await this.repository.resumeWritingActionStep(durable);
    const startIndex = WRITING_ACTION_STEPS.indexOf(resumeStep);
    let provider: AiGateway | undefined;

    for (const step of WRITING_ACTION_STEPS) {
      if (WRITING_ACTION_STEPS.indexOf(step) < startIndex) {
        continue;
      }
      if (await this.repository.isCancelled(durable)) {
        await this.repository.markRevisionRoundFailed(durable, "JOB_CANCELLED");
        return;
      }
      while (true) {
        let jobStep: Awaited<ReturnType<WorkerGenerationRepository["startStep"]>> | undefined;
        try {
          if (step === "generate" && !provider) {
            provider =
              "generateText" in this.providerResolver
                ? this.providerResolver
                : this.providerResolver.create(loaded.modelConfig);
          }
          jobStep = await this.repository.startStep(
            durable,
            step,
            writingActionInputHash(durable, step),
            STEP_PROGRESS[step],
          );
          const result = await this.executeStep({
            payload: durable,
            loaded,
            step,
            attempt: jobStep.attempt,
            ...(provider ? { provider } : {}),
          });
          await this.repository.succeedStep({
            payload: durable,
            step,
            progress: STEP_PROGRESS[step],
            output: result.output,
            cost: result.cost,
            checkpointPayload: result.checkpointPayload,
          });
          break;
        } catch (error) {
          if (
            error instanceof CostBudgetOverrunRecordedError ||
            (error instanceof Error && error.name === "CostBudgetOverrunRecordedError")
          ) {
            await this.modelCallBoundaryHook?.();
            return;
          }
          const failure = toFailure(error);
          if (failure.failureClass === "budget") {
            await this.repository.failStep({
              payload: durable,
              step,
              code: failure.code,
              message: failure.message,
              terminal: true,
              terminalStatus: "paused",
            });
            return;
          }
          const decision = decideStepRecovery({
            failureClass: failure.failureClass,
            attempt: jobStep?.attempt ?? 1,
            maxAutomaticAttempts: 3,
          });
          await this.repository.failStep({
            payload: durable,
            step,
            code: failure.code,
            message: failure.message,
            terminal: decision.terminal,
          });
          if (decision.terminal) {
            await this.repository.markRevisionRoundFailed(durable, failure.code);
            return;
          }
          this.traceLogger?.warn(
            {
              event: "worker.writing_action.retry_scheduled",
              jobId: durable.jobId,
              action: durable.action,
              step,
              attempt: jobStep?.attempt ?? 1,
              failureClass: failure.failureClass,
              delayMs: decision.delayMs,
            },
            "Retryable writing action step will resume from its checkpoint",
          );
          await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
        }
      }
      await this.boundaryHook?.(step);
    }
    await this.repository.completeWritingAction(durable);
  }

  private async executeStep(input: {
    payload: WriteActionJob;
    loaded: LoadedGenerationJob;
    step: WritingActionStep;
    attempt: number;
    provider?: AiGateway;
  }): Promise<{
    output: Record<string, unknown>;
    cost: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      costCny: number;
    };
    checkpointPayload: Record<string, unknown>;
  }> {
    const spec = WRITING_ACTION_SPECS[input.payload.action];
    switch (input.step) {
      case "prepare": {
        const source = await this.requireSource(input.payload);
        if (source.branch.status !== "active") {
          throw new WritingActionSourceInvalidError();
        }
        const sources = await this.requireSources(input.payload);
        const pack = compileChapterContextManifest(
          {
            branchId: input.payload.branchId,
            branchStatus: sources.branch.status,
            compilerVersion: "m1-context-v1",
            task: "chapter_revision",
            chapter: {
              id: sources.chapter.id,
              number: sources.chapter.number,
              title: sources.chapter.title,
              brief: sources.chapter.brief,
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
            povCharacterId: sources.povCharacterId ?? null,
            modelContextWindowTokens: resolveModelContextWindow(input.loaded.modelConfig.model),
            reservedOutputTokens: PROVIDER_CALL_MAX_OUTPUT_TOKENS,
            ...(sources.knowledge ? { knowledge: sources.knowledge } : {}),
          },
          input.payload.budget.maxTokens,
        );
        const contextPackId = await this.repository.persistContextPack({
          payload: input.payload,
          pack,
        });
        return {
          output: { contextPackId, sourceVersionId: input.payload.sourceVersionId },
          cost: zeroCost(),
          checkpointPayload: { contextPackId, sourceVersionId: input.payload.sourceVersionId },
        };
      }
      case "generate": {
        const source = await this.requireSource(input.payload);
        const contextPackId = await this.findContextPackId(input.payload);
        const pack = await this.repository.loadContextPack(input.payload, contextPackId);
        if (!pack) {
          throw new WritingActionSourceInvalidError();
        }
        const revision =
          input.payload.input.action === "targeted_revision"
            ? {
                sourceContent: source.version.content,
                blocks: input.payload.input.blocks,
                findings: await this.repository.loadRevisionFindings(
                  input.payload,
                  input.payload.input.findingIds,
                ),
                constraints: input.payload.input.constraints,
              }
            : undefined;
        const prompt = compileWritingActionPrompt({
          action: input.payload.action,
          sourceContent: source.version.content,
          sourceRefs: pack.sourceRefs.map((reference) => reference.citation),
          ...(revision ? { revision } : {}),
          ...(input.payload.input.action === "selection_rewrite"
            ? {
                selection: input.payload.input.selection,
                instruction: input.payload.input.instruction,
              }
            : "instruction" in input.payload.input && input.payload.input.instruction
              ? { instruction: input.payload.input.instruction }
              : {}),
          ...("targetLength" in input.payload.input &&
          input.payload.input.targetLength !== undefined
            ? { targetLength: input.payload.input.targetLength }
            : {}),
          ...(input.payload.input.action === "change_pov" ? { pov: input.payload.input.pov } : {}),
          ...(input.payload.input.action === "add_hook" && input.payload.input.hookStyle
            ? { hookStyle: input.payload.input.hookStyle }
            : {}),
          ...(input.payload.input.action === "generate_summary"
            ? { maxLength: input.payload.input.maxLength }
            : {}),
        });
        const result = await this.providerCalls.call({
          payload: input.payload,
          provider: requireProvider(input.provider),
          step: "generate",
          attempt: input.attempt,
          role: spec.role,
          promptKey: spec.promptKey,
          promptVersion: spec.promptVersion,
          operation: input.payload.action,
          prompt: prompt.prompt,
          system: prompt.system,
          citations: pack.sourceRefs,
          parameters: {
            operation: input.payload.action,
            promptKey: spec.promptKey,
            promptVersion: spec.promptVersion,
          },
          ...(this.traceLogger ? { traceLogger: this.traceLogger } : {}),
        });
        const output = await this.repository.saveWritingActionOutput({
          payload: input.payload,
          generatedText: result.text,
          promptKey: spec.promptKey,
          promptVersion: spec.promptVersion,
          promptHash: sha256(prompt.prompt),
          modelProvider: input.loaded.modelConfig.provider,
          model: input.loaded.modelConfig.model,
          modelParameters: {
            action: input.payload.action,
            promptKey: spec.promptKey,
            promptVersion: spec.promptVersion,
            maxTokens: PROVIDER_CALL_MAX_OUTPUT_TOKENS,
            stream: false,
          },
        });
        return {
          output: {
            outputId: output.id,
            versionNodeId: output.versionNodeId,
            chapterVersionId: output.chapterVersionId,
          },
          cost: toCost(result),
          checkpointPayload: {
            outputId: output.id,
            versionNodeId: output.versionNodeId,
            chapterVersionId: output.chapterVersionId,
          },
        };
      }
      case "await_review":
        return {
          output: { awaiting: "author_review", action: input.payload.action },
          cost: zeroCost(),
          checkpointPayload: { awaiting: "author_review" },
        };
    }
  }

  private async requireSource(payload: WriteActionJob): Promise<LoadedWritingActionSource> {
    const source = await this.repository.loadWritingActionSource(payload);
    if (!source) {
      throw new WritingActionSourceInvalidError();
    }
    return source;
  }

  private async requireSources(payload: WriteActionJob): Promise<WorkerContextSources> {
    const sources = await this.repository.loadSources(payload);
    if (!sources) {
      throw new WritingActionSourceInvalidError();
    }
    return sources;
  }

  private async findContextPackId(payload: WriteActionJob): Promise<string> {
    const output = await this.repository.findStepOutput(payload, "prepare");
    if (typeof output?.contextPackId !== "string") {
      throw new WritingActionSourceInvalidError();
    }
    return output.contextPackId;
  }
}

function requireProvider(provider: AiGateway | undefined): AiGateway {
  if (!provider) {
    throw new WritingActionSourceInvalidError();
  }
  return provider;
}

function writingActionInputHash(payload: WriteActionJob, step: WritingActionStep): string {
  return sha256(
    stableStringify({
      jobId: payload.jobId,
      chapterId: payload.chapterId,
      sourceVersionId: payload.sourceVersionId,
      action: payload.action,
      input: payload.input,
      step,
    }),
  );
}

function toCost(result: GenerationResult) {
  const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
  return {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens,
    costCny: calculateModelCallCost(totalTokens, M0_COST_PER_TOKEN_CNY),
  };
}

function zeroCost() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}

function toFailure(error: unknown) {
  if (error instanceof ProviderBudgetExceededError) {
    return {
      code: "JOB_BUDGET_EXCEEDED",
      message: BUDGET_EXHAUSTED_MESSAGE,
      failureClass: "budget" as const,
      escalationReason: BUDGET_EXHAUSTED_ESCALATION,
    };
  }
  if (error instanceof AiProviderError) {
    return describeProviderFailure(error);
  }
  if (error instanceof WritingActionNotEditableError) {
    return {
      code: "WRITING_ACTION_NOT_EDITABLE",
      message: "章节已不可编辑，原稿和检查点已保留",
      failureClass: "policy" as const,
    };
  }
  if (error instanceof WritingActionSourceInvalidError) {
    return {
      code: "WRITING_ACTION_SOURCE_VERSION_INVALID",
      message: "源版本或选区已变化，原稿和检查点已保留",
      failureClass: "schema" as const,
    };
  }
  if (error instanceof TargetedRevisionError) {
    return {
      code: "WRITING_ACTION_SOURCE_VERSION_INVALID",
      message: "修订结果没有覆盖所选正文块，原稿和检查点已保留",
      failureClass: "schema" as const,
    };
  }
  if (error instanceof ContextBudgetExceededError) {
    return {
      code: "JOB_BUDGET_EXCEEDED",
      message: BUDGET_EXHAUSTED_MESSAGE,
      failureClass: "budget" as const,
      escalationReason: BUDGET_EXHAUSTED_ESCALATION,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "写作动作失败，原稿和检查点已保留",
    failureClass: "unknown" as const,
  };
}
