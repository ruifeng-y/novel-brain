import { describe, expect, it } from "vitest";

import {
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  blueprintBudgetUpdateRequestSchema,
  blueprintConfirmRequestSchema,
  blueprintStoryBibleDraftSchema,
  generateBlueprintJobSchema,
  workBlueprintSchema,
} from "../src";

describe("blueprint contracts", () => {
  it("requires an explicit author confirmation flag", () => {
    expect(() =>
      blueprintConfirmRequestSchema.parse({
        expectedVersion: 3,
        draftHash: "a".repeat(64),
        acknowledgements: [],
      }),
    ).toThrow();

    expect(
      blueprintConfirmRequestSchema.parse({
        expectedVersion: 3,
        draftHash: "a".repeat(64),
        acknowledgements: [],
        confirmed: true,
      }).confirmed,
    ).toBe(true);
  });

  it("requires complete confirmation metadata", () => {
    expect(
      workBlueprintSchema.safeParse(makeBlueprint({ confirmedAt: null, confirmedBy: null }))
        .success,
    ).toBe(false);
    expect(workBlueprintSchema.safeParse(makeBlueprint()).success).toBe(true);
  });

  it("rejects confirmed blueprints without required settings and outline levels", () => {
    expect(workBlueprintSchema.safeParse(makeBlueprint({ coreSettingsDraft: [] })).success).toBe(
      false,
    );
    expect(
      workBlueprintSchema.safeParse(
        makeBlueprint({
          outlineDraft: {
            nodes: [makeOutlineDraft().nodes[0]],
            volumeContracts: [],
            sceneCards: [],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("blocks unresolved P0 conflicts in a confirmed blueprint", () => {
    const result = workBlueprintSchema.safeParse(
      makeBlueprint({
        conflicts: [
          {
            id: "01900000-0000-7000-8000-000000000020",
            severity: "P0",
            title: "主角认知冲突",
            detail: "角色知道了尚未发生的事实。",
            affectedKeys: ["protagonist"],
            status: "open",
          },
        ],
      }),
    );

    expect(result.success).toBe(false);
  });

  it("requires acknowledgements for required missing fields", () => {
    const missingFields = [
      {
        key: "character:golden_finger",
        label: "金手指",
        required: true,
        severity: "P0" as const,
        message: "当前设定没有金手指。",
      },
    ];
    expect(workBlueprintSchema.safeParse(makeBlueprint({ missingFields })).success).toBe(false);
    expect(
      workBlueprintSchema.safeParse(
        makeBlueprint({
          missingFields,
          acknowledgements: [
            {
              fieldKey: "character:golden_finger",
              decision: "not_applicable",
              reason: "都市现实题材不使用金手指。",
            },
          ],
        }),
      ).success,
    ).toBe(true);
  });

  it("requires every blueprint job to carry budget and checkpoint state", () => {
    const result = generateBlueprintJobSchema.safeParse({
      jobId: "01900000-0000-7000-8000-000000000001",
      jobType: "generate_blueprint",
      workId: "01900000-0000-7000-8000-000000000002",
      branchId: "01900000-0000-7000-8000-000000000003",
      actorId: "01900000-0000-7000-8000-000000000004",
      modelConfigId: "01900000-0000-7000-8000-000000000005",
      idempotencyKey: "idea-blueprint",
    });

    expect(result.success).toBe(false);
  });

  it("allows a blueprint job to wait until a model config exists", () => {
    const result = generateBlueprintJobSchema.safeParse({
      jobId: "01900000-0000-7000-8000-000000000001",
      jobType: "generate_blueprint",
      workId: "01900000-0000-7000-8000-000000000002",
      branchId: "01900000-0000-7000-8000-000000000003",
      actorId: "01900000-0000-7000-8000-000000000004",
      modelConfigId: null,
      idempotencyKey: "idea-blueprint",
      budget: { maxTokens: 20000, maxCostCny: 0.1 },
      checkpoint: { step: "prepare" },
    });

    expect(result.success).toBe(true);
  });

  it("enforces the documented budget bounds and flat update request", () => {
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        maxTokens: 20000,
        maxCostCny: 0.1,
      }).success,
    ).toBe(true);
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        maxTokens: 20000,
        maxCostCny: 0.099,
      }).success,
    ).toBe(false);
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        budget: { maxTokens: 20000, maxCostCny: 0.1 },
      }).success,
    ).toBe(false);
    expect(
      blueprintBudgetUpdateRequestSchema.safeParse({
        expectedVersion: 1,
        maxTokens: 600001,
        maxCostCny: 0.1,
      }).success,
    ).toBe(false);
  });

  it("wraps nine story-bible cards and enforces three unique world laws", () => {
    const cards = makeCards();

    expect(blueprintStoryBibleDraftSchema.safeParse({ cards }).success).toBe(true);
    expect(blueprintStoryBibleDraftSchema.safeParse(cards).success).toBe(false);

    const oneRule = makeCards(1);
    expect(blueprintStoryBibleDraftSchema.safeParse({ cards: oneRule }).success).toBe(false);

    const duplicateRules = makeCards(3).map((card) =>
      card.key === "worldLaws"
        ? {
            ...card,
            worldRules: card.worldRules.map((rule) => ({ ...rule, name: "重复规则" })),
          }
        : card,
    );
    expect(blueprintStoryBibleDraftSchema.safeParse({ cards: duplicateRules }).success).toBe(false);
  });
});

