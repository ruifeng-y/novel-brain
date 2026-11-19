import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import sharp from "sharp";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";

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

  async function createBlankWork(
    agent: SuperAgentTest,
    title: string,
  ): Promise<{ id: string; mainBranch: { id: string } }> {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ mode: "blank", title })
      .expect(200);
    return response.body.data as { id: string; mainBranch: { id: string } };
  }

  async function createChapterWithContent(
    agent: SuperAgentTest,
    token: string,
    work: { id: string; mainBranch: { id: string } },
    number: number,
    title: string,
    content: string,
  ): Promise<{ chapterId: string; chapterVersionId: string }> {
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const chapter = await agent
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number,
        title,
        brief: {
          goal: `完成${title}。`,
          pov: "沈砚",
          location: "山门",
          sceneBeats: ["主角抵达山门。"],
          requiredFacts: ["山门存在"],
        },
      })
      .expect(201);
    const saved = await agent
      .post(`${branchPath}/chapters/${chapter.body.data.id}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: chapter.body.data.version, content })
      .expect(201);
    return {
      chapterId: chapter.body.data.id as string,
      chapterVersionId: saved.body.data.version.id as string,
    };
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
    await databasePool.query("UPDATE works SET status = 'serializing'");
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

  it("projects dashboard progress, word count, quality and open foreshadows from persisted data", async () => {
    const owner = await createAuthenticatedAgent("dashboard-metrics@example.com");
    const work = await createBlankWork(owner, "卷末审计");
    const token = await csrf(owner);
    const firstChapter = await createChapterWithContent(
      owner,
      token,
      work,
      1,
      "第一章",
      "风雪压住山门。".repeat(20),
    );
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 2,
        title: "尚未动笔",
        brief: {
          goal: "完成第二章。",
          pov: "沈砚",
          location: "山门",
          sceneBeats: ["主角推开山门。"],
          requiredFacts: ["山门存在"],
        },
      })
      .expect(201);

    await databasePool.query(`UPDATE chapters SET word_count = 1200000 WHERE id = $1`, [
      firstChapter.chapterId,
    ]);
    const userId = (await owner.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
    const dimensions = [
      ["hook", "章末钩子"],
      ["pacing", "节奏"],
      ["information_density", "信息密度"],
      ["character_voice", "人物声纹"],
      ["prose", "文笔"],
      ["continuity", "连续性"],
    ].map(([dimension, label]) => ({
      dimension,
      label,
      score: 4,
      rationale: "证据充分。",
      evidence: [
        {
          kind: "chapter",
          sourceId: firstChapter.chapterId,
          sourceVersionId: firstChapter.chapterVersionId,
          chapterId: firstChapter.chapterId,
          chapterVersionId: firstChapter.chapterVersionId,
          quote: "风雪压住山门。",
          startOffset: 0,
          endOffset: 7,
          locator: "第一章开头",
          explanation: "正文证据。",
        },
      ],
    }));
    await databasePool.query(
      `INSERT INTO quality_reports
         (id, work_id, branch_id, user_id, chapter_id, chapter_version_id,
          rubric_version, rule_version, source_hash, dimensions, summary, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'm1-quality-rubric-v1', 'm1-critic-rules-v1',
               $7, $8::jsonb, '质量证据', $4)`,
      [
        uuidv7(),
        work.id,
        work.mainBranch.id,
        userId,
        firstChapter.chapterId,
        firstChapter.chapterVersionId,
        "a".repeat(64),
        JSON.stringify(dimensions),
      ],
    );
    await owner
      .post(`${branchPath}/ledger/entries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "dashboard-metrics-foreshadow")
      .send({
        kind: "foreshadow",
        title: "断碑下的旧名",
        summary: "断碑下的名字会在卷末回收。",
        responsibleRole: "protagonist",
        targetWindow: { fromChapter: 1, toChapter: 2 },
        importance: "must",
        readerPromise: "身世真相",
      })
      .expect(201);

    const listed = await owner.get("/api/v1/works").expect(200);
    expect(listed.body.data[0]).toMatchObject({
      id: work.id,
      metrics: {
        totalWordCount: 1_200_000,
        progress: {
          writtenChapters: 1,
          plannedChapters: 2,
          percent: 50,
        },
        qualityScore: 80,
        unrecoveredForeshadowCount: 1,
      },
    });
    expect(listed.body.data[0].metrics.lastEditedAt).toEqual(expect.any(String));
  });

  it("filters works by persisted word count and last edit time", async () => {
    const owner = await createAuthenticatedAgent("dashboard-filters@example.com");
    const titlesOf = (body: { data: Array<{ title: string }> }) =>
      body.data.map((work) => work.title).sort();
    const fixtures = [
      {
        title: "百万之后",
        wordCount: 1_500_000,
        age: "now()",
      },
      {
        title: "短篇旧稿",
        wordCount: 500_000,
        age: "now() - interval '2 days'",
      },
      {
        title: "超长旧稿",
        wordCount: 2_500_000,
        age: "now() - interval '40 days'",
      },
    ] as const;
    for (const fixture of fixtures) {
      const work = await createBlankWork(owner, fixture.title);
      const token = await csrf(owner);
      const chapter = await createChapterWithContent(
        owner,
        token,
        work,
        1,
        "第一章",
        "风雪压住山门。",
      );
      await databasePool.query(
        `UPDATE chapters
            SET word_count = $2,
                updated_at = ${fixture.age}
          WHERE id = $1`,
        [chapter.chapterId, fixture.wordCount],
      );
      await databasePool.query(
        `UPDATE works
            SET updated_at = ${fixture.age}
          WHERE id = $1`,
        [work.id],
      );
      await databasePool.query(
        `UPDATE work_branches
            SET updated_at = ${fixture.age}
          WHERE work_id = $1`,
        [work.id],
      );
    }

    const underOneMillion = await owner.get("/api/v1/works?words=lt1m").expect(200);
    expect(titlesOf(underOneMillion.body)).toEqual(["短篇旧稿"]);
    const oneToTwoMillion = await owner.get("/api/v1/works?words=1m-2m").expect(200);
    expect(titlesOf(oneToTwoMillion.body)).toEqual(["百万之后"]);
    const overTwoMillion = await owner.get("/api/v1/works?words=gt2m").expect(200);
    expect(titlesOf(overTwoMillion.body)).toEqual(["超长旧稿"]);
    const preparing = await owner.get("/api/v1/works?status=preparing").expect(200);
    expect(titlesOf(preparing.body)).toEqual(["百万之后", "短篇旧稿", "超长旧稿"].sort());

    const updatedToday = await owner.get("/api/v1/works?recent=day").expect(200);
    expect(titlesOf(updatedToday.body)).toEqual(["百万之后"]);
    const updatedThisWeek = await owner.get("/api/v1/works?recent=week").expect(200);
    expect(titlesOf(updatedThisWeek.body)).toEqual(["百万之后", "短篇旧稿"].sort());
    const updatedThisMonth = await owner.get("/api/v1/works?recent=month").expect(200);
    expect(titlesOf(updatedThisMonth.body)).toEqual(["百万之后", "短篇旧稿"].sort());
  });

  it("updates reversible settings with optimistic locking and archive/restore", async () => {
    const owner = await createAuthenticatedAgent("reversible-settings@example.com");
    const token = await csrf(owner);
    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "可逆作品" })
      .expect(200);
    const workId = created.body.data.id as string;

    const updated = await owner
      .patch(`/api/v1/works/${workId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        title: "可逆作品 · 新名",
        penName: "青舟",
        genre: "history",
        status: "serializing",
        scaleTarget: "epic",
        chapterLengthTarget: 3200,
        coverImageUrl: "https://assets.example.com/work-142.webp",
        tags: ["长线伏笔", "记忆代价"],
        settings: {
          targetPlatform: "起点中文网",
          targetAudience: "长篇历史读者",
          readerPromise: "每一次选择都要付出代价",
          updateCadence: "weekly",
          synopsis: "边城史官追查旧案。",
          styleSample: "风从城楼上压下来。",
          taboos: "不写无代价复活。",
        },
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      title: "可逆作品 · 新名",
      status: "serializing",
      chapterLengthTarget: 3200,
      tags: ["长线伏笔", "记忆代价"],
      settings: { targetPlatform: "起点中文网", updateCadence: "weekly" },
      version: created.body.data.version + 1,
    });

    const stale = await owner
      .patch(`/api/v1/works/${workId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: created.body.data.version, title: "过期修改" })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
    const versionNodesBeforeArchive = await countRows(databasePool, "version_nodes", workId);

    const archived = await owner
      .post(`/api/v1/works/${workId}/archive`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: updated.body.data.version })
      .expect(200);
    expect(archived.body.data.status).toBe("archived");
    expect(await countRows(databasePool, "version_nodes", workId)).toBe(versionNodesBeforeArchive);
    const defaultList = await owner.get("/api/v1/works").expect(200);
    expect(defaultList.body.data).toHaveLength(0);
    const archivedList = await owner.get("/api/v1/works?status=archived").expect(200);
    expect(archivedList.body.data).toHaveLength(1);

    const restored = await owner
      .post(`/api/v1/works/${workId}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: archived.body.data.version })
      .expect(200);
    expect(restored.body.data).toMatchObject({
      status: "serializing",
      archivedAt: null,
      mainBranch: { id: created.body.data.mainBranch.id },
    });
    expect(await countRows(databasePool, "version_nodes", workId)).toBe(versionNodesBeforeArchive);
  });

  it("trashes, restores and permanently deletes only after retention and export gates", async () => {
    const owner = await createAuthenticatedAgent("works-trash@example.com");
    const token = await csrf(owner);
    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "待清理作品" })
      .expect(200);
    const workId = created.body.data.id as string;
    const branchId = created.body.data.mainBranch.id as string;
    const versionNodesBefore = await countRows(databasePool, "version_nodes", workId);

    const trashed = await owner
      .post(`/api/v1/works/${workId}/trash`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: created.body.data.version })
      .expect(200);
    expect(trashed.body.data).toMatchObject({
      id: workId,
      deletedAt: expect.any(String),
      purgeAfter: expect.any(String),
    });
    expect((await owner.get("/api/v1/works").expect(200)).body.data).toHaveLength(0);
    expect((await owner.get("/api/v1/works?trash=true").expect(200)).body.data).toHaveLength(1);

    const restored = await owner
      .post(`/api/v1/works/${workId}/trash/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: trashed.body.data.version })
      .expect(200);
    expect(restored.body.data).toMatchObject({
      id: workId,
      deletedAt: null,
      purgeAfter: null,
      mainBranch: { id: branchId },
    });
    expect(await countRows(databasePool, "version_nodes", workId)).toBe(versionNodesBefore);

    const chapter = await owner
      .post(`/api/v1/works/${workId}/branches/${branchId}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "清理前正文",
        brief: {
          goal: "完成导出。",
          pov: "主角",
          location: "山门",
          sceneBeats: ["抵达山门。"],
          requiredFacts: ["山门存在"],
        },
      })
      .expect(201);
    await owner
      .post(
        `/api/v1/works/${workId}/branches/${branchId}/chapters/${chapter.body.data.id}/versions`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: chapter.body.data.version,
        content: "清理前正文。",
      })
      .expect(201);

    const exportResponse = await owner
      .post(`/api/v1/works/${workId}/branches/${branchId}/exports`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "trash-export")
      .send({ format: "txt", scope: { kind: "book" } });
    expect(exportResponse.status, JSON.stringify(exportResponse.body)).toBe(202);
    await databasePool.query(
      `UPDATE work_export_receipts
          SET status = 'completed',
              artifact_object_key = $2,
              checksum = $3,
              byte_size = 12,
              file_name = 'work.txt',
              content_type = 'text/plain',
              completed_at = now(),
              expires_at = now() + interval '1 day'
        WHERE id = $1`,
      [exportResponse.body.data.id, `exports/${workId}/trash-export.txt`, "a".repeat(64)],
    );

    const trashedAgain = await owner
      .post(`/api/v1/works/${workId}/trash`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: restored.body.data.version })
      .expect(200);
    await databasePool.query(
      `UPDATE works
          SET deleted_at = now() - interval '2 minutes',
              purge_after = now() - interval '1 minute'
        WHERE id = $1`,
      [workId],
    );
    await owner
      .post(`/api/v1/works/${workId}/purge`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: trashedAgain.body.data.version + 1 })
      .expect(409);
    expect(await countRows(databasePool, "work_export_receipts", workId)).toBe(1);
    const purged = await owner
      .post(`/api/v1/works/${workId}/purge`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: trashedAgain.body.data.version })
      .expect(200);
    expect(purged.body.data).toEqual({ id: workId, deleted: true });
    const purgedWorks = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM works WHERE id = $1",
      [workId],
    );
    expect(purgedWorks.rows[0]?.count).toBe("0");

    const noExport = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "无导出作品" })
      .expect(200);
    const noExportTrash = await owner
      .post(`/api/v1/works/${noExport.body.data.id}/trash`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: noExport.body.data.version })
      .expect(200);
    await databasePool.query(
      `UPDATE works
          SET deleted_at = now() - interval '2 minutes',
              purge_after = now() - interval '1 minute'
        WHERE id = $1`,
      [noExport.body.data.id],
    );
    const blocked = await owner
      .post(`/api/v1/works/${noExport.body.data.id}/purge`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: noExportTrash.body.data.version })
      .expect(409);
    expect(blocked.body.error.code).toBe("WORK_EXPORT_REQUIRED");
  });

  it("uploads a validated cover to object storage and serves a private image route", async () => {
    const owner = await createAuthenticatedAgent("work-cover@example.com");
    const token = await csrf(owner);
    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "有封面的作品" })
      .expect(200);
    const workId = created.body.data.id as string;
    const png = await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 3,
        background: { r: 47, g: 111, b: 94 },
      },
    })
      .png()
      .toBuffer();

    const uploaded = await owner
      .put(`/api/v1/works/${workId}/cover?version=${created.body.data.version}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", png, { filename: "cover.png", contentType: "image/png" });
    expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(200);
    expect(uploaded.body.data.coverImageUrl).toBe(`/api/v1/works/${workId}/cover`);

    const image = await owner.get(uploaded.body.data.coverImageUrl).expect(200);
    expect(image.headers["content-type"]).toContain("image/webp");
    expect(image.body).toBeInstanceOf(Buffer);
    expect(image.body.length).toBeGreaterThan(0);

    const external = await owner
      .patch(`/api/v1/works/${workId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: uploaded.body.data.version,
        coverImageUrl: "https://assets.example.com/cover.webp",
      })
      .expect(200);
    expect(external.body.data.coverImageUrl).toBe("https://assets.example.com/cover.webp");
    await owner.get(`/api/v1/works/${workId}/cover`).expect(404);

    const invalid = await owner
      .put(`/api/v1/works/${workId}/cover?version=${external.body.data.version}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from("not an image", "utf8"), {
        filename: "cover.txt",
        contentType: "text/plain",
      })
      .expect(400);
    expect(invalid.body.error.code).toBe("WORK_COVER_INVALID");
  });

  it("duplicates settings content without manuscript or chapter versions by default", async () => {
    const owner = await createAuthenticatedAgent("duplicate-settings@example.com");
    const token = await csrf(owner);
    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "待复制作品", genre: "xianxia" })
      .expect(200);
    const workId = created.body.data.id as string;
    const branchId = created.body.data.mainBranch.id as string;
    const branchPath = `/api/v1/works/${workId}/branches/${branchId}`;
    await owner
      .patch(`/api/v1/works/${workId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        settings: {
          targetPlatform: "起点中文网",
          targetAudience: "仙侠读者",
          readerPromise: "记忆换成长",
          updateCadence: "daily",
          synopsis: "失忆杂役追查身世。",
          styleSample: "雨落在断碑上，像细小的剑锋相击。",
          taboos: "不写无代价复活。",
        },
      })
      .expect(200);

    const createdEntity = await owner
      .post(`${branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折",
          knowledgeBoundary: "不知道身世",
          relationshipSummary: "独自追查",
        },
      })
      .expect(201);
    const entityId = createdEntity.body.data.id as string;
    const createdField = await owner
      .post(`${branchPath}/custom-fields`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        key: "fate",
        label: "命格",
        fieldType: "single_select",
        appliesTo: "character",
        required: false,
        options: ["剑骨", "凡骨"],
        relationTarget: null,
        sortOrder: 10,
      })
      .expect(201);
    const fieldId = createdField.body.data.id as string;
    await owner
      .post(`${branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ level: "book", parentId: null, title: "全书总纲", summary: "追查身世" })
      .expect(201);
    const bible = await owner.get(`${branchPath}/story-bible`).expect(200);
    await owner
      .patch(`${branchPath}/story-bible`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: bible.body.data.version,
        reason: "补全书名承诺",
        cards: [{ key: "oneSentence", content: "失忆杂役以古书追查身世。" }],
      })
      .expect(200);

    const userId = (
      await databasePool.query<{ user_id: string }>(
        "SELECT user_id FROM work_branches WHERE work_id = $1",
        [workId],
      )
    ).rows[0]!.user_id;
    await databasePool.query(
      `INSERT INTO custom_field_values
        (id, field_definition_id, entity_id, work_id, branch_id, user_id, value)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [uuidv7(), fieldId, entityId, workId, branchId, userId, JSON.stringify("剑骨")],
    );
    const rootNodeId = created.body.data.mainBranch.headNodeId as string;
    const addNode = async (nodeType: string, objectType: string, objectId: string) => {
      const nodeId = uuidv7();
      await databasePool.query(
        `INSERT INTO version_nodes
          (id, work_id, branch_id, user_id, parent_node_id, node_type, object_type,
           object_id, object_version, payload, actor_id, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, '{}', $4, '测试复制')`,
        [nodeId, workId, branchId, userId, rootNodeId, nodeType, objectType, objectId],
      );
      return nodeId;
    };
    const addEntity = async (type: string, name: string) => {
      const id = uuidv7();
      await databasePool.query(
        `INSERT INTO entities
          (id, work_id, branch_id, user_id, type, name, aliases, summary, description,
           attributes, tags, status, source, version)
         VALUES ($1, $2, $3, $4, $5, $6, '[]', $7, '', '{}', '[]', 'draft', 'author', 1)`,
        [id, workId, branchId, userId, type, name, `${name}摘要`],
      );
      return id;
    };

    const factionA = await addEntity("faction", "太玄门");
    const factionB = await addEntity("faction", "血河宗");
    await databasePool.query(
      `INSERT INTO faction_profiles
        (entity_id, work_id, branch_id, user_id, overview, goals, resources, doctrine)
       VALUES ($1, $2, $3, $4, '正道宗门', '守天门', '剑阵', '不得私斗')`,
      [factionA, workId, branchId, userId],
    );
    const factionRelationNode = await addNode("entity_version", "faction_relationship", uuidv7());
    await databasePool.query(
      `INSERT INTO faction_relationships
        (id, work_id, branch_id, user_id, source_faction_id, target_type, target_id,
         target_label, relation_type, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'faction', $6, '血河宗', 'enemy', 1, $7, $4)`,
      [uuidv7(), workId, branchId, userId, factionA, factionB, factionRelationNode],
    );

    const mapId = await addEntity("map", "北域山河");
    const layerId = uuidv7();
    const layerNode = await addNode("entity_version", "map_layer", layerId);
    await databasePool.query(
      `INSERT INTO map_layers
        (id, work_id, branch_id, user_id, map_id, name, sort_order, min_scale, max_scale,
         valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, '北域', 1, 0, 100, 1, $6, $4)`,
      [layerId, workId, branchId, userId, mapId, layerNode],
    );
    const mapNodeA = uuidv7();
    const mapNodeANode = await addNode("entity_version", "map_node", mapNodeA);
    const mapNodeB = uuidv7();
    const mapNodeBNode = await addNode("entity_version", "map_node", mapNodeB);
    for (const [id, name, versionNodeId] of [
      [mapNodeA, "荒寺", mapNodeANode],
      [mapNodeB, "血河城", mapNodeBNode],
    ] as const) {
      await databasePool.query(
        `INSERT INTO map_nodes
          (id, work_id, branch_id, user_id, map_id, layer_id, name, node_type, summary,
           valid_from_chapter, version_node_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'settlement', $7, 1, $8, $4)`,
        [id, workId, branchId, userId, mapId, layerId, name, versionNodeId],
      );
    }
    const edgeId = uuidv7();
    const edgeNode = await addNode("entity_version", "map_edge", edgeId);
    await databasePool.query(
      `INSERT INTO map_edges
        (id, work_id, branch_id, user_id, map_id, layer_id, from_node_id, to_node_id,
         route_type, bidirectional, travel_minutes, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'road', true, 60, 1, $9, $4)`,
      [edgeId, workId, branchId, userId, mapId, layerId, mapNodeA, mapNodeB, edgeNode],
    );
    const markerId = uuidv7();
    const markerNode = await addNode("entity_version", "map_marker", markerId);
    await databasePool.query(
      `INSERT INTO map_markers
        (id, work_id, branch_id, user_id, map_id, layer_id, node_id, label, marker_type,
         x, y, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '古战场', 'danger', 0.4, 0.6, 1, $8, $4)`,
      [markerId, workId, branchId, userId, mapId, layerId, mapNodeA, markerNode],
    );
    const controlId = uuidv7();
    const controlNode = await addNode("entity_version", "map_control", controlId);
    await databasePool.query(
      `INSERT INTO map_control
        (id, work_id, branch_id, user_id, faction_id, map_id, node_type, node_id,
         node_label, control_level, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'map_node', $7, '荒寺', 'direct', 1, $8, $4)`,
      [controlId, workId, branchId, userId, factionA, mapId, mapNodeA, controlNode],
    );
    const relationshipNode = await addNode("entity_version", "character_relationship", uuidv7());
    await databasePool.query(
      `INSERT INTO character_relationships
        (id, work_id, branch_id, user_id, source_character_id, target_type, target_id,
         target_label, relation_type, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'map_node', $6, '荒寺', 'located_at', 1, $7, $4)`,
      [uuidv7(), workId, branchId, userId, entityId, mapNodeA, relationshipNode],
    );
    const stateNode = await addNode("entity_version", "character_state", uuidv7());
    await databasePool.query(
      `INSERT INTO character_state_transitions
        (id, work_id, branch_id, user_id, character_id, state_kind, state_key, value,
         target_type, target_id, target_label, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'location', 'current_location', '荒寺',
         'map_node', $6, '荒寺', 1, $7, $4)`,
      [uuidv7(), workId, branchId, userId, entityId, mapNodeA, stateNode],
    );

    const powerId = await addEntity("power_system", "大玄修炼体系");
    await databasePool.query(
      `INSERT INTO power_systems (entity_id, work_id, branch_id, user_id, overview)
       VALUES ($1, $2, $3, $4, '五境修炼体系')`,
      [powerId, workId, branchId, userId],
    );
    const powerPathId = uuidv7();
    const powerPathNode = await addNode("entity_version", "power_path", powerPathId);
    await databasePool.query(
      `INSERT INTO power_paths
        (id, power_system_id, work_id, branch_id, user_id, name, path_type, sort_order,
         version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, '玄门正道', 'orthodox', 1, $6, $5)`,
      [powerPathId, powerId, workId, branchId, userId, powerPathNode],
    );
    const powerRealmId = uuidv7();
    const powerRealmNode = await addNode("entity_version", "power_realm", powerRealmId);
    await databasePool.query(
      `INSERT INTO power_realms
        (id, path_id, work_id, branch_id, user_id, name, rank, breakthrough_conditions,
         version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, '炼气', 1, '引气入体', $6, $5)`,
      [powerRealmId, powerPathId, workId, branchId, userId, powerRealmNode],
    );

    const itemId = await addEntity("item", "听潮剑");
    await databasePool.query(
      `INSERT INTO item_techniques
        (entity_id, work_id, branch_id, user_id, kind, category, effect, ownership_model)
       VALUES ($1, $2, $3, $4, 'resource', '兵器', '记录杀意', 'unique')`,
      [itemId, workId, branchId, userId],
    );
    const itemRightNode = await addNode("entity_version", "item_right", uuidv7());
    await databasePool.query(
      `INSERT INTO item_rights
        (id, item_id, work_id, branch_id, user_id, right_type, holder_type, holder_id,
         share_percent, valid_from_chapter, reason, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'ownership', 'character', $6, 100, 1, '师门传承', $7, $5)`,
      [uuidv7(), itemId, workId, branchId, userId, entityId, itemRightNode],
    );

    const eraId = uuidv7();
    const eraNode = await addNode("entity_version", "timeline_era", eraId);
    await databasePool.query(
      `INSERT INTO timeline_eras
        (id, work_id, branch_id, user_id, name, order_index, start_sort_key,
         version_node_id, created_by)
       VALUES ($1, $2, $3, $4, '大玄历', 1, 0, $5, $4)`,
      [eraId, workId, branchId, userId, eraNode],
    );
    const eventId = await addEntity("timeline_event", "天门洞开");
    const eventNode = await addNode("entity_version", "timeline_event", eventId);
    await databasePool.query(
      `INSERT INTO timeline_events
        (id, work_id, branch_id, user_id, era, story_time_label, story_time_sort_key,
         duration_minutes, event_text, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, '大玄历', '卷一末', 900, 60, '天门洞开', 4, $5, $4)`,
      [eventId, workId, branchId, userId, eventNode],
    );
    const mechanismId = await addEntity("golden_finger", "忘川书");
    await databasePool.query(
      `INSERT INTO special_mechanisms
        (entity_id, work_id, branch_id, user_id, mechanism_type, owner_type, owner_id,
         owner_label, rules, costs)
       VALUES ($1, $2, $3, $4, 'golden_finger', 'character', $5, '沈砚', '借前人经验', '失去记忆')`,
      [mechanismId, workId, branchId, userId, entityId],
    );
    const ownershipId = uuidv7();
    const ownershipNode = await addNode("entity_version", "mechanism_ownership", ownershipId);
    await databasePool.query(
      `INSERT INTO mechanism_ownership_events
        (id, mechanism_id, work_id, branch_id, user_id, owner_type, owner_id, owner_label,
         reason, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, 'character', $6, '沈砚', '继承', 1, $7, $5)`,
      [ownershipId, mechanismId, workId, branchId, userId, entityId, ownershipNode],
    );
    const itineraryNode = await addNode("entity_version", "character_itinerary", uuidv7());
    await databasePool.query(
      `INSERT INTO character_itineraries
        (id, work_id, branch_id, user_id, character_id, from_node_id, to_node_id,
         departure_era, departure_label, departure_sort_key, arrival_era, arrival_label,
         arrival_sort_key, route_travel_minutes, travel_minutes, valid_from_chapter,
         version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, '大玄历', '第一日', 1, '大玄历', '第一日二刻',
         2, 60, 60, 1, $8, $4)`,
      [uuidv7(), workId, branchId, userId, entityId, mapNodeA, mapNodeB, itineraryNode],
    );
    const sourceChapterId = uuidv7();
    await databasePool.query(
      `INSERT INTO chapters
        (id, work_id, branch_id, user_id, number, title, status, version, word_count, brief)
       VALUES ($1, $2, $3, $4, 1, '第一章', 'writing', 1, 12, '{"goal":"离开旧城"}')`,
      [sourceChapterId, workId, branchId, userId],
    );
    const sourceChapterVersionId = uuidv7();
    const sourceChapterVersionNode = await addNode("chapter_version", "chapter", sourceChapterId);
    await databasePool.query(
      `INSERT INTO chapter_versions
        (id, work_id, branch_id, user_id, chapter_id, version, content, content_hash,
         version_node_id, source)
       VALUES ($1, $2, $3, $4, $5, 1, '雨落在断碑上。', $6, $7, 'manual')`,
      [
        sourceChapterVersionId,
        workId,
        branchId,
        userId,
        sourceChapterId,
        "a".repeat(64),
        sourceChapterVersionNode,
      ],
    );
    await databasePool.query("UPDATE chapters SET current_version_id = $1 WHERE id = $2", [
      sourceChapterVersionId,
      sourceChapterId,
    ]);
    const styleProfileId = uuidv7();
    const styleProfileNode = await addNode("entity_version", "style_profile", styleProfileId);
    await databasePool.query(
      `INSERT INTO style_profiles
        (id, work_id, branch_id, user_id, scope, dimension, name, version,
         approval_status, source_type, source_id, source_version_id, source_version_node_id,
         source_label, profile, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, 'work', 'prose', '作者风格', 1, 'pending',
         'author_sample', $5, $6, $7, '第一章样本', $8::jsonb, $9, $4)`,
      [
        styleProfileId,
        workId,
        branchId,
        userId,
        sourceChapterId,
        sourceChapterVersionId,
        sourceChapterVersionNode,
        JSON.stringify({
          guides: ["短句"],
          samples: [
            {
              chapterId: sourceChapterId,
              chapterVersionId: sourceChapterVersionId,
              excerpt: "雨落在断碑上。",
              locator: "第 1 章 · 首句",
            },
          ],
          metrics: {
            averageSentenceLength: 8,
            exclamationRate: 0,
            dialogueRatio: 0,
          },
        }),
        styleProfileNode,
      ],
    );
    const styleBaselineId = uuidv7();
    const styleBaselineNode = await addNode("entity_version", "style_baseline", styleBaselineId);
    await databasePool.query(
      `INSERT INTO style_baselines
        (id, work_id, branch_id, user_id, source_type, source_id, version, profile,
         version_node_id, created_by)
       VALUES ($1, $2, $3, $4, 'golden_three', $5, 1, $6::jsonb, $7, $4)`,
      [
        styleBaselineId,
        workId,
        branchId,
        userId,
        uuidv7(),
        JSON.stringify({
          strategy: "hook_focus",
          candidateLabel: "候选 A",
          excerpts: [
            {
              chapterId: sourceChapterId,
              chapterVersionId: sourceChapterVersionId,
              excerpt: "雨落在断碑上。",
            },
          ],
        }),
        styleBaselineNode,
      ],
    );
    const factProposalId = uuidv7();
    await databasePool.query(
      `INSERT INTO fact_proposals
        (id, work_id, branch_id, user_id, chapter_id, source_version_id, extraction_key,
         subject, predicate, object, source_sentence, status, confidence, risk, required)
       VALUES ($1, $2, $3, $4, $5, $6, 'fact-1', '沈砚', '身体状态', '左臂骨折',
         '沈砚按住左臂。', 'confirmed', 0.98, 'high', true)`,
      [factProposalId, workId, branchId, userId, sourceChapterId, sourceChapterVersionId],
    );
    const factDecisionId = uuidv7();
    await databasePool.query(
      `INSERT INTO fact_decisions
        (id, work_id, branch_id, user_id, chapter_id, fact_proposal_id, action, actor_id,
         actor_name, reason, original_payload, resulting_payload)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirm', $4, '作者', '与正文一致',
         '{}', '{"object":"左臂骨折"}')`,
      [factDecisionId, workId, branchId, userId, sourceChapterId, factProposalId],
    );
    const canonCommitId = uuidv7();
    const canonNode = await addNode("canon_commit", "chapter", sourceChapterId);
    await databasePool.query(
      `INSERT INTO canon_commits
        (id, work_id, branch_id, user_id, chapter_id, chapter_version_id, version_node_id,
         idempotency_key, decision_snapshot, summary, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'canon-1', '[]', '{}', $4)`,
      [canonCommitId, workId, branchId, userId, sourceChapterId, sourceChapterVersionId, canonNode],
    );
    const factId = uuidv7();
    await databasePool.query(
      `INSERT INTO facts
        (id, work_id, branch_id, user_id, chapter_id, fact_proposal_id, decision_id,
         source_version_id, canon_commit_id, subject, predicate, object, risk, required,
         status, valid_from_chapter)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '沈砚', '身体状态', '左臂骨折',
         'high', true, 'active', 1)`,
      [
        factId,
        workId,
        branchId,
        userId,
        sourceChapterId,
        factProposalId,
        factDecisionId,
        sourceChapterVersionId,
        canonCommitId,
      ],
    );
    const knowledgeNode = await addNode("entity_version", "character_knowledge", uuidv7());
    await databasePool.query(
      `INSERT INTO character_knowledge_states
        (id, work_id, branch_id, user_id, character_id, objective_fact_id, state,
         claimed_content, source_kind, valid_from_chapter, version_node_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'knowledge', '知道自己左臂骨折', 'observed', 1, $7, $4)`,
      [uuidv7(), workId, branchId, userId, entityId, factId, knowledgeNode],
    );
    for (const entry of [
      {
        kind: "plot_thread",
        title: "父母之死",
        summary: "追查父母死亡真相。",
        responsibleRole: "protagonist",
        status: "planned",
        targetWindow: { fromChapter: 1, toChapter: 20 },
        threadType: "mystery",
        stakes: "身世与修行方向",
        tension: 70,
      },
      {
        kind: "foreshadow",
        title: "旧信压在箱底",
        summary: "信件会在后续揭开身世。",
        responsibleRole: "protagonist",
        status: "planned",
        targetWindow: { fromChapter: 1, toChapter: 10 },
        importance: "must",
        readerPromise: "身世谜团",
        relatedCharacterIds: [entityId],
        relatedFactionIds: [],
      },
      {
        kind: "character_arc",
        title: "沈砚从逃避到直面身世",
        summary: "完成第一段人物弧。",
        responsibleRole: "protagonist",
        status: "planned",
        targetWindow: { fromChapter: 1, toChapter: 30 },
        characterId: entityId,
        startState: "逃避身世",
        desire: "找回过去",
        fear: "失去自我",
        lie: "忘记就不会痛",
        truth: "记忆定义了他",
        endState: "主动追查",
      },
    ]) {
      await owner
        .post(`${branchPath}/ledger/entries`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", uuidv7())
        .send(entry)
        .expect(201);
    }
    await databasePool.query(
      `UPDATE plot_threads
       SET history = $1::jsonb
       WHERE work_id = $2 AND title = '父母之死'`,
      [
        JSON.stringify([
          {
            action: "setup",
            at: "2026-11-08T00:00:00.000Z",
            chapter: { id: sourceChapterId, title: "第一章" },
            event: { eventId, label: "天门洞开" },
          },
        ]),
        workId,
      ],
    );

    const missingKey = await owner
      .post(`/api/v1/works/${workId}/duplicate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({});
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe("VALIDATION_INVALID");

    const duplicated = await owner
      .post(`/api/v1/works/${workId}/duplicate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "duplicate-work-142")
      .send({})
      .expect(200);
    const copyId = duplicated.body.data.id as string;
    const copyBranchId = duplicated.body.data.mainBranch.id as string;
    const copyPath = `/api/v1/works/${copyId}/branches/${copyBranchId}`;

    const duplicateBible = await owner.get(`${copyPath}/story-bible`).expect(200);
    expect(
      duplicateBible.body.data.cards.find((card: { key: string }) => card.key === "oneSentence")
        .content,
    ).toBe("失忆杂役以古书追查身世。");
    const duplicateEntities = await owner.get(`${copyPath}/entities?type=character`).expect(200);
    expect(duplicateEntities.body.data).toHaveLength(1);
    const duplicateOutline = await owner.get(`${copyPath}/outline`).expect(200);
    expect(duplicateOutline.body.data.nodes).toHaveLength(1);
    const duplicateChapters = await owner.get(`${copyPath}/chapters`).expect(200);
    expect(duplicateChapters.body.data).toHaveLength(0);
    const copiedWork = await owner.get(`/api/v1/works/${copyId}`).expect(200);
    expect(copiedWork.body.data.settings.styleSample).toBe("雨落在断碑上，像细小的剑锋相击。");

    for (const table of [
      "chapters",
      "chapter_versions",
      "fact_proposals",
      "facts",
      "character_knowledge_states",
      "style_profiles",
      "style_baselines",
    ]) {
      expect(
        await countRows(databasePool, table, workId),
        `${table} source fixture`,
      ).toBeGreaterThan(0);
      expect(await countRows(databasePool, table, copyId), `${table} excluded from copy`).toBe(0);
    }
    expect(await countRows(databasePool, "golden_three_candidates", copyId)).toBe(0);
    const copiedEvent = await databasePool.query<{ id: string }>(
      "SELECT id FROM timeline_events WHERE work_id = $1 LIMIT 1",
      [copyId],
    );
    const copiedHistory = await databasePool.query<{ history: unknown[] }>(
      "SELECT history FROM plot_threads WHERE work_id = $1 AND title = '父母之死'",
      [copyId],
    );
    expect(JSON.stringify(copiedHistory.rows[0]?.history)).not.toContain(sourceChapterId);
    expect(JSON.stringify(copiedHistory.rows[0]?.history)).not.toContain(eventId);
    expect(copiedHistory.rows[0]?.history).toMatchObject([
      {
        chapter: { id: null },
        event: { eventId: copiedEvent.rows[0]?.id },
      },
    ]);

    const replay = await owner
      .post(`/api/v1/works/${workId}/duplicate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "duplicate-work-142")
      .send({})
      .expect(200);
    expect(replay.body.data.id).toBe(copyId);
    const conflicting = await owner
      .post(`/api/v1/works/${workId}/duplicate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "duplicate-work-142")
      .send({ copyManuscript: true, copyHistory: true })
      .expect(409);
    expect(conflicting.body.error.code).toBe("WORK_IDEMPOTENCY_CONFLICT");

    for (const table of [
      "custom_field_definitions",
      "custom_field_values",
      "entities",
      "entity_versions",
      "character_profiles",
      "character_state_transitions",
      "character_relationships",
      "faction_profiles",
      "faction_relationships",
      "map_control",
      "map_layers",
      "map_nodes",
      "map_edges",
      "map_markers",
      "power_systems",
      "power_paths",
      "power_realms",
      "special_mechanisms",
      "mechanism_ownership_events",
      "item_techniques",
      "item_rights",
      "timeline_eras",
      "timeline_events",
      "character_itineraries",
      "plot_threads",
      "foreshadows",
      "character_arcs",
      "outline_nodes",
      "volume_contracts",
      "scene_cards",
      "story_bibles",
      "story_bible_versions",
      "story_bible_world_rules",
    ]) {
      const sourceCount = await countRows(databasePool, table, workId);
      const copyCount = await countRows(databasePool, table, copyId);
      expect(copyCount, `${table} should be deeply copied`).toBe(sourceCount);
    }
    expect(await countRows(databasePool, "chapters", copyId)).toBe(0);
    expect(await countRows(databasePool, "chapter_versions", copyId)).toBe(0);
    expect(entityId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects cross-tenant work mutations", async () => {
    const owner = await createAuthenticatedAgent("work-mutations-owner@example.com");
    const other = await createAuthenticatedAgent("work-mutations-other@example.com");
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "租户边界作品" })
      .expect(200);
    const workId = created.body.data.id as string;
    const version = created.body.data.version as number;

    const foreignUpdate = await other
      .patch(`/api/v1/works/${workId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version, title: "越权修改" });
    expect(foreignUpdate.status).toBe(403);
    expect(foreignUpdate.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const foreignArchive = await other
      .post(`/api/v1/works/${workId}/archive`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version });
    expect(foreignArchive.status).toBe(403);
    expect(foreignArchive.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const foreignRestore = await other
      .post(`/api/v1/works/${workId}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version });
    expect(foreignRestore.status).toBe(403);
    expect(foreignRestore.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const foreignDuplicate = await other
      .post(`/api/v1/works/${workId}/duplicate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .set("Idempotency-Key", "cross-tenant-duplicate")
      .send({});
    expect(foreignDuplicate.status).toBe(403);
    expect(foreignDuplicate.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("enforces tag shape and work RLS at the database boundary", async () => {
    const owner = await createAuthenticatedAgent("work-tags-owner@example.com");
    await createAuthenticatedAgent("work-tags-other@example.com");
    const token = await csrf(owner);
    const created = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "标签约束作品" })
      .expect(200);
    const workId = created.body.data.id as string;

    for (const tags of [
      ["重复", "重复"],
      [""],
      ["超".repeat(31)],
      Array.from({ length: 21 }, (_, index) => `标签${index}`),
      [1],
    ]) {
      await expect(
        databasePool.query("UPDATE works SET tags = $1::jsonb WHERE id = $2", [
          JSON.stringify(tags),
          workId,
        ]),
      ).rejects.toThrow();
    }
    for (const coverImageUrl of ["https://.", "https://-:99999/%zz"]) {
      await expect(
        databasePool.query("UPDATE works SET cover_image_url = $1 WHERE id = $2", [
          coverImageUrl,
          workId,
        ]),
      ).rejects.toThrow();
    }

    const ownerId = (
      await databasePool.query<{ user_id: string }>(
        "SELECT user_id FROM work_branches WHERE work_id = $1",
        [workId],
      )
    ).rows[0]!.user_id;
    const otherId = (
      await databasePool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
        "work-tags-other@example.com",
      ])
    ).rows[0]!.id;
    await databasePool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novelbrain_works_rls_test') THEN
          CREATE ROLE novelbrain_works_rls_test NOLOGIN;
        END IF;
      END
      $$;
    `);
    await databasePool.query("GRANT USAGE ON SCHEMA public TO novelbrain_works_rls_test");
    await databasePool.query("GRANT SELECT, UPDATE ON works TO novelbrain_works_rls_test");
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE novelbrain_works_rls_test");
      await client.query("SELECT set_config('app.user_id', $1, true)", [otherId]);
      const hidden = await client.query<{ count: string }>("SELECT count(*) FROM works");
      expect(hidden.rows[0]?.count).toBe("0");
      const denied = await client.query("UPDATE works SET title = 'RLS 绕过' WHERE id = $1", [
        workId,
      ]);
      expect(denied.rowCount).toBe(0);
      await client.query("SELECT set_config('app.user_id', $1, true)", [ownerId]);
      const visible = await client.query<{ count: string }>("SELECT count(*) FROM works");
      expect(visible.rows[0]?.count).toBe("1");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function countRows(
  pool: ReturnType<typeof createDatabasePool>,
  table: string,
  workId: string,
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM "${table.replaceAll('"', '""')}" WHERE work_id = $1`,
    [workId],
  );
  return Number(result.rows[0]?.count ?? 0);
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
