import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  BLUEPRINT_JOB_STEPS,
  blueprintCoreSettingDraftSchema,
  blueprintOutlineDraftSchema,
  blueprintStoryBibleDraftSchema,
  type BlueprintCheckpoint,
  type BlueprintConflict,
  type BlueprintCoreSettingDraft,
  type BlueprintCost,
  type BlueprintJobStep,
  type BlueprintMissingField,
  type BlueprintOutlineDraft,
  type BlueprintStoryBibleDraft,
  type GenerateBlueprintJob,
} from "@novel-brain/contracts";
import {
  AiProviderError,
  classifyAiFailure,
  M0_COST_PER_TOKEN_CNY,
  type AiGateway,
  type GenerationResult,
} from "@novel-brain/ai";
import { planProviderCallBudget, validateBlueprintCandidates } from "@novel-brain/core";
import { calculateModelCallCost } from "@novel-brain/db";

import { AI_GATEWAY } from "../generation/generation.tokens";
import type { ByokAiGatewayFactory, StoredModelConfig } from "../generation/model-provider.factory";
import { addBlueprintCost } from "./blueprint.cost";

export { validateBlueprintCandidates } from "@novel-brain/core";

export interface LoadedBlueprintJob {
  job: {
    id: string;
    status: string;
    userId: string;
    workId: string;
    branchId: string;
    modelConfigId: string | null;
    idempotencyKey: string;
    budget: GenerateBlueprintJob["budget"];
    checkpoint: BlueprintCheckpoint;
    cost: BlueprintCost;
  };
  blueprint: {
    id: string;
    status: string;
    progress: number;
    storyBible: BlueprintStoryBibleDraft | null;
    coreSettings: BlueprintCoreSettingDraft[];
    outline: BlueprintOutlineDraft | null;
  };
  work: {
    title: string;
    penName: string;
    idea: string | null;
    genre: string;
    scaleTarget: string;
    chapterLengthTarget: number;
    templatePackId: string | null;
  };
  genrePack: {
    fields: Record<string, unknown>;
    fieldSchema: Array<{
      key: string;
      required: boolean;
    }>;
    rules: Array<{ key: string; label: string }>;
    uiHints: Record<string, unknown>;
    generationGuidance: Record<string, unknown>;
  } | null;
  modelConfig: StoredModelConfig | null;
  pendingProviderResult?: {
    step: BlueprintJobStep;
    result: GenerationResult;
  };
}

export interface BlueprintStepResult {
  storyBible?: BlueprintStoryBibleDraft;
  coreSettings?: BlueprintCoreSettingDraft[];
  outline?: BlueprintOutlineDraft;
  missingFields?: BlueprintMissingField[];
  conflicts?: BlueprintConflict[];
  output: Record<string, unknown>;
  cost: BlueprintCost;
  checkpointPayload: Record<string, unknown>;
}

export interface BlueprintStepCommit {
  payload: GenerateBlueprintJob;
  step: BlueprintJobStep;
  nextStep: BlueprintJobStep;
  progress: number;
  result: BlueprintStepResult;
}

export interface BlueprintFailure {
  code: string;
  message: string;
  failureClass: string;
  retryable: boolean;
  cost?: BlueprintCost;
}

export abstract class BlueprintJobStore {
  abstract withJobLock<T>(jobId: string, operation: () => Promise<T>): Promise<T | undefined>;
  abstract loadJob(payload: GenerateBlueprintJob): Promise<LoadedBlueprintJob | undefined>;
  abstract begin(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
  ): Promise<BlueprintCheckpoint | undefined>;
  abstract isRunnable(payload: GenerateBlueprintJob): Promise<boolean>;
  abstract reserveProviderCall(
    payload: GenerateBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    projectedTokens: number,
    projectedCostCny: number,
  ): Promise<boolean>;
  abstract recordProviderResult(
    payload: GenerateBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    result: GenerationResult,
    cost: BlueprintCost,
  ): Promise<void>;
  abstract commitStep(commit: BlueprintStepCommit): Promise<BlueprintCheckpoint>;
  abstract completeReady(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    checkpoint: BlueprintCheckpoint,
  ): Promise<void>;
  abstract waitingModelConfig(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
  ): Promise<void>;
  abstract pauseBudget(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    projectedTokens: number,
    projectedCostCny: number,
  ): Promise<void>;
  abstract fail(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    failure: BlueprintFailure,
  ): Promise<void>;
}

