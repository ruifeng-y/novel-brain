import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { emailCodes, sessions, users, type UserRow } from '@novel/db';
import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { MAILER, type Mailer } from '../mail/mailer';
import { RedisService } from '../redis/redis.service';
import { MAX_CODE_ATTEMPTS, SESSION_TTL_DAYS } from './auth.constants';
import { authError } from './auth.errors';
import type { AuthIdentity, PublicUser } from './auth.types';

const CODE_TTL_MINUTES = 10;
const EMAIL_MINUTE_LIMIT = 1;
const EMAIL_DAILY_LIMIT = 10;
const IP_MINUTE_LIMIT = 1;
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_IP_LIMIT = 20;
const LOGIN_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
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

          const [user] = await tx
            .insert(users)
            .values({
              email,
              passwordHash,
              displayName: email.slice(0, email.indexOf('@')),
            })
            .returning();
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
        .where(and(eq(users.email, email), eq(users.status, 'active')))
        .limit(1);

      if (!user || !(await verify(user.passwordHash, password))) {
        throw authError(
          HttpStatus.UNAUTHORIZED,
          'INVALID_CREDENTIALS',
          'The email or password is incorrect',
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

  async logout(sessionId: string): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
  }

  async logoutAll(userId: string): Promise<void> {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
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
      createdAt: user.createdAt.toISOString(),
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }
}
