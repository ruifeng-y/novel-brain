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

describe("chapter workspace HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "chapters-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "chapters-integration-proxy-secret";
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

  it("creates a complete chapter brief as planned and reports every readiness blocker", async () => {
    const owner = await createAuthenticatedAgent("chapter-brief@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const chaptersPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/chapters`;
    const parentNodeId = (await owner.get(`/api/v1/works/${work.id}`).expect(200)).body.data
      .mainBranch.headNodeId as string;

    const empty = await owner.get(chaptersPath).expect(200);
    expect(empty.body.data).toEqual([]);

    const readiness = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/outline/readiness`)
      .expect(200);
    expect(readiness.body.data).toMatchObject({
      status: "not_ready",
      completed: 0,
      total: 3,
      canStartWriting: false,
      items: [
        {
          key: "story_bible",
          ready: false,
          missing: ["故事圣经尚未锁定"],
        },
        {
          key: "settings",
          ready: false,
        },
        {
          key: "brief",
          ready: false,
          missing: ["还没有章纲"],
        },
      ],
    });

    const invalid = await owner
      .post(chaptersPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: completeBrief(),
        ignored: true,
      })
      .expect(400);
    expect(invalid.body.error.code).toBe("VALIDATION_INVALID");

    const created = await owner
      .post(chaptersPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: completeBrief(),
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      number: 1,
      title: "一只手也能结印",
      status: "planned",
      version: 1,
      currentVersionId: null,
      currentVersion: null,
      brief: completeBrief(),
      readiness: {
        status: "partial",
        completed: 1,
        total: 3,
        canStartWriting: false,
        items: [
          {
            key: "story_bible",
            ready: false,
          },
          {
            key: "settings",
            ready: false,
          },
          {
            key: "brief",
            ready: true,
            missing: [],
          },
        ],
      },
    });

    const graph = await databasePool.query<{
      node_type: string;
      object_type: string;
      parent_node_id: string;
      branch_head_node_id: string;
    }>(
      `SELECT vn.node_type, vn.object_type, vn.parent_node_id, wb.head_node_id AS branch_head_node_id
       FROM version_nodes vn
       JOIN work_branches wb ON wb.id = vn.branch_id
       WHERE vn.object_id = $1`,
      [created.body.data.id],
    );
    expect(graph.rows).toEqual([
      {
        node_type: "outline_version",
        object_type: "chapter_brief",
        parent_node_id: parentNodeId,
        branch_head_node_id: graph.rows[0]?.branch_head_node_id,
      },
    ]);
    expect(graph.rows[0]?.branch_head_node_id).not.toBe(parentNodeId);

    const overview = await owner.get(`/api/v1/works/${work.id}`).expect(200);
    expect(overview.body.data.readiness.items).toContainEqual({
      key: "outline",
      label: "大纲",
      ready: true,
    });
  });

  it("becomes ready only with a locked bible, confirmed settings and a complete brief", async () => {
    const owner = await createAuthenticatedAgent("chapter-ready@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const created = await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: completeBrief(),
      })
      .expect(201);

    expect(created.body.data.readiness).toMatchObject({
      status: "ready",
      completed: 3,
      total: 3,
      canStartWriting: true,
      items: [
        { key: "story_bible", ready: true, missing: [] },
        { key: "settings", ready: true, missing: [] },
        { key: "brief", ready: true, missing: [] },
      ],
    });
    const readiness = await owner.get(`${branchPath}/chapters/${created.body.data.id}/readiness`);
    expect(readiness.status).toBe(200);
    expect(readiness.body.data.status).toBe("ready");
  });

  it("moves planned chapters to writing and appends manual saves to the single version graph", async () => {
    const owner = await createAuthenticatedAgent("chapter-versions@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const created = await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: completeBrief(),
      })
      .expect(201);
    const versionsPath = `${branchPath}/chapters/${created.body.data.id}/versions`;
    const parentNodeId = (await owner.get(`/api/v1/works/${work.id}`).expect(200)).body.data
      .mainBranch.headNodeId as string;

    const first = await owner
      .post(versionsPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        content: "血从袖口滴下来，落在青石板上。",
      })
      .expect(201);
    expect(first.body.data).toMatchObject({
      chapter: {
        status: "writing",
        version: created.body.data.version + 1,
        wordCount: 15,
      },
      version: {
        version: 1,
        content: "血从袖口滴下来，落在青石板上。",
        parentNodeId,
      },
    });

    const second = await owner
      .post(versionsPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: first.body.data.chapter.version,
        content: "血从袖口滴下来，落在青石板上。\n\n沈砚把断臂藏进袖中。",
      })
      .expect(201);
    expect(second.body.data).toMatchObject({
      chapter: {
        status: "writing",
        version: first.body.data.chapter.version + 1,
      },
      version: {
        version: 2,
        parentNodeId: first.body.data.version.versionNodeId,
      },
    });
    expect(second.body.data.chapter.currentVersionId).toBe(second.body.data.version.id);

    const versions = await owner.get(versionsPath).expect(200);
    expect(versions.body.data).toHaveLength(2);
    expect(versions.body.data.map((version: { version: number }) => version.version)).toEqual([
      2, 1,
    ]);
    expect(versions.body.data[0].content).toContain("把断臂藏进袖中");

    const graph = await databasePool.query<{
      node_type: string;
      parent_node_id: string;
      object_version: number;
      branch_head_node_id: string;
    }>(
      `SELECT vn.node_type, vn.parent_node_id, vn.object_version,
              wb.head_node_id AS branch_head_node_id
       FROM version_nodes vn
       JOIN work_branches wb ON wb.id = vn.branch_id
       WHERE vn.object_id = $1 AND vn.node_type = 'chapter_version'
       ORDER BY vn.created_at`,
      [created.body.data.id],
    );
    expect(graph.rows).toEqual([
      {
        node_type: "chapter_version",
        parent_node_id: parentNodeId,
        object_version: 1,
        branch_head_node_id: graph.rows[0]?.branch_head_node_id,
      },
      {
        node_type: "chapter_version",
        parent_node_id: first.body.data.version.versionNodeId,
        object_version: 2,
        branch_head_node_id: graph.rows[1]?.branch_head_node_id,
      },
    ]);
    expect(second.body.data.chapter.currentVersionId).toBe(second.body.data.version.id);
    expect(second.body.data.version.versionNodeId).toBe(graph.rows[1]?.branch_head_node_id);

    const stale = await owner
      .post(versionsPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        content: "不应覆盖新版本。",
      })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
  });

  it("rejects cross-tenant chapter reads and saves", async () => {
    const owner = await createAuthenticatedAgent("chapter-owner@example.com");
    const other = await createAuthenticatedAgent("chapter-other@example.com");
    const work = await createWork(owner);
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const created = await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: completeBrief(),
      })
      .expect(201);
    const chapterPath = `${branchPath}/chapters/${created.body.data.id}`;

    expect((await other.get(`${branchPath}/chapters`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect((await other.get(chapterPath).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${chapterPath}/versions`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: 1, content: "越权正文" })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("does not reopen a locked chapter when a manual save is attempted", async () => {
    const owner = await createAuthenticatedAgent("chapter-locked@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const created = await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: completeBrief(),
      })
      .expect(201);
    await databasePool.query("UPDATE chapters SET status = 'locked' WHERE id = $1", [
      created.body.data.id,
    ]);

    const rejected = await owner
      .post(`${branchPath}/chapters/${created.body.data.id}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        content: "锁定章节不应被重新打开。",
      })
      .expect(409);
    expect(rejected.body.error).toMatchObject({
      code: "VALIDATION_INVALID",
      message: "章节当前状态不能保存新版本",
    });
    const briefRejected = await owner
      .patch(`${branchPath}/chapters/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        title: "锁定章节的新标题",
      })
      .expect(409);
    expect(briefRejected.body.error).toMatchObject({
      code: "VALIDATION_INVALID",
      message: "章节当前状态不能修改章纲",
    });

    const [chapter] = (
      await databasePool.query<{ status: string; version: number }>(
        "SELECT status, version FROM chapters WHERE id = $1",
        [created.body.data.id],
      )
    ).rows;
    expect(chapter).toEqual({
      status: "locked",
      version: created.body.data.version,
    });
    const versions = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM chapter_versions WHERE chapter_id = $1",
      [created.body.data.id],
    );
    expect(versions.rows[0]?.count).toBe("0");
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
        displayName: "章节作者",
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

  async function createCompleteBible(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<void> {
    const generated = await agent
      .post(`${branchPath}/story-bible/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    await agent
      .post(`${branchPath}/story-bible/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: generated.body.data.version })
      .expect(200);
  }

  async function createConfirmedSettings(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<void> {
    const entities = [
      {
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      },
      {
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "隐藏忘川书的外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折，不能双手结印。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "与顾青互相试探。",
        },
      },
      {
        type: "golden_finger",
        name: "忘川书",
        aliases: [],
        summary: "以记忆换取前人经验。",
        description: "",
        tags: [],
        data: {
          rules: "每次只能借用一位前人的经验。",
          cost: "永久失去一段重要记忆。",
          limits: "每次使用消耗一页。",
          growth: "缺失记忆会拼成完整人格。",
        },
      },
    ] as const;
    for (const entity of entities) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(entity)
        .expect(201);
      await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
    }
  }
});

function completeBrief() {
  return {
    goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
    pov: "沈砚",
    location: "荒寺外山道",
    sceneBeats: [
      "沈砚藏起断臂，被顾青撞见。",
      "血河宗追兵逼近，两人被迫联手。",
      "沈砚单手结印，忘川书短暂显形。",
      "顾青看见书页一角，但没有点破。",
    ],
    requiredFacts: ["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"],
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
