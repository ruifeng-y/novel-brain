import { describe, expect, it } from "vitest";

import {
  applyBatchWorkItemStatus,
  canCancelBatchPlan,
  canPauseBatchPlan,
  canResumeBatchPlan,
  canRetryBatchPlan,
  canStartBatchPlan,
  deriveChapterWorkItemStatus,
  derivePlanExecutionStatus,
  deriveVolumeWorkItemStatus,
} from "../src";

describe("batch execution state machine", () => {
  it("maps child job states into chapter work-item states", () => {
    expect(deriveChapterWorkItemStatus("queued")).toBe("running");
    expect(deriveChapterWorkItemStatus("running")).toBe("running");
    expect(deriveChapterWorkItemStatus("paused")).toBe("paused");
    expect(deriveChapterWorkItemStatus("waiting_review")).toBe("waiting_review");
    expect(deriveChapterWorkItemStatus("completed")).toBe("succeeded");
    expect(deriveChapterWorkItemStatus("failed")).toBe("failed");
    expect(deriveChapterWorkItemStatus("cancelled")).toBe("cancelled");
  });

  it("does not block a running sibling when one chapter fails", () => {
    const chapterStatuses = ["failed", "running", "pending"] as const;
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: [...chapterStatuses],
        approvalMode: "per_volume",
      }).status,
    ).toBe("running");
    expect(deriveVolumeWorkItemStatus([...chapterStatuses])).toBe("running");
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["failed", "pending"],
        approvalMode: "auto",
      }).status,
    ).toBe("running");
  });

  it("settles failed plans only after all chapters stop", () => {
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["failed", "succeeded"],
        approvalMode: "auto",
      }),
    ).toEqual({ status: "failed", progress: 100 });
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["succeeded", "skipped"],
        approvalMode: "auto",
      }),
    ).toEqual({ status: "completed", progress: 100 });
  });

  it("waits at a review boundary and resumes into completion", () => {
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["waiting_review", "pending"],
        volumeStatuses: ["running"],
        approvalMode: "per_volume",
      }),
    ).toEqual({ status: "running", progress: 50 });
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["waiting_review", "waiting_review"],
        volumeStatuses: ["waiting_review"],
        approvalMode: "per_volume",
      }),
    ).toEqual({ status: "waiting_review", progress: 100 });
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["waiting_review", "pending"],
        approvalMode: "per_chapter",
      }),
    ).toEqual({ status: "waiting_review", progress: 50 });
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["waiting_review", "pending"],
        approvalMode: "auto",
      }),
    ).toEqual({ status: "running", progress: 50 });
    expect(
      derivePlanExecutionStatus({
        current: "running",
        chapterStatuses: ["waiting_review", "waiting_review"],
        approvalMode: "auto",
      }),
    ).toEqual({ status: "waiting_review", progress: 100 });
    expect(
      derivePlanExecutionStatus({
        current: "waiting_review",
        chapterStatuses: ["succeeded", "succeeded"],
        volumeStatuses: ["succeeded"],
        approvalMode: "per_volume",
      }),
    ).toEqual({ status: "completed", progress: 100 });
  });

  it("ignores stale or out-of-order work-item events but allows explicit retry", () => {
    expect(applyBatchWorkItemStatus("succeeded", "running")).toBe("succeeded");
    expect(applyBatchWorkItemStatus("failed", "ready")).toBe("failed");
    expect(applyBatchWorkItemStatus("waiting_review", "running")).toBe("waiting_review");
    expect(applyBatchWorkItemStatus("failed", "ready", { force: true })).toBe("ready");
    expect(applyBatchWorkItemStatus("running", "running")).toBe("running");
  });

  it("gates plan controls by lifecycle state", () => {
    expect(canStartBatchPlan("queued")).toBe(true);
    expect(canStartBatchPlan("running")).toBe(false);
    expect(canPauseBatchPlan("running")).toBe(true);
    expect(canPauseBatchPlan("completed")).toBe(false);
    expect(canResumeBatchPlan("paused")).toBe(true);
    expect(canResumeBatchPlan("waiting_review")).toBe(false);
    expect(canCancelBatchPlan("running")).toBe(true);
    expect(canCancelBatchPlan("completed")).toBe(false);
    expect(canRetryBatchPlan("failed")).toBe(true);
    expect(canRetryBatchPlan("cancelled")).toBe(false);
  });
});
