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

describe("settings import HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "settings-import-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "settings-import-integration-proxy-secret";
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
        displayName: "设定导入作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  it("recognizes partial pasted settings as typed accepted, pending and unparsed content", async () => {
    const owner = await createAuthenticatedAgent("partial-import@example.com");
    const token = await csrf(owner);

    const created = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        sourceName: "部分设定",
        text: [
          "人物：沈砚，外门杂役，左臂骨折。",
          "力量体系：练气 → 筑基，突破需灵石。",
          "这是一段暂时无法归类的旧笔记。",
        ].join("\n"),
      })
      .expect(200);

    expect(created.body.data).toMatchObject({
      status: "awaiting_confirmation",
      canConfirm: true,
      report: {
        accepted: [
          {
            type: "character",
            name: "沈砚",
            sourceExcerpt: "人物：沈砚，外门杂役，左臂骨折。",
            status: "accepted",
          },
        ],
        pending: [
          {
            type: "power_system",
            sourceExcerpt: "力量体系：练气 → 筑基，突破需灵石。",
            status: "pending",
          },
        ],
        conflicts: [],
        unparsed: [
          {
            sourceExcerpt: "这是一段暂时无法归类的旧笔记。",
          },
        ],
      },
    });
    expect(created.body.data.report.accepted[0].confidence).toBeGreaterThanOrEqual(0.9);
    expect(created.body.data.report.pending[0].confidence).toBeLessThan(0.9);

    const fetched = await owner.get(`/api/v1/imports/${created.body.data.id}`).expect(200);
    expect(fetched.body.data.report).toEqual(created.body.data.report);
    const report = await owner.get(`/api/v1/imports/${created.body.data.id}/report`).expect(200);
    expect(report.body.data).toEqual(created.body.data.report);
  });

  it("accepts a supported small settings fixture file", async () => {
    const owner = await createAuthenticatedAgent("file-import@example.com");
    const token = await csrf(owner);

    const created = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach(
        "file",
        Buffer.from(
          ["人物：顾青，太玄门弟子，负责监视沈砚。", "地图：人界 → 东境 → 忘川渡。"].join("\n"),
          "utf8",
        ),
        { filename: "settings-fixture.md", contentType: "text/markdown" },
      )
      .expect(200);

    expect(created.body.data).toMatchObject({
      sourceKind: "file",
      sourceName: "settings-fixture.md",
      report: {
        accepted: [
          { type: "character", name: "顾青" },
          { type: "map", name: "人界 → 东境 → 忘川渡" },
        ],
      },
    });
  });

  it("reports contradictory candidates and disables confirmation", async () => {
    const owner = await createAuthenticatedAgent("conflict-import@example.com");
    const token = await csrf(owner);

    const created = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        text: [
          "人物：沈砚，外门杂役，左臂骨折。",
          "人物：沈砚，外门杂役，左臂完好。",
          "势力：太玄门，正道魁首。",
        ].join("\n"),
      })
      .expect(200);

    expect(created.body.data.canConfirm).toBe(false);
    expect(created.body.data.report.conflicts).toHaveLength(1);
    expect(created.body.data.report.conflicts[0]).toMatchObject({
      type: "contradictory_setting",
      decision: "pending",
      candidates: [
        {
          type: "character",
          name: "沈砚",
          sourceExcerpt: "人物：沈砚，外门杂役，左臂骨折。",
          status: "conflict",
        },
        {
          type: "character",
          name: "沈砚",
          sourceExcerpt: "人物：沈砚，外门杂役，左臂完好。",
          status: "conflict",
        },
      ],
    });
    expect(created.body.data.report.accepted).toEqual([
      expect.objectContaining({ type: "faction", name: "太玄门" }),
    ]);
  });

  it("blocks confirmation until every conflict is decided, then creates a new work", async () => {
    const owner = await createAuthenticatedAgent("confirm-import@example.com");
    const token = await csrf(owner);
    const existing = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ mode: "blank", title: "同名旧作" })
      .expect(200);

    const created = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        text: [
          "人物：沈砚，外门杂役，左臂骨折。",
          "人物：沈砚，外门杂役，左臂完好。",
          "金手指：忘川书，以记忆换取前人经验。",
        ].join("\n"),
      })
      .expect(200);
    const importId = created.body.data.id as string;
    const conflictId = created.body.data.report.conflicts[0].id as string;
    const confirmPayload = {
      title: "同名旧作",
      genre: "xianxia",
      scaleTarget: "long",
      chapterLengthTarget: 3000,
    };

    const blocked = await owner
      .post(`/api/v1/imports/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "settings-import-confirm-1")
      .send(confirmPayload)
      .expect(409);
    expect(blocked.body.error.code).toBe("IMPORT_CONFLICT_UNRESOLVED");

    const decided = await owner
      .post(`/api/v1/imports/${importId}/conflicts/${conflictId}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ decision: "use_primary", reason: "以左臂骨折版本为准" })
      .expect(200);
    expect(decided.body.data.canConfirm).toBe(true);
    expect(decided.body.data.report.conflicts[0]).toMatchObject({
      decision: "use_primary",
      decidedAt: expect.any(String),
    });

    const confirmed = await owner
      .post(`/api/v1/imports/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "settings-import-confirm-1")
      .send(confirmPayload)
      .expect(200);
    expect(confirmed.body.data).toMatchObject({
      title: "同名旧作",
      sourceMode: "settings_import",
      settings: { importId },
      mainBranch: { name: "main", status: "active" },
    });
    expect(confirmed.body.data.id).not.toBe(existing.body.data.id);

    const replay = await owner
      .post(`/api/v1/imports/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "settings-import-confirm-1")
      .send(confirmPayload)
      .expect(200);
    expect(replay.body.data.id).toBe(confirmed.body.data.id);
    const replayWithNewKey = await owner
      .post(`/api/v1/imports/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "settings-import-confirm-retry")
      .send(confirmPayload)
      .expect(200);
    expect(replayWithNewKey.body.data.id).toBe(confirmed.body.data.id);

    const works = await owner.get("/api/v1/works").expect(200);
    expect(works.body.data).toHaveLength(2);
    expect(works.body.data.map((work: { id: string }) => work.id)).toEqual(
      expect.arrayContaining([existing.body.data.id, confirmed.body.data.id]),
    );
  });

  it("recognizes complete settings and creates a work from the confirmed candidates", async () => {
    const owner = await createAuthenticatedAgent("complete-import@example.com");
    const token = await csrf(owner);

    const created = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        text: [
          "人物：沈砚，外门杂役。",
          "人物：顾青，太玄门弟子。",
          "势力：太玄门、血河宗。",
          "地图：人界 → 东境 → 忘川渡。",
          "力量体系：练气 → 筑基 → 金丹。",
          "金手指：忘川书，以记忆换取前人经验。",
        ].join("\n"),
      })
      .expect(200);

    expect(created.body.data).toMatchObject({
      canConfirm: true,
      report: {
        conflicts: [],
        unparsed: [],
      },
    });
    expect(created.body.data.report.accepted).toHaveLength(6);
    expect(
      [...created.body.data.report.accepted, ...created.body.data.report.pending].map(
        (candidate: { type: string }) => candidate.type,
      ),
    ).toEqual(
      expect.arrayContaining(["character", "faction", "map", "power_system", "golden_finger"]),
    );
    expect(created.body.data.report.pending).toHaveLength(1);

    const confirmed = await owner
      .post(`/api/v1/imports/${created.body.data.id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ title: "完整设定导入" })
      .expect(200);
    expect(confirmed.body.data).toMatchObject({
      title: "完整设定导入",
      sourceMode: "settings_import",
      mainBranch: { name: "main" },
    });
  });

  it("rejects unsupported files and keeps imports isolated by tenant", async () => {
    const owner = await createAuthenticatedAgent("import-owner@example.com");
    const other = await createAuthenticatedAgent("import-other@example.com");
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);

    const unsupported = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .attach("file", Buffer.from("binary"), {
        filename: "settings.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
      .expect(400);
    expect(unsupported.body.error.code).toBe("VALIDATION_INVALID");

    const created = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        text: ["人物：沈砚，外门杂役，左臂骨折。", "人物：沈砚，外门杂役，左臂完好。"].join("\n"),
      })
      .expect(200);
    const importId = created.body.data.id as string;
    const conflictId = created.body.data.report.conflicts[0].id as string;

    const foreignRead = await other.get(`/api/v1/imports/${importId}`).expect(403);
    expect(foreignRead.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignDecision = await other
      .post(`/api/v1/imports/${importId}/conflicts/${conflictId}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ decision: "use_primary" })
      .expect(403);
    expect(foreignDecision.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignConfirm = await other
      .post(`/api/v1/imports/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ title: "越权作品" })
      .expect(403);
    expect(foreignConfirm.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    expect((await other.get("/api/v1/works").expect(200)).body.data).toEqual([]);
  });

  it("scopes idempotency keys to each import so one confirmation cannot overwrite another", async () => {
    const owner = await createAuthenticatedAgent("import-idempotency@example.com");
    const token = await csrf(owner);
    const text = "人物：沈砚，外门杂役。";

    const firstImport = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ text })
      .expect(200);
    const secondImport = await owner
      .post("/api/v1/imports")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ text })
      .expect(200);

    const firstWork = await owner
      .post(`/api/v1/imports/${firstImport.body.data.id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "shared-confirm-key")
      .send({ title: "第一部导入作品" })
      .expect(200);
    const secondWork = await owner
      .post(`/api/v1/imports/${secondImport.body.data.id}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "shared-confirm-key")
      .send({ title: "第二部导入作品" })
      .expect(200);

    expect(secondWork.body.data.id).not.toBe(firstWork.body.data.id);
    expect(secondWork.body.data.title).toBe("第二部导入作品");
    expect((await owner.get("/api/v1/works").expect(200)).body.data).toHaveLength(2);
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
