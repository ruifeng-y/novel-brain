import { describe, expect, it } from "vitest";
import type {
  BlueprintCheckpoint,
  BlueprintCost,
  GenerateBlueprintJob,
} from "@novel-brain/contracts";
import {
  BLUEPRINT_JOB_STEPS,
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
} from "@novel-brain/contracts";
import type { AiGateway, GenerationRequest, GenerationResult } from "@novel-brain/ai";
import { AiProviderError } from "@novel-brain/ai";

import {
  BlueprintJobProcessor,
  BlueprintJobStore,
  validateBlueprintCandidates,
  type BlueprintFailure,
  type BlueprintStepCommit,
  type BlueprintStepResult,
  type LoadedBlueprintJob,
} from "../src/blueprints/blueprint.processor";

describe("BlueprintJobProcessor", () => {
  it("persists every generation section and stops for author review", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = new SequencedBlueprintProvider();
    const processor = new BlueprintJobProcessor(store, provider);

    await processor.process(blueprintPayload());

    expect(provider.operations).toEqual([
      "blueprint_story_bible",
      "blueprint_core_settings",
      "blueprint_outline",
    ]);
    expect(store.commits.map((commit) => commit.step)).toEqual([...BLUEPRINT_JOB_STEPS]);
    expect(store.status).toBe("waiting_review");
    expect(store.checkpoint.step).toBe("await_review");
    expect(store.storyBible?.cards).toHaveLength(9);
    expect(store.coreSettings?.length).toBeGreaterThanOrEqual(7);
    expect(store.outline?.sceneCards).toHaveLength(24);
    expect(store.chapterVersionCount).toBe(0);
    expect(store.notifications).toEqual(["ready"]);
    expect(store.commits[1]?.result.output).toMatchObject({
      model: "deepseek-chat",
      promptVersion: "blueprint.story_bible.v1",
      pricingVersion: "m0-cost-per-token-v1",
    });
  });

  it("passes genre-pack UI hints and structured field requirements to generation", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.requests[0]?.prompt).toContain('"worldLabel":"修真世界"');
    expect(provider.requests[1]?.prompt).toContain("每个必填题材字段必须以精确 key/value");
    expect(provider.requests[1]?.prompt).toContain('"genre":"仙侠"');
  });

  it("reserves enough output tokens for a complete initial outline", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.requests.map((request) => request.maxTokens)).toEqual([8_000, 12_000, 64_000]);
  });

  it("fails before calling a provider when the projected prompt exceeds its context window", async () => {
    const loaded = loadedJob();
    loaded.modelConfig = { ...loaded.modelConfig!, contextWindowTokens: 100 };
    const store = new InMemoryBlueprintStore(loaded);
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.operations).toEqual([]);
    expect(store.status).toBe("failed");
    expect(store.failure).toMatchObject({
      code: "MODEL_CONTEXT_EXCEEDED",
      retryable: true,
    });
  });

  it("waits for model configuration without calling the provider", async () => {
    const store = new InMemoryBlueprintStore({
      ...loadedJob(),
      job: { ...loadedJob().job, modelConfigId: null },
      modelConfig: null,
    });
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.operations).toEqual([]);
    expect(store.status).toBe("waiting_model_config");
    expect(store.notifications).toEqual(["waiting_model_config"]);
  });

  it("records provider setup failures as a recoverable failed state", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = {
      create() {
        throw new Error("model key could not be decrypted");
      },
    };

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(store.status).toBe("failed");
    expect(store.failure).toMatchObject({
      code: "INTERNAL_ERROR",
      failureClass: "unknown",
      retryable: true,
    });
    expect(store.notifications).toEqual(["failed"]);
  });

  it("stops before the next step when a checkpointed job is cancelled", async () => {
    const store = new InMemoryBlueprintStore();
    store.cancelAfterStep = "story_bible";
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.operations).toEqual(["blueprint_story_bible"]);
    expect(store.commits.map((commit) => commit.step)).toEqual(["prepare", "story_bible"]);
    expect(store.status).toBe("cancelled");
  });

  it("reuses a persisted provider result after checkpoint commit failure", async () => {
    const store = new InMemoryBlueprintStore();
    store.failCommitForStep = "story_bible";
    const provider = new SequencedBlueprintProvider();
    const processor = new BlueprintJobProcessor(store, provider);

    await processor.process(blueprintPayload());
    expect(store.status).toBe("failed");

    await processor.process(blueprintPayload());

    expect(provider.operations).toEqual([
      "blueprint_story_bible",
      "blueprint_core_settings",
      "blueprint_outline",
    ]);
    expect(store.status).toBe("waiting_review");
  });

  it("pauses before a provider call that would exceed the budget", async () => {
    const loaded = loadedJob();
    const store = new InMemoryBlueprintStore({
      ...loaded,
      job: {
        ...loaded.job,
        budget: { maxTokens: 1000, maxCostCny: 0.1 },
        cost: { inputTokens: 500000, outputTokens: 90000, totalTokens: 590000, costCny: 9.9 },
      },
    });
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.operations).toEqual([]);
    expect(store.status).toBe("budget_paused");
    expect(store.notifications).toEqual(["budget_paused"]);
  });

  it("resumes from the next persisted step without repeating provider calls", async () => {
    const loaded = loadedJob();
    const store = new InMemoryBlueprintStore({
      ...loaded,
      blueprint: {
        ...loaded.blueprint,
        storyBible: { cards: storyBibleCards() },
      },
      job: {
        ...loaded.job,
        checkpoint: {
          ...loaded.job.checkpoint,
          revision: 2,
          step: "core_settings",
        },
      },
    });
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.operations).toEqual(["blueprint_core_settings", "blueprint_outline"]);
    expect(store.commits.map((commit) => commit.step)).toEqual([
      "core_settings",
      "outline",
      "validate",
      "await_review",
    ]);
  });

  it("records provider rate limits as a recoverable failed state", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = new SequencedBlueprintProvider("blueprint_story_bible", "rate_limit");

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(store.status).toBe("failed");
    expect(store.failure).toMatchObject({
      code: "MODEL_RATE_LIMITED",
      failureClass: "rate_limit",
      retryable: true,
    });
    expect(store.notifications).toEqual(["failed"]);
  });

  it("records malformed provider output as a schema failure", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = new SequencedBlueprintProvider("blueprint_story_bible", "invalid_json");

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(store.status).toBe("failed");
    expect(store.failure).toMatchObject({
      code: "MODEL_RESPONSE_INVALID",
      failureClass: "schema",
      cost: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
  });

  it("classifies schema-invalid JSON as a model response failure", async () => {
    const store = new InMemoryBlueprintStore();
    const provider = new SequencedBlueprintProvider("blueprint_story_bible", "schema_invalid");

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(store.status).toBe("failed");
    expect(store.failure).toMatchObject({
      code: "MODEL_RESPONSE_INVALID",
      failureClass: "schema",
    });
  });

  it("does not rerun a job already waiting for review", async () => {
    const loaded = loadedJob();
    const store = new InMemoryBlueprintStore({
      ...loaded,
      job: { ...loaded.job, status: "waiting_review" },
      blueprint: { ...loaded.blueprint, status: "waiting_review" },
    });
    const provider = new SequencedBlueprintProvider();

    await new BlueprintJobProcessor(store, provider).process(blueprintPayload());

    expect(provider.operations).toEqual([]);
    expect(store.commits).toEqual([]);
    expect(store.notifications).toEqual([]);
  });

  it("fails validation closed for missing core counts, scale mismatch and missing hooks", () => {
    const cards = { cards: storyBibleCards() };
    const settings = coreSettings().filter((candidate) => candidate.type !== "world_rule");
    const outline = outlineDraft();
    const extraVolumes = [0, 1].flatMap((volumeIndex) => {
      const volumeId = `01900000-0000-7000-8000-${String(310 + volumeIndex).padStart(12, "0")}`;
      return [
        {
          id: volumeId,
          parentId: outline.nodes[0]!.id,
          level: "volume" as const,
          sortOrder: volumeIndex + 1,
          title: `额外卷 ${volumeIndex + 1}`,
          summary: "额外卷大纲",
          status: "planned" as const,
          chapterNumber: null,
          brief: null,
          tension: 35,
        },
        ...Array.from({ length: 3 }, (_, actIndex) => ({
          id: `01900000-0000-7000-8000-${String(320 + volumeIndex * 10 + actIndex).padStart(12, "0")}`,
          parentId: volumeId,
          level: "act" as const,
          sortOrder: actIndex,
          title: `额外卷 ${volumeIndex + 1} 第 ${actIndex + 1} 幕`,
          summary: "额外幕大纲",
          status: "planned" as const,
          chapterNumber: null,
          brief: null,
          tension: 40,
        })),
      ];
    });
    const validation = validateBlueprintCandidates({
      storyBible: cards,
      coreSettings: settings,
      outline: {
        ...outline,
        nodes: [
          ...outline.nodes.map((node) =>
            node.level === "chapter" ? { ...node, hook: null, foreshadow: null } : node,
          ),
          ...extraVolumes,
        ],
      },
      generationGuidance: {
        protagonistArchetypes: [],
        conflictSeeds: [],
        worldRuleSeeds: [],
        forbiddenElements: [],
      },
      genrePackFields: { genre: "仙侠", world: "修真世界" },
      genre: "xianxia",
      scaleTarget: "medium",
    });

    expect(validation.missingFields.some((field) => field.key === "core_setting:world_rule")).toBe(
      true,
    );
    expect(validation.conflicts.map((conflict) => conflict.detail)).toEqual(
      expect.arrayContaining([
        "核心设定至少需要三条世界规则",
        "当前规模需要 36 章，实际为 12 章",
        "每卷必须包含 12 章",
        "前十二个章节点必须包含章末钩子",
      ]),
    );
  });

  it("requires genre-pack fields at exact structured keys instead of matching prose", () => {
    const missing = validateBlueprintCandidates({
      storyBible: {
        cards: storyBibleCards().map((card, index) =>
          index === 0 ? { ...card, content: "正文提到 genre，但没有题材值" } : card,
        ),
      },
      coreSettings: coreSettings()!,
      outline: outlineDraft()!,
      generationGuidance: {
        protagonistArchetypes: [],
        conflictSeeds: [],
        worldRuleSeeds: [],
        forbiddenElements: [],
      },
      genrePackFields: { genre: "仙侠" },
      genre: "xianxia",
      scaleTarget: "short",
    });
    expect(missing.missingFields.map((field) => field.key)).toContain("genre_pack:genre");

    const present = validateBlueprintCandidates({
      storyBible: { cards: storyBibleCards() },
      coreSettings: coreSettings()!.map((setting, index) =>
        index === 0 ? { ...setting, data: { genre: "仙侠" } } : setting,
      ),
      outline: outlineDraft()!,
      generationGuidance: {
        protagonistArchetypes: [],
        conflictSeeds: [],
        worldRuleSeeds: [],
        forbiddenElements: [],
      },
      genrePackFields: { genre: "仙侠" },
      genre: "xianxia",
      scaleTarget: "short",
    });
    expect(present.missingFields.map((field) => field.key)).not.toContain("genre_pack:genre");
  });
});