function makeCards(worldRuleCount = 3) {
  return STORY_BIBLE_CARD_KEYS.map((key) => ({
    key,
    title: STORY_BIBLE_CARD_TITLES[key],
    content: `${key} 内容`,
    complete: true,
    worldRules:
      key === "worldLaws"
        ? Array.from({ length: worldRuleCount }, (_, ruleIndex) => ({
            id: `01900000-0000-7000-8000-${String(10 + ruleIndex).padStart(12, "0")}`,
            name: `世界规则 ${ruleIndex + 1}`,
            constraint: `第 ${ruleIndex + 1} 条约束必须成立。`,
            scope: "全书",
            exceptions: [],
          }))
        : [],
  }));
}

function makeBlueprint(overrides: Record<string, unknown> = {}) {
  return {
    id: "01900000-0000-7000-8000-000000000001",
    workId: "01900000-0000-7000-8000-000000000002",
    branchId: "01900000-0000-7000-8000-000000000003",
    status: "confirmed",
    version: 1,
    progress: 100,
    currentStep: "await_review",
    estimate: {
      ruleVersion: "blueprint-estimate-v1",
      planned: { volumes: 1, chapters: 12, scenes: 24 },
      estimatedTokens: 40000,
      estimatedCostCny: 0.08,
      defaultBudget: { maxTokens: 48000, maxCostCny: 0.5 },
      assumptions: ["测试估算"],
    },
    cost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 },
    draftHash: "a".repeat(64),
    storyBibleDraft: { cards: makeCards() },
    coreSettingsDraft: makeCoreSettings(),
    outlineDraft: makeOutlineDraft(),
    missingFields: [],
    conflicts: [],
    acknowledgements: [],
    allowedActions: [],
    confirmedAt: "2026-11-27T00:00:00.000Z",
    confirmedBy: "01900000-0000-7000-8000-000000000004",
    createdAt: "2026-11-27T00:00:00.000Z",
    updatedAt: "2026-11-27T00:00:00.000Z",
    ...overrides,
  };
}

function makeCoreSettings() {
  return (
    ["world_rule", "character", "faction", "map", "power_system", "item", "timeline_event"] as const
  ).map((type, index) => ({
    candidateId: `01900000-0000-7000-8000-${String(100 + index).padStart(12, "0")}`,
    type,
    name: `核心设定 ${index + 1}`,
    aliases: [],
    summary: `核心设定 ${index + 1} 摘要`,
    description: `核心设定 ${index + 1} 描述`,
    tags: [],
    data: {},
    required: true,
    source: "blueprint",
  }));
}

function makeOutlineDraft() {
  const bookId = "01900000-0000-7000-8000-000000000030";
  const volumeId = "01900000-0000-7000-8000-000000000031";
  const actId = "01900000-0000-7000-8000-000000000032";
  const chapterId = "01900000-0000-7000-8000-000000000033";
  const sceneId = "01900000-0000-7000-8000-000000000034";
  return {
    nodes: [
      {
        id: bookId,
        parentId: null,
        level: "book",
        sortOrder: 0,
        title: "全书",
        summary: "全书大纲",
        status: "planned",
        chapterNumber: null,
        brief: null,
        tension: null,
      },
      {
        id: volumeId,
        parentId: bookId,
        level: "volume",
        sortOrder: 0,
        title: "第一卷",
        summary: "第一卷大纲",
        status: "planned",
        chapterNumber: null,
        brief: null,
        tension: 30,
      },
      {
        id: actId,
        parentId: volumeId,
        level: "act",
        sortOrder: 0,
        title: "第一幕",
        summary: "第一幕大纲",
        status: "planned",
        chapterNumber: null,
        brief: null,
        tension: 40,
      },
      {
        id: chapterId,
        parentId: actId,
        level: "chapter",
        sortOrder: 0,
        title: "第一章",
        summary: "第一章大纲",
        status: "planned",
        chapterNumber: 1,
        brief: {
          goal: "主角发现古书。",
          pov: "沈砚",
          location: "山门",
          sceneBeats: ["主角捡到古书。"],
          requiredFacts: ["古书存在"],
        },
        tension: 50,
      },
      {
        id: sceneId,
        parentId: chapterId,
        level: "scene",
        sortOrder: 0,
        title: "山门夜雨",
        summary: "主角在雨夜捡到古书。",
        status: "planned",
        chapterNumber: null,
        brief: null,
        tension: 55,
      },
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
    sceneCards: [
      {
        nodeId: sceneId,
        title: "山门夜雨",
        povLabel: "沈砚",
        locationLabel: "山门",
        storyTime: "入宗第一夜",
        beats: ["主角躲雨", "古书发光"],
        informationReleases: ["古书会吞噬记忆"],
        tension: 55,
      },
    ],
  };
}
