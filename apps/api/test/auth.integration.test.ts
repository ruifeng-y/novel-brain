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
