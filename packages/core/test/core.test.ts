import { describe, expect, it } from "vitest";

import {
  compileChapterContext,
  compileContextPack,
  ContextBudgetExceededError,
  createRequestId,
  elapsedMilliseconds,
  extractFactCandidates,
  findControlAreaConflicts,
  findShortestMapRoute,
  findTimelineOrderConflicts,
  projectActiveRelationshipsAtChapter,
  projectCharacterKnowledgeAtChapter,
  projectCharacterStateAtChapter,
  resolveProxyIpSecret,
  sortTimelineEvents,
  signClientIp,
  validateItinerarySchedule,
  verifyClientIp,
} from "../src";

describe("core request helpers", () => {
  it("creates protocol-compatible request identifiers", () => {
    expect(createRequestId(() => "fixed-id")).toBe("req_fixed-id");
  });

  it("reports non-negative elapsed milliseconds", () => {
    expect(elapsedMilliseconds(process.hrtime.bigint())).toBeGreaterThanOrEqual(0);
  });

  it("signs and verifies client IP values", () => {
    const signed = signClientIp("203.0.113.8", "secret");
    expect(verifyClientIp(signed, "secret")).toBe("203.0.113.8");
    expect(verifyClientIp(`${signed}x`, "secret")).toBeNull();
    expect(verifyClientIp(signed, "wrong-secret")).toBeNull();
  });

  it("fails closed for a default proxy IP secret", () => {
    expect(resolveProxyIpSecret("production-secret", undefined)).toBe("production-secret");
    expect(() => resolveProxyIpSecret(undefined, undefined)).toThrow();
    expect(() => resolveProxyIpSecret("change-me-in-production", undefined)).toThrow();
    expect(resolveProxyIpSecret("local-development-proxy-ip-secret", "true")).toBe(
      "local-development-proxy-ip-secret",
    );
  });
});

