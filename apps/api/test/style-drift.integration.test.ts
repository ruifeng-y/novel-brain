import "reflect-metadata";

import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  chapterVersionSaveResponseSchema,
  styleDriftReportResponseSchema,
  styleDriftWorkspaceResponseSchema,
  styleProfileResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const databaseUrl = dedicatedDatabaseUrl(
  process.env.TEST_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test",
);
const redisUrl = dedicatedRedisUrl(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2");
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("style baseline and drift HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "style-drift-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "style-drift-integration-proxy-secret";
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
    await app.listen(0, "127.0.0.1");
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

  it("approves traceable baselines, separates growth from drift and never rewrites the chapter", async () => {
    const owner = await createAuthenticatedAgent("style-drift-owner@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const character = await createCharacter(owner, token, base);
    const chapters = await createChapters(owner, token, base);

    const empty = styleDriftWorkspaceResponseSchema.parse(
      (await owner.get(`${base}/style`).expect(200)).body,
    ).data;
    expect(empty).toMatchObject({
      profiles: [],
      latestChapterReport: null,
      latestVolumeReport: null,
      latestCrossVolumeReport: null,
    });

    const blockedDraft = await owner
      .post(`${base}/style/profiles`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        scope: "character",
        scopeId: character.id,
        dimension: "character_voice",
        name: "沈砚 · 克制声线",
        source: {
          type: "approved_chapter_version",
          id: chapters[0]!.versionId,
          versionId: chapters[0]!.versionId,
          label: "第 1 章 · 正文",
        },
      })
      .expect(409);
    expect(blockedDraft.body.error.code).toBe("STYLE_SOURCE_NOT_APPROVED");

    const created = styleProfileResponseSchema.parse(
      (
        await owner
          .post(`${base}/style/profiles`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            scope: "character",
            scopeId: character.id,
            dimension: "character_voice",
            name: "沈砚 · 克制声线",
            source: {
              type: "author_sample",
              id: chapters[0]!.versionId,
              versionId: chapters[0]!.versionId,
              label: "第 1 章 · 作者样本",
            },
          })
          .expect(201)
      ).body,
    ).data;
    expect(created).toMatchObject({
      scope: "character",
      scopeId: character.id,
      dimension: "character_voice",
      version: 1,
      approvalStatus: "pending",
      approval: null,
      source: {
        type: "author_sample",
        id: chapters[0]!.versionId,
        versionId: chapters[0]!.versionId,
      },
    });

    const unapprovedCheck = await owner
      .post(`${base}/style/drift`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        scope: "chapter",
        chapterId: chapters[2]!.id,
        model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
        prompt: { key: "style-drift-review", version: 1 },
      })
      .expect(409);
    expect(unapprovedCheck.body.error.code).toBe("STYLE_BASELINE_UNAPPROVED");

    const approved = styleProfileResponseSchema.parse(
      (
        await owner
          .post(`${base}/style/profiles/${created.id}/approve`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: created.version,
            rationale: "作者确认这是沈砚前期的稳定声线。",
          })
          .expect(200)
      ).body,
    ).data;
    expect(approved).toMatchObject({
      version: 2,
      approvalStatus: "approved",
      approval: {
        approvedBy: expect.any(String),
        approvedAt: expect.any(String),
        rationale: "作者确认这是沈砚前期的稳定声线。",
      },
    });

    await createCharacterArc(owner, token, base, character.id, chapters[0]!.id);

    const chapterReport = styleDriftReportResponseSchema.parse(
      (
        await owner
          .post(`${base}/style/drift`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            scope: "chapter",
            chapterId: chapters[2]!.id,
            model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
            prompt: { key: "style-drift-review", version: 1 },
          })
          .expect(200)
      ).body,
    ).data;
    expect(chapterReport).toMatchObject({
      scope: "chapter",
      chapterId: chapters[2]!.id,
      window: { fromChapter: 3, toChapter: 3 },
      baseline: {
        id: created.id,
        version: 2,
        dimension: "character_voice",
        sourceType: "author_sample",
      },
      profileVersion: 2,
      ruleVersion: "m1-style-drift-v1",
      model: { provider: "deepseek", model: "deepseek-chat" },
      prompt: { key: "style-drift-review", version: 1 },
      findings: [
        expect.objectContaining({
          code: "CHARACTER_VOICE_DRIFT",
          classification: "drift",
          chapterId: chapters[2]!.id,
          locator: "第 3 章 · 第 1 段",
          quote: expect.stringContaining("不可能"),
          growthEvidence: null,
        }),
      ],
    });

    const crossVolume = styleDriftReportResponseSchema.parse(
      (
        await owner
          .post(`${base}/style/drift`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            scope: "cross_volume",
            fromChapter: 2,
            toChapter: 4,
            model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
            prompt: { key: "style-drift-review", version: 1 },
          })
          .expect(200)
      ).body,
    ).data;
    expect(crossVolume.findings.map((finding) => finding.classification)).toEqual([
      "drift",
      "intentional_development",
    ]);
    expect(crossVolume.findings[1]).toMatchObject({
      chapterId: chapters[3]!.id,
      code: "INTENTIONAL_CHARACTER_DEVELOPMENT",
      growthEvidence: {
        startState: "克制，压住情绪",
        endState: "不再克制，情绪转为热烈",
      },
    });
    expect(crossVolume.trend).toHaveLength(3);
    expect(crossVolume.profileVersion).toBe(2);

    const volume = styleDriftReportResponseSchema.parse(
      (
        await owner
          .post(`${base}/style/drift`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            scope: "volume",
            fromChapter: 2,
            toChapter: 3,
            model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
            prompt: { key: "style-drift-review", version: 1 },
          })
          .expect(200)
      ).body,
    ).data;
    expect(volume.scope).toBe("volume");
    expect(volume.findings).toHaveLength(1);

    const workspace = styleDriftWorkspaceResponseSchema.parse(
      (await owner.get(`${base}/style`).expect(200)).body,
    ).data;
    expect(workspace.latestChapterReport?.id).toBe(chapterReport.id);
    expect(workspace.latestVolumeReport?.id).toBe(volume.id);
    expect(workspace.latestCrossVolumeReport?.id).toBe(crossVolume.id);
    expect(workspace.profiles).toEqual([
      expect.objectContaining({ id: created.id, approvalStatus: "approved", version: 2 }),
    ]);

    const chapterAfter = await owner.get(`${base}/chapters/${chapters[2]!.id}`).expect(200);
    expect(chapterAfter.body.data.currentVersion.content).toBe(chapters[2]!.content);

    const versions = await databasePool.query<{ id: string; content: string }>(
      "SELECT id, content FROM chapter_versions WHERE chapter_id = $1 ORDER BY version",
      [chapters[2]!.id],
    );
    expect(versions.rows).toEqual([
      expect.objectContaining({ id: chapters[2]!.versionId, content: chapters[2]!.content }),
    ]);

    const styleVersions = await databasePool.query<{ object_type: string; action: string }>(
      `SELECT object_type, payload->>'action' AS action
       FROM version_nodes
       WHERE object_id = $1
       ORDER BY created_at`,
      [created.id],
    );
    expect(styleVersions.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["style.profile_created", "style.profile_approved"]),
    );

    const tables = ["style_profiles", "style_drift_reports", "style_drift_findings"];
    const rls = await databasePool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [tables],
    );
    expect(rls.rows).toHaveLength(tables.length);
    for (const row of rls.rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
    const policies = await databasePool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [tables],
    );
    expect(new Set(policies.rows.map((row) => row.tablename))).toEqual(new Set(tables));

    const other = await createAuthenticatedAgent("style-drift-other@example.com");
    const otherToken = await csrf(other);
    expect((await other.get(`${base}/style`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${base}/style/drift`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            scope: "chapter",
            chapterId: chapters[2]!.id,
            model: { provider: "deepseek", model: "deepseek-chat", parameters: {} },
            prompt: { key: "style-drift-review", version: 1 },
          })
          .expect(403)
      ).body.error.code,
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
        displayName: "声线基线作者",
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
      .set("Idempotency-Key", randomUUID())
      .send({
        mode: "idea",
        title: "忘川书",
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);
    return response.body.data as { id: string; mainBranch: { id: string } };
  }

  async function createCharacter(agent: SuperAgentTest, token: string, base: string) {
    const response = await agent
      .post(`${base}/characters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "沈砚",
        aliases: ["小砚"],
        summary: "被宗门抛弃的外门杂役。",
        description: "",
        tags: [],
        profile: {
          desire: "找回被抹去的记忆",
          fear: "成为忘川书的下一个祭品",
          goal: "进入天门",
          voiceSample: "风停了。他没有回头。",
          voiceGuide: "句子短，少用感叹。",
          disguise: "藏起左臂伤势",
        },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.character as { id: string };
  }

  async function createChapters(agent: SuperAgentTest, token: string, base: string) {
    const contents = [
      "风停了。\n他没有回头。\n“走吧。”沈砚说。",
      "山门在雨里。\n沈砚收好铜牌。\n“今日不进去。”",
      "不可能！！！这绝不可能！！！\n他看见天裂开了！！！血液像火一样燃烧！！！",
      "他终于喊了出来！！！这声音烧穿了长夜！！！\n他不再压住胸口的火！！！",
    ];
    const chapters: Array<{
      id: string;
      versionId: string;
      version: number;
      content: string;
    }> = [];
    for (let index = 0; index < contents.length; index += 1) {
      const content = contents[index]!;
      const created = await agent
        .post(`${base}/chapters`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          number: index + 1,
          title: ["风声", "山门", "天裂", "火起"][index],
          brief: {
            goal: "保持沈砚克制但逐步被逼到极限。",
            pov: "沈砚",
            location: "荒寺外山道",
            sceneBeats: ["发现异常", "被迫行动"],
            requiredFacts: ["沈砚不能暴露忘川书"],
          },
        })
        .expect(201);
      const saved = chapterVersionSaveResponseSchema.parse(
        (
          await agent
            .post(`${base}/chapters/${created.body.data.id}/versions`)
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({ version: 1, content })
            .expect(201)
        ).body,
      ).data;
      chapters.push({
        id: created.body.data.id as string,
        versionId: saved.version.id,
        version: saved.chapter.version,
        content,
      });
    }
    return chapters;
  }

  async function createCharacterArc(
    agent: SuperAgentTest,
    token: string,
    base: string,
    characterId: string,
    sourceChapterId: string,
  ) {
    await agent
      .post(`${base}/ledger/entries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        kind: "character_arc",
        title: "沈砚不再压住情绪",
        summary: "第一次主动释放忘川书的力量。",
        responsibleRole: "protagonist",
        targetWindow: { fromChapter: 4, toChapter: 5 },
        characterId,
        startState: "克制，压住情绪",
        desire: "护住同行者。",
        fear: "再次失去重要的人。",
        lie: "只要不流露情绪就不会被看穿。",
        truth: "真正力量来自承认愤怒。",
        endState: "不再克制，情绪转为热烈",
        sourceChapterId,
        status: "planted",
        reason: "第四卷前段第一次情绪爆发。",
        evidence: [],
      })
      .expect(201);
  }
});

function dedicatedDatabaseUrl(baseUrl: string): string {
  const target = new URL(baseUrl);
  target.pathname = `/novelbrain_test_119_${suffix}`;
  return target.toString();
}

function dedicatedRedisUrl(baseUrl: string): string {
  const target = new URL(baseUrl);
  target.pathname = `/${3 + (Number.parseInt(suffix.slice(0, 2), 16) % 12)}`;
  return target.toString();
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName.startsWith("novelbrain_test_119_")) {
    throw new Error("Style drift tests must use a dedicated test database");
  }
  const adminUrl = new URL(url);
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
