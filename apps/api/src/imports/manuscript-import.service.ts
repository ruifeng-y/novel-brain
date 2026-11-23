import { Injectable } from "@nestjs/common";
import type {
  Chapter,
  ChapterVersion,
  ChunkedImportCreateRequest,
  ChunkedManuscriptImportConfirmRequest,
  ChunkedImportStartRequest,
  ChunkedImportChunkRequest,
  ChunkedImportProgress,
  ManuscriptImport,
  ManuscriptImportConfirmData,
  ManuscriptImportConfirmRequest,
  ManuscriptImportFormat,
  ManuscriptSourceRange,
  WorkOverview,
} from "@novel-brain/contracts";
import { manuscriptScanStateSchema } from "@novel-brain/contracts";
import { isWellFormedUtf16, manuscriptChaptersFromScan } from "@novel-brain/core";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ManuscriptImportQueue } from "./manuscript-import.queue";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ManuscriptImportRepository } from "./manuscript-import.repository";
import type {
  ChapterRecord,
  ChapterVersionRecord,
  ManuscriptImportJobRecord,
} from "./manuscript-import.repository";
import { parseManuscriptText } from "./manuscript-import.parser";
import { formatFromName, readImportFile, type ImportUploadFile } from "./import-file";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorksService } from "../works/works.service";
import type { WorksAuditContext } from "../works/works.repository";

const MAX_BATCH_CHUNK_CHARACTERS = 500_000;

@Injectable()
export class ManuscriptImportService {
  constructor(
    private readonly repository: ManuscriptImportRepository,
    private readonly worksService: WorksService,
    private readonly queue: ManuscriptImportQueue,
  ) {}

  async create(
    userId: string,
    input: {
      text: string;
      sourceName: string;
      format: ManuscriptImportFormat;
      headingStarts?: readonly number[];
    },
  ): Promise<ManuscriptImport> {
    const parsed = parseManuscriptText(
      input.text,
      input.sourceName.replace(/\.[^.]+$/u, "") || "全文",
      { headingStarts: input.headingStarts ?? [] },
    );
    const record = await this.repository.create({
      id: uuidv7(),
      userId,
      sourceName: input.sourceName,
      sourceText: input.text,
      metadata: {
        sourceFormat: input.format,
        sourceRanges: parsed.chapters.map((chapter) => chapter.sourceRange),
        sourceHeadingStarts: [...(input.headingStarts ?? [])],
      },
    });
    return this.toContract(record, input.format);
  }

  async createFromFile(userId: string, file: ImportUploadFile): Promise<ManuscriptImport> {
    const uploaded = readImportFile(file, "manuscript");
    return this.create(userId, {
      text: uploaded.text,
      sourceName: file.originalname.trim(),
      format: uploaded.format,
      headingStarts: uploaded.headingStarts,
    });
  }

  async createChunked(
    userId: string,
    input: ChunkedImportCreateRequest,
    idempotencyKey: string,
  ): Promise<ChunkedImportProgress> {
    if (!idempotencyKey.trim()) {
      throw new ApiError(400, "VALIDATION_INVALID", "分块导入需要 Idempotency-Key");
    }
    if (!input.chunks.every(isWellFormedUtf16)) {
      throw new ApiError(400, "VALIDATION_INVALID", "旧稿包含无法解析的 Unicode 内容");
    }
    const totalCharacters = input.chunks.reduce((total, chunk) => total + chunk.length, 0);
    if (totalCharacters > MAX_BATCH_CHUNK_CHARACTERS) {
      throw new ApiError(
        413,
        "VALIDATION_INVALID",
        "大批量旧稿请使用流式分块入口，单次请求内容过大",
      );
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
    const progress = toChunkedProgress(record);
    await this.queue.enqueue(userId, record.id, progress);
    return progress;
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
    if (record === "invalid_text") {
      throw new ApiError(400, "VALIDATION_INVALID", "旧稿包含无法解析的 Unicode 内容");
    }
    if (record === "not_ready" || record === "sequence_conflict") {
      throw new ApiError(409, "IMPORT_NOT_READY", "导入已取消、完成或分块顺序无效");
    }
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在、无权访问或分块序号无效");
    }
    const progress = toChunkedProgress(record);
    await this.queue.enqueue(userId, importId, progress);
    return progress;
  }

