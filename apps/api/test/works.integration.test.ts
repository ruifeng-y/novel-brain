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

  it("creates blank and template works with the latest genre pack without inventing story facts", async () => {
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
      templatePack: {
        key: "urban",
        version: 2,
        label: "都市模板",
        uiHints: { powerLevelLabel: "资源等级" },
      },
      settings: { genrePack: { key: "urban", version: 2 } },
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
      settings: { genrePack: { key: "xianxia", version: 2 } },
      templatePack: {
        key: "xianxia",
        version: 2,
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

    const history = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        mode: "template",
        templateKey: "history",
        genre: "history",
        title: "边关粮道",
      })
      .expect(200);
    expect(history.body.data.templatePack).toMatchObject({
      key: "history",
      version: 2,
      label: "架空历史模板",
      uiHints: { powerLevelLabel: "军职层级" },
    });
  });

  it("upgrades and rolls back a genre pack version with an immutable version node", async () => {
    const owner = await createAuthenticatedAgent("genre-pack-version@example.com");
    const token = await csrf(owner);
    const packs = await owner.get("/api/v1/genre-packs?key=history").expect(200);
    expect(packs.body.data.map((pack: { version: number }) => pack.version)).toEqual([2, 1]);
    const work = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        mode: "blank",
        genre: "history",
        title: "旧朝军功簿",
      })
      .expect(200);
    const workId = work.body.data.id as string;

    const rolledBack = await owner
      .post(`/api/v1/works/${workId}/genre-pack/version`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "history-pack-v1")
      .send({ targetVersion: 1, reason: "验证旧版字段兼容" })
      .expect(200);
    expect(rolledBack.body.data).toMatchObject({
      templatePack: { version: 1 },
      settings: {
        genrePack: {
          version: 1,
          migrationReport: { removedFields: ["militaryMerit"] },
        },
      },
    });

    const upgraded = await owner
      .post(`/api/v1/works/${workId}/genre-pack/version`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "history-pack-v2")
      .send({ targetVersion: 2, reason: "升级到最新军制字段" })
      .expect(200);
    expect(upgraded.body.data).toMatchObject({
      templatePack: { version: 2 },
      settings: {
        genrePack: {
          version: 2,
          migrationReport: { missingFields: ["militaryMerit"] },
        },
      },
    });

    const replayed = await owner
      .post(`/api/v1/works/${workId}/genre-pack/version`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "history-pack-v2")
      .send({ targetVersion: 2, reason: "升级到最新军制字段" })
      .expect(200);
    expect(replayed.body.data.templatePack).toMatchObject({ version: 2 });
    const conflict = await owner
      .post(`/api/v1/works/${workId}/genre-pack/version`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "history-pack-v2")
      .send({ targetVersion: 1, reason: "复用同一个幂等键" })
      .expect(409);
    expect(conflict.body.error.code).toBe("GENRE_PACK_IDEMPOTENCY_CONFLICT");

    const nodes = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM version_nodes
       WHERE work_id = $1 AND object_type = 'genre_pack'`,
      [workId],
    );
    expect(nodes.rows[0]?.count).toBe("2");
    const audit = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
       WHERE target_id = $1 AND action = 'work.genre_pack.changed'`,
      [workId],
    );
    expect(audit.rows[0]?.count).toBe("2");
    const missing = await owner
      .post(`/api/v1/works/${workId}/genre-pack/version`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "history-pack-missing")
      .send({ targetVersion: 99, reason: "验证不存在的版本" })
      .expect(400);
    expect(missing.body.error.code).toBe("GENRE_PACK_VERSION_NOT_FOUND");
    const legacyPack = await databasePool.query<{
      label: string;
      rules: unknown[];
    }>(
      `SELECT label, rules FROM genre_packs
       WHERE key = 'xianxia' AND version = 1`,
    );
    expect(legacyPack.rows[0]).toEqual({ label: "仙侠模板", rules: [] });
  });

  it("rejects cross-tenant genre pack version changes without side effects", async () => {
    const owner = await createAuthenticatedAgent("genre-pack-owner@example.com");
    const token = await csrf(owner);
    const work = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", genre: "urban", title: "越权测试" })
      .expect(200);
    const other = await createAuthenticatedAgent("genre-pack-foreign@example.com");
    const otherToken = await csrf(other);
    const response = await other
      .post(`/api/v1/works/${work.body.data.id}/genre-pack/version`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .set("Idempotency-Key", "foreign-pack-version")
      .send({ targetVersion: 1, reason: "越权" })
      .expect(403);
    expect(response.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const nodes = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM version_nodes
       WHERE work_id = $1 AND object_type = 'genre_pack'`,
      [work.body.data.id],
    );
    expect(nodes.rows[0]?.count).toBe("0");
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