describe("context compiler", () => {
  it("keeps required sources, evicts optional sources and records citations", () => {
    const requiredRef = {
      sourceType: "chapter_brief" as const,
      sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
      label: "章纲",
      citation: "第 1 章 · 必用事实",
    };
    const settingRef = {
      sourceType: "setting" as const,
      sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
      label: "沈砚",
      citation: "已确认设定 · 沈砚",
    };

    const pack = compileContextPack({
      tokenBudget: 8,
      compilerVersion: "m0-context-v1",
      sources: [
        {
          key: "brief:required",
          label: "必用事实",
          priority: "required",
          content: "断臂",
          sourceRefs: [requiredRef],
        },
        {
          key: "setting:character",
          label: "沈砚",
          priority: "high",
          content: "左臂骨折，不能双手结印。",
          sourceRefs: [settingRef],
        },
        {
          key: "recent:chapter-0",
          label: "上一章",
          priority: "normal",
          content: "追兵已经逼近荒寺。",
          sourceRefs: [
            {
              sourceType: "chapter_version",
              sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
              label: "上一章",
              citation: "上一章版本",
            },
          ],
        },
      ],
    });

    expect(pack.selected.map((source) => source.key)).toEqual([
      "brief:required",
      "setting:character",
    ]);
    expect(pack.tokenUsed).toBe(7);
    expect(pack.evicted).toEqual([
      {
        key: "recent:chapter-0",
        label: "上一章",
        reason: "token_budget",
        tokenCount: 5,
      },
    ]);
    expect(pack.sourceRefs).toEqual([requiredRef, settingRef]);
  });

  it("treats the locked story bible as required and stops when it cannot fit", () => {
    expect(() =>
      compileChapterContext(
        {
          chapter: {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
            number: 1,
            title: "第一章",
            brief: {
              goal: "写",
              pov: "甲",
              location: "山",
              sceneBeats: ["战"],
              requiredFacts: ["断臂"],
            },
          },
          storyBible: {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
            cards: [
              {
                title: "世界铁律",
                content: "这是一段不能淘汰的故事圣经硬约束内容，必须完整进入上下文。",
              },
            ],
          },
          settings: [],
          previousVersions: [],
        },
        10,
      ),
    ).toThrow(ContextBudgetExceededError);
  });

  it("includes the style sample and only scene-relevant confirmed settings", () => {
    const pack = compileChapterContext(
      {
        chapter: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
          number: 4,
          title: "雨夜",
          brief: {
            goal: "沈砚在荒寺外迎敌",
            pov: "沈砚",
            location: "荒寺外",
            sceneBeats: ["沈砚藏起断臂。"],
            requiredFacts: ["左臂骨折"],
          },
        },
        storyBible: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
          cards: [{ title: "一句话故事", content: "杂役以记忆换仙途。" }],
        },
        styleSample: "句子短促，白描为主，避免华丽比喻。",
        settings: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13",
            type: "character",
            name: "沈砚",
            aliases: ["小砚"],
            summary: "外门杂役",
            attributes: { bodyState: "左臂骨折" },
          },
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
            type: "faction",
            name: "无关宗门",
            aliases: [],
            summary: "与本章无关",
            attributes: {},
          },
        ],
        previousVersions: [],
      },
      200,
    );

    expect(pack.selected.map((source) => source.key)).toEqual(
      expect.arrayContaining(["style:sample", "setting:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13"]),
    );
    expect(pack.selected.map((source) => source.key)).not.toContain(
      "setting:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14",
    );
  });

  it("compiles structured world rules as a separately cited required source", () => {
    const pack = compileChapterContext(
      {
        chapter: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c19",
          number: 6,
          title: "断碑",
          brief: {
            goal: "沈砚在断碑前越阶迎敌",
            pov: "沈砚",
            location: "断碑前",
            sceneBeats: ["沈砚付出寿元代价。"],
            requiredFacts: ["越阶必须付出代价"],
          },
        },
        storyBible: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c20",
          cards: [{ title: "世界铁律", content: "越阶必须付出代价。" }],
          worldRules: [
            {
              id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c21",
              name: "境界差距",
              constraint: "越阶必须付出寿元、资源或关系代价。",
              scope: "所有战斗与冲突",
              exceptions: [],
            },
          ],
        },
        settings: [],
        previousVersions: [],
      },
      200,
    );

    const worldRuleSource = pack.selected.find(
      (source) => source.key === "story-bible:world-rules",
    );
    expect(worldRuleSource).toMatchObject({
      label: "世界铁律",
      priority: "required",
      content: expect.stringContaining("境界差距：越阶必须付出寿元、资源或关系代价。"),
    });
    expect(worldRuleSource?.sourceRefs).toEqual([
      {
        sourceType: "story_bible",
        sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c20",
        label: "故事圣经",
        citation: "已锁定故事圣经",
      },
    ]);
  });

  it("excludes confirmed facts outside their chapter validity window", () => {
    const pack = compileChapterContext(
      {
        chapter: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
          number: 4,
          title: "雨夜",
          brief: {
            goal: "沈砚在荒寺外迎敌",
            pov: "沈砚",
            location: "荒寺外",
            sceneBeats: ["沈砚藏起断臂。"],
            requiredFacts: ["左臂骨折"],
          },
        },
        storyBible: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
          cards: [{ title: "一句话故事", content: "杂役以记忆换仙途。" }],
        },
        settings: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c17",
            type: "fact",
            name: "沈砚",
            summary: "身体状态：未来才恢复",
            attributes: {},
            sourceChapterNumber: 1,
            validFromChapter: 5,
            validToChapter: null,
          },
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c18",
            type: "fact",
            name: "沈砚",
            summary: "身体状态：早已痊愈",
            attributes: {},
            sourceChapterNumber: 1,
            validFromChapter: 1,
            validToChapter: 3,
          },
        ],
        previousVersions: [],
      },
      200,
    );

    expect(pack.selected.map((source) => source.key)).not.toContain(
      "setting:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c17",
    );
    expect(pack.selected.map((source) => source.key)).not.toContain(
      "setting:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c18",
    );
  });

  it("keeps submitted fact and source-chapter provenance in context citations", () => {
    const pack = compileChapterContext(
      {
        chapter: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11",
          number: 5,
          title: "追问",
          brief: {
            goal: "沈砚确认身体状态",
            pov: "沈砚",
            location: "山门",
            sceneBeats: ["沈砚抬起左臂。"],
            requiredFacts: ["左臂骨折"],
          },
        },
        storyBible: {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c12",
          cards: [{ title: "一句话故事", content: "杂役以记忆换仙途。" }],
        },
        settings: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
            type: "fact",
            name: "沈砚",
            summary: "身体状态：左臂骨折",
            attributes: {
              sourceChapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c16",
            },
            sourceChapterNumber: 3,
            validFromChapter: 3,
            validToChapter: null,
          },
        ],
        previousVersions: [],
      },
      200,
    );

    expect(pack.selected.find((source) => source.key.startsWith("setting:"))?.sourceRefs).toEqual([
      {
        sourceType: "setting",
        sourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c15",
        label: "沈砚",
        citation: "第 3 章事实 · 沈砚 · 身体状态：左臂骨折",
      },
    ]);
  });
});

