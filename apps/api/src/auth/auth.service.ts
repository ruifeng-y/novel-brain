import { Inject, Injectable } from "@nestjs/common";
import { randomInt } from "node:crypto";
import {
  authPasswordSchema,
  type AuthSessionData,
  type AuthDeviceSession,
  type CursorPageQuery,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type SendPasswordResetRequest,
  type SendRegistrationCodeRequest,
} from "@novel-brain/contracts";
import { hash, verify, Algorithm } from "@node-rs/argon2";
import { uuidv7 } from "uuidv7";

import { ApiError } from "../common/api-error";
import { invalidCursorError, type CursorPageResult } from "../common/cursor-page";
import { hashVerificationCode, maskEmail, randomToken, safeEqual, sha256 } from "./auth-crypto";
// Nest uses runtime class references for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthRateLimiterService } from "./auth-rate-limiter.service";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuthRepository, type SessionRecord, type UserRecord } from "./auth.repository";
import { MAIL_GATEWAY, type MailGateway } from "./mail.gateway";

const CODE_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

export interface IssuedSession {
  data: AuthSessionData;
  token: string;
  maxAgeSeconds: number;
}

@Injectable()
export class AuthService {
  private readonly authSecret: string;

  constructor(
    private readonly repository: AuthRepository,
    private readonly rateLimiter: AuthRateLimiterService,
    @Inject(MAIL_GATEWAY) private readonly mailGateway: MailGateway,
  ) {
    this.authSecret =
      process.env.AUTH_SECRET ??
      (process.env.NODE_ENV === "production" ? "" : "local-development-auth-secret");
    if (!this.authSecret) {
      throw new Error("AUTH_SECRET is required");
    }
  }

