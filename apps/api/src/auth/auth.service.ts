import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { emailCodes, passwordResets, penNames, sessions, users, type UserRow } from '@novel/db';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { AccountAuditService } from '../account-audit/account-audit.service';
import { DatabaseService } from '../database/database.service';
import { MAILER, type Mailer } from '../mail/mailer';
import { RedisService } from '../redis/redis.service';
import { MAX_CODE_ATTEMPTS, SESSION_TTL_DAYS } from './auth.constants';
import { authError } from './auth.errors';
import type { AuthIdentity, PublicUser } from './auth.types';

const CODE_TTL_MINUTES = 10;
const PASSWORD_RESET_TTL_MINUTES = 30;
const EMAIL_MINUTE_LIMIT = 1;
const EMAIL_DAILY_LIMIT = 10;
const IP_MINUTE_LIMIT = 1;
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_IP_LIMIT = 20;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const FORGOT_EMAIL_LIMIT = 5;
const FORGOT_IP_LIMIT = 20;
const FORGOT_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly accountAudit: AccountAuditService,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  async sendRegistrationCode(
    emailInput: string,
    ip: string,
  ): Promise<{ expiresInSeconds: number }> {
    const email = emailInput.trim().toLowerCase();
    await this.enforceCodeSendLimits(email, ip);

    return this.database.withAuthContext(async () => {
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

      await this.database.db.transaction(async (tx) => {
        await tx
          .update(emailCodes)
          .set({ consumedAt: now })
          .where(
            and(
              eq(emailCodes.email, email),
              eq(emailCodes.purpose, 'register'),
              isNull(emailCodes.consumedAt),
            ),
          );
        await tx.insert(emailCodes).values({
          email,
          purpose: 'register',
          codeHash: this.hashCode(email, 'register', code),
          expiresAt,
        });
      });

      try {
        await this.mailer.sendVerificationCode({
          to: email,
          code,
          expiresInMinutes: CODE_TTL_MINUTES,
        });
      } catch {
        await this.database.db
          .update(emailCodes)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(emailCodes.email, email),
              eq(emailCodes.purpose, 'register'),
              isNull(emailCodes.consumedAt),
            ),
          );
        throw authError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'MAIL_UNAVAILABLE',
          'Verification email could not be sent',
        );
      }

      return { expiresInSeconds: CODE_TTL_MINUTES * 60 };
    });
  }

  async register(emailInput: string, code: string, password: string): Promise<PublicUser> {
    const email = emailInput.trim().toLowerCase();
    return this.database.withAuthContext(async () => {
      const [existingUser] = await this.database.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (existingUser) {
        throw authError(
          HttpStatus.CONFLICT,
          'EMAIL_ALREADY_REGISTERED',
          'An account already exists for this email',
        );
      }

      const codeRecord = await this.findRegistrationCode(email, code);
      const passwordHash = await hash(password, {
        algorithm: Algorithm.Argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });

      try {
        const created = await this.database.db.transaction(async (tx) => {
          const now = new Date();
          const consumed = await tx
            .update(emailCodes)
            .set({ consumedAt: now })
            .where(
              and(
                eq(emailCodes.id, codeRecord.id),
                isNull(emailCodes.consumedAt),
                gt(emailCodes.expiresAt, now),
                lt(emailCodes.attempts, MAX_CODE_ATTEMPTS),
              ),
            )
            .returning({ id: emailCodes.id });

          if (consumed.length === 0) {
            throw authError(
              HttpStatus.BAD_REQUEST,
              'INVALID_CODE',
              'The verification code is invalid or expired',
            );
          }

          const displayName = email.slice(0, email.indexOf('@'));
          const [user] = await tx
            .insert(users)
            .values({
              email,
              passwordHash,
              displayName,
            })
            .returning();
          await tx.insert(penNames).values({
            userId: user.id,
            name: displayName,
            isDefault: true,
          });
          return user;
        });

        return this.toPublicUser(created);
      } catch (error) {
        if (this.isUniqueViolation(error)) {
          throw authError(
            HttpStatus.CONFLICT,
            'EMAIL_ALREADY_REGISTERED',
            'An account already exists for this email',
          );
        }
        throw error;
      }
    });
  }

  async login(
    emailInput: string,
    password: string,
    ip: string,
    userAgent?: string,
  ): Promise<{ token: string; user: PublicUser }> {
    const email = emailInput.trim().toLowerCase();
    await this.enforceLoginLimits(email, ip);

    return this.database.withAuthContext(async () => {
      const [user] = await this.database.db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (!user || !(await verify(user.passwordHash, password))) {
        if (user) {
          await this.accountAudit.record({
            userId: user.id,
            action: 'account_login_failed',
            targetType: 'session',
            title: '登录失败',
            detail: '密码不正确',
            metadata: { email },
            ip,
            userAgent,
          });
        }
        throw authError(
          HttpStatus.UNAUTHORIZED,
          'INVALID_CREDENTIALS',
          'The email or password is incorrect',
        );
      }
      if (user.status === 'pending_deletion') {
        if (
          !user.deletionScheduledFor ||
          user.deletionScheduledFor.getTime() <= Date.now()
        ) {
          throw authError(
            HttpStatus.GONE,
            'ACCOUNT_DELETION_EXPIRED',
            'The account deletion window has ended',
          );
        }
        throw authError(
          HttpStatus.FORBIDDEN,
          'ACCOUNT_PENDING_DELETION',
          'This account can still be recovered',
          {
            deletionScheduledFor: user.deletionScheduledFor.toISOString(),
          },
        );
      }
      if (user.status !== 'active') {
        throw authError(
          HttpStatus.FORBIDDEN,
          'ACCOUNT_UNAVAILABLE',
          'This account is not available',
        );
      }

      const token = randomBytes(32).toString('base64url');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

      await this.database.db.transaction(async (tx) => {
        await tx.insert(sessions).values({
          userId: user.id,
          tokenHash: this.hashSessionToken(token),
          userAgent: userAgent?.slice(0, 500),
          ip,
          expiresAt,
        });
        await tx
          .update(users)
          .set({ lastLoginAt: now, updatedAt: now })
          .where(eq(users.id, user.id));
      });
      await this.accountAudit.record({
        userId: user.id,
        action: 'account_login',
        targetType: 'session',
        title: '登录账号',
        detail: '邮箱和密码登录成功',
        metadata: { email },
        ip,
        userAgent,
      });

      return { token, user: this.toPublicUser(user) };
    });
  }

  async getSessionIdentity(token: string): Promise<AuthIdentity | null> {
    return this.database.withAuthContext(async () => {
      const now = new Date();
      const [session] = await this.database.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, this.hashSessionToken(token)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        )
        .limit(1);

      if (!session) {
        return null;
      }

      const [user] = await this.database.db
        .select()
        .from(users)
        .where(and(eq(users.id, session.userId), eq(users.status, 'active')))
        .limit(1);

      if (!user) {
        return null;
      }

      await this.database.db
        .update(sessions)
        .set({ lastSeenAt: now })
        .where(eq(sessions.id, session.id));

      return { sessionId: session.id, user: this.toPublicUser(user) };
    });
  }

  async logout(
    sessionId: string,
    userId: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
    await this.accountAudit.record({
      userId,
      action: 'account_logout',
      targetType: 'session',
      targetId: sessionId,
      title: '退出当前设备',
      detail: '当前会话已失效',
      ip,
      userAgent,
    });
  }

  async logoutAll(
    userId: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await this.accountAudit.record({
      userId,
      action: 'account_logout_all',
      targetType: 'account',
      targetId: userId,
      title: '退出所有设备',
      detail: '账号的全部会话已失效',
      ip,
      userAgent,
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await this.database.db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ip: sessions.ip,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt,
      })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt))
      .limit(20);
    return {
      items: rows.map((row) => ({
        id: row.id,
        current: row.id === currentSessionId,
        device: this.describeSessionDevice(row.userAgent),
        ip: this.maskIp(row.ip),
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
    };
  }

  private describeSessionDevice(userAgent: string | null): string {
    const value = userAgent ?? '';
    if (/Edg\//.test(value)) {
      return 'Microsoft Edge';
    }
    if (/Chrome\//.test(value)) {
      return 'Chrome';
    }
    if (/Firefox\//.test(value)) {
      return 'Firefox';
    }
    if (/Safari\//.test(value)) {
      return 'Safari';
    }
    if (/curl\//i.test(value)) {
      return '命令行客户端';
    }
    return value ? '浏览器' : '未知设备';
  }

  private maskIp(ip: string | null): string {
    if (!ip) {
      return '未知地址';
    }
    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip.includes(':') ? '本地网络' : ip;
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.status, 'active')))
      .limit(1);

    if (!user || !(await verify(user.passwordHash, currentPassword))) {
      throw authError(
        HttpStatus.UNAUTHORIZED,
        'INVALID_CURRENT_PASSWORD',
        'The current password is incorrect',
      );
    }

    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: await this.hashPassword(newPassword),
          updatedAt: now,
        })
        .where(eq(users.id, userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    });

    await this.accountAudit.record({
      userId,
      action: 'account_password_changed',
      title: '修改账号密码',
      ip,
      userAgent,
    });
  }

  async forgotPassword(emailInput: string, ip: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const checks = await Promise.all([
      this.consumeLimit(
        `auth:forgot:email:${this.hashKey(email)}`,
        FORGOT_EMAIL_LIMIT,
        FORGOT_WINDOW_SECONDS,
      ),
      this.consumeLimit(
        `auth:forgot:ip:${this.hashKey(ip)}`,
        FORGOT_IP_LIMIT,
        FORGOT_WINDOW_SECONDS,
      ),
    ]);
    if (checks.some((allowed) => !allowed)) {
      throw authError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Please wait before requesting another password reset',
      );
    }

    await this.database.withAuthContext(async () => {
      const now = new Date();
      const [user] = await this.database.db
        .select()
        .from(users)
        .where(
          and(
            eq(users.email, email),
            or(
              eq(users.status, 'active'),
              and(
                eq(users.status, 'pending_deletion'),
                gt(users.deletionScheduledFor, now),
              ),
            ),
          ),
        )
        .limit(1);
      if (!user) {
        return;
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60_000);
      await this.database.db.transaction(async (tx) => {
        await tx
          .update(passwordResets)
          .set({ consumedAt: now })
          .where(
            and(eq(passwordResets.userId, user.id), isNull(passwordResets.consumedAt)),
          );
        await tx.insert(passwordResets).values({
          userId: user.id,
          tokenHash: this.hashPasswordResetToken(token),
          expiresAt,
        });
      });

      const resetUrl = new URL('/reset-password', this.config.getOrThrow<string>('WEB_URL'));
      resetUrl.searchParams.set('token', token);
      try {
        await this.mailer.sendPasswordReset({
          to: email,
          resetUrl: resetUrl.toString(),
          expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
        });
      } catch {
        await this.database.db
          .update(passwordResets)
          .set({ consumedAt: new Date() })
          .where(
            and(
              eq(passwordResets.userId, user.id),
              eq(passwordResets.tokenHash, this.hashPasswordResetToken(token)),
            ),
          );
        throw authError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'MAIL_UNAVAILABLE',
          'Password reset email could not be sent',
        );
      }
    });
  }

  async resetPassword(
    token: string,
    newPassword: string,
    ip?: string | null,
    userAgent?: string | null,
  ): Promise<void> {
    await this.database.withAuthContext(async () => {
      const now = new Date();
      const [reset] = await this.database.db
        .select()
        .from(passwordResets)
        .where(
          and(
            eq(passwordResets.tokenHash, this.hashPasswordResetToken(token)),
            isNull(passwordResets.consumedAt),
            gt(passwordResets.expiresAt, now),
          ),
        )
        .limit(1);
      if (!reset) {
        throw this.invalidResetToken();
      }

      const [user] = await this.database.db
        .select()
        .from(users)
        .where(eq(users.id, reset.userId))
        .limit(1);
      const pendingDeletionExpired =
        user?.status === 'pending_deletion' &&
        (!user.deletionScheduledFor || user.deletionScheduledFor.getTime() <= now.getTime());
      if (
        !user ||
        user.status === 'deleted' ||
        user.status === 'disabled' ||
        pendingDeletionExpired
      ) {
        throw this.invalidResetToken();
      }

      await this.database.db.transaction(async (tx) => {
        const consumed = await tx
          .update(passwordResets)
          .set({ consumedAt: now })
          .where(
            and(
              eq(passwordResets.id, reset.id),
              isNull(passwordResets.consumedAt),
              gt(passwordResets.expiresAt, now),
            ),
          )
          .returning({ id: passwordResets.id });
        if (consumed.length === 0) {
          throw this.invalidResetToken();
        }
        await tx
          .update(users)
          .set({
            passwordHash: await this.hashPassword(newPassword),
            updatedAt: now,
          })
          .where(eq(users.id, user.id));
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      });

      await this.accountAudit.record({
        userId: user.id,
        action: 'account_password_reset',
        title: '通过邮件重置密码',
        ip,
        userAgent,
      });
    });
  }

  async recoverAccount(
    emailInput: string,
    password: string,
    ip: string,
    userAgent?: string | null,
  ): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    await this.enforceLoginLimits(email, ip);

    await this.database.withAuthContext(async () => {
      const [user] = await this.database.db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (!user || !(await verify(user.passwordHash, password))) {
        throw authError(
          HttpStatus.UNAUTHORIZED,
          'INVALID_CREDENTIALS',
          'The email or password is incorrect',
        );
      }
      if (user.status === 'active') {
        throw authError(
          HttpStatus.BAD_REQUEST,
          'ACCOUNT_NOT_RECOVERABLE',
          'This account is already active',
        );
      }
      if (user.status !== 'pending_deletion') {
        throw authError(
          HttpStatus.FORBIDDEN,
          'ACCOUNT_UNAVAILABLE',
          'This account is not available',
        );
      }
      if (
        !user.deletionScheduledFor ||
        user.deletionScheduledFor.getTime() <= Date.now()
      ) {
        throw authError(
          HttpStatus.GONE,
          'ACCOUNT_DELETION_EXPIRED',
          'The account deletion window has ended',
        );
      }

      const now = new Date();
      await this.database.db
        .update(users)
        .set({
          status: 'active',
          deletionRequestedAt: null,
          deletionScheduledFor: null,
          updatedAt: now,
        })
        .where(and(eq(users.id, user.id), eq(users.status, 'pending_deletion')));
      await this.accountAudit.record({
        userId: user.id,
        action: 'account_recovered',
        title: '恢复注销账号',
        ip,
        userAgent: userAgent ?? null,
      });
    });
  }

  private async enforceCodeSendLimits(email: string, ip: string): Promise<void> {
    const checks = [
      await this.consumeLimit(
        `auth:code:email:minute:${this.hashKey(email)}`,
        EMAIL_MINUTE_LIMIT,
        60,
      ),
      await this.consumeLimit(`auth:code:ip:minute:${this.hashKey(ip)}`, IP_MINUTE_LIMIT, 60),
      await this.consumeLimit(
        `auth:code:email:day:${this.hashKey(email)}`,
        EMAIL_DAILY_LIMIT,
        24 * 60 * 60,
      ),
    ];

    if (checks.some((allowed) => !allowed)) {
      throw authError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Please wait before requesting another verification code',
      );
    }
  }

  private async consumeLimit(key: string, limit: number, ttlSeconds: number): Promise<boolean> {
    const count = Number(
      await this.redis.client.eval(
        `local count = redis.call('INCR', KEYS[1])
         if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
         return count`,
        1,
        key,
        String(ttlSeconds),
      ),
    );
    return count <= limit;
  }

  private async findRegistrationCode(email: string, code: string) {
    const now = new Date();
    const [record] = await this.database.db
      .select()
      .from(emailCodes)
      .where(
        and(
          eq(emailCodes.email, email),
          eq(emailCodes.purpose, 'register'),
          isNull(emailCodes.consumedAt),
          gt(emailCodes.expiresAt, now),
        ),
      )
      .orderBy(desc(emailCodes.createdAt))
      .limit(1);

    if (!record || record.attempts >= MAX_CODE_ATTEMPTS) {
      throw authError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CODE',
        'The verification code is invalid or expired',
      );
    }

    const expected = this.hashCode(email, 'register', code);
    if (!this.hashesMatch(record.codeHash, expected)) {
      const attempts = record.attempts + 1;
      await this.database.db
        .update(emailCodes)
        .set({
          attempts,
          consumedAt: attempts >= MAX_CODE_ATTEMPTS ? now : record.consumedAt,
        })
        .where(eq(emailCodes.id, record.id));

      throw authError(
        HttpStatus.BAD_REQUEST,
        'INVALID_CODE',
        'The verification code is invalid or expired',
      );
    }

    return record;
  }

  private async enforceLoginLimits(email: string, ip: string): Promise<void> {
    const checks = await Promise.all([
      this.consumeLimit(
        `auth:login:email:${this.hashKey(email)}`,
        LOGIN_EMAIL_LIMIT,
        LOGIN_WINDOW_SECONDS,
      ),
      this.consumeLimit(`auth:login:ip:${this.hashKey(ip)}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_SECONDS),
    ]);

    if (checks.some((allowed) => !allowed)) {
      throw authError(
        HttpStatus.TOO_MANY_REQUESTS,
        'RATE_LIMITED',
        'Too many sign-in attempts. Try again later',
      );
    }
  }

  private hashCode(email: string, purpose: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('SESSION_SECRET'))
      .update(`${purpose}:${email}:${code}`)
      .digest('hex');
  }

  private hashKey(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private hashSessionToken(token: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('SESSION_SECRET'))
      .update(`session:${token}`)
      .digest('hex');
  }

  private hashPasswordResetToken(token: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('SESSION_SECRET'))
      .update(`password-reset:${token}`)
      .digest('hex');
  }

  private hashesMatch(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    return (
      actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private toPublicUser(user: UserRow): PublicUser {
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

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private hashPassword(password: string): Promise<string> {
    return hash(password, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  private invalidResetToken() {
    return authError(
      HttpStatus.BAD_REQUEST,
      'INVALID_RESET_TOKEN',
      'The password reset link is invalid or expired',
    );
  }
}
