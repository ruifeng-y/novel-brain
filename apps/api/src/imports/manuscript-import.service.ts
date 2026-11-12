import { Injectable } from "@nestjs/common";
import type {
  Chapter,
  ChapterVersion,
  ChunkedImportCreateRequest,
  ChunkedImportStartRequest,
  ChunkedImportChunkRequest,
  ChunkedImportProgress,
  ManuscriptImport,
  ManuscriptImportConfirmData,
  ManuscriptImportConfirmRequest,
  ManuscriptImportFormat,
} from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ManuscriptImportRepository } from "./manuscript-import.repository";
import type {
  ChapterRecord,
  ChapterVersionRecord,
  ManuscriptImportJobRecord,
} from "./manuscript-import.repository";
import { parseManuscriptText } from "./manuscript-import.parser";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksService } from "../works/works.service";
import type { WorksAuditContext } from "../works/works.repository";

@Injectable()
export class ManuscriptImportService {
  constructor(
    private readonly repository: ManuscriptImportRepository,
    private readonly worksService: WorksService,
  ) {}

  async create(
    userId: string,
    input: { text: string; sourceName: string; format: ManuscriptImportFormat },
  ): Promise<ManuscriptImport> {
    const record = await this.repository.create({
      id: uuidv7(),
      userId,
      sourceName: input.sourceName,
      sourceText: input.text,
    });
    return this.toContract(record, input.format);
  }

