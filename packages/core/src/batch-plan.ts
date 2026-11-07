import { createHash } from "node:crypto";

import {
  BATCH_PLAN_PRIORITY,
  INTERACTIVE_PRIORITY,
  type BatchApprovalMode,
  type BatchPlanCounts,
  type BatchPlanScope,
  type BatchPlanScheduling,
  type BatchPlanValidationIssue,
  type BatchPriorityClass,
  type BatchSchedulingCaps,
  type BatchWorkItem,
  type BatchWorkItemStatus,
  type WorkerJobStep,
} from "@novel-brain/contracts";

export const BATCH_SCHEDULING_CAPS: BatchSchedulingCaps = {
  global: 4,
  perWork: 2,
  perUser: 2,
};

const BATCH_PLAN_EPOCH_MS = Date.UTC(2026, 0, 1);

export interface BatchPlanVolumeInput {
  nodeId: string;
  version: number;
  sortOrder: number;
}

export interface BatchPlanChapterInput {
  chapterId: string;
  chapterNodeId: string;
  chapterNumber: number;
  chapterOutlineVersion: number;
  chapterVersion: number;
  chapterSortOrder: number;
  volumeNodeId: string;
  volumeVersion: number;
}

export interface BuildBatchPlanInput {
  planId: string;
  workId: string;
  branchId: string;
  userId: string;
  scope: BatchPlanScope;
  approvalMode: BatchApprovalMode;
  priorityClass: BatchPriorityClass;
  maxConcurrency: number;
  stepKeys: readonly WorkerJobStep[];
  volumes: readonly BatchPlanVolumeInput[];
  chapters: readonly BatchPlanChapterInput[];
}

export type BatchPlanItemDraft = Omit<BatchWorkItem, "createdAt" | "updatedAt">;

export interface BuiltBatchPlan {
  items: BatchPlanItemDraft[];
  counts: BatchPlanCounts;
  scheduling: BatchPlanScheduling;
}

export interface BatchScheduleCandidate {
  key: string;
  workId: string;
  userId: string;
  priority: number;
  priorityClass: BatchPriorityClass;
  status: BatchWorkItemStatus;
  dependsOn: readonly string[];
}

export interface BatchScheduleState {
  runningGlobal: number;
  runningByWork: Record<string, number>;
  runningByUser: Record<string, number>;
}

export class BatchPlanValidationError extends Error {
  constructor(readonly issues: BatchPlanValidationIssue[]) {
    super(`Batch plan graph is invalid: ${issues.map((issue) => issue.code).join(", ")}`);
    this.name = "BatchPlanValidationError";
  }
}

