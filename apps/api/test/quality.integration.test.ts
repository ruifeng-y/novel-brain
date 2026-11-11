import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  chapterVersionSaveResponseSchema,
  criticAnnotationListResponseSchema,
  criticAnnotationResponseSchema,
  qualityWorkspaceResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
const databaseUrl = dedicatedDatabaseUrl(`novelbrain_test_117_${suffix}`);
const redisUrl = dedicatedRedisUrl();
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("quality critic HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "quality-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "quality-integration-proxy-secret";
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
    await resetDatabase(databasePool);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("reports six dimensions, blocks downstream gates and keeps a dismiss/reopen lifecycle", async () => {
    const owner = await createAuthenticatedAgent("quality-owner@example.com");
    const fixture = await createQualityFixture(owner);
    const contradictory = [
      "沈砚忽然明白，父母死于仇杀。",
      "沈砚双手结印，断臂竟毫无妨碍。",
      "太震撼了！！！不可能！！！",
    ].join("\n\n");
    const firstVersion = await saveVersion(owner, fixture, contradictory);

    await setChapterStatus(fixture.chapterId, "waiting_review");
    const missingReport = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ action: "approve", version: fixture.chapterVersion })
      .expect(409);
    expect(missingReport.body.error).toMatchObject({
      code: "QUALITY_GATE_BLOCKED",
      details: { reportState: "missing" },
    });

    const verified = await verify(owner, fixture, firstVersion.id);
    expect(verified.report?.dimensions).toHaveLength(6);
    expect(verified.report?.dimensions.every((dimension) => dimension.evidence.length > 0)).toBe(
      true,
    );
    expect(verified.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["FACT_CONTRADICTION", "UNDISCLOSED_KNOWLEDGE", "STYLE_DRIFT"]),
    );
    expect(verified.gate).toMatchObject({ canApprove: false, canCommitCanon: false });
    expect(verified.annotations.length).toBeGreaterThan(0);

    const annotations = criticAnnotationListResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/chapters/${fixture.chapterId}/annotations`)
          .expect(200)
      ).body,
    ).data;
    expect(annotations.every((annotation) => annotation.endOffset > annotation.startOffset)).toBe(
      true,
    );

    await setChapterStatus(fixture.chapterId, "waiting_review");
    const blockedApproval = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ action: "approve", version: fixture.chapterVersion })
      .expect(409);
    expect(blockedApproval.body.error.code).toBe("QUALITY_GATE_BLOCKED");

    await setChapterStatus(fixture.chapterId, "approved");
    const blockedCanon = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "quality-canon-blocked")
      .send({ chapterVersionId: firstVersion.id })
      .expect(409);
    expect(blockedCanon.body.error.code).toBe("QUALITY_GATE_BLOCKED");
    expect(blockedCanon.body.error.details.gate).toBe("canon_commit");

    const critical = verified.findings.find((finding) => finding.code === "FACT_CONTRADICTION")!;
    const undismissable = await owner
      .patch(`${fixture.branchPath}/annotations/${critical.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        action: "dismiss",
        version: critical.version,
        reason: "作者认为这只是描写失误。",
      })
      .expect(409);
    expect(undismissable.body.error.code).toBe("CRITIC_FINDING_NOT_DISMISSIBLE");

    const style = verified.findings.find((finding) => finding.code === "STYLE_DRIFT")!;
    const dismissed = criticAnnotationResponseSchema.parse(
      (
        await owner
          .patch(`${fixture.branchPath}/annotations/${style.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", fixture.token)
          .send({
            action: "dismiss",
            version: style.version,
            reason: "这里的连续感叹是人物情绪失控时的有意处理。",
          })
          .expect(200)
      ).body,
    ).data;
    expect(dismissed).toMatchObject({
      status: "dismissed",
      ignoredReason: "这里的连续感叹是人物情绪失控时的有意处理。",
    });
    const reopened = criticAnnotationResponseSchema.parse(
      (
        await owner
          .patch(`${fixture.branchPath}/annotations/${style.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", fixture.token)
          .send({ action: "reopen", version: dismissed.version })
          .expect(200)
      ).body,
    ).data;
    expect(reopened).toMatchObject({ status: "open", ignoredReason: null });

    await setChapterStatus(fixture.chapterId, "writing");
    const cleanVersion = await saveVersion(owner, fixture, "沈砚只用右手结印。\n\n风停了。");
    await setChapterStatus(fixture.chapterId, "waiting_review");
    const clean = await verify(owner, fixture, cleanVersion.id);
    expect(clean.findings.every((finding) => finding.severity !== "P0")).toBe(true);
    expect(clean.gate.canApprove).toBe(true);
    const lifecycle = criticAnnotationListResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/chapters/${fixture.chapterId}/annotations`)
          .expect(200)
      ).body,
    ).data;
    expect(lifecycle.find((annotation) => annotation.findingId === critical.id)?.status).toBe(
      "superseded",
    );

    const approved = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ action: "approve", version: fixture.chapterVersion })
      .expect(200);
    expect(approved.body.data.chapter.status).toBe("approved");

    const other = await createAuthenticatedAgent("quality-other@example.com");
    expect(
      (await other.get(`${fixture.branchPath}/chapters/${fixture.chapterId}/quality`).expect(403))
        .body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .get(`${fixture.branchPath}/chapters/${fixture.chapterId}/annotations`)
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    const otherToken = await csrf(other);
    expect(
      (
        await other
          .patch(`${fixture.branchPath}/annotations/${style.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ action: "reopen", version: reopened.version })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  async function verify(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createQualityFixture>>,
    chapterVersionId: string,
  ) {
    const response = await agent
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/verify`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ chapterVersionId });
    if (response.status !== 200) {
      throw new Error(`verify failed: ${response.status} ${JSON.stringify(response.body)}`);
    }
    return qualityWorkspaceResponseSchema.parse(response.body).data;
  }

  async function saveVersion(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createQualityFixture>>,
    content: string,
  ) {
    const response = await agent
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ version: fixture.chapterVersion, content })
      .expect(201);
    const saved = chapterVersionSaveResponseSchema.parse(response.body).data;
    fixture.chapterVersion = saved.chapter.version;
    return saved.version;
  }

  async function setChapterStatus(chapterId: string, status: string): Promise<void> {
    await databasePool.query("UPDATE chapters SET status = $2 WHERE id = $1", [chapterId, status]);
  }

  async function createQualityFixture(agent: SuperAgentTest) {
    const work = await createWork(agent);
    const token = await csrf(agent);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(agent, token, branchPath);
    const character = await createConfirmedSettings(agent, token, branchPath);
    const chapter = await createChapter(agent, token, branchPath);
    const userId = (await agent.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
    const profile = await databasePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM character_profiles WHERE entity_id = $1",
      [character.id],
    );
    if (profile.rows[0]?.count === "0") {
      await databasePool.query(
        `INSERT INTO character_profiles
           (entity_id, work_id, branch_id, user_id, voice_sample, voice_guide)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          character.id,
          work.id,
          work.mainBranch.id,
          userId,
          "“我记得，只是还没想起来。”",
          "句子短，少用感叹。",
        ],
      );
    } else {
      await databasePool.query(
        "UPDATE character_profiles SET voice_sample = $2, voice_guide = $3 WHERE entity_id = $1",
        [character.id, "“我记得，只是还没想起来。”", "句子短，少用感叹。"],
      );
    }
    return {
      workId: work.id,
      branchPath,
      chapterId: chapter.id,
      token,
      chapterVersion: chapter.version,
    };
  }

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
        displayName: "质量报告作者",
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
    return response.body.data as { id: string; mainBranch: { id: string } };
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
  ): Promise<{ id: string }> {
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
    let characterId = "";
    for (const entity of entities) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(entity)
        .expect(201);
      if (entity.type === "character") {
        characterId = created.body.data.id as string;
      }
      await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
    }
    return { id: characterId };
  }

  async function createChapter(agent: SuperAgentTest, token: string, branchPath: string) {
    const response = await agent
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "一只手也能结印",
        brief: {
          goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["沈砚藏起断臂。", "血河宗追兵逼近。"],
          requiredFacts: ["左臂骨折，不能双手结印"],
        },
      })
      .expect(201);
    return response.body.data as { id: string; version: number };
  }
});

function dedicatedDatabaseUrl(databaseName: string): string {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test",
  );
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function dedicatedRedisUrl(): string {
  const url = new URL(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2");
  url.pathname = `/${10 + Math.floor(Math.random() * 5)}`;
  return url.toString();
}

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName.startsWith("novelbrain_test_117_")) {
    throw new Error("Quality tests must use a dedicated test database");
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

async function resetDatabase(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  await pool.query("TRUNCATE TABLE users CASCADE");
}
