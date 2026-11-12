import { describe, expect, it } from "vitest";

import { detectForcedHumanReviewEvents, evaluateBatchReviewEligibility } from "../src/batch-review";

const eligibleInput = {
  approvalMode: "auto" as const,
  targetType: "chapter" as const,
  chapterNumber: 10,
  volumeLastChapterNumber: 20,
  readiness: {
    canProceed: true,
    status: "ready" as const,
    riskApprovalReady: true,
    outlineReady: true,
  },
  quality: {
    reportState: "fresh" as const,
    canApprove: true,
    scores: [4, 4, 4, 4, 4, 4],
    severities: [] as Array<"P0" | "P1" | "P2" | "P3">,
    structuralFindingCount: 0,
  },
  hasGoldenThreeLock: true,
  forcedHumanReviewEvents: [],
};

describe("batch review eligibility", () => {
  it("allows only low-risk automatic approval and always stops at volume boundaries", () => {
    expect(evaluateBatchReviewEligibility(eligibleInput)).toMatchObject({
      eligible: true,
      risk: "low",
      reasons: [],
    });

    expect(
      evaluateBatchReviewEligibility({
        ...eligibleInput,
        approvalMode: "per_chapter",
      }),
    ).toMatchObject({
      eligible: false,
      risk: "low",
      reasons: expect.arrayContaining(["MANUAL_APPROVAL_MODE"]),
    });

    expect(
      evaluateBatchReviewEligibility({
        ...eligibleInput,
        quality: {
          ...eligibleInput.quality,
          canApprove: false,
          severities: ["P0"],
        },
      }),
    ).toMatchObject({
      eligible: false,
      risk: "high",
      reasons: expect.arrayContaining(["UNRESOLVED_P0"]),
    });

    expect(
      evaluateBatchReviewEligibility({
        ...eligibleInput,
        chapterNumber: 20,
      }),
    ).toMatchObject({
      eligible: false,
      risk: "high",
      reasons: expect.arrayContaining(["VOLUME_BOUNDARY"]),
    });
  });

  it.each([
    ["人物死亡", "沈砚一剑落下，顾青当场身亡。", [], "CHARACTER_DEATH"],
    ["金手指升级", "忘川书忽然觉醒，古书进阶到第二重。", [], "GOLDEN_FINGER_UPGRADE"],
    [
      "已锁定事实变化",
      "沈砚仍然只有一条手臂。",
      [{ subject: "沈砚", predicate: "身体状态", object: "断臂恢复" }],
      "LOCKED_CANON_CHANGE",
    ],
  ] as const)("detects a forced human review event: %s", (_label, content, facts, expected) => {
    expect(
      detectForcedHumanReviewEvents({
        chapterContent: content,
        highRiskFacts: facts,
      }),
    ).toContain(expected);
  });

  it("never auto-approves a forced human review event", () => {
    expect(
      evaluateBatchReviewEligibility({
        ...eligibleInput,
        forcedHumanReviewEvents: ["CHARACTER_DEATH"],
      }),
    ).toMatchObject({
      eligible: false,
      risk: "high",
      reasons: ["CHARACTER_DEATH"],
    });
  });
});