export function buildBatchPlan(input: BuildBatchPlanInput): BuiltBatchPlan {
  if (input.stepKeys.length === 0 || new Set(input.stepKeys).size !== input.stepKeys.length) {
    throw new BatchPlanValidationError([
      {
        code: "invalid_root",
        message: "Step keys must be non-empty and unique",
        itemKey: null,
      },
    ]);
  }

  const volumes = [...input.volumes].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.nodeId.localeCompare(right.nodeId),
  );
  const volumeById = new Map(volumes.map((volume) => [volume.nodeId, volume]));
  const chapters = [...input.chapters].sort(
    (left, right) =>
      left.chapterNumber - right.chapterNumber || left.chapterId.localeCompare(right.chapterId),
  );

  const items: BatchPlanItemDraft[] = [];
  const itemByKey = new Map<string, BatchPlanItemDraft>();
  let sortOrder = 0;
  const priority =
    input.priorityClass === "interactive" ? INTERACTIVE_PRIORITY : BATCH_PLAN_PRIORITY;

  const bookKey = "book";
  const book = draft(input, {
    key: bookKey,
    type: "book",
    parentKey: null,
    chapterId: null,
    outlineNodeId: null,
    inputVersion: { outlineVersion: null, chapterVersion: null },
    priority,
    sortOrder: sortOrder++,
    dependsOn: [],
  });
  items.push(book);
  itemByKey.set(book.key, book);

  const chaptersByVolume = new Map<string, BatchPlanChapterInput[]>();
  for (const chapter of chapters) {
    if (!volumeById.has(chapter.volumeNodeId)) {
      throw new BatchPlanValidationError([
        {
          code: "missing_parent",
          message: `Chapter ${chapter.chapterId} references an unknown volume`,
          itemKey: `chapter:${chapter.chapterId}`,
        },
      ]);
    }
    const bucket = chaptersByVolume.get(chapter.volumeNodeId);
    if (bucket) {
      bucket.push(chapter);
    } else {
      chaptersByVolume.set(chapter.volumeNodeId, [chapter]);
    }
  }

  const volumeItems: BatchPlanItemDraft[] = [];
  const chapterItems: BatchPlanItemDraft[] = [];
  const stepItems: BatchPlanItemDraft[] = [];
  let previousVolumeKey: string | null = null;

  for (const volume of volumes) {
    const volumeChapters = chaptersByVolume.get(volume.nodeId);
    if (!volumeChapters || volumeChapters.length === 0) {
      continue;
    }
    const volumeKey = `volume:${volume.nodeId}`;
    const volumeItem = draft(input, {
      key: volumeKey,
      type: "volume",
      parentKey: bookKey,
      chapterId: null,
      outlineNodeId: volume.nodeId,
      inputVersion: { outlineVersion: volume.version, chapterVersion: null },
      priority,
      sortOrder: sortOrder++,
      dependsOn: [],
    });
    items.push(volumeItem);
    itemByKey.set(volumeItem.key, volumeItem);
    volumeItems.push(volumeItem);

    const volumeChapterItems: BatchPlanItemDraft[] = [];
    for (const chapter of volumeChapters) {
      const chapterKey = `chapter:${chapter.chapterId}`;
      const chapterItem = draft(input, {
        key: chapterKey,
        type: "chapter",
        parentKey: volumeKey,
        chapterId: chapter.chapterId,
        outlineNodeId: chapter.chapterNodeId,
        inputVersion: {
          outlineVersion: chapter.chapterOutlineVersion,
          chapterVersion: chapter.chapterVersion,
        },
        priority,
        sortOrder: sortOrder++,
        dependsOn: [],
      });
      items.push(chapterItem);
      itemByKey.set(chapterItem.key, chapterItem);
      chapterItems.push(chapterItem);
      volumeChapterItems.push(chapterItem);

      let previousStepKey: string | null = null;
      const chapterStepItems: BatchPlanItemDraft[] = [];
      for (const stepKey of input.stepKeys) {
        const key = `step:${chapter.chapterId}:${stepKey}`;
        const stepItem = draft(input, {
          key,
          type: "step",
          parentKey: chapterKey,
          chapterId: chapter.chapterId,
          outlineNodeId: chapter.chapterNodeId,
          inputVersion: {
            outlineVersion: chapter.chapterOutlineVersion,
            chapterVersion: chapter.chapterVersion,
          },
          priority,
          sortOrder: sortOrder++,
          dependsOn: previousStepKey
            ? [previousStepKey]
            : previousVolumeKey
              ? [previousVolumeKey]
              : [],
        });
        items.push(stepItem);
        itemByKey.set(stepItem.key, stepItem);
        stepItems.push(stepItem);
        chapterStepItems.push(stepItem);
        previousStepKey = stepItem.key;
      }
      const lastStep = chapterStepItems[chapterStepItems.length - 1];
      if (!lastStep) {
        throw new BatchPlanValidationError([
          {
            code: "invalid_root",
            message: "Every chapter must have at least one planned step",
            itemKey: chapterKey,
          },
        ]);
      }
      chapterItem.dependsOn = [lastStep.key];
    }

    volumeItem.dependsOn = volumeChapterItems.map((chapterItem) => chapterItem.key);
    previousVolumeKey = volumeItem.key;
  }

  book.dependsOn = volumeItems.map((volumeItem) => volumeItem.key);

  for (const item of items) {
    item.status = item.dependsOn.length === 0 ? "ready" : "pending";
  }

  const issues = validateBatchWorkItemGraph(items, { workId: input.workId });
  if (issues.length > 0) {
    throw new BatchPlanValidationError(issues);
  }

  const caps = BATCH_SCHEDULING_CAPS;
  const effectivePerWork = Math.max(
    1,
    Math.min(input.maxConcurrency, caps.global, caps.perWork, caps.perUser),
  );
  const counts = countItems(items);
  const scheduling: BatchPlanScheduling = {
    caps,
    effectivePerWork,
    priority,
    initialRunnableKeys: selectDispatchableBatchItems(
      items,
      { runningGlobal: 0, runningByWork: {}, runningByUser: {} },
      { ...caps, perWork: effectivePerWork },
    ),
  };
  return { items, counts, scheduling };
}

