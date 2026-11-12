import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  branchComparisonResponseSchema,
  branchCreateResponseSchema,
  changeAnalysisResponseSchema,
  changeApplyResponseSchema,
  changeRequestResponseSchema,
  chunkedImportProgressResponseSchema,
  mergeApplyResponseSchema,
  mergeItemDecisionResponseSchema,
  manuscriptImportResponseSchema,
  notificationListResponseSchema,
  searchRebuildResponseSchema,
  searchResponseSchema,
  settingEntityResponseSchema,
  versionRollbackResponseSchema,
  workResponseSchema,
} from "@novel-brain/contracts";
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

describe("M2 change, branch, search and chunked import integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "m2-04-06-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "m2-04-06-integration-proxy-secret";
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

  it("creates a branch, analyzes and applies a change, then selectively merges one object", async () => {
    const owner = await createAuthenticatedAgent("m2-change-owner@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token, "修改与平行版本");
    let branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    const branch = branchCreateResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            name: "what-if",
            sourceNodeId: work.mainBranch.headNodeId,
            reason: "验证另一条剧情线",
          })
          .expect(200)
      ).body,
    ).data;
    branchPath = `/api/v1/works/${work.id}/branches/${branch.id}`;
    const selectedBranchWork = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}?branchId=${branch.id}`).expect(200)).body,
    ).data;
    expect(selectedBranchWork.mainBranch.id).toBe(branch.id);

    const targetEntity = settingEntityResponseSchema.parse(
      (
        await owner
          .post(`${branchPath}/entities`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            type: "character",
            name: "沈砚",
            aliases: ["小砚"],
            summary: "左臂骨折，仍在追查旧案。",
            description: "外门杂役。",
            tags: ["主角"],
            data: {
              bodyState: "左臂骨折",
              knowledgeBoundary: "不知道父母死于仇杀",
              relationshipSummary: "与顾青互相试探",
            },
          })
          .expect(201)
      ).body,
    ).data;
    const branchBeforeChange = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}?branchId=${branch.id}`).expect(200)).body,
    ).data.mainBranch;
    const targetEntityId = targetEntity.id;
    const change = changeRequestResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${branch.id}/changes`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "m2-change-1")
          .send({
            title: "调整角色伤势",
            reason: "让后续战斗成立",
            targetVersion: targetEntity.version,
            targetType: "entity",
            targetId: targetEntityId,
            objectType: "entity",
            before: { version: targetEntity.version, summary: targetEntity.summary },
            after: { summary: "左臂恢复，旧案线索已经明确。" },
            risk: "high",
            source: "author",
          })
          .expect(200)
      ).body,
    ).data;

    const analysis = changeAnalysisResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${branch.id}/changes/${change.id}/analyze`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(analysis.impacts).toHaveLength(7);
    expect(analysis.change.status).toBe("awaiting_confirmation");

    const applied = changeApplyResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${branch.id}/changes/${change.id}/apply`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: analysis.change.version,
            expectedTargetVersion: targetEntity.version,
            confirmHighRisk: true,
            reason: "作者确认调整",
          })
          .expect(200)
      ).body,
    ).data;
    expect(applied.change.status).toBe("applied");
    expect(
      settingEntityResponseSchema.parse(
        (await owner.get(`${branchPath}/entities/${targetEntityId}`).expect(200)).body,
      ).data.summary,
    ).toBe("左臂恢复，旧案线索已经明确。");

    const rollback = versionRollbackResponseSchema.parse(
      (
        await owner
          .post(`${branchPath}/rollback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            targetNodeId: branchBeforeChange.headNodeId,
            expectedHeadNodeId: applied.versionNodeId,
            reason: "撤销这次角色状态修改",
          })
          .expect(200)
      ).body,
    ).data;
    expect(rollback.nodeType).toBe("rollback");
    expect(
      settingEntityResponseSchema.parse(
        (await owner.get(`${branchPath}/entities/${targetEntityId}`).expect(200)).body,
      ).data.summary,
    ).toBe("左臂骨折，仍在追查旧案。");

    const mainEntity = settingEntityResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            type: "character",
            name: "沈砚",
            aliases: ["小砚"],
            summary: "左臂暂时包扎，等待进一步处理。",
            description: "外门杂役。",
            tags: ["主角"],
            data: {
              bodyState: "左臂暂时包扎",
              knowledgeBoundary: "不知道父母死于仇杀",
              relationshipSummary: "与顾青互相试探",
            },
          })
          .expect(201)
      ).body,
    ).data;
    const mainChange = changeRequestResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/changes`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "m2-change-main")
          .send({
            title: "主线也调整角色伤势",
            reason: "形成目标侧冲突",
            targetVersion: mainEntity.version,
            targetType: "entity",
            targetId: mainEntity.id,
            objectType: "entity",
            before: { version: mainEntity.version, summary: mainEntity.summary },
            after: { summary: "左臂已恢复，准备追查血河宗。" },
            risk: "high",
            source: "author",
          })
          .expect(200)
      ).body,
    ).data;
    const mainAnalysis = changeAnalysisResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/changes/${mainChange.id}/analyze`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    const mainChangeApplied = changeApplyResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/changes/${mainChange.id}/apply`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: mainAnalysis.change.version,
            expectedTargetVersion: mainEntity.version,
            confirmHighRisk: true,
          })
          .expect(200)
      ).body,
    ).data;

    const comparison = branchComparisonResponseSchema.parse(
      (
        await owner
          .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/compare/${branch.id}`)
          .expect(200)
      ).body,
    ).data;
    expect(comparison.items.length).toBeGreaterThan(0);
    expect(comparison.items.some((candidate) => candidate.conflict)).toBe(true);
    const item = comparison.items.find((candidate) => candidate.changeKind === "changed")!;
    expect(item).toBeDefined();
    expect(item.conflict).toBe(true);

    const decision = mergeItemDecisionResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${item.id}/decision`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: item.version,
            action: "accept",
            reason: "接受该对象的差异",
          })
          .expect(200)
      ).body,
    ).data;
    expect(decision.status).toBe("accepted");

    const mergeApplied = mergeApplyResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            itemIds: [item.id],
            expectedTargetHeadNodeId: mainChangeApplied.versionNodeId,
            confirmHighRisk: true,
          })
          .expect(200)
      ).body,
    ).data;
    expect(
      settingEntityResponseSchema.parse(
        (
          await owner
            .get(
              `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${mainEntity.id}`,
            )
            .expect(200)
        ).body,
      ).data.summary,
    ).toBe("左臂恢复，旧案线索已经明确。");
    const mergeRollback = versionRollbackResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/rollback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            targetNodeId: mergeApplied.versionNodeId,
            expectedHeadNodeId: mergeApplied.versionNodeId,
            reason: "撤销这次对象摘取",
          })
          .expect(200)
      ).body,
    ).data;
    expect(mergeRollback.nodeType).toBe("rollback");
    expect(
      settingEntityResponseSchema.parse(
        (
          await owner
            .get(
              `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${mainEntity.id}`,
            )
            .expect(200)
        ).body,
      ).data.summary,
    ).toBe("左臂已恢复，准备追查血河宗。");
    const notifications = notificationListResponseSchema.parse(
      (await owner.get("/api/v1/notifications?limit=20").expect(200)).body,
    ).data;
    expect(notifications.some((notification) => notification.type === "merge_conflict")).toBe(true);
    const other = await createAuthenticatedAgent("m2-change-other@example.com");
    const otherToken = await csrf(other);
    await other.get(`/api/v1/works/${work.id}/branches/${branch.id}/changes?limit=20`).expect(403);
    await other
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${item.id}/decision`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version: item.version, action: "accept", reason: "越权测试" })
      .expect(404);
    expect(branchPath).toContain(branch.id);
  });

  it("rebuilds and searches the Chinese branch index", async () => {
    const owner = await createAuthenticatedAgent("m2-search-owner@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token, "搜索索引");
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await owner
      .post(`${branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: ["小砚"],
        summary: "隐藏忘川书的外门杂役。",
        description: "左臂骨折，仍然坚持调查真相。",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折",
          knowledgeBoundary: "不知道父母死于仇杀",
          relationshipSummary: "与顾青互相试探",
        },
      })
      .expect(201);

    let rebuilt = searchRebuildResponseSchema.parse(
      (
        await owner
          .post(`${branchPath}/search/rebuild`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(202)
      ).body,
    ).data;
    while (rebuilt.status === "queued" || rebuilt.status === "running") {
      rebuilt = searchRebuildResponseSchema.parse(
        (
          await owner
            .post(`${branchPath}/search/rebuilds/${rebuilt.runId}/process`)
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({})
            .expect(200)
        ).body,
      ).data;
    }
    expect(rebuilt.indexed).toBeGreaterThan(0);
    expect(rebuilt.status).toBe("completed");
    const rebuildProgress = searchRebuildResponseSchema.parse(
      (await owner.get(`${branchPath}/search/rebuilds/${rebuilt.runId}`).expect(200)).body,
    ).data;
    expect(rebuildProgress).toMatchObject({
      runId: rebuilt.runId,
      status: "completed",
      indexed: rebuilt.indexed,
    });
    const results = searchResponseSchema.parse(
      (await owner.get(`${branchPath}/search?q=${encodeURIComponent("沈砚")}`).expect(200)).body,
    ).data;
    expect(results).toContainEqual(
      expect.objectContaining({ title: "沈砚", sourceType: "entity" }),
    );
    const other = await createAuthenticatedAgent("m2-search-other@example.com");
    await other.get(`${branchPath}/search?q=${encodeURIComponent("沈砚")}`).expect(403);
  });

  it("creates and resumes a chunked manuscript import", async () => {
    const owner = await createAuthenticatedAgent("m2-chunk-import@example.com");
    const token = await csrf(owner);
    const created = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunk-import-1")
          .send({
            sourceName: "大文件.txt",
            chunks: ["第一章 荒寺\n\n沈砚醒来。", "\n\n第二章 追兵\n\n血河宗赶到。"],
          })
          .expect(200)
      ).body,
    ).data;
    expect(created).toMatchObject({
      status: "queued",
      chunkCount: 2,
      processedChunks: 0,
      canConfirm: false,
    });
    const replayed = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunk-import-1")
          .send({
            sourceName: "大文件.txt",
            chunks: ["第一章 荒寺\n\n沈砚醒来。", "\n\n第二章 追兵\n\n血河宗赶到。"],
          })
          .expect(200)
      ).body,
    ).data;
    expect(replayed.importId).toBe(created.importId);
    const stored = await databasePool.query<{
      source_text: string;
      start_offset: number;
      end_offset: number;
    }>(
      `SELECT job.source_text, chunk.start_offset, chunk.end_offset
       FROM import_jobs AS job
       INNER JOIN import_chunks AS chunk ON chunk.import_job_id = job.id
       WHERE job.id = $1
       ORDER BY chunk.sequence`,
      [created.importId],
    );
    expect(stored.rows[0]?.source_text).toBe("");
    expect(stored.rows.map((row) => [row.start_offset, row.end_offset])).toEqual([
      [0, 13],
      [13, 29],
    ]);
    await owner
      .post(`/api/v1/imports/manuscripts/${created.importId}/pause`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
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
    expect(resumed.status).toBe("queued");
    const first = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(first.processedChunks).toBe(1);
    const second = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(second).toMatchObject({
      status: "awaiting_confirmation",
      processedChunks: 2,
      canConfirm: true,
    });
    const chunkedPreview = manuscriptImportResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}`).expect(200)).body,
    ).data;
    expect(chunkedPreview.chapters).toHaveLength(2);
    const other = await createAuthenticatedAgent("m2-chunk-other@example.com");
    const otherToken = await csrf(other);
    await other
      .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({})
      .expect(403);

    const streamed = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunk-stream-1")
          .send({ sourceName: "流式旧稿.txt", chunkCount: 2 })
          .expect(200)
      ).body,
    ).data;
    for (const [sequence, sourceText] of [
      "第一章 荒寺\n\n沈砚醒来。",
      "\n\n第二章 追兵\n\n血河宗赶到。",
    ].entries()) {
      await owner
        .post(`/api/v1/imports/manuscripts/${streamed.importId}/chunks`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ sequence, sourceText })
        .expect(200);
    }
    await owner
      .post(`/api/v1/imports/manuscripts/${streamed.importId}/process`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const streamedDone = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${streamed.importId}/process`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(streamedDone.status).toBe("awaiting_confirmation");
  });

  async function createWork(agent: SuperAgentTest, token: string, title: string) {
    return workResponseSchema.parse(
      (
        await agent
          .post("/api/v1/works")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", crypto.randomUUID())
          .send({
            mode: "idea",
            title,
            idea: "一个作者尝试修改自己的长篇故事。",
            genre: "xianxia",
            scaleTarget: "long",
            chapterLengthTarget: 3000,
          })
          .expect(200)
      ).body,
    ).data;
  }

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
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
        password: "StrongPassword123",
        displayName: "M2 作者",
      })
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
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "42P04"
    )) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}
