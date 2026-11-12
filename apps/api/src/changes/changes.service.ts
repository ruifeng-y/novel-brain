import { Injectable } from "@nestjs/common";
import type {
  BranchCreateRequest,
  ChangeApplyRequest,
  ChangeRequestCreateRequest,
  ChangeRequestListQuery,
  MergeApplyRequest,
  MergeItemDecisionRequest,
  VersionRollbackRequest,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import { invalidCursorError } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ChangesRepository, type ChangesAuditContext } from "./changes.repository";

@Injectable()
export class ChangesService {
  constructor(private readonly repository: ChangesRepository) {}

  async list(userId: string, workId: string, branchId: string, query: ChangeRequestListQuery) {
    const result = await this.repository.list(userId, workId, branchId, query);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    return result;
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: ChangeRequestCreateRequest,
    idempotencyKey: string,
    audit: ChangesAuditContext,
  ) {
    if (!idempotencyKey.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "创建修改请求需要 Idempotency-Key");
    }
    const result = await this.repository.create(
      userId,
      workId,
      branchId,
      input,
      idempotencyKey.trim(),
      audit,
    );
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    if (result === "idempotency_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "同一 Idempotency-Key 不能用于不同修改请求");
    }
    if (result === "target_not_found") {
      throw new ApiError(404, "CHANGE_TARGET_NOT_FOUND", "修改目标不存在或已删除");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "修改目标版本已变化，请刷新后重试");
    }
    if (result === "invalid_object_type") {
      throw new ApiError(400, "VALIDATION_INVALID", "对象类型与修改目标类型不一致");
    }
    return result;
  }

  async analyze(userId: string, workId: string, branchId: string, changeId: string) {
    const result = await this.repository.analyze(userId, workId, branchId, changeId);
    if (result === "not_found") {
      throw new ApiError(404, "CHANGE_NOT_FOUND", "修改请求不存在或无权访问");
    }
    return result;
  }

  async apply(
    userId: string,
    workId: string,
    branchId: string,
    changeId: string,
    input: ChangeApplyRequest,
    audit: ChangesAuditContext,
  ) {
    const result = await this.repository.apply(userId, workId, branchId, changeId, input, audit);
    if (result === "not_found") {
      throw new ApiError(404, "CHANGE_NOT_FOUND", "修改请求不存在或无权访问");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "修改请求已变化，请刷新后重试");
    }
    if (result === "invalid_state") {
      throw new ApiError(409, "CHANGE_INVALID_STATE", "修改请求当前状态不允许应用");
    }
    if (result === "target_not_found") {
      throw new ApiError(404, "CHANGE_TARGET_NOT_FOUND", "修改目标不存在或已删除");
    }
    if (result === "analysis_required") {
      throw new ApiError(409, "CHANGE_ANALYSIS_REQUIRED", "应用修改前必须先完成影响分析");
    }
    if (result === "fact_gate_required") {
      throw new ApiError(409, "FACT_DECISION_REQUIRED", "事实修改必须经过事实决策与故事事实提交");
    }
    if (result === "high_risk_confirmation_required") {
      throw new ApiError(409, "CHANGE_HIGH_RISK_CONFIRMATION_REQUIRED", "高风险修改需要二次确认");
    }
    return result;
  }

  async rollback(
    userId: string,
    workId: string,
    branchId: string,
    input: VersionRollbackRequest,
    audit: ChangesAuditContext,
  ) {
    const result = await this.repository.rollback(userId, workId, branchId, input, audit);
    if (result === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，或无权访问");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "当前版本已变化，请刷新后重试");
    }
    if (result === "target_not_found") {
      throw new ApiError(404, "VERSION_NODE_NOT_FOUND", "目标版本不存在或不可回滚");
    }
    if (result === "canon_gate_required") {
      throw new ApiError(409, "FACT_DECISION_REQUIRED", "事实回滚必须经过正史提交门禁");
    }
    return result;
  }

  async createBranch(
    userId: string,
    workId: string,
    input: BranchCreateRequest,
    audit: ChangesAuditContext,
  ) {
    const result = await this.repository.createBranch(userId, workId, input, audit);
    if (result === "not_found") {
      throw new ApiError(404, "BRANCH_SOURCE_NOT_FOUND", "来源版本点不存在或无权访问");
    }
    if (result === "name_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "平行版本名称已存在");
    }
    return result;
  }

  async compare(userId: string, workId: string, targetBranchId: string, sourceBranchId: string) {
    const result = await this.repository.compare(userId, workId, targetBranchId, sourceBranchId);
    if (result === "not_found") {
      throw new ApiError(404, "BRANCH_SOURCE_NOT_FOUND", "分支不存在或无权访问");
    }
    return result;
  }

  async decide(
    userId: string,
    workId: string,
    itemId: string,
    input: MergeItemDecisionRequest,
    audit: ChangesAuditContext,
  ) {
    const result = await this.repository.decide(userId, workId, itemId, input, audit);
    if (result === "not_found") {
      throw new ApiError(404, "CHANGE_NOT_FOUND", "比较项不存在或无权访问");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "比较项已变化，请刷新后重试");
    }
    return result;
  }

  async applyMerge(
    userId: string,
    workId: string,
    targetBranchId: string,
    input: MergeApplyRequest,
    audit: ChangesAuditContext,
  ) {
    const result = await this.repository.applyMerge(userId, workId, targetBranchId, input, audit);
    if (result === "not_found") {
      throw new ApiError(404, "BRANCH_SOURCE_NOT_FOUND", "目标分支不存在或无权访问");
    }
    if (result === "invalid_selection") {
      throw new ApiError(409, "VERSION_CONFLICT", "只能应用已接受且未过期的比较项");
    }
    if (result === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "目标分支已变化，请重新比较后再摘取");
    }
    if (result === "target_not_found") {
      throw new ApiError(404, "CHANGE_TARGET_NOT_FOUND", "目标对象不存在或已删除");
    }
    if (result === "canon_gate_required") {
      throw new ApiError(409, "FACT_DECISION_REQUIRED", "事实摘取不能绕过正史提交门禁");
    }
    if (result === "high_risk_confirmation_required") {
      throw new ApiError(409, "CHANGE_HIGH_RISK_CONFIRMATION_REQUIRED", "高风险摘取需要二次确认");
    }
    return result;
  }
}
