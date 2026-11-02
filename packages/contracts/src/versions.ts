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
} as const;

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;
