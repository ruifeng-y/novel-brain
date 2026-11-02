import { z } from 'zod';
import { AUDIT_ACTION_LABELS, type AuditAction } from './versions';

export const ACCOUNT_AUDIT_ACTION_LABELS = AUDIT_ACTION_LABELS;
export type AccountAuditAction = AuditAction;

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
