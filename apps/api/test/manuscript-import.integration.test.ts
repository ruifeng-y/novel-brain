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

describe("manuscript import HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "manuscript-import-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "manuscript-import-integration-proxy-secret";
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
        displayName: "旧稿导入作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  it("parses a small Markdown manuscript into ordered chapter rows without changing the text", async () => {
    const owner = await createAuthenticatedAgent("manuscript-preview@example.com");
    const token = await csrf(owner);
    const sourceText = [
      "# 第一章 断碑夜雨",
      "",
      "雨落在断碑上。",
      "",
      "# 第二章 夜船",
      "",
      "夜船顺流而下。",
    ].join("\n");

    const created = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from(sourceText, "utf8"), {
        filename: "old-draft.md",
        contentType: "text/markdown",
      })
      .expect(200);

    expect(created.body.data).toMatchObject({
      status: "ready",
      sourceName: "old-draft.md",
      format: "markdown",
      canConfirm: true,
      warnings: [],
    });
    expect(created.body.data.chapters).toEqual([
      expect.objectContaining({
        order: 1,
        title: "断碑夜雨",
        content: "# 第一章 断碑夜雨\n\n雨落在断碑上。\n\n",
      }),
      expect.objectContaining({
        order: 2,
        title: "夜船",
        content: "# 第二章 夜船\n\n夜船顺流而下。",
      }),
    ]);
    expect(
      created.body.data.chapters.map((chapter: { content: string }) => chapter.content).join(""),
    ).toBe(sourceText);
  });

  it("parses TXT chapter headings while preserving the original line endings", async () => {
    const owner = await createAuthenticatedAgent("manuscript-txt@example.com");
    const token = await csrf(owner);
    const sourceText = [
      "第一章 断碑夜雨",
      "雨落在断碑上。",
      "",
      "第二章 夜船",
      "夜船顺流而下。",
    ].join("\r\n");

    const created = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from(sourceText, "utf8"), {
        filename: "old-draft.txt",
        contentType: "text/plain",
      })
      .expect(200);

    expect(created.body.data).toMatchObject({
      status: "ready",
      format: "txt",
      chapters: [
        { order: 1, title: "断碑夜雨" },
        { order: 2, title: "夜船" },
      ],
    });
    expect(
      created.body.data.chapters.map((chapter: { content: string }) => chapter.content).join(""),
    ).toBe(sourceText);
  });

  it("confirms edited chapters into a work with ordered versions and no extracted settings", async () => {
    const owner = await createAuthenticatedAgent("manuscript-confirm@example.com");
    const token = await csrf(owner);
    const sourceText = [
      "# 第一章 断碑夜雨",
      "",
      "雨落在断碑上。",
      "",
      "# 第二章 夜船",
      "",
      "夜船顺流而下。",
      "",
      "# 第三章 断臂之后",
      "",
      "沈砚按住左臂。",
    ].join("\n");

    const created = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from(sourceText, "utf8"), {
        filename: "three-chapters.md",
        contentType: "text/markdown",
      })
      .expect(200);
    const importId = created.body.data.id as string;
    const [first, second, third] = created.body.data.chapters as Array<{
      title: string;
      content: string;
    }>;
    if (!first || !second || !third) {
      throw new Error("Expected three parsed chapters");
    }
    const splitAt = first.content.indexOf("雨落在断碑上。");
    const editedChapters = [
      { title: "第一章 断碑夜雨", content: first.content.slice(0, splitAt) },
      { title: "雨落断碑", content: first.content.slice(splitAt) },
      { title: "夜船与断臂", content: `${second.content}${third.content}` },
    ];

    const confirmed = await owner
      .post(`/api/v1/imports/manuscripts/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "manuscript-confirm-1")
      .send({
        title: "旧稿新书",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
        chapters: editedChapters,
      })
      .expect(200);

    expect(confirmed.body.data.work).toMatchObject({
      title: "旧稿新书",
      sourceMode: "manuscript_import",
      settings: { importId },
      mainBranch: { name: "main", status: "active" },
    });
    expect(confirmed.body.data.chapters).toEqual([
      expect.objectContaining({ number: 1, title: "第一章 断碑夜雨", version: 1 }),
      expect.objectContaining({ number: 2, title: "雨落断碑", version: 1 }),
      expect.objectContaining({ number: 3, title: "夜船与断臂", version: 1 }),
    ]);
    expect(confirmed.body.data.chapterVersions).toHaveLength(3);
    expect(
      confirmed.body.data.chapterVersions.map((version: { content: string }) => version.content),
    ).toEqual(editedChapters.map((chapter) => chapter.content));
    expect(
      confirmed.body.data.chapterVersions
        .map((version: { content: string }) => version.content)
        .join(""),
    ).toBe(sourceText);
    expect(
      new Set(
        confirmed.body.data.chapterVersions.map(
          (version: { versionNodeId: string }) => version.versionNodeId,
        ),
      ).size,
    ).toBe(3);
    expect(confirmed.body.data.chapterVersions[1].parentNodeId).toBe(
      confirmed.body.data.chapterVersions[0].versionNodeId,
    );
    expect(confirmed.body.data.chapterVersions[2].parentNodeId).toBe(
      confirmed.body.data.chapterVersions[1].versionNodeId,
    );
    expect(confirmed.body.data.work.mainBranch.headNodeId).toBe(
      confirmed.body.data.chapterVersions[2].versionNodeId,
    );

    const currentUser = await owner.get("/api/v1/auth/me").expect(200);
    const counts = await databasePool.query<{
      candidates: number;
      conflicts: number;
      reports: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM import_candidates WHERE user_id = $1) AS candidates,
        (SELECT count(*)::int FROM import_conflicts WHERE user_id = $1) AS conflicts,
        (SELECT count(*)::int FROM import_reports WHERE user_id = $1) AS reports`,
      [currentUser.body.data.user.id],
    );
    expect(counts.rows[0]).toEqual({ candidates: 0, conflicts: 0, reports: 0 });

    const replay = await owner
      .post(`/api/v1/imports/manuscripts/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "manuscript-confirm-1")
      .send({
        title: "旧稿新书",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
        chapters: editedChapters,
      })
      .expect(200);
    expect(replay.body.data.work.id).toBe(confirmed.body.data.work.id);
    expect(replay.body.data.chapterVersions).toHaveLength(3);
    const completedPreview = await owner.get(`/api/v1/imports/manuscripts/${importId}`).expect(200);
    expect(completedPreview.body.data).toMatchObject({
      canConfirm: false,
      confirmedWorkId: confirmed.body.data.work.id,
    });
  });

  it("reports empty, partial, unsupported and unreadable manuscript states", async () => {
    const owner = await createAuthenticatedAgent("manuscript-states@example.com");
    const token = await csrf(owner);

    const empty = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from(" \n\n ", "utf8"), {
        filename: "empty.txt",
        contentType: "text/plain",
      })
      .expect(200);
    expect(empty.body.data).toMatchObject({
      status: "empty",
      canConfirm: false,
      chapters: [],
    });

    const partial = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from("只有正文，没有章节标题。\n第二段仍然保留。", "utf8"), {
        filename: "partial.txt",
        contentType: "text/plain",
      })
      .expect(200);
    expect(partial.body.data).toMatchObject({
      status: "partial",
      canConfirm: true,
      warnings: [
        {
          reason: "未识别到章节标题，已将全文保留为一章",
        },
      ],
    });
    expect(partial.body.data.chapters).toHaveLength(1);
    expect(partial.body.data.chapters[0].content).toBe(
      "只有正文，没有章节标题。\n第二段仍然保留。",
    );

    const unsupported = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from("not supported"), {
        filename: "old-draft.docx",
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
      .expect(400);
    expect(unsupported.body.error).toMatchObject({
      code: "VALIDATION_INVALID",
      message: "请选择 TXT 或 Markdown 旧稿文件",
    });

    const unreadable = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .attach("file", Buffer.from([0xff, 0xfe, 0xfd]), {
        filename: "broken.txt",
        contentType: "text/plain",
      })
      .expect(400);
    expect(unreadable.body.error).toMatchObject({
      code: "VALIDATION_INVALID",
      message: "旧稿编码无法解析，请使用 UTF-8 编码",
    });
  });

  it("rejects cross-tenant access and any confirmation that changes the original text", async () => {
    const owner = await createAuthenticatedAgent("manuscript-owner@example.com");
    const other = await createAuthenticatedAgent("manuscript-other@example.com");
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const sourceText = "# 第一章 断碑夜雨\n\n雨落在断碑上。";

    const created = await owner
      .post("/api/v1/imports/manuscripts")
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .attach("file", Buffer.from(sourceText, "utf8"), {
        filename: "private-draft.md",
        contentType: "text/markdown",
      })
      .expect(200);
    const importId = created.body.data.id as string;

    const foreignRead = await other.get(`/api/v1/imports/manuscripts/${importId}`).expect(403);
    expect(foreignRead.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const foreignConfirm = await other
      .post(`/api/v1/imports/manuscripts/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        title: "越权导入",
        chapters: [{ title: "第一章 断碑夜雨", content: sourceText }],
      })
      .expect(403);
    expect(foreignConfirm.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const tampered = await owner
      .post(`/api/v1/imports/manuscripts/${importId}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        title: "改写旧稿",
        chapters: [{ title: "第一章 断碑夜雨", content: "# 第一章 断碑夜雨\n\n雨停在断碑上。" }],
      })
      .expect(400);
    expect(tampered.body.error).toMatchObject({
      code: "VALIDATION_INVALID",
      message: "章节调整改变了旧稿原文，请重新识别",
    });
    expect((await owner.get("/api/v1/works").expect(200)).body.data).toEqual([]);
    expect((await other.get("/api/v1/works").expect(200)).body.data).toEqual([]);
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
