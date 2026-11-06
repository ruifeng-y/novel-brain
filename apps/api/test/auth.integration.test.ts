import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { AppModule } from "../src/app.module";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { signClientIp } from "@novel-brain/core";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();
  resetLinks = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }

  async sendPasswordResetLink(email: string, token: string): Promise<void> {
    this.resetLinks.set(email, token);
  }
}

describe("auth HTTP integration", () => {
  let app: INestApplication;
  let agent: SuperAgentTest;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "integration-test-auth-secret";
    process.env.PROXY_IP_SECRET = "integration-test-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_PROVIDER_ALLOWLIST =
      "https://api.openai.com/v1,https://127.0.0.1/v1,https://10.0.0.1/v1,https://192.168.1.1/v1,https://169.254.169.254/v1,https://[fec0::1]/v1,https://[fe80::1]/v1";

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl);
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_GATEWAY)
      .useValue(mail)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    agent = request.agent(app.getHttpServer());
  });

  beforeEach(async () => {
    mail.codes.clear();
    mail.resetLinks.clear();
    await databasePool.query("TRUNCATE TABLE users CASCADE");
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  async function csrf(): Promise<string> {
    const response = await agent.get("/api/v1/auth/csrf").expect(200);
    return response.body.data.token as string;
  }

  function post(path: string, csrfToken?: string) {
    const httpRequest = agent.post(path).set("Origin", origin).set("User-Agent", "vitest-agent");
    if (csrfToken) {
      httpRequest.set("X-CSRF-Token", csrfToken);
    }
    return httpRequest;
  }

  async function createAuthenticatedAgent(
    email: string,
    password: string,
    displayName: string,
  ): Promise<SuperAgentTest> {
    const userAgent = request.agent(app.getHttpServer());
    const csrfResponse = await userAgent.get("/api/v1/auth/csrf").expect(200);
    const token = csrfResponse.body.data.token as string;
    await userAgent
      .post("/api/v1/auth/register/send-code")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ email })
      .expect(200);
    await userAgent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ email, code: mail.codes.get(email), password, displayName })
      .expect(200);
    return userAgent;
  }

  async function loginAgent(
    email: string,
    password: string,
    userAgentName: string,
  ): Promise<SuperAgentTest> {
    const userAgent = request.agent(app.getHttpServer());
    const token = (await userAgent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    await userAgent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("User-Agent", userAgentName)
      .set("X-CSRF-Token", token)
      .send({ email, password })
      .expect(200);
    return userAgent;
  }

  it("registers, restores the session, logs out and rejects the old cookie", async () => {
    const csrfToken = await csrf();
    const email = "author@example.com";
    const password = "StrongPassword123";

    await post("/api/v1/auth/register/send-code", csrfToken).send({ email }).expect(200);
    const code = mail.codes.get(email);
    expect(code).toMatch(/^\d{6}$/);

    const register = await post("/api/v1/auth/register", csrfToken)
      .send({ email, code, password, displayName: "林见鹿" })
      .expect(200);
    const oldCookie = String(register.headers["set-cookie"]).split(";")[0];

    const me = await agent.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.user.displayName).toBe("林见鹿");
    expect(me.body.data.user.emailMasked).toBe("au***@example.com");

    await post("/api/v1/auth/logout", csrfToken).expect(200);
    const stale = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Cookie", oldCookie)
      .expect(401);
    expect(stale.body.error.code).toBe("AUTH_SESSION_INVALID");
  });

  it("logs in with an existing account and rotates the session", async () => {
    const csrfToken = await csrf();
    const email = "login@example.com";
    const password = "StrongPassword123";

    await post("/api/v1/auth/register/send-code", csrfToken).send({ email }).expect(200);
    const register = await post("/api/v1/auth/register", csrfToken)
      .send({ email, code: mail.codes.get(email), password, displayName: "登录作者" })
      .expect(200);
    const oldCookie = String(register.headers["set-cookie"]).split(";")[0];
    const firstSession = (await agent.get("/api/v1/auth/me").expect(200)).body.data.session.id;

    const login = await post("/api/v1/auth/login", csrfToken).send({ email, password }).expect(200);

    expect(login.body.data.session.id).not.toBe(firstSession);
    expect((await agent.get("/api/v1/auth/me").expect(200)).body.data.user.displayName).toBe(
      "登录作者",
    );
    const stale = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Cookie", oldCookie)
      .expect(401);
    expect(stale.body.error.code).toBe("AUTH_SESSION_INVALID");
  });

  it("rejects unsafe requests without CSRF and same-origin validation", async () => {
    const csrfToken = await csrf();
    const missingCsrf = await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .send({ email: "none@example.com", password: "StrongPassword123" })
      .expect(403);
    expect(missingCsrf.body.error.code).toBe("AUTH_CSRF_INVALID");

    const invalidOrigin = await agent
      .post("/api/v1/auth/login")
      .set("Origin", "http://evil.example")
      .set("X-CSRF-Token", csrfToken)
      .send({ email: "none@example.com", password: "StrongPassword123" })
      .expect(403);
    expect(invalidOrigin.body.error.code).toBe("AUTH_ORIGIN_INVALID");
  });

  it("rate limits registration code delivery per email", async () => {
    const csrfToken = await csrf();
    const email = "limited@example.com";

    await post("/api/v1/auth/register/send-code", csrfToken).send({ email }).expect(200);
    const limited = await post("/api/v1/auth/register/send-code", csrfToken)
      .send({ email })
      .expect(429);
    expect(limited.body.error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("keeps IP rate limits isolated per verified client", async () => {
    const csrfToken = await csrf();
    const secret = "integration-test-proxy-secret";
    const firstClient = signClientIp("203.0.113.10", secret);
    const secondClient = signClientIp("203.0.113.11", secret);

    for (let index = 0; index < 5; index += 1) {
      await post("/api/v1/auth/register/send-code", csrfToken)
        .set("X-Client-IP", firstClient)
        .send({ email: `client-a-${index}@example.com` })
        .expect(200);
    }

    const limited = await post("/api/v1/auth/register/send-code", csrfToken)
      .set("X-Client-IP", firstClient)
      .send({ email: "client-a-6@example.com" })
      .expect(429);
    expect(limited.body.error.code).toBe("AUTH_RATE_LIMITED");

    await post("/api/v1/auth/register/send-code", csrfToken)
      .set("X-Client-IP", secondClient)
      .send({ email: "client-a-7@example.com" })
      .expect(200);
  });

  it("rejects expired codes and weak passwords with stable errors", async () => {
    const csrfToken = await csrf();
    const email = "expired@example.com";

    await post("/api/v1/auth/register/send-code", csrfToken).send({ email }).expect(200);
    await databasePool.query(
      "UPDATE email_verification_codes SET expires_at = now() - interval '1 minute' WHERE email = $1",
      [email],
    );
    const expired = await post("/api/v1/auth/register", csrfToken)
      .send({
        email,
        code: mail.codes.get(email),
        password: "StrongPassword123",
        displayName: "过期作者",
      })
      .expect(400);
    expect(expired.body.error.code).toBe("AUTH_CODE_INVALID");

    const weak = await post("/api/v1/auth/register", csrfToken)
      .send({
        email: "weak@example.com",
        code: "123456",
        password: "short",
        displayName: "弱密码作者",
      })
      .expect(400);
    expect(weak.body.error.code).toBe("AUTH_PASSWORD_WEAK");
  });

  it("resets a password once, stores only the token hash and revokes existing sessions", async () => {
    const email = "reset@example.com";
    const oldPassword = "OldPassword123";
    const newPassword = "NewPassword456";
    const owner = await createAuthenticatedAgent(email, oldPassword, "找回密码作者");
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const forgot = await owner
      .post("/api/v1/auth/password/forgot")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email })
      .expect(200);
    expect(forgot.body.data.sent).toBe(true);

    const resetToken = mail.resetLinks.get(email);
    expect(resetToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const stored = await databasePool.query<{ token_hash: string }>(
      "SELECT token_hash FROM password_resets WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    );
    expect(stored.rows[0]?.token_hash).toBeTruthy();
    expect(stored.rows[0]?.token_hash).not.toContain(resetToken);

    await owner
      .post("/api/v1/auth/password/reset")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ token: resetToken, password: newPassword })
      .expect(200);

    const staleSession = await owner.get("/api/v1/auth/me").expect(401);
    expect(staleSession.body.error.code).toBe("AUTH_SESSION_INVALID");

    const replay = await owner
      .post("/api/v1/auth/password/reset")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ token: resetToken, password: "AnotherPassword789" })
      .expect(400);
    expect(replay.body.error.code).toBe("AUTH_CODE_INVALID");

    const oldLoginCsrf = await csrf();
    await post("/api/v1/auth/login", oldLoginCsrf)
      .send({ email, password: oldPassword })
      .expect(401);
    await post("/api/v1/auth/login", oldLoginCsrf)
      .send({ email, password: newPassword })
      .expect(200);
  });

  it("does not reveal whether an account exists when a reset is requested", async () => {
    const knownEmail = "known-reset@example.com";
    const unknownEmail = "unknown-reset@example.com";
    await createAuthenticatedAgent(knownEmail, "StrongPassword123", "已知作者");
    const csrfToken = await csrf();

    const known = await post("/api/v1/auth/password/forgot", csrfToken)
      .send({ email: knownEmail })
      .expect(200);
    const unknown = await post("/api/v1/auth/password/forgot", csrfToken)
      .send({ email: unknownEmail })
      .expect(200);

    expect(known.body.data.sent).toBe(true);
    expect(unknown.body.data).toMatchObject({ sent: true });
    expect(Object.keys(unknown.body.data).sort()).toEqual(Object.keys(known.body.data).sort());
    expect(mail.resetLinks.has(knownEmail)).toBe(true);
    expect(mail.resetLinks.has(unknownEmail)).toBe(false);
  });

  it("rejects invalid and expired password reset tokens without changing the password", async () => {
    const email = "expired-reset@example.com";
    const password = "StrongPassword123";
    await createAuthenticatedAgent(email, password, "过期链接作者");
    const csrfToken = await csrf();

    const invalid = await post("/api/v1/auth/password/reset", csrfToken)
      .send({ token: "x".repeat(64), password: "ChangedPassword456" })
      .expect(400);
    expect(invalid.body.error.code).toBe("AUTH_CODE_INVALID");

    await post("/api/v1/auth/password/forgot", csrfToken).send({ email }).expect(200);
    const resetToken = mail.resetLinks.get(email);
    await databasePool.query(
      "UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      [email],
    );
    const expired = await post("/api/v1/auth/password/reset", csrfToken)
      .send({ token: resetToken, password: "ChangedPassword456" })
      .expect(400);
    expect(expired.body.error.code).toBe("AUTH_CODE_INVALID");

    await post("/api/v1/auth/login", csrfToken).send({ email, password }).expect(200);
  });

  it("rate limits reset email delivery and repeated token attempts", async () => {
    const csrfToken = await csrf();
    const email = "rate-limited-reset@example.com";

    await post("/api/v1/auth/password/forgot", csrfToken).send({ email }).expect(200);
    const limitedEmail = await post("/api/v1/auth/password/forgot", csrfToken)
      .send({ email })
      .expect(429);
    expect(limitedEmail.body.error.code).toBe("AUTH_RATE_LIMITED");

    for (let index = 0; index < 10; index += 1) {
      const invalid = await post("/api/v1/auth/password/reset", csrfToken)
        .send({ token: "x".repeat(64), password: "ChangedPassword456" })
        .expect(400);
      expect(invalid.body.error.code).toBe("AUTH_CODE_INVALID");
    }
    const limitedAttempt = await post("/api/v1/auth/password/reset", csrfToken)
      .send({ token: "x".repeat(64), password: "ChangedPassword456" })
      .expect(429);
    expect(limitedAttempt.body.error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("lists current and other devices, then revokes a device immediately", async () => {
    const email = "sessions@example.com";
    const password = "StrongPassword123";
    const current = await createAuthenticatedAgent(email, password, "会话作者");
    const second = await loginAgent(email, password, "Device B");
    await loginAgent(email, password, "Device C");
    const currentId = (await current.get("/api/v1/auth/me").expect(200)).body.data.session
      .id as string;

    const listed = await current.get("/api/v1/auth/sessions").expect(200);
    expect(listed.body.data).toHaveLength(3);
    expect(listed.body.data.filter((session: { current: boolean }) => session.current)).toEqual([
      expect.objectContaining({ id: currentId, current: true }),
    ]);
    const secondSession = listed.body.data.find(
      (session: { userAgent: string }) => session.userAgent === "Device B",
    );
    expect(secondSession).toMatchObject({ current: false });

    const csrfToken = (await current.get("/api/v1/auth/csrf").expect(200)).body.data
      .token as string;
    await current
      .delete(`/api/v1/auth/sessions/${secondSession.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(200);

    const revoked = await second.get("/api/v1/auth/me").expect(401);
    expect(revoked.body.error.code).toBe("AUTH_SESSION_INVALID");
  });

  it("revokes every device when the author signs out everywhere", async () => {
    const email = "logout-all@example.com";
    const password = "StrongPassword123";
    const first = await createAuthenticatedAgent(email, password, "第一台设备");
    const second = await loginAgent(email, password, "Device B");
    const third = await loginAgent(email, password, "Device C");
    const csrfToken = (await first.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const response = await first
      .post("/api/v1/auth/logout-all")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(200);
    expect(response.body.data.loggedOut).toBe(true);

    await first.get("/api/v1/auth/me").expect(401);
    await second.get("/api/v1/auth/me").expect(401);
    await third.get("/api/v1/auth/me").expect(401);
  });

  it("keeps session revocation tenant-scoped and safe under concurrent requests", async () => {
    const email = "concurrent-sessions@example.com";
    const password = "StrongPassword123";
    const owner = await createAuthenticatedAgent(email, password, "会话所有者");
    const second = await loginAgent(email, password, "Device B");
    const third = await loginAgent(email, password, "Device C");
    const other = await createAuthenticatedAgent(
      "concurrent-other@example.com",
      password,
      "其他作者",
    );
    const sessions = (await owner.get("/api/v1/auth/sessions").expect(200)).body.data as Array<{
      id: string;
      userAgent: string;
    }>;
    const secondSession = sessions.find((session) => session.userAgent === "Device B");
    const thirdSession = sessions.find((session) => session.userAgent === "Device C");
    const ownerCsrf = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    const otherCsrf = (await other.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const foreign = await other
      .delete(`/api/v1/auth/sessions/${secondSession.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(403);
    expect(foreign.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const responses = await Promise.all(
      [secondSession.id, thirdSession.id].map((sessionId) =>
        owner
          .delete(`/api/v1/auth/sessions/${sessionId}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", ownerCsrf),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await second.get("/api/v1/auth/me").expect(401);
    await third.get("/api/v1/auth/me").expect(401);
    await owner.get("/api/v1/auth/me").expect(200);
  });

  it("rejects malformed session identifiers with a stable validation error", async () => {
    const owner = await createAuthenticatedAgent(
      "invalid-session@example.com",
      "StrongPassword123",
      "会话校验作者",
    );
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const invalid = await owner
      .delete("/api/v1/auth/sessions/not-a-session-id")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(400);
    expect(invalid.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("revokes the same session idempotently under concurrent requests", async () => {
    const email = "same-session@example.com";
    const password = "StrongPassword123";
    const owner = await createAuthenticatedAgent(email, password, "同会话作者");
    const second = await loginAgent(email, password, "Device B");
    const third = await loginAgent(email, password, "Device C");
    const sessions = (await owner.get("/api/v1/auth/sessions").expect(200)).body.data as Array<{
      id: string;
      userAgent: string;
    }>;
    const secondSession = sessions.find((session) => session.userAgent === "Device B");
    const ownerCsrf = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const responses = await Promise.all(
      [secondSession.id, secondSession.id].map((sessionId) =>
        owner
          .delete(`/api/v1/auth/sessions/${sessionId}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", ownerCsrf),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await second.get("/api/v1/auth/me").expect(401);
    await owner.get("/api/v1/auth/me").expect(200);
    await third.get("/api/v1/auth/me").expect(200);
  });

  it("consumes a password reset token exactly once under concurrent use", async () => {
    const email = "reset-concurrent@example.com";
    const oldPassword = "StrongPassword123";
    const firstPassword = "FirstPassword456";
    const secondPassword = "SecondPassword789";
    const owner = await createAuthenticatedAgent(email, oldPassword, "并发重置作者");
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    await owner
      .post("/api/v1/auth/password/forgot")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email })
      .expect(200);
    const resetToken = mail.resetLinks.get(email);

    const responses = await Promise.all(
      [firstPassword, secondPassword].map((password) =>
        owner
          .post("/api/v1/auth/password/reset")
          .set("Origin", origin)
          .set("X-CSRF-Token", csrfToken)
          .send({ token: resetToken, password }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    const rejected = responses.find((response) => response.status === 400);
    expect(rejected?.body.error.code).toBe("AUTH_CODE_INVALID");

    const winningPassword = responses[0]?.status === 200 ? firstPassword : secondPassword;
    const losingPassword = winningPassword === firstPassword ? secondPassword : firstPassword;
    const loginCsrf = await csrf();
    await post("/api/v1/auth/login", loginCsrf).send({ email, password: oldPassword }).expect(401);
    await post("/api/v1/auth/login", loginCsrf)
      .send({ email, password: losingPassword })
      .expect(401);
    await post("/api/v1/auth/login", loginCsrf)
      .send({ email, password: winningPassword })
      .expect(200);
  });

  it("invalidates the previous reset link when a new reset is requested", async () => {
    const email = "reset-superseded@example.com";
    const owner = await createAuthenticatedAgent(email, "StrongPassword123", "重置链接作者");
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    await owner
      .post("/api/v1/auth/password/forgot")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email })
      .expect(200);
    const firstToken = mail.resetLinks.get(email);
    await redis.flushdb();
    await owner
      .post("/api/v1/auth/password/forgot")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email })
      .expect(200);
    const secondToken = mail.resetLinks.get(email);
    expect(secondToken).not.toBe(firstToken);

    const stale = await owner
      .post("/api/v1/auth/password/reset")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ token: firstToken, password: "FirstPassword456" })
      .expect(400);
    expect(stale.body.error.code).toBe("AUTH_CODE_INVALID");
    await owner
      .post("/api/v1/auth/password/reset")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ token: secondToken, password: "SecondPassword789" })
      .expect(200);
  });

  it("updates the display profile with version-safe writes", async () => {
    const owner = await createAuthenticatedAgent(
      "profile@example.com",
      "StrongPassword123",
      "资料作者",
    );
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const updated = await owner
      .patch("/api/v1/users/me")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        version: 1,
        displayName: "新笔名",
        bio: "写长篇仙侠，也写短篇。",
        avatarUrl: "https://example.com/avatar.png",
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      displayName: "新笔名",
      bio: "写长篇仙侠，也写短篇。",
      avatarUrl: "https://example.com/avatar.png",
      version: 2,
    });

    const me = await owner.get("/api/v1/auth/me").expect(200);
    expect(me.body.data.user).toMatchObject({
      displayName: "新笔名",
      bio: "写长篇仙侠，也写短篇。",
      version: 2,
    });

    const stale = await owner
      .patch("/api/v1/users/me")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ version: 1, displayName: "过期修改" })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");

    const unsafeAvatar = await owner
      .patch("/api/v1/users/me")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ version: 2, avatarUrl: "javascript:alert(1)" })
      .expect(400);
    expect(unsafeAvatar.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("manages multiple pen names with ownership and version checks", async () => {
    const owner = await createAuthenticatedAgent(
      "pen-names@example.com",
      "StrongPassword123",
      "笔名作者",
    );
    const other = await createAuthenticatedAgent(
      "pen-names-other@example.com",
      "StrongPassword123",
      "其他笔名作者",
    );
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    const otherCsrf = (await other.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const empty = await owner.get("/api/v1/users/me/pen-names").expect(200);
    expect(empty.body.data).toEqual([]);

    const first = await owner
      .post("/api/v1/users/me/pen-names")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "青舟", bio: "写仙侠长篇。" })
      .expect(200);
    expect(first.body.data).toMatchObject({ name: "青舟", isDefault: true, version: 1 });

    const second = await owner
      .post("/api/v1/users/me/pen-names")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "砚秋", bio: "写都市短篇。", isDefault: true })
      .expect(200);
    expect(second.body.data).toMatchObject({ name: "砚秋", isDefault: true, version: 1 });

    const listed = await owner.get("/api/v1/users/me/pen-names").expect(200);
    expect(listed.body.data).toHaveLength(2);
    expect(
      listed.body.data.find((penName: { name: string }) => penName.name === "青舟"),
    ).toMatchObject({ isDefault: false, version: 2 });

    const updated = await owner
      .patch(`/api/v1/users/me/pen-names/${second.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ version: second.body.data.version, name: "砚秋新笔名" })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: "砚秋新笔名", version: 2 });

    const stale = await owner
      .patch(`/api/v1/users/me/pen-names/${second.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ version: second.body.data.version, bio: "过期修改" })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");

    const foreign = await other
      .delete(`/api/v1/users/me/pen-names/${first.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(403);
    expect(foreign.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    await owner
      .delete(`/api/v1/users/me/pen-names/${first.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(200);
    const remaining = await owner.get("/api/v1/users/me/pen-names").expect(200);
    expect(remaining.body.data).toHaveLength(1);
    expect(remaining.body.data[0]).toMatchObject({ name: "砚秋新笔名", isDefault: true });
  });

  it("keeps exactly one default pen name when updates are attempted", async () => {
    const owner = await createAuthenticatedAgent(
      "pen-defaults@example.com",
      "StrongPassword123",
      "默认笔名作者",
    );
    const csrfToken = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    const first = await owner
      .post("/api/v1/users/me/pen-names")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "青舟" })
      .expect(200);
    const second = await owner
      .post("/api/v1/users/me/pen-names")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ name: "砚秋" })
      .expect(200);
    expect(first.body.data).toMatchObject({ isDefault: true });
    expect(second.body.data).toMatchObject({ isDefault: false });

    const unsetDefault = await owner
      .patch(`/api/v1/users/me/pen-names/${first.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ version: first.body.data.version, isDefault: false })
      .expect(400);
    expect(unsetDefault.body.error.code).toBe("VALIDATION_INVALID");

    const listed = await owner.get("/api/v1/users/me/pen-names").expect(200);
    expect(
      listed.body.data.filter((penName: { isDefault: boolean }) => penName.isDefault),
    ).toHaveLength(1);

    const switchDefault = await owner
      .patch(`/api/v1/users/me/pen-names/${second.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ version: second.body.data.version, isDefault: true })
      .expect(200);
    expect(switchDefault.body.data).toMatchObject({ isDefault: true, version: 2 });
    const afterSwitch = await owner.get("/api/v1/users/me/pen-names").expect(200);
    expect(
      afterSwitch.body.data.find((penName: { id: string }) => penName.id === first.body.data.id),
    ).toMatchObject({ isDefault: false });
  });

  it("encrypts model keys, returns masks and tests connections", async () => {
    const owner = await createAuthenticatedAgent(
      "models@example.com",
      "StrongPassword123",
      "模型作者",
    );
    const csrfResponse = await owner.get("/api/v1/auth/csrf").expect(200);
    const token = csrfResponse.body.data.token as string;
    const apiKey = "sk-secret-value-1234";
    const created = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "model-create-1")
      .send({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey,
        purposes: ["planning", "writing"],
        isDefault: true,
      })
      .expect(200);

    const replay = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "model-create-1")
      .send({
        provider: "deepseek",
        label: "重复请求",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-different-value-9999",
        isDefault: false,
      })
      .expect(200);
    expect(replay.body.data.id).toBe(created.body.data.id);
    expect(replay.body.data.label).toBe("DeepSeek 正文");
    expect(created.body.data.purposes).toEqual(["planning", "writing"]);

    const concurrentPayload = {
      provider: "deepseek",
      label: "并发重试",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "sk-concurrent-value-1111",
      isDefault: false,
    };
    const ownerRow = await databasePool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      ["models@example.com"],
    );
    const ownerId = ownerRow.rows[0]?.id;
    if (!ownerId) {
      throw new Error("Model config owner was not created");
    }

    const lockClient = await databasePool.connect();
    let lockReleased = false;
    try {
      await lockClient.query("BEGIN");
      await lockClient.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ownerId]);
      const concurrentResponsesPromise = Promise.all(
        Array.from({ length: 2 }, () =>
          owner
            .post("/api/v1/model-configs")
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .set("Idempotency-Key", "model-create-concurrent")
            .send(concurrentPayload),
        ),
      );
      await waitFor(async () => {
        const waiting = await databasePool.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
        );
        return (waiting.rows[0]?.count ?? 0) >= 2;
      }, "both model config creates to wait for the user lock");
      await lockClient.query("COMMIT");
      lockReleased = true;

      const concurrentResponses = await concurrentResponsesPromise;
      expect(concurrentResponses.map((response) => response.status)).toEqual([200, 200]);
      expect(concurrentResponses[0]?.body.data.id).toBe(concurrentResponses[1]?.body.data.id);
    } finally {
      if (!lockReleased) {
        await lockClient.query("ROLLBACK").catch(() => undefined);
      }
      lockClient.release();
    }

    expect(JSON.stringify(created.body)).not.toContain(apiKey);
    expect(created.body.data.keyMasked).toBe("****1234");
    const stored = await databasePool.query<{ encrypted_key: string }>(
      "SELECT encrypted_key FROM model_configs WHERE id = $1",
      [created.body.data.id],
    );
    expect(stored.rows[0]?.encrypted_key).not.toContain(apiKey);

    const tested = await owner
      .post(`/api/v1/model-configs/${created.body.data.id}/test`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(200);
    expect(tested.body.data.status).toBe("success");
    expect(JSON.stringify(tested.body)).not.toContain(apiKey);

    const afterTest = await owner.get("/api/v1/model-configs").expect(200);
    const testedConfig = afterTest.body.data.find(
      (config: { id: string }) => config.id === created.body.data.id,
    );
    expect(testedConfig).toMatchObject({ version: 2, lastTestStatus: "success" });

    const providerError = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "model-create-deleted")
      .send({
        provider: "deepseek",
        label: "服务商异常",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-provider-error-1234",
        isDefault: false,
      })
      .expect(200);
    const providerErrorTest = await owner
      .post(`/api/v1/model-configs/${providerError.body.data.id}/test`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(400);
    expect(providerErrorTest.body.error.code).toBe("MODEL_PROVIDER_ERROR");
    expect(providerErrorTest.body.error.details.status).toBe("provider_error");
    expect(JSON.stringify(providerErrorTest.body)).not.toContain("sk-provider-error-1234");

    const expiredIdempotencyKey = "model-create-expired";
    const expiringConfig = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", expiredIdempotencyKey)
      .send({
        provider: "deepseek",
        label: "过期幂等",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-expired-value-1234",
        isDefault: false,
      })
      .expect(200);
    await databasePool.query(
      "UPDATE model_configs SET created_at = now() - interval '25 hours' WHERE id = $1",
      [expiringConfig.body.data.id],
    );
    const recreated = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", expiredIdempotencyKey)
      .send({
        provider: "deepseek",
        label: "过期后重建",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-expired-value-5678",
        isDefault: false,
      })
      .expect(200);
    expect(recreated.body.data.id).not.toBe(expiringConfig.body.data.id);

    const updated = await owner
      .patch(`/api/v1/model-configs/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: testedConfig.version, label: "DeepSeek 主模型", purposes: ["review"] })
      .expect(200);
    expect(updated.body.data.version).toBe(3);
    expect(updated.body.data.purposes).toEqual(["review"]);
    await owner
      .delete(`/api/v1/model-configs/${providerError.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(200);
    const deletedReplay = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "model-create-deleted")
      .send({
        provider: "deepseek",
        label: "删除后重试",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-deleted-replay-1234",
        isDefault: false,
      })
      .expect(200);
    expect(deletedReplay.body.data.id).toBe(providerError.body.data.id);
    const visibleAfterDelete = await owner.get("/api/v1/model-configs").expect(200);
    expect(
      visibleAfterDelete.body.data.some(
        (config: { id: string }) => config.id === providerError.body.data.id,
      ),
    ).toBe(false);

    const audit = await databasePool.query<{
      action: string;
      ip: string;
      user_agent: string;
    }>("SELECT action, ip, user_agent FROM audit_logs WHERE actor_id = $1 ORDER BY created_at", [
      ownerId,
    ]);
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "model_config.created",
        "model_config.updated",
        "model_config.deleted",
      ]),
    );
    expect(audit.rows.every((row) => row.ip.length > 0 && row.user_agent.length > 0)).toBe(true);
  });

  it("rejects SSRF targets and cross-user model configuration access", async () => {
    const owner = await createAuthenticatedAgent(
      "owner@example.com",
      "StrongPassword123",
      "配置所有者",
    );
    const other = await createAuthenticatedAgent(
      "other@example.com",
      "StrongPassword123",
      "其他作者",
    );
    const ownerCsrf = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    const otherCsrf = (await other.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    for (const baseUrl of [
      "http://api.example.com/v1",
      "https://127.0.0.1/v1",
      "https://10.0.0.1/v1",
      "https://192.168.1.1/v1",
      "https://169.254.169.254/v1",
      "https://[fec0::1]/v1",
      "https://[fe80::1]/v1",
    ]) {
      const rejected = await owner
        .post("/api/v1/model-configs")
        .set("Origin", origin)
        .set("X-CSRF-Token", ownerCsrf)
        .send({
          provider: "openai-compatible",
          label: "SSRF",
          baseUrl,
          model: "custom",
          apiKey: "sk-secret-value-1234",
          isDefault: false,
        })
        .expect(400);
      expect(rejected.body.error.code).toBe("MODEL_CONNECTION_FAILED");
      expect(JSON.stringify(rejected.body)).not.toContain("sk-secret-value-1234");
    }

    const created = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .send({
        provider: "deepseek",
        label: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-secret-value-1234",
        isDefault: true,
      })
      .expect(200);

    expect((await other.get("/api/v1/model-configs").expect(200)).body.data).toEqual([]);
    const foreignUpdate = await other
      .patch(`/api/v1/model-configs/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .send({ version: created.body.data.version, label: "越权修改" })
      .expect(403);
    expect(foreignUpdate.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignDelete = await other
      .delete(`/api/v1/model-configs/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(403);
    expect(foreignDelete.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignTest = await other
      .post(`/api/v1/model-configs/${created.body.data.id}/test`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(403);
    expect(foreignTest.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const invalidId = await owner
      .delete("/api/v1/model-configs/not-a-uuid")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .expect(400);
    expect(invalidId.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("keeps a default model config invariant", async () => {
    const owner = await createAuthenticatedAgent(
      "defaults@example.com",
      "StrongPassword123",
      "默认配置作者",
    );
    const token = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    const first = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "默认模型",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-secret-value-1234",
        isDefault: false,
      })
      .expect(200);
    expect(first.body.data.isDefault).toBe(true);
    const lastDelete = await owner
      .delete(`/api/v1/model-configs/${first.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(400);
    expect(lastDelete.body.error.code).toBe("VALIDATION_INVALID");

    const second = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "备用模型",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-reasoner",
        apiKey: "sk-secret-value-5678",
        isDefault: false,
      })
      .expect(200);

    await owner
      .patch(`/api/v1/model-configs/${first.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: first.body.data.version, isDefault: false })
      .expect(400);

    await owner
      .delete(`/api/v1/model-configs/${first.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(200);
    const configs = await owner.get("/api/v1/model-configs").expect(200);
    expect(
      configs.body.data.find((config: { id: string }) => config.id === second.body.data.id),
    ).toMatchObject({ isDefault: true, version: 2 });
  });
});

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const adminPool = createDatabasePool(adminUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}

function isDuplicateDatabase(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P04";
}

async function waitFor<T>(
  condition: () => T | Promise<T>,
  description: string,
  timeoutMs = 5_000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const result = await condition();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`);
}
