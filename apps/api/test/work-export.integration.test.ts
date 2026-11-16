import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  branchCreateResponseSchema,
  chapterVersionSchema,
  workExportReceiptListResponseSchema,
  workExportReceiptResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { WorkExportProcessor } from "../../worker/src/exports/work-export.processor";
import { WorkerWorkExportRepository } from "../../worker/src/exports/work-export.repository";

const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
const databaseUrl = dedicatedDatabaseUrl(`novelbrain_test_129_${suffix}`);
const redisUrl = dedicatedRedisUrl();
const origin = "http://localhost:3000";
const keyCanary = "sk-export-secret-canary-1234";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("work export HTTP and worker integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  let processor: WorkExportProcessor;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "work-export-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "work-export-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1";

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl, {
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    processor = new WorkExportProcessor(new WorkerWorkExportRepository());
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
    await processor?.onModuleDestroy();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("renders formats, preserves historical and parallel versions, and excludes secrets", async () => {
    const owner = await createAuthenticatedAgent("work-export-owner@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const outline = await createOutlineFixture(owner, token, `${branchPath}/outline`);
    const firstV1 = await saveChapterVersion(
      owner,
      token,
      branchPath,
      outline.chapterOne.chapter.id,
      "旧版正文：山门仍然关闭。",
    );
    const branch = branchCreateResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            name: "平行版本",
            sourceNodeId: firstV1.versionNodeId,
            reason: "验证历史导出",
          })
          .expect(200)
      ).body,
    ).data;
    const branchPath2 = `/api/v1/works/${work.id}/branches/${branch.id}`;
    const firstV2 = await saveChapterVersion(
      owner,
      token,
      branchPath,
      outline.chapterOne.chapter.id,
      "主线新版：山门已经打开。",
    );
    await saveChapterVersion(
      owner,
      token,
      branchPath,
      outline.chapterTwo.chapter.id,
      "第二章正文：钟声响了。",
    );
    const branchChapter = await createChapter(owner, token, branchPath2, 1, "平行山门");
    const branchVersion = await saveChapterVersion(
      owner,
      token,
      branchPath2,
      branchChapter.id,
      "平行版本正文：山门后另有一条路。",
    );
    await createModelConfig(owner, token);

    const historical = await startExport(owner, branchPath, "historical-export", {
      format: "txt",
      scope: { kind: "current_chapter", chapterId: outline.chapterOne.chapter.id },
      sourceVersionNodeId: firstV1.versionNodeId,
      options: exportOptions(),
    });
    expect(historical.status).toBe("queued");
    await runExport(historical.jobId, historical.id);
    const historicalReady = await getReceipt(owner, branchPath, historical.id);
    expect(historicalReady.status).toBe("completed");
    expect(historicalReady.manifest?.branch.resolvedVersionNodeId).toBe(firstV1.versionNodeId);
    expect(historicalReady.manifest?.chapters[0]?.versionNodeId).toBe(firstV1.versionNodeId);
    expect(historicalReady.manifest?.chapters[0]?.versionNodeId).not.toBe(firstV2.versionNodeId);
    const historicalDownload = await download(owner, branchPath, historical.id);
    const historicalText = historicalDownload.body.toString("utf8");
    expect(historicalText).toContain("旧版正文");
    expect(historicalText).not.toContain("主线新版");
    expect(historicalText).not.toContain(keyCanary);

    const range = await startExport(owner, branchPath, "range-export", {
      format: "txt",
      scope: { kind: "chapter_range", fromChapter: 1, toChapter: 2 },
      options: exportOptions(),
    });
    await runExport(range.jobId, range.id);
    expect((await getReceipt(owner, branchPath, range.id)).manifest?.chapters).toHaveLength(2);

    const selected = await startExport(owner, branchPath, "selected-export", {
      format: "txt",
      scope: {
        kind: "selected_chapters",
        chapterIds: [outline.chapterTwo.chapter.id],
      },
      options: exportOptions(),
    });
    await runExport(selected.jobId, selected.id);
    expect((await getReceipt(owner, branchPath, selected.id)).manifest?.chapters).toHaveLength(1);

    const volume = await startExport(owner, branchPath, "volume-export", {
      format: "docx",
      scope: { kind: "volume", volumeNodeId: outline.volume.id },
      options: {
        ...exportOptions(),
        includeStoryBible: true,
        includeOutline: true,
        includeForeshadowLedger: true,
      },
    });
    await runExport(volume.jobId, volume.id);
    const volumeReady = await getReceipt(owner, branchPath, volume.id);
    expect(volumeReady.status).toBe("completed");
    expect(volumeReady.manifest?.chapters).toHaveLength(2);
    expect(volumeReady.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const volumeDownload = await download(owner, branchPath, volume.id);
    expect(volumeDownload.body.subarray(0, 2).toString()).toBe("PK");
    expect(volumeDownload.body.includes(Buffer.from(keyCanary))).toBe(false);

    const parallel = await startExport(owner, branchPath2, "parallel-export", {
      format: "markdown",
      scope: { kind: "current_chapter", chapterId: branchChapter.id },
      options: exportOptions(),
    });
    await runExport(parallel.jobId, parallel.id);
    const parallelReady = await getReceipt(owner, branchPath2, parallel.id);
    expect(parallelReady.manifest?.branch.id).toBe(branch.id);
    expect(parallelReady.manifest?.chapters[0]?.versionNodeId).toBe(branchVersion.versionNodeId);
    const parallelText = (await download(owner, branchPath2, parallel.id)).body.toString("utf8");
    expect(parallelText).toContain("平行版本正文");
    expect(parallelText).not.toContain("主线新版");

    const replay = await startExport(owner, branchPath2, "parallel-export", {
      format: "markdown",
      scope: { kind: "current_chapter", chapterId: branchChapter.id },
      options: exportOptions(),
    });
    expect(replay.id).toBe(parallel.id);

    const history = workExportReceiptListResponseSchema.parse(
      (await owner.get(`${branchPath2}/exports`).expect(200)).body,
    ).data;
    expect(history.map((receipt) => receipt.id)).toContain(parallel.id);

    const other = await createAuthenticatedAgent("work-export-other@example.com");
    const forbidden = await other.get(`${branchPath2}/exports/${parallel.id}`).expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    await databasePool.query(
      "UPDATE work_export_receipts SET expires_at = now() - interval '1 second' WHERE id = $1",
      [parallel.id],
    );
    await processor.cleanupExpiredReceipts();
    const expired = await getReceipt(owner, branchPath2, parallel.id);
    expect(expired.status).toBe("expired");
    expect(expired.byteSize).toBeGreaterThan(0);
    const expiredDownload = await owner.get(`${branchPath2}/exports/${parallel.id}/download`);
    expect(expiredDownload.status).toBe(410);
    expect(expiredDownload.body.error.code).toBe("WORK_EXPORT_EXPIRED");
  });

  async function startExport(
    agent: SuperAgentTest,
    branchPath: string,
    idempotencyKey: string,
    body: Record<string, unknown>,
  ) {
    const csrfToken = await csrf(agent);
    const response = await agent
      .post(`${branchPath}/exports`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", idempotencyKey)
      .send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(202);
    return workExportReceiptResponseSchema.parse(response.body).data;
  }

  async function getReceipt(agent: SuperAgentTest, branchPath: string, exportId: string) {
    return workExportReceiptResponseSchema.parse(
      (await agent.get(`${branchPath}/exports/${exportId}`).expect(200)).body,
    ).data;
  }

  async function runExport(jobId: string, exportId: string) {
    const result = await databasePool.query<{
      work_id: string;
      branch_id: string;
      user_id: string;
      idempotency_key: string;
    }>("SELECT work_id, branch_id, user_id, idempotency_key FROM jobs WHERE id = $1", [jobId]);
    const row = result.rows[0];
    if (!row) {
      throw new Error("Export job not found");
    }
    await processor.process({
      jobId,
      jobType: "export_work",
      workId: row.work_id,
      branchId: row.branch_id,
      actorId: row.user_id,
      idempotencyKey: row.idempotency_key,
      exportId,
      checkpoint: {
        schemaVersion: 1,
        revision: 0,
        step: "prepare",
        inputHash: null,
        outputRefs: [],
        payload: {},
      },
    });
  }

  function download(agent: SuperAgentTest, branchPath: string, exportId: string) {
    return agent
      .get(`${branchPath}/exports/${exportId}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
  }

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await csrf(agent);
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
        displayName: "导出作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createWork(agent: SuperAgentTest, token: string) {
    return (
      await agent
        .post("/api/v1/works")
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "work-export-work")
        .send({
          mode: "idea",
          title: "山海照夜",
          idea: "少年守住最后一盏山灯。",
          genre: "xianxia",
          scaleTarget: "long",
          chapterLengthTarget: 3000,
        })
        .expect(200)
    ).body.data as {
      id: string;
      mainBranch: { id: string; headNodeId: string };
    };
  }

  async function createOutlineFixture(agent: SuperAgentTest, token: string, outlinePath: string) {
    const book = await createNode(agent, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "山海照夜",
    });
    const volume = await createNode(agent, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第一卷",
    });
    const act = await createNode(agent, token, outlinePath, {
      level: "act",
      parentId: volume.id,
      title: "第一幕",
    });
    const chapterOne = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: act.id,
      chapterCreate: {
        number: 1,
        title: "山门",
        brief: completeBrief(),
      },
    });
    const chapterTwo = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: act.id,
      chapterCreate: {
        number: 2,
        title: "钟声",
        brief: completeBrief(),
      },
    });
    return { volume, chapterOne, chapterTwo };
  }

  async function createNode(
    agent: SuperAgentTest,
    token: string,
    outlinePath: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.node as {
      id: string;
      chapter?: { id: string };
    };
  }

  async function saveChapterVersion(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapterId: string,
    content: string,
  ) {
    const workspace = (await agent.get(`${branchPath}/chapters/${chapterId}`).expect(200)).body
      .data as { version: number };
    return chapterVersionSchema.parse(
      (
        await agent
          .post(`${branchPath}/chapters/${chapterId}/versions`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ version: workspace.version, content })
          .expect(201)
      ).body.data.version,
    );
  }

  async function createChapter(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    number: number,
    title: string,
  ) {
    return (
      await agent
        .post(`${branchPath}/chapters`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          number,
          title,
          brief: completeBrief(),
        })
        .expect(201)
    ).body.data as { id: string; version: number };
  }

  async function createModelConfig(agent: SuperAgentTest, token: string) {
    await agent
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "导出隔离检查",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: keyCanary,
        purposes: ["writing"],
        isDefault: true,
      })
      .expect(200);
  }
});

function exportOptions() {
  return {
    includeStoryBible: false,
    includeSettingsAppendix: false,
    includeOutline: false,
    includeForeshadowLedger: false,
    includeChangeHistory: false,
    preset: "generic" as const,
    chapterTitleFormat: "第{number}章 {title}",
    volumeTitleFormat: "第{number}卷 {title}",
    paragraphBlankLine: true,
    firstLineIndent: false,
    encoding: "utf-8" as const,
  };
}

function completeBrief() {
  return {
    goal: "让主角发现山门变化。",
    pov: "沈砚",
    location: "山门",
    sceneBeats: ["沈砚抵达山门。", "钟声响起。"],
    requiredFacts: ["山门在夜间关闭"],
  };
}

function binaryParser(
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", callback);
}

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
  if (!databaseName.startsWith("novelbrain_test_129_")) {
    throw new Error("Work export tests must use a dedicated test database");
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
