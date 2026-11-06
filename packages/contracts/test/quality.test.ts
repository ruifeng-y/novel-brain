import { describe, expect, it } from "vitest";

import {
  QUALITY_DIMENSIONS,
  QUALITY_RUBRIC_VERSION,
  criticAnnotationPatchRequestSchema,
  criticFindingSchema,
  qualityWorkspaceSchema,
} from "../src";

const workId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b01";
const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b02";
const chapterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b03";
const chapterVersionId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b04";
const factId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b05";
const reportId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b06";
const findingId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2b07";

function evidence(kind: (typeof QUALITY_DIMENSIONS)[number] extends never ? never : string) {
  return {
    kind,
    sourceId: factId,
    sourceVersionId: null,
    chapterId,
    chapterVersionId,
    quote: "沈砚双手结印。",
    startOffset: 0,
    endOffset: 7,
    locator: "第 5 章 · 第 2 段",
    explanation: "正文与已确认事实冲突。",
  };
}

describe("quality contracts", () => {
  it("freezes six report dimensions and the structured finding lifecycle", () => {
    expect(QUALITY_RUBRIC_VERSION).toBe("m1-quality-rubric-v1");
    expect(QUALITY_DIMENSIONS).toEqual([
      "hook",
      "pacing",
      "information_density",
      "character_voice",
      "prose",
      "continuity",
    ]);

    const finding = criticFindingSchema.parse({
      id: findingId,
      reportId,
      workId,
      branchId,
      chapterId,
      chapterVersionId,
      dimension: "continuity",
      qualityDimension: "continuity",
      severity: "P0",
      structural: true,
      code: "FACT_CONTRADICTION",
      evidence: [evidence("fact")],
      sourceRefs: [
        {
          type: "fact",
          id: factId,
          versionId: null,
          label: "沈砚 · 身体状态",
        },
      ],
      affectedObjects: [
        { type: "chapter_version", id: chapterVersionId, label: "第 5 章正文" },
        { type: "fact", id: factId, label: "沈砚 · 身体状态" },
      ],
      recommendation: "删去双手结印，改成单手施法。",
      status: "open",
      ignoredReason: null,
      version: 1,
      createdAt: "2026-11-06T08:00:00.000Z",
      updatedAt: "2026-11-06T08:00:00.000Z",
    });
    expect(finding.severity).toBe("P0");
    expect(finding.evidence[0]?.kind).toBe("fact");

    expect(() =>
      criticFindingSchema.parse({
        ...finding,
        status: "dismissed",
        ignoredReason: null,
      }),
    ).toThrow();
    expect(() => criticFindingSchema.parse({ ...finding, extra: true })).toThrow();
  });

  it("parses a six-dimension report with evidence and downstream gates", () => {
    const workspace = qualityWorkspaceSchema.parse({
      report: {
        id: reportId,
        workId,
        branchId,
        chapterId,
        chapterVersionId,
        rubricVersion: QUALITY_RUBRIC_VERSION,
        ruleVersion: "m1-critic-rules-v1",
        sourceHash: "a".repeat(64),
        dimensions: QUALITY_DIMENSIONS.map((dimension) => ({
          dimension,
          label: dimension,
          score: dimension === "continuity" ? 2 : 4,
          rationale: "有正文证据。",
          evidence: [evidence(dimension === "continuity" ? "fact" : "text")],
        })),
        summary: "连续性存在阻断冲突。",
        createdAt: "2026-11-06T08:00:00.000Z",
      },
      findings: [],
      annotations: [],
      gate: {
        canApprove: false,
        canCommitCanon: false,
        reportState: "fresh",
        reportId: findingId,
        blockers: [
          {
            findingId,
            code: "FACT_CONTRADICTION",
            severity: "P0",
            gate: "both",
            message: "沈砚不能双手结印。",
          },
        ],
      },
    });
    expect(workspace.report?.dimensions).toHaveLength(6);
    expect(workspace.gate.canApprove).toBe(false);
  });

  it("requires a reason when dismissing a low-risk finding and allows reopening it", () => {
    expect(
      criticAnnotationPatchRequestSchema.parse({
        action: "dismiss",
        version: 1,
        reason: "此处是角色对旧伤的刻意掩饰，不是连续性错误。",
      }).action,
    ).toBe("dismiss");
    expect(() =>
      criticAnnotationPatchRequestSchema.parse({
        action: "dismiss",
        version: 1,
      }),
    ).toThrow();
    expect(
      criticAnnotationPatchRequestSchema.parse({
        action: "reopen",
        version: 2,
      }).action,
    ).toBe("reopen");
  });
});