type AiGatewayResolver = AiGateway | Pick<ByokAiGatewayFactory, "create">;

const STEP_PROGRESS: Record<BlueprintJobStep, number> = {
  prepare: 10,
  story_bible: 35,
  core_settings: 60,
  outline: 85,
  validate: 95,
  await_review: 100,
};

const PROVIDER_OUTPUT_TOKENS = {
  blueprint_story_bible: 8_000,
  blueprint_core_settings: 12_000,
  blueprint_outline: 64_000,
} as const;
class BlueprintStepCostError extends Error {
  constructor(
    readonly cause: unknown,
    readonly cost: BlueprintCost,
  ) {
    super(cause instanceof Error ? cause.message : "Blueprint provider output is invalid");
    this.name = "BlueprintStepCostError";
  }
}

class BlueprintContextWindowError extends Error {
  constructor(
    readonly projectedTokens: number,
    readonly contextWindowTokens: number,
  ) {
    super(
      `Blueprint call requires ${projectedTokens} tokens but the model context window is ${contextWindowTokens}`,
    );
    this.name = "BlueprintContextWindowError";
  }
}

@Injectable()
export class BlueprintJobProcessor {
  constructor(
    private readonly repository: BlueprintJobStore,
    @Inject(AI_GATEWAY) private readonly providerResolver: AiGatewayResolver,
  ) {}

  async process(payload: GenerateBlueprintJob): Promise<void> {
    await this.repository.withJobLock(payload.jobId, () => this.processLocked(payload));
  }

  parseStoryBible(text: string): BlueprintStoryBibleDraft {
    return blueprintStoryBibleDraftSchema.parse(JSON.parse(text));
  }

  parseCoreSettings(text: string): BlueprintCoreSettingDraft[] {
    return blueprintCoreSettingDraftSchema.array().min(1).max(200).parse(JSON.parse(text));
  }

  parseOutline(text: string): BlueprintOutlineDraft {
    return blueprintOutlineDraftSchema.parse(JSON.parse(text));
  }