class SequencedBlueprintProvider implements AiGateway {
  operations: GenerationRequest["operation"][] = [];
  requests: GenerationRequest[] = [];

  constructor(
    private readonly failOperation?: GenerationRequest["operation"],
    private readonly failure: "rate_limit" | "invalid_json" | "schema_invalid" = "rate_limit",
  ) {}

  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    this.operations.push(input.operation);
    this.requests.push(input);
    if (input.operation === this.failOperation && this.failure === "rate_limit") {
      throw new AiProviderError("provider is rate limited", {
        failureClass: "rate_limit",
        retryable: true,
      });
    }
    if (input.operation === this.failOperation && this.failure === "invalid_json") {
      return {
        text: "not-json",
        model: "fake-blueprint",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    }
    if (input.operation === this.failOperation && this.failure === "schema_invalid") {
      return {
        text: "{}",
        model: "fake-blueprint",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 20 },
      };
    }
    const text =
      input.operation === "blueprint_story_bible"
        ? JSON.stringify({ cards: storyBibleCards() })
        : input.operation === "blueprint_core_settings"
          ? JSON.stringify(coreSettings())
          : input.operation === "blueprint_outline"
            ? JSON.stringify(outlineDraft())
            : "{}";
    return {
      text,
      model: "fake-blueprint",
      finishReason: "stop",
      usage: { inputTokens: 100, outputTokens: 200 },
    };
  }

  async *streamText(): AsyncIterable<{ text: string; done: boolean }> {
    yield { text: "", done: true };
  }
}

