import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  jobEventSchema,
  type JobEvent,
  type JobRecoveryRecord,
  type JobRecoveryRequest,
  type WritingActionJob,
  type WritingActionRequest,
} from "@novel-brain/contracts";
import { Observable } from "rxjs";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class references for dependency injection metadata.
/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  WritingActionRecoveryBudgetInvalidError,
  WritingActionNotRecoverableError,
  WritingActionRecoveryConflictError,
  WritingActionRepository,
  toWriteActionWorkerJob,
  toWritingActionJobContract,
  type WritingActionAuditContext,
  type WritingActionBranchContext,
  type WritingActionWorkContext,
} from "./writing-action.repository";
import { WritingActionQueue } from "./writing-action.queue";
/* eslint-enable @typescript-eslint/consistent-type-imports */

@Injectable()
export class WritingActionService {
  constructor(
    private readonly repository: WritingActionRepository,
    private readonly queue: WritingActionQueue,
  ) {}

  async start(
    userId: string,
    context: WritingActionWorkContext,
    idempotencyKey: string,
    request: WritingActionRequest,
    audit: WritingActionAuditContext,
    options: { allowTargetedRevision?: boolean } = {},
  ): Promise<WritingActionJob> {
    if (request.action === "targeted_revision" && !options.allowTargetedRevision) {
      throw new ApiError(
        409,
        "WRITING_ACTION_SELECTION_INVALID",
        "定向修订必须从修订计划启动，不能绕过轮次和反馈约束",
      );
    }
    const normalizedKey = idempotencyKey.trim();
    if (!normalizedKey || normalizedKey.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的幂等键");
    }
    const existing = await this.repository.findByIdempotencyKey(userId, context, normalizedKey);
    if (existing) {
      return toWritingActionJobContract(existing);
    }
    const creation = await this.repository.loadCreationContext(
      userId,
      context,
      request.sourceVersionId,
    );
    if (creation === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "章节不存在或无权访问");
    }
    if (creation === "not_editable") {
      throw new ApiError(409, "WRITING_ACTION_NOT_EDITABLE", "当前章节状态不能执行写作动作");
    }
    if (creation === "source_invalid") {
      throw new ApiError(
        409,
        "WRITING_ACTION_SOURCE_VERSION_INVALID",
        "源版本已变化，请刷新版本后重试",
      );
    }
    if (creation === "branch_stale") {
      throw new ApiError(409, "JOB_CONTEXT_BRANCH_STALE", "当前分支已归档，不能继续写作");
    }
    if (creation === "model_missing") {
      throw new ApiError(400, "BIBLE_NOT_READY", "请先配置用于正文写作的模型");
    }
    if (!creation.sourceVersion.content.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "请先在章节中写入正文");
    }
    if (
      request.action === "selection_rewrite" &&
      request.selection.end > creation.sourceVersion.content.length
    ) {
      throw new ApiError(400, "WRITING_ACTION_SELECTION_INVALID", "选中范围已超出当前版本正文");
    }

    const result = await this.repository.createQueuedJob({
      userId,
      context,
      modelConfigId: creation.modelConfigId,
      sourceVersionId: request.sourceVersionId,
      idempotencyKey: normalizedKey,
      request,
      audit,
    });
    if (result.created) {
      await this.queue.enqueue(toWriteActionWorkerJob(result.value));
    }
    return toWritingActionJobContract(result.value);
  }

  async list(
    userId: string,
    context: WritingActionWorkContext,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<{ jobs: WritingActionJob[]; nextCursor: string | null }> {
    const result = await this.repository.list(userId, context, page);
    return {
      jobs: result.jobs.map(toWritingActionJobContract),
      nextCursor: result.nextCursor,
    };
  }

  async get(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
  ): Promise<WritingActionJob> {
    const record = await this.repository.get(userId, context, jobId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "写作动作不存在或无权访问");
    }
    return toWritingActionJobContract(record);
  }

  async cancel(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
  ): Promise<WritingActionJob> {
    const record = await this.repository.cancel(userId, context, jobId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "写作动作不存在或无权访问");
    }
    return toWritingActionJobContract(record);
  }

  async retry(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
    audit: WritingActionAuditContext,
  ): Promise<WritingActionJob> {
    return (
      await this.recover(
        userId,
        context,
        jobId,
        {
          reason: "作者手动重试写作动作",
          idempotencyKey: `write-action-retry:${jobId}:${randomUUID()}`,
        },
        audit,
      )
    ).job;
  }

  async recover(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
    request: JobRecoveryRequest,
    audit: WritingActionAuditContext,
  ): Promise<{ job: WritingActionJob; recovery: JobRecoveryRecord }> {
    try {
      const result = await this.repository.recover({
        userId,
        context,
        jobId,
        request,
        audit,
      });
      if (!result) {
        throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "写作动作不存在或无权访问");
      }
      if (result.job.job.status === "queued") {
        await this.queue.enqueue(toWriteActionWorkerJob(result.job));
      }
      return {
        job: toWritingActionJobContract(result.job),
        recovery: result.recovery,
      };
    } catch (error) {
      if (error instanceof WritingActionRecoveryConflictError) {
        throw new ApiError(409, "JOB_RECOVERY_CONFLICT", "写作动作检查点已更新，请刷新后重试");
      }
      if (error instanceof WritingActionRecoveryBudgetInvalidError) {
        throw new ApiError(409, "JOB_RECOVERY_BUDGET_INVALID", error.message);
      }
      if (error instanceof WritingActionNotRecoverableError) {
        throw new ApiError(409, "JOB_NOT_RECOVERABLE", "当前状态不能执行写作动作恢复");
      }
      throw error;
    }
  }

  streamEvents(
    userId: string,
    context: WritingActionBranchContext,
    jobId: string,
    lastEventId?: string,
  ): Observable<JobEvent> {
    return new Observable<JobEvent>((subscriber) => {
      let active = true;
      let cursor = lastEventId;
      void (async () => {
        while (active) {
          const record = await this.repository.get(userId, context, jobId);
          if (!record) {
            throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "写作动作不存在或无权访问");
          }
          const events = await this.repository.listEvents(userId, context, jobId, cursor);
          for (const event of events) {
            cursor = event.eventId;
            subscriber.next(jobEventSchema.parse(event));
          }
          if (isTerminal(record.job.status) && events.length === 0) {
            subscriber.complete();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      })().catch((error: unknown) => subscriber.error(error));
      return () => {
        active = false;
      };
    });
  }
}

function isTerminal(status: string): boolean {
  return ["completed", "waiting_review", "paused", "failed", "cancelled"].includes(status);
}
