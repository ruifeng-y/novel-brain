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
const invalidCursor = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c01";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("GET list cursor pagination HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "list-pagination-auth-secret";
    process.env.PROXY_IP_SECRET = "list-pagination-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
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
    await databasePool.query("TRUNCATE TABLE users CASCADE");
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("paginates collections with stable cursors, invalid-cursor rejection and tenant isolation", async () => {
    const owner = await createAuthenticatedAgent("pagination-owner@example.com");
    const other = await createAuthenticatedAgent("pagination-other@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const chaptersPath = `${base}/chapters`;

    const empty = await owner.get(`${chaptersPath}?limit=2`);
    expect(empty.status, JSON.stringify(empty.body)).toBe(200);
    expect(empty.body.data).toEqual([]);
    expect(empty.body.meta.nextCursor).toBeNull();

    for (const number of [2, 3, 4]) {
      await postJson(owner, token, chaptersPath, {
        number,
        title: `第${number}章`,
        brief: chapterBrief(),
      }).expect(201);
    }

    const firstChapterPage = await owner.get(`${chaptersPath}?limit=2`).expect(200);
    expect(firstChapterPage.body.data).toHaveLength(2);
    expect(firstChapterPage.body.data.map((chapter: { number: number }) => chapter.number)).toEqual(
      [2, 3],
    );
    expect(firstChapterPage.body.meta.nextCursor).toEqual(expect.any(String));

    await postJson(owner, token, chaptersPath, {
      number: 1,
      title: "并发插入章",
      brief: chapterBrief(),
    }).expect(201);
    await postJson(owner, token, chaptersPath, {
      number: 5,
      title: "游标之后并发插入章",
      brief: chapterBrief(),
    }).expect(201);

    const lastChapterPage = await owner
      .get(`${chaptersPath}?limit=2&cursor=${firstChapterPage.body.meta.nextCursor}`)
      .expect(200);
    expect(lastChapterPage.body.data).toHaveLength(2);
    expect(lastChapterPage.body.data.map((chapter: { number: number }) => chapter.number)).toEqual([
      4, 5,
    ]);
    expect(lastChapterPage.body.meta.nextCursor).toBeNull();
    const beyondLastChapterPage = await owner
      .get(`${chaptersPath}?limit=2&cursor=${lastChapterPage.body.data.at(-1).id}`)
      .expect(200);
    expect(beyondLastChapterPage.body.data).toEqual([]);
    expect(beyondLastChapterPage.body.meta.nextCursor).toBeNull();
    const chapterId = firstChapterPage.body.data[0].id as string;

    for (const name of ["沈砚", "顾青", "苏眠"]) {
      await postJson(owner, token, `${base}/characters`, characterPayload(name)).expect(201);
    }
    for (const name of ["太玄门", "血河宗", "北域盟"]) {
      await postJson(owner, token, `${base}/world/factions`, factionPayload(name)).expect(201);
    }
    for (const index of [1, 2, 3]) {
      await postJson(owner, token, "/api/v1/users/me/pen-names", {
        name: `笔名${index}`,
      }).expect(200);
    }
    for (const index of [1, 2, 3]) {
      await postJson(owner, token, "/api/v1/model-configs", {
        provider: "deepseek",
        label: `模型配置${index}`,
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-pagination-test-value",
        purposes: ["planning"],
        isDefault: false,
      }).expect(200);
    }
    await loginAgent("pagination-owner@example.com", "StrongPassword123", "pagination-device-2");
    await loginAgent("pagination-owner@example.com", "StrongPassword123", "pagination-device-3");

    const paginatedPaths = [
      `${base}/characters`,
      `${base}/world/factions`,
      "/api/v1/users/me/pen-names",
      "/api/v1/model-configs",
      "/api/v1/auth/sessions",
    ];
    for (const path of paginatedPaths) {
      const firstPage = await owner.get(`${path}?limit=2`).expect(200);
      expect(firstPage.body.data).toHaveLength(2);
      expect(firstPage.body.meta.nextCursor).toEqual(expect.any(String));

      const lastPage = await owner
        .get(`${path}?limit=2&cursor=${firstPage.body.meta.nextCursor}`)
        .expect(200);
      expect(lastPage.body.data).toHaveLength(1);
      expect(lastPage.body.meta.nextCursor).toBeNull();

      const invalid = await owner.get(`${path}?limit=2&cursor=${invalidCursor}`).expect(400);
      expect(invalid.body.error.code).toBe("VALIDATION_INVALID");
      const offset = await owner.get(`${path}?limit=2&offset=0`).expect(400);
      expect(offset.body.error.code).toBe("VALIDATION_INVALID");
    }

    const branches = await owner.get(`/api/v1/works/${work.id}/branches?limit=1`).expect(200);
    expect(branches.body.data).toHaveLength(1);
    expect(branches.body.meta.nextCursor).toBeNull();

    const invalidCursorPaths = [
      "/api/v1/works",
      `/api/v1/works/${work.id}/branches`,
      `${base}/story-bible/versions`,
      `${base}/story-bible/world-rules`,
      `${base}/canon/commits`,
      `${base}/chapters/${chapterId}/write-actions`,
      `${base}/chapters/${chapterId}/revisions`,
      `${base}/agent-runs`,
      `${base}/jobs?chapterId=${chapterId}`,
    ];
    for (const path of invalidCursorPaths) {
      const invalid = await owner.get(`${path}?limit=2&cursor=${invalidCursor}`).expect(400);
      expect(invalid.body.error.code).toBe("VALIDATION_INVALID");
    }

    const foreignChapters = await other.get(`${chaptersPath}?limit=2`).expect(403);
    expect(foreignChapters.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignCharacters = await other.get(`${base}/characters?limit=2`).expect(403);
    expect(foreignCharacters.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignPenNames = await other.get("/api/v1/users/me/pen-names?limit=2").expect(200);
    expect(foreignPenNames.body.data).toEqual([]);
    expect(foreignPenNames.body.meta.nextCursor).toBeNull();
    const foreignModelConfigs = await other.get("/api/v1/model-configs?limit=2").expect(200);
    expect(foreignModelConfigs.body.data).toEqual([]);
    expect(foreignModelConfigs.body.meta.nextCursor).toBeNull();
  });

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const token = await csrf(agent);
    await agent
      .post("/api/v1/auth/register/send-code")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ email })
      .expect(200);
    await agent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        email,
        code: mail.codes.get(email),
        password: "StrongPassword123",
        displayName: "分页作者",
      })
      .expect(200);
    return agent;
  }

  async function loginAgent(
    email: string,
    password: string,
    userAgentName: string,
  ): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const token = await csrf(agent);
    await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("User-Agent", userAgentName)
      .set("X-CSRF-Token", token)
      .send({ email, password })
      .expect(200);
    return agent;
  }

  async function createWork(agent: SuperAgentTest, token: string) {
    const response = await postJson(agent, token, "/api/v1/works", {
      mode: "idea",
      title: "游标分页测试",
      idea: "一个作者在长篇连载中保持设定与章节稳定。",
      genre: "xianxia",
    }).expect(200);
    return response.body.data as { id: string; mainBranch: { id: string } };
  }

  function postJson(agent: SuperAgentTest, token: string, path: string, body: unknown) {
    return agent.post(path).set("Origin", origin).set("X-CSRF-Token", token).send(body);
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }
});

function chapterBrief() {
  return {
    goal: "让主角在危机中找到稳定路径。",
    pov: "沈砚",
    location: "荒寺外山道",
    sceneBeats: ["追兵逼近", "主角结印", "同伴动摇"],
    requiredFacts: ["主角左臂受伤", "同伴不知道古书来历"],
  };
}

function characterPayload(name: string) {
  return {
    name,
    aliases: [],
    summary: `${name}的档案。`,
    description: "",
    tags: [],
    profile: {
      desire: "找回记忆",
      fear: "被古书吞噬",
      goal: "进入天门",
      voiceSample: "",
      voiceGuide: "",
      disguise: "",
    },
  };
}

function factionPayload(name: string) {
  return {
    name,
    aliases: [],
    summary: `${name}的势力档案。`,
    description: "",
    tags: [],
    profile: {
      overview: `${name}盘踞北域。`,
      goals: "扩张控制区。",
      resources: "灵脉与弟子。",
      doctrine: "强者为尊。",
    },
  };
}

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
