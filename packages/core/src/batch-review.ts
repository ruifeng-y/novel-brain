import type { BatchApprovalMode, CriticSeverity, QualityReportState } from "@novel-brain/contracts";

export const BATCH_REVIEW_PREDICATE_VERSION = "batch-review-v1";

export type BatchReviewRisk = "low" | "medium" | "high";

export type BatchReviewRiskReason =
  | "MANUAL_APPROVAL_MODE"
  | "VOLUME_BOUNDARY"
  | "OUTLINE_NOT_LOCKED"
  | "PENDING_HIGH_RISK_APPROVAL"
  | "READINESS_BLOCKED"
  | "GOLDEN_THREE_UNLOCKED"
  | "QUALITY_REPORT_MISSING"
  | "QUALITY_REPORT_STALE"
  | "UNRESOLVED_P0"
  | "UNRESOLVED_P1"
  | "STRUCTURAL_FINDING"
  | "QUALITY_BELOW_THRESHOLD"
  | "QUALITY_WARNING"
  | "CHARACTER_DEATH"
  | "GOLDEN_FINGER_UPGRADE"
  | "LOCKED_CANON_CHANGE"
  | "BRANCH_MERGE";

export type BatchReviewForcedHumanReviewEvent =
  "CHARACTER_DEATH" | "GOLDEN_FINGER_UPGRADE" | "LOCKED_CANON_CHANGE" | "BRANCH_MERGE";

export interface BatchReviewEligibilityInput {
  approvalMode: BatchApprovalMode;
  targetType: "chapter" | "volume";
  chapterNumber: number | null;
  volumeLastChapterNumber: number | null;
  readiness: {
    canProceed: boolean;
    status: "not_ready" | "partial" | "ready";
    riskApprovalReady: boolean;
    outlineReady: boolean;
  };
  quality: {
    reportState: QualityReportState;
    canApprove: boolean;
    scores: readonly number[];
    severities: readonly CriticSeverity[];
    structuralFindingCount: number;
  };
  hasGoldenThreeLock: boolean;
  forcedHumanReviewEvents: readonly BatchReviewForcedHumanReviewEvent[];
}

export interface BatchReviewEligibility {
  predicateVersion: typeof BATCH_REVIEW_PREDICATE_VERSION;
  eligible: boolean;
  risk: BatchReviewRisk;
  reasons: BatchReviewRiskReason[];
}

export function evaluateBatchReviewEligibility(
  input: BatchReviewEligibilityInput,
): BatchReviewEligibility {
  const reasons = new Set<BatchReviewRiskReason>();

  if (input.approvalMode !== "auto") {
    reasons.add("MANUAL_APPROVAL_MODE");
  }
  if (
    input.targetType === "volume" ||
    (input.chapterNumber !== null &&
      input.volumeLastChapterNumber !== null &&
      input.chapterNumber === input.volumeLastChapterNumber)
  ) {
    reasons.add("VOLUME_BOUNDARY");
  }
  if (!input.readiness.outlineReady) {
    reasons.add("OUTLINE_NOT_LOCKED");
  }
  if (!input.readiness.riskApprovalReady) {
    reasons.add("PENDING_HIGH_RISK_APPROVAL");
  }
  if (!input.readiness.canProceed || input.readiness.status !== "ready") {
    reasons.add("READINESS_BLOCKED");
  }
  if (input.chapterNumber !== null && input.chapterNumber <= 3 && !input.hasGoldenThreeLock) {
    reasons.add("GOLDEN_THREE_UNLOCKED");
  }
  if (input.quality.reportState === "missing") {
    reasons.add("QUALITY_REPORT_MISSING");
  }
  if (input.quality.reportState === "stale") {
    reasons.add("QUALITY_REPORT_STALE");
  }
  if (!input.quality.canApprove) {
    if (input.quality.severities.includes("P0")) {
      reasons.add("UNRESOLVED_P0");
    }
    if (input.quality.severities.includes("P1")) {
      reasons.add("UNRESOLVED_P1");
    }
  }
  if (input.quality.structuralFindingCount > 0) {
    reasons.add("STRUCTURAL_FINDING");
  }
  if (
    input.quality.scores.length !== 6 ||
    input.quality.scores.some((score) => !Number.isInteger(score) || score < 4 || score > 5)
  ) {
    reasons.add("QUALITY_BELOW_THRESHOLD");
  }
  if (input.quality.severities.some((severity) => severity === "P2" || severity === "P3")) {
    reasons.add("QUALITY_WARNING");
  }
  for (const event of input.forcedHumanReviewEvents) {
    reasons.add(event);
  }

  const orderedReasons = sortReasons([...reasons]);
  const risk = riskFor(orderedReasons);
  return {
    predicateVersion: BATCH_REVIEW_PREDICATE_VERSION,
    eligible: orderedReasons.length === 0,
    risk,
    reasons: orderedReasons,
  };
}

const reasonOrder: BatchReviewRiskReason[] = [
  "MANUAL_APPROVAL_MODE",
  "VOLUME_BOUNDARY",
  "OUTLINE_NOT_LOCKED",
  "PENDING_HIGH_RISK_APPROVAL",
  "READINESS_BLOCKED",
  "GOLDEN_THREE_UNLOCKED",
  "QUALITY_REPORT_MISSING",
  "QUALITY_REPORT_STALE",
  "UNRESOLVED_P0",
  "UNRESOLVED_P1",
  "STRUCTURAL_FINDING",
  "QUALITY_BELOW_THRESHOLD",
  "QUALITY_WARNING",
  "CHARACTER_DEATH",
  "GOLDEN_FINGER_UPGRADE",
  "LOCKED_CANON_CHANGE",
  "BRANCH_MERGE",
];

function sortReasons(reasons: BatchReviewRiskReason[]): BatchReviewRiskReason[] {
  return reasons.sort((left, right) => reasonOrder.indexOf(left) - reasonOrder.indexOf(right));
}

function riskFor(reasons: readonly BatchReviewRiskReason[]): BatchReviewRisk {
  const riskReasons = reasons.filter((reason) => reason !== "MANUAL_APPROVAL_MODE");
  if (riskReasons.length === 0) {
    return "low";
  }
  return riskReasons.every((reason) => reason === "QUALITY_WARNING") ? "medium" : "high";
}

export function detectForcedHumanReviewEvents(input: {
  chapterContent: string;
  highRiskFacts: Array<{ subject: string; predicate: string; object: string }>;
  isBranchMerge?: boolean;
}): BatchReviewForcedHumanReviewEvent[] {
  const events = new Set<BatchReviewForcedHumanReviewEvent>();
  if (/(?:死亡|死去|身亡|殒命|气绝|断气|杀死|杀了)/u.test(input.chapterContent)) {
    events.add("CHARACTER_DEATH");
  }
  if (
    /(?:金手指|系统|异能|古书|法宝).{0,24}(?:升级|进阶|突破|晋升|觉醒)/u.test(
      input.chapterContent,
    ) ||
    /(?:升级|进阶|突破|晋升|觉醒).{0,24}(?:金手指|系统|异能|古书|法宝)/u.test(input.chapterContent)
  ) {
    events.add("GOLDEN_FINGER_UPGRADE");
  }
  if (
    input.highRiskFacts.some(
      (fact) => `${fact.subject}${fact.predicate}${fact.object}`.trim().length > 0,
    )
  ) {
    events.add("LOCKED_CANON_CHANGE");
  }
  if (input.isBranchMerge) {
    events.add("BRANCH_MERGE");
  }
  return [...events];
}