export function validateBatchWorkItemGraph(
  items: readonly BatchPlanItemDraft[],
  options: { workId?: string } = {},
): BatchPlanValidationIssue[] {
  const issues: BatchPlanValidationIssue[] = [];
  const byKey = new Map<string, BatchPlanItemDraft>();
  let bookCount = 0;

  for (const item of items) {
    if (byKey.has(item.key)) {
      issues.push({
        code: "duplicate_key",
        message: `Duplicate work-item key ${item.key}`,
        itemKey: item.key,
      });
    } else {
      byKey.set(item.key, item);
    }
    if (item.type === "book") {
      bookCount += 1;
      if (item.parentKey !== null) {
        issues.push({
          code: "invalid_parent_type",
          message: "The book item cannot have a parent",
          itemKey: item.key,
        });
      }
    } else if (item.parentKey === null) {
      issues.push({
        code: "missing_parent",
        message: `${item.type} item ${item.key} requires a parent`,
        itemKey: item.key,
      });
    }
  }

  if (bookCount !== 1) {
    issues.push({
      code: "invalid_root",
      message: `A batch plan must contain exactly one book item, received ${bookCount}`,
      itemKey: null,
    });
  }

  const expectedParentType: Record<
    Exclude<BatchPlanItemDraft["type"], "book">,
    BatchPlanItemDraft["type"]
  > = {
    volume: "book",
    chapter: "volume",
    step: "chapter",
  };

  for (const item of byKey.values()) {
    if (options.workId && item.workId !== options.workId) {
      issues.push({
        code: "cross_work_reference",
        message: `Work item ${item.key} belongs to another work`,
        itemKey: item.key,
      });
    }
    if (item.type !== "book" && item.parentKey) {
      const parent = byKey.get(item.parentKey);
      if (!parent) {
        issues.push({
          code: "missing_parent",
          message: `Parent ${item.parentKey} for ${item.key} does not exist`,
          itemKey: item.key,
        });
      } else if (parent.type !== expectedParentType[item.type]) {
        issues.push({
          code: "invalid_parent_type",
          message: `${item.type} item ${item.key} cannot be a child of ${parent.type}`,
          itemKey: item.key,
        });
      }
    }
    for (const dependencyKey of item.dependsOn) {
      const dependency = byKey.get(dependencyKey);
      if (!dependency) {
        issues.push({
          code: "unknown_dependency",
          message: `Dependency ${dependencyKey} for ${item.key} does not exist`,
          itemKey: item.key,
        });
        continue;
      }
      if (dependency.workId !== item.workId) {
        issues.push({
          code: "cross_work_reference",
          message: `Work item ${item.key} depends on another work`,
          itemKey: item.key,
        });
      }
    }
  }

  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const item of byKey.values()) {
    let degree = 0;
    for (const dependencyKey of item.dependsOn) {
      if (!byKey.has(dependencyKey)) {
        continue;
      }
      degree += 1;
      const edges = adjacency.get(dependencyKey);
      if (edges) {
        edges.push(item.key);
      } else {
        adjacency.set(dependencyKey, [item.key]);
      }
    }
    indegree.set(item.key, degree);
  }
  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([key]) => key)
    .sort();
  const visited = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    visited.add(key);
    for (const next of adjacency.get(key) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }
  if (visited.size !== byKey.size) {
    const remaining = [...byKey.keys()].filter((key) => !visited.has(key)).sort()[0] ?? null;
    issues.push({
      code: "cycle",
      message: "Work-item dependencies contain a cycle",
      itemKey: remaining,
    });
  }

  return issues.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      (left.itemKey ?? "").localeCompare(right.itemKey ?? ""),
  );
}

