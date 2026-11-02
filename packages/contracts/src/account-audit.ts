import { z } from 'zod';

export const ACCOUNT_AUDIT_ACTION_LABELS = {
  'auth.login_succeeded': '登录',
  'auth.login_failed': '登录失败',
  'auth.logout': '退出当前设备',
  'auth.logout_all': '退出所有设备',
  'model_key.created': '添加模型 Key',
  'model_key.updated': '更新模型 Key',
  'model_key.deleted': '删除模型 Key',
  'export.requested': '发起导出',
  'export.completed': '导出完成',
  'export.failed': '导出失败',
  'export.downloaded': '下载导出',
  'account.deletion_requested': '申请注销账号',
  'account.deletion_canceled': '取消注销',
  'generation.requested': '发起生成',
  'generation.paused': '暂停生成',
  'generation.resumed': '继续生成',
  'generation.canceled': '取消生成',
  'generation.retried': '重试生成',
  'generation.reviewed': '确认生成结果',
  'fact.confirmed': '确认事实',
  'fact.rejected': '驳回事实',
} as const;

export type AccountAuditAction = keyof typeof ACCOUNT_AUDIT_ACTION_LABELS;

export const accountAuditActionSchema = z.enum(
  Object.keys(ACCOUNT_AUDIT_ACTION_LABELS) as [
    AccountAuditAction,
    ...AccountAuditAction[],
  ],
);

export const accountAuditSearchSchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  action: accountAuditActionSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type AccountAuditSearchInput = z.infer<typeof accountAuditSearchSchema>;

export type AccountAuditItem = {
  id: string;
  action: AccountAuditAction;
  actionLabel: string;
  targetType: string;
  targetId: string | null;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  actorName: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};