  async sendRegistrationCode(
    request: SendRegistrationCodeRequest,
    ip: string,
  ): Promise<{ expiresAt: Date }> {
    const email = request.email.toLowerCase();
    await this.rateLimiter.consumeRegistrationCode(email, ip);

    if (await this.repository.findUserByEmail(email)) {
      throw new ApiError(409, "AUTH_EMAIL_TAKEN", "该邮箱已注册");
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.repository.createEmailCode({
      id: uuidv7(),
      email,
      codeHash: hashVerificationCode(email, code, this.authSecret),
      expiresAt,
      requestedIp: ip,
    });
    await this.mailGateway.sendVerificationCode(email, code, expiresAt);
    return { expiresAt };
  }

  async register(
    request: RegisterRequest,
    ip: string,
    userAgent: string,
    existingSessionToken?: string,
  ): Promise<IssuedSession> {
    if (!authPasswordSchema.safeParse(request.password).success) {
      throw new ApiError(400, "AUTH_PASSWORD_WEAK", "密码至少 12 位，并且必须同时包含字母和数字");
    }

    const email = request.email.toLowerCase();
    if (await this.repository.findUserByEmail(email)) {
      throw new ApiError(409, "AUTH_EMAIL_TAKEN", "该邮箱已注册");
    }

    const verificationCode = await this.repository.findLatestActiveCode(email);
    if (!verificationCode) {
      throw new ApiError(400, "AUTH_CODE_INVALID", "验证码无效或已过期");
    }
    if (verificationCode.attempts >= MAX_CODE_ATTEMPTS) {
      throw new ApiError(429, "AUTH_RATE_LIMITED", "验证码尝试次数过多，请重新获取");
    }

    const expectedHash = hashVerificationCode(email, request.code, this.authSecret);
    if (!safeEqual(verificationCode.codeHash, expectedHash)) {
      await this.repository.incrementCodeAttempts(verificationCode.id);
      throw new ApiError(400, "AUTH_CODE_INVALID", "验证码错误");
    }

    const passwordHash = await hash(request.password, { algorithm: Algorithm.Argon2id });
    let user: UserRecord | null;
    try {
      user = await this.repository.createUserAndConsumeCode(
        {
          id: uuidv7(),
          email,
          passwordHash,
          displayName: request.displayName,
        },
        verificationCode.id,
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError(409, "AUTH_EMAIL_TAKEN", "该邮箱已注册");
      }
      throw error;
    }

    if (!user) {
      throw new ApiError(400, "AUTH_CODE_INVALID", "验证码无效或已过期");
    }

    await this.repository.updateLastLogin(user.id);
    return this.issueSession(user, ip, userAgent, existingSessionToken);
  }

  async login(
    request: LoginRequest,
    ip: string,
    userAgent: string,
    existingSessionToken?: string,
  ): Promise<IssuedSession> {
    const email = request.email.toLowerCase();
    await this.rateLimiter.consumeLogin(email, ip);
    const user = await this.repository.findUserByEmail(email);
    if (!user || user.status !== "active") {
      throw new ApiError(401, "AUTH_LOGIN_FAILED", "邮箱或密码不正确");
    }

    const passwordMatches = await verify(user.passwordHash, request.password).catch(() => false);
    if (!passwordMatches) {
      throw new ApiError(401, "AUTH_LOGIN_FAILED", "邮箱或密码不正确");
    }

    await this.repository.updateLastLogin(user.id);
    return this.issueSession(user, ip, userAgent, existingSessionToken);
  }

  async sendPasswordReset(
    request: SendPasswordResetRequest,
    ip: string,
  ): Promise<{ expiresAt: Date }> {
    const email = request.email.toLowerCase();
    await this.rateLimiter.consumePasswordResetRequest(email, ip);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    const user = await this.repository.findUserByEmail(email);
    if (!user || user.status !== "active") {
      return { expiresAt };
    }

    const token = randomToken();
    await this.repository.createPasswordReset({
      id: uuidv7(),
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt,
      requestedIp: ip,
    });
    await this.mailGateway.sendPasswordResetLink(email, token, expiresAt);
    return { expiresAt };
  }

  async resetPassword(request: ResetPasswordRequest, ip: string): Promise<void> {
    const tokenHash = sha256(request.token);
    await this.rateLimiter.consumePasswordResetAttempt(tokenHash, ip);
    const passwordHash = await hash(request.password, { algorithm: Algorithm.Argon2id });
    const reset = await this.repository.resetPasswordWithToken(tokenHash, passwordHash);
    if (!reset) {
      throw new ApiError(400, "AUTH_CODE_INVALID", "重置链接无效或已过期");
    }
  }

  async resolveSession(token: string | undefined): Promise<{
    user: UserRecord;
    session: SessionRecord;
    tokenHash: string;
  } | null> {
    if (!token) {
      return null;
    }
    const tokenHash = sha256(token);
    const result = await this.repository.findSessionWithUser(tokenHash);
    if (!result) {
      return null;
    }
    await this.repository.touchSession(result.session.id);
    return { ...result, tokenHash };
  }

  async logout(sessionId: string): Promise<void> {
    await this.repository.revokeSession(sessionId);
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
    query: CursorPageQuery,
  ): Promise<CursorPageResult<AuthDeviceSession>> {
    const page = await this.repository.listActiveSessions(userId, query);
    if (page === "invalid_cursor") {
      throw invalidCursorError();
    }
    return {
      data: page.data.map((session) => ({
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
        current: session.id === currentSessionId,
        userAgent: session.userAgent,
        ip: session.ip,
        lastSeenAt: session.lastSeenAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  async revokeUserSession(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.repository.revokeUserSession(userId, sessionId);
    if (!revoked) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "登录设备不存在或无权访问");
    }
  }

  async logoutAll(userId: string): Promise<void> {
    await this.repository.revokeAllSessions(userId);
  }

  toSessionData(user: UserRecord, session: SessionRecord): AuthSessionData {
    return {
      user: {
        id: user.id,
        emailMasked: maskEmail(user.email),
        displayName: user.displayName,
        bio: user.bio,
        avatarUrl: user.avatarUrl,
        version: user.version,
        createdAt: user.createdAt.toISOString(),
      },
      session: {
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
        current: true,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
      },
    };
  }

  private async issueSession(
    user: UserRecord,
    ip: string,
    userAgent: string,
    existingSessionToken?: string,
  ): Promise<IssuedSession> {
    if (existingSessionToken) {
      const existing = await this.repository.findSessionWithUser(sha256(existingSessionToken));
      if (existing) {
        await this.repository.revokeSession(existing.session.id);
      }
    }

    const token = randomToken();
    const session = await this.repository.createSession({
      id: uuidv7(),
      userId: user.id,
      tokenHash: sha256(token),
      userAgent,
      ip,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    });

    return {
      data: this.toSessionData(user, session),
      token,
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
    };
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
