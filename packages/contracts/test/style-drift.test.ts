import { describe, expect, it } from "vitest";

import {
  styleDriftCheckRequestSchema,
  styleDriftReportSchema,
  styleProfileCreateRequestSchema,
  styleProfileSchema,
} from "../src";

const workId = "0199c2e0-0000-7000-8000-000000000001";
const branchId = "0199c2e0-0000-7000-8000-000000000002";
const chapterId = "0199c2e0-0000-7000-8000-000000000003";
const chapterVersionId = "0199c2e0-0000-7000-8000-000000000004";
const characterId = "0199c2e0-0000-7000-8000-000000000005";
const profileId = "0199c2e0-0000-7000-8000-000000000006";
const versionNodeId = "0199c2e0-0000-7000-8000-000000000007";

describe("style baseline and drift contracts", () => {
  it("requires an approved baseline to carry source, version, scope, dimension and approval", () => {
    const profile = styleProfileSchema.parse({
      id: profileId,
      workId,
      branchId,
      scope: "character",
      scopeId: characterId,
      dimension: "character_voice",
      name: "沈砚 · 克制声线",
      version: 2,
      approvalStatus: "approved",
      source: {
        type: "approved_chapter_version",
        id: chapterVersionId,
        versionId: chapterVersionId,
        versionNodeId,
        label: "第 1 章 · 已批准正文",
      },
      profile: {
        guides: ["句子短，少用感叹。"],
        samples: [
          {
            chapterId,
            chapterVersionId,
            excerpt: "风停了。他没有回头。",
            locator: "第 1 章 · 第 1 段",
          },
        ],
        metrics: {
          averageSentenceLength: 4.5,
          exclamationRate: 0,
          dialogueRatio: 0.1,
        },
      },
      approval: {
        approvedBy: workId,
        approvedAt: "2026-11-06T10:00:00.000Z",
        rationale: "作者确认这是沈砚前期的稳定声线。",
      },
      versionNodeId,
      createdAt: "2026-11-06T10:00:00.000Z",
      updatedAt: "2026-11-06T10:00:00.000Z",
    });
    expect(profile.approvalStatus).toBe("approved");

    expect(
      styleProfileSchema.safeParse({
        ...profile,
        approvalStatus: "approved",
        approval: null,
      }).success,
    ).toBe(false);
    expect(
      styleProfileSchema.safeParse({
        ...profile,
        scope: "work",
        scopeId: characterId,
      }).success,
    ).toBe(false);
  });

  it("rejects incomplete baseline sources and draft auto-promotion payloads", () => {
    expect(
      styleProfileCreateRequestSchema.safeParse({
        scope: "character",
        scopeId: characterId,
        dimension: "character_voice",
        name: "沈砚 · 克制声线",
        source: {
          type: "author_sample",
          id: chapterVersionId,
          versionId: chapterVersionId,
          label: "第 1 章 · 作者样本",
        },
        approvalStatus: "approved",
      }).success,
    ).toBe(false);

    expect(
      styleProfileCreateRequestSchema.parse({
        scope: "character",
        scopeId: characterId,
        dimension: "character_voice",
        name: "沈砚 · 克制声线",
        source: {
          type: "author_sample",
          id: chapterVersionId,
          versionId: chapterVersionId,
          label: "第 1 章 · 作者样本",
        },
      }).approvalStatus,
    ).toBe("pending");
  });

  it("requires scoped windows for chapter, volume and cross-volume checks", () => {
    expect(
      styleDriftCheckRequestSchema.safeParse({
        scope: "chapter",
        chapterId,
        model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
        prompt: { key: "style-drift-review", version: 1 },
      }).success,
    ).toBe(true);
    expect(
      styleDriftCheckRequestSchema.safeParse({
        scope: "chapter",
        fromChapter: 1,
        toChapter: 2,
        model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
        prompt: { key: "style-drift-review", version: 1 },
      }).success,
    ).toBe(false);
    expect(
      styleDriftCheckRequestSchema.safeParse({
        scope: "cross_volume",
        fromChapter: 1,
        toChapter: 6,
        model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
        prompt: { key: "style-drift-review", version: 1 },
      }).success,
    ).toBe(true);
  });

  it("keeps model, prompt, profile versions and passage evidence on the report", () => {
    const report = styleDriftReportSchema.parse({
      id: "0199c2e0-0000-7000-8000-000000000008",
      workId,
      branchId,
      scope: "cross_volume",
      chapterId: null,
      window: { fromChapter: 1, toChapter: 6 },
      baseline: {
        id: profileId,
        version: 2,
        dimension: "character_voice",
        sourceType: "approved_chapter_version",
      },
      profileVersion: 2,
      ruleVersion: "m1-style-drift-v1",
      model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
      prompt: { key: "style-drift-review", version: 1 },
      summary: "跨卷区间发现 1 处漂移。",
      findings: [
        {
          id: "0199c2e0-0000-7000-8000-000000000009",
          code: "CHARACTER_VOICE_DRIFT",
          classification: "drift",
          severity: "P2",
          dimension: "character_voice",
          chapterId,
          chapterVersionId,
          quote: "不可能！！！",
          startOffset: 4,
          endOffset: 10,
          locator: "第 1 章 · 第 1 段",
          explanation: "感叹强度高于已批准样本。",
          recommendation: "对照已批准样本，再决定是否保留为有意变化。",
          growthEvidence: null,
        },
      ],
      trend: [
        {
          chapterId,
          chapterVersionId,
          chapterNumber: 1,
          exclamationRate: 0.12,
          averageSentenceLength: 12,
          dialogueRatio: 0.02,
          deviationScore: 2,
        },
      ],
      createdAt: "2026-11-06T10:00:00.000Z",
    });
    expect(report.profileVersion).toBe(2);
    expect(report.findings[0]?.endOffset).toBeGreaterThan(report.findings[0]?.startOffset ?? 0);
  });
});
