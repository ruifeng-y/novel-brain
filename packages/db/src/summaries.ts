import {
  summaryRebuildRunSchema,
  summaryRecordSchema,
  type SummaryRebuildRun,
  type SummaryRecord,
} from "@novel-brain/contracts";
import type { InferSelectModel } from "drizzle-orm";

import type { summaryRebuildRuns, summaryRecords } from "./schema";

export type SummaryRecordRow = InferSelectModel<typeof summaryRecords>;
export type SummaryRebuildRunRow = InferSelectModel<typeof summaryRebuildRuns>;

export function toSummaryRecordContract(row: SummaryRecordRow): SummaryRecord {
  return summaryRecordSchema.parse({
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    level: row.level,
    scopeId: row.scopeId,
    chapterId: row.chapterId,
    title: row.title,
    content: row.content,
    status: row.status,
    version: row.version,
    contentHash: row.contentHash,
    inputHash: row.inputHash,
    compilerVersion: row.compilerVersion,
    modelVersion: row.modelVersion,
    sourceRanges: row.sourceRanges,
    fromChapter: row.fromChapter,
    toChapter: row.toChapter,
    generatedAt: row.generatedAt.toISOString(),
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    invalidationReason: row.invalidationReason,
  });
}

export function toSummaryRebuildRunContract(row: SummaryRebuildRunRow): SummaryRebuildRun {
  return summaryRebuildRunSchema.parse({
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    status: row.status,
    levels: row.levels,
    idempotencyKey: row.idempotencyKey,
    compilerVersion: row.compilerVersion,
    modelVersion: row.modelVersion,
    checkpointRevision: row.checkpointRevision,
    totalItems: row.totalItems,
    completedItems: row.completedItems,
    failedItems: row.failedItems,
    error:
      row.errorCode && row.errorMessage ? { code: row.errorCode, message: row.errorMessage } : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}
