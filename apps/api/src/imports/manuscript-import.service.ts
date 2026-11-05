import { Injectable } from "@nestjs/common";
import type {
  Chapter,
  ChapterVersion,
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

  async get(
    userId: string,
    importId: string,
    format?: ManuscriptImportFormat,
  ): Promise<ManuscriptImport> {
    const record = await this.repository.find(userId, importId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "导入记录不存在或无权访问");
    }
    return this.toContract(record, format ?? formatFromName(record.sourceName));
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
    if (record.status !== "completed") {
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
  ): ManuscriptImport {
    const parsed = parseManuscriptText(
      record.sourceText,
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
    order: chapter.number,
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
