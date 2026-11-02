import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  EXPORT_FORMAT_LABELS,
  EXPORT_KIND_LABELS,
  EXPORT_PRESET_LABELS,
  EXPORT_SCOPE_LABELS,
  EXPORT_STATUS_LABELS,
  VERSION_KIND_LABELS,
  type CreateHistoricalVersionExportRequest,
  type CreateExportRequest,
  type CreateOutlineExportRequest,
  type ExportHistoryItem,
  type ExportPreview,
  type ExportPreviewRequest,
  type ExportScope,
  type ManuscriptExportScope,
} from '@novel/contracts';
import {
  ExportSelectionError,
  buildExportFileName,
  buildHistoricalVersionExport,
  renderExportFile,
  renderOutlineExport,
  selectExportChapters,
  userStorageKey,
  type OutlineExportNode,
} from '@novel/core';
import {
  exportJobs,
  findHistoricalVersionCommit,
  loadBranchOutlineExportSource,
  loadBranchSnapshotExportSource,
  loadExportSource,
  loadHistoricalVersionList,
  loadWorkBranchIdentity,
  works,
  type ChapterOutlineRow,
  type ExportJobRow,
} from '@novel/db';
import type { Queue } from 'bullmq';
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { AccountAuditService } from '../account-audit/account-audit.service';
import { BranchStateService } from '../branches/branch-state.service';
import { RateLimitService } from '../security/rate-limit.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { DownloadTokenService } from './download-token.service';
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
    private readonly accountAudit: AccountAuditService,
    private readonly downloadTokens: DownloadTokenService,
    private readonly branchState: BranchStateService,
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

  async createOutline(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateOutlineExportRequest,
  ) {
    if (!(await this.rateLimits.consume('work-export', userId, 30, 60))) {
      throw exportsError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '导出请求过于频繁，请稍后再试',
      );
    }
    const logicalBranchId = await this.branchState.logicalBranchId(branchId);
    const identity = await this.loadOwnedBranchIdentity(userId, workId, logicalBranchId);
    const source = await loadBranchOutlineExportSource(this.database.db, workId, branchId);
    if (!source) {
      throw exportsError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
    const [created] = await this.database.db
      .insert(exportJobs)
      .values({
        userId,
        workId,
        branchId,
        kind: 'outline',
        format: input.format,
        scope: { type: 'outline' },
        options: { preset: 'generic', encoding: 'utf-8' },
        status: 'queued',
        progress: 0,
        chapterCount: source.outlines.length,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.recordExportRequest(userId, created.id, workId, branchId, input.format, {
      kind: 'outline',
      outlineNodeCount: source.outlines.length,
    });

    try {
      const rendered = await renderOutlineExport(
        {
          work: identity.work,
          branch: identity.branch,
          nodes: source.outlines.map(toOutlineExportNode),
        },
        input.format,
      );
      const fileName = artifactFileName(identity.work.title, identity.branch.name, '大纲', rendered.extension);
      const completed = await this.saveArtifact(created, rendered, fileName);
      return this.toHistoryItem(completed, identity.branch.name);
    } catch (error) {
      await this.markFailed(created.id, error);
      throw exportsError(
        HttpStatus.BAD_GATEWAY,
        'EXPORT_RENDER_FAILED',
        '大纲文件生成失败，请稍后重试',
      );
    }
  }

  async createHistoricalVersion(
    userId: string,
    workId: string,
    branchId: string,
    input: CreateHistoricalVersionExportRequest,
  ) {
    if (!(await this.rateLimits.consume('work-export', userId, 30, 60))) {
      throw exportsError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '导出请求过于频繁，请稍后再试',
      );
    }
    const logicalBranchId = await this.branchState.logicalBranchId(branchId);
    const identity = await this.loadOwnedBranchIdentity(userId, workId, logicalBranchId);
    const commit = await findHistoricalVersionCommit(
      this.database.db,
      workId,
      logicalBranchId,
      input.versionCommitId,
    );
    if (!commit) {
      throw exportsError(
        HttpStatus.NOT_FOUND,
        'VERSION_NOT_FOUND',
        '这个历史版本不在当前创作线上',
      );
    }
    const snapshotBranchId = await this.branchState.resolveSnapshotBranchId(
      commit.id,
      commit.snapshotBranchId,
    );
    const snapshot = await loadBranchSnapshotExportSource(
      this.database.db,
      workId,
      snapshotBranchId,
    );
    if (!snapshot) {
      throw exportsError(
        HttpStatus.CONFLICT,
        'VERSION_SNAPSHOT_UNAVAILABLE',
        '这个历史版本暂时无法读取',
      );
    }
    const versions = await loadHistoricalVersionList(
      this.database.db,
      workId,
      logicalBranchId,
    );

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
    const versionLabel = commit.title || commit.message;
    const [created] = await this.database.db
      .insert(exportJobs)
      .values({
        userId,
        workId,
        branchId,
        kind: 'version',
        versionCommitId: commit.id,
        format: 'zip',
        scope: { type: 'version', versionCommitId: commit.id },
        options: {
          preset: 'generic',
          encoding: 'utf-8',
          versionTitle: versionLabel,
        },
        status: 'queued',
        progress: 0,
        chapterCount: snapshot.chapters.length,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.recordExportRequest(userId, created.id, workId, branchId, 'zip', {
      kind: 'version',
      versionCommitId: commit.id,
      versionTitle: versionLabel,
    });

    try {
      const rendered = await buildHistoricalVersionExport({
        work: identity.work,
        branch: identity.branch,
        version: {
          id: commit.id,
          kind: commit.kind,
          kindLabel: VERSION_KIND_LABELS[commit.kind],
          title: versionLabel,
          reason: commit.reason,
          parentVersionId: commit.parentCommitId,
          createdAt: commit.createdAt.toISOString(),
        },
        versions: versions.map((version) => ({
          id: version.id,
          kind: version.kind,
          kindLabel: VERSION_KIND_LABELS[version.kind],
          title: version.title || version.message,
          reason: version.reason,
          createdAt: version.createdAt.toISOString(),
        })),
        outline: snapshot.outlines.map(toOutlineExportNode),
        chapters: snapshot.chapters,
        data: snapshot.data,
      });
      const fileName = artifactFileName(
        identity.work.title,
        identity.branch.name,
        '历史版本',
        rendered.extension,
      );
      const completed = await this.saveArtifact(created, rendered, fileName);
      return this.toHistoryItem(completed, identity.branch.name);
    } catch (error) {
      await this.markFailed(created.id, error);
      throw exportsError(
        HttpStatus.BAD_GATEWAY,
        'EXPORT_RENDER_FAILED',
        '历史版本文件生成失败，请稍后重试',
      );
    }
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
    await this.accountAudit.record({
      userId,
      action: 'work_export_requested',
      targetType: 'work_export',
      targetId: created.id,
      title: '发起作品导出',
      detail: `《${source.work.title}》· ${input.format}`,
      metadata: {
        kind: 'work',
        workId,
        branchId,
        format: input.format,
        scope: input.scope,
        chapterCount: selected.length,
      },
    });

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
    await this.accountAudit.record({
      userId,
      action: 'work_export_downloaded',
      targetType: 'work_export',
      targetId: row.id,
      title: '下载作品导出',
      detail: row.fileName,
      metadata: {
        kind: 'work',
        workId,
        branchId,
        format: row.format,
      },
    });
    return {
      data: await this.storage.getObject(userId, row.fileKey),
      fileName: row.fileName,
      mimeType: row.mimeType,
    };
  }

  async downloadSignedToken(token: string): Promise<{
    data: Buffer;
    fileName: string;
    mimeType: string;
  }> {
    const claims = this.downloadTokens.verify(token);
    if (!claims) {
      throw exportsError(
        HttpStatus.FORBIDDEN,
        'DOWNLOAD_LINK_INVALID',
        'This download link is invalid or has expired',
      );
    }
    return this.database.withUserContext(claims.userId, () =>
      this.download(claims.userId, claims.workId, claims.branchId, claims.exportId),
    );
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
    scope: ManuscriptExportScope,
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

  private async loadOwnedBranchIdentity(userId: string, workId: string, branchId: string) {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw exportsError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    const identity = await loadWorkBranchIdentity(this.database.db, workId, branchId);
    if (!identity) {
      throw exportsError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
    return identity;
  }

  private async recordExportRequest(
    userId: string,
    exportId: string,
    workId: string,
    branchId: string,
    format: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.accountAudit.record({
      userId,
      action: 'work_export_requested',
      targetType: 'work_export',
      targetId: exportId,
      title: '发起作品导出',
      detail: `${EXPORT_KIND_LABELS[metadata.kind as keyof typeof EXPORT_KIND_LABELS]} · ${format}`,
      metadata: {
        kind: 'work',
        workId,
        branchId,
        format,
        ...metadata,
      },
    });
  }

  private async saveArtifact(
    job: ExportJobRow,
    rendered: { data: Buffer; extension: string; mimeType: string },
    fileName: string,
  ): Promise<ExportJobRow> {
    const fileKey = userStorageKey(
      job.userId,
      job.workId,
      job.branchId,
      'exports',
      `${job.id}.${rendered.extension}`,
    );
    await this.storage.putObject(job.userId, fileKey, rendered.data, rendered.mimeType);
    const completedAt = new Date();
    const [completed] = await this.database.db
      .update(exportJobs)
      .set({
        status: 'completed',
        progress: 100,
        fileKey,
        fileName,
        mimeType: rendered.mimeType,
        fileSize: rendered.data.length,
        error: null,
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(exportJobs.id, job.id))
      .returning();
    return completed;
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
    const options = row.options as {
      preset?: keyof typeof EXPORT_PRESET_LABELS;
      versionTitle?: string;
    };
    const kind = row.kind ?? 'manuscript';
    return {
      id: row.id,
      kind,
      kindLabel: EXPORT_KIND_LABELS[kind],
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
          ? `/api/v1/downloads/${this.downloadTokens.sign({
              exportId: row.id,
              userId: row.userId,
              workId: row.workId,
              branchId: row.branchId,
            })}`
          : null,
      branch: { id: row.branchId, name: branchName },
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      version: row.versionCommitId
        ? {
            id: row.versionCommitId,
            title: options.versionTitle ?? '历史版本',
          }
        : null,
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
    if (scope.type === 'outline') {
      return EXPORT_SCOPE_LABELS.outline;
    }
    if (scope.type === 'version') {
      return EXPORT_SCOPE_LABELS.version;
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

function toOutlineExportNode(row: ChapterOutlineRow): OutlineExportNode {
  return {
    id: row.id,
    parentId: row.parentId,
    level: row.level,
    orderIndex: row.orderIndex,
    title: row.title,
    summary: row.summary,
    details: row.details,
    chapterNumber: row.chapterNumber,
    chapterGoal: row.chapterGoal,
    pov: row.pov,
    sceneBeats: row.sceneBeats,
    chapterEndHook: row.chapterEndHook,
    locked: row.lockedAt !== null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function artifactFileName(title: string, branchName: string, label: string, extension: string): string {
  const safe = (value: string, fallback: string) =>
    value
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || fallback;
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${safe(title, 'NovelBrain')}-${safe(branchName, '创作线')}-${label}-${stamp}.${extension}`;
}