describe("fact extraction", () => {
  it("keeps exact source sentences and assigns risk by fact type", () => {
    const content = [
      "血从袖口滴下来，落在荒寺外的青石板上。",
      "沈砚把断臂藏进衣袍，只用右手结印。",
      "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
    ].join("\n\n");

    const candidates = extractFactCandidates(content);

    expect(candidates).toEqual(
      expect.arrayContaining([
        {
          subject: "沈砚",
          predicate: "身体状态",
          object: "沈砚把断臂藏进衣袍，只用右手结印",
          sourceSentence: "沈砚把断臂藏进衣袍，只用右手结印。",
          risk: "high",
          confidence: 0.95,
          required: true,
        },
        {
          subject: "顾青",
          predicate: "角色认知",
          object: "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧",
          sourceSentence: "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
          risk: "medium",
          confidence: 0.82,
          required: true,
        },
      ]),
    );
  });
});

describe("character domain projections", () => {
  const hiddenFact = {
    id: "fact-parents-murdered",
    subject: "沈砚父母",
    predicate: "死因",
    object: "被仇家杀死",
    validFromChapter: 1,
    validToChapter: null,
  };
  const publicFact = {
    id: "fact-sect-expelled",
    subject: "沈砚",
    predicate: "身份",
    object: "被太玄门逐出",
    validFromChapter: 3,
    validToChapter: null,
  };

  it("does not disclose objective facts without an active knowledge state", () => {
    const projection = projectCharacterKnowledgeAtChapter(
      [hiddenFact, publicFact],
      [
        {
          objectiveFactId: publicFact.id,
          state: "knowledge",
          claimedContent: "沈砚知道自己被逐出宗门。",
          validFromChapter: 3,
          validToChapter: null,
        },
      ],
      5,
    );

    expect(projection.knownFacts.map((fact) => fact.id)).toEqual([publicFact.id]);
    expect(projection.hiddenFactIds).toEqual([hiddenFact.id]);
  });

  it("keeps a misbelief from overwriting objective canon", () => {
    const factsBefore = structuredClone([hiddenFact]);
    const projection = projectCharacterKnowledgeAtChapter(
      [hiddenFact],
      [
        {
          objectiveFactId: hiddenFact.id,
          state: "misbelief",
          claimedContent: "沈砚相信父母是自尽。",
          validFromChapter: 2,
          validToChapter: null,
        },
      ],
      6,
    );

    expect(projection.knownFacts).toEqual([]);
    expect(projection.beliefs).toEqual([
      {
        objectiveFactId: hiddenFact.id,
        state: "misbelief",
        claimedContent: "沈砚相信父母是自尽。",
      },
    ]);
    expect([hiddenFact]).toEqual(factsBefore);
  });

  it("replays body, location and ability transitions at a chapter boundary", () => {
    const states = [
      {
        stateKind: "body" as const,
        stateKey: "overall",
        value: "左臂骨折",
        validFromChapter: 1,
        validToChapter: 9,
      },
      {
        stateKind: "body" as const,
        stateKey: "overall",
        value: "伤势痊愈",
        validFromChapter: 10,
        validToChapter: null,
      },
      {
        stateKind: "ability" as const,
        stateKey: "seal",
        value: "不能双手结印",
        validFromChapter: 1,
        validToChapter: 9,
      },
    ];

    expect(projectCharacterStateAtChapter(states, 9)).toMatchObject({
      "body:overall": { value: "左臂骨折" },
      "ability:seal": { value: "不能双手结印" },
    });
    expect(projectCharacterStateAtChapter(states, 10)).toMatchObject({
      "body:overall": { value: "伤势痊愈" },
    });
  });

  it("returns only relationships valid at the requested chapter", () => {
    const relationships = [
      {
        id: "rel-ally",
        relationType: "ally" as const,
        validFromChapter: 1,
        validToChapter: 11,
      },
      {
        id: "rel-enemy",
        relationType: "enemy" as const,
        validFromChapter: 12,
        validToChapter: null,
      },
    ];

    expect(projectActiveRelationshipsAtChapter(relationships, 11).map((edge) => edge.id)).toEqual([
      "rel-ally",
    ]);
    expect(projectActiveRelationshipsAtChapter(relationships, 12)).toEqual([relationships[1]]);
  });
});

