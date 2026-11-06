import { Injectable } from "@nestjs/common";
import type {
  CriticAnnotation,
  CriticAnnotationPatchRequest,
  CriticVerifyRequest,
  QualityWorkspace,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { QualityRepository } from "./quality.repository";

@Injectable()
export class QualityService {
  constructor(private readonly repository: QualityRepository) {}

  async verify(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: CriticVerifyRequest,
    idempotencyKey: string,
    audit: WorksAuditContext,
  ): Promise<QualityWorkspace> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    const result = await this.repository.verify(
      userId,
      workId,
      branchId,
      chapterId,
      input,
      normalizedKey,
      audit,
    );
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    if (result.kind === "version_required") {
      throw new ApiError(409, "CRITIC_VERSION_REQUIRED", "请先保存正文版本，再检查连续性");
    }
    if (result.kind === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "章节正文已更新，请刷新后重新检查");
    }
    return result.workspace;
  }

  async workspace(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<QualityWorkspace> {
    const result = await this.repository.workspace(userId, workId, branchId, chapterId);
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return result.workspace;
  }

  async annotations(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<CriticAnnotation[]> {
    const result = await this.repository.annotations(userId, workId, branchId, chapterId);
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    return result.annotations;
  }

  async updateAnnotation(
    userId: string,
    workId: string,
    branchId: string,
    annotationId: string,
    input: CriticAnnotationPatchRequest,
    audit: WorksAuditContext,
  ): Promise<CriticAnnotation> {
    const result = await this.repository.updateAnnotation(
      userId,
      workId,
      branchId,
      annotationId,
      input,
      audit,
    );
    if (result.kind === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "批注不存在或无权访问");
    }
    if (result.kind === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "问题状态已变化，请刷新后重试");
    }
    if (result.kind === "not_dismissible") {
      throw new ApiError(
        409,
        "CRITIC_FINDING_NOT_DISMISSIBLE",
        "P0/P1 或结构性冲突不能忽略，请修订正文或另开创作线",
      );
    }
    if (result.kind === "invalid_state") {
      throw new ApiError(409, "VALIDATION_INVALID", "该问题当前状态不能执行此操作", {
        status: result.status,
      });
    }
    return result.annotation;
  }
}
