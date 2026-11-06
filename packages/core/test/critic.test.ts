import { describe, expect, it } from "vitest";

import { CRITIC_RULE_VERSION, evaluateCritic, type CriticEvaluationInput } from "../src";

const chapterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c01";
const chapterVersionId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c02";
const factId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c03";
const knowledgeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c04";
const characterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c05";
const timelineId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c06";
const locationId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c07";
const outlineId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c08";
const voiceId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c09";

function input(
  content: string,
  overrides: Partial<CriticEvaluationInput> = {},
): CriticEvaluationInput {
  return {
    chapter: {
      id: chapterId,
      versionId: chapterVersionId,
      number: 5,
      title: "一只手也能结印",
      content,
      povCharacterId: characterId,
      povCharacterName: "沈砚",
      goal: "找到新的战斗方式，护住顾青。",
      location: "荒寺外山道",
      requiredBeats: ["沈砚藏起断臂。"],
      requiredFacts: ["左臂骨折，不能双手结印"],
      outlineNodeId: outlineId,
    },
    facts: [
      {
        id: factId,
        subject: "沈砚",
        predicate: "身体状态",
        object: "左臂骨折，不能双手结印",
        sourceChapterNumber: 3,
        validFromChapter: 3,
        validToChapter: null,
      },
    ],
    timelineEvents: [
      {
        id: timelineId,
        eventText: "天门洞开",
        validFromChapter: 10,
        validToChapter: null,
        locator: "第二卷 · 天门洞开",
      },
    ],
    knowledgeStates: [
      {
        id: knowledgeId,
        characterId,
        characterName: "沈砚",
        objectiveFactId: factId,
        state: "unknown",
        claimedContent: "父母死于仇杀",
        validFromChapter: 1,
        validToChapter: null,
      },
    ],
    locations: [
      {
        id: locationId,
        name: "血河城",
        aliases: [],
        validFromChapter: 1,
        validToChapter: null,
      },
    ],
    voices: [
      {
        id: voiceId,
        characterId,
        characterName: "沈砚",
        voiceGuide: "句子短，少用感叹。",
        voiceSample: "“我记得，只是还没想起来。”",
      },
    ],
    styleBaseline: {
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c10",
      versionNodeId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2c11",
      excerpts: ["风停。钟声未响。沈砚藏起断臂，继续往山上走。"],
    },
    ...overrides,
  };
}

describe("Critic rules", () => {
  it("flags objective fact contradictions with a precise evidence span", () => {
    const content = "风停。\n\n沈砚双手结印，断臂竟毫无妨碍。";
    const result = evaluateCritic(input(content));
    const finding = result.findings.find((item) => item.code === "FACT_CONTRADICTION");

    expect(CRITIC_RULE_VERSION).toBe("m1-critic-rules-v1");
    expect(finding).toMatchObject({
      dimension: "continuity",
      qualityDimension: "continuity",
      severity: "P0",
      structural: true,
    });
    expect(finding?.evidence[0]).toMatchObject({
      kind: "fact",
      sourceId: factId,
      quote: "沈砚双手结印，断臂竟毫无妨碍。",
    });
    expect(finding?.evidence[0]?.startOffset).toBe(content.indexOf("沈砚"));
  });

  it("flags knowledge the POV character has not learned yet", () => {
    const content = "沈砚忽然明白，父母死于仇杀。";
    const result = evaluateCritic(input(content));
    const finding = result.findings.find((item) => item.code === "UNDISCLOSED_KNOWLEDGE");

    expect(finding).toMatchObject({
      dimension: "continuity",
      severity: "P0",
      structural: true,
    });
    expect(finding?.evidence[0]).toMatchObject({
      kind: "knowledge",
      sourceId: knowledgeId,
    });
  });

  it("flags a motivation break against the chapter goal", () => {
    const content = "沈砚收起断刀，转身离开，不再战斗。";
    const result = evaluateCritic(input(content));
    const finding = result.findings.find((item) => item.code === "MOTIVATION_BREAK");

    expect(finding).toMatchObject({
      dimension: "reader_experience",
      severity: "P1",
      structural: false,
    });
    expect(finding?.evidence[0]).toMatchObject({
      kind: "outline",
      sourceId: outlineId,
    });
  });

  it("collects evidence across facts, timeline, knowledge, outline, location and voice", () => {
    const content = [
      "沈砚忽然明白，父母死于仇杀。",
      "沈砚双手结印，天门洞开。",
      "沈砚却走进血河城。",
      "太震撼了！！！不可能！！！",
      "沈砚收起断刀，转身离开，不再战斗。",
    ].join("\n\n");
    const result = evaluateCritic(input(content));
    const kinds = new Set(
      result.findings.flatMap((finding) => finding.evidence.map((e) => e.kind)),
    );

    const requiredKinds = [
      "fact",
      "timeline",
      "knowledge",
      "outline",
      "location",
      "voice",
    ] as const;
    for (const kind of requiredKinds) {
      expect(kinds.has(kind)).toBe(true);
    }
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "FACT_CONTRADICTION",
        "TIMELINE_CONFLICT",
        "UNDISCLOSED_KNOWLEDGE",
        "MOTIVATION_BREAK",
        "LOCATION_CONFLICT",
        "STYLE_DRIFT",
      ]),
    );
  });

  it("does not flag normal style variation as drift", () => {
    const content = "风停了。沈砚把断臂藏进袖中，继续往山上走。\n\n钟声未响。";
    const result = evaluateCritic(input(content));

    expect(result.findings.filter((finding) => finding.code === "STYLE_DRIFT")).toEqual([]);
    expect(result.dimensions).toHaveLength(6);
    expect(result.dimensions.every((dimension) => dimension.evidence.length > 0)).toBe(true);
  });

  it("keeps six-dimension scores integral when a P1 continuity finding is present", () => {
    const result = evaluateCritic(input("沈砚走进血河城。"));
    const continuity = result.dimensions.find((dimension) => dimension.dimension === "continuity");

    expect(continuity?.score).toBe(3);
    expect(Number.isInteger(continuity?.score)).toBe(true);
  });
});