  private async processLocked(payload: GenerateBlueprintJob): Promise<void> {
    const loaded = await this.repository.loadJob(payload);
    if (!loaded) {
      return;
    }
    if (
      ["waiting_review", "completed", "cancelled"].includes(loaded.job.status) ||
      ["waiting_review", "confirmed", "cancelled"].includes(loaded.blueprint.status)
    ) {
      return;
    }
    if (!loaded.modelConfig || !loaded.job.modelConfigId) {
      await this.repository.waitingModelConfig(payload, loaded);
      return;
    }

    let checkpoint = await this.repository.begin(payload, loaded);
    if (!checkpoint) {
      return;
    }
    let storyBible = loaded.blueprint.storyBible ?? undefined;
    let coreSettings =
      loaded.blueprint.coreSettings.length > 0 ? loaded.blueprint.coreSettings : undefined;
    let outline = loaded.blueprint.outline ?? undefined;
    let usedCost = loaded.job.cost;
    const modelRatePerTokenCny = loaded.modelConfig.ratePerTokenCny ?? M0_COST_PER_TOKEN_CNY;
    const startIndex = BLUEPRINT_JOB_STEPS.indexOf(checkpoint.step);
    let pendingProviderResult = loaded.pendingProviderResult;
    let provider: AiGateway;
    try {
      provider =
        "generateText" in this.providerResolver
          ? this.providerResolver
          : this.providerResolver.create(loaded.modelConfig);
    } catch (error) {
      await this.repository.fail(
        payload,
        loaded,
        checkpoint.step,
        checkpoint,
        toFailure(error, modelRatePerTokenCny),
      );
      return;
    }

    for (const step of BLUEPRINT_JOB_STEPS.slice(startIndex)) {
      if (!(await this.repository.isRunnable(payload))) {
        return;
      }
      try {
        const cachedProviderResult =
          pendingProviderResult?.step === step ? pendingProviderResult.result : undefined;
        let budget = { tokens: 0, costCny: 0 };
        if (!cachedProviderResult) {
          budget = this.projectBudget({
            loaded,
            step,
            modelRatePerTokenCny,
            ...(storyBible ? { storyBible } : {}),
            ...(coreSettings ? { coreSettings } : {}),
            ...(outline ? { outline } : {}),
          });
          if (
            usedCost.totalTokens + budget.tokens > loaded.job.budget.maxTokens ||
            usedCost.costCny + budget.costCny > loaded.job.budget.maxCostCny
          ) {
            await this.repository.pauseBudget(
              payload,
              loaded,
              step,
              checkpoint,
              budget.tokens,
              budget.costCny,
            );
            return;
          }
          if (providerStep(step)) {
            const reserved = await this.repository.reserveProviderCall(
              payload,
              step,
              checkpoint,
              budget.tokens,
              budget.costCny,
            );
            if (!reserved) {
              return;
            }
          }
        }

        const result = await this.executeStep({
          payload,
          loaded,
          checkpoint,
          step,
          provider,
          modelRatePerTokenCny,
          ...(cachedProviderResult ? { cachedProviderResult } : {}),
          ...(storyBible ? { storyBible } : {}),
          ...(coreSettings ? { coreSettings } : {}),
          ...(outline ? { outline } : {}),
        });
        storyBible = result.storyBible ?? storyBible;
        coreSettings = result.coreSettings ?? coreSettings;
        outline = result.outline ?? outline;
        if (!cachedProviderResult) {
          usedCost = addBlueprintCost(usedCost, result.cost);
        }
        const nextStep =
          BLUEPRINT_JOB_STEPS[BLUEPRINT_JOB_STEPS.indexOf(step) + 1] ?? "await_review";
        checkpoint = await this.repository.commitStep({
          payload,
          step,
          nextStep,
          progress: STEP_PROGRESS[step],
          result,
        });
        if (cachedProviderResult) {
          pendingProviderResult = undefined;
        }
      } catch (error) {
        await this.repository.fail(
          payload,
          loaded,
          step,
          checkpoint,
          toFailure(error, modelRatePerTokenCny),
        );
        return;
      }
    }
    await this.repository.completeReady(payload, loaded, checkpoint);
  }

