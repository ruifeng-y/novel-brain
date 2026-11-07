import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  generateChapterJobSchema,
  generationCheckpointSchema,
  type ContextPackManifest,
  WORKER_JOB_STEPS,
  type GenerateChapterJob,
  type GenerationCost,
  type WorkerJobStep,
} from "@novel-brain/contracts";
import {
  AiProviderError,
  M0_COST_PER_TOKEN_CNY,
  type AiGateway,
  type GenerationResult,
} from "@novel-brain/ai";
import {
  compileChapterContextManifest,
  ContextBudgetExceededError,
  decideStepRecovery,
  extractFactCandidates,
  PROVIDER_CALL_MAX_OUTPUT_TOKENS,
  resolveModelContextWindow,
} from "@novel-brain/core";
import { calculateModelCallCost } from "@novel-brain/db";
import { AI_GATEWAY } from "./generation.tokens";
import type { ByokAiGatewayFactory } from "./model-provider.factory";
import {
  BUDGET_EXHAUSTED_ESCALATION,
  BUDGET_EXHAUSTED_MESSAGE,
  BudgetedProviderCallExecutor,
  CostBudgetOverrunRecordedError,
  ProviderBudgetExceededError,
  describeProviderFailure,
} from "./budgeted-provider-call";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  JobStoppedError,
  WorkerGenerationRepository,
  type LoadedGenerationJob,
  type WorkerContextSources,
} from "./generation.repository";

export interface GenerationTraceLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
}

export type GenerationStepBoundaryHook = (step: WorkerJobStep) => void | Promise<void>;

export interface GenerationRecoveryOptions {
  maxAutomaticAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

const STEP_PROGRESS: Record<WorkerJobStep, number> = {
  prepare: 10,
  compile_context: 30,
  draft: 55,
  verify: 75,
  revise: 90,
  extract_facts: 96,
  await_review: 100,
};
class ModelConfigurationError extends Error {
  readonly failureClass = "policy" as const;

  constructor() {
    super("Model configuration could not be loaded");
    this.name = "ModelConfigurationError";
  }
}

type AiGatewayResolver = AiGateway | Pick<ByokAiGatewayFactory, "create">;

@Injectable()
export class GenerationJobProcessor {
  private readonly providerCalls: BudgetedProviderCallExecutor;
  private traceLogger: GenerationTraceLogger | undefined;
  private boundaryHook: GenerationStepBoundaryHook | undefined;
  private recoveryOptions: Required<GenerationRecoveryOptions> = {
    maxAutomaticAttempts: 1,
    sleep: async (delayMs) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    },
  };

  constructor(
    private readonly repository: WorkerGenerationRepository,
    @Inject(AI_GATEWAY) private readonly providerResolver: AiGatewayResolver,
  ) {
    this.providerCalls = new BudgetedProviderCallExecutor(repository);
  }

  setTraceLogger(logger: GenerationTraceLogger): void {
    this.traceLogger = logger;
  }

  setStepBoundaryHook(hook: GenerationStepBoundaryHook | undefined): void {
    this.boundaryHook = hook;
  }

  configureRecovery(options: GenerationRecoveryOptions): void {
    this.recoveryOptions = {
      ...this.recoveryOptions,
      ...options,
    };
  }

  async process(payload: GenerateChapterJob): Promise<void> {
    await this.repository.withJobLock(payload.jobId, () => this.processLocked(payload));
  }