class InMemoryBlueprintStore extends BlueprintJobStore {
  loaded: LoadedBlueprintJob;
  status = "queued";
  checkpoint: BlueprintCheckpoint = {
    schemaVersion: 1,
    revision: 0,
    step: "prepare",
    inputHash: "a".repeat(64),
    payload: {},
  };
  commits: BlueprintStepCommit[] = [];
  storyBible: Awaited<ReturnType<BlueprintJobProcessor["parseStoryBible"]>> | null = null;
  coreSettings: Awaited<ReturnType<BlueprintJobProcessor["parseCoreSettings"]>> | null = null;
  outline: Awaited<ReturnType<BlueprintJobProcessor["parseOutline"]>> | null = null;
  chapterVersionCount = 0;
  notifications: string[] = [];
  failure: BlueprintFailure | null = null;
  cancelAfterStep: BlueprintStepCommit["step"] | null = null;
  failCommitForStep: BlueprintStepCommit["step"] | null = null;
  private commitFailureConsumed = false;

  constructor(loaded = loadedJob()) {
    super();
    this.loaded = loaded;
    this.checkpoint = loaded.job.checkpoint;
  }

  async withJobLock<T>(_jobId: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async loadJob(): Promise<LoadedBlueprintJob> {
    return this.loaded;
  }

  async begin(): Promise<BlueprintCheckpoint | undefined> {
    this.status = "running";
    return this.checkpoint;
  }

  async isRunnable(): Promise<boolean> {
    return this.status === "running";
  }

  async reserveProviderCall(): Promise<boolean> {
    return this.status === "running";
  }

  async recordProviderResult(
    _payload: GenerateBlueprintJob,
    step: Parameters<BlueprintJobStore["recordProviderResult"]>[1],
    _checkpoint: BlueprintCheckpoint,
    result: GenerationResult,
  ): Promise<void> {
    this.loaded.pendingProviderResult = { step, result };
  }

  async commitStep(commit: BlueprintStepCommit): Promise<BlueprintCheckpoint> {
    if (this.failCommitForStep === commit.step && !this.commitFailureConsumed) {
      this.commitFailureConsumed = true;
      throw new Error("checkpoint transaction failed");
    }
    this.commits.push(commit);
    this.checkpoint = {
      ...this.checkpoint,
      revision: this.checkpoint.revision + 1,
      step: commit.nextStep,
      payload: commit.checkpointPayload,
    };
    if (commit.result.storyBible !== undefined) this.storyBible = commit.result.storyBible;
    if (commit.result.coreSettings !== undefined) this.coreSettings = commit.result.coreSettings;
    if (commit.result.outline !== undefined) this.outline = commit.result.outline;
    if (this.cancelAfterStep === commit.step) this.status = "cancelled";
    return this.checkpoint;
  }

  async completeReady(): Promise<void> {
    this.status = "waiting_review";
    this.notifications.push("ready");
  }

  async waitingModelConfig(): Promise<void> {
    this.status = "waiting_model_config";
    this.notifications.push("waiting_model_config");
  }

  async pauseBudget(): Promise<void> {
    this.status = "budget_paused";
    this.notifications.push("budget_paused");
  }

  async fail(
    _payload: GenerateBlueprintJob,
    _loaded: LoadedBlueprintJob,
    _step: Parameters<BlueprintJobStore["fail"]>[2],
    _checkpoint: BlueprintCheckpoint,
    failure: Parameters<BlueprintJobStore["fail"]>[4],
  ): Promise<void> {
    this.status = "failed";
    this.failure = failure;
    this.notifications.push("failed");
  }
}

function loadedJob(): LoadedBlueprintJob {
  return {
    job: {
      id: "01900000-0000-7000-8000-000000000001",
      status: "queued",
      userId: "01900000-0000-7000-8000-000000000002",
      workId: "01900000-0000-7000-8000-000000000003",
      branchId: "01900000-0000-7000-8000-000000000004",
      modelConfigId: "01900000-0000-7000-8000-000000000005",
      idempotencyKey: "blueprint-test",
      budget: { maxTokens: 600_000, maxCostCny: 10 },
      checkpoint: {
        schemaVersion: 1,
        revision: 0,
        step: "prepare",
        inputHash: "a".repeat(64),
        payload: {},
      },
      cost: zeroCost(),
    },
    blueprint: {
      id: "01900000-0000-7000-8000-000000000006",
      status: "queued",
      progress: 0,
      storyBible: null,
      coreSettings: [],
      outline: null,
    },
    work: {
      title: "忘川书",
      penName: "蓝图作者",
      idea: "一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。",
      genre: "xianxia",
      scaleTarget: "short",
      chapterLengthTarget: 3000,
      templatePackId: "01900000-0000-7000-8000-000000000007",
    },
    genrePack: {
      fields: { genre: "仙侠", world: "修真世界" },
      rules: [{ key: "costly-power", label: "力量有代价" }],
      uiHints: { worldLabel: "修真世界" },
      generationGuidance: {
        protagonistArchetypes: ["被逐出宗门的杂役"],
        conflictSeeds: ["秘境开启与旧案"],
        worldRuleSeeds: ["所有复活与延寿都有代价"],
        forbiddenElements: ["无代价飞升"],
      },
    },
    modelConfig: {
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      encryptedKey: "encrypted",
    },
  };
}

function blueprintPayload(): GenerateBlueprintJob {
  const loaded = loadedJob();
  return {
    jobId: loaded.job.id,
    jobType: "generate_blueprint",
    workId: loaded.job.workId,
    branchId: loaded.job.branchId,
    actorId: loaded.job.userId,
    modelConfigId: loaded.job.modelConfigId,
    idempotencyKey: loaded.job.idempotencyKey,
    budget: loaded.job.budget,
    checkpoint: loaded.job.checkpoint,
  };
}

function storyBibleCards() {
  return STORY_BIBLE_CARD_KEYS.map((key) => ({
    key,
    title: STORY_BIBLE_CARD_TITLES[key],
    content: `${key} 内容`,
    complete: true,
    worldRules:
      key === "worldLaws"
        ? [1, 2, 3].map((index) => ({
            id: `01900000-0000-7000-8000-${String(100 + index).padStart(12, "0")}`,
            name: `世界规则 ${index}`,
            constraint: `规则 ${index} 必须成立。`,
            scope: "全书",
            exceptions: [],
          }))
        : [],
  }));
}

function coreSettings(): BlueprintStepResult["coreSettings"] {
  return (
    [
      "world_rule",
      "world_rule",
      "world_rule",
      "character",
      "faction",
      "map",
      "power_system",
      "golden_finger",
      "item",
      "timeline_event",
    ] as const
  ).map((type, index) => ({
    candidateId: `01900000-0000-7000-8000-${String(200 + index).padStart(12, "0")}`,
    type,
    name: `蓝图设定 ${index + 1}`,
    aliases: [],
    summary: `蓝图设定 ${index + 1} 摘要`,
    description: `蓝图设定 ${index + 1} 描述`,
    tags: [],
    data: {},
    required: true,
    source: "blueprint" as const,
  }));
}

function outlineDraft(): BlueprintStepResult["outline"] {
  const bookId = "01900000-0000-7000-8000-000000000030";
  const volumeId = "01900000-0000-7000-8000-000000000031";
  const acts = [0, 1, 2].map((index) => ({
    id: `01900000-0000-7000-8000-${String(40 + index).padStart(12, "0")}`,
    parentId: volumeId,
    level: "act" as const,
    sortOrder: index,
    title: `第 ${index + 1} 幕`,
    summary: `第 ${index + 1} 幕大纲`,
    status: "planned" as const,
    chapterNumber: null,
    brief: null,
    tension: 40,
  }));
  const chapters = Array.from({ length: 12 }, (_, index) => {
    const id = `01900000-0000-7000-8000-${String(100 + index).padStart(12, "0")}`;
    return {
      id,
      parentId: acts[index % acts.length]!.id,
      level: "chapter" as const,
      sortOrder: index,
      title: `第 ${index + 1} 章`,
      summary: `第 ${index + 1} 章大纲`,
      status: "planned" as const,
      chapterNumber: index + 1,
      brief: {
        goal: `完成第 ${index + 1} 章目标`,
        pov: "沈砚",
        location: "山门",
        sceneBeats: ["主角作出选择。"],
        requiredFacts: ["山门存在"],
      },
      hook: `第 ${index + 1} 章章末钩子`,
      foreshadow: index === 0 ? "全书伏笔" : null,
      tension: 50,
    };
  });
  const scenes = chapters.flatMap((chapter, chapterIndex) =>
    [0, 1].map((sceneIndex) => ({
      id: `01900000-0000-7000-8001-${String(chapterIndex * 2 + sceneIndex).padStart(12, "0")}`,
      parentId: chapter.id,
      level: "scene" as const,
      sortOrder: sceneIndex,
      title: `第 ${chapterIndex + 1} 章场景 ${sceneIndex + 1}`,
      summary: "场景大纲",
      status: "planned" as const,
      chapterNumber: null,
      brief: null,
      tension: 55,
    })),
  );
  return {
    nodes: [
      {
        id: bookId,
        parentId: null,
        level: "book" as const,
        sortOrder: 0,
        title: "全书",
        summary: "全书大纲",
        status: "planned" as const,
        chapterNumber: null,
        brief: null,
        tension: null,
      },
      {
        id: volumeId,
        parentId: bookId,
        level: "volume" as const,
        sortOrder: 0,
        title: "第一卷",
        summary: "第一卷大纲",
        status: "planned" as const,
        chapterNumber: null,
        brief: null,
        tension: 35,
      },
      ...acts,
      ...chapters,
      ...scenes,
    ],
    volumeContracts: [
      {
        nodeId: volumeId,
        objective: "主角进入修炼世界。",
        conflict: "宗门排斥主角。",
        turningPoints: ["发现古书"],
        exitConditions: ["进入外门"],
        plotLines: [],
      },
    ],
    sceneCards: scenes.map((scene) => ({
      nodeId: scene.id,
      title: scene.title,
      povLabel: "沈砚",
      locationLabel: "山门",
      storyTime: "入宗初期",
      beats: ["场景开始", "场景转折"],
      informationReleases: ["主角获得线索"],
      tension: 55,
    })),
  };
}

function zeroCost(): BlueprintCost {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 };
}
