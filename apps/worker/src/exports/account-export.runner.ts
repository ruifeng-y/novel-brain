import { Injectable } from '@nestjs/common';
import type { AccountExportAsset } from '@novel/core';
import { buildAccountExportArchive, userStorageKey } from '@novel/core';
import {
  accountExportJobs,
  auditLogs,
  loadAccountExportData,
  users,
  type AccountExportJobRow,
} from '@novel/db';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { ObjectStorageService } from '../storage/object-storage.service';

@Injectable()
export class AccountExportRunner {
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
      .update(accountExportJobs)
      .set({ status: 'running', progress: 5, updatedAt: new Date() })
      .where(eq(accountExportJobs.id, job.id));

    try {
      const data = await loadAccountExportData(this.database.db, job.userId);
      if (!data) {
        throw new Error('Author account was not found');
      }
      await this.database.db
        .update(accountExportJobs)
        .set({ progress: 35, updatedAt: new Date() })
        .where(eq(accountExportJobs.id, job.id));

      const assets = await this.loadMapAssets(
        job.userId,
        data.maps.images as Array<{ id: string; storageKey: string; mimeType: string }>,
      );
      const archive = await buildAccountExportArchive({ data, assets });
      const fileKey = userStorageKey(job.userId, 'account-exports', `${job.id}.zip`);
      const fileName = `novelbrain-account-${new Date().toISOString().slice(0, 10)}.zip`;
      await this.storage.putObject(
        job.userId,
        fileKey,
        archive.data,
        'application/zip',
      );
      const completedAt = new Date();
      await this.database.db
        .update(accountExportJobs)
        .set({
          status: 'completed',
          progress: 100,
          fileKey,
          fileName,
          mimeType: 'application/zip',
          fileSize: archive.data.length,
          summary: {
            counts: archive.manifest.counts,
            fileCount: archive.manifest.files.length,
          },
          error: null,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(accountExportJobs.id, job.id));
      await this.database.db
        .update(users)
        .set({ lastExportAt: completedAt, updatedAt: completedAt })
        .where(eq(users.id, job.userId));
      await this.recordAudit(job.userId, 'account_export_completed', job.id, {
        fileName,
        fileSize: archive.data.length,
        counts: archive.manifest.counts,
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '账号导出失败';
      await this.database.db
        .update(accountExportJobs)
        .set({
          status: 'failed',
          error: { code: 'ACCOUNT_EXPORT_FAILED', message },
          updatedAt: new Date(),
        })
        .where(eq(accountExportJobs.id, job.id));
      await this.recordAudit(job.userId, 'account_export_failed', job.id, { message });
      return { ok: false };
    }
  }

  private async loadMapAssets(
    userId: string,
    images: Array<{ id: string; storageKey: string; mimeType: string }>,
  ): Promise<AccountExportAsset[]> {
    const assets: AccountExportAsset[] = [];
    for (const image of images) {
      try {
        const extension =
          image.mimeType === 'image/png'
            ? 'png'
            : image.mimeType === 'image/webp'
              ? 'webp'
              : 'jpg';
        assets.push({
          path: `assets/maps/${image.id}.${extension}`,
          data: await this.storage.getObject(userId, image.storageKey),
          mimeType: image.mimeType,
        });
      } catch {
        // A stale map reference should not make the rest of the account export unusable.
      }
    }
    return assets;
  }

  private async requireJob(exportId: string): Promise<AccountExportJobRow> {
    const [job] = await this.database.db
      .select()
      .from(accountExportJobs)
      .where(eq(accountExportJobs.id, exportId))
      .limit(1);
    if (!job) {
      throw new Error(`Account export ${exportId} was not found`);
    }
    return job;
  }

  private async recordAudit(
    userId: string,
    action: 'account_export_completed' | 'account_export_failed',
    exportId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.database.db.insert(auditLogs).values({
      userId,
      workId: null,
      branchId: null,
      action,
      targetType: 'account_export',
      targetId: exportId,
      title: action === 'account_export_completed' ? '完整数据导出完成' : '完整数据导出失败',
      detail:
        action === 'account_export_completed'
          ? '账号数据压缩包已经生成，可在有效期内下载'
          : '账号数据打包没有完成',
      metadata: { kind: 'account', ...metadata },
    });
  }
}
