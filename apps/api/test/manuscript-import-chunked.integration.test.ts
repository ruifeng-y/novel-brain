import "reflect-metadata";

import { performance } from "node:perf_hooks";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  chunkedImportProgressResponseSchema,
  manuscriptImportConfirmResponseSchema,
  manuscriptImportResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import {
  largeManuscriptChunks,
  largeManuscriptMetadata,
  LARGE_MANUSCRIPT_SPEC,
} from "./helpers/large-manuscript";

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

describe("chunked manuscript import recovery integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "chunked-import-recovery-auth-secret";
    process.env.PROXY_IP_SECRET = "chunked-import-recovery-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl, {
      query_timeout: 60_000,
      statement_timeout: 60_000,
    });
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    app = await createApp();
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

  it("streams a generated 10M-character manuscript through pause, restart, resume, cancel and range confirmation", async () => {
    const metadata = largeManuscriptMetadata();
    expect(metadata).toMatchObject({
      seed: LARGE_MANUSCRIPT_SPEC.seed,
      characterCount: 10_000_000,
      chapterCount: 1_000,
      chunkCharacterCount: 250_000,
      chunkCount: 40,
    });
    const email = "chunked-recovery@example.com";
    const password = "StrongPassword123";
    let owner = await createAuthenticatedAgent(email, password);
    let token = await csrf(owner);
    const startedAt = performance.now();
    const heapBefore = process.memoryUsage().heapUsed;
    let peakHeap = heapBefore;

    const created = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-recovery-10m")
          .send({
            sourceName: "千万字断点恢复.txt",
            chunkCount: metadata.chunkCount,
          })
          .expect(200)
      ).body,
    ).data;
    expect(created).toMatchObject({
      status: "queued",
      chunkCount: metadata.chunkCount,
      uploadedChunks: 0,
      processedChunks: 0,
    });

    const chunks = largeManuscriptChunks();
    const uploaded: string[] = [];
    for (let sequence = 0; sequence < 10; sequence += 1) {
      const next = chunks.next();
      expect(next.done).toBe(false);
      const sourceText = next.value;
      expect(sourceText.length).toBeLessThanOrEqual(metadata.chunkCharacterCount);
      const requestBytes = Buffer.byteLength(JSON.stringify({ sequence, sourceText }));
        expect(requestBytes).toBeLessThan(1_000_000);
      uploaded.push(sourceText);
      const appended = chunkedImportProgressResponseSchema.parse(
        (
          await owner
            .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({ sequence, sourceText })
            .expect(200)
        ).body,
      ).data;
      expect(appended.uploadedChunks).toBe(sequence + 1);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }

    for (let sequence = 0; sequence < 5; sequence += 1) {
      const processed = chunkedImportProgressResponseSchema.parse(
        (
          await owner
            .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({})
            .expect(200)
        ).body,
      ).data;
      expect(processed.processedChunks).toBe(sequence + 1);
    }
    const paused = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/pause`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(paused).toMatchObject({
      status: "paused",
      uploadedChunks: 10,
      processedChunks: 5,
    });
    const pausedProcess = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(pausedProcess.processedChunks).toBe(5);

    await app.close();
    app = await createApp();
    owner = await loginAgent(email, password);
    token = await csrf(owner);
    const afterRestart = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(afterRestart).toMatchObject({ status: "paused", processedChunks: 5 });

    const resumed = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/resume`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(resumed.status).toBe("processing");

    for (let sequence = 10; sequence < metadata.chunkCount; sequence += 1) {
      const next = chunks.next();
      expect(next.done).toBe(false);
      const sourceText = next.value;
      expect(sourceText.length).toBeLessThanOrEqual(metadata.chunkCharacterCount);
      uploaded.push(sourceText);
      await owner
        .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ sequence, sourceText })
        .expect(200);
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    expect(uploaded).toHaveLength(metadata.chunkCount);

    let progress = afterRestart;
    while (progress.processedChunks < metadata.chunkCount) {
      progress = chunkedImportProgressResponseSchema.parse(
        (
          await owner
            .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({})
            .expect(200)
        ).body,
      ).data;
      peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
    }
    expect(progress).toMatchObject({
      status: "awaiting_confirmation",
      uploadedChunks: metadata.chunkCount,
      processedChunks: metadata.chunkCount,
      canConfirm: true,
    });

    const preview = manuscriptImportResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}`).expect(200)).body,
    ).data;
    expect(preview.chapters).toHaveLength(metadata.chapterCount);
    expect(preview.chapters[0]).toMatchObject({
      order: 1,
      title: "分块旧稿0001",
      content: "",
      sourceRange: { start: 0, end: 10_000 },
    });
    expect(preview.chapters.at(-1)).toMatchObject({
      order: metadata.chapterCount,
      title: "分块旧稿1000",
      content: "",
      sourceRange: {
        start: metadata.characterCount - 10_000,
        end: metadata.characterCount,
      },
    });

    const confirmed = manuscriptImportConfirmResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/confirm-chunked`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-confirm-10m")
          .send({
            title: "千万字恢复测试",
            chapters: preview.chapters.map((chapter) => ({
              title: chapter.title,
              sourceRange: chapter.sourceRange,
            })),
          })
          .expect(200)
      ).body,
    ).data;
    expect(confirmed.chapters).toHaveLength(metadata.chapterCount);
    expect(confirmed.chapterVersions).toHaveLength(metadata.chapterCount);
    expect(confirmed.chapterVersions[0]?.parentNodeId).not.toBeNull();
    const versionRanges = await databasePool.query<{
      count: number;
      first_start: number;
      last_end: number;
    }>(
      `SELECT count(*)::int AS count,
                min((payload->'sourceRange'->>'start')::int) AS first_start,
                max((payload->'sourceRange'->>'end')::int) AS last_end
         FROM version_nodes
         WHERE work_id = $1 AND node_type = 'chapter_version'`,
      [confirmed.work.id],
    );
    expect(versionRanges.rows[0]).toEqual({
      count: metadata.chapterCount,
      first_start: 0,
      last_end: metadata.characterCount,
    });

    const replay = manuscriptImportConfirmResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/confirm-chunked`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-confirm-10m")
          .send({
            title: "千万字恢复测试",
            chapters: preview.chapters.map((chapter) => ({
              title: chapter.title,
              sourceRange: chapter.sourceRange,
            })),
          })
          .expect(200)
      ).body,
    ).data;
    expect(replay.work.id).toBe(confirmed.work.id);
    expect(replay.chapterVersions).toHaveLength(metadata.chapterCount);

    const cancelJob = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-cancel-10m")
          .send({ sourceName: "取消导入.txt", chunkCount: 2 })
          .expect(200)
      ).body,
    ).data;
    await owner
      .post(`/api/v1/imports/manuscripts/${cancelJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 0, sourceText: "第一章 取消\n\n正文。" })
      .expect(200);
    const cancelled = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${cancelJob.importId}/cancel`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(cancelled.status).toBe("cancelled");
    const appendAfterCancel = await owner
      .post(`/api/v1/imports/manuscripts/${cancelJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 1, sourceText: "第二章 不应接收\n\n正文。" });
    expect(appendAfterCancel.status).toBe(409);
    expect(appendAfterCancel.body.error.code).toBe("IMPORT_NOT_READY");

    const partialJob = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-partial-10m")
          .send({ sourceName: "部分失败.txt", chunkCount: 3 })
          .expect(200)
      ).body,
    ).data;
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 0, sourceText: "第一章 部分失败\n\n正文。" })
      .expect(200);
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/process`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const partial = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${partialJob.importId}/process`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(partial).toMatchObject({
      status: "partial",
      uploadedChunks: 1,
      processedChunks: 1,
    });

    const elapsedMs = Math.round(performance.now() - startedAt);
    expect(peakHeap).toBeLessThan(512 * 1024 * 1024);
    console.info(
      JSON.stringify({
        event: "import_recovery.evidence",
        seed: metadata.seed,
        version: metadata.version,
        characterCount: metadata.characterCount,
        chapterCount: metadata.chapterCount,
        chunkCharacterCount: metadata.chunkCharacterCount,
        chunkCount: metadata.chunkCount,
          maxRequestBytes: 1_000_000,
        peakHeapBytes: peakHeap,
        elapsedMs,
        sha256: metadata.sha256,
      }),
    );
  }, 240_000);

  async function createApp(): Promise<INestApplication> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_GATEWAY)
      .useValue(mail)
      .compile();
    const nextApp = moduleRef.createNestApplication();
    nextApp.setGlobalPrefix("api/v1");
    nextApp.useBodyParser("json", { limit: "2mb" });
    nextApp.useGlobalFilters(new ApiExceptionFilter());
    await nextApp.init();
    return nextApp;
  }

  async function createAuthenticatedAgent(
    email: string,
    password: string,
  ): Promise<SuperAgentTest> {
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
        password,
        displayName: "分块恢复作者",
      })
      .expect(200);
    return agent;
  }

  async function loginAgent(email: string, password: string): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const token = await csrf(agent);
    await agent
      .post("/api/v1/auth/login")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ email, password })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
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
