import type {
  BatchApprovalMode,
  BatchWorkItemStatus,
  GenerationJobStatus,
} from "@novel-brain/contracts";

export type BatchPlanExecutionStatus = GenerationJobStatus;

const terminalWorkItemStatuses = new Set<BatchWorkItemStatus>([
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);

export function applyBatchWorkItemStatus(
  current: BatchWorkItemStatus,
  next: BatchWorkItemStatus,
  options: { force?: boolean } = {},
): BatchWorkItemStatus {
  if (current === next) {
    return current;
  }
  if (options.force) {
    return next;
  }
  if (terminalWorkItemStatuses.has(current)) {
    return current;
  }
  if (current === "waiting_review" && ["pending", "ready", "running"].includes(next)) {
    return current;
  }
  return next;
}

export function deriveChapterWorkItemStatus(childStatus: GenerationJobStatus): BatchWorkItemStatus {
  switch (childStatus) {
    case "queued":
    case "preparing":
    case "running":
      return "running";
    case "paused":
      return "paused";
    case "waiting_review":
      return "waiting_review";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export function deriveVolumeWorkItemStatus(
  chapterStatuses: readonly BatchWorkItemStatus[],
): BatchWorkItemStatus {
  if (chapterStatuses.length === 0) {
    return "pending";
  }
  if (chapterStatuses.some((status) => status === "paused")) {
    return "paused";
  }
  if (chapterStatuses.some((status) => status === "running" || status === "ready")) {
    return "running";
  }
  if (chapterStatuses.some((status) => status === "failed")) {
    return "failed";
  }
  if (chapterStatuses.some((status) => status === "cancelled")) {
    return "cancelled";
  }
  if (chapterStatuses.some((status) => status === "waiting_review")) {
    return "waiting_review";
  }
  if (chapterStatuses.every((status) => status === "succeeded" || status === "skipped")) {
    return "succeeded";
  }
  return "pending";
}

export function derivePlanExecutionStatus(input: {
  current: BatchPlanExecutionStatus;
  chapterStatuses: readonly BatchWorkItemStatus[];
  volumeStatuses?: readonly BatchWorkItemStatus[];
  approvalMode: BatchApprovalMode;
}): { status: BatchPlanExecutionStatus; progress: number } {
  const total = input.chapterStatuses.length;
  if (total === 0) {
    return { status: input.current, progress: 0 };
  }
  const settled = input.chapterStatuses.filter((status) =>
    ["succeeded", "failed", "skipped", "cancelled", "waiting_review"].includes(status),
  ).length;
  const progress = Math.round((settled / total) * 100);
  if (input.current === "paused" || input.current === "cancelled") {
    return { status: input.current, progress };
  }
  if (input.chapterStatuses.some((status) => status === "paused")) {
    return { status: "paused", progress };
  }
  const inFlight = input.chapterStatuses.filter((status) =>
    ["running", "ready"].includes(status),
  ).length;
  const waitingReview =
    input.approvalMode === "per_volume" && input.volumeStatuses
      ? input.volumeStatuses.filter((status) => status === "waiting_review").length
      : input.approvalMode === "auto"
        ? settled === total && input.chapterStatuses.some((status) => status === "waiting_review")
          ? 1
          : 0
        : input.chapterStatuses.filter((status) => status === "waiting_review").length;
  if (settled === total) {
    if (input.chapterStatuses.some((status) => status === "failed")) {
      return { status: "failed", progress: 100 };
    }
    if (input.chapterStatuses.some((status) => status === "cancelled")) {
      return { status: "cancelled", progress: 100 };
    }
    if (input.volumeStatuses?.some((status) => status === "cancelled")) {
      return { status: "cancelled", progress: 100 };
    }
    if (input.volumeStatuses?.some((status) => status === "failed")) {
      return { status: "failed", progress: 100 };
    }
    if (input.volumeStatuses?.some((status) => status === "waiting_review")) {
      return { status: "waiting_review", progress: 100 };
    }
    if (input.chapterStatuses.some((status) => status === "waiting_review")) {
      return { status: "waiting_review", progress: 100 };
    }
    return { status: "completed", progress: 100 };
  }
  if (waitingReview > 0 && inFlight === 0) {
    return { status: "waiting_review", progress };
  }
  if (inFlight > 0 || input.current === "queued" || input.current === "preparing") {
    return { status: "running", progress };
  }
  return { status: input.current, progress };
}

export function isBatchPlanTerminal(status: BatchPlanExecutionStatus): boolean {
  return ["completed", "failed", "cancelled"].includes(status);
}

export function canStartBatchPlan(status: BatchPlanExecutionStatus): boolean {
  return status === "queued";
}

export function canPauseBatchPlan(status: BatchPlanExecutionStatus): boolean {
  return ["queued", "preparing", "running"].includes(status);
}

export function canResumeBatchPlan(status: BatchPlanExecutionStatus): boolean {
  return status === "paused";
}

export function canCancelBatchPlan(status: BatchPlanExecutionStatus): boolean {
  return !isBatchPlanTerminal(status);
}

export function canRetryBatchPlan(status: BatchPlanExecutionStatus): boolean {
  return status === "failed";
}
