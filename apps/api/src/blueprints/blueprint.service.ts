import { createHash } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import {
  GENERATE_BLUEPRINT_JOB,
  blueprintAcknowledgementSchema,
  blueprintBudgetSchema,
  blueprintConflictSchema,
  blueprintCoreSettingDraftSchema,
  blueprintCostSchema,
  blueprintDraftSchema,
  blueprintEstimateSchema,
  blueprintMissingFieldSchema,
  blueprintOutlineDraftSchema,
  blueprintStatusSchema,
  blueprintStoryBibleDraftSchema,
  generateBlueprintJobSchema,
  workBlueprintSchema,
  type BlueprintAcknowledgement,
  type BlueprintBudgetUpdateRequest,
  type BlueprintCancelRequest,
  type BlueprintConflict,
  type BlueprintConfirmRequest,
  type BlueprintDraftPatchRequest,
  type BlueprintEstimate,
  type BlueprintEstimateQuery,
  type BlueprintMissingField,
  type GenerateBlueprintJob,
  type WorkBlueprint,
} from "@novel-brain/contracts";
import { estimateBlueprint } from "@novel-brain/core";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import { blueprintDraftHash } from "./blueprint.draft";
// Nest uses the runtime class references for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BlueprintJobQueue } from "./blueprint.queue";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BlueprintRepository } from "./blueprint.repository";
import type {
  BlueprintAuditContext,
  BlueprintJobProvision,
  PrepareIdeaBlueprintInput,
} from "./blueprint.types";

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

  async retry(
    userId: string,
    workId: string,
    branchId: string,
    audit: BlueprintAuditContext,
  ): Promise<WorkBlueprint> {
    const payload = await this.repository.requeuePayload(userId, workId, branchId, true, audit);
    if (payload) {
      await this.queue.enqueue(payload);
    } else {
      await this.get(userId, workId, branchId);
      throw new ApiError(400, "VALIDATION_INVALID", "故事蓝图当前不可重试");
    }
    return this.get(userId, workId, branchId);
  }

  async patchDraft(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintDraftPatchRequest,
    audit: BlueprintAuditContext,
  ): Promise<WorkBlueprint> {
    const result = await this.repository.patchDraft(userId, workId, branchId, input, audit);
    if (result === "forbidden") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    if (result === "missing") {
      throw new ApiError(404, "BLUEPRINT_NOT_FOUND", "该作品没有故事蓝图任务");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事蓝图已更新，请刷新后重试");
    }
    if (result === "required_removal") {
      throw new ApiError(400, "VALIDATION_INVALID", "不能删除必需的核心设定候选");
    }
    if (result === "invalid_patch" || result === "not_reviewable") {
      throw new ApiError(400, "VALIDATION_INVALID", "故事蓝图当前不可编辑或补丁无效");
    }
    return this.get(userId, workId, branchId);
  }

  async updateBudget(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintBudgetUpdateRequest,
    audit: BlueprintAuditContext,
  ): Promise<WorkBlueprint> {
    const result = await this.repository.updateBudget(userId, workId, branchId, input, audit);
    if (result === "forbidden") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    if (result === "missing") {
      throw new ApiError(404, "BLUEPRINT_NOT_FOUND", "该作品没有故事蓝图任务");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事蓝图已更新，请刷新后重试");
    }
    if (result === "invalid_budget") {
      throw new ApiError(400, "VALIDATION_INVALID", "新预算必须高于已用成本且不得降低现有上限");
    }
    if (result === "not_paused") {
      throw new ApiError(400, "VALIDATION_INVALID", "只有预算暂停的故事蓝图可以调整预算");
    }
    await this.queue.enqueue(result);
    return this.get(userId, workId, branchId);
  }

  async cancel(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintCancelRequest,
    audit: BlueprintAuditContext,
  ): Promise<WorkBlueprint> {
    const result = await this.repository.cancel(userId, workId, branchId, input, audit);
    if (result === "forbidden") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    if (result === "missing") {
      throw new ApiError(404, "BLUEPRINT_NOT_FOUND", "该作品没有故事蓝图任务");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事蓝图已更新，请刷新后重试");
    }
    if (result === "not_cancellable") {
      throw new ApiError(400, "VALIDATION_INVALID", "故事蓝图当前不可取消");
    }
    await this.queue.cancel(result.jobId);
    return this.get(userId, workId, branchId);
  }

  async confirm(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintConfirmRequest,
    idempotencyKey: string | undefined,
    audit: BlueprintAuditContext,
  ): Promise<WorkBlueprint> {
    const result = await this.repository.confirm(
      userId,
      workId,
      branchId,
      input,
      idempotencyKey,
      audit,
    );
    if (result === "forbidden") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    if (result === "missing") {
      throw new ApiError(404, "BLUEPRINT_NOT_FOUND", "该作品没有故事蓝图任务");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "故事蓝图版本或 draft hash 已变化");
    }
    if (result === "not_reviewable") {
      throw new ApiError(400, "VALIDATION_INVALID", "故事蓝图当前不可确认");
    }
    if (result === "p0_conflict") {
      throw new ApiError(409, "BLUEPRINT_P0_CONFLICT", "仍有未解决的 P0 冲突");
    }
    if (result === "required_field_missing") {
      throw new ApiError(
        400,
        "BLUEPRINT_REQUIRED_FIELD_MISSING",
        "必填设定缺失且没有有效的 not_applicable 理由",
      );
    }
    if (result === "invalid_draft") {
      throw new ApiError(400, "VALIDATION_INVALID", "故事蓝图未通过服务端确认校验");
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
    const draft = blueprintDraftSchema.safeParse({
      storyBible: lookup.blueprint.storyBibleDraft,
      coreSettings: lookup.blueprint.coreSettingsDraft,
      outline: lookup.blueprint.outlineDraft,
    });
    const draftHash =
      lookup.blueprint.draftHash ??
      (draft.success
        ? blueprintDraftHash(
            draft.data,
            lookup.blueprint.acknowledgements.map((acknowledgement) =>
              blueprintAcknowledgementSchema.parse(acknowledgement),
            ),
          )
        : null);
    const missingFields = lookup.blueprint.missingFields.map((field) =>
      blueprintMissingFieldSchema.parse(field),
    );
    const conflicts = lookup.blueprint.conflicts.map((conflict) =>
      blueprintConflictSchema.parse(conflict),
    );
    const acknowledgements = lookup.blueprint.acknowledgements.map((acknowledgement) =>
      blueprintAcknowledgementSchema.parse(acknowledgement),
    );
    const confirmable = canConfirmBlueprint(
      lookup.blueprint.status,
      draft.success,
      missingFields,
      conflicts,
      acknowledgements,
    );
    return workBlueprintSchema.parse({
      id: lookup.blueprint.id,
      workId: lookup.blueprint.workId,
      branchId: lookup.blueprint.branchId,
      jobId: lookup.blueprint.jobId,
      status: lookup.blueprint.status,
      version: lookup.blueprint.version,
      progress: lookup.blueprint.progress,
      currentStep: lookup.blueprint.currentStep,
      budget: blueprintBudgetSchema.parse(lookup.job.budget),
      estimate: blueprintEstimateSchema.parse(lookup.blueprint.estimate),
      cost: blueprintCostSchema.parse(lookup.blueprint.cost),
      draftHash,
      storyBibleDraft: lookup.blueprint.storyBibleDraft
        ? blueprintStoryBibleDraftSchema.parse(lookup.blueprint.storyBibleDraft)
        : null,
      coreSettingsDraft: lookup.blueprint.coreSettingsDraft.map((candidate) =>
        blueprintCoreSettingDraftSchema.parse(candidate),
      ),
      outlineDraft: lookup.blueprint.outlineDraft
        ? blueprintOutlineDraftSchema.parse(lookup.blueprint.outlineDraft)
        : null,
      missingFields,
      conflicts,
      acknowledgements,
      allowedActions: allowedActions(
        blueprintStatusSchema.parse(lookup.blueprint.status),
        confirmable,
      ),
      confirmedAt: lookup.blueprint.confirmedAt?.toISOString() ?? null,
      confirmedBy: lookup.blueprint.confirmedBy,
      createdAt: lookup.blueprint.createdAt.toISOString(),
      updatedAt: lookup.blueprint.updatedAt.toISOString(),
    });
  }
}

