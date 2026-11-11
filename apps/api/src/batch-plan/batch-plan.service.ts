import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  batchPlanActionRequestSchema,
  batchPlanCreateRequestSchema,
  type BatchPlanCreateRequest,
  type BatchPlanScope,
  type BatchPlanSummary,
  type BatchCostReport,
  type BatchCostReportGroupBy,
  type BatchWorkItem,
} from "@novel-brain/contracts";
import {
  BatchPlanValidationError,
  buildBatchPlan,
  deterministicUuidV7,
  type BatchPlanChapterInput,
  type BatchPlanVolumeInput,
} from "@novel-brain/core";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import {
  BatchPlanRepository,
  BatchPlanRepositoryError,
  type BatchPlanContext,
  type BatchPlanAuditContext,
  type BatchPlanControlAction,
  type BatchPlanItemFilters,
  type BatchPlanItemPage,
  type BatchPlanSources,
  type ChapterSource,
  type OutlineNodeSource,
} from "./batch-plan.repository";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { BatchPlanQueue } from "./batch-plan.queue";

export interface BatchPlanListQuery {
  type?: BatchWorkItem["type"];
  status?: BatchWorkItem["status"];
  cursor?: string;
  limit: number;
}

@Injectable()
export class BatchPlanService {
  constructor(
    private readonly repository: BatchPlanRepository,
    private readonly queue: BatchPlanQueue,
  ) {}

