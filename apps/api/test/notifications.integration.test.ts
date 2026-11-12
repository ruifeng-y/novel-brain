import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  notificationListResponseSchema,
  notificationReadAllResponseSchema,
  notificationReadResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { NotificationRepository } from "../src/notifications/notification.repository";

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

describe("notification integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  let repository: NotificationRepository;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "notification-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "notification-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1";

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl, {
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    repository = new NotificationRepository(databaseUrl);

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_GATEWAY)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    await app.listen(0);
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
    await repository?.onModuleDestroy();
  });

  it("deduplicates task notifications and enforces read permissions", async () => {
    const owner = await createAuthenticatedAgent("notification-owner@example.com");
    const other = await createAuthenticatedAgent("notification-other@example.com");
    const ownerId = await userId("notification-owner@example.com");
    const otherId = await userId("notification-other@example.com");
    const targetId = uuidv7();
    const input = {
      userId: ownerId,
      workId: null,
      branchId: null,
      type: "job_completed" as const,
      targetType: "job" as const,
      targetId,
      payload: {
        title: "批量任务已完成",
        message: "第一卷已完成批量生成。",
        href: "/workspace/notification-owner/batch",
      },
      dedupeKey: `job:${targetId}:completed`,
    };

    expect(await repository.record(input)).not.toBeNull();
    expect(await repository.record(input)).toBeNull();

    const ownerList = notificationListResponseSchema.parse(
      (await owner.get("/api/v1/notifications?limit=20").expect(200)).body,
    );
    expect(ownerList.data).toHaveLength(1);
    expect(ownerList.meta.unreadCount).toBe(1);

    const otherList = notificationListResponseSchema.parse(
      (await other.get("/api/v1/notifications?limit=20").expect(200)).body,
    );
    expect(otherList.data).toHaveLength(0);
    expect(otherList.meta.unreadCount).toBe(0);
    expect(otherId).not.toBe(ownerId);

    const notificationId = ownerList.data[0]!.id;
    const ownerCsrf = (await owner.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    const otherCsrf = (await other.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;

    await owner
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Origin", origin)
      .expect(403);
    const denied = await other
      .patch(`/api/v1/notifications/${notificationId}/read`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherCsrf)
      .expect(404);
    expect(denied.body.error.code).toBe("NOTIFICATION_NOT_FOUND");

    const read = notificationReadResponseSchema.parse(
      (
        await owner
          .patch(`/api/v1/notifications/${notificationId}/read`)
          .set("Origin", origin)
          .set("X-CSRF-Token", ownerCsrf)
          .expect(200)
      ).body,
    );
    expect(read.data.readAt).not.toBeNull();
    const duplicateRead = notificationReadResponseSchema.parse(
      (
        await owner
          .patch(`/api/v1/notifications/${notificationId}/read`)
          .set("Origin", origin)
          .set("X-CSRF-Token", ownerCsrf)
          .expect(200)
      ).body,
    );
    expect(duplicateRead.data.readAt).toBe(read.data.readAt);

    const readAll = notificationReadAllResponseSchema.parse(
      (
        await owner
          .post("/api/v1/notifications/read-all")
          .set("Origin", origin)
          .set("X-CSRF-Token", ownerCsrf)
          .expect(200)
      ).body,
    );
    expect(readAll.data.updated).toBe(0);
  });

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
    await agent
      .post("/api/v1/auth/register/send-code")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ email })
      .expect(200);
    await agent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        email,
        code: mail.codes.get(email),
        password: "StrongPassword123",
        displayName: "通知作者",
      })
      .expect(200);
    return agent;
  }

  async function userId(email: string): Promise<string> {
    const result = await databasePool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    return result.rows[0]!.id;
  }
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