describe("world simulation rules", () => {
  const nodes = [
    { id: "village", mapId: "north" },
    { id: "pass", mapId: "north" },
    { id: "gate", mapId: "north" },
    { id: "sect", mapId: "north" },
    { id: "isolated", mapId: "north" },
  ];

  it("finds the shortest cross-layer route and respects directed edges", () => {
    const edges = [
      {
        id: "village-pass",
        mapId: "north",
        fromNodeId: "village",
        toNodeId: "pass",
        bidirectional: true,
        travelMinutes: 30,
      },
      {
        id: "pass-gate",
        mapId: "north",
        fromNodeId: "pass",
        toNodeId: "gate",
        bidirectional: true,
        travelMinutes: 45,
      },
      {
        id: "village-sect",
        mapId: "north",
        fromNodeId: "village",
        toNodeId: "sect",
        bidirectional: false,
        travelMinutes: 60,
      },
      {
        id: "sect-gate",
        mapId: "north",
        fromNodeId: "sect",
        toNodeId: "gate",
        bidirectional: false,
        travelMinutes: 20,
      },
    ];

    expect(findShortestMapRoute(nodes, edges, "village", "gate")).toMatchObject({
      pathNodeIds: ["village", "pass", "gate"],
      travelMinutes: 75,
    });
    expect(findShortestMapRoute(nodes, edges, "village", "isolated")).toBeNull();
  });

  it("reports itinerary order, travel-time and overlap conflicts", () => {
    const existing = [
      {
        id: "trip-1",
        characterId: "shen",
        departureSortKey: 1000,
        arrivalSortKey: 1200,
      },
    ];
    expect(
      validateItinerarySchedule(
        {
          characterId: "shen",
          departureSortKey: 1000,
          arrivalSortKey: 1100,
          travelMinutes: 240,
        },
        existing,
      ).map((finding) => finding.code),
    ).toEqual(["ITINERARY_TRAVEL_TIME", "ITINERARY_OVERLAP"]);
    expect(
      validateItinerarySchedule(
        {
          characterId: "shen",
          departureSortKey: 1200,
          arrivalSortKey: 1200,
          travelMinutes: 0,
        },
        existing,
      ).map((finding) => finding.code),
    ).toContain("ITINERARY_TIME_ORDER");
  });

  it("detects overlapping control areas for different factions", () => {
    const conflicts = findControlAreaConflicts([
      {
        id: "control-sect",
        factionId: "tai-xuan",
        nodeId: "village",
        validFromChapter: 1,
        validToChapter: 9,
      },
      {
        id: "control-blood",
        factionId: "blood-river",
        nodeId: "village",
        validFromChapter: 5,
        validToChapter: null,
      },
      {
        id: "control-later",
        factionId: "blood-river",
        nodeId: "village",
        validFromChapter: 10,
        validToChapter: null,
      },
    ]);

    expect(conflicts).toEqual([
      {
        code: "CONTROL_AREA_OVERLAP",
        leftId: "control-sect",
        rightId: "control-blood",
        nodeId: "village",
      },
    ]);
  });

  it("orders timeline events by era and story time while detecting duplicate slots", () => {
    const eras = [
      { id: "era-2", name: "新历", orderIndex: 2 },
      { id: "era-1", name: "大玄历", orderIndex: 1 },
    ];
    const events = [
      { id: "later", era: "新历", sortKey: 10 },
      { id: "first", era: "大玄历", sortKey: 20 },
      { id: "second", era: "大玄历", sortKey: 30 },
    ];

    expect(sortTimelineEvents(eras, events).map((event) => event.id)).toEqual([
      "first",
      "second",
      "later",
    ]);
    expect(
      findTimelineOrderConflicts(events.concat({ id: "duplicate", era: "大玄历", sortKey: 20 })),
    ).toEqual([
      {
        code: "TIMELINE_EVENT_OVERLAP",
        era: "大玄历",
        sortKey: 20,
        eventIds: ["first", "duplicate"],
      },
    ]);
  });
});
