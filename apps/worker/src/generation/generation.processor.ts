import { Inject, Injectable } from "@nestjs/common";
import { type GenerateChapterJob, type GenerationCost } from "@novel-brain/contracts";
import {
  AiProviderError,
  M0_COST_PER_TOKEN_CNY,
  type AiGateway,
  type GenerationOperation,
  type GenerationResult,
} from "@novel-brain/ai";
import {
  compileChapterContext,
  ContextBudgetExceededError,
  extractFactCandidates,
  type CompiledContextPack,
} from "@novel-brain/core";

import { AI_GATEWAY } from "./generation.tokens";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  WorkerGenerationRepository,
  type JobRecord,
  type LoadedGenerationJob,
  type WorkerContextSources,
} from "./generation.repository";

const STEP_PROGRESS = {
  prepare: 10,
  compile_context: 30,
  draft: 55,
  verify: 75,
  revise: 90,
  extract_facts: 96,
  await_review: 100,
} as const;
const EXECUTED_STEPS = [
  "prepare",
  "compile_context",
  "draft",
  "verify",
  "revise",
  "extract_facts",
  "await_review",
] as const;
type ExecutedStep = (typeof EXECUTED_STEPS)[number];
class JobBudgetExceededError extends Error {
  constructor() {
    super("Generation budget exhausted");
    this.name = "JobBudgetExceededError";
  }
}

@Injectable()
export class GenerationJobProcessor {
  constructor(
    private readonly repository: WorkerGenerationRepository,
    @Inject(AI_GATEWAY) private readonly provider: AiGateway,
  ) {}

  async process(payload: GenerateChapterJob): Promise<void> {
    const loaded = await this.repository.loadJob(payload);
    if (!loaded) {
      return;
    }
    const started = await this.repository.begin(payload);
    if (started === "terminal" || !started) {
      return;
    }
    let job = started;
    const checkpointIndex = EXECUTED_STEPS.indexOf(payload.checkpoint.step as ExecutedStep);
    const startIndex = Math.max(0, checkpointIndex);
    let contextPack: CompiledContextPack | undefined;

    for (const step of EXECUTED_STEPS) {
      const stepIndex = EXECUTED_STEPS.indexOf(step);
      if (stepIndex < startIndex) {
        continue;
      }
      if (await this.repository.isCancelled(payload)) {
        return;
      }
      try {
        await this.repository.startStep(
          payload,
          step,
          inputHash(payload, step),
          STEP_PROGRESS[step],
        );
        const result = await this.executeStep({
          payload,
          loaded,
          job,
          step,
          ...(contextPack ? { contextPack } : {}),
        });
        contextPack = result.contextPack ?? contextPack;
        job = await this.repository.succeedStep({
          payload,
          step,
          progress: STEP_PROGRESS[step],
          output: result.output,
          cost: result.cost,
          checkpointPayload: result.checkpointPayload,
        });
      } catch (error) {
        const failure = toFailure(error);
        await this.repository.failStep({
          payload,
          step,
          code: failure.code,
          message: failure.message,
        });
        return;
      }
    }
    await this.repository.complete(payload);
  }

