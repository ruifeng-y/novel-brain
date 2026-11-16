import "reflect-metadata";

import { createHash } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import type { MailGateway } from "../src/auth/mail.gateway";
import { MAIL_GATEWAY } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { auditTenantRls } from "../../../scripts/audit-tenant-rls.mjs";

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

describe("account lifecycle HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "account-lifecycle-auth-secret";
    process.env.PROXY_IP_SECRET = "account-lifecycle-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";

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
  });

  beforeEach(async () => {
    mail.codes.clear();
    mail.resetLinks.clear();
    await databasePool.query(
      "TRUNCATE TABLE email_verification_codes, deletion_requests, users CASCADE",
    );
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("exports a complete versioned package with a receipt and no secrets", async () => {
    const owner = await createAuthenticatedAgent(
      "export-owner@example.com",
      "StrongPassword123",
      "导出作者",
    );
    const ownerId = await userId("export-owner@example.com");
    const workId = uuidv7();
    await databasePool.query(
      `INSERT INTO works (id, user_id, title, pen_name, genre, source_mode)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [workId, ownerId, "忘川书", "青舟", "xianxia", "blank"],
    );
    await databasePool.query(
      `INSERT INTO model_configs
         (id, user_id, provider, label, base_url, model, purposes, encrypted_key, key_masked)
       VALUES ($1, $2, 'deepseek', '主模型', 'https://api.deepseek.com', 'deepseek-chat',
               '["writing"]'::jsonb, $3, '****1234')`,
      [uuidv7(), ownerId, "encrypted-secret-envelope"],
    );
    await databasePool.query(
      `INSERT INTO email_verification_codes
         (id, email, code_hash, purpose, expires_at, requested_ip)
       VALUES ($1, 'export-owner@example.com', 'verification-code-secret-hash',
               'register', now() + interval '1 day', '203.0.113.10')`,
      [uuidv7()],
    );
    const passwordHash = (
      await databasePool.query<{ password_hash: string }>(
        "SELECT password_hash FROM users WHERE id = $1",
        [ownerId],
      )
    ).rows[0]?.password_hash;
    const csrfToken = await csrf(owner);

    const created = await owner
      .post("/api/v1/users/me/export")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(200);
    const receipt = created.body.data as {
      id: string;
      inventoryVersion: string;
      checksum: string;
      inventory: Array<{ store: string; rowCount: number }>;
    };
    expect(receipt.inventoryVersion).toBe("account-export-v1");
    expect(receipt.inventory).toEqual(
      expect.arrayContaining([
        { store: "users", rowCount: 1 },
        { store: "works", rowCount: 1 },
        { store: "model_configs", rowCount: 1 },
        { store: "email_verification_codes", rowCount: 2 },
      ]),
    );
    const audit = await auditTenantRls(databasePool);
    const expectedStores = new Set([
      ...audit.tables
        .map((table: { table: string }) => table.table)
        .filter((table: string) => table !== "deletion_requests" && table !== "export_receipts"),
      "audit_logs",
      "users",
      "email_verification_codes",
    ]);
    expect(new Set(receipt.inventory.map((entry) => entry.store))).toEqual(expectedStores);

    const downloaded = await owner
      .get(`/api/v1/users/me/export/${receipt.id}/download`)
      .expect(200);
    expect(downloaded.headers["x-export-checksum"]).toBe(receipt.checksum);
    expect(downloaded.headers["x-export-inventory-version"]).toBe("account-export-v1");
    expect(downloaded.body.data.works[0]).toMatchObject({ title: "忘川书" });
    expect(downloaded.body.inventoryVersion).toBe("account-export-v1");

    const serialized = JSON.stringify(downloaded.body);
    expect(createHash("sha256").update(serialized).digest("hex")).toBe(receipt.checksum);
    expect(serialized).not.toContain("encrypted-secret-envelope");
    expect(serialized).not.toContain("encrypted_key");
    expect(serialized).not.toContain("password_hash");
    expect(serialized).not.toContain("verification-code-secret-hash");
    expect(serialized).not.toContain("code_hash");
    if (!passwordHash) {
      throw new Error("Registered user password hash is missing");
    }
    expect(serialized).not.toContain(passwordHash);
  });

  it("gates deletion on an owned export and supports an idempotent recovery window", async () => {
    const owner = await createAuthenticatedAgent(
      "delete-owner@example.com",
      "StrongPassword123",
      "注销作者",
    );
    const other = await createAuthenticatedAgent(
      "delete-other@example.com",
      "StrongPassword123",
      "其他作者",
    );
    const ownerCsrf = await csrf(owner);
    const otherCsrf = await csrf(other);
    const exportResponse = await owner
      .post("/api/v1/users/me/export")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .expect(200);
    const exportReceiptId = exportResponse.body.data.id as string;
    const foreignDownload = await other
      .get(`/api/v1/users/me/export/${exportReceiptId}/download`)
      .expect(403);
    expect(foreignDownload.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignStatus = await other.get("/api/v1/users/me/deletion").expect(404);
    expect(foreignStatus.body.error.code).toBe("ACCOUNT_DELETION_NOT_FOUND");

    const foreignUse = await other
      .post("/api/v1/users/me/delete")
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .send({ exportReceiptId, confirm: true })
      .expect(403);
    expect(foreignUse.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const requested = await owner
      .post("/api/v1/users/me/delete")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ exportReceiptId, confirm: true })
      .expect(202);
    const deletion = requested.body.data as {
      id: string;
      status: string;
      requestedAt: string;
      recoverableUntil: string;
      purgeAfter: string;
      backupExpiresAt: string;
    };
    expect(deletion.status).toBe("recovery_pending");
    expect(new Date(deletion.purgeAfter).getTime() - new Date(deletion.requestedAt).getTime()).toBe(
      30 * 86_400_000,
    );
    expect(
      new Date(deletion.backupExpiresAt).getTime() - new Date(deletion.purgeAfter).getTime(),
    ).toBe(30 * 86_400_000);

    const replayed = await owner
      .post("/api/v1/users/me/delete")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .send({ exportReceiptId, confirm: true })
      .expect(202);
    expect(replayed.body.data.id).toBe(deletion.id);

    const pending = await owner.get("/api/v1/users/me/deletion").expect(200);
    expect(pending.body.data).toMatchObject({ id: deletion.id, status: "recovery_pending" });
    const blockedWorkspaceCall = await owner.get("/api/v1/users/me/pen-names").expect(403);
    expect(blockedWorkspaceCall.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const ownerStatus = await databasePool.query<{ status: string }>(
      "SELECT status FROM users WHERE email = 'delete-owner@example.com'",
    );
    expect(ownerStatus.rows[0]?.status).toBe("deletion_pending");

    const recovered = await owner
      .post("/api/v1/users/me/deletion/recover")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .expect(200);
    expect(recovered.body.data).toMatchObject({ id: deletion.id, status: "recovered" });
    const recoveredAgain = await owner
      .post("/api/v1/users/me/deletion/recover")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerCsrf)
      .expect(200);
    expect(recoveredAgain.body.data.id).toBe(deletion.id);
    const activeStatus = await databasePool.query<{ status: string }>(
      "SELECT status FROM users WHERE email = 'delete-owner@example.com'",
    );
    expect(activeStatus.rows[0]?.status).toBe("active");
  });

  it("rejects recovery after the approved window without deleting the request", async () => {
    const owner = await createAuthenticatedAgent(
      "expired-recovery@example.com",
      "StrongPassword123",
      "过期恢复作者",
    );
    const csrfToken = await csrf(owner);
    const exportReceiptId = (
      await owner
        .post("/api/v1/users/me/export")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .expect(200)
    ).body.data.id as string;
    const deletionRequestId = (
      await owner
        .post("/api/v1/users/me/delete")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({ exportReceiptId, confirm: true })
        .expect(202)
    ).body.data.id as string;
    await databasePool.query(
      `UPDATE deletion_requests
          SET recoverable_until = now() - interval '1 minute',
              purge_after = now() - interval '1 minute',
              backup_expires_at = now() + interval '29 days'
        WHERE id = $1`,
      [deletionRequestId],
    );

    const expired = await owner
      .post("/api/v1/users/me/deletion/recover")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(410);
    expect(expired.body.error.code).toBe("ACCOUNT_DELETION_RECOVERY_EXPIRED");
    const status = await databasePool.query<{ status: string }>(
      "SELECT status FROM deletion_requests WHERE id = $1",
      [deletionRequestId],
    );
    expect(status.rows[0]?.status).toBe("recovery_pending");
  });

  it("rejects an expired export receipt as a deletion prerequisite", async () => {
    const owner = await createAuthenticatedAgent(
      "expired-export@example.com",
      "StrongPassword123",
      "过期导出作者",
    );
    const csrfToken = await csrf(owner);
    const receiptId = (
      await owner
        .post("/api/v1/users/me/export")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .expect(200)
    ).body.data.id as string;
    await databasePool.query(
      "UPDATE export_receipts SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [receiptId],
    );

    const rejected = await owner
      .post("/api/v1/users/me/delete")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ exportReceiptId: receiptId, confirm: true })
      .expect(400);
    expect(rejected.body.error.code).toBe("ACCOUNT_EXPORT_EXPIRED");
  });

  it("keeps concurrent deletion idempotent and allows recovery from a fresh login", async () => {
    const email = "recover-login@example.com";
    const password = "StrongPassword123";
    const owner = await createAuthenticatedAgent(email, password, "恢复登录作者");
    const csrfToken = await csrf(owner);
    const exportReceiptId = (
      await owner
        .post("/api/v1/users/me/export")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .expect(200)
    ).body.data.id as string;

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        owner
          .post("/api/v1/users/me/delete")
          .set("Origin", origin)
          .set("X-CSRF-Token", csrfToken)
          .send({ exportReceiptId, confirm: true }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    expect(responses[0]?.body.data.id).toBe(responses[1]?.body.data.id);

    await databasePool.query(
      `UPDATE sessions
          SET revoked_at = now()
        WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
      [email],
    );
    await owner.get("/api/v1/auth/me").expect(401);

    const recoveredSession = await loginAgent(email, password);
    const current = await recoveredSession.get("/api/v1/users/me/deletion").expect(200);
    expect(current.body.data.id).toBe(responses[0]?.body.data.id);
    const recoveredCsrf = await csrf(recoveredSession);
    await recoveredSession
      .post("/api/v1/users/me/deletion/recover")
      .set("Origin", origin)
      .set("X-CSRF-Token", recoveredCsrf)
      .expect(200);
  });

  async function createAuthenticatedAgent(
    email: string,
    password: string,
    displayName: string,
  ): Promise<SuperAgentTest> {
    const userAgent = request.agent(app.getHttpServer());
    const csrfToken = await csrf(userAgent);
    await userAgent
      .post("/api/v1/auth/register/send-code")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email })
      .expect(200);
    await userAgent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email, code: mail.codes.get(email), password, displayName })
      .expect(200);
    return userAgent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function loginAgent(email: string, password: string): Promise<SuperAgentTest> {
    const userAgent = request.agent(app.getHttpServer());
    const csrfToken = await csrf(userAgent);
    await userAgent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email, password })
      .expect(200);
    return userAgent;
  }

  async function userId(email: string): Promise<string> {
    const result = await databasePool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error(`User ${email} was not created`);
    }
    return id;
  }
});

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const adminPool = createDatabasePool(adminUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "42P04"
    )) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}