  async create(
    userId: string,
    context: BatchPlanContext,
    idempotencyKey: string,
    body: unknown,
  ): Promise<{ summary: BatchPlanSummary; replayed: boolean }> {
    const key = idempotencyKey.trim();
    if (!key) {
      throw new ApiError(400, "VALIDATION_INVALID", "批量计划需要 Idempotency-Key");
    }
    if (key.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "Idempotency-Key 不能超过 200 个字符");
    }
    const request = batchPlanCreateRequestSchema.parse(body);
    const requestHash = hashRequest(request);
    try {
      const workContext = await this.repository.findWorkContext(
        userId,
        context.workId,
        context.branchId,
      );
      if (!workContext) {
        throw new ApiError(404, "BATCH_PLAN_NOT_FOUND", "作品或分支不存在或无权访问");
      }
      return await this.repository.createPlan({
        userId,
        context: workContext,
        idempotencyKey: key,
        requestHash,
        build: (sources) => {
          const selection = selectPlanSources(
            request.scope,
            sources,
            workContext.chapterLengthTarget,
          );
          const planId = deterministicUuidV7(
            `batch-plan:${userId}:${context.workId}:${context.branchId}:${key}`,
          );
          const built = buildBatchPlan({
            planId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            scope: request.scope,
            approvalMode: request.approvalMode,
            priorityClass: request.priorityClass,
            maxConcurrency: request.maxConcurrency,
            stepKeys: request.stepKeys,
            volumes: selection.volumes,
            chapters: selection.chapters,
          });
          return {
            built,
            metadata: {
              schemaVersion: 1 as const,
              requestHash,
              scope: request.scope,
              approvalMode: request.approvalMode,
              costBudgetPolicy: request.costBudgetPolicy,
              priorityClass: request.priorityClass,
              stepKeys: request.stepKeys,
              scheduling: built.scheduling,
              counts: built.counts,
              projectedCharacters: selection.projectedCharacters,
            },
          };
        },
      });
    } catch (error) {
      if (error instanceof BatchPlanValidationError) {
        throw new ApiError(400, "BATCH_PLAN_INVALID", "批量计划依赖图无效", {
          issues: error.issues,
        });
      }
      if (error instanceof BatchPlanScopeError) {
        throw new ApiError(400, error.code, error.message, error.details);
      }
      if (error instanceof BatchPlanRepositoryError) {
        throw new ApiError(
          error.code === "BATCH_PLAN_IDEMPOTENCY_CONFLICT" ? 409 : 400,
          error.code,
          error.message,
          error.details,
        );
      }
      throw error;
    }
  }

  async get(userId: string, context: BatchPlanContext, planId: string): Promise<BatchPlanSummary> {
    const plan = await this.repository.getPlan(userId, context, planId);
    if (!plan) {
      throw new ApiError(404, "BATCH_PLAN_NOT_FOUND", "批量计划不存在或无权访问");
    }
    return plan;
  }

  async listItems(
    userId: string,
    context: BatchPlanContext,
    planId: string,
    query: BatchPlanListQuery,
  ): Promise<BatchPlanItemPage> {
    const filters: BatchPlanItemFilters = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const page = await this.repository.listItems(
      userId,
      context,
      planId,
      filters,
      query.cursor,
      query.limit,
    );
    if (!page) {
      throw new ApiError(404, "BATCH_PLAN_NOT_FOUND", "批量计划不存在或无权访问");
    }
    return page;
  }

  async getCostReport(
    userId: string,
    context: BatchPlanContext,
    planId: string,
    groupBy: BatchCostReportGroupBy,
  ): Promise<BatchCostReport> {
    const report = await this.repository.getCostReport(userId, context, planId, groupBy);
    if (!report) {
      throw new ApiError(404, "BATCH_PLAN_NOT_FOUND", "批量计划不存在或无权访问");
    }
    return report;
  }

  async control(
    userId: string,
    context: BatchPlanContext,
    planId: string,
    action: BatchPlanControlAction,
    idempotencyKey: string,
    body: unknown,
    audit: BatchPlanAuditContext,
  ): Promise<BatchPlanSummary> {
    const key = idempotencyKey.trim();
    if (!key || key.length > 200) {
      throw new ApiError(400, "VALIDATION_INVALID", "缺少有效的 Idempotency-Key");
    }
    const request = batchPlanActionRequestSchema.parse(body ?? {});
    let summary: BatchPlanSummary | undefined;
    try {
      summary = await this.repository.controlPlan({
        userId,
        context,
        planId,
        action,
        idempotencyKey: key,
        reason: request.reason ?? defaultReason(action),
        audit,
      });
    } catch (error) {
      if (error instanceof BatchPlanRepositoryError) {
        throw new ApiError(
          error.code === "BATCH_PLAN_IDEMPOTENCY_CONFLICT" ? 409 : 400,
          error.code,
          error.message,
          error.details,
        );
      }
      throw error;
    }
    if (!summary) {
      throw new ApiError(404, "BATCH_PLAN_NOT_FOUND", "批量计划不存在或无权访问");
    }
    if (action === "start" || action === "resume" || action === "retry") {
      await this.queue.enqueueTick({
        jobType: "batch_tick",
        planId,
        workId: context.workId,
        branchId: context.branchId,
        actorId: userId,
        idempotencyKey: `batch-tick:${planId}:${action}`,
        checkpoint: { schemaVersion: 1, revision: 0, planId },
        reason: request.reason ?? defaultReason(action),
      });
    }
    return summary;
  }
}

function defaultReason(action: BatchPlanControlAction): string {
  switch (action) {
    case "start":
      return "作者开始批量计划";
    case "pause":
      return "作者暂停批量计划";
    case "resume":
      return "作者恢复批量计划";
    case "cancel":
      return "作者取消批量计划";
    case "retry":
      return "作者重试批量失败章节";
  }
}

class BatchPlanScopeError extends Error {
  constructor(
    readonly code: "BATCH_PLAN_INVALID" | "BATCH_PLAN_OUTLINE_INCOMPLETE",
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "BatchPlanScopeError";
  }
}