function allowedActions(
  status: WorkBlueprint["status"],
  confirmable: boolean,
): WorkBlueprint["allowedActions"] {
  switch (status) {
    case "waiting_review":
      return confirmable ? ["edit", "confirm", "cancel"] : ["edit", "cancel"];
    case "budget_paused":
      return ["resume_budget", "cancel"];
    case "waiting_model_config":
      return ["retry", "cancel"];
    case "failed":
      return ["retry"];
    case "queued":
      return ["retry", "cancel"];
    case "running":
      return ["cancel"];
    case "confirmed":
    case "cancelled":
      return [];
  }
}

function canConfirmBlueprint(
  status: string,
  draftValid: boolean,
  missingFields: BlueprintMissingField[],
  conflicts: BlueprintConflict[],
  acknowledgements: BlueprintAcknowledgement[],
): boolean {
  if (status !== "waiting_review" || !draftValid) {
    return false;
  }
  if (conflicts.some((conflict) => conflict.severity === "P0" && conflict.status === "open")) {
    return false;
  }
  const acknowledged = new Set(acknowledgements.map((acknowledgement) => acknowledgement.fieldKey));
  return !missingFields.some(
    (field) =>
      field.required && (!field.key.startsWith("genre_pack:") || !acknowledged.has(field.key)),
  );
}

export function blueprintJobIdempotencyKey(workId: string, branchId: string): string {
  return `blueprint:${workId}:${branchId}`;
}
