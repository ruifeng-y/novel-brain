import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  WRITING_ACTION_STEPS,
  writeActionJobSchema,
  type WriteActionJob,
  type WritingActionKind,
  type WritingActionStep,
} from "@novel-brain/contracts";
import {
  AiProviderError,
  M0_COST_PER_TOKEN_CNY,
  classifyAiFailure,
  type AiGateway,
  type GenerationResult,
} from "@novel-brain/ai";
import {
  compileChapterContextManifest,
  compileWritingActionPrompt,
  ContextBudgetExceededError,
  decideStepRecovery,
  resolveModelContextWindow,
  TargetedRevisionError,
  WRITING_ACTION_SPECS,
} from "@novel-brain/core";

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
  type StartedModelCall,
  type WorkerContextSources,
} from "../generation/generation.repository";

export interface WritingActionTraceLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
}

export type WritingActionStepBoundaryHook = (step: WritingActionStep) => void | Promise<void>;

const STEP_PROGRESS: Record<WritingActionStep, number> = {
  prepare: 20,
  generate: 70,
  await_review: 100,
};

class WritingActionBudgetExceededError extends Error {
  readonly failureClass = "budget" as const;

  constructor() {
    super("Writing action budget exhausted");
    this.name = "WritingActionBudgetExceededError";
  }
}

type AiGatewayResolver = AiGateway | Pick<ByokAiGatewayFactory, "create">;

@Injectable()
export class WritingActionProcessor {
  private traceLogger: WritingActionTraceLogger | undefined;
  private boundaryHook: WritingActionStepBoundaryHook | undefined;

  constructor(
    private readonly repository: WorkerGenerationRepository,
    @Inject(AI_GATEWAY) private readonly providerResolver: AiGatewayResolver,
  ) {}

  setTraceLogger(logger: WritingActionTraceLogger): void {
    this.traceLogger = logger;
  }

  setStepBoundaryHook(hook: WritingActionStepBoundaryHook | undefined): void {
    this.boundaryHook = hook;
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
          const failure = toFailure(error);
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
            reservedOutputTokens: 2_000,
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
        const result = await this.callProvider({
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
            maxTokens: 2_000,
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

  private async callProvider(input: {
    payload: WriteActionJob;
    provider: AiGateway;
    step: "generate";
    attempt: number;
    role: "writer" | "reviser";
    promptKey: string;
    promptVersion: number;
    operation: WritingActionKind;
    prompt: string;
    system: string;
    citations: unknown[];
  }): Promise<GenerationResult> {
    const estimatedTokens = estimateTokens(input.prompt) + 600;
    const estimatedCostCny = calculateCost(estimatedTokens);
    const parameters = {
      operation: input.operation,
      promptKey: input.promptKey,
      promptVersion: input.promptVersion,
      maxTokens: 2_000,
      stream: false,
    };
    let call: StartedModelCall;
    try {
      call = await this.repository.beginModelCall({
        payload: input.payload,
        step: input.step,
        attempt: input.attempt,
        role: input.role,
        promptKey: input.promptKey,
        prompt: input.prompt,
        system: input.system,
        citations: input.citations,
        estimatedTokens,
        estimatedCostCny,
        parameters,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "BudgetReservationError") {
        await this.repository.recordBudgetFailure({
          payload: input.payload,
          step: input.step,
          attempt: input.attempt,
          role: input.role,
          prompt: input.prompt,
          system: input.system,
          estimatedTokens,
          estimatedCostCny,
          errorCode: "JOB_BUDGET_EXCEEDED",
          message: "写作动作预算已用完，原稿和检查点已保留",
          escalationReason: "预算已用完，请调整预算后从断点重试",
        });
        throw new WritingActionBudgetExceededError();
      }
      throw error;
    }
    try {
      const result = await input.provider.generateText({
        prompt: input.prompt,
        system: input.system,
        maxTokens: 2_000,
        operation: input.operation,
      });
      await this.repository.completeModelCall({
        payload: input.payload,
        step: input.step,
        call,
        result,
      });
      return result;
    } catch (error) {
      const failure = toProviderFailure(error);
      await this.repository.failModelCall({
        payload: input.payload,
        step: input.step,
        call,
        failureClass: failure.failureClass,
        errorCode: failure.code,
        message: failure.message,
        escalationReason: failure.escalationReason,
      });
      throw error;
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
    costCny: calculateCost(totalTokens),
  };
}

function zeroCost() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}

function calculateCost(tokens: number): number {
  return Number((tokens * M0_COST_PER_TOKEN_CNY).toFixed(8));
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(Array.from(value.replace(/\s/gu, "")).length / 2));
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

function toProviderFailure(error: unknown) {
  const failureClass = error instanceof AiProviderError ? classifyAiFailure(error) : "provider";
  const mapping = {
    timeout: {
      code: "MODEL_TIMEOUT",
      message: "模型服务响应超时，原稿和检查点已保留",
      escalationReason: "模型响应超时，可稍后从断点重试",
    },
    rate_limit: {
      code: "MODEL_RATE_LIMITED",
      message: "模型服务繁忙，原稿和检查点已保留",
      escalationReason: "模型服务限流，请稍后从断点重试",
    },
    policy: {
      code: "MODEL_POLICY_BLOCKED",
      message: "模型拒绝了本次请求，原稿和检查点已保留",
      escalationReason: "模型拒绝请求，请检查正文模型配置或稍后重试",
    },
    schema: {
      code: "MODEL_RESPONSE_INVALID",
      message: "模型返回内容无法识别，原稿和检查点已保留",
      escalationReason: "模型返回格式异常，请从断点重试",
    },
    budget: {
      code: "JOB_BUDGET_EXCEEDED",
      message: "写作动作预算已用完，原稿和检查点已保留",
      escalationReason: "预算已用完，请调整预算后再从断点重试",
    },
    cancelled: {
      code: "JOB_CANCELLED",
      message: "写作动作已取消，原稿和检查点已保留",
      escalationReason: "写作动作已取消",
    },
    provider: {
      code: "MODEL_PROVIDER_ERROR",
      message: "模型服务暂时不可用，原稿和检查点已保留",
      escalationReason: "模型服务异常，请稍后从断点重试",
    },
    unknown: {
      code: "MODEL_PROVIDER_ERROR",
      message: "模型服务暂时不可用，原稿和检查点已保留",
      escalationReason: "模型调用异常，请稍后从断点重试",
    },
  } as const;
  return { failureClass, ...mapping[failureClass] };
}

function toFailure(error: unknown) {
  if (error instanceof WritingActionBudgetExceededError) {
    return {
      code: "JOB_BUDGET_EXCEEDED",
      message: "写作动作预算已用完，原稿和检查点已保留",
      failureClass: "budget" as const,
    };
  }
  if (error instanceof AiProviderError) {
    return toProviderFailure(error);
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
      message: "写作动作预算已用完，原稿和检查点已保留",
      failureClass: "budget" as const,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "写作动作失败，原稿和检查点已保留",
    failureClass: "unknown" as const,
  };
}
