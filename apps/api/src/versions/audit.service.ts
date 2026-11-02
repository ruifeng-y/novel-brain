import { Injectable } from '@nestjs/common';
import { AUDIT_ACTION_LABELS, type AuditAction } from '@novel/contracts';
import { auditLogs, users } from '@novel/db';
import { and, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';

type AuditRecordInput = {
  userId: string;
  workId: string;
  branchId: string;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  title: string;
  detail?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

export type AuditResponse = {
  id: string;
  action: AuditAction;
  actionLabel: string;
  targetType: string;
  targetId: string | null;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  actorName: string;
  createdAt: string;
};

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(input: AuditRecordInput): Promise<void> {
    await this.database.db.insert(auditLogs).values({
      userId: input.userId,
      workId: input.workId,
      branchId: input.branchId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      title: input.title,
      detail: input.detail ?? '',
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  }

  async search(
    workId: string,
    branchId: string,
    query: string,
    limit: number,
  ): Promise<{ items: AuditResponse[] }> {
    const filters: SQL[] = [eq(auditLogs.workId, workId), eq(auditLogs.branchId, branchId)];
    if (query) {
      const matchingActions = Object.entries(AUDIT_ACTION_LABELS)
        .filter(([, label]) => label.includes(query))
        .map(([action]) => action);
      const textMatch = or(
        ilike(auditLogs.title, `%${query}%`),
        ilike(auditLogs.detail, `%${query}%`),
        ilike(auditLogs.action, `%${query}%`),
      );
      if (matchingActions.length > 0) {
        filters.push(
          or(textMatch, ...matchingActions.map((action) => eq(auditLogs.action, action))) as SQL,
        );
      } else if (textMatch) {
        filters.push(textMatch);
      }
    }

    const rows = await this.database.db
      .select({ log: auditLogs, actorName: users.displayName })
      .from(auditLogs)
      .innerJoin(users, eq(users.id, auditLogs.userId))
      .where(and(...filters))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return { items: rows.map((row) => this.toResponse(row)) };
  }

  async exportCsv(
    workId: string,
    branchId: string,
    query: string,
  ): Promise<{ csv: string; filename: string }> {
    const { items } = await this.search(workId, branchId, query, 200);
    const rows = [
      ['时间', '操作', '内容', '说明', '操作人'],
      ...items.map((item) => [
        item.createdAt,
        item.actionLabel,
        item.title,
        item.detail,
        item.actorName,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\r\n');
    return {
      csv: `\uFEFF${csv}`,
      filename: `novel-brain-history-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  private toResponse(row: {
    log: typeof auditLogs.$inferSelect;
    actorName: string;
  }): AuditResponse {
    const action = row.log.action as AuditAction;
    return {
      id: row.log.id,
      action,
      actionLabel: AUDIT_ACTION_LABELS[action] ?? '修改记录',
      targetType: row.log.targetType,
      targetId: row.log.targetId,
      title: row.log.title,
      detail: row.log.detail,
      metadata: row.log.metadata,
      actorName: row.actorName,
      createdAt: row.log.createdAt.toISOString(),
    };
  }

  private csvCell(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  }
}
