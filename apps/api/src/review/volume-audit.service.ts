import { Injectable } from "@nestjs/common";
import type {
  VolumeAuditReport,
  VolumeAuditRunRequest,
  VolumeAuditSignoffRequest,
  VolumeAuditWorkspace,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import type { WorksAuditContext } from "../works/works.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { VolumeAuditRepository } from "./volume-audit.repository";

@Injectable()
export class VolumeAuditService {
  constructor(private readonly repository: VolumeAuditRepository) {}

  async workspace(userId: string, workId: string, branchId: string): Promise<VolumeAuditWorkspace> {
    const result = await this.repository.workspace(userId, workId, branchId);
    if (result.kind === "not_found") {
      throw tenantError();
    }
    return result.workspace;
  }

  async run(
    userId: string,
    workId: string,
    branchId: string,
    input: VolumeAuditRunRequest,
    audit: WorksAuditContext,
  ): Promise<VolumeAuditReport> {
    const result = await this.repository.run(userId, workId, branchId, input.volumeNodeId, audit);
    switch (result.kind) {
      case "not_found":
        throw tenantError();
      case "volume_not_found":
        throw new ApiError(404, "VOLUME_AUDIT_VOLUME_NOT_FOUND", "卷节点不存在或不属于当前作品");
      case "empty_volume":
        throw new ApiError(400, "VALIDATION_INVALID", "该卷还没有可审计的章节");
      case "ok":
        return result.report;
    }
  }

  async signoff(
    userId: string,
    workId: string,
    branchId: string,
    auditId: string,
    input: VolumeAuditSignoffRequest,
    audit: WorksAuditContext,
  ): Promise<VolumeAuditReport> {
    const result = await this.repository.signoff(userId, workId, branchId, auditId, input, audit);
    switch (result.kind) {
      case "not_found":
        throw tenantError();
      case "version_conflict":
        throw new ApiError(409, "VERSION_CONFLICT", "卷末审计报告已更新，请刷新后重试");
      case "stale":
        throw new ApiError(409, "VOLUME_AUDIT_STALE", "章节正文已变化，请重新运行卷末审计");
      case "blocked":
        throw new ApiError(409, "VOLUME_AUDIT_BLOCKED", "仍有阻断项，不能签收通过");
      case "golden_three_required":
        throw new ApiError(
          409,
          "GOLDEN_THREE_LOCK_REQUIRED",
          "先完成黄金三章作者确认与锁定，再签收卷末审计",
        );
      case "ok":
        return result.report;
    }
  }
}

function tenantError(): ApiError {
  return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "卷末审计不存在或无权访问");
}
