import { Injectable } from "@nestjs/common";
import {
  EXPORT_WORK_JOB,
  type ExportWorkJob,
  type WorkExportReceipt,
  type WorkExportRequest,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class references for dependency injection metadata.
/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  WorkExportRepository,
  WorkExportSourceInvalidError,
  type ExportAuditContext,
} from "./work-export.repository";
import { WorkExportQueue } from "./work-export.queue";
/* eslint-enable @typescript-eslint/consistent-type-imports */

export interface WorkExportContext {
  workId: string;
  branchId: string;
}

@Injectable()
export class WorkExportService {
  constructor(
    private readonly repository: WorkExportRepository,
    private readonly queue: WorkExportQueue,
  ) {}

  async start(
    userId: string,
    context: WorkExportContext,
    idempotencyKey: string,
    request: WorkExportRequest,
    audit: ExportAuditContext,
  ): Promise<WorkExportReceipt> {
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    const existing = await this.repository.findByIdempotencyKey(userId, context, normalizedKey);
    if (existing) {
      if (existing.status === "queued") {
        await this.queue.enqueue(toWorkerJob(userId, normalizedKey, existing));
      }
      return existing;
    }
    try {
      const result = await this.repository.createQueuedExport({
        userId,
        context,
        idempotencyKey: normalizedKey,
        request,
        audit,
      });
      if (result.created) {
        await this.queue.enqueue(toWorkerJob(userId, normalizedKey, result.receipt));
      } else if (result.receipt.status === "queued") {
        await this.queue.enqueue(toWorkerJob(userId, normalizedKey, result.receipt));
      }
      return result.receipt;
    } catch (error) {
      if (error instanceof WorkExportSourceInvalidError) {
        throw new ApiError(400, "WORK_EXPORT_SOURCE_INVALID", error.message);
      }
      throw error;
    }
  }

  list(
    userId: string,
    context: WorkExportContext,
    page: { cursor?: string | undefined; limit: number },
  ) {
    return this.repository.list(userId, context, page);
  }

  async get(
    userId: string,
    context: WorkExportContext,
    exportId: string,
  ): Promise<WorkExportReceipt> {
    const receipt = await this.repository.get(userId, context, exportId);
    if (!receipt) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导出记录不存在或无权访问");
    }
    return receipt;
  }

  async download(userId: string, context: WorkExportContext, exportId: string) {
    const download = await this.repository.download(userId, context, exportId);
    if (download === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导出记录不存在或无权访问");
    }
    if (download === "not_ready") {
      throw new ApiError(409, "WORK_EXPORT_NOT_READY", "导出文件尚未生成完成");
    }
    if (download === "expired") {
      throw new ApiError(410, "WORK_EXPORT_EXPIRED", "导出文件已过期，请重新导出");
    }
    return download;
  }
}

function toWorkerJob(
  userId: string,
  idempotencyKey: string,
  receipt: WorkExportReceipt,
): ExportWorkJob {
  return {
    jobId: receipt.jobId,
    jobType: EXPORT_WORK_JOB,
    workId: receipt.workId,
    branchId: receipt.branchId,
    actorId: userId,
    idempotencyKey,
    exportId: receipt.id,
    checkpoint: {
      schemaVersion: 1,
      revision: 0,
      step: "prepare",
      inputHash: null,
      outputRefs: [],
      payload: {},
    },
  };
}