  private async executeStep(input: {
    payload: GenerateBlueprintJob;
    loaded: LoadedBlueprintJob;
    checkpoint: BlueprintCheckpoint;
    step: BlueprintJobStep;
    provider: AiGateway;
    modelRatePerTokenCny: number;
    cachedProviderResult?: GenerationResult;
    storyBible?: BlueprintStoryBibleDraft;
    coreSettings?: BlueprintCoreSettingDraft[];
    outline?: BlueprintOutlineDraft;
  }): Promise<BlueprintStepResult> {
    switch (input.step) {
      case "prepare":
        return {
          output: {
            modelConfigId: input.loaded.job.modelConfigId,
            templatePackId: input.loaded.work.templatePackId,
          },
          cost: zeroCost(),
          checkpointPayload: { sourcesReady: true },
        };
      case "story_bible": {
        const result = await this.callProvider(
          input.provider,
          "blueprint_story_bible",
          storyBiblePrompt(input.loaded),
          input.cachedProviderResult,
        );
        const cost = costOf(result, input.modelRatePerTokenCny);
        if (!input.cachedProviderResult) {
          await this.repository.recordProviderResult(
            input.payload,
            input.step,
            input.checkpoint,
            result,
            cost,
          );
        }
        let storyBible: BlueprintStoryBibleDraft;
        try {
          storyBible = this.parseStoryBible(result.text);
        } catch (error) {
          throw new BlueprintStepCostError(error, cost);
        }
        return {
          storyBible,
          output: providerAuditOutput(input.loaded, "blueprint.story_bible.v1", result.text, {
            cardCount: storyBible.cards.length,
          }),
          cost,
          checkpointPayload: { storyBibleReady: true },
        };
      }
      case "core_settings": {
        requireStoryBible(input.storyBible);
        const result = await this.callProvider(
          input.provider,
          "blueprint_core_settings",
          coreSettingsPrompt(input.loaded, input.storyBible),
          input.cachedProviderResult,
        );
        const cost = costOf(result, input.modelRatePerTokenCny);
        if (!input.cachedProviderResult) {
          await this.repository.recordProviderResult(
            input.payload,
            input.step,
            input.checkpoint,
            result,
            cost,
          );
        }
        let coreSettings: BlueprintCoreSettingDraft[];
        try {
          coreSettings = this.parseCoreSettings(result.text);
        } catch (error) {
          throw new BlueprintStepCostError(error, cost);
        }
        return {
          coreSettings,
          output: providerAuditOutput(input.loaded, "blueprint.core_settings.v1", result.text, {
            settingCount: coreSettings.length,
          }),
          cost,
          checkpointPayload: { coreSettingsReady: true },
        };
      }
      case "outline": {
        requireStoryBible(input.storyBible);
        if (!input.coreSettings) {
          throw new Error("Core settings checkpoint is missing");
        }
        const result = await this.callProvider(
          input.provider,
          "blueprint_outline",
          outlinePrompt(input.loaded, input.storyBible, input.coreSettings),
          input.cachedProviderResult,
        );
        const cost = costOf(result, input.modelRatePerTokenCny);
        if (!input.cachedProviderResult) {
          await this.repository.recordProviderResult(
            input.payload,
            input.step,
            input.checkpoint,
            result,
            cost,
          );
        }
        let outline: BlueprintOutlineDraft;
        try {
          outline = this.parseOutline(result.text);
        } catch (error) {
          throw new BlueprintStepCostError(error, cost);
        }
        return {
          outline,
          output: providerAuditOutput(input.loaded, "blueprint.outline.v1", result.text, {
            nodeCount: outline.nodes.length,
            sceneCardCount: outline.sceneCards.length,
          }),
          cost,
          checkpointPayload: { outlineReady: true },
        };
      }
      case "validate": {
        requireStoryBible(input.storyBible);
        if (!input.coreSettings || !input.outline) {
          throw new Error("Blueprint candidate checkpoint is missing");
        }
        const genrePackFields = genrePackValidationFields(input.loaded.genrePack);
        const validation = validateBlueprintCandidates({
          storyBible: input.storyBible,
          coreSettings: input.coreSettings,
          outline: input.outline,
          generationGuidance: input.loaded.genrePack?.generationGuidance ?? {},
          genrePackFields: genrePackFields.required,
          optionalGenrePackFields: genrePackFields.optional,
          genre: input.loaded.work.genre,
          scaleTarget: input.loaded.work.scaleTarget,
        });
        return {
          missingFields: validation.missingFields,
          conflicts: validation.conflicts,
          output: {
            missingCount: validation.missingFields.length,
            conflictCount: validation.conflicts.length,
          },
          cost: zeroCost(),
          checkpointPayload: {
            missingCount: validation.missingFields.length,
            conflictCount: validation.conflicts.length,
          },
        };
      }
      case "await_review":
        return {
          output: { awaiting: "author_review" },
          cost: zeroCost(),
          checkpointPayload: { awaiting: "author_review" },
        };
    }
  }

