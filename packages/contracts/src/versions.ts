import { z } from 'zod';

export const versionKindSchema = z.enum([
  'chapter_version',
  'edit',
  'change',
  'undo',
  'rollback',
  'merge',
]);

export type VersionKind = z.infer<typeof versionKindSchema>;

export const VERSION_KIND_LABELS: Record<VersionKind, string> = {
  chapter_version: '正文版本',
  edit: '内容修改',
  change: '修改请求',
  undo: '撤销修改',
  rollback: '回滚',
  merge: '合并点',
};

export const rollbackVersionSchema = z.object({
  targetVersionId: z.string().uuid(),
  reason: z.string().trim().min(1).max(2_000),
});

export type RollbackVersionInput = z.infer<typeof rollbackVersionSchema>;

export const undoChangeRequestSchema = z.object({
  reason: z.string().trim().max(2_000).optional(),
});

export type UndoChangeRequestInput = z.infer<typeof undoChangeRequestSchema>;

export const auditSearchSchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
});

export type AuditSearchInput = z.infer<typeof auditSearchSchema>;

export const AUDIT_ACTION_LABELS = {
  version_created: '保存版本',
  change_applied: '应用修改',
  change_undone: '撤销修改',
  rollback: '回滚',
  branch_created: '创建平行版本',
  merge_applied: '合并到主线',
  account_login: '登录账号',
  account_logout: '退出登录',
  account_logout_all: '退出所有设备',
  account_password_changed: '修改密码',
  account_password_reset: '重置密码',
  account_email_change_requested: '发起邮箱变更',
  account_email_changed: '修改邮箱',
  account_profile_updated: '更新账号资料',
  account_pen_name_created: '新增笔名',
  account_pen_name_updated: '修改笔名',
  account_pen_name_deleted: '删除笔名',
  account_exported: '导出账号数据',
  account_deletion_requested: '申请注销账号',
  account_recovered: '恢复账号',
  account_purged: '永久删除账号',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;
