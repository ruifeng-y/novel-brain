import { Injectable } from "@nestjs/common";
import type { BatchTickJob } from "@novel-brain/contracts";
import { isBatchPlanTerminal } from "@novel-brain/core";

// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchPlanChildQueue } from "./batch-plan-child.queue";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorkerBatchPlanQueue } from "./batch-plan.queue";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { toGenerateChapterJob, WorkerBatchPlanRepository } from "./batch-plan.repository";

@Injectable()
export class BatchPlanTickProcessor {
  constructor(
    private readonly repository: WorkerBatchPlanRepository,
    private readonly childQueue: BatchPlanChildQueue,
    private readonly queue: WorkerBatchPlanQueue,
  ) {}

  async process(payload: BatchTickJob): Promise<void> {
    const plan = await this.repository.loadPlan(payload.actorId, payload.planId);
    if (!plan || isBatchPlanTerminal(plan.status)) {
      return;
    }
    const claimed = await this.repository.claimChapter(payload.actorId, payload.planId);
    if (claimed === "inactive") {
      return;
    }
    if (claimed === "none") {
      const result = await this.repository.recomputePlan(payload.actorId, plan, true);
      if (result.continue) {
        await this.queue.enqueueTick(nextTick(payload, plan));
      }
      return;
    }

    const child = await this.repository.ensureChildJob(payload.actorId, plan, claimed.chapterId);
    if (["queued", "preparing", "running"].includes(child.status)) {
      await this.childQueue.enqueueChapter(
        toGenerateChapterJob(child),
        plan.metadata.scheduling.priority,
      );
      return;
    }
    const result = await this.repository.syncChapterResult(
      payload.actorId,
      plan,
      claimed.chapterId,
      child,
    );
    if (result.continue) {
      await this.queue.enqueueTick(nextTick(payload, plan));
    }
  }

  async onChildFinished(payload: {
    jobId: string;
    actorId: string;
    chapterId: string;
  }): Promise<void> {
    const parentPlanId = await this.repository.findParentPlan(payload.actorId, payload.jobId);
    if (!parentPlanId) {
      return;
    }
    const plan = await this.repository.loadPlan(payload.actorId, parentPlanId);
    if (!plan) {
      return;
    }
    const child = await this.repository.ensureChildJob(payload.actorId, plan, payload.chapterId);
    const result = await this.repository.syncChapterResult(
      payload.actorId,
      plan,
      payload.chapterId,
      child,
    );
    if (result.continue) {
      await this.queue.enqueueTick({
        jobType: "batch_tick",
        planId: plan.id,
        workId: plan.workId,
        branchId: plan.branchId,
        actorId: plan.userId,
      });
    }
  }
}

function nextTick(
  payload: BatchTickJob,
  plan: { id: string; workId: string; branchId: string; userId: string },
): BatchTickJob {
  return {
    jobType: "batch_tick",
    planId: plan.id,
    workId: plan.workId,
    branchId: plan.branchId,
    actorId: plan.userId,
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
}
