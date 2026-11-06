import { Injectable } from "@nestjs/common";
import {
  SUMMARY_COMPILER_VERSION,
  SUMMARY_INVALIDATION_RULE_VERSION,
  SUMMARY_MODEL_VERSION,
} from "@novel-brain/core";
import type {
  SummaryRebuildRequest,
  SummaryRebuildRun,
  SummaryWorkspace,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SummaryRebuildQueue } from "./summaries.queue";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  SummariesRepository,
  toSummaryRebuildRun,
  toSummaryRecord,
  type SummaryAuditContext,
} from "./summaries.repository";

@Injectable()
export class SummariesService {
  constructor(
    private readonly repository: SummariesRepository,
    private readonly queue: SummaryRebuildQueue,
  ) {}

  async workspace(userId: string, workId: string, branchId: string): Promise<SummaryWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    const [summaries, rebuilds] = await Promise.all([
      this.repository.listSummaries(userId, context),
      this.repository.listRebuilds(userId, context),
    ]);
    const records = summaries.map(toSummaryRecord);
    return {
      workId,
      branchId,
      invalidationRuleVersion: SUMMARY_INVALIDATION_RULE_VERSION,
      summaries: records,
      rebuilds: rebuilds.map(toSummaryRebuildRun),
      stats: {
        total: records.length,
        fresh: records.filter((summary) => summary.status === "fresh").length,
        stale: records.filter((summary) => summary.status === "stale").length,
        rebuilding: records.filter((summary) => summary.status === "rebuilding").length,
      },
    };
  }

  async rebuild(
    userId: string,
    workId: string,
    branchId: string,
    request: SummaryRebuildRequest,
    idempotencyKey: string,
    audit: SummaryAuditContext,
  ): Promise<SummaryRebuildRun> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = await this.repository.createRebuild({
      userId,
      context,
      request,
      idempotencyKey,
      compilerVersion: SUMMARY_COMPILER_VERSION,
      modelVersion: SUMMARY_MODEL_VERSION,
      audit,
    });
    if (
      result.created ||
      (result.run.status !== "completed" && result.run.status !== "cancelled")
    ) {
      await this.queue.enqueue({
        jobType: "rebuild_summaries",
        runId: result.run.id,
        workId: result.run.workId,
        branchId: result.run.branchId,
        actorId: result.run.userId,
        idempotencyKey: result.run.idempotencyKey,
      });
    }
    return toSummaryRebuildRun(result.run);
  }

  async rebuildRun(
    userId: string,
    workId: string,
    branchId: string,
    runId: string,
  ): Promise<SummaryRebuildRun> {
    const context = await this.requireContext(userId, workId, branchId);
    const run = await this.repository.findRebuild(userId, context, runId);
    if (!run) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "摘要重建任务不存在或无权访问");
    }
    return toSummaryRebuildRun(run);
  }

  private async requireContext(userId: string, workId: string, branchId: string) {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }
}
