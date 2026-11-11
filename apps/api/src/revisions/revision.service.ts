import { Injectable } from "@nestjs/common";
import {
  targetedRevisionWritingActionSchema,
  type RevisionFeedbackCreateRequest,
  type RevisionPlanCreateRequest,
  type RevisionPlanWorkspace,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import { invalidCursorError } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WritingActionService } from "../writing-actions/writing-action.service";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  RevisionRepository,
  type RevisionAuditContext,
  type RevisionBranchContext,
  type RevisionContext,
  type RevisionCreationResult,
  type RevisionRoundCreationResult,
} from "./revision.repository";

@Injectable()
export class RevisionService {
  constructor(
    private readonly repository: RevisionRepository,
    private readonly writingActions: WritingActionService,
  ) {}

  async createPlan(
    userId: string,
    context: RevisionContext,
    idempotencyKey: string,
    input: RevisionPlanCreateRequest,
    audit: RevisionAuditContext,
  ): Promise<RevisionPlanWorkspace> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    const creation = await this.repository.createPlan(userId, context, normalizedKey, input, audit);
    this.requireCreation(creation);
    if (!creation.hasJob) {
      await this.startRound(userId, context, creation, audit);
    }
    return this.requireWorkspace(await this.repository.getPlan(userId, context, creation.planId));
  }

  async addRound(
    userId: string,
    context: RevisionContext,
    planId: string,
    input: RevisionPlanCreateRequest,
    audit: RevisionAuditContext,
  ): Promise<RevisionPlanWorkspace> {
    const creation = await this.repository.addRound(userId, context, planId, input, audit);
    this.requireRoundCreation(creation);
    await this.startRound(userId, context, creation, audit);
    return this.requireWorkspace(await this.repository.getPlan(userId, context, planId));
  }

  async feedback(
    userId: string,
    context: RevisionContext,
    planId: string,
    roundId: string,
    input: RevisionFeedbackCreateRequest,
    audit: RevisionAuditContext,
  ): Promise<RevisionPlanWorkspace> {
    const result = await this.repository.feedback(userId, context, planId, roundId, input, audit);
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "修订轮次不存在或无权访问");
    }
    if (result.kind === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "修订轮次已变化，请刷新后重试");
    }
    if (result.kind === "invalid_state") {
      throw new ApiError(409, "REVISION_INVALID_STATE", "该修订轮次当前不能记录反馈", {
        status: result.status,
      });
    }
    if (result.kind === "finding_invalid") {
      throw new ApiError(409, "REVISION_FINDING_INVALID", "该问题不属于本修订轮次");
    }
    return this.requireWorkspace(await this.repository.getPlan(userId, context, planId));
  }

  async get(
    userId: string,
    context: RevisionBranchContext,
    planId: string,
  ): Promise<RevisionPlanWorkspace> {
    return this.requireWorkspace(await this.repository.getPlan(userId, context, planId));
  }

  async list(
    userId: string,
    context: RevisionContext,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<{ plans: RevisionPlanWorkspace[]; nextCursor: string | null }> {
    const result = await this.repository.listPlans(userId, context, page);
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    return result;
  }

  private async startRound(
    userId: string,
    context: RevisionContext,
    creation: Extract<RevisionCreationResult, { kind: "ok" }>,
    audit: RevisionAuditContext,
  ): Promise<void> {
    const request = targetedRevisionWritingActionSchema.parse({
      action: "targeted_revision",
      sourceVersionId: creation.sourceVersionId,
      findingIds: creation.selectedFindingIds,
      blocks: creation.blocks,
      constraints: creation.constraints,
      budget: creation.budget,
    });
    try {
      const job = await this.writingActions.start(
        userId,
        context,
        `revision:${creation.planId}:${creation.roundNumber}`,
        request,
        audit,
        { allowTargetedRevision: true },
      );
      await this.repository.attachJob(
        userId,
        context,
        creation.planId,
        creation.roundId,
        job.id,
        audit,
      );
    } catch (error) {
      await this.repository.markRoundFailed(userId, creation.planId, creation.roundId);
      throw error;
    }
  }

  private requireCreation(
    result: RevisionCreationResult,
  ): asserts result is Extract<RevisionCreationResult, { kind: "ok" }> {
    if (result.kind === "ok") {
      return;
    }
    this.throwCreationError(result);
  }

  private requireRoundCreation(
    result: RevisionRoundCreationResult,
  ): asserts result is Extract<RevisionRoundCreationResult, { kind: "ok" }> {
    if (result.kind === "ok") {
      return;
    }
    if (result.kind === "round_limit") {
      throw new ApiError(409, "REVISION_ROUND_LIMIT_REACHED", "本轮修订已达到轮次上限");
    }
    if (result.kind === "budget_exhausted") {
      throw new ApiError(409, "JOB_BUDGET_EXCEEDED", "修订预算已用完，不能再开始下一轮");
    }
    if (result.kind === "invalid_state") {
      throw new ApiError(409, "REVISION_INVALID_STATE", "当前修订轮次不能继续改写", {
        status: result.status,
      });
    }
    this.throwCreationError(result);
  }

  private throwCreationError(
    result: Exclude<
      RevisionCreationResult | RevisionRoundCreationResult,
      | { kind: "ok" }
      | { kind: "round_limit" }
      | { kind: "budget_exhausted" }
      | { kind: "invalid_state" }
    >,
  ): never {
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节或修订计划不存在或无权访问");
    }
    if (result.kind === "not_editable") {
      throw new ApiError(409, "REVISION_NOT_EDITABLE", "已批准或锁定的章节不能直接修订");
    }
    if (result.kind === "source_invalid") {
      throw new ApiError(409, "REVISION_SOURCE_INVALID", "源版本已变化，请刷新后重试");
    }
    if (result.kind === "branch_stale") {
      throw new ApiError(409, "JOB_CONTEXT_BRANCH_STALE", "当前分支已归档，不能继续写作");
    }
    if (result.kind === "finding_high_risk") {
      throw new ApiError(
        409,
        "REVISION_FINDING_HIGH_RISK",
        "P0/P1 或结构性问题不能进入低中风险定向修订",
      );
    }
    if (result.kind === "finding_invalid") {
      throw new ApiError(409, "REVISION_FINDING_INVALID", "所选问题不属于当前章节或已失效");
    }
    if (result.kind === "finding_rejected") {
      throw new ApiError(409, "REVISION_FINDING_REJECTED", "已拒绝的修订建议不能再次选择");
    }
    throw new ApiError(400, "VALIDATION_INVALID", "所选正文块为空或超出当前版本");
  }

  private requireWorkspace(workspace: RevisionPlanWorkspace | undefined): RevisionPlanWorkspace {
    if (!workspace) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "修订计划不存在或无权访问");
    }
    return workspace;
  }
}
