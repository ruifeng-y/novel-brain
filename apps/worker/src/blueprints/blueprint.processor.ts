import { Inject, Injectable } from "@nestjs/common";
import {
  BLUEPRINT_JOB_STEPS,
  blueprintConflictSchema,
  blueprintCoreSettingDraftSchema,
  blueprintMissingFieldSchema,
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
  genrePackGenerationGuidanceSchema,
} from "@novel-brain/contracts";
import {
  AiProviderError,
  classifyAiFailure,
  M0_COST_PER_TOKEN_CNY,
  type AiGateway,
  type GenerationResult,
} from "@novel-brain/ai";
import { planProviderCallBudget, PROVIDER_CALL_MAX_OUTPUT_TOKENS } from "@novel-brain/core";
import { calculateModelCallCost } from "@novel-brain/db";
import { uuidv7 } from "uuidv7";

import { AI_GATEWAY } from "../generation/generation.tokens";
import type { ByokAiGatewayFactory, StoredModelConfig } from "../generation/model-provider.factory";

export interface LoadedBlueprintJob {
  job: {
    id: string;
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
    rules: Array<{ key: string; label: string }>;
    uiHints: Record<string, unknown>;
    generationGuidance: Record<string, unknown>;
  } | null;
  modelConfig: StoredModelConfig | null;
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
}

export abstract class BlueprintJobStore {
  abstract withJobLock<T>(jobId: string, operation: () => Promise<T>): Promise<T | undefined>;
  abstract loadJob(payload: GenerateBlueprintJob): Promise<LoadedBlueprintJob | undefined>;
  abstract begin(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
  ): Promise<BlueprintCheckpoint>;
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
    if (!loaded.modelConfig || !loaded.job.modelConfigId) {
      await this.repository.waitingModelConfig(payload, loaded);
      return;
    }

    let checkpoint = await this.repository.begin(payload, loaded);
    let storyBible = loaded.blueprint.storyBible ?? undefined;
    let coreSettings =
      loaded.blueprint.coreSettings.length > 0 ? loaded.blueprint.coreSettings : undefined;
    let outline = loaded.blueprint.outline ?? undefined;
    let usedCost = loaded.job.cost;
    const startIndex = BLUEPRINT_JOB_STEPS.indexOf(checkpoint.step);
    const provider =
      "generateText" in this.providerResolver
        ? this.providerResolver
        : this.providerResolver.create(loaded.modelConfig);

