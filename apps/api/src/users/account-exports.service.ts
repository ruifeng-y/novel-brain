import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ACCOUNT_EXPORT_STATUS_LABELS,
  type AccountExportJob,
  type AccountExportStatus,
  type AccountExportSummary,
} from '@novel/contracts';
import { accountExportJobs, type AccountExportJobRow } from '@novel/db';
import type { Queue } from 'bullmq';
import { desc, eq } from 'drizzle-orm';
import { AccountAuditService } from '../audit/account-audit.service';
import { DatabaseService } from '../database/database.service';
import { RateLimitService } from '../security/rate-limit.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { AccountExportDownloadSigner } from './account-export-download.signer';
import { usersError } from './users.errors';

const EXPORT_RETENTION_DAYS = 7;
const EXPORT_LIMIT = 3;
const EXPORT_WINDOW_SECONDS = 60 * 60;

@Injectable()
export class AccountExportsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorageService,
    private readonly rateLimits: RateLimitService,
    private readonly accountAudit: AccountAuditService,
    private readonly signer: AccountExportDownloadSigner,
    @InjectQueue('account-export') private readonly exportQueue: Queue,
  ) {}

  async create(userId: string): Promise<AccountExportJob> {
    if (!(await this.rateLimits.consume('account-export', userId, EXPORT_LIMIT, EXPORT_WINDOW_SECONDS))) {
      throw usersError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '导出过于频繁，请稍后再试',
      );
    }
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
    const [created] = await this.database.db
      .insert(accountExportJobs)
      .values({
        userId,
        status: 'queued',
        progress: 0,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.accountAudit.record({
      userId,
      action: 'export.requested',
      targetType: 'account_export',
      targetId: created.id,
      title: '发起完整数据导出',
      detail: '账号全部作品和记录已进入后台打包队列',
      metadata: { kind: 'account', expiresAt: expiresAt.toISOString() },
    });

    try {
      await this.exportQueue.add(
        'package-account-export',
        { exportId: created.id, userId },
        {
          jobId: `account-export-${created.id}`,
          attempts: 2,
          removeOnComplete: 1_000,
          removeOnFail: 1_000,
        },
      );
    } catch {
      await this.markFailed(created.id, new Error('ACCOUNT_EXPORT_QUEUE_UNAVAILABLE'));
      throw usersError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'ACCOUNT_EXPORT_QUEUE_UNAVAILABLE',
        '导出服务暂时不可用，请稍后重试',
      );
    }

    return this.toJob(created);
  }

  async list(userId: string): Promise<{ items: AccountExportJob[] }> {
    const rows = await this.database.db
      .select()
      .from(accountExportJobs)
      .where(eq(accountExportJobs.userId, userId))
      .orderBy(desc(accountExportJobs.createdAt))
      .limit(50);
    return { items: rows.map((row) => this.toJob(row)) };
  }

  async get(userId: string, exportId: string): Promise<AccountExportJob> {
    return this.toJob(await this.requireJob(userId, exportId));
  }

  async download(
    userId: string,
    exportId: string,
  ): Promise<{ data: Buffer; fileName: string; mimeType: string }> {
    const row = await this.requireJob(userId, exportId);
    if (row.expiresAt.getTime() <= Date.now()) {
      throw usersError(HttpStatus.GONE, 'EXPORT_EXPIRED', '这个导出文件已过期，请重新导出');
    }
    if (row.status !== 'completed' || !row.fileKey || !row.fileName || !row.mimeType) {
      throw usersError(HttpStatus.CONFLICT, 'EXPORT_NOT_READY', '导出文件还在准备中');
    }
    const data = await this.storage.getObject(userId, row.fileKey);
    await this.accountAudit.record({
      userId,
      action: 'export.downloaded',
      targetType: 'account_export',
      targetId: row.id,
      title: '下载完整数据导出',
      detail: row.fileName,
      metadata: {
        kind: 'account',
        fileSize: row.fileSize,
        summary: row.summary,
      },
    });
    return { data, fileName: row.fileName, mimeType: row.mimeType };
  }

  private async requireJob(userId: string, exportId: string): Promise<AccountExportJobRow> {
    const [row] = await this.database.db
      .select()
      .from(accountExportJobs)
      .where(eq(accountExportJobs.id, exportId))
      .limit(1);
    if (!row || row.userId !== userId) {
      throw usersError(HttpStatus.NOT_FOUND, 'EXPORT_NOT_FOUND', '导出任务不存在');
    }
    return row;
  }

  private async markFailed(exportId: string, error: unknown): Promise<void> {
    await this.database.db
      .update(accountExportJobs)
      .set({
        status: 'failed',
        error: {
          code: 'ACCOUNT_EXPORT_FAILED',
          message: error instanceof Error ? error.message : '导出失败',
        },
        updatedAt: new Date(),
      })
      .where(eq(accountExportJobs.id, exportId));
  }

  private toJob(row: AccountExportJobRow): AccountExportJob {
    const expired = row.expiresAt.getTime() <= Date.now();
    const status: AccountExportStatus =
      expired && row.status === 'completed' ? 'expired' : row.status;
    let downloadUrl: string | null = null;
    let downloadExpiresAt: string | null = null;
    if (status === 'completed') {
      const token = this.signer.create(row.userId, row.id);
      const params = new URLSearchParams({
        expires: String(token.expiresAt),
        signature: token.signature,
      });
      downloadUrl = `/api/v1/users/me/export/${row.id}/download?${params.toString()}`;
      downloadExpiresAt = new Date(token.expiresAt).toISOString();
    }
    return {
      id: row.id,
      status,
      statusLabel: ACCOUNT_EXPORT_STATUS_LABELS[status],
      progress: row.progress,
      fileName: row.fileName,
      fileSize: row.fileSize,
      summary: (row.summary as AccountExportSummary | null) ?? null,
      error: typeof row.error?.message === 'string' ? row.error.message : null,
      downloadUrl,
      downloadExpiresAt,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