  async processChunk(userId: string, importId: string): Promise<ChunkedImportProgress> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    const progress = toChunkedProgress(record);
    await this.queue.enqueue(userId, importId, progress);
    return progress;
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
    if (action === "resume") {
      await this.queue.enqueue(userId, importId, toChunkedProgress(record));
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
    if (record.metadata.chunked === true) {
      return this.toChunkedContract(
        record,
        format ?? formatFromName(record.sourceName),
        repositoryScannedManuscript(record),
      );
    }
    const sourceText = record.sourceText;
    if (sourceText === undefined) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return this.toContract(
      record,
      format ?? formatFromName(record.sourceName),
      sourceText,
      record.metadata.chunked !== true,
    );
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
          { headingStarts: headingStartsFromRecord(record) },
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
      chapters: withSourceRanges(input.chapters),
      audit,
      idempotencyKey,
    });
    if (result === "not_ready") {
      throw new ApiError(409, "IMPORT_NOT_READY", "导入已暂停、取消或尚未完成");
    }
    if (!result) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return {
      work: await this.worksService.get(userId, result.workId),
      chapters: result.chapters.map(toChapterContract),
      chapterVersions: result.chapterVersions.map(toChapterVersionContract),
    };
  }

  async confirmChunked(
    userId: string,
    displayName: string,
    importId: string,
    input: ChunkedManuscriptImportConfirmRequest,
    audit: WorksAuditContext,
    idempotencyKey: string,
  ): Promise<WorkOverview> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    if (record.metadata.chunked !== true) {
      throw new ApiError(409, "IMPORT_NOT_READY", "该导入不是分块旧稿");
    }
    if (record.status !== "awaiting_confirmation" && record.status !== "completed") {
      throw new ApiError(409, "IMPORT_NOT_READY", "旧稿仍在分块处理，请完成后再确认");
    }
    const scanned = repositoryScannedManuscript(record);
    validateChapterRanges(input.chapters, scanned.totalCharacters);
    const matches = await this.repository.validateChunkedRanges(userId, importId, input.chapters);
    if (matches === undefined) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    if (!matches) {
      throw new ApiError(400, "VALIDATION_INVALID", "章节范围必须连续覆盖旧稿原文");
    }
    const result = await this.repository.confirmRanges({
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
    if (result === "not_ready") {
      throw new ApiError(409, "IMPORT_NOT_READY", "导入已暂停、取消或尚未完成");
    }
    if (!result) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return this.worksService.get(userId, result.workId);
  }

  private toContract(
    record: ManuscriptImportJobRecord,
    format: ManuscriptImportFormat,
    sourceText = record.sourceText,
    includeContent = true,
  ): ManuscriptImport {
    const parsed = parseManuscriptText(
      sourceText,
      record.sourceName?.replace(/\.[^.]+$/u, "") || "全文",
      { headingStarts: headingStartsFromRecord(record) },
    );
    return {
      id: record.id,
      status: parsed.status,
      sourceName: record.sourceName ?? "旧稿",
      format,
      chapters: parsed.chapters.map((chapter, index) => ({
        order: index + 1,
        ...chapter,
        content: includeContent ? chapter.content : "",
      })),
      warnings: parsed.warnings,
      canConfirm:
        record.status !== "completed" &&
        (record.metadata.chunked !== true || record.status === "awaiting_confirmation") &&
        parsed.status !== "empty" &&
        parsed.chapters.length > 0,
      confirmedWorkId: record.workId,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private toChunkedContract(
    record: ManuscriptImportJobRecord,
    format: ManuscriptImportFormat,
    scanned: ReturnType<typeof repositoryScannedManuscript>,
  ): ManuscriptImport {
    return {
      id: record.id,
      status: scanned.status,
      sourceName: record.sourceName ?? "旧稿",
      format,
      chapters: scanned.chapters.map((chapter, index) => ({
        order: index + 1,
        title: chapter.title,
        content: "",
        wordCount: chapter.sourceRange.end - chapter.sourceRange.start,
        sourceRange: chapter.sourceRange,
      })),
      warnings: scanned.warnings,
      canConfirm:
        record.status === "awaiting_confirmation" &&
        scanned.status !== "empty" &&
        scanned.chapters.length > 0,
      confirmedWorkId: record.workId,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

function headingStartsFromRecord(record: ManuscriptImportJobRecord): number[] {
  const value = record.metadata.sourceHeadingStarts;
  return Array.isArray(value)
    ? value.filter((item): item is number => typeof item === "number" && Number.isInteger(item))
    : [];
}

function repositoryScannedManuscript(record: ManuscriptImportJobRecord) {
  const rawState = record.checkpoint.manuscript;
  const state = rawState
    ? manuscriptScanStateSchema.parse(rawState)
    : {
        schemaVersion: 1 as const,
        offset: sourceCharacterCount(record),
        lineStart: 0,
        pendingLine: "",
        lineOverflow: false,
        prefixHasText: false,
        headings: [],
        hasText: false,
      };
  const totalCharacters =
    typeof record.checkpoint.sourceCharacterCount === "number"
      ? record.checkpoint.sourceCharacterCount
      : state.offset;
  return {
    ...manuscriptChaptersFromScan(
      state,
      totalCharacters,
      record.sourceName?.replace(/\.[^.]+$/u, "") || "全文",
    ),
    totalCharacters,
  };
}

function sourceCharacterCount(record: ManuscriptImportJobRecord): number {
  const value = record.checkpoint.sourceCharacterCount;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function withSourceRanges(
  chapters: Array<{ title: string; content: string }>,
): Array<{ title: string; content: string; sourceRange: ManuscriptSourceRange }> {
  let offset = 0;
  return chapters.map((chapter) => {
    const sourceRange = { start: offset, end: offset + chapter.content.length };
    offset = sourceRange.end;
    return { ...chapter, sourceRange };
  });
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
    uploadedChunks:
      typeof record.checkpoint.uploadedChunks === "number"
        ? record.checkpoint.uploadedChunks
        : record.processedChunks,
    processedChunks: record.processedChunks,
    canConfirm: status === "awaiting_confirmation",
  };
}

function validateChapterRanges(
  chapters: Array<{ sourceRange: ManuscriptSourceRange }>,
  totalCharacters: number,
): void {
  let expectedStart = 0;
  for (const chapter of chapters) {
    if (
      chapter.sourceRange.start !== expectedStart ||
      chapter.sourceRange.end <= chapter.sourceRange.start
    ) {
      throw new ApiError(400, "VALIDATION_INVALID", "章节范围必须连续覆盖旧稿原文");
    }
    expectedStart = chapter.sourceRange.end;
  }
  if (expectedStart !== totalCharacters) {
    throw new ApiError(400, "VALIDATION_INVALID", "章节范围必须连续覆盖旧稿原文");
  }
}
