import { Injectable } from '@nestjs/common';
import {
  ACCOUNT_AUDIT_ACTION_LABELS,
  type AccountAuditAction,
  type AccountAuditItem,
  type AccountAuditSearchInput,
  type AuditAction,
} from '@novel/contracts';
import { auditLogs, users } from '@novel/db';
import { and, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';

type AccountAuditInput = {
  userId: string;
  action: AuditAction;
  title: string;
  targetType?: string;
  targetId?: string | null;
  detail?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

const SENSITIVE_METADATA_KEY = /api.?key|password|token|secret|credential/i;

@Injectable()
export class AccountAuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(input: AccountAuditInput): Promise<void> {
    await this.database.db.insert(auditLogs).values({
      userId: input.userId,
      workId: null,
      branchId: null,
      action: input.action,
      targetType: input.targetType ?? 'account',
      targetId: input.targetId ?? null,
      title: input.title,
      detail: input.detail ?? '',
      metadata: this.redact(input.metadata ?? {}),
      ip: input.ip ?? null,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
    });
  }

  async search(
    userId: string,
    input: AccountAuditSearchInput,
  ): Promise<{ items: AccountAuditItem[] }> {
    const filters: SQL[] = [eq(auditLogs.userId, userId), isNull(auditLogs.workId)];
    if (input.action) {
      filters.push(eq(auditLogs.action, input.action));
    }
    if (input.q) {
      const labelActions = Object.entries(ACCOUNT_AUDIT_ACTION_LABELS)
        .filter(([, label]) => label.includes(input.q))
        .map(([action]) => action as AccountAuditAction);
      const textMatch = or(
        ilike(auditLogs.title, `%${input.q}%`),
        ilike(auditLogs.detail, `%${input.q}%`),
        ilike(auditLogs.action, `%${input.q}%`),
      );
      const queryMatch =
        labelActions.length > 0
          ? or(textMatch, ...labelActions.map((action) => eq(auditLogs.action, action)))
          : textMatch;
      if (queryMatch) {
        filters.push(queryMatch);
      }
    }

    const rows = await this.database.db
      .select({ log: auditLogs, actorName: users.displayName })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.userId))
      .where(and(...filters))
      .orderBy(desc(auditLogs.createdAt))
      .limit(input.limit);

    return {
      items: rows.map(({ log, actorName }) => {
        const action = log.action as AccountAuditAction;
        return {
          id: log.id,
          action,
          actionLabel: ACCOUNT_AUDIT_ACTION_LABELS[action] ?? log.action,
          targetType: log.targetType,
          targetId: log.targetId,
          title: log.title,
          detail: log.detail,
          metadata: log.metadata,
          actorName,
          ip: log.ip,
          userAgent: log.userAgent,
          createdAt: log.createdAt.toISOString(),
        };
      }),
    };
  }

  async exportCsv(
    userId: string,
    input: AccountAuditSearchInput,
  ): Promise<{ csv: string; filename: string }> {
    const { items } = await this.search(userId, { ...input, limit: 200 });
    const rows = [
      ['时间', '操作', '对象', '内容', '说明', '操作人', 'IP'],
      ...items.map((item) => [
        item.createdAt,
        item.actionLabel,
        item.targetType,
        item.title,
        item.detail,
        item.actorName,
        item.ip ?? '',
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n');
    return {
      csv: `\uFEFF${csv}`,
      filename: `novel-brain-account-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  private redact(value: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        if (SENSITIVE_METADATA_KEY.test(key)) {
          return [key, '[redacted]'];
        }
        return [key, this.redactValue(entry)];
      }),
    );
  }

  private redactValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.redactValue(item));
    }
    if (value && typeof value === 'object') {
      return this.redact(value as Record<string, unknown>);
    }
    return value;
  }

  private csvCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }
}
