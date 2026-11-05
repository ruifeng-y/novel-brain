import { describe, expect, it } from "vitest";

import {
  compileChapterContext,
  compileContextPack,
  ContextBudgetExceededError,
  createRequestId,
  elapsedMilliseconds,
  extractFactCandidates,
  resolveProxyIpSecret,
  signClientIp,
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
