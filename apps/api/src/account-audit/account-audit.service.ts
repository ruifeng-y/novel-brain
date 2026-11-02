import { Injectable } from '@nestjs/common';
import { auditLogs } from '@novel/db';
import type { AuditAction } from '@novel/contracts';
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
      metadata: input.metadata ?? {},
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  }
}