    for (const step of BLUEPRINT_JOB_STEPS.slice(startIndex)) {
      try {
        const budget = this.projectBudget({
          loaded,
          step,
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

        const result = await this.executeStep({
          payload,
          loaded,
          checkpoint,
          step,
          provider,
          ...(storyBible ? { storyBible } : {}),
          ...(coreSettings ? { coreSettings } : {}),
          ...(outline ? { outline } : {}),
        });
        storyBible = result.storyBible ?? storyBible;
        coreSettings = result.coreSettings ?? coreSettings;
        outline = result.outline ?? outline;
        usedCost = addCost(usedCost, result.cost);
        const nextStep =
          BLUEPRINT_JOB_STEPS[BLUEPRINT_JOB_STEPS.indexOf(step) + 1] ?? "await_review";
        checkpoint = await this.repository.commitStep({
          payload,
          step,
          nextStep,
          progress: STEP_PROGRESS[step],
          result,
        });
      } catch (error) {
        await this.repository.fail(payload, loaded, step, checkpoint, toFailure(error));
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
        );
        const storyBible = this.parseStoryBible(result.text);
        return {
          storyBible,
          output: { cardCount: storyBible.cards.length },
          cost: costOf(result),
          checkpointPayload: { storyBibleReady: true },
        };
      }
      case "core_settings": {
        requireStoryBible(input.storyBible);
        const result = await this.callProvider(
          input.provider,
          "blueprint_core_settings",
          coreSettingsPrompt(input.loaded, input.storyBible),
        );
        const coreSettings = this.parseCoreSettings(result.text);
        return {
          coreSettings,
          output: { settingCount: coreSettings.length },
          cost: costOf(result),
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
        );
        const outline = this.parseOutline(result.text);
        return {
          outline,
          output: {
            nodeCount: outline.nodes.length,
            sceneCardCount: outline.sceneCards.length,
          },
          cost: costOf(result),
          checkpointPayload: { outlineReady: true },
        };
      }
      case "validate": {
        requireStoryBible(input.storyBible);
        if (!input.coreSettings || !input.outline) {
          throw new Error("Blueprint candidate checkpoint is missing");
        }
        const validation = validateBlueprintCandidates({
          storyBible: input.storyBible,
          coreSettings: input.coreSettings,
          outline: input.outline,
          generationGuidance: input.loaded.genrePack?.generationGuidance ?? {},
          genre: input.loaded.work.genre,
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
      maxOutputTokens: PROVIDER_CALL_MAX_OUTPUT_TOKENS,
    });
    return {
      tokens: plan.reservedTokens,
      costCny: calculateModelCallCost(plan.reservedTokens, M0_COST_PER_TOKEN_CNY),
    };
  }

  private async callProvider(
    provider: AiGateway,
    operation: "blueprint_story_bible" | "blueprint_core_settings" | "blueprint_outline",
    prompt: string,
  ): Promise<GenerationResult> {
    return provider.generateText({
      operation,
      prompt,
      system: blueprintSystemPrompt(),
      maxTokens: PROVIDER_CALL_MAX_OUTPUT_TOKENS,
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
    `题材规则：${JSON.stringify(loaded.genrePack?.rules ?? [])}`,
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
    `题材指南：${JSON.stringify(loaded.genrePack?.generationGuidance ?? {})}`,
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

function validateBlueprintCandidates(input: {
  storyBible: BlueprintStoryBibleDraft;
  coreSettings: BlueprintCoreSettingDraft[];
  outline: BlueprintOutlineDraft;
  generationGuidance: Record<string, unknown>;
  genre: string;
}): { missingFields: BlueprintMissingField[]; conflicts: BlueprintConflict[] } {
  const missingFields: BlueprintMissingField[] = [];
  const conflicts: BlueprintConflict[] = [];
  const requiredTypes: BlueprintCoreSettingDraft["type"][] = [
    "world_rule",
    "character",
    "faction",
    "map",
    "power_system",
    "item",
    "timeline_event",
    ...(input.genre === "xianxia" ? (["golden_finger"] as const) : []),
  ];
  const types = new Set(input.coreSettings.map((setting) => setting.type));
  for (const type of requiredTypes) {
    if (!types.has(type)) {
      missingFields.push(
        blueprintMissingFieldSchema.parse({
          key: `core_setting:${type}`,
          label: type,
          required: true,
          severity: "P0",
          message: `核心设定缺少 ${type}`,
        }),
      );
    }
  }
  const guidance = genrePackGenerationGuidanceSchema.safeParse(input.generationGuidance);
  if (guidance.success) {
    const corpus = JSON.stringify({
      storyBible: input.storyBible,
      coreSettings: input.coreSettings,
      outline: input.outline,
    });
    for (const forbidden of guidance.data.forbiddenElements) {
      if (corpus.includes(forbidden)) {
        conflicts.push(
          blueprintConflictSchema.parse({
            id: uuidv7(),
            severity: "P0",
            title: "题材禁用元素",
            detail: `蓝图包含题材禁用元素：${forbidden}`,
            affectedKeys: ["forbidden_element"],
            status: "open",
          }),
        );
      }
    }
  }

  const nodes = input.outline.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => node.level === "book");
  if (roots.length !== 1 || roots[0]?.parentId !== null) {
    conflicts.push(structureConflict("大纲必须恰好有一个全书根节点"));
  }
  for (const node of nodes) {
    const expectedParent =
      node.level === "book"
        ? null
        : node.level === "volume"
          ? "book"
          : node.level === "act"
            ? "volume"
            : node.level === "chapter"
              ? "act"
              : "chapter";
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (
      (expectedParent === null && node.parentId !== null) ||
      (expectedParent !== null && parent?.level !== expectedParent)
    ) {
      conflicts.push(structureConflict(`大纲节点 ${node.title} 的上级层级无效`));
    }
  }
  const chapters = nodes.filter((node) => node.level === "chapter");
  const chapterNumbers = chapters
    .map((node) => node.chapterNumber)
    .sort((a, b) => (a ?? 0) - (b ?? 0));
  if (chapterNumbers.some((number, index) => number !== index + 1)) {
    conflicts.push(structureConflict("章号必须从 1 开始连续递增"));
  }
  if (chapters.some((chapter) => !chapter.brief)) {
    conflicts.push(structureConflict("每个章节点必须有完整章纲"));
  }
  const sceneNodes = nodes.filter((node) => node.level === "scene");
  if (
    chapters.some(
      (chapter) => sceneNodes.filter((scene) => scene.parentId === chapter.id).length < 2,
    )
  ) {
    conflicts.push(structureConflict("每章至少需要两个场景"));
  }
  const volumeIds = new Set(input.outline.volumeContracts.map((contract) => contract.nodeId));
  if (nodes.filter((node) => node.level === "volume").some((volume) => !volumeIds.has(volume.id))) {
    conflicts.push(structureConflict("每个卷节点必须有卷契约"));
  }
  const sceneCardIds = new Set(input.outline.sceneCards.map((card) => card.nodeId));
  if (sceneNodes.some((scene) => !sceneCardIds.has(scene.id))) {
    conflicts.push(structureConflict("每个场景节点必须有场景卡"));
  }
  if (nodes.some((node) => node.status !== "planned")) {
    conflicts.push(structureConflict("初始大纲节点必须全部处于 planned 状态"));
  }
  return { missingFields, conflicts };
}

function structureConflict(message: string): BlueprintConflict {
  return blueprintConflictSchema.parse({
    id: uuidv7(),
    severity: "P0",
    title: "大纲结构冲突",
    detail: message,
    affectedKeys: ["outline"],
    status: "open",
  });
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

function costOf(result: GenerationResult): BlueprintCost {
  const inputTokens = result.usage.inputTokens;
  const outputTokens = result.usage.outputTokens;
  const totalTokens = inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    costCny: calculateModelCallCost(totalTokens, M0_COST_PER_TOKEN_CNY),
  };
}

function zeroCost(): BlueprintCost {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}

function addCost(left: BlueprintCost, right: BlueprintCost): BlueprintCost {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costCny: left.costCny + right.costCny,
  };
}

function toFailure(error: unknown): BlueprintFailure {
  if (error instanceof AiProviderError) {
    const failureClass = classifyAiFailure(error);
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
    };
  }
  return {
    code: error instanceof SyntaxError ? "MODEL_RESPONSE_INVALID" : "INTERNAL_ERROR",
    message: "故事蓝图生成失败，检查点已保留",
    failureClass: error instanceof SyntaxError ? "schema" : "unknown",
    retryable: true,
  };
}
