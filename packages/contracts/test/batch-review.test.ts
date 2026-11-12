import { describe, expect, it } from "vitest";

import { batchReviewDecisionRequestSchema, batchReviewQueueItemSchema } from "../src";

const itemId = "019c1e8c-8e1c-7000-8000-000000000001";
const chapterId = "019c1e8c-8e1c-7000-8000-000000000002";
const planId = "019c1e8c-8e1c-7000-8000-000000000003";
const workItemId = "019c1e8c-8e1c-7000-8000-000000000004";

describe("batch review contracts", () => {
  it("keeps predicate evidence and individual bulk decisions explicit", () => {
    expect(
      batchReviewQueueItemSchema.parse({
        id: itemId,
        planId,
        workItemId,
        targetType: "chapter",
        targetId: chapterId,
        chapterId,
        chapterNumber: 12,
        chapterTitle: "雪夜问路",
        volumeTitle: "第一卷",
        status: "pending",
        risk: "high",
        riskReasons: [
          {
            code: "UNRESOLVED_P0",
            message: "本章还有未解决的 P0 连续性问题。",
          },
        ],
        quality: {
          reportState: "fresh",
          canApprove: false,
          scoreAverage: 3.83,
          blockerCount: 1,
        },
        findings: [
          {
            id: "019c1e8c-8e1c-7000-8000-000000000007",
            severity: "P0",
            code: "FACT_CONTRADICTION",
            qualityDimension: "continuity",
            recommendation: "改回符合已确认事实的动作。",
            quote: "沈砚双手结印。",
          },
        ],
        claimedBy: null,
        claimedAt: null,
        version: 1,
        createdAt: "2026-11-11T05:00:00.000Z",
        updatedAt: "2026-11-11T05:00:00.000Z",
      }),
    ).toMatchObject({
      risk: "high",
      quality: { blockerCount: 1 },
      findings: [{ severity: "P0" }],
    });

    expect(
      batchReviewDecisionRequestSchema.parse({
        items: [
          {
            itemId,
            expectedVersion: 1,
            action: "approve",
          },
          {
            itemId: "019c1e8c-8e1c-7000-8000-000000000006",
            expectedVersion: 1,
            action: "reject",
            reason: "本章主线偏离锁定大纲。",
          },
        ],
      }).items,
    ).toHaveLength(2);

    expect(() =>
      batchReviewDecisionRequestSchema.parse({
        items: [
          { itemId, expectedVersion: 1, action: "approve" },
          { itemId, expectedVersion: 1, action: "reject", reason: "重复目标。" },
        ],
      }),
    ).toThrow();

    expect(() =>
      batchReviewDecisionRequestSchema.parse({
        items: [{ itemId, expectedVersion: 1, action: "reject" }],
      }),
    ).toThrow();
  });
});
