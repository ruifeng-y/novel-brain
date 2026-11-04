import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

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

describe("works HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "works-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "works-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
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
        displayName: "林见鹿",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  it("creates a draft work from an idea with a main branch and initial head", async () => {
    const owner = await createAuthenticatedAgent("idea@example.com");
    const token = await csrf(owner);

    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "work-idea-1")
      .send({
        mode: "idea",
        title: "忘川书",
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);

    expect(created.body.data).toMatchObject({
      title: "忘川书",
      idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
      status: "draft",
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
      mainBranch: {
        name: "main",
        status: "active",
      },
    });
    expect(created.body.data.mainBranch.headNodeId).toMatch(/^[0-9a-f-]{36}$/);

    const branches = await owner.get(`/api/v1/works/${created.body.data.id}/branches`).expect(200);
    expect(branches.body.data).toHaveLength(1);
    expect(branches.body.data[0]).toMatchObject({
      id: created.body.data.mainBranch.id,
      name: "main",
      headNodeId: created.body.data.mainBranch.headNodeId,
    });

    const overview = await owner.get(`/api/v1/works/${created.body.data.id}`).expect(200);
    expect(overview.body.data).toMatchObject({
      id: created.body.data.id,
      title: "忘川书",
      mainBranch: { name: "main" },
    });
  });

  it("creates blank and xianxia template works without inventing story facts", async () => {
    const owner = await createAuthenticatedAgent("modes@example.com");
    const token = await csrf(owner);

    const blank = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        mode: "blank",
        title: "空白作品",
        genre: "urban",
        scaleTarget: "medium",
        chapterLengthTarget: 2500,
      })
      .expect(200);
    expect(blank.body.data).toMatchObject({
      sourceMode: "blank",
      idea: null,
      templatePack: null,
      settings: {},
      mainBranch: { name: "main" },
    });

    const template = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        mode: "template",
        templateKey: "xianxia",
        title: "仙侠模板作品",
        scaleTarget: "epic",
        chapterLengthTarget: 3200,
      })
      .expect(200);
    expect(template.body.data).toMatchObject({
      sourceMode: "template",
      idea: null,
      settings: {},
      templatePack: {
        key: "xianxia",
        version: 1,
        label: "仙侠模板",
        fields: {
          genre: "仙侠",
          world: "修真文明",
          map: "分层地图",
          powerSystem: "修炼体系",
          factions: "宗门势力",
        },
      },
      mainBranch: { name: "main" },
    });
    expect(JSON.stringify(template.body.data.templatePack)).not.toContain("角色");
    expect(JSON.stringify(template.body.data.templatePack)).not.toContain("世界事实");
  });

  it("replays the same create request without creating a second work", async () => {
    const owner = await createAuthenticatedAgent("idempotent-work@example.com");
    const token = await csrf(owner);
    const payload = {
      mode: "idea" as const,
      title: "重复创建",
      idea: "一个失去名字的人，靠替别人写信找回自己的过去。",
    };

    const first = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "work-replay-1")
      .send(payload)
      .expect(200);
    const replay = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "work-replay-1")
      .send({ ...payload, title: "不同标题" })
      .expect(200);

    expect(replay.body.data.id).toBe(first.body.data.id);
    expect(replay.body.data.title).toBe("重复创建");
    const listed = await owner.get("/api/v1/works").expect(200);
    expect(listed.body.data).toHaveLength(1);
  });

  it("lists, searches, filters and paginates works for the current tenant only", async () => {
    const owner = await createAuthenticatedAgent("library@example.com");
    const other = await createAuthenticatedAgent("other-library@example.com");
    const token = await csrf(owner);
    const otherToken = await csrf(other);

    for (let index = 1; index <= 12; index += 1) {
      await owner
        .post("/api/v1/works")
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          mode: "blank",
          title: index === 12 ? "长夜行" : `作品 ${String(index).padStart(2, "0")}`,
          genre: index % 2 === 0 ? "xianxia" : "urban",
        })
        .expect(200);
    }
    await databasePool.query("UPDATE works SET status = 'preparing' WHERE title = '作品 02'");

    const firstPage = await owner.get("/api/v1/works?limit=5").expect(200);
    expect(firstPage.body.data).toHaveLength(5);
    expect(firstPage.body.meta.nextCursor).toMatch(/^[0-9a-f-]{36}$/);
    const secondPage = await owner
      .get(`/api/v1/works?limit=5&cursor=${firstPage.body.meta.nextCursor}`)
      .expect(200);
    expect(secondPage.body.data).toHaveLength(5);
    expect(
      new Set(
        [...firstPage.body.data, ...secondPage.body.data].map((work: { id: string }) => work.id),
      ).size,
    ).toBe(10);

    const search = await owner.get("/api/v1/works?q=%E9%95%BF%E5%A4%9C").expect(200);
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].title).toBe("长夜行");

    const filtered = await owner.get("/api/v1/works?genre=xianxia&status=preparing").expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].title).toBe("作品 02");

    const foreign = await other.get("/api/v1/works").expect(200);
    expect(foreign.body.data).toEqual([]);
    const foreignDetail = await other.get(`/api/v1/works/${firstPage.body.data[0].id}`).expect(403);
    expect(foreignDetail.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignBranches = await other
      .get(`/api/v1/works/${firstPage.body.data[0].id}/branches`)
      .expect(403);
    expect(foreignBranches.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const owned = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ mode: "blank", title: "不应创建" });
    expect([401, 403]).toContain(owned.status);
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
