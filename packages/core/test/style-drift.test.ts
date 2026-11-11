import { describe, expect, it } from "vitest";

import { evaluateStyleDrift } from "../src";

const baseline = {
  id: "0199c2e0-0000-7000-8000-000000000001",
  version: 2,
  scope: "character" as const,
  scopeId: "0199c2e0-0000-7000-8000-000000000002",
  dimension: "character_voice" as const,
  guides: ["句子短，少用感叹。"],
  samples: [
    {
      chapterId: "0199c2e0-0000-7000-8000-000000000010",
      chapterVersionId: "0199c2e0-0000-7000-8000-000000000011",
      excerpt: "风停了。\n他没有回头。\n“走吧。”沈砚说。",
      locator: "第 1 章 · 第 1 段",
    },
  ],
};

const chapters = [
  {
    id: "0199c2e0-0000-7000-8000-000000000020",
    versionId: "0199c2e0-0000-7000-8000-000000000021",
    number: 2,
    title: "风停之后",
    content: "风停了。\n他没有回头。\n“走吧。”沈砚说。",
  },
  {
    id: "0199c2e0-0000-7000-8000-000000000030",
    versionId: "0199c2e0-0000-7000-8000-000000000031",
    number: 3,
    title: "天裂",
    content: "不可能！！！这绝不可能！！！\n他看见天裂开了！！！血液像火一样燃烧！！！",
  },
  {
    id: "0199c2e0-0000-7000-8000-000000000040",
    versionId: "0199c2e0-0000-7000-8000-000000000041",
    number: 4,
    title: "火起",
    content: "他终于喊了出来！！！这声音烧穿了长夜！！！\n他不再压住胸口的火！！！",
  },
];

describe("style drift evaluation", () => {
  it("flags a real voice deviation with passage evidence and does not rewrite text", () => {
    const result = evaluateStyleDrift({
      scope: "chapter",
      chapters: [chapters[1]!],
      baseline,
      growthMarkers: [],
      model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
      prompt: { key: "style-drift-review", version: 1 },
    });

    expect(result.classification).toBe("drift");
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "CHARACTER_VOICE_DRIFT",
        classification: "drift",
        chapterId: chapters[1]!.id,
        chapterVersionId: chapters[1]!.versionId,
        locator: "第 3 章 · 第 1 段",
        recommendation: expect.stringContaining("是否需要保留为有意变化"),
      }),
    ]);
    expect(result.findings[0]?.quote).toContain("不可能");
    expect(result.findings[0]?.endOffset).toBeGreaterThan(result.findings[0]?.startOffset ?? 0);
    expect(result.model).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      parameters: {},
    });
    expect(result.prompt).toEqual({ key: "style-drift-review", version: 1 });
    expect(result.baselineVersion).toBe(2);
  });

  it("separates an evidenced character growth moment from an accidental drift", () => {
    const result = evaluateStyleDrift({
      scope: "cross_volume",
      chapters,
      baseline,
      growthMarkers: [
        {
          id: "0199c2e0-0000-7000-8000-000000000050",
          characterId: baseline.scopeId,
          fromChapter: 4,
          toChapter: 5,
          startState: "克制，压住情绪",
          endState: "不再克制，情绪转为热烈",
          reason: "沈砚第一次主动释放忘川书的力量。",
        },
      ],
      model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
      prompt: { key: "style-drift-review", version: 1 },
    });

    expect(result.findings.map((finding) => finding.chapterId)).toEqual([
      chapters[1]!.id,
      chapters[2]!.id,
    ]);
    expect(result.findings.map((finding) => finding.classification)).toEqual([
      "drift",
      "intentional_development",
    ]);
    expect(result.findings[1]).toMatchObject({
      code: "INTENTIONAL_CHARACTER_DEVELOPMENT",
      growthEvidence: {
        markerId: "0199c2e0-0000-7000-8000-000000000050",
        startState: "克制，压住情绪",
        endState: "不再克制，情绪转为热烈",
      },
    });
    expect(result.trend).toHaveLength(chapters.length);
  });
});