  private async executeStep(input: {
    payload: GenerateChapterJob;
    loaded: LoadedGenerationJob;
    job: JobRecord;
    step: ExecutedStep;
    contextPack?: CompiledContextPack;
  }): Promise<{
    output: Record<string, unknown>;
    cost: GenerationCost;
    checkpointPayload: Record<string, unknown>;
    contextPack?: CompiledContextPack;
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
        const pack = compileChapterContext(
          {
            chapter: {
              id: sources.chapter.id,
              number: sources.chapter.number,
              title: sources.chapter.title,
              brief: sources.chapter.brief,
            },
            storyBible: {
              id: sources.storyBible.id,
              cards: sources.storyBible.cards,
            },
            settings: sources.settings.map((setting) => ({
              id: setting.id,
              name: setting.name,
              summary: setting.summary,
              attributes: setting.attributes,
            })),
            previousVersions: sources.previousVersions,
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
        const result = await this.callProvider({
          payload: input.payload,
          job: input.job,
          operation: "draft",
          prompt,
          system: "你是长篇仙侠小说写作助手。只输出本章正文。",
        });
        const version = await this.repository.saveGeneratedVersion({
          payload: input.payload,
          step: "draft",
          content: result.text,
        });
        await this.recordProviderResult(input.payload, "draft", "writer", prompt, result, pack);
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
        const result = await this.callProvider({
          payload: input.payload,
          job: input.job,
          operation: "verify",
          prompt,
          system: "你是连续性与知识边界审校员。输出简短、确定的审校结论。",
        });
        await this.recordProviderResult(input.payload, "verify", "verifier", prompt, result, pack);
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
        const result = await this.callProvider({
          payload: input.payload,
          job: input.job,
          operation: "revise",
          prompt,
          system: "你是定向修订编辑。只输出修订后的完整本章正文。",
        });
        const version = await this.repository.saveGeneratedVersion({
          payload: input.payload,
          step: "revise",
          content: result.text,
        });
        await this.recordProviderResult(input.payload, "revise", "reviser", prompt, result, pack);
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

  private async loadContextPack(payload: GenerateChapterJob): Promise<CompiledContextPack> {
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

  private async callProvider(input: {
    payload: GenerateChapterJob;
    job: JobRecord;
    operation: GenerationOperation;
    prompt: string;
    system: string;
  }): Promise<GenerationResult> {
    const estimatedTokens = estimateTokens(input.prompt) + 600;
    reserveBudget(input.job, estimatedTokens);
    return this.provider.generateText({
      prompt: input.prompt,
      system: input.system,
      model: "fake-deterministic",
      maxTokens: 2_000,
      operation: input.operation,
    });
  }

  private async recordProviderResult(
    payload: GenerateChapterJob,
    step: "draft" | "verify" | "revise",
    role: string,
    prompt: string,
    result: GenerationResult,
    pack: CompiledContextPack,
  ): Promise<void> {
    await this.repository.recordAgentRun({
      payload,
      step,
      role,
      inputHash: createHash("sha256").update(prompt).digest("hex"),
      output: result.text,
      citations: pack.sourceRefs,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costCny: calculateCost(result.usage.inputTokens + result.usage.outputTokens),
      },
      startedAt: new Date(),
    });
    await this.repository.recordUsage({
      payload,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCny: calculateCost(result.usage.inputTokens + result.usage.outputTokens),
    });
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

function promptFromPack(pack: CompiledContextPack, instruction: string): string {
  return [
    instruction,
    "本章参考：",
    ...pack.selected.map((source) => `【${source.label}】\n${source.content}`),
    "来源引用：",
    ...pack.sourceRefs.map((ref) => `- ${ref.citation}`),
  ].join("\n\n");
}

function inputHash(payload: GenerateChapterJob, step: string): string {
  return `${payload.jobId}:${payload.chapterId}:${step}:${payload.idempotencyKey}`;
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(Array.from(value.replace(/\s/gu, "")).length / 2));
}

function reserveBudget(job: JobRecord, estimatedTokens: number): void {
  const budget = job.budget as { maxTokens?: number; maxCostCny?: number };
  const cost = job.cost as Partial<GenerationCost>;
  const usedTokens = Number(cost.totalTokens ?? 0);
  const usedCost = Number(cost.costCny ?? 0);
  if (
    usedTokens + estimatedTokens > Number(budget.maxTokens ?? 0) ||
    usedCost + calculateCost(estimatedTokens) > Number(budget.maxCostCny ?? 0)
  ) {
    throw new JobBudgetExceededError();
  }
}

function toCost(result: GenerationResult): GenerationCost {
  return {
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    totalTokens: result.usage.inputTokens + result.usage.outputTokens,
    costCny: calculateCost(result.usage.inputTokens + result.usage.outputTokens),
  };
}

function calculateCost(tokens: number): number {
  return Number((tokens * M0_COST_PER_TOKEN_CNY).toFixed(8));
}

function zeroCost(): GenerationCost {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}

function toFailure(error: unknown): { code: string; message: string } {
  if (error instanceof JobBudgetExceededError) {
    return {
      code: "JOB_BUDGET_EXCEEDED",
      message: "本章生成预算已用完，草稿和检查点已保留",
    };
  }
  if (error instanceof AiProviderError) {
    return {
      code: "MODEL_PROVIDER_ERROR",
      message: "模型服务暂时不可用，草稿和检查点已保留",
    };
  }
  if (error instanceof ContextBudgetExceededError) {
    return {
      code: "JOB_BUDGET_EXCEEDED",
      message: "本章生成预算已用完，草稿和检查点已保留",
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: "生成任务失败，草稿和检查点已保留",
  };
}
import { createHash } from "node:crypto";
