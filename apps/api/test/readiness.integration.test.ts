import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { generationReadinessResponseSchema } from "@novel-brain/contracts";
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

describe("generation readiness HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "readiness-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "readiness-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1";

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

  it("returns a stable ready result for the same work, version and config", async () => {
    const owner = await createAuthenticatedAgent("readiness-ready@example.com");
    const fixture = await createReadyFixture(owner);

    const first = await owner
      .get(`${fixture.branchPath}/readiness?chapterId=${fixture.chapterId}`)
      .expect(200);
    const second = await owner
      .get(`${fixture.branchPath}/readiness?chapterId=${fixture.chapterId}`)
      .expect(200);
    const readiness = generationReadinessResponseSchema.parse(first.body).data;

    expect(readiness).toMatchObject({
      ruleVersion: "readiness-v1",
      status: "ready",
      canProceed: true,
      blockers: 0,
      warnings: 0,
      chapterId: fixture.chapterId,
    });
    expect(readiness.dependencies.length).toBeGreaterThan(5);
    expect(readiness.items.every((item) => item.ready)).toBe(true);
    expect((second.body.data as { dependencyFingerprint: string }).dependencyFingerprint).toBe(
      readiness.dependencyFingerprint,
    );
  });

  it("reports missing and unlocked resources, exact targets and cross-tenant denial", async () => {
    const owner = await createAuthenticatedAgent("readiness-missing@example.com");
    const other = await createAuthenticatedAgent("readiness-other@example.com");
    const work = await createWork(owner);
    const branchPath = branchPathOf(work);

    expect((await other.get(`${branchPath}/readiness`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );

    const missing = generationReadinessResponseSchema.parse(
      (await owner.get(`${branchPath}/readiness`).expect(200)).body,
    ).data;
    expect(missing.status).toBe("not_ready");
    expect(missing.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "story_bible",
          state: "missing",
          resource: expect.objectContaining({
            type: "story_bible",
            id: null,
          }),
          remediation: expect.objectContaining({
            href: `/workspace/${work.id}/bible#story-bible-readiness`,
          }),
        }),
        expect.objectContaining({
          key: "model_config",
          state: "missing",
          remediation: expect.objectContaining({
            href: "/workspace/settings/account#model-config-title",
          }),
        }),
      ]),
    );

    const token = await csrf(owner);
    const chapter = await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "还不能生成的章",
        brief: {
          goal: "等待准备度满足后再生成。",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["沈砚停下。"],
          requiredFacts: ["左臂骨折。"],
        },
      })
      .expect(201);
    const blockedGeneration = await owner
      .post(`${branchPath}/chapters/${chapter.body.data.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({})
      .expect(409);
    expect(blockedGeneration.body.error).toMatchObject({
      code: "GEN_READINESS_BLOCKED",
      details: {
        ruleVersion: "readiness-v1",
        items: expect.arrayContaining([
          expect.objectContaining({ key: "story_bible" }),
          expect.objectContaining({ key: "model_config" }),
        ]),
      },
    });

    await owner
      .post(`${branchPath}/story-bible/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const unlocked = generationReadinessResponseSchema.parse(
      (await owner.get(`${branchPath}/readiness`).expect(200)).body,
    ).data;
    expect(unlocked.items).toContainEqual(
      expect.objectContaining({
        key: "story_bible",
        state: "unlocked",
        severity: "blocker",
      }),
    );
  });

  it("keeps warnings non-blocking and blocks invalid budgets", async () => {
    const owner = await createAuthenticatedAgent("readiness-partial@example.com");
    const fixture = await createReadyFixture(owner);
    await databasePool.query(
      "UPDATE model_configs SET last_test_status = null WHERE user_id = (SELECT id FROM users WHERE email = $1)",
      ["readiness-partial@example.com"],
    );

    const partial = generationReadinessResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/readiness?chapterId=${fixture.chapterId}`)
          .expect(200)
      ).body,
    ).data;
    expect(partial).toMatchObject({
      status: "partial",
      canProceed: true,
      blockers: 0,
    });
    expect(partial.items).toContainEqual(
      expect.objectContaining({
        key: "model_config",
        severity: "warning",
        ready: false,
      }),
    );

    const budget = generationReadinessResponseSchema.parse(
      (
        await owner
          .get(
            `${fixture.branchPath}/readiness?chapterId=${fixture.chapterId}&maxTokens=1000&maxCostCny=0`,
          )
          .expect(200)
      ).body,
    ).data;
    expect(budget).toMatchObject({
      status: "not_ready",
      canProceed: false,
    });
    expect(budget.items).toContainEqual(
      expect.objectContaining({
        key: "budget",
        state: "invalid",
        remediation: expect.objectContaining({
          href: expect.stringContaining(
            `/workspace/${fixture.workId}/write?chapterId=${fixture.chapterId}`,
          ),
        }),
      }),
    );
  });

  it("reports conflicts and risk approvals and invalidates stale readiness", async () => {
    const owner = await createAuthenticatedAgent("readiness-conflict@example.com");
    const fixture = await createReadyFixture(owner);
    const token = await csrf(owner);

    const draftCharacter = await owner
      .post(`${fixture.branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "顾青",
        aliases: [],
        summary: "追查忘川书的同门。",
        description: "",
        tags: [],
        data: {
          bodyState: "轻伤",
          knowledgeBoundary: "怀疑沈砚隐瞒来历",
          relationshipSummary: "与沈砚互相试探",
        },
      })
      .expect(201);
    await owner
      .post(`${fixture.branchPath}/entities/${draftCharacter.body.data.id}/proposals`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: draftCharacter.body.data.version,
        reason: "章节事实与人物认知冲突",
        conflictType: "contradictory_fact",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "冲突说明",
            quote: "顾青在同一章既知道又不知道忘川书。",
            locator: "",
            confidence: null,
          },
        ],
      })
      .expect(201);
    await owner
      .post(`${fixture.branchPath}/entities/${fixture.characterId}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        version: fixture.characterVersion,
        title: "调整沈砚身体状态",
        reason: "高风险身体状态变化需要先确认",
        conflictType: "contradictory_fact",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "作者说明",
            quote: "这条修改会改变既有伤势。",
            locator: "",
            confidence: null,
          },
        ],
        after: {
          data: {
            bodyState: "左臂已经恢复",
          },
        },
      })
      .expect(201);

    const before = generationReadinessResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/readiness?chapterId=${fixture.chapterId}`)
          .expect(200)
      ).body,
    ).data;
    expect(before).toMatchObject({
      status: "not_ready",
      canProceed: false,
    });
    expect(before.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "settings",
          state: "conflict",
        }),
        expect.objectContaining({
          key: "risk_approval",
          state: "pending",
          remediation: expect.objectContaining({
            href: expect.stringContaining("/settings?column=characters&entityId="),
          }),
        }),
      ]),
    );

    const chapter = await owner
      .get(`${fixture.branchPath}/chapters/${fixture.chapterId}`)
      .expect(200);
    await owner
      .patch(`${fixture.branchPath}/chapters/${fixture.chapterId}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: chapter.body.data.version,
        brief: {
          goal: "更新后的章目标",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["沈砚藏起断臂。"],
          requiredFacts: ["左臂骨折，不能双手结印。"],
        },
      })
      .expect(200);
    const after = generationReadinessResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/readiness?chapterId=${fixture.chapterId}`)
          .expect(200)
      ).body,
    ).data;
    expect(after.dependencyFingerprint).not.toBe(before.dependencyFingerprint);
  });

  async function createReadyFixture(agent: SuperAgentTest) {
    const work = await createWork(agent);
    const branchPath = branchPathOf(work);
    await createTestedModelConfig(agent);
    await lockStoryBible(agent, branchPath);
    const token = await csrf(agent);
    const settings = await createConfirmedSettings(agent, token, branchPath);
    const outline = await createOutline(agent, token, {
      workId: work.id,
      branchId: work.mainBranch.id,
      characterId: settings.characterId,
      mapId: settings.mapId,
    });
    return {
      workId: work.id,
      branchPath,
      chapterId: outline.chapterId,
      characterId: settings.characterId,
      characterVersion: settings.characterVersion,
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
        displayName: "准备度作者",
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

  async function createTestedModelConfig(agent: SuperAgentTest) {
    const token = await csrf(agent);
    const created = await agent
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-fake-generation-1234",
        purposes: ["writing"],
        isDefault: true,
      })
      .expect(200);
    await agent
      .post(`/api/v1/model-configs/${created.body.data.id}/test`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(200);
  }

  async function lockStoryBible(agent: SuperAgentTest, branchPath: string) {
    const token = await csrf(agent);
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

  async function createConfirmedSettings(agent: SuperAgentTest, token: string, branchPath: string) {
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
        aliases: ["小砚"],
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
      {
        type: "map",
        name: "荒寺外山道",
        aliases: [],
        summary: "荒寺外的山道。",
        description: "",
        tags: [],
        data: { details: "荒寺外山道" },
      },
    ] as const;
    let characterId = "";
    let characterVersion = 0;
    let mapId = "";
    for (const entity of entities) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(entity);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const locked = await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
      if (entity.type === "character") {
        characterId = created.body.data.id as string;
        characterVersion = locked.body.data.version as number;
      }
      if (entity.type === "map") {
        mapId = created.body.data.id as string;
      }
    }
    return { characterId, characterVersion, mapId };
  }

  async function createOutline(
    agent: SuperAgentTest,
    token: string,
    context: { workId: string; branchId: string; characterId: string; mapId: string },
  ) {
    const outlinePath = `/api/v1/works/${context.workId}/branches/${context.branchId}/outline`;
    const book = await createOutlineNode(agent, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "忘川书",
    });
    const volume = await createOutlineNode(agent, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第一卷 · 少年出山",
    });
    const act = await createOutlineNode(agent, token, outlinePath, {
      level: "act",
      parentId: volume.id,
      title: "第一幕 · 断臂",
    });
    const chapter = await createOutlineNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: act.id,
      chapterCreate: {
        number: 1,
        title: "一只手也能结印",
        brief: {
          goal: "让沈砚在断臂后找到新的战斗方式。",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["沈砚藏起断臂。", "顾青撞见。", "忘川书显形。"],
          requiredFacts: ["左臂骨折，不能双手结印。"],
        },
      },
    });
    const scene = await createOutlineNode(agent, token, outlinePath, {
      level: "scene",
      parentId: chapter.id,
      title: "藏起断臂",
    });
    await agent
      .put(`${outlinePath}/nodes/${volume.id}/volume-contract`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        objective: "沈砚第一次真正面对血河宗。",
        conflict: "血河宗追捕与左臂重伤。",
        turningPoints: ["断臂", "忘川书显形"],
        exitConditions: ["离开南境"],
        plotLines: [{ name: "天门将开", status: "active", note: "主线" }],
      })
      .expect(200);
    await agent
      .put(`${outlinePath}/nodes/${scene.id}/scene-card`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        title: "藏起断臂",
        pov: {
          type: "character",
          id: context.characterId,
          branchId: context.branchId,
          label: "沈砚",
          version: null,
        },
        location: {
          type: "map",
          id: context.mapId,
          branchId: context.branchId,
          label: "荒寺外山道",
          version: null,
        },
        storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
        beats: [{ description: "沈砚藏起断臂。" }, { description: "顾青撞见。" }],
        informationReleases: [
          { description: "顾青看见书页一角", constraint: "顾青不能知道完整来历" },
        ],
        tension: 72,
      })
      .expect(200);
    return { chapterId: chapter.chapter.id as string };
  }

  async function createOutlineNode(
    agent: SuperAgentTest,
    token: string,
    outlinePath: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body)
      .expect(201);
    return response.body.data.node as {
      id: string;
      chapter?: { id: string };
    };
  }

  function branchPathOf(work: { id: string; mainBranch: { id: string } }) {
    return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
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