  async createChunked(
    userId: string,
    input: ChunkedImportCreateRequest,
    idempotencyKey: string,
  ): Promise<ChunkedImportProgress> {
    if (!idempotencyKey.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "分块导入需要 Idempotency-Key");
    }
    const record = await this.repository.createChunked({
      id: uuidv7(),
      userId,
      sourceName: input.sourceName,
      chunks: input.chunks,
      idempotencyKey: idempotencyKey.trim(),
    });
    if (record === "idempotency_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "同一 Idempotency-Key 不能用于不同分块导入");
    }
    return toChunkedProgress(record);
  }

  async startChunked(
    userId: string,
    input: ChunkedImportStartRequest,
    idempotencyKey: string,
  ): Promise<ChunkedImportProgress> {
    if (!idempotencyKey.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "分块导入需要 Idempotency-Key");
    }
    const record = await this.repository.createChunkedStart({
      id: uuidv7(),
      userId,
      sourceName: input.sourceName,
      chunkCount: input.chunkCount,
      idempotencyKey: idempotencyKey.trim(),
    });
    if (record === "idempotency_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "同一 Idempotency-Key 不能用于不同分块导入");
    }
    return toChunkedProgress(record);
  }

  async appendChunk(
    userId: string,
    importId: string,
    input: ChunkedImportChunkRequest,
  ): Promise<ChunkedImportProgress> {
    const record = await this.repository.appendChunk({ userId, importId, ...input });
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在、无权访问或分块序号无效");
    }
    return toChunkedProgress(record);
  }

  async processChunk(userId: string, importId: string): Promise<ChunkedImportProgress> {
    const record = await this.repository.processChunk(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return toChunkedProgress(record);
  }

  async progress(userId: string, importId: string): Promise<ChunkedImportProgress> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return toChunkedProgress(record);
  }

  async controlChunked(
    userId: string,
    importId: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<ChunkedImportProgress> {
    const record = await this.repository.setChunkedStatus(userId, importId, action);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return toChunkedProgress(record);
  }

  async get(
    userId: string,
    importId: string,
    format?: ManuscriptImportFormat,
  ): Promise<ManuscriptImport> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    const sourceText =
      record.metadata.chunked === true
        ? await this.repository.sourceText(userId, importId)
        : record.sourceText;
    if (sourceText === undefined) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return this.toContract(record, format ?? formatFromName(record.sourceName), sourceText);
  }

  async confirm(
    userId: string,
    displayName: string,
    importId: string,
    input: ManuscriptImportConfirmRequest,
    audit: WorksAuditContext,
    idempotencyKey: string,
  ): Promise<ManuscriptImportConfirmData> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    if (record.status !== "awaiting_confirmation" && record.status !== "completed") {
      throw new ApiError(409, "IMPORT_NOT_READY", "旧稿仍在分块处理，请完成后再确认");
    }
    if (record.status !== "completed") {
      if (record.metadata.chunked === true) {
        const hasSourceText = await this.repository.hasSourceText(userId, importId);
        if (hasSourceText === undefined) {
          throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
        }
        if (!hasSourceText) {
          throw new ApiError(400, "VALIDATION_INVALID", "空旧稿不能创建作品");
        }
        const matches = await this.repository.chaptersMatchSource(userId, importId, input.chapters);
        if (matches === undefined) {
          throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
        }
        if (!matches) {
          throw new ApiError(400, "VALIDATION_INVALID", "章节调整改变了旧稿原文，请重新识别");
        }
      } else {
        const parsed = parseManuscriptText(
          record.sourceText,
          record.sourceName?.replace(/\.[^.]+$/u, "") || "全文",
        );
        if (parsed.status === "empty") {
          throw new ApiError(400, "VALIDATION_INVALID", "空旧稿不能创建作品");
        }
        if (input.chapters.map((chapter) => chapter.content).join("") !== record.sourceText) {
          throw new ApiError(400, "VALIDATION_INVALID", "章节调整改变了旧稿原文，请重新识别");
        }
      }
    }

    const result = await this.repository.confirm({
      userId,
      importId,
      displayName,
      title: input.title,
      ...(input.penName ? { penName: input.penName } : {}),
      genre: input.genre,
      scaleTarget: input.scaleTarget,
      chapterLengthTarget: input.chapterLengthTarget,
      chapters: input.chapters,
      audit,
      idempotencyKey,
    });
    if (!result) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return {
      work: await this.worksService.get(userId, result.workId),
      chapters: result.chapters.map(toChapterContract),
      chapterVersions: result.chapterVersions.map(toChapterVersionContract),
    };
  }

  private toContract(
    record: ManuscriptImportJobRecord,
    format: ManuscriptImportFormat,
    sourceText = record.sourceText,
  ): ManuscriptImport {
    const parsed = parseManuscriptText(
      sourceText,
      record.sourceName?.replace(/\.[^.]+$/u, "") || "全文",
    );
    return {
      id: record.id,
      status: parsed.status,
      sourceName: record.sourceName ?? "旧稿",
      format,
      chapters: parsed.chapters.map((chapter, index) => ({
        order: index + 1,
        ...chapter,
      })),
      warnings: parsed.warnings,
      canConfirm:
        record.status !== "completed" && parsed.status !== "empty" && parsed.chapters.length > 0,
      confirmedWorkId: record.workId,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

export function formatFromName(sourceName: string | null): ManuscriptImportFormat {
  return sourceName?.toLowerCase().match(/\.(?:md|markdown)$/u) ? "markdown" : "txt";
}

function toChapterContract(chapter: ChapterRecord): Chapter {
  if (!chapter.currentVersionId) {
    throw new Error("Imported chapter is missing its current version");
  }
  return {
    id: chapter.id,
    workId: chapter.workId,
    branchId: chapter.branchId,
    number: chapter.number,
    title: chapter.title,
    status: chapter.status as Chapter["status"],
    version: chapter.version,
    wordCount: chapter.wordCount,
    currentVersionId: chapter.currentVersionId,
  };
}

function toChapterVersionContract(
  version: ChapterVersionRecord & { parentNodeId: string | null },
): ChapterVersion {
  return {
    id: version.id,
    chapterId: version.chapterId,
    version: version.version,
    content: version.content,
    contentHash: version.contentHash,
    versionNodeId: version.versionNodeId,
    parentNodeId: version.parentNodeId,
    createdAt: version.createdAt.toISOString(),
  };
}

function toChunkedProgress(record: ManuscriptImportJobRecord): ChunkedImportProgress {
  const status = [
    "queued",
    "processing",
    "awaiting_confirmation",
    "paused",
    "partial",
    "failed",
    "cancelled",
    "completed",
  ].includes(record.status)
    ? (record.status as ChunkedImportProgress["status"])
    : "processing";
  return {
    importId: record.id,
    status,
    chunkCount: record.chunkCount,
    processedChunks: record.processedChunks,
    canConfirm: status === "awaiting_confirmation",
  };
}
