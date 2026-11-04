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
    process.env.PROXY_IP_SECRET = "integration-test-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://api.openai.com/v1";

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

    const rejected = await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .send({
        provider: "openai-compatible",
        label: "SSRF",
        baseUrl: "https://127.0.0.1/v1",
        model: "custom",
        apiKey: "sk-secret-value-1234",
        isDefault: false,
      })
      .expect(400);
    expect(rejected.body.error.code).toBe("MODEL_CONNECTION_FAILED");

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
    await other
      .delete(`/api/v1/model-configs/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(404);
    await other
      .post(`/api/v1/model-configs/${created.body.data.id}/test`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(404);
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
    ).toMatchObject({ isDefault: true });
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