function selectPlanSources(
  scope: BatchPlanScope,
  sources: BatchPlanSources,
  chapterLengthTarget: number,
): {
  volumes: BatchPlanVolumeInput[];
  chapters: BatchPlanChapterInput[];
  projectedCharacters: number;
} {
  const nodeById = new Map(sources.nodes.map((node) => [node.id, node]));
  const chapterNodeByChapterId = new Map(
    sources.nodes
      .filter((node) => node.level === "chapter" && node.chapterId)
      .map((node) => [node.chapterId!, node]),
  );
  const selectedVolumeIds = selectedVolumeNodeIds(scope, nodeById);
  if (scope.type === "range") {
    assertRangeHistory(scope.fromChapterNumber, sources.chapters);
  }
  const chapterIdFilter = scope.type === "chapter" ? new Set(scope.chapterIds) : null;
  const selectedChapters: Array<{
    chapter: ChapterSource;
    node: OutlineNodeSource;
    volume: OutlineNodeSource;
  }> = [];

  for (const chapter of sources.chapters) {
    if (chapterIdFilter && !chapterIdFilter.has(chapter.id)) {
      continue;
    }
    if (
      scope.type === "range" &&
      (chapter.number < scope.fromChapterNumber || chapter.number > scope.toChapterNumber)
    ) {
      continue;
    }
    if (scope.type === "volume") {
      const node = chapterNodeByChapterId.get(chapter.id);
      if (!node) {
        throw new BatchPlanScopeError(
          "BATCH_PLAN_OUTLINE_INCOMPLETE",
          `第 ${chapter.number} 章缺少章节大纲节点，无法创建批量计划`,
          { chapterNumber: chapter.number },
        );
      }
      const volume = findVolumeAncestor(node, nodeById);
      if (!volume) {
        throw new BatchPlanScopeError(
          "BATCH_PLAN_OUTLINE_INCOMPLETE",
          `第 ${chapter.number} 章没有所属卷，无法创建批量计划`,
          { chapterNumber: chapter.number },
        );
      }
      if (!selectedVolumeIds.has(volume.id)) {
        continue;
      }
      selectedChapters.push({ chapter, node, volume });
      continue;
    }
    const node = chapterNodeByChapterId.get(chapter.id);
    if (!node) {
      throw new BatchPlanScopeError(
        "BATCH_PLAN_OUTLINE_INCOMPLETE",
        `第 ${chapter.number} 章缺少章节大纲节点，无法创建批量计划`,
        { chapterNumber: chapter.number },
      );
    }
    const volume = findVolumeAncestor(node, nodeById);
    if (!volume) {
      throw new BatchPlanScopeError(
        "BATCH_PLAN_OUTLINE_INCOMPLETE",
        `第 ${chapter.number} 章没有所属卷，无法创建批量计划`,
        { chapterNumber: chapter.number },
      );
    }
    selectedChapters.push({ chapter, node, volume });
  }

  if (scope.type === "chapter") {
    const found = new Set(selectedChapters.map((entry) => entry.chapter.id));
    const missing = scope.chapterIds.filter((chapterId) => !found.has(chapterId));
    if (missing.length > 0) {
      throw new BatchPlanScopeError("BATCH_PLAN_INVALID", "部分章节不存在", {
        missingChapterIds: missing,
      });
    }
  }
  if (scope.type === "range") {
    const expected = scope.toChapterNumber - scope.fromChapterNumber + 1;
    if (selectedChapters.length !== expected) {
      const present = new Set(selectedChapters.map((entry) => entry.chapter.number));
      const missing: number[] = [];
      for (let number = scope.fromChapterNumber; number <= scope.toChapterNumber; number += 1) {
        if (!present.has(number)) {
          missing.push(number);
          if (missing.length >= 20) {
            break;
          }
        }
      }
      throw new BatchPlanScopeError("BATCH_PLAN_INVALID", "批量区间必须连续且章节均存在", {
        fromChapterNumber: scope.fromChapterNumber,
        toChapterNumber: scope.toChapterNumber,
        missingChapterNumbers: missing,
      });
    }
  }
  if (selectedChapters.length === 0) {
    throw new BatchPlanScopeError("BATCH_PLAN_INVALID", "所选范围没有可生成的章节");
  }

  selectedChapters.sort(
    (left, right) =>
      left.chapter.number - right.chapter.number || left.chapter.id.localeCompare(right.chapter.id),
  );
  const volumeById = new Map(selectedChapters.map((entry) => [entry.volume.id, entry.volume]));
  const volumes = [...volumeById.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .map((volume) => ({
      nodeId: volume.id,
      version: volume.version,
      sortOrder: volume.sortOrder,
    }));
  const chapters = selectedChapters.map(({ chapter, node, volume }) => ({
    chapterId: chapter.id,
    chapterNodeId: node.id,
    chapterNumber: chapter.number,
    chapterOutlineVersion: node.version,
    chapterVersion: chapter.version,
    chapterSortOrder: node.sortOrder,
    volumeNodeId: volume.id,
    volumeVersion: volume.version,
  }));
  const projectedCharacters = selectedChapters.reduce(
    (total, { chapter }) => total + Math.max(chapter.wordCount, chapterLengthTarget),
    0,
  );
  return { volumes, chapters, projectedCharacters };
}

function selectedVolumeNodeIds(
  scope: BatchPlanScope,
  nodeById: Map<string, OutlineNodeSource>,
): Set<string> {
  if (scope.type !== "volume") {
    return new Set();
  }
  const selected = new Set<string>();
  const missing: string[] = [];
  for (const volumeNodeId of scope.volumeNodeIds) {
    const node = nodeById.get(volumeNodeId);
    if (!node || node.level !== "volume") {
      missing.push(volumeNodeId);
      continue;
    }
    selected.add(volumeNodeId);
  }
  if (missing.length > 0) {
    throw new BatchPlanScopeError("BATCH_PLAN_INVALID", "部分卷节点不存在或类型不正确", {
      missingVolumeNodeIds: missing,
    });
  }
  return selected;
}

function assertRangeHistory(fromChapterNumber: number, chapters: readonly ChapterSource[]): void {
  const previous = new Map(
    chapters
      .filter((chapter) => chapter.number < fromChapterNumber)
      .map((chapter) => [chapter.number, chapter]),
  );
  const missingChapterNumbers: number[] = [];
  const uncommittedChapterNumbers: number[] = [];
  for (let number = 1; number < fromChapterNumber; number += 1) {
    const chapter = previous.get(number);
    if (!chapter) {
      missingChapterNumbers.push(number);
      continue;
    }
    if (!chapter.canonCommitted) {
      uncommittedChapterNumbers.push(number);
    }
  }
  if (missingChapterNumbers.length > 0 || uncommittedChapterNumbers.length > 0) {
    throw new BatchPlanScopeError("BATCH_PLAN_INVALID", "区间之前的章节必须存在并已提交正史", {
      missingChapterNumbers: missingChapterNumbers.slice(0, 20),
      uncommittedChapterNumbers: uncommittedChapterNumbers.slice(0, 20),
    });
  }
}

function findVolumeAncestor(
  start: OutlineNodeSource,
  nodeById: Map<string, OutlineNodeSource>,
): OutlineNodeSource | null {
  const visited = new Set<string>();
  let current: OutlineNodeSource | undefined = start;
  while (current) {
    if (current.level === "volume") {
      return current;
    }
    if (!current.parentId || visited.has(current.id)) {
      return null;
    }
    visited.add(current.id);
    current = nodeById.get(current.parentId);
  }
  return null;
}

function hashRequest(request: BatchPlanCreateRequest): string {
  return createHash("sha256")
    .update(
      stableStringify({
        scope: request.scope,
        approvalMode: request.approvalMode,
        costBudgetPolicy: request.costBudgetPolicy,
        priorityClass: request.priorityClass,
        maxConcurrency: request.maxConcurrency,
        stepKeys: request.stepKeys,
      }),
    )
    .digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
