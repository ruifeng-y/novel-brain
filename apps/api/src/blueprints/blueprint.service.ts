import { createHash } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import {
  GENERATE_BLUEPRINT_JOB,
  blueprintAcknowledgementSchema,
  blueprintConflictSchema,
  blueprintCoreSettingDraftSchema,
  blueprintCostSchema,
  blueprintEstimateSchema,
  blueprintMissingFieldSchema,
  blueprintOutlineDraftSchema,
  blueprintStoryBibleDraftSchema,
  generateBlueprintJobSchema,
  workBlueprintSchema,
  type BlueprintEstimate,
  type BlueprintEstimateQuery,
  type GenerateBlueprintJob,
  type WorkBlueprint,
} from "@novel-brain/contracts";
import { estimateBlueprint } from "@novel-brain/core";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class references for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BlueprintJobQueue } from "./blueprint.queue";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BlueprintRepository } from "./blueprint.repository";
import type { BlueprintJobProvision, PrepareIdeaBlueprintInput } from "./blueprint.types";

@Injectable()
export class BlueprintService {
  private readonly logger = new Logger(BlueprintService.name);

  constructor(
    private readonly repository: BlueprintRepository,
    private readonly queue: BlueprintJobQueue,
  ) {}

  estimate(input: BlueprintEstimateQuery): BlueprintEstimate {
    return estimateBlueprint({
      ...input,
    });
  }

  async prepareForIdea(input: PrepareIdeaBlueprintInput): Promise<BlueprintJobProvision> {
    const estimate = this.estimate({
      genre: input.genre,
      scaleTarget: input.scaleTarget,
      chapterLengthTarget: input.chapterLengthTarget,
    });
    const budget = input.budgetOverride ?? estimate.defaultBudget;
    const modelConfigId = await this.repository.preferredModelConfigId(input.userId);
    const jobId = uuidv7();
    const inputHash = createHash("sha256")
      .update(
        JSON.stringify({
          userId: input.userId,
          workId: input.workId,
          branchId: input.branchId,
          title: input.title,
          idea: input.idea,
          genre: input.genre,
          scaleTarget: input.scaleTarget,
          chapterLengthTarget: input.chapterLengthTarget,
          templatePackId: input.templatePackId,
          budget,
          modelConfigId,
        }),
      )
      .digest("hex");
    const jobPayload = generateBlueprintJobSchema.parse({
      jobId,
      jobType: GENERATE_BLUEPRINT_JOB,
      workId: input.workId,
      branchId: input.branchId,
      actorId: input.userId,
      modelConfigId,
      idempotencyKey: blueprintJobIdempotencyKey(input.workId, input.branchId),
      budget,
      checkpoint: {
        schemaVersion: 1,
        revision: 0,
        step: "prepare",
        inputHash,
        payload: {},
      },
    });
    return {
      blueprintId: uuidv7(),
      jobId,
      userId: input.userId,
      workId: input.workId,
      branchId: input.branchId,
      modelConfigId,
      inputHash,
      estimate,
      budget,
      jobPayload,
    };
  }

  async enqueue(provision: BlueprintJobProvision): Promise<void> {
    await this.queue.enqueue(provision.jobPayload);
  }

  async enqueueSafely(payload: GenerateBlueprintJob): Promise<void> {
    try {
      await this.queue.enqueue(payload);
    } catch {
      this.logger.warn({
        event: "blueprint.enqueue_failed",
        jobId: payload.jobId,
        workId: payload.workId,
        branchId: payload.branchId,
      });
    }
  }

  async retryQueuedDelivery(userId: string, workId: string, branchId: string): Promise<void> {
    const payload = await this.repository.requeuePayload(userId, workId, branchId);
    if (payload) {
      await this.enqueueSafely(payload);
    }
  }

  async retry(userId: string, workId: string, branchId: string): Promise<WorkBlueprint> {
    const payload = await this.repository.requeuePayload(userId, workId, branchId);
    if (payload) {
      await this.queue.enqueue(payload);
    }
    return this.get(userId, workId, branchId);
  }

  async get(userId: string, workId: string, branchId: string): Promise<WorkBlueprint> {
    const lookup = await this.repository.find(userId, workId, branchId);
    if (lookup.kind === "forbidden") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    if (lookup.kind === "missing") {
      throw new ApiError(404, "BLUEPRINT_NOT_FOUND", "该作品没有故事蓝图任务");
    }
    return workBlueprintSchema.parse({
      id: lookup.blueprint.id,
      workId: lookup.blueprint.workId,
      branchId: lookup.blueprint.branchId,
      jobId: lookup.blueprint.jobId,
      status: lookup.blueprint.status,
      version: lookup.blueprint.version,
      progress: lookup.blueprint.progress,
      currentStep: lookup.blueprint.currentStep,
      estimate: blueprintEstimateSchema.parse(lookup.blueprint.estimate),
      cost: blueprintCostSchema.parse(lookup.blueprint.cost),
      draftHash: lookup.blueprint.draftHash,
      storyBibleDraft: lookup.blueprint.storyBibleDraft
        ? blueprintStoryBibleDraftSchema.parse(lookup.blueprint.storyBibleDraft)
        : null,
      coreSettingsDraft: lookup.blueprint.coreSettingsDraft.map((candidate) =>
        blueprintCoreSettingDraftSchema.parse(candidate),
      ),
      outlineDraft: lookup.blueprint.outlineDraft
        ? blueprintOutlineDraftSchema.parse(lookup.blueprint.outlineDraft)
        : null,
      missingFields: lookup.blueprint.missingFields.map((field) =>
        blueprintMissingFieldSchema.parse(field),
      ),
      conflicts: lookup.blueprint.conflicts.map((conflict) =>
        blueprintConflictSchema.parse(conflict),
      ),
      acknowledgements: lookup.blueprint.acknowledgements.map((acknowledgement) =>
        blueprintAcknowledgementSchema.parse(acknowledgement),
      ),
      allowedActions: [],
      confirmedAt: lookup.blueprint.confirmedAt?.toISOString() ?? null,
      confirmedBy: lookup.blueprint.confirmedBy,
      createdAt: lookup.blueprint.createdAt.toISOString(),
      updatedAt: lookup.blueprint.updatedAt.toISOString(),
    });
  }
}

export function blueprintJobIdempotencyKey(workId: string, branchId: string): string {
  return `blueprint:${workId}:${branchId}`;
}