  private async processLocked(payload: GenerateChapterJob): Promise<void> {
    const loaded = await this.repository.loadJob(payload);
    if (!loaded) {
      return;
    }
    const durablePayload = generateChapterJobSchema.parse({
      jobId: loaded.job.id,
      jobType: loaded.job.type,
      workId: loaded.job.workId,
      branchId: loaded.job.branchId,
      chapterId: loaded.job.chapterId,
      actorId: loaded.job.userId,
      modelConfigId: loaded.job.modelConfigId,
      idempotencyKey: loaded.job.idempotencyKey,
      budget: loaded.job.budget,
      checkpoint: loaded.job.checkpoint,
    });
    const started = await this.repository.begin(durablePayload);
    if (started === "terminal" || !started) {
      return;
    }
    const resumeStep = await this.repository.resumeStep(durablePayload);
    const startIndex = WORKER_JOB_STEPS.indexOf(resumeStep);
    let contextPack: ContextPackManifest | undefined;
    let provider: AiGateway | undefined;
    let checkpoint = generationCheckpointSchema.parse(loaded.job.checkpoint);

    for (const step of WORKER_JOB_STEPS) {
      const stepIndex = WORKER_JOB_STEPS.indexOf(step);
      if (stepIndex < startIndex) {
        continue;
      }
      if ((await this.repository.stopReason(durablePayload)) !== null) {
        return;
      }
      while (true) {
        let jobStep: Awaited<ReturnType<WorkerGenerationRepository["startStep"]>> | undefined;
        try {
          if (stepRequiresProvider(step) && !provider) {
            try {
              provider =
                "generateText" in this.providerResolver
                  ? this.providerResolver
                  : this.providerResolver.create(loaded.modelConfig);
            } catch {
              throw new ModelConfigurationError();
            }
          }
          jobStep = await this.repository.startStep(
            durablePayload,
            step,
            stepInputHash(durablePayload, step, checkpoint),
            STEP_PROGRESS[step],
          );
          const result = await this.executeStep({
            payload: durablePayload,
            loaded,
            ...(provider ? { provider } : {}),
            step,
            attempt: jobStep.attempt,
            ...(contextPack ? { contextPack } : {}),
          });
          contextPack = result.contextPack ?? contextPack;
          const committed = await this.repository.succeedStep({
            payload: durablePayload,
            step,
            progress: STEP_PROGRESS[step],
            output: result.output,
            cost: result.cost,
            checkpointPayload: result.checkpointPayload,
          });
          checkpoint = generationCheckpointSchema.parse(committed.checkpoint);
          break;
        } catch (error) {
          if (error instanceof JobStoppedError) {
            return;
          }
          if (
            error instanceof CostBudgetOverrunRecordedError ||
            (error instanceof Error && error.name === "CostBudgetOverrunRecordedError")
          ) {
            return;
          }
          if (error instanceof ProviderBudgetExceededError) {
            await this.repository.failStep({
              payload: durablePayload,
              step,
              code: "JOB_BUDGET_EXCEEDED",
              message: BUDGET_EXHAUSTED_MESSAGE,
              terminal: true,
              terminalStatus: "paused",
            });
            return;
          }
          const failure = toFailure(error);
          if (failure.failureClass === "budget") {
            await this.repository.failStep({
              payload: durablePayload,
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
            maxAutomaticAttempts: this.recoveryOptions.maxAutomaticAttempts,
          });
          await this.repository.failStep({
            payload: durablePayload,
            step,
            code: failure.code,
            message: failure.message,
            terminal: decision.terminal,
          });
          if (decision.terminal) {
            return;
          }
          this.traceLogger?.warn(
            {
              event: "worker.step.retry_scheduled",
              jobId: durablePayload.jobId,
              step,
              attempt: jobStep?.attempt ?? 1,
              failureClass: failure.failureClass,
              delayMs: decision.delayMs,
            },
            "Retryable generation step will resume from the committed checkpoint",
          );
          await this.recoveryOptions.sleep(decision.delayMs);
        }
      }
      await this.boundaryHook?.(step);
    }
    await this.repository.complete(durablePayload);
  }

  private async executeStep(input: {
    payload: GenerateChapterJob;
    loaded: LoadedGenerationJob;
    provider?: AiGateway;
    step: WorkerJobStep;
    attempt: number;
    contextPack?: ContextPackManifest;
  }): Promise<{
    output: Record<string, unknown>;
    cost: GenerationCost;
    checkpointPayload: Record<string, unknown>;
    contextPack?: ContextPackManifest;
  }> {
    switch (input.step) {
      case "prepare": {
        const sources = await this.requireSources(input.payload);
        validateBrief(sources);
        return {
          output: {
            modelConfigId: input.loaded.modelConfig.id,
            chapterId: input.payload.chapterId,
          },
          cost: zeroCost(),
          checkpointPayload: { sourcesReady: true },
        };
      }
      case "compile_context": {
        const sources = await this.requireSources(input.payload);
        const pack = compileChapterContextManifest(
          {
            branchId: input.payload.branchId,
            branchStatus: sources.branch.status,
            compilerVersion: "m1-context-v1",
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
            summaries: sources.summaries,
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
          output: { contextPackId, tokenUsed: pack.tokenUsed },
          cost: zeroCost(),
          checkpointPayload: { contextPackId, tokenUsed: pack.tokenUsed },
          contextPack: pack,
        };
      }
      case "draft": {
        const pack = input.contextPack ?? (await this.loadContextPack(input.payload));
        const prompt = promptFromPack(pack, "根据本章章纲起草完整章节。");
        const result = await this.providerCalls.call({
          payload: input.payload,
          provider: requireProvider(input.provider),
          step: "draft",
          attempt: input.attempt,
          role: "writer",
          operation: "draft",
          prompt,
          system: "你是长篇仙侠小说写作助手。只输出本章正文。",
          citations: pack.sourceRefs,
          parameters: { operation: "draft" },
          ...(this.traceLogger ? { traceLogger: this.traceLogger } : {}),
        });
        const version = await this.repository.saveGeneratedVersion({
          payload: input.payload,
          step: "draft",
          content: result.text,
        });
        return {
          output: { chapterVersionId: version.id, version: version.version },
          cost: toCost(result),
          checkpointPayload: { chapterVersionId: version.id },
        };
      }
      case "verify": {
        const draft = await this.repository.findGeneratedDraft(input.payload);
        if (!draft) {
          throw new Error("Draft checkpoint is missing");
        }
        const pack = input.contextPack ?? (await this.loadContextPack(input.payload));
        const prompt = `${promptFromPack(pack, "检查草稿与章纲、已确认设定和必用事实是否一致。")}\n\n草稿：\n${draft}`;
        const result = await this.providerCalls.call({
          payload: input.payload,
          provider: requireProvider(input.provider),
          step: "verify",
          attempt: input.attempt,
          role: "critic",
          operation: "verify",
          prompt,
          system: "你是连续性与知识边界审校员。输出简短、确定的审校结论。",
          citations: pack.sourceRefs,
          parameters: { operation: "verify" },
          ...(this.traceLogger ? { traceLogger: this.traceLogger } : {}),
        });
        return {
          output: { verification: result.text },
          cost: toCost(result),
          checkpointPayload: { verificationRecorded: true },
        };
      }
      case "revise": {
        const draft = await this.repository.findGeneratedDraft(input.payload);
        const verifyOutput = await this.repository.findStepOutput(input.payload, "verify");
        if (!draft) {
          throw new Error("Draft checkpoint is missing");
        }
        const pack = input.contextPack ?? (await this.loadContextPack(input.payload));
        const prompt = `${promptFromPack(pack, "根据审校结论定向修订草稿，保留已满足的章纲和必用事实。")}\n\n草稿：\n${draft}\n\n审校：\n${String(verifyOutput?.verification ?? "")}`;
        const result = await this.providerCalls.call({
          payload: input.payload,
          provider: requireProvider(input.provider),
          step: "revise",
          attempt: input.attempt,
          role: "reviser",
          operation: "revise",
          prompt,
          system: "你是定向修订编辑。只输出修订后的完整本章正文。",
          citations: pack.sourceRefs,
          parameters: { operation: "revise" },
          ...(this.traceLogger ? { traceLogger: this.traceLogger } : {}),
        });
        const version = await this.repository.saveGeneratedVersion({
          payload: input.payload,
          step: "revise",
          content: result.text,
        });
        return {
          output: { chapterVersionId: version.id, version: version.version },
          cost: toCost(result),
          checkpointPayload: { chapterVersionId: version.id },
        };
      }
      case "extract_facts": {
        const version = await this.repository.findLatestGeneratedVersion(input.payload);
        if (!version) {
          throw new Error("Generated chapter version is missing");
        }
        const candidates = extractFactCandidates(version.content);
        const proposalIds = await this.repository.persistFactProposals({
          payload: input.payload,
          sourceVersionId: version.id,
          candidates,
        });
        return {
          output: { sourceVersionId: version.id, proposalIds, proposalCount: proposalIds.length },
          cost: zeroCost(),
          checkpointPayload: { sourceVersionId: version.id, proposalIds },
        };
      }
      case "await_review": {
        const extraction = await this.repository.findStepOutput(input.payload, "extract_facts");
        const proposalIds = extraction?.proposalIds;
        if (!Array.isArray(proposalIds) || proposalIds.length === 0) {
          throw new Error("Fact extraction checkpoint is missing");
        }
        return {
          output: { proposalCount: proposalIds.length, awaiting: "fact_review" },
          cost: zeroCost(),
          checkpointPayload: { proposalIds },
        };
      }
    }
    throw new Error(`Unsupported generation step: ${input.step}`);
  }

  private async requireSources(payload: GenerateChapterJob): Promise<WorkerContextSources> {
    const sources = await this.repository.loadSources(payload);
    if (!sources) {
      throw new Error("Generation sources are no longer ready");
    }
    return sources;
  }

  private async loadContextPack(payload: GenerateChapterJob): Promise<ContextPackManifest> {
    const output = await this.repository.findStepOutput(payload, "compile_context");
    const contextPackId = output?.contextPackId;
    if (typeof contextPackId !== "string") {
      throw new Error("Context pack checkpoint is missing");
    }
    const pack = await this.repository.loadContextPack(payload, contextPackId);
    if (!pack) {
      throw new Error("Versioned context pack is missing");
    }
    return pack;
  }
}

function validateBrief(sources: WorkerContextSources): void {
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
    throw new Error("Chapter brief is not ready");
  }
}

function promptFromPack(pack: ContextPackManifest, instruction: string): string {
  return [
    instruction,
    "本章参考：",
    ...pack.selected.map((source) => `【${source.label}】\n${source.content}`),
    "来源引用：",
    ...pack.sourceRefs.map((ref) => `- ${ref.citation}`),
  ].join("\n\n");
}

function stepRequiresProvider(step: WorkerJobStep): boolean {
  return step === "draft" || step === "verify" || step === "revise";
}

function requireProvider(provider: AiGateway | undefined): AiGateway {
  if (!provider) {
    throw new Error("Model provider was not initialized");
  }
  return provider;
}

function stepInputHash(
  payload: GenerateChapterJob,
  step: WorkerJobStep,
  checkpoint: ReturnType<typeof generationCheckpointSchema.parse>,
): string {
  return sha256(
    stableStringify({
      jobId: payload.jobId,
      workId: payload.workId,
      branchId: payload.branchId,
      chapterId: payload.chapterId,
      idempotencyKey: payload.idempotencyKey,
      step,
      checkpointOutputRefs: checkpoint.outputRefs,
      checkpointPayload: checkpoint.payload,
    }),
  );
}

function toCost(result: GenerationResult): GenerationCost {
  const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
  return {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens,
    costCny: calculateModelCallCost(totalTokens, M0_COST_PER_TOKEN_CNY),
  };
}

function zeroCost(): GenerationCost {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}

function toFailure(error: unknown): {
  code: string;
  message: string;
  failureClass:
    | "provider"
    | "timeout"
    | "rate_limit"
    | "schema"
    | "policy"
    | "budget"
    | "cancelled"
    | "unknown";
  escalationReason: string;
} {
  if (error instanceof AiProviderError) {
    return describeProviderFailure(error);
  }
  if (error instanceof ModelConfigurationError) {
    return {
      code: "MODEL_PROVIDER_ERROR",
      message: "模型配置无法读取，草稿和检查点已保留",
      failureClass: "policy",
      escalationReason: "请检查正文模型配置后从断点重试",
    };
  }
  if (error instanceof ContextBudgetExceededError) {
    return {
      code: "JOB_BUDGET_EXCEEDED",
      message: BUDGET_EXHAUSTED_MESSAGE,
      failureClass: "budget",
      escalationReason: BUDGET_EXHAUSTED_ESCALATION,
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "生成任务失败，草稿和检查点已保留",
    failureClass: "unknown",
    escalationReason: "生成任务异常，请从断点重试或联系支持",
  };
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
