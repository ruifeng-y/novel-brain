import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EXPORT_FORMAT_LABELS,
  EXPORT_PRESET_LABELS,
  EXPORT_SCOPE_LABELS,
  EXPORT_STATUS_LABELS,
  type CreateExportRequest,
  type ExportHistoryItem,
  type ExportPreview,
  type ExportPreviewRequest,
  type ExportScope,
} from '@novel/contracts';
import {
  ExportSelectionError,
  buildExportFileName,
  renderExportFile,
  selectExportChapters,
  userStorageKey,
} from '@novel/core';
import { exportJobs, loadExportSource, works, type ExportJobRow } from '@novel/db';
import type { Queue } from 'bullmq';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../security/rate-limit.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { exportsError } from './exports.errors';

const EXPORT_RETENTION_DAYS = 7;
const BACKGROUND_CHAPTER_THRESHOLD = 20;
const BACKGROUND_CHARACTER_THRESHOLD = 400_000;

@Injectable()
export class ExportsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorageService,
    private readonly rateLimits: RateLimitService,
    @InjectQueue('export') private readonly exportQueue: Queue,
  ) {}

  async preview(
    userId: string,
    workId: string,
    branchId: string,
    input: ExportPreviewRequest,
  ): Promise<ExportPreview> {
    const source = await this.loadSource(userId, workId, branchId);
    const selected = this.select(source, input.scope);
    const previewChapters = selected.slice(0, input.previewChapterCount);
    const sampleFile = await renderExportFile({
      title: source.work.title,
      chapters: previewChapters,
      format: 'txt',
      preset: input.options.preset,
      chapterTitlePattern: input.options.chapterTitlePattern,
      volumeTitlePattern: input.options.volumeTitlePattern,
      paragraphSpacing: input.options.paragraphSpacing,
      firstLineIndent: input.options.firstLineIndent,
    });
    return {
      scope: input.scope,
      scopeLabel: this.scopeLabel(input.scope),
      format: input.format,
      preset: input.options.preset,
      chapterCount: selected.length,
      wordCount: selected.reduce((total, chapter) => total + chapter.content.length, 0),
      tableOfContents: this.tableOfContents(selected),
      chapters: previewChapters.map((chapter) => ({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        volumeTitle: chapter.volumeTitle,
        excerpt: this.excerpt(chapter.content),
      })),
      sample: sampleFile.data.toString('utf8').slice(0, 2_400),
    };
  }

  async create(userId: string, workId: string, branchId: string, input: CreateExportRequest) {
    if (!(await this.rateLimits.consume('work-export', userId, 30, 60))) {
      throw exportsError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '导出请求过于频繁，请稍后再试',
      );
    }
    const source = await this.loadSource(userId, workId, branchId);
    const selected = this.select(source, input.scope);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
    const [created] = await this.database.db
      .insert(exportJobs)
      .values({
        userId,
        workId,
        branchId,
        format: input.format,
        scope: input.scope,
        options: input.options,
        status: 'queued',
        progress: 0,
        chapterCount: selected.length,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const totalCharacters = selected.reduce((total, chapter) => total + chapter.content.length, 0);
    const runInBackground =
      selected.length >= BACKGROUND_CHAPTER_THRESHOLD ||
      totalCharacters >= BACKGROUND_CHARACTER_THRESHOLD;

    if (runInBackground) {
      await this.enqueue(created.id, userId);
      return this.toHistoryItem(created, source.branch.name);
    }

    try {
      const rendered = await renderExportFile({
        title: source.work.title,
        chapters: selected,
        format: input.format,
        preset: input.options.preset,
        chapterTitlePattern: input.options.chapterTitlePattern,
        volumeTitlePattern: input.options.volumeTitlePattern,
        paragraphSpacing: input.options.paragraphSpacing,
        firstLineIndent: input.options.firstLineIndent,
      });
      const fileKey = userStorageKey(
        userId,
        workId,
        branchId,
        'exports',
        `${created.id}.${rendered.extension}`,
      );
      const fileName = buildExportFileName(source.work.title, rendered.extension);
      await this.storage.putObject(userId, fileKey, rendered.data, rendered.mimeType);
      const completedAt = new Date();
      const [completed] = await this.database.db
        .update(exportJobs)
        .set({
          status: 'completed',
          progress: 100,
          chapterCount: selected.length,
          fileKey,
          fileName,
          mimeType: rendered.mimeType,
          fileSize: rendered.data.length,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(exportJobs.id, created.id))
        .returning();
      return this.toHistoryItem(completed, source.branch.name);
    } catch (error) {
      await this.markFailed(created.id, error);
      throw exportsError(
        HttpStatus.BAD_GATEWAY,
        'EXPORT_RENDER_FAILED',
        '导出文件生成失败，请稍后重试',
      );
    }
  }

  async list(userId: string, workId: string, branchId: string) {
    const source = await this.loadSource(userId, workId, branchId);
    const rows = await this.database.db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.userId, userId),
          eq(exportJobs.workId, workId),
          eq(exportJobs.branchId, branchId),
          gte(
            exportJobs.createdAt,
            new Date(Date.now() - EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1_000),
          ),
        ),
      )
      .orderBy(desc(exportJobs.createdAt))
      .limit(50);
    return {
      items: rows.map((row) => this.toHistoryItem(row, source.branch.name)),
    };
  }

  async get(userId: string, workId: string, branchId: string, exportId: string) {
    const source = await this.loadSource(userId, workId, branchId);
    const row = await this.requireExport(userId, workId, branchId, exportId);
    return this.toHistoryItem(row, source.branch.name);
  }

  async download(
    userId: string,
    workId: string,
    branchId: string,
    exportId: string,
  ): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
    await this.loadSource(userId, workId, branchId);
    const row = await this.requireExport(userId, workId, branchId, exportId);
    if (row.expiresAt.getTime() <= Date.now()) {
      throw exportsError(HttpStatus.GONE, 'EXPORT_EXPIRED', '这个导出文件已过期，请重新导出');
    }
    if (row.status !== 'completed' || !row.fileKey || !row.fileName || !row.mimeType) {
      throw exportsError(HttpStatus.CONFLICT, 'EXPORT_NOT_READY', '导出文件还在准备中');
    }
    return {
      data: await this.storage.getObject(userId, row.fileKey),
      fileName: row.fileName,
      mimeType: row.mimeType,
    };
  }

  private async loadSource(userId: string, workId: string, branchId: string) {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw exportsError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    const source = await loadExportSource(this.database.db, workId, branchId);
    if (!source) {
      throw exportsError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
    return source;
  }

  private select(
    source: Awaited<ReturnType<typeof loadExportSource>> & object,
    scope: ExportScope,
  ) {
    try {
      return selectExportChapters(scope, source.outlines, source.chapters);
    } catch (error) {
      if (error instanceof ExportSelectionError) {
        throw exportsError(HttpStatus.CONFLICT, error.code, error.message);
      }
      throw error;
    }
  }

  private async requireExport(
    userId: string,
    workId: string,
    branchId: string,
    exportId: string,
  ): Promise<ExportJobRow> {
    const [row] = await this.database.db
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.id, exportId),
          eq(exportJobs.userId, userId),
          eq(exportJobs.workId, workId),
          eq(exportJobs.branchId, branchId),
        ),
      )
      .limit(1);
    if (!row) {
      throw exportsError(HttpStatus.NOT_FOUND, 'EXPORT_NOT_FOUND', 'Export not found');
    }
    return row;
  }

  private async enqueue(exportId: string, userId: string) {
    try {
      await this.exportQueue.add(
        'generate-export',
        { exportId, userId },
        {
          jobId: `export-${exportId}`,
          attempts: 2,
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        },
      );
    } catch {
      await this.markFailed(exportId, new Error('EXPORT_QUEUE_UNAVAILABLE'));
      throw exportsError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'EXPORT_QUEUE_UNAVAILABLE',
        '导出服务暂时不可用，请稍后重试',
      );
    }
  }

  private async markFailed(exportId: string, error: unknown) {
    const now = new Date();
    await this.database.db
      .update(exportJobs)
      .set({
        status: 'failed',
        error: {
          code: 'EXPORT_RENDER_FAILED',
          message: error instanceof Error ? error.message : '导出失败',
        },
        updatedAt: now,
      })
      .where(eq(exportJobs.id, exportId));
  }

  private toHistoryItem(row: ExportJobRow, branchName: string): ExportHistoryItem {
    const expired = row.expiresAt.getTime() <= Date.now();
    const status = expired && row.status === 'completed' ? 'expired' : row.status;
    const scope = row.scope as ExportScope;
    const options = row.options as { preset?: keyof typeof EXPORT_PRESET_LABELS };
    return {
      id: row.id,
      format: row.format,
      formatLabel: EXPORT_FORMAT_LABELS[row.format],
      preset: options.preset ?? 'generic',
      presetLabel: EXPORT_PRESET_LABELS[options.preset ?? 'generic'],
      scope,
      scopeLabel: this.scopeLabel(scope),
      status,
      statusLabel: EXPORT_STATUS_LABELS[status],
      progress: row.progress,
      chapterCount: row.chapterCount,
      fileName: row.fileName,
      fileSize: row.fileSize,
      error: typeof row.error?.message === 'string' ? row.error.message : null,
      downloadUrl:
        row.status === 'completed' && !expired
          ? `/api/v1/works/${row.workId}/branches/${row.branchId}/exports/${row.id}/download`
          : null,
      branch: { id: row.branchId, name: branchName },
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private scopeLabel(scope: ExportScope): string {
    if (scope.type === 'chapter') {
      return `当前章 · 第 ${scope.chapterNumber} 章`;
    }
    if (scope.type === 'chapters') {
      return `${EXPORT_SCOPE_LABELS.chapters} · ${scope.chapterNumbers.length} 章`;
    }
    if (scope.type === 'range') {
      return `${EXPORT_SCOPE_LABELS.range} · 第 ${scope.startChapter}-${scope.endChapter} 章`;
    }
    return EXPORT_SCOPE_LABELS[scope.type];
  }

  private tableOfContents(
    chapters: Awaited<ReturnType<typeof selectExportChapters>>,
  ): ExportPreview['tableOfContents'] {
    const groups: ExportPreview['tableOfContents'] = [];
    for (const chapter of chapters) {
      let group = groups.at(-1);
      if (!group || group.volumeTitle !== chapter.volumeTitle) {
        group = { volumeTitle: chapter.volumeTitle, chapters: [] };
        groups.push(group);
      }
      group.chapters.push({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
      });
    }
    return groups;
  }

  private excerpt(content: string): string {
    const normalized = content.replace(/\s+/g, ' ').trim();
    return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
  }
}
