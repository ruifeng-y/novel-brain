import "reflect-metadata";

import { performance } from "node:perf_hooks";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PROCESS_IMPORT_JOB,
  WORKER_QUEUE_NAME,
  chunkedImportProgressResponseSchema,
  manuscriptImportResponseSchema,
  workResponseSchema,
  type WorkerJob,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { Queue, Worker as BullWorker } from "bullmq";
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
import { ManuscriptImportProcessor } from "../../worker/src/imports/manuscript-import.processor";
import { WorkerManuscriptImportRepository } from "../../worker/src/imports/manuscript-import.repository";

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
  let importRepository: WorkerManuscriptImportRepository;
  let importProcessor: ManuscriptImportProcessor;
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
    importRepository = new WorkerManuscriptImportRepository();
    importProcessor = new ManuscriptImportProcessor(importRepository);
  });

  beforeEach(async () => {
    mail.codes.clear();
    await databasePool.query("TRUNCATE TABLE users CASCADE");
    await redis.flushdb();
  });

  afterAll(async () => {
    await importRepository?.onModuleDestroy();
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("streams a generated 10M-character manuscript through pause, restart, resume, cancel and range confirmation", async () => {
    const metadata = largeManuscriptMetadata();
    expect(metadata).toMatchObject({
      seed: LARGE_MANUSCRIPT_SPEC.seed,
      characterCount: 10_000_000,
      chapterCount: 4_000,
      chunkCharacterCount: 250_000,
      chunkCount: 40,
    });
    expect(metadata.sha256).toBe(
      "1469e6aeefbf90c3c21a735f42e12138f4f3e0aee520fc82d423ab02036f5557",
    );
    const email = "chunked-recovery@example.com";
    const password = "StrongPassword123";
    let owner = await createAuthenticatedAgent(email, password);
    const ownerId = (await owner.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
    let token = await csrf(owner);
    const startedAt = performance.now();

    const oversizedBatch = await owner
      .post("/api/v1/imports/manuscripts/chunked")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "chunked-oversized-batch")
      .send({
        sourceName: "单请求过大.txt",
        chunks: ["x".repeat(500_001)],
      });
    expect(oversizedBatch.status).toBe(400);
    expect(oversizedBatch.body.error.code).toBe("VALIDATION_INVALID");

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
    let uploadedCount = 0;
    for (let sequence = 0; sequence < 10; sequence += 1) {
      const next = chunks.next();
      expect(next.done).toBe(false);
      const sourceText = next.value;
      expect(sourceText.length).toBeLessThanOrEqual(metadata.chunkCharacterCount);
      const requestBytes = Buffer.byteLength(JSON.stringify({ sequence, sourceText }));
      expect(requestBytes).toBeLessThan(1_000_000);
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
      uploadedCount += 1;
      expect(appended.uploadedChunks).toBe(sequence + 1);
      if (sequence === 0) {
        const mismatchedReplay = await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ sequence, sourceText: `${sourceText.slice(0, -1)}改` });
        expect(mismatchedReplay.status).toBe(409);
        expect(mismatchedReplay.body.error.code).toBe("IMPORT_NOT_READY");
      }
    }
    await expect(importRepository.listRecoverableJobs()).resolves.toContainEqual(
      expect.objectContaining({
        jobType: PROCESS_IMPORT_JOB,
        importId: created.importId,
        actorId: ownerId,
      }),
    );

    await processImport(ownerId, created.importId, 3);
    const processedBeforePause = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(processedBeforePause.processedChunks).toBe(3);
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
      processedChunks: 3,
      canConfirm: false,
    });
    const pausedAgain = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/pause`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(pausedAgain.processedChunks).toBe(3);
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
    expect(pausedProcess.processedChunks).toBe(3);
    let resumed = chunkedImportProgressResponseSchema.parse(
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
    const resumedAgain = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/resume`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(resumedAgain.status).toBe("processing");
    await processImport(ownerId, created.importId, 2);
    resumed = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(resumed.processedChunks).toBe(5);
    expect(resumed.status).toBe("processing");

    await app.close();
    app = await createApp();
    owner = await loginAgent(email, password);
    token = await csrf(owner);
    const afterRestart = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(afterRestart).toMatchObject({ status: "processing", processedChunks: 5 });

    const resumedAfterRestart = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/resume`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(resumedAfterRestart.status).toBe("processing");

    for (let sequence = 10; sequence < metadata.chunkCount; sequence += 1) {
      const next = chunks.next();
      expect(next.done).toBe(false);
      const sourceText = next.value;
      expect(sourceText.length).toBeLessThanOrEqual(metadata.chunkCharacterCount);
      uploadedCount += 1;
      await owner
        .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ sequence, sourceText })
        .expect(200);
    }
    expect(uploadedCount).toBe(metadata.chunkCount);

    await processImport(ownerId, created.importId);
    const progress = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
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
      sourceRange: { start: 0, end: 2_500 },
    });
    expect(preview.chapters.at(-1)).toMatchObject({
      order: metadata.chapterCount,
      title: "分块旧稿4000",
      content: "",
      sourceRange: {
        start: metadata.characterCount - 2_500,
        end: metadata.characterCount,
      },
    });

    const confirmHttp = await owner
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
      .expect(200);
    expect(Buffer.byteLength(JSON.stringify(confirmHttp.body))).toBeLessThan(200_000);
    const confirmed = workResponseSchema.parse(confirmHttp.body).data;
    const persistedVersionSummary = await databasePool.query<{
      count: number;
      sha256: string;
    }>(
      `SELECT count(*)::int AS count,
              encode(
                sha256(
                  convert_to(
                    string_agg(version.content, '' ORDER BY chapter.number),
                    'UTF8'
                  )
                ),
                'hex'
              ) AS sha256
         FROM chapter_versions AS version
         INNER JOIN chapters AS chapter ON chapter.id = version.chapter_id
         WHERE chapter.work_id = $1`,
      [confirmed.id],
    );
    expect(persistedVersionSummary.rows[0]).toEqual({
      count: metadata.chapterCount,
      sha256: metadata.sha256,
    });
    const versionRanges = await databasePool.query<{
      chapter_number: number;
      source_start: number;
      source_end: number;
    }>(
      `SELECT (payload->>'chapterNumber')::int AS chapter_number,
                (payload->'sourceRange'->>'start')::int AS source_start,
                (payload->'sourceRange'->>'end')::int AS source_end
         FROM version_nodes
         WHERE work_id = $1 AND node_type = 'chapter_version'
         ORDER BY (payload->>'chapterNumber')::int`,
      [confirmed.id],
    );
    expect(versionRanges.rows).toHaveLength(metadata.chapterCount);
    expect(
      versionRanges.rows.every((range, index) => {
        const expectedStart = index * LARGE_MANUSCRIPT_SPEC.chapterCharacterCount;
        return (
          range.chapter_number === index + 1 &&
          range.source_start === expectedStart &&
          range.source_end === expectedStart + LARGE_MANUSCRIPT_SPEC.chapterCharacterCount
        );
      }),
    ).toBe(true);

    const replay = workResponseSchema.parse(
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
    expect(replay.id).toBe(confirmed.id);
    const replayVersions = await databasePool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM chapter_versions WHERE work_id = $1",
      [confirmed.id],
    );
    expect(replayVersions.rows[0]?.count).toBe(metadata.chapterCount);

    const other = await createAuthenticatedAgent("chunked-recovery-other@example.com", password);
    const otherToken = await csrf(other);
    await other
      .post(`/api/v1/imports/manuscripts/${created.importId}/confirm-chunked`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        title: "越权确认",
        chapters: preview.chapters.map((chapter) => ({
          title: chapter.title,
          sourceRange: chapter.sourceRange,
        })),
      })
      .expect(403);

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
    const cancelledAgain = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${cancelJob.importId}/cancel`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(cancelledAgain.status).toBe("cancelled");
    const appendAfterCancel = await owner
      .post(`/api/v1/imports/manuscripts/${cancelJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 1, sourceText: "第二章 不应接收\n\n正文。" });
    expect(appendAfterCancel.status).toBe(409);
    expect(appendAfterCancel.body.error.code).toBe("IMPORT_NOT_READY");
    const confirmAfterCancel = await owner
      .post(`/api/v1/imports/manuscripts/${cancelJob.importId}/confirm-chunked`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        title: "取消后的导入",
        chapters: [{ title: "第一章", sourceRange: { start: 0, end: 1 } }],
      });
    expect(confirmAfterCancel.status).toBe(409);
    expect(confirmAfterCancel.body.error.code).toBe("IMPORT_NOT_READY");

    const surrogateSource = "😀第一章 😀\n\n正文。";
    const surrogateJob = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-surrogate-boundary")
          .send({ sourceName: "代理项边界.txt", chunkCount: 1 })
          .expect(200)
      ).body,
    ).data;
    await owner
      .post(`/api/v1/imports/manuscripts/${surrogateJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 0, sourceText: surrogateSource })
      .expect(200);
    await processImport(ownerId, surrogateJob.importId);
    const splitInsideSurrogate = surrogateSource.indexOf("😀") + 1;
    const boundaryFailure = await owner
      .post(`/api/v1/imports/manuscripts/${surrogateJob.importId}/confirm-chunked`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        title: "代理项错误拆分",
        chapters: [
          { title: "第一章", sourceRange: { start: 0, end: splitInsideSurrogate } },
          {
            title: "第二章",
            sourceRange: { start: splitInsideSurrogate, end: surrogateSource.length },
          },
        ],
      });
    expect(boundaryFailure.status).toBe(400);
    expect(boundaryFailure.body.error.code).toBe("VALIDATION_INVALID");

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
    const partialFirstChunk = "第一章 部分失败\n\n正文。\n";
    const partialSecondChunk = "第二章 补传\n\n正文。\n";
    const partialThirdChunk = "第三章 完成\n\n正文。";
    const partialSource = `${partialFirstChunk}${partialSecondChunk}${partialThirdChunk}`;
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 0, sourceText: partialFirstChunk })
      .expect(200);
    await processImport(ownerId, partialJob.importId, 1);
    const replayedChunk = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${partialJob.importId}/chunks`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ sequence: 0, sourceText: partialFirstChunk })
          .expect(200)
      ).body,
    ).data;
    expect(replayedChunk.uploadedChunks).toBe(1);
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 1, sourceText: partialSecondChunk })
      .expect(200);
    process.env.FAKE_IMPORT_FAILURE_SEQUENCE = "1";
    const failedOutcome = await processImportJob(ownerId, partialJob.importId);
    delete process.env.FAKE_IMPORT_FAILURE_SEQUENCE;
    expect(failedOutcome).toBe("failed");
    const partial = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${partialJob.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(partial).toMatchObject({
      status: "partial",
      uploadedChunks: 2,
      processedChunks: 1,
    });
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 2, sourceText: partialThirdChunk })
      .expect(200);
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/resume`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    await processImport(ownerId, partialJob.importId);
    const partialRecovered = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${partialJob.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(partialRecovered).toMatchObject({
      status: "awaiting_confirmation",
      uploadedChunks: 3,
      processedChunks: 3,
    });
    const partialPreview = manuscriptImportResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${partialJob.importId}`).expect(200)).body,
    ).data;
    expect(partialPreview.chapters).toHaveLength(3);
    const partialConfirmBody = {
      title: "部分失败恢复作品",
      chapters: partialPreview.chapters.map((chapter) => ({
        title: chapter.title,
        sourceRange: chapter.sourceRange,
      })),
    };
    const partialWork = workResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${partialJob.importId}/confirm-chunked`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-partial-confirm")
          .send(partialConfirmBody)
          .expect(200)
      ).body,
    ).data;
    await owner
      .post(`/api/v1/imports/manuscripts/${partialJob.importId}/confirm-chunked`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "chunked-partial-confirm")
      .send(partialConfirmBody)
      .expect(200);
    const partialVersions = await databasePool.query<{
      content: string;
      source_start: number;
      source_end: number;
    }>(
      `SELECT version.content,
              (node.payload->'sourceRange'->>'start')::int AS source_start,
              (node.payload->'sourceRange'->>'end')::int AS source_end
         FROM chapter_versions AS version
         INNER JOIN chapters AS chapter ON chapter.id = version.chapter_id
         INNER JOIN version_nodes AS node ON node.id = version.version_node_id
        WHERE chapter.work_id = $1
        ORDER BY chapter.number`,
      [partialWork.id],
    );
    expect(partialVersions.rows).toHaveLength(3);
    expect(partialVersions.rows.map((version) => version.content).join("")).toBe(partialSource);
    expect(
      partialVersions.rows.map((version) => [version.source_start, version.source_end]),
    ).toEqual([
      [0, partialFirstChunk.length],
      [partialFirstChunk.length, partialFirstChunk.length + partialSecondChunk.length],
      [partialFirstChunk.length + partialSecondChunk.length, partialSource.length],
    ]);

    const elapsedMs = Math.round(performance.now() - startedAt);
    const maxRssBytes = process.resourceUsage().maxRSS * 1024;
    expect(maxRssBytes).toBeLessThan(768 * 1024 * 1024);
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
        maxRssBytes,
        elapsedMs,
        sha256: metadata.sha256,
      }),
    );
  }, 240_000);

  it("recovers bounded BullMQ ticks after Redis loses the delivery job", async () => {
    const owner = await createAuthenticatedAgent("chunked-bullmq@example.com", "StrongPassword123");
    const token = await csrf(owner);
    const created = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-bullmq-start")
          .send({ sourceName: "BullMQ 分块.txt", chunkCount: 12 })
          .expect(200)
      ).body,
    ).data;
    for (let sequence = 0; sequence < 12; sequence += 1) {
      await owner
        .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ sequence, sourceText: `第${sequence + 1}章 BullMQ\n\n正文。` })
        .expect(200);
    }

    await redis.flushdb();
    const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<WorkerJob>(WORKER_QUEUE_NAME, { connection: queueConnection });
    const worker = new BullWorker<WorkerJob, void>(
      WORKER_QUEUE_NAME,
      async (job) => {
        const outcome = await importProcessor.process(job.data);
        if (outcome === "failed") {
          throw new Error("Import processor reported failure");
        }
      },
      { connection: workerConnection, concurrency: 1 },
    );
    try {
      await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
      const firstDeliveries: string[] = [];
      await importProcessor.recoverPendingJobs(async (payload) => {
        if (payload.importId === created.importId) {
          firstDeliveries.push(payload.idempotencyKey);
          expect(payload.checkpoint.nextProcessSequence).toBe(0);
        }
        await queue.add(PROCESS_IMPORT_JOB, payload, {
          jobId: payload.idempotencyKey,
          removeOnComplete: true,
          removeOnFail: true,
        });
      });
      expect(firstDeliveries).toHaveLength(1);
      await expect
        .poll(
          async () =>
            chunkedImportProgressResponseSchema.parse(
              (
                await owner
                  .get(`/api/v1/imports/manuscripts/${created.importId}/progress`)
                  .expect(200)
              ).body,
            ).data.processedChunks,
          { timeout: 15_000 },
        )
        .toBe(10);
      const afterTick = chunkedImportProgressResponseSchema.parse(
        (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
          .body,
      ).data;
      expect(afterTick).toMatchObject({ status: "processing", processedChunks: 10 });

      const secondDeliveries: string[] = [];
      await importProcessor.recoverPendingJobs(async (payload) => {
        if (payload.importId === created.importId) {
          secondDeliveries.push(payload.idempotencyKey);
          expect(payload.checkpoint.nextProcessSequence).toBe(10);
        }
        await queue.add(PROCESS_IMPORT_JOB, payload, {
          jobId: payload.idempotencyKey,
          removeOnComplete: true,
          removeOnFail: true,
        });
      });
      expect(secondDeliveries).toHaveLength(1);
      await expect
        .poll(
          async () =>
            chunkedImportProgressResponseSchema.parse(
              (
                await owner
                  .get(`/api/v1/imports/manuscripts/${created.importId}/progress`)
                  .expect(200)
              ).body,
            ).data.status,
          { timeout: 15_000 },
        )
        .toBe("awaiting_confirmation");
    } finally {
      await worker.close();
      await queue.close();
      queueConnection.disconnect();
      workerConnection.disconnect();
    }
  });

  it("rebuilds parser state from pre-upgrade nextSequence checkpoints", async () => {
    const owner = await createAuthenticatedAgent(
      "chunked-upgrade@example.com",
      "StrongPassword123",
    );
    const token = await csrf(owner);
    const ownerId = (await owner.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
    const created = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-upgrade-start")
          .send({ sourceName: "升级恢复.txt", chunkCount: 2 })
          .expect(200)
      ).body,
    ).data;
    const malformed = await owner
      .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Content-Type", "application/json")
      .send(Buffer.from('{"sequence":0,"sourceText":"\\ud800"}', "utf8"));
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_INVALID");
    const malformedChunks = await databasePool.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM import_chunks WHERE import_job_id = $1",
      [created.importId],
    );
    expect(malformedChunks.rows[0]?.count).toBe(0);

    for (const [sequence, sourceText] of [
      "第一章 旧检查点\n\n正文。\n",
      "第二章 新扫描\n\n正文。",
    ].entries()) {
      await owner
        .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ sequence, sourceText })
        .expect(200);
    }
    await processImport(ownerId, created.importId, 1);
    await databasePool.query(
      `UPDATE import_jobs
          SET checkpoint = (
            checkpoint - 'manuscript' - 'nextProcessSequence'
          ) || jsonb_build_object('nextSequence', 1)
        WHERE id = $1`,
      [created.importId],
    );
    const legacyCheckpoint = await databasePool.query<{
      checkpoint: Record<string, unknown>;
    }>("SELECT checkpoint FROM import_jobs WHERE id = $1", [created.importId]);
    expect(legacyCheckpoint.rows[0]?.checkpoint).toMatchObject({ nextSequence: 1 });
    expect(legacyCheckpoint.rows[0]?.checkpoint.nextProcessSequence).toBeUndefined();

    await processImport(ownerId, created.importId);
    const progress = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(progress.processedChunks).toBe(2);
    expect(progress.status).toBe("awaiting_confirmation");
    const preview = manuscriptImportResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}`).expect(200)).body,
    ).data;
    expect(preview.chapters.map((chapter) => chapter.title)).toEqual(["旧检查点", "新扫描"]);
  });

  it("uses the import_recovery RLS role for cross-tenant maintenance scans", async () => {
    const owner = await createAuthenticatedAgent("chunked-rls@example.com", "StrongPassword123");
    const token = await csrf(owner);
    const created = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunked-rls-start")
          .send({ sourceName: "RLS 分块.txt", chunkCount: 1 })
          .expect(200)
      ).body,
    ).data;
    await owner
      .post(`/api/v1/imports/manuscripts/${created.importId}/chunks`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ sequence: 0, sourceText: "第一章 RLS\n\n正文。" })
      .expect(200);

    const role = "novelbrain_import_recovery_probe";
    await databasePool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
          CREATE ROLE ${role} NOLOGIN;
        END IF;
      END
      $$;
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT ON import_jobs TO ${role};
    `);
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query("SELECT set_config('app.system_role', 'import_recovery', true)");
      const allowed = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM import_jobs WHERE id = $1",
        [created.importId],
      );
      expect(allowed.rows[0]?.count).toBe(1);
      await client.query("SELECT set_config('app.system_role', '', true)");
      const denied = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM import_jobs WHERE id = $1",
        [created.importId],
      );
      expect(denied.rows[0]?.count).toBe(0);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

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

  async function processImport(actorId: string, importId: string, maxChunks?: number) {
    const outcome = await processImportJob(actorId, importId, maxChunks ?? 4_000);
    expect(outcome).toBe("succeeded");
  }

  async function processImportJob(actorId: string, importId: string, maxChunks?: number) {
    return importProcessor.process(
      {
        jobType: PROCESS_IMPORT_JOB,
        workId: null,
        branchId: null,
        actorId,
        importId,
        idempotencyKey: `integration-${importId}`,
        checkpoint: {
          schemaVersion: 1,
          revision: 0,
          nextProcessSequence: 0,
          uploadedChunks: 0,
          processedChunks: 0,
        },
      },
      maxChunks,
    );
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
