import { Injectable } from '@nestjs/common';
import {
  buildExportFileName,
  renderExportFile,
  selectExportChapters,
  userStorageKey,
} from '@novel/core';
import type { ExportScope } from '@novel/contracts';
import { exportJobs, loadExportSource, type ExportJobRow } from '@novel/db';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { ObjectStorageService } from '../storage/object-storage.service';

@Injectable()
export class ExportRunner {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorageService,
  ) {}

  async run(exportId: string): Promise<{ ok: boolean }> {
    const job = await this.requireJob(exportId);
    if (job.status === 'completed') {
      return { ok: true };
    }
    if (job.status === 'failed') {
      return { ok: false };
    }
    await this.database.db
      .update(exportJobs)
      .set({ status: 'running', progress: 5, updatedAt: new Date() })
      .where(eq(exportJobs.id, job.id));

    try {
      const source = await loadExportSource(this.database.db, job.workId, job.branchId);
      if (!source) {
        throw new Error('Work or story branch was not found');
      }
      const chapters = selectExportChapters(
        job.scope as ExportScope,
        source.outlines,
        source.chapters,
      );
      const options = job.options as {
        preset: 'generic' | 'qidian' | 'fanqie';
        chapterTitlePattern?: string;
        volumeTitlePattern?: string;
        paragraphSpacing?: 0 | 1 | 2;
        firstLineIndent?: boolean;
      };
      const rendered = await renderExportFile({
        title: source.work.title,
        chapters,
        format: job.format,
        preset: options.preset ?? 'generic',
        chapterTitlePattern: options.chapterTitlePattern,
        volumeTitlePattern: options.volumeTitlePattern,
        paragraphSpacing: options.paragraphSpacing,
        firstLineIndent: options.firstLineIndent,
      });
      const fileKey = userStorageKey(
        job.userId,
        job.workId,
        job.branchId,
        'exports',
        `${job.id}.${rendered.extension}`,
      );
      const fileName = buildExportFileName(source.work.title, rendered.extension);
      await this.storage.putObject(job.userId, fileKey, rendered.data, rendered.mimeType);
      const completedAt = new Date();
      await this.database.db
        .update(exportJobs)
        .set({
          status: 'completed',
          progress: 100,
          chapterCount: chapters.length,
          fileKey,
          fileName,
          mimeType: rendered.mimeType,
          fileSize: rendered.data.length,
          error: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(exportJobs.id, job.id));
      return { ok: true };
    } catch (error) {
      await this.database.db
        .update(exportJobs)
        .set({
          status: 'failed',
          error: {
            code: 'EXPORT_RENDER_FAILED',
            message: error instanceof Error ? error.message : '导出失败',
          },
          updatedAt: new Date(),
        })
        .where(eq(exportJobs.id, job.id));
      return { ok: false };
    }
  }

  private async requireJob(exportId: string): Promise<ExportJobRow> {
    const [job] = await this.database.db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, exportId))
      .limit(1);
    if (!job) {
      throw new Error(`Export ${exportId} was not found`);
    }
    return job;
  }
}
