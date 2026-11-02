import { z } from 'zod';

export const ACCOUNT_EXPORT_STATUS_LABELS = {
  queued: '排队中',
  running: '正在打包',
  completed: '可以下载',
  failed: '打包失败',
  expired: '已过期',
} as const;

export type AccountExportStatus = keyof typeof ACCOUNT_EXPORT_STATUS_LABELS;

export type AccountExportSummary = {
  counts: Record<string, number>;
  fileCount?: number;
};

export type AccountExportJob = {
  id: string;
  status: AccountExportStatus;
  statusLabel: string;
  progress: number;
  fileName: string | null;
  fileSize: number | null;
  summary: AccountExportSummary | null;
  error: string | null;
  downloadUrl: string | null;
  downloadExpiresAt: string | null;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
};

export const accountExportIdSchema = z.string().uuid();