export function selectDispatchableBatchItems(
  candidates: readonly BatchScheduleCandidate[],
  state: BatchScheduleState,
  caps: BatchSchedulingCaps = BATCH_SCHEDULING_CAPS,
  completedKeys: ReadonlySet<string> = new Set(),
): string[] {
  const remainingGlobal = Math.max(0, caps.global - state.runningGlobal);
  const ordered = candidates
    .filter(
      (candidate) =>
        candidate.status === "ready" &&
        candidate.dependsOn.every((dependencyKey) => completedKeys.has(dependencyKey)),
    )
    .sort(
      (left, right) =>
        priorityClassRank(left.priorityClass) - priorityClassRank(right.priorityClass) ||
        right.priority - left.priority ||
        left.key.localeCompare(right.key),
    );
  const selected: string[] = [];
  const scheduledByWork = new Map<string, number>();
  const scheduledByUser = new Map<string, number>();
  for (const candidate of ordered) {
    if (selected.length >= remainingGlobal) {
      break;
    }
    const workCount =
      (state.runningByWork[candidate.workId] ?? 0) + (scheduledByWork.get(candidate.workId) ?? 0);
    if (workCount >= caps.perWork) {
      continue;
    }
    const userCount =
      (state.runningByUser[candidate.userId] ?? 0) + (scheduledByUser.get(candidate.userId) ?? 0);
    if (userCount >= caps.perUser) {
      continue;
    }
    selected.push(candidate.key);
    scheduledByWork.set(candidate.workId, (scheduledByWork.get(candidate.workId) ?? 0) + 1);
    scheduledByUser.set(candidate.userId, (scheduledByUser.get(candidate.userId) ?? 0) + 1);
  }
  return selected;
}

export function deterministicUuidV7(name: string, timestampMs = BATCH_PLAN_EPOCH_MS): string {
  const hash = createHash("sha256").update(name).digest();
  const bytes = Buffer.alloc(16);
  const timestamp = BigInt(timestampMs);
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (hash[6]! & 0x0f) | 0x70;
  bytes[7] = hash[7]!;
  bytes[8] = (hash[8]! & 0x3f) | 0x80;
  for (let index = 9; index < 16; index += 1) {
    bytes[index] = hash[index]!;
  }
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function draft(
  input: BuildBatchPlanInput,
  value: Pick<
    BatchPlanItemDraft,
    | "key"
    | "type"
    | "parentKey"
    | "chapterId"
    | "outlineNodeId"
    | "inputVersion"
    | "priority"
    | "sortOrder"
    | "dependsOn"
  >,
): BatchPlanItemDraft {
  return {
    id: deterministicUuidV7(`plan:${input.planId}:item:${value.key}`),
    planId: input.planId,
    workId: input.workId,
    branchId: input.branchId,
    userId: input.userId,
    key: value.key,
    type: value.type,
    parentKey: value.parentKey,
    chapterId: value.chapterId,
    outlineNodeId: value.outlineNodeId,
    status: "pending",
    attempt: 0,
    priority: value.priority,
    priorityClass: input.priorityClass,
    sortOrder: value.sortOrder,
    inputVersion: value.inputVersion,
    dependsOn: value.dependsOn,
    outputRefs: [],
    errorCode: null,
    errorMessage: null,
  };
}

function countItems(items: readonly BatchPlanItemDraft[]): BatchPlanCounts {
  const counts: BatchPlanCounts = {
    total: items.length,
    book: 0,
    volume: 0,
    chapter: 0,
    step: 0,
    pending: 0,
    ready: 0,
    running: 0,
    paused: 0,
    waiting_review: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const item of items) {
    counts[item.type] += 1;
    counts[item.status] += 1;
  }
  return counts;
}

function priorityClassRank(priorityClass: BatchPriorityClass): number {
  return priorityClass === "interactive" ? 0 : 1;
}
