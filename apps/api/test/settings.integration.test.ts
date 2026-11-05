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

describe("settings center HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "settings-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "settings-integration-proxy-secret";
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

  it("creates, edits, locks and versions a world rule", async () => {
    const owner = await createAuthenticatedAgent("settings-world@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: ["完整记忆律"],
        summary: "失去关键记忆的人无法通过天门。",
        description: "此规则对仙、凡、灵三界同时生效。",
        tags: ["天门", "记忆"],
        data: {
          rule: "通过天门时，任何被主动抹除的关键记忆都会导致通行失败。",
        },
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      workId: work.id,
      branchId: work.mainBranch.id,
      type: "world_rule",
      name: "天门只认完整记忆",
      aliases: ["完整记忆律"],
      status: "draft",
      source: "author",
      version: 1,
      data: {
        rule: "通过天门时，任何被主动抹除的关键记忆都会导致通行失败。",
      },
    });

    const edited = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        summary: "失去关键记忆的人无法通过天门，也无法伪造完整人格。",
        aliases: ["完整记忆律", "天门前律"],
      })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      version: 2,
      status: "draft",
      aliases: ["完整记忆律", "天门前律"],
    });

    const locked = await owner
      .post(`${path}/${created.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 2 })
      .expect(200);
    expect(locked.body.data).toMatchObject({
      version: 3,
      status: "locked",
    });

    const versions = await databasePool.query<{
      entity_versions: string;
      version_nodes: string;
      node_types: string[];
    }>(
      `SELECT
        (SELECT count(*) FROM entity_versions WHERE entity_id = $1) AS entity_versions,
        (SELECT count(*) FROM version_nodes WHERE object_type = 'setting' AND object_id = $1) AS version_nodes,
        (SELECT array_agg(node_type ORDER BY created_at) FROM version_nodes WHERE object_type = 'setting' AND object_id = $1) AS node_types`,
      [created.body.data.id],
    );
    expect(versions.rows[0]).toEqual({
      entity_versions: "3",
      version_nodes: "3",
      node_types: ["entity_version", "entity_version", "entity_version"],
    });
  });

  it("stores a character body state, knowledge boundary and relationship summary", async () => {
    const owner = await createAuthenticatedAgent("settings-character@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: ["小砚"],
        summary: "被宗门抛弃的外门杂役。",
        description: "谨慎、记仇，但会为救过自己的人承担风险。",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折，不能双手结印。",
          knowledgeBoundary: "不知道父母死于仇杀，也不知道忘川书的缺页去向。",
          relationshipSummary: "与顾青表面亲近，实际互相试探。",
        },
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      type: "character",
      name: "沈砚",
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀，也不知道忘川书的缺页去向。",
        relationshipSummary: "与顾青表面亲近，实际互相试探。",
      },
    });

    const fetched = await owner.get(`${path}/${created.body.data.id}`).expect(200);
    expect(fetched.body.data.data).toEqual(created.body.data.data);
    const listed = await owner.get(`${path}?type=character`).expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);
  });

  it("stores golden finger rules, cost, limits and growth constraints", async () => {
    const owner = await createAuthenticatedAgent("settings-golden-finger@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "golden_finger",
        name: "忘川书",
        aliases: [],
        summary: "以重要记忆换取前人经验。",
        description: "每次翻页都会永久失去一段作者指定范围内的记忆。",
        tags: ["核心金手指"],
        data: {
          rules: "每次只能借用一位前人的经验。",
          cost: "永久失去一段重要记忆。",
          limits: "每次使用消耗一页，目前只剩七页。",
          growth: "缺失的记忆会逐步拼成一个完整人格。",
        },
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      type: "golden_finger",
      data: {
        rules: "每次只能借用一位前人的经验。",
        cost: "永久失去一段重要记忆。",
        limits: "每次使用消耗一页，目前只剩七页。",
        growth: "缺失的记忆会逐步拼成一个完整人格。",
      },
    });
  });

  it("rejects direct edits, alias changes and deletes after a setting is locked", async () => {
    const owner = await createAuthenticatedAgent("settings-locked@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: ["完整记忆律"],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);
    const locked = await owner
      .post(`${path}/${created.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 1 })
      .expect(200);

    const aliasEdit = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        aliases: ["完整记忆律", "天门前律"],
      })
      .expect(409);
    expect(aliasEdit.body.error.code).toBe("SETTING_LOCKED");

    const directEdit = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        summary: "锁定后不应被覆盖。",
      })
      .expect(409);
    expect(directEdit.body.error.code).toBe("SETTING_LOCKED");

    const directDelete = await owner
      .delete(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(409);
    expect(directDelete.body.error.code).toBe("SETTING_LOCKED");
  });

  it("lists only locked settings in the read-only confirmed-settings projection", async () => {
    const owner = await createAuthenticatedAgent("settings-confirmed@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const confirmed = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);
    await owner
      .post(`${path}/${confirmed.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 1 })
      .expect(200);
    await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
      })
      .expect(201);

    const response = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/facts`)
      .expect(200);
    expect(response.body.data).toEqual([
      {
        id: confirmed.body.data.id,
        type: "world_rule",
        name: "天门只认完整记忆",
        summary: "失去关键记忆的人无法通过天门。",
        source: "author",
        status: "locked",
        version: 2,
        lockedAt: expect.any(String),
      },
    ]);
  });

  it("rejects type-specific fields that do not belong to the setting", async () => {
    const owner = await createAuthenticatedAgent("settings-type-fields@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
      })
      .expect(201);

    const response = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        data: { rule: "人物档案不应接受世界规则字段。" },
      })
      .expect(400);
    expect(response.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("cannot read or mutate another author's settings", async () => {
    const owner = await createAuthenticatedAgent("settings-owner@example.com");
    const other = await createAuthenticatedAgent("settings-other@example.com");
    const work = await createWork(owner);
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);

    expect((await other.get(path).expect(403)).body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    expect((await other.get(`${path}/${created.body.data.id}`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .patch(`${path}/${created.body.data.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: 1, summary: "越权修改" })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${path}/${created.body.data.id}/lock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: 1 })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .delete(`${path}/${created.body.data.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (await other.get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/facts`).expect(403))
        .body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
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
        displayName: "设定作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createWork(agent: SuperAgentTest) {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        mode: "idea",
        title: "忘川书",
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);
    return response.body.data as {
      id: string;
      mainBranch: { id: string };
    };
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
