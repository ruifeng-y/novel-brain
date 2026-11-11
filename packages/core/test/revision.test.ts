import { describe, expect, it } from "vitest";

import {
  applyTargetedRevision,
  compileTargetedRevisionPrompt,
  computeUnresolvedRevisionFindings,
  revisionFindingRisk,
  revisionRoundLimitReached,
} from "../src";

const source = "风停了。\n\n太震撼了！！！\n\n钟声未响。";
const blocks = [
  { id: "block-1", start: 6, end: 13, label: "第二段" },
  { id: "block-2", start: 15, end: 20, label: "第三段" },
];
const findings = [
  {
    findingId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2c2c01",
    code: "STYLE_DRIFT",
    severity: "P2",
    qualityDimension: "character_voice",
    recommendation: "删去感叹号，改成动作反应。",
    evidence: [
      {
        quote: "太震撼了！！！",
        startOffset: 6,
        endOffset: 13,
        locator: "第 1 章 · 第 2 段",
        explanation: "声线失控。",
      },
    ],
  },
] as const;

describe("targeted revision rules", () => {
  it("replaces every selected block and preserves all surrounding text byte-for-byte", () => {
    const generated = JSON.stringify({
      replacements: [
        { blockId: "block-1", text: "太安静了。" },
        { blockId: "block-2", text: "风穿残钟。" },
      ],
    });
    const result = applyTargetedRevision(source, blocks, generated);

    expect(result.content).toBe("风停了。\n\n太安静了。\n\n风穿残钟。");
    expect(result.content.slice(0, 6)).toBe(source.slice(0, 6));
    expect(result.changes).toEqual([
      {
        blockId: "block-1",
        beforeStart: 6,
        beforeEnd: 13,
        afterStart: 6,
        afterEnd: 11,
        before: "太震撼了！！！",
        after: "太安静了。",
      },
      {
        blockId: "block-2",
        beforeStart: 15,
        beforeEnd: 20,
        afterStart: 13,
        afterEnd: 18,
        before: "钟声未响。",
        after: "风穿残钟。",
      },
    ]);
  });

  it("rejects missing, duplicate, extra and out-of-bounds replacement targets", () => {
    expect(() =>
      applyTargetedRevision(
        source,
        blocks,
        JSON.stringify({
          replacements: [{ blockId: "block-1", text: "太安静了。" }],
        }),
      ),
    ).toThrow("Missing replacement");
    expect(() =>
      applyTargetedRevision(
        source,
        blocks,
        JSON.stringify({
          replacements: [
            { blockId: "block-1", text: "一" },
            { blockId: "block-1", text: "二" },
            { blockId: "block-2", text: "三" },
          ],
        }),
      ),
    ).toThrow("Duplicate replacement");
    expect(() =>
      applyTargetedRevision(
        source,
        blocks,
        JSON.stringify({
          replacements: [
            { blockId: "block-1", text: "一" },
            { blockId: "block-2", text: "二" },
            { blockId: "block-3", text: "三" },
          ],
        }),
      ),
    ).toThrow("Unknown replacement");
    expect(() =>
      applyTargetedRevision(
        source,
        [{ id: "block-1", start: 1, end: 999 }],
        JSON.stringify({
          replacements: [{ blockId: "block-1", text: "越界" }],
        }),
      ),
    ).toThrow("outside the source version");
  });

  it("keeps findings unresolved while their original evidence quote still exists", () => {
    const firstPass = applyTargetedRevision(
      source,
      blocks,
      JSON.stringify({
        replacements: [
          { blockId: "block-1", text: "太震撼了！！！\n他后退半步。" },
          { blockId: "block-2", text: "钟声未响" },
        ],
      }),
    );
    expect(computeUnresolvedRevisionFindings(findings, firstPass.content)).toEqual([
      findings[0].findingId,
    ]);

    const secondPass = applyTargetedRevision(
      source,
      blocks,
      JSON.stringify({
        replacements: [
          { blockId: "block-1", text: "他收紧了呼吸。" },
          { blockId: "block-2", text: "钟声未响" },
        ],
      }),
    );
    expect(computeUnresolvedRevisionFindings(findings, secondPass.content)).toEqual([]);
  });

  it("maps only low and medium findings to targeted revisions and respects the two-round cap", () => {
    expect(revisionFindingRisk("P3")).toBe("low");
    expect(revisionFindingRisk("P2")).toBe("medium");
    expect(revisionFindingRisk("P1")).toBeNull();
    expect(revisionFindingRisk("P0")).toBeNull();
    expect(revisionRoundLimitReached(0, 2)).toBe(false);
    expect(revisionRoundLimitReached(1, 2)).toBe(false);
    expect(revisionRoundLimitReached(2, 2)).toBe(true);
  });

  it("compiles a constrained prompt with findings but only the selected manuscript blocks", () => {
    const prompt = compileTargetedRevisionPrompt({
      sourceContent: source,
      blocks,
      findings,
      constraints: {
        preserveOutsideSelection: true,
        protectLockedContent: true,
        authorInstruction: "不要新增事实。",
      },
    });

    expect(prompt.prompt).toContain("太震撼了！！！");
    expect(prompt.prompt).not.toContain("风停了。");
    expect(prompt.prompt).toContain("删去感叹号");
    expect(prompt.prompt).toContain("不要新增事实");
    expect(prompt.prompt).toContain('"block-1"');
    expect(prompt.system).toContain("只返回 JSON");
  });
});