  private projectBudget(input: {
    loaded: LoadedBlueprintJob;
    step: BlueprintJobStep;
    modelRatePerTokenCny: number;
    storyBible?: BlueprintStoryBibleDraft;
    coreSettings?: BlueprintCoreSettingDraft[];
    outline?: BlueprintOutlineDraft;
  }): { tokens: number; costCny: number } {
    if (!providerStep(input.step)) {
      return { tokens: 0, costCny: 0 };
    }
    const system = blueprintSystemPrompt();
    const prompt =
      input.step === "story_bible"
        ? storyBiblePrompt(input.loaded)
        : input.step === "core_settings" && input.storyBible
          ? coreSettingsPrompt(input.loaded, input.storyBible)
          : input.step === "outline" && input.storyBible && input.coreSettings
            ? outlinePrompt(input.loaded, input.storyBible, input.coreSettings)
            : "";
    const plan = planProviderCallBudget({
      system,
      prompt,
      maxOutputTokens: providerOutputTokens(input.step),
    });
    if (
      input.loaded.modelConfig?.contextWindowTokens &&
      plan.reservedTokens > input.loaded.modelConfig.contextWindowTokens
    ) {
      throw new BlueprintContextWindowError(
        plan.reservedTokens,
        input.loaded.modelConfig.contextWindowTokens,
      );
    }
    return {
      tokens: plan.reservedTokens,
      costCny: calculateModelCallCost(plan.reservedTokens, input.modelRatePerTokenCny),
    };
  }

  private async callProvider(
    provider: AiGateway,
    operation: "blueprint_story_bible" | "blueprint_core_settings" | "blueprint_outline",
    prompt: string,
    cachedResult?: GenerationResult,
  ): Promise<GenerationResult> {
    if (cachedResult) {
      return cachedResult;
    }
    return provider.generateText({
      operation,
      prompt,
      system: blueprintSystemPrompt(),
      maxTokens: PROVIDER_OUTPUT_TOKENS[operation],
      responseFormat: "json",
    });
  }
}

function storyBiblePrompt(loaded: LoadedBlueprintJob): string {
  return [
    `作品：${loaded.work.title}`,
    `笔名：${loaded.work.penName}`,
    `题材：${loaded.work.genre}`,
    `规模：${loaded.work.scaleTarget}`,
    `章节字数：${loaded.work.chapterLengthTarget}`,
    `故事灵感：${loaded.work.idea ?? ""}`,
    `题材字段：${JSON.stringify(loaded.genrePack?.fields ?? {})}`,
    `题材字段定义：${JSON.stringify(loaded.genrePack?.fieldSchema ?? [])}`,
    `题材规则：${JSON.stringify(loaded.genrePack?.rules ?? [])}`,
    `题材界面提示：${JSON.stringify(loaded.genrePack?.uiHints ?? {})}`,
    `生成指南：${JSON.stringify(loaded.genrePack?.generationGuidance ?? {})}`,
    "输出严格 JSON 对象，包含九张固定 key 的故事圣经卡片。",
  ].join("\n");
}

function coreSettingsPrompt(
  loaded: LoadedBlueprintJob,
  storyBible: BlueprintStoryBibleDraft,
): string {
  return [
    `基于以下故事圣经生成核心设定候选：${JSON.stringify(storyBible)}`,
    `题材：${loaded.work.genre}`,
    `题材必填字段：${JSON.stringify(genrePackValidationFields(loaded.genrePack).required)}`,
    `题材指南：${JSON.stringify(loaded.genrePack?.generationGuidance ?? {})}`,
    "每个必填题材字段必须以精确 key/value 写入至少一个核心设定的 data 中。",
    "输出严格 JSON 数组，字段符合核心设定候选结构。",
  ].join("\n");
}

function outlinePrompt(
  loaded: LoadedBlueprintJob,
  storyBible: BlueprintStoryBibleDraft,
  coreSettings: BlueprintCoreSettingDraft[],
): string {
  return [
    `基于故事圣经生成初始大纲：${JSON.stringify(storyBible)}`,
    `核心设定：${JSON.stringify(coreSettings)}`,
    `规模：${loaded.work.scaleTarget}`,
    "输出严格 JSON 对象，包含 nodes、volumeContracts、sceneCards。",
  ].join("\n");
}

function blueprintSystemPrompt(): string {
  return "你是 NovelBrain 的故事蓝图规划代理。只返回严格 JSON，不输出解释、Markdown 或代码围栏。";
}

