import { Injectable } from "@nestjs/common";
import {
  storyLedgerDeleteDataSchema,
  storyLedgerMutationDataSchema,
  storyLedgerWorkspaceSchema,
  type StoryLedgerDeleteData,
  type StoryLedgerEntry,
  type StoryLedgerEntryCreateRequest,
  type StoryLedgerEntryPatchRequest,
  type StoryLedgerMutationData,
  type StoryLedgerWorkspace,
} from "@novel-brain/contracts";
import {
  evaluateStoryLedger,
  nextStoryLedgerStatus,
  STORY_LEDGER_RULE_VERSION,
  type LedgerCheckEntry,
} from "@novel-brain/core";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { StoryLedgerRepository } from "./story-ledger.repository";
import type {
  StoryLedgerAuditContext,
  StoryLedgerMutationRecord,
  StoryLedgerWorkContext,
  StoryLedgerWriteResult,
} from "./story-ledger.repository";

@Injectable()
export class StoryLedgerService {
  constructor(private readonly repository: StoryLedgerRepository) {}

  async workspace(userId: string, workId: string, branchId: string): Promise<StoryLedgerWorkspace> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.buildWorkspace(userId, context);
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: StoryLedgerEntryCreateRequest,
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(await this.repository.create(userId, context, input, audit));
    return this.buildMutation(userId, context, record);
  }

  async patch(
    userId: string,
    workId: string,
    branchId: string,
    entryId: string,
    input: StoryLedgerEntryPatchRequest,
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const record = unwrap(await this.repository.patch(userId, context, entryId, input, audit));
    return this.buildMutation(userId, context, record);
  }

  async transition(
    userId: string,
    workId: string,
    branchId: string,
    entryId: string,
    input: {
      version: number;
      action: StoryLedgerEntry["history"][number]["action"];
      chapterId: string | null;
      eventId: string | null;
      reason: string;
      evidence: StoryLedgerEntry["evidence"];
      targetWindow?: { fromChapter: number; toChapter: number } | undefined;
    },
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerMutationData> {
    const context = await this.requireContext(userId, workId, branchId);
    const currentWorkspace = await this.repository.snapshot(userId, context);
    const entry = currentWorkspace.entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      throw tenantError();
    }
    if (entry.version !== input.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "账本条目已被其他操作更新，请刷新后重试");
    }
    let nextStatus: StoryLedgerEntry["status"];
    try {
      nextStatus = nextStoryLedgerStatus(entry.status, input.action);
    } catch {
      throw new ApiError(
        409,
        "LEDGER_TRANSITION_INVALID",
        `“${entry.title}”当前状态不能执行这个操作`,
      );
    }
    const record = unwrap(
      await this.repository.transition(
        userId,
        context,
        entryId,
        {
          version: input.version,
          action: input.action,
          nextStatus,
          chapterId: input.chapterId,
          eventId: input.eventId,
          reason: input.reason,
          evidence: input.evidence,
          targetWindow: input.targetWindow,
        },
        audit,
      ),
    );
    return this.buildMutation(userId, context, record);
  }

  async remove(
    userId: string,
    workId: string,
    branchId: string,
    entryId: string,
    version: number,
    reason: string,
    audit: StoryLedgerAuditContext,
  ): Promise<StoryLedgerDeleteData> {
    const context = await this.requireContext(userId, workId, branchId);
    const result = unwrap(
      await this.repository.remove(userId, context, entryId, version, reason, audit),
    );
    return storyLedgerDeleteDataSchema.parse({
      workspace: await this.buildWorkspace(userId, context),
      entryId: result.entryId,
      versionNodeId: result.versionNodeId,
      auditId: result.auditId,
    });
  }

  private async buildMutation(
    userId: string,
    context: StoryLedgerWorkContext,
    record: StoryLedgerMutationRecord,
  ): Promise<StoryLedgerMutationData> {
    return storyLedgerMutationDataSchema.parse({
      workspace: await this.buildWorkspace(userId, context),
      entry: record.entry,
      versionNodeId: record.versionNodeId,
      auditId: record.auditId,
    });
  }

  private async buildWorkspace(
    userId: string,
    context: StoryLedgerWorkContext,
  ): Promise<StoryLedgerWorkspace> {
    const snapshot = await this.repository.snapshot(userId, context);
    const findings = evaluateStoryLedger({
      entries: snapshot.entries.map(toCheckEntry),
      writtenThroughChapter: snapshot.writtenThroughChapter,
    });
    const openStatuses = new Set(["planned", "planted", "progressed", "deferred"]);
    return storyLedgerWorkspaceSchema.parse({
      ruleVersion: STORY_LEDGER_RULE_VERSION,
      workId: context.workId,
      branchId: context.branchId,
      writtenThroughChapter: snapshot.writtenThroughChapter,
      entries: snapshot.entries,
      findings,
      summary: {
        total: snapshot.entries.length,
        open: snapshot.entries.filter((entry) => openStatuses.has(entry.status)).length,
        overdue: findings.filter((finding) => finding.code === "LEDGER_OVERDUE").length,
        mustPayoff: snapshot.entries.filter(
          (entry) => entry.kind === "foreshadow" && entry.importance === "must",
        ).length,
        paidOff: snapshot.entries.filter((entry) => entry.status === "paid_off").length,
        abandoned: snapshot.entries.filter((entry) => entry.status === "abandoned").length,
        weakPayoff: findings.filter((finding) => finding.code === "LEDGER_WEAK_PAYOFF").length,
      },
    });
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<StoryLedgerWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw tenantError();
    }
    return context;
  }
}

function toCheckEntry(entry: StoryLedgerEntry): LedgerCheckEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary,
    status: entry.status,
    sourceChapterNumber: entry.sourceChapter?.number ?? null,
    targetWindow: entry.targetWindow,
    prerequisiteEvents: entry.prerequisiteEvents.map((event) => ({
      eventId: event.eventId,
      chapterNumber: event.chapterNumber,
      validFromChapter: event.validFromChapter,
      validToChapter: event.validToChapter,
    })),
    history: entry.history.map((event) => ({
      action: event.action,
      chapterNumber: event.chapter?.number ?? null,
      eventId: event.event?.eventId ?? null,
      reason: event.reason,
      evidence: event.evidence.map((evidence) => ({ strength: evidence.strength })),
    })),
  };
}

function unwrap<T>(result: StoryLedgerWriteResult<T>): T {
  if (result.kind === "ok") {
    return result.value;
  }
  switch (result.kind) {
    case "not_found":
      throw tenantError();
    case "version_conflict":
      throw new ApiError(409, "VERSION_CONFLICT", "账本条目已被其他操作更新，请刷新后重试");
    case "source_required":
      throw new ApiError(400, "LEDGER_SOURCE_REQUIRED", "请选择来源章节或事件");
    case "reference_invalid":
      throw new ApiError(400, "LEDGER_REFERENCE_INVALID", result.message);
    case "kind_mismatch":
      throw new ApiError(400, "LEDGER_REFERENCE_INVALID", "账本条目类型不匹配");
  }
}

function tenantError(): ApiError {
  return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "账本条目不存在或无权访问");
}
