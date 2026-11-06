import { Injectable } from "@nestjs/common";
import type {
  StyleDriftCheckRequest,
  StyleDriftReport,
  StyleDriftWorkspace,
  StyleProfile,
  StyleProfileApproveRequest,
  StyleProfileCreateRequest,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StyleRepository, type StyleWorkContext, type StyleWriteResult } from "./style.repository";

@Injectable()
export class StyleService {
  constructor(private readonly repository: StyleRepository) {}

  async workspace(userId: string, workId: string, branchId: string): Promise<StyleDriftWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.repository.workspace(userId, context);
  }

  async createProfile(
    userId: string,
    workId: string,
    branchId: string,
    input: StyleProfileCreateRequest,
    audit: WorksAuditContext,
  ): Promise<StyleProfile> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.createProfile(userId, context, input, audit);
    if (result.kind !== "ok") {
      throw styleWriteError(result);
    }
    return result.value;
  }

  async approveProfile(
    userId: string,
    workId: string,
    branchId: string,
    profileId: string,
    input: StyleProfileApproveRequest,
    audit: WorksAuditContext,
  ): Promise<StyleProfile> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.approveProfile(userId, context, profileId, input, audit);
    if (result.kind !== "ok") {
      throw styleWriteError(result);
    }
    return result.value;
  }

  async checkDrift(
    userId: string,
    workId: string,
    branchId: string,
    input: StyleDriftCheckRequest,
    audit: WorksAuditContext,
  ): Promise<StyleDriftReport> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.checkDrift(userId, context, input, audit);
    if (result.kind !== "ok") {
      throw styleWriteError(result);
    }
    return result.value;
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StyleWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }
}

function styleWriteError(result: Exclude<StyleWriteResult<unknown>, { kind: "ok" }>): ApiError {
  switch (result.kind) {
    case "not_found":
      return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "声线基线不存在或无权访问");
    case "source_not_approved":
      return new ApiError(
        409,
        "STYLE_SOURCE_NOT_APPROVED",
        "来源尚未获得作者批准，不能直接作为权威风格基线",
      );
    case "baseline_unapproved":
      return new ApiError(
        409,
        "STYLE_BASELINE_UNAPPROVED",
        "当前声线基线尚未批准，请先由作者确认样本",
      );
    case "baseline_required":
      return new ApiError(409, "STYLE_BASELINE_REQUIRED", "请先建立并批准一条声线或风格基线");
    case "version_conflict":
      return new ApiError(409, "VERSION_CONFLICT", "基线版本已变化，请刷新后重试");
    case "invalid_state":
      return new ApiError(409, "VALIDATION_INVALID", "该基线当前状态不能执行此操作", {
        status: result.status,
      });
    case "reference_invalid":
      return new ApiError(400, "STYLE_REFERENCE_INVALID", result.message);
    case "chapter_version_required":
      return new ApiError(409, "CHAPTER_VERSION_REQUIRED", "本章还没有可检查的正文版本");
    case "no_chapters":
      return new ApiError(400, "STYLE_RANGE_EMPTY", "指定区间内没有可检查的章节");
  }
}
