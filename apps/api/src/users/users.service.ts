import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify } from '@node-rs/argon2';
import { emailChangeRequests, penNames, sessions, users } from '@novel/db';
import { and, asc, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AccountAuditService } from '../account-audit/account-audit.service';
import { MAX_CODE_ATTEMPTS } from '../auth/auth.constants';
import { DatabaseService } from '../database/database.service';
import { MAILER, type Mailer } from '../mail/mailer';
import { RateLimitService } from '../security/rate-limit.service';
import type { PublicUser } from '../auth/auth.types';
import type {
  CreatePenNameInput,
  UpdatePenNameInput,
  UpdateProfileInput,
} from '@novel/contracts';
import type { PenNameRow } from '@novel/db';
import { usersError } from './users.errors';

const EMAIL_CHANGE_TTL_MINUTES = 10;
const EMAIL_CHANGE_SEND_LIMIT = 5;
const EMAIL_CHANGE_SEND_WINDOW_SECONDS = 60 * 60;
const EXPORT_FRESHNESS_MS = 24 * 60 * 60 * 1000;
const DELETION_GRACE_DAYS = 30;

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly rateLimits: RateLimitService,
    private readonly config: ConfigService,
    private readonly accountAudit: AccountAuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async getProfile(userId: string): Promise<PublicUser> {
    const [account] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account) {
      throw usersError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '请先登录');
    }
    return this.toPublicUser(account);
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<PublicUser> {
    const changes: {
      displayName?: string;
      bio?: string;
      avatarUrl?: string | null;
      updatedAt: Date;
    } = { updatedAt: new Date() };
    if (input.displayName !== undefined) {
      changes.displayName = input.displayName;
    }
    if (input.bio !== undefined) {
      changes.bio = input.bio;
    }
    if (input.avatarUrl !== undefined) {
      changes.avatarUrl = input.avatarUrl || null;
    }

    const [updated] = await this.database.db
      .update(users)
      .set(changes)
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .returning();
    if (!updated) {
      throw usersError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', '请先登录');
    }

    await this.accountAudit.record({
      userId,
      action: 'account_profile_updated',
      title: '更新账号资料',
      metadata: { fields: Object.keys(input) },
      ip,
      userAgent,
    });
    return this.toPublicUser(updated);
  }

  async listPenNames(userId: string) {
    const rows = await this.database.db
      .select()
      .from(penNames)
      .where(eq(penNames.userId, userId))
      .orderBy(desc(penNames.isDefault), asc(penNames.createdAt));
    return { items: rows.map((row) => this.toPenName(row)) };
  }

  async createPenName(
    userId: string,
    input: CreatePenNameInput,
    ip?: string | null,
    userAgent?: string | null,
  ) {
    try {
      const created = await this.database.db.transaction(async (tx) => {
        if (input.isDefault) {
          await tx
            .update(penNames)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(penNames.userId, userId), eq(penNames.isDefault, true)));
        }
        const [row] = await tx
          .insert(penNames)
          .values({
            userId,
            name: input.name,
            bio: input.bio ?? '',
            avatarUrl: input.avatarUrl || null,
            isDefault: input.isDefault ?? false,
          })
          .returning();
        return row;
      });

      await this.accountAudit.record({
        userId,
        action: 'account_pen_name_created',
        title: '新增笔名',
        targetType: 'pen_name',
        targetId: created.id,
        ip,
        userAgent,
      });
      return this.toPenName(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw usersError(HttpStatus.CONFLICT, 'PEN_NAME_EXISTS', '这个笔名已经存在');
      }
      throw error;
    }
  }

  async updatePenName(
    userId: string,
    penNameId: string,
    input: UpdatePenNameInput,
    ip?: string | null,
    userAgent?: string | null,
  ) {
    try {
      const updated = await this.database.db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(penNames)
          .where(and(eq(penNames.id, penNameId), eq(penNames.userId, userId)))
          .limit(1);
        if (!existing) {
          throw usersError(HttpStatus.NOT_FOUND, 'PEN_NAME_NOT_FOUND', '没有找到这个笔名');
        }
        if (input.isDefault) {
          await tx
            .update(penNames)
            .set({ isDefault: false, updatedAt: new Date() })
            .where(and(eq(penNames.userId, userId), eq(penNames.isDefault, true)));
        }
        const changes: Partial<typeof penNames.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) {
          changes.name = input.name;
        }
        if (input.bio !== undefined) {
          changes.bio = input.bio;
        }
        if (input.avatarUrl !== undefined) {
          changes.avatarUrl = input.avatarUrl || null;
        }
        if (input.isDefault !== undefined) {
          changes.isDefault = input.isDefault;
        }
        const [row] = await tx
          .update(penNames)
          .set(changes)
          .where(and(eq(penNames.id, penNameId), eq(penNames.userId, userId)))
          .returning();
        return row;
      });

      await this.accountAudit.record({
        userId,
        action: 'account_pen_name_updated',
        title: '修改笔名',
        targetType: 'pen_name',
        targetId: updated.id,
        metadata: { fields: Object.keys(input) },
        ip,
        userAgent,
      });
      return this.toPenName(updated);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw usersError(HttpStatus.CONFLICT, 'PEN_NAME_EXISTS', '这个笔名已经存在');
      }
      throw error;
    }
  }

  async deletePenName(
    userId: string,
    penNameId: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    const [existing] = await this.database.db
      .select()
      .from(penNames)
      .where(and(eq(penNames.id, penNameId), eq(penNames.userId, userId)))
      .limit(1);
    if (!existing) {
      throw usersError(HttpStatus.NOT_FOUND, 'PEN_NAME_NOT_FOUND', '没有找到这个笔名');
    }
    if (existing.isDefault) {
      throw usersError(
        HttpStatus.CONFLICT,
        'DEFAULT_PEN_NAME_REQUIRED',
        '请先把另一个笔名设为默认，再删除这个笔名',
      );
    }

    await this.database.db
      .delete(penNames)
      .where(and(eq(penNames.id, penNameId), eq(penNames.userId, userId)));
    await this.accountAudit.record({
      userId,
      action: 'account_pen_name_deleted',
      title: '删除笔名',
      targetType: 'pen_name',
      targetId: penNameId,
      ip,
      userAgent,
    });
  }

  async requestEmailChange(
    userId: string,
    newEmailInput: string,
    currentPassword: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<{ expiresInSeconds: number }> {
    if (
      !(await this.rateLimits.consume(
        'email-change',
        userId,
        EMAIL_CHANGE_SEND_LIMIT,
        EMAIL_CHANGE_SEND_WINDOW_SECONDS,
      ))
    ) {
      throw usersError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        '验证码发送过于频繁，请稍后再试',
      );
    }

    const newEmail = newEmailInput.trim().toLowerCase();
    const [account] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);
    if (!account || !(await verify(account.passwordHash, currentPassword))) {
      throw usersError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CURRENT_PASSWORD',
        '当前密码不正确，请重新输入',
      );
    }
    if (account.email.toLowerCase() === newEmail) {
      throw usersError(HttpStatus.BAD_REQUEST, 'EMAIL_UNCHANGED', '新邮箱与当前邮箱相同');
    }

    const [existing] = await this.database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, newEmail))
      .limit(1);
    if (existing) {
      throw usersError(
        HttpStatus.CONFLICT,
        'EMAIL_ALREADY_REGISTERED',
        '这个邮箱已经被其他账号使用',
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_MINUTES * 60_000);
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(emailChangeRequests)
        .set({ consumedAt: now })
        .where(
          and(
            eq(emailChangeRequests.userId, userId),
            isNull(emailChangeRequests.consumedAt),
          ),
        );
      await tx.insert(emailChangeRequests).values({
        userId,
        newEmail,
        codeHash: this.hashEmailChangeCode(newEmail, code),
        expiresAt,
      });
    });

    try {
      await this.mailer.sendEmailChangeCode({
        to: newEmail,
        code,
        expiresInMinutes: EMAIL_CHANGE_TTL_MINUTES,
      });
    } catch {
      await this.database.db
        .update(emailChangeRequests)
        .set({ consumedAt: new Date() })
        .where(
          and(
            eq(emailChangeRequests.userId, userId),
            eq(emailChangeRequests.newEmail, newEmail),
            isNull(emailChangeRequests.consumedAt),
          ),
        );
      throw usersError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'MAIL_UNAVAILABLE',
        '验证码邮件暂时无法发送，请稍后再试',
      );
    }

    await this.accountAudit.record({
      userId,
      action: 'account_email_change_requested',
      title: '发起邮箱变更验证',
      targetType: 'account_email_change',
      detail: '已向新邮箱发送验证码',
      metadata: { requested: true },
      ip,
      userAgent,
    });
    return { expiresInSeconds: EMAIL_CHANGE_TTL_MINUTES * 60 };
  }

  async verifyEmailChange(
    userId: string,
    newEmailInput: string,
    code: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    const newEmail = newEmailInput.trim().toLowerCase();
    const now = new Date();
    const [requestRow] = await this.database.db
      .select()
      .from(emailChangeRequests)
      .where(
        and(
          eq(emailChangeRequests.userId, userId),
          eq(emailChangeRequests.newEmail, newEmail),
          isNull(emailChangeRequests.consumedAt),
          gt(emailChangeRequests.expiresAt, now),
        ),
      )
      .orderBy(desc(emailChangeRequests.createdAt))
      .limit(1);
    if (!requestRow || requestRow.attempts >= MAX_CODE_ATTEMPTS) {
      throw this.invalidEmailCode();
    }

    const expected = this.hashEmailChangeCode(newEmail, code);
    if (!this.hashesMatch(requestRow.codeHash, expected)) {
      const attempts = requestRow.attempts + 1;
      await this.database.db
        .update(emailChangeRequests)
        .set({
          attempts,
          consumedAt: attempts >= MAX_CODE_ATTEMPTS ? now : requestRow.consumedAt,
        })
        .where(eq(emailChangeRequests.id, requestRow.id));
      throw this.invalidEmailCode();
    }

    try {
      await this.database.db.transaction(async (tx) => {
        const consumed = await tx
          .update(emailChangeRequests)
          .set({ consumedAt: now })
          .where(
            and(
              eq(emailChangeRequests.id, requestRow.id),
              isNull(emailChangeRequests.consumedAt),
              gt(emailChangeRequests.expiresAt, now),
              lt(emailChangeRequests.attempts, MAX_CODE_ATTEMPTS),
            ),
          )
          .returning({ id: emailChangeRequests.id });
        if (consumed.length === 0) {
          throw this.invalidEmailCode();
        }
        await tx
          .update(users)
          .set({ email: newEmail, updatedAt: now })
          .where(eq(users.id, userId));
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw usersError(
          HttpStatus.CONFLICT,
          'EMAIL_ALREADY_REGISTERED',
          '这个邮箱已经被其他账号使用',
        );
      }
      throw error;
    }

    await this.accountAudit.record({
      userId,
      action: 'account_email_changed',
      title: '修改账号邮箱',
      targetType: 'account',
      detail: '新邮箱已验证',
      metadata: { changed: true },
      ip,
      userAgent,
    });
  }

  async requestDeletion(
    userId: string,
    password: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<{ deletionScheduledFor: string }> {
    const now = new Date();
    const [account] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);
    if (!account || !(await verify(account.passwordHash, password))) {
      throw usersError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CURRENT_PASSWORD',
        '当前密码不正确，请重新输入',
      );
    }
    if (
      !account.lastExportAt ||
      now.getTime() - account.lastExportAt.getTime() > EXPORT_FRESHNESS_MS
    ) {
      throw usersError(
        HttpStatus.CONFLICT,
        'EXPORT_REQUIRED',
        '请先导出全部账号数据，再申请注销',
      );
    }

    const deletionScheduledFor = new Date(
      now.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          status: 'pending_deletion',
          deletionRequestedAt: now,
          deletionScheduledFor,
          updatedAt: now,
        })
        .where(and(eq(users.id, userId), eq(users.status, 'active')));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });

    await this.accountAudit.record({
      userId,
      action: 'account_deletion_requested',
      title: '申请注销账号',
      metadata: { deletionScheduledFor: deletionScheduledFor.toISOString() },
      ip,
      userAgent,
    });
    return { deletionScheduledFor: deletionScheduledFor.toISOString() };
  }

  private hashEmailChangeCode(email: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('SESSION_SECRET'))
      .update(`email-change:${email}:${code}`)
      .digest('hex');
  }

  private hashesMatch(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private invalidEmailCode() {
    return usersError(HttpStatus.BAD_REQUEST, 'INVALID_CODE', '验证码不正确或已过期');
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private toPublicUser(user: typeof users.$inferSelect): PublicUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: user.avatarUrl,
      status: user.status,
      deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toPenName(row: PenNameRow) {
    return {
      id: row.id,
      name: row.name,
      bio: row.bio,
      avatarUrl: row.avatarUrl,
      isDefault: row.isDefault,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
