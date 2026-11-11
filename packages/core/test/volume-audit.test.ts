import { describe, expect, it } from "vitest";

import { VOLUME_AUDIT_RULE_VERSION, evaluateVolumeAudit, type VolumeAuditInput } from "../src";

const chapter = (
  number: number,
  content: string,
  overrides: Partial<VolumeAuditInput["chapters"][number]> = {},
) => ({
  id: `0190f5e2-7e7a-7f4e-8d38-7e4e5b2a4${String(number).padStart(2, "0")}`,
  versionId: `0190f5e2-7e7a-7f4e-8d38-7e4e5b2a5${String(number).padStart(2, "0")}`,
  number,
  title: `第 ${number} 章`,
  content,
  outlineGoal: "护住顾青，找到新的战斗方式。",
  outlineLocation: "荒寺外山道",
  qualityFindings: [],
  ...overrides,
});

function input(overrides: Partial<VolumeAuditInput> = {}): VolumeAuditInput {
  return {
    volume: { title: "第一卷 · 忘川", chapterFrom: 1, chapterTo: 10 },
    chapters: [
      chapter(1, "沈砚把父母的旧信压在箱底。\n\n顾青在门外等他。"),
      chapter(2, "沈砚继续往山上走。\n\n钟声未响。"),
    ],
    ledgerEntries: [],
    powerRealms: [
      { id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a601", pathId: "p", name: "炼气", rank: 1 },
      { id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a602", pathId: "p", name: "筑基", rank: 2 },
      { id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a603", pathId: "p", name: "金丹", rank: 3 },
    ],
    timelineEvents: [],
    protagonist: {
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a701",
      name: "沈砚",
    },
    antagonists: [],
    ...overrides,
  };
}

describe("volume audit rules", () => {
  it("reports unresolved must-payoff foreshadows at volume end with ledger evidence", () => {
    const result = evaluateVolumeAudit(
      input({
        ledgerEntries: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a801",
            kind: "foreshadow",
            title: "父母之死",
            summary: "沈砚以为父母是自杀。",
            status: "planted",
            importance: "must",
            sourceChapterNumber: 1,
            targetWindow: { fromChapter: 1, toChapter: 5 },
            history: [
              {
                action: "setup",
                chapterNumber: 1,
                eventId: null,
                reason: "旧信埋下。",
                evidence: [{ strength: "strong" }],
              },
            ],
            prerequisiteEvents: [],
          },
        ],
      }),
    );

    const finding = result.findings.find((entry) => entry.code === "UNRESOLVED_LEDGER_ENTRY");
    expect(VOLUME_AUDIT_RULE_VERSION).toBe("m1-volume-audit-v1");
    expect(finding).toMatchObject({ severity: "P0", structural: true });
    expect(finding?.sourceRefs[0]).toMatchObject({
      type: "story_ledger_entry",
      label: "父母之死",
    });
    expect(finding?.evidence[0]?.locator).toContain("第 1 章");
    expect(finding?.recommendation).toContain("回收");
  });

  it("carries #117 chapter findings into the volume read model with upstream ids", () => {
    const upstreamId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a901";
    const result = evaluateVolumeAudit(
      input({
        chapters: [
          chapter(1, "沈砚走进血河城。", {
            qualityFindings: [
              {
                id: upstreamId,
                chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a401",
                chapterVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a501",
                chapterNumber: 1,
                code: "LOCATION_CONFLICT",
                dimension: "continuity",
                qualityDimension: "continuity",
                severity: "P1",
                structural: true,
                evidence: [
                  {
                    kind: "location",
                    sourceId: null,
                    sourceVersionId: null,
                    chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a401",
                    chapterVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a501",
                    quote: "沈砚走进血河城。",
                    startOffset: 0,
                    endOffset: 8,
                    locator: "第 1 章 · 第 1 段",
                    explanation: "章纲地点是荒寺外山道。",
                  },
                ],
                sourceRefs: [
                  {
                    type: "map_node",
                    id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2aa01",
                    versionId: null,
                    label: "血河城",
                  },
                ],
                affectedObjects: [
                  {
                    type: "chapter",
                    id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a401",
                    label: "第 1 章",
                  },
                ],
                recommendation: "确认移动过程或改回章纲地点。",
              },
            ],
          }),
        ],
      }),
    );

    const finding = result.findings.find((entry) => entry.code === "LOCATION_CONFLICT");
    expect(finding).toMatchObject({
      upstreamFindingId: upstreamId,
      severity: "P1",
      chapterNumber: 1,
    });
    expect(result.summary.mapTime).toBe(1);
  });

  it("flags an antagonist who has every advantage and still lets the protagonist escape", () => {
    const result = evaluateVolumeAudit(
      input({
        chapters: [
          chapter(
            3,
            "罗刹长老胜券在握，只派两名弟子追赶，自己回城庆功。\n\n沈砚反杀追兵，带着顾青脱身。",
          ),
        ],
        antagonists: [{ id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2aa02", name: "罗刹长老" }],
      }),
    );

    const finding = result.findings.find((entry) => entry.code === "ANTAGONIST_UNDERESTIMATION");
    expect(finding).toMatchObject({ severity: "P1", chapterNumber: 3 });
    expect(finding?.evidence[0]?.quote).toContain("只派两名弟子");
    expect(result.summary.antagonist).toBe(1);
  });

  it("flags two realm breakthroughs in one chapter as power inflation", () => {
    const result = evaluateVolumeAudit(
      input({
        chapters: [chapter(8, "沈砚踏入筑基，又在一炷香内踏入金丹。")],
      }),
    );

    const finding = result.findings.find((entry) => entry.code === "POWER_INFLATION");
    expect(finding).toMatchObject({ severity: "P1", chapterNumber: 8 });
    expect(finding?.evidence.length).toBe(2);
    expect(result.summary.powerInflation).toBe(1);
  });

  it("flags story time moving backwards across chapters", () => {
    const result = evaluateVolumeAudit(
      input({
        chapters: [chapter(1, "祭祀开始。"), chapter(2, "祭祀结束。")],
        timelineEvents: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2ab01",
            eventText: "祭祀结束。",
            validFromChapter: 2,
            storyTimeSortKey: 100,
            locator: "大玄历 · 子时",
          },
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2ab02",
            eventText: "祭祀开始。",
            validFromChapter: 1,
            storyTimeSortKey: 200,
            locator: "大玄历 · 丑时",
          },
        ],
      }),
    );

    const finding = result.findings.find(
      (entry) => entry.code === "TIMELINE_CONFLICT" && entry.upstreamFindingId === null,
    );
    expect(finding).toMatchObject({ severity: "P1", chapterNumber: 2 });
    expect(finding?.recommendation).toContain("故事时间");
  });

  it("does not manufacture findings for a clean volume", () => {
    const result = evaluateVolumeAudit(
      input({
        chapters: [
          chapter(1, "沈砚把父母的旧信压在箱底。\n\n顾青在门外等他。"),
          chapter(2, "沈砚继续往山上走。\n\n钟声未响。"),
        ],
      }),
    );

    expect(result.findings).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it("does not re-report a ledger window that ended before this volume", () => {
    const result = evaluateVolumeAudit(
      input({
        volume: { title: "第二卷 · 清卷", chapterFrom: 41, chapterTo: 42 },
        chapters: [chapter(41, "风停了。"), chapter(42, "沈砚继续上路。")],
        ledgerEntries: [
          {
            id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2ac01",
            kind: "foreshadow",
            title: "父母之死",
            summary: "第一卷已记录延期。",
            status: "deferred",
            importance: "must",
            sourceChapterNumber: 1,
            targetWindow: { fromChapter: 1, toChapter: 5 },
            history: [],
            prerequisiteEvents: [],
          },
        ],
      }),
    );

    expect(result.findings).toEqual([]);
  });
});
