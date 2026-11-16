import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
  branchCreateResponseSchema,
  chapterVersionSchema,
  EXPORT_WORK_JOB,
  WORKER_QUEUE_NAME,
  workExportReceiptListResponseSchema,
  workExportReceiptResponseSchema,
  workerJobSchema,
  type WorkerJob,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { FileObjectStorage, type ObjectStorage } from "@novel-brain/storage";
import { Worker as BullWorker } from "bullmq";
import Redis from "ioredis";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

class TransientStorage implements ObjectStorage {
  putAttempts = 0;

  constructor(private readonly inner: ObjectStorage) {}

  async putObject(input: Parameters<ObjectStorage["putObject"]>[0]): Promise<void> {
    this.putAttempts += 1;
    if (this.putAttempts === 1) {
      throw new Error("Transient object storage failure");
    }
    await this.inner.putObject(input);
  }

  getObject(key: string): Promise<Uint8Array> {
    return this.inner.getObject(key);
  }

  deleteObject(key: string): Promise<void> {
    return this.inner.deleteObject(key);
  }

  deleteObjects(keys: string[]): Promise<void> {
    return this.inner.deleteObjects(keys);
  }
}

describe("work export HTTP and worker integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  let processor: WorkExportProcessor;
  let storageDirectory: string;
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
    storageDirectory = await mkdtemp(path.join(tmpdir(), "novelbrain-work-export-"));
    process.env.STORAGE_LOCAL_DIRECTORY = storageDirectory;

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl, {
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    processor = new WorkExportProcessor(
      new WorkerWorkExportRepository(),
      new FileObjectStorage(storageDirectory),
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_GATEWAY)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.useBodyParser("json", { limit: "32mb" });
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
    await rm(storageDirectory, { recursive: true, force: true });
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
    const setting = await createSetting(owner, token, branchPath);
    const settingSnapshotVersion = await saveChapterVersion(
      owner,
      token,
      branchPath,
      outline.chapterOne.chapter.id,
      "历史附录边界正文：山门已经打开。",
    );
    await updateSetting(owner, token, branchPath, setting);
    const branchChapter = await createChapter(owner, token, branchPath2, 1, "平行山门");
    const branchVersion = await saveChapterVersion(
      owner,
      token,
      branchPath2,
      branchChapter.id,
      "平行版本正文：山门后另有一条路。",
    );
    await createModelConfig(owner, token);
    const titleToken = await csrf(owner);
    const chapterWorkspace = (
      await owner.get(`${branchPath}/chapters/${outline.chapterOne.chapter.id}`).expect(200)
    ).body.data as { version: number };
    await owner
      .patch(`${branchPath}/chapters/${outline.chapterOne.chapter.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", titleToken)
      .send({ version: chapterWorkspace.version, title: "后续章名" })
      .expect(200);

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
    expect(historicalReady.manifest?.chapters[0]?.title).toBe("山门");
    const historicalDownload = await download(owner, branchPath, historical.id);
    const historicalText = historicalDownload.body.toString("utf8");
    expect(historicalText).toContain("旧版正文");
    expect(historicalText).not.toContain("主线新版");
    expect(historicalText).not.toContain(keyCanary);

    const historicalBook = await startExport(owner, branchPath, "historical-book", {
      format: "txt",
      scope: { kind: "book" },
      sourceVersionNodeId: firstV1.versionNodeId,
      options: exportOptions(),
    });
    await runExport(historicalBook.jobId, historicalBook.id);
    expect((await getReceipt(owner, branchPath, historicalBook.id)).manifest?.chapters).toEqual([
      expect.objectContaining({
        chapterId: outline.chapterOne.chapter.id,
        versionNodeId: firstV1.versionNodeId,
      }),
    ]);

    const historicalAppendix = await startExport(owner, branchPath, "historical-setting-appendix", {
      format: "txt",
      scope: { kind: "current_chapter", chapterId: outline.chapterOne.chapter.id },
      sourceVersionNodeId: settingSnapshotVersion.versionNodeId,
      options: { ...exportOptions(), includeSettingsAppendix: true },
    });
    await runExport(historicalAppendix.jobId, historicalAppendix.id);
    const appendixText = (await download(owner, branchPath, historicalAppendix.id)).body.toString(
      "utf8",
    );
    expect(appendixText).toContain("旧版设定摘要");
    expect(appendixText).not.toContain("新版设定摘要");

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

    const conflictToken = await csrf(owner);
    const idempotencyConflict = await owner
      .post(`${branchPath2}/exports`)
      .set("Origin", origin)
      .set("X-CSRF-Token", conflictToken)
      .set("Idempotency-Key", "parallel-export")
      .send({
        format: "txt",
        scope: { kind: "current_chapter", chapterId: branchChapter.id },
        options: exportOptions(),
      });
    expect(idempotencyConflict.status).toBe(409);
    expect(idempotencyConflict.body.error.code).toBe("WORK_EXPORT_IDEMPOTENCY_CONFLICT");

    const history = workExportReceiptListResponseSchema.parse(
      (await owner.get(`${branchPath2}/exports`).expect(200)).body,
    ).data;
    expect(history.map((receipt) => receipt.id)).toContain(parallel.id);

    const outlineVersion = await databasePool.query<{ version: number }>(
      "SELECT version FROM outline_nodes WHERE id = $1",
      [outline.chapterTwo.id],
    );
    const outlineToken = await csrf(owner);
    const outlinePatch = await owner
      .patch(`${branchPath}/outline/nodes/${outline.chapterTwo.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", outlineToken)
      .send({ version: outlineVersion.rows[0]?.version, title: "后续改名" });
    expect(outlinePatch.status, JSON.stringify(outlinePatch.body)).toBe(200);
    const unaffectedHistorical = await startExport(
      owner,
      branchPath,
      "historical-outline-unrelated",
      {
        format: "txt",
        scope: { kind: "current_chapter", chapterId: outline.chapterOne.chapter.id },
        sourceVersionNodeId: firstV1.versionNodeId,
        options: exportOptions(),
      },
    );
    await runExport(unaffectedHistorical.jobId, unaffectedHistorical.id);
    expect((await getReceipt(owner, branchPath, unaffectedHistorical.id)).status).toBe("completed");
    const driftToken = await csrf(owner);
    const driftedOutline = await owner
      .post(`${branchPath}/exports`)
      .set("Origin", origin)
      .set("X-CSRF-Token", driftToken)
      .set("Idempotency-Key", "historical-outline-drifted")
      .send({
        format: "txt",
        scope: { kind: "current_chapter", chapterId: outline.chapterOne.chapter.id },
        sourceVersionNodeId: firstV1.versionNodeId,
        options: { ...exportOptions(), includeOutline: true },
      });
    expect(driftedOutline.status).toBe(400);
    expect(driftedOutline.body.error.code).toBe("WORK_EXPORT_SOURCE_INVALID");

    const other = await createAuthenticatedAgent("work-export-other@example.com");
    const forbidden = await other.get(`${branchPath2}/exports/${parallel.id}`).expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const staleQueued = await startExport(owner, branchPath2, "stale-queued", {
      format: "txt",
      scope: { kind: "current_chapter", chapterId: branchChapter.id },
      options: exportOptions(),
    });
    await databasePool.query(
      "UPDATE work_export_receipts SET expires_at = now() - interval '1 second' WHERE id = $1",
      [staleQueued.id],
    );
    await processor.cleanupExpiredReceipts();
    expect((await getReceipt(owner, branchPath2, staleQueued.id)).status).toBe("expired");

    await databasePool.query(
      "UPDATE work_export_receipts SET expires_at = now() - interval '1 second' WHERE id = $1",
      [parallel.id],
    );
    await processor.cleanupExpiredReceipts();
    const expired = await getReceipt(owner, branchPath2, parallel.id);
    expect(expired.status).toBe("expired");
    expect(expired.byteSize).toBeGreaterThan(0);
    const clearedPayload = await databasePool.query<{ source_descriptor: unknown }>(
      "SELECT source_descriptor FROM work_export_receipts WHERE id = $1",
      [parallel.id],
    );
    expect(clearedPayload.rows[0]?.source_descriptor).toBeNull();
    const expiredDownload = await owner.get(`${branchPath2}/exports/${parallel.id}/download`);
    expect(expiredDownload.status).toBe(410);
    expect(expiredDownload.body.error.code).toBe("WORK_EXPORT_EXPIRED");
  });

  it("runs a large export through worker checkpoints, object storage and download", async () => {
    const owner = await createAuthenticatedAgent("work-export-large@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const chapter = await createChapter(owner, token, branchPath, 1, "大章");
    const content = "龙".repeat(190_000);
    await saveChapterVersion(owner, token, branchPath, chapter.id, content);

    const receipt = await startExport(owner, branchPath, "large-export", {
      format: "txt",
      scope: { kind: "book" },
      options: exportOptions(),
    });
    expect(await processor.listPendingJobs()).toContainEqual(
      expect.objectContaining({
        jobId: receipt.jobId,
        exportId: receipt.id,
      }),
    );
    const attempts = await runQueuedExport(receipt.jobId, receipt.id);
    expect(attempts).toEqual([1, 2]);

    const ready = await getReceipt(owner, branchPath, receipt.id);
    expect(ready.status).toBe("completed");
    expect(ready.manifest?.characterCount).toBe(190_000);
    expect(ready.byteSize).toBeGreaterThan(190_000);

    const stored = await databasePool.query<{
      artifact_object_key: string;
      checksum: string;
      byte_size: number;
    }>(
      `SELECT artifact_object_key, checksum, byte_size
         FROM work_export_receipts WHERE id = $1`,
      [receipt.id],
    );
    const object = stored.rows[0];
    if (!object) {
      throw new Error("Large export object metadata is missing");
    }
    const bytes = await readFile(path.join(storageDirectory, object.artifact_object_key));
    expect(bytes.byteLength).toBe(object.byte_size);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(object.checksum);

    const execution = await databasePool.query<{
      checkpoint_version: number;
      checkpoint_step: string;
      steps: string[];
      revisions: string[];
      step_keys: string[];
    }>(
      `SELECT j.checkpoint_version,
              j.checkpoint->>'step' AS checkpoint_step,
              (SELECT array_agg(step_key ORDER BY step_key)
                 FROM job_steps WHERE job_id = j.id AND user_id = j.user_id) AS steps,
              (SELECT array_agg(revision ORDER BY revision)
                 FROM job_checkpoints WHERE job_id = j.id AND user_id = j.user_id) AS revisions,
              (SELECT array_agg(step_key ORDER BY revision)
                 FROM job_checkpoints WHERE job_id = j.id AND user_id = j.user_id) AS step_keys
         FROM jobs j WHERE j.id = $1`,
      [receipt.jobId],
    );
    expect(execution.rows[0]).toMatchObject({
      checkpoint_version: 3,
      checkpoint_step: "complete",
      steps: ["complete", "prepare", "render"],
      revisions: [1, 2, 3],
      step_keys: ["prepare", "render", "complete"],
    });

    await databasePool.query(
      `UPDATE jobs
          SET status = 'running', checkpoint_version = 2,
              checkpoint = (
                SELECT payload FROM job_checkpoints
                 WHERE job_id = $1 AND revision = 2
              )
        WHERE id = $1`,
      [receipt.jobId],
    );
    await databasePool.query(
      "UPDATE work_export_receipts SET status = 'running', completed_at = NULL WHERE id = $1",
      [receipt.id],
    );
    await runExport(receipt.jobId, receipt.id);
    expect((await getReceipt(owner, branchPath, receipt.id)).status).toBe("completed");

    const downloaded = await download(owner, branchPath, receipt.id);
    expect(downloaded.headers["x-export-checksum"]).toBe(object.checksum);
    expect(downloaded.headers["content-length"]).toBe(String(object.byte_size));
    expect(downloaded.body.byteLength).toBe(object.byte_size);
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

  async function runQueuedExport(jobId: string, exportId: string): Promise<number[]> {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const repository = new WorkerWorkExportRepository();
    const queueProcessor = new WorkExportProcessor(
      repository,
      new TransientStorage(new FileObjectStorage(storageDirectory)),
    );
    const attempts: number[] = [];
    const worker = new BullWorker<WorkerJob, void>(
      WORKER_QUEUE_NAME,
      async (job) => {
        if (job.id !== jobId) {
          return;
        }
        const payload = workerJobSchema.parse(job.data);
        if (payload.jobType !== EXPORT_WORK_JOB) {
          throw new Error("Unexpected queued work export type");
        }
        attempts.push(job.attemptsMade + 1);
        await queueProcessor.process(payload, {
          number: job.attemptsMade + 1,
          maxAttempts: Math.max(1, job.opts.attempts ?? 1),
        });
      },
      { connection },
    );
    try {
      await worker.waitUntilReady();
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        const result = await databasePool.query<{ status: string }>(
          "SELECT status FROM work_export_receipts WHERE id = $1",
          [exportId],
        );
        const status = result.rows[0]?.status;
        if (status === "completed") {
          return attempts;
        }
        if (status === "failed") {
          throw new Error("Queued work export failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("Queued work export did not finish before timeout");
    } finally {
      await worker.close();
      await queueProcessor.onModuleDestroy();
      connection.disconnect();
    }
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

  async function createSetting(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<{ id: string; version: number }> {
    return (
      await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          type: "world_rule",
          name: "历史设定边界",
          aliases: [],
          summary: "旧版设定摘要",
          description: "用于验证历史附录不会读取当前版本。",
          tags: ["历史"],
          data: { rule: "历史版本只读取祖先版本节点。" },
        })
        .expect(201)
    ).body.data as { id: string; version: number };
  }

  async function updateSetting(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    setting: { id: string; version: number },
  ): Promise<void> {
    await agent
      .patch(`${branchPath}/entities/${setting.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: setting.version,
        summary: "新版设定摘要",
      })
      .expect(200);
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
