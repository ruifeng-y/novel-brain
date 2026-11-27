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

import {
  BlueprintJobProcessor,
  BlueprintJobStore,
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
  });
});

class SequencedBlueprintProvider implements AiGateway {
  operations: GenerationRequest["operation"][] = [];

  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    this.operations.push(input.operation);
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

  async withJobLock<T>(_jobId: string, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async loadJob(): Promise<LoadedBlueprintJob> {
    return loadedJob();
  }

  async begin(): Promise<BlueprintCheckpoint> {
    this.status = "running";
    return this.checkpoint;
  }

  async commitStep(commit: BlueprintStepCommit): Promise<BlueprintCheckpoint> {
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
    return this.checkpoint;
  }

  async completeReady(): Promise<void> {
    this.status = "waiting_review";
  }

  async waitingModelConfig(): Promise<void> {
    this.status = "waiting_model_config";
  }

  async pauseBudget(): Promise<void> {
    this.status = "budget_paused";
  }

  async fail(): Promise<void> {
    this.status = "failed";
  }
}

function loadedJob(): LoadedBlueprintJob {
  return {
    job: {
      id: "01900000-0000-7000-8000-000000000001",
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
