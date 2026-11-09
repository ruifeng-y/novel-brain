import { describe, expect, it } from "vitest";

import {
  GOLDEN_THREE_REVIEW_DIMENSIONS,
  goldenThreeCandidateBatchRequestSchema,
  goldenThreeLockRequestSchema,
  goldenThreeReviewBatchRequestSchema,
  goldenThreeWorkspaceSchema,
} from "../src";

const workId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e01";
const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e02";
const batchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e03";
const candidateAId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e04";
const candidateBId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e05";
const chapterIds = [
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e11",
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e12",
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e13",
];
const versionIds = [
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e21",
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e22",
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e23",
];
const nodeIds = [
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e31",
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e32",
  "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e33",
];

const pins = chapterIds.map((chapterId, index) => ({
  chapterId,
  chapterVersionId: versionIds[index]!,
  expectedContentHash: "a".repeat(64),
}));

function reviewInput(dimension: (typeof GOLDEN_THREE_REVIEW_DIMENSIONS)[number]) {
  return {
    dimension,
    score: 4,
    evidence: {
      chapterId: chapterIds[0]!,
      chapterVersionId: versionIds[0]!,
      passage: "残剑割掌，血逆流上碑。",
      locator: "第 1 章 · 首段",
    },
    reviewerOrigin: "model" as const,
  };
}

function pinnedChapter(index: number) {
  return {
    chapterId: chapterIds[index]!,
    chapterNumber: index + 1,
    chapterTitle: ["断碑夜雨", "铜牌背面", "忘名之价"][index]!,
    chapterVersionId: versionIds[index]!,
    chapterVersion: 2,
    versionNodeId: nodeIds[index]!,
    contentHash: "a".repeat(64),
    wordCount: 2_800,
    content: "残剑割掌，血逆流上碑。",
  };
}

describe("golden three contracts", () => {
  it("freezes 2-3 candidates, six evidence reviews and an explicit override policy", () => {
    expect(GOLDEN_THREE_REVIEW_DIMENSIONS).toEqual([
      "opening_hook",
      "protagonist_appeal",
      "world_rules",
      "core_conflict",
      "reader_promise",
      "chapter_end_hook",
    ]);

    const batch = goldenThreeCandidateBatchRequestSchema.parse({
      candidates: [
        {
          label: "候选 A · 钩子优先",
          strategy: "hook_focus",
          prompt: { key: "golden-three-opening", version: 3, hash: "b".repeat(64) },
          model: {
            provider: "deepseek",
            model: "deepseek-chat",
            parameters: { temperature: 0.7 },
          },
          context: {
            packVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e41",
            manifestHash: "c".repeat(64),
          },
          pins: [pins[0]!],
        },
        {
          label: "候选 B · 人物优先",
          strategy: "character_focus",
          prompt: { key: "golden-three-opening", version: 3, hash: "d".repeat(64) },
          model: {
            provider: "deepseek",
            model: "deepseek-chat",
            parameters: { temperature: 0.7 },
          },
          context: {
            packVersionId: null,
            manifestHash: "e".repeat(64),
          },
          pins: [pins[0]!],
        },
      ],
    });
    expect(batch.candidates).toHaveLength(2);

    expect(() =>
      goldenThreeCandidateBatchRequestSchema.parse({
        candidates: [
          { ...batch.candidates[0], pins: pins.slice(0, 2) },
          { ...batch.candidates[1], label: batch.candidates[0]!.label },
        ],
      }),
    ).toThrow();

    const reviews = goldenThreeReviewBatchRequestSchema.parse({
      version: 1,
      reviews: GOLDEN_THREE_REVIEW_DIMENSIONS.map(reviewInput),
    });
    expect(reviews.reviews).toHaveLength(6);
    expect(() =>
      goldenThreeReviewBatchRequestSchema.parse({
        version: 1,
        reviews: [...reviews.reviews.slice(0, 5), reviews.reviews[0]],
      }),
    ).toThrow();

    const lock = goldenThreeLockRequestSchema.parse({
      version: 2,
      override: {
        policy: "author_override_v1",
        rationale: "开篇方向已由作者复核，接受世界规则维度暂低于标准。",
      },
    });
    expect(lock.override?.policy).toBe("author_override_v1");
    expect(() =>
      goldenThreeLockRequestSchema.parse({
        version: 2,
        override: { policy: "author_override_v1", rationale: "太短" },
      }),
    ).toThrow();

    const workspace = goldenThreeWorkspaceSchema.parse({
      workId,
      branchId,
      candidates: [
        {
          id: candidateAId,
          batchId,
          workId,
          branchId,
          label: "候选 A · 钩子优先",
          strategy: "hook_focus",
          status: "selected",
          version: 2,
          prompt: batch.candidates[0]!.prompt,
          model: batch.candidates[0]!.model,
          context: batch.candidates[0]!.context,
          pins: [pinnedChapter(0)],
          continuation: {
            versionNodeId: nodeIds[0]!,
            pins: [pinnedChapter(1), pinnedChapter(2)],
            createdAt: "2026-11-06T08:02:00.000Z",
          },
          trace: null,
          reviews: GOLDEN_THREE_REVIEW_DIMENSIONS.map((dimension, index) => ({
            ...reviewInput(dimension),
            id: `0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1f0${index}`,
            candidateId: candidateAId,
            required: true,
            passed: true,
            createdAt: "2026-11-06T08:00:00.000Z",
            updatedAt: "2026-11-06T08:00:00.000Z",
          })),
          reviewSummary: {
            completed: 6,
            total: 6,
            requiredFailed: 0,
            failedDimensions: [],
          },
          createdAt: "2026-11-06T08:00:00.000Z",
          updatedAt: "2026-11-06T08:01:00.000Z",
        },
        {
          id: candidateBId,
          batchId,
          workId,
          branchId,
          label: "候选 B · 人物优先",
          strategy: "character_focus",
          status: "reviewed",
          version: 2,
          prompt: batch.candidates[1]!.prompt,
          model: batch.candidates[1]!.model,
          context: batch.candidates[1]!.context,
          pins: [pinnedChapter(0)],
          continuation: null,
          trace: null,
          reviews: [],
          reviewSummary: {
            completed: 0,
            total: 6,
            requiredFailed: 0,
            failedDimensions: [],
          },
          createdAt: "2026-11-06T08:00:00.000Z",
          updatedAt: "2026-11-06T08:01:00.000Z",
        },
      ],
      selectedCandidateId: candidateAId,
      lock: null,
      styleBaseline: null,
      gate: {
        candidateId: candidateAId,
        canLock: true,
        blockers: [],
        failedDimensions: [],
      },
    });
    expect(workspace.gate.canLock).toBe(true);
  });
});