function providerAuditOutput(
  loaded: LoadedBlueprintJob,
  promptVersion: string,
  prompt: string,
  output: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...output,
    model: loaded.modelConfig?.model ?? null,
    promptVersion,
    pricingVersion: loaded.modelConfig?.ratePerTokenCny
      ? "configured-rate-v1"
      : "m0-cost-per-token-v1",
    sourceHash: createHash("sha256").update(prompt).digest("hex"),
  };
}

function requireStoryBible(
  storyBible: BlueprintStoryBibleDraft | undefined,
): asserts storyBible is BlueprintStoryBibleDraft {
  if (!storyBible) {
    throw new Error("Story bible checkpoint is missing");
  }
}

function providerStep(step: BlueprintJobStep): boolean {
  return step === "story_bible" || step === "core_settings" || step === "outline";
}

function genrePackValidationFields(genrePack: LoadedBlueprintJob["genrePack"]): {
  required: Record<string, unknown>;
  optional: Record<string, unknown>;
} {
  if (!genrePack) {
    return { required: {}, optional: {} };
  }
  const definitions =
    genrePack.fieldSchema.length > 0
      ? genrePack.fieldSchema
      : Object.keys(genrePack.fields).map((key) => ({ key, required: true }));
  return {
    required: Object.fromEntries(
      definitions
        .filter((definition) => definition.required)
        .map((definition) => [definition.key, genrePack.fields[definition.key]]),
    ),
    optional: Object.fromEntries(
      definitions
        .filter((definition) => !definition.required)
        .map((definition) => [definition.key, genrePack.fields[definition.key]]),
    ),
  };
}

function providerOutputTokens(step: BlueprintJobStep): number {
  if (step === "story_bible") return PROVIDER_OUTPUT_TOKENS.blueprint_story_bible;
  if (step === "core_settings") return PROVIDER_OUTPUT_TOKENS.blueprint_core_settings;
  if (step === "outline") return PROVIDER_OUTPUT_TOKENS.blueprint_outline;
  return 0;
}

function costOf(result: GenerationResult, modelRatePerTokenCny: number): BlueprintCost {
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  const totalTokens = inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costCny: calculateModelCallCost(totalTokens, modelRatePerTokenCny),
  };
}

function zeroCost(): BlueprintCost {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}

function toFailure(error: unknown, modelRatePerTokenCny: number): BlueprintFailure {
  if (error instanceof BlueprintContextWindowError) {
    return {
      code: "MODEL_CONTEXT_EXCEEDED",
      message: "故事蓝图的输入与输出预算超过当前模型上下文窗口，请更换模型后重试",
      failureClass: "schema",
      retryable: true,
    };
  }
  if (error instanceof BlueprintStepCostError) {
    return {
      code: "MODEL_RESPONSE_INVALID",
      message: "模型返回内容无法按蓝图结构解析，检查点已保留",
      failureClass: "schema",
      retryable: true,
      cost: error.cost,
    };
  }
  if (error instanceof AiProviderError) {
    const failureClass = classifyAiFailure(error);
    const cost = error.usage
      ? {
          inputTokens: error.usage.inputTokens,
          outputTokens: error.usage.outputTokens,
          totalTokens: error.usage.inputTokens + error.usage.outputTokens,
          costCny: calculateModelCallCost(
            error.usage.inputTokens + error.usage.outputTokens,
            modelRatePerTokenCny,
          ),
        }
      : undefined;
    return {
      code:
        failureClass === "timeout"
          ? "MODEL_TIMEOUT"
          : failureClass === "rate_limit"
            ? "MODEL_RATE_LIMITED"
            : "MODEL_PROVIDER_ERROR",
      message: "故事蓝图生成失败，检查点已保留",
      failureClass,
      retryable: error.retryable,
      ...(cost ? { cost } : {}),
    };
  }
  const schemaFailure =
    error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError");
  return {
    code: schemaFailure ? "MODEL_RESPONSE_INVALID" : "INTERNAL_ERROR",
    message: "故事蓝图生成失败，检查点已保留",
    failureClass: schemaFailure ? "schema" : "unknown",
    retryable: true,
  };
}
