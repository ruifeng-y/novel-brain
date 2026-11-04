import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { AppModule } from "../src/app.module";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
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
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";

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
