import "reflect-metadata";

import crypto from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  SUMMARY_REBUILD_JOB,
  summaryRebuildJobSchema,
  summaryRebuildRunResponseSchema,
  summaryWorkspaceResponseSchema,
  type SummaryRecord,
  type SummaryRebuildRun,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import { Pool } from "pg";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { SummaryRebuildProcessor } from "../../worker/src/summaries/summary-rebuild.processor";
import { WorkerSummaryRepository } from "../../worker/src/summaries/summary.repository";

const baseDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const baseRedisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
const databaseUrl = withDatabaseName(
  baseDatabaseUrl,
  `novelbrain_test_113_${crypto.randomBytes(4).toString("hex")}`,
);
const redisUrl = withRedisDatabase(baseRedisUrl, 5 + Math.floor(Math.random() * 10));
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

class SimulatedWorkerCrash extends Error {
  constructor() {
    super("simulated summary worker termination");
    this.name = "SimulatedWorkerCrash";
  }
}

describe("hierarchical summaries HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let cleanupPool: Pool;
  let redis: Redis;
  const workerRepositories: WorkerSummaryRepository[] = [];
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "summaries-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "summaries-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl);
    cleanupPool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      max: 2,
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
    await cleanupPool.query("TRUNCATE TABLE users CASCADE");
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    for (const repository of workerRepositories) {
      await repository.onModuleDestroy().catch(() => undefined);
    }
    await databasePool?.end();
    await cleanupPool?.end();
    redis?.disconnect();
  });

  it("rebuilds multiple volumes, invalidates only impacted summaries and isolates branches", async () => {
    const owner = await createAuthenticatedAgent("summary-owner@example.com");
    const work = await createWork(owner, "忘川分层录");
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const fixture = await createOutlineFixture(owner, token, branchPath);
    const userId = await userIdFor(owner);
    const otherBranchId = uuidv7();
    await databasePool.query(
      `INSERT INTO work_branches (id, work_id, user_id, name, status)
       VALUES ($1, $2, $3, 'what-if', 'active')`,
      [otherBranchId, work.id, userId],
    );

    const firstRun = await rebuild(owner, token, branchPath, "summary-rebuild-1");
    const firstJob = summaryRebuildJobSchema.parse({
      jobType: SUMMARY_REBUILD_JOB,
      runId: firstRun.id,
      workId: work.id,
      branchId: work.mainBranch.id,
      actorId: userId,
      idempotencyKey: firstRun.idempotencyKey,
    });
    await processWithCrash(firstJob, 3);
    await new SummaryRebuildProcessor(summaryRepository()).process(firstJob);

    const completed = await getRun(owner, token, branchPath, firstRun.id);
    expect(completed).toMatchObject({
      status: "completed",
      completedItems: 10,
      failedItems: 0,
      checkpointRevision: 10,
    });

    const firstWorkspace = await summaries(owner, branchPath);
    expect(firstWorkspace.stats).toEqual({ total: 10, fresh: 10, stale: 0, rebuilding: 0 });
    const rls = await databasePool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT relname, relrowsecurity, relforcerowsecurity
       FROM pg_class
       WHERE relname IN ('summary_records', 'summary_rebuild_runs', 'summary_rebuild_items')`,
    );
    expect(rls.rows).toHaveLength(3);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const chapterOne = findByScope(firstWorkspace.summaries, fixture.chapterOne.id);
    expect(chapterOne).toMatchObject({
      level: "chapter",
      chapterId: fixture.chapterOne.chapter.id,
      version: 1,
      compilerVersion: "summary-compiler-v1",
      modelVersion: "deterministic-summary-v1",
      fromChapter: 1,
      toChapter: 1,
    });
    expect(chapterOne.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(chapterOne.sourceRanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          versionNodeId: fixture.chapterOne.versionNodeId,
          objectVersion: 1,
          chapterFrom: 1,
          chapterTo: 1,
        }),
        expect.objectContaining({
          nodeId: fixture.chapterOne.id,
          objectVersion: 1,
          chapterFrom: 1,
          chapterTo: 1,
        }),
      ]),
    );
    const volumeOne = findByScope(firstWorkspace.summaries, fixture.volumeOne.id);
    expect(volumeOne).toMatchObject({ level: "volume", fromChapter: 1, toChapter: 3 });
    expect(volumeOne.sourceRanges.length).toBeGreaterThan(3);
    expect(findByScope(firstWorkspace.summaries, fixture.actOne.id).level).toBe("stage");
    expect(findByScope(firstWorkspace.summaries, fixture.book.id).level).toBe("book");

    await insertOtherBranchSummary(otherBranchId, work.id, userId, fixture.book.id);
    const chapterOneCurrent = await getChapter(owner, branchPath, fixture.chapterOne.chapter.id);
    await saveVersion(
      owner,
      token,
      branchPath,
      fixture.chapterOne.chapter.id,
      chapterOneCurrent.version,
      "第一章修订版。沈砚在雨夜藏起断臂，顾青第一次看见忘川书。",
    );

    const invalidated = await summaries(owner, branchPath);
    expect(invalidated.stats).toEqual({ total: 10, fresh: 6, stale: 4, rebuilding: 0 });
    expect(findByScope(invalidated.summaries, fixture.chapterOne.id).status).toBe("stale");
    expect(findByScope(invalidated.summaries, fixture.actOne.id).status).toBe("stale");
    expect(findByScope(invalidated.summaries, fixture.volumeOne.id).status).toBe("stale");
    expect(findByScope(invalidated.summaries, fixture.book.id).status).toBe("stale");
    expect(findByScope(invalidated.summaries, fixture.chapterTwo.id).status).toBe("fresh");
    expect(findByScope(invalidated.summaries, fixture.actTwo.id).status).toBe("fresh");
    expect(findByScope(invalidated.summaries, fixture.volumeTwo.id).status).toBe("fresh");
    expect(findByScope(invalidated.summaries, fixture.chapterFour.id).status).toBe("fresh");

    const otherBranchSummaries = await summariesForBranch(owner, branchPath, otherBranchId);
    const isolated = findByScope(otherBranchSummaries.summaries, fixture.book.id);
    expect(isolated.status).toBe("fresh");

    const secondRun = await rebuild(owner, token, branchPath, "summary-rebuild-2");
    await new SummaryRebuildProcessor(summaryRepository()).process(
      summaryRebuildJobSchema.parse({
        jobType: SUMMARY_REBUILD_JOB,
        runId: secondRun.id,
        workId: work.id,
        branchId: work.mainBranch.id,
        actorId: userId,
        idempotencyKey: secondRun.idempotencyKey,
      }),
    );
    const rebuilt = await summaries(owner, branchPath);
    const rebuiltChapterOne = findByScope(rebuilt.summaries, fixture.chapterOne.id);
    expect(rebuiltChapterOne.version).toBe(2);
    expect(rebuiltChapterOne.content).toContain("第一章修订版");
    expect(findByScope(rebuilt.summaries, fixture.chapterTwo.id).version).toBe(1);
    expect(findByScope(rebuilt.summaries, fixture.chapterTwo.id).contentHash).toBe(
      findByScope(firstWorkspace.summaries, fixture.chapterTwo.id).contentHash,
    );

    const replayed = await rebuild(owner, token, branchPath, "summary-rebuild-2");
    expect(replayed.id).toBe(secondRun.id);
    await new SummaryRebuildProcessor(summaryRepository()).process(
      summaryRebuildJobSchema.parse({
        jobType: SUMMARY_REBUILD_JOB,
        runId: replayed.id,
        workId: work.id,
        branchId: work.mainBranch.id,
        actorId: userId,
        idempotencyKey: replayed.idempotencyKey,
      }),
    );
    expect((await summaries(owner, branchPath)).summaries).toEqual(rebuilt.summaries);
  });

  it("rejects cross-tenant rebuilds and exposes the same run for repeated idempotency keys", async () => {
    const owner = await createAuthenticatedAgent("summary-private@example.com");
    const other = await createAuthenticatedAgent("summary-other@example.com");
    const work = await createWork(owner, "忘川私密录");
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createOutlineFixture(owner, token, branchPath);

    const first = await rebuild(owner, token, branchPath, "summary-idempotent");
    const replay = await rebuild(owner, token, branchPath, "summary-idempotent");
    expect(replay.id).toBe(first.id);

    const denied = await other
      .post(`${branchPath}/summaries/rebuild`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .set("Idempotency-Key", "summary-cross-tenant")
      .send({})
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    expect((await other.get(`${branchPath}/summaries`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
  });

  async function processWithCrash(
    job: ReturnType<typeof summaryRebuildJobSchema.parse>,
    after: number,
  ) {
    let completed = 0;
    const processor = new SummaryRebuildProcessor(summaryRepository());
    processor.setCheckpointBoundaryHook(() => {
      completed += 1;
      if (completed === after) {
        throw new SimulatedWorkerCrash();
      }
    });
    await expect(processor.process(job)).rejects.toBeInstanceOf(SimulatedWorkerCrash);
  }

  function summaryRepository(): WorkerSummaryRepository {
    const repository = new WorkerSummaryRepository();
    workerRepositories.push(repository);
    return repository;
  }

  async function createOutlineFixture(agent: SuperAgentTest, token: string, branchPath: string) {
    const outlinePath = `${branchPath}/outline`;
    const book = await createNode(agent, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "忘川分层录",
    });
    const volumeOne = await createNode(agent, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第一卷 · 雨夜出山",
    });
    const actOne = await createNode(agent, token, outlinePath, {
      level: "act",
      parentId: volumeOne.id,
      title: "第一幕 · 断臂",
    });
    const chapterOne = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: actOne.id,
      chapterCreate: { number: 1, title: "一只手也能结印", brief: completeBrief() },
    });
    const chapterTwo = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: actOne.id,
      chapterCreate: { number: 2, title: "藏经阁夜谈", brief: completeBrief() },
    });
    const actTwo = await createNode(agent, token, outlinePath, {
      level: "act",
      parentId: volumeOne.id,
      title: "第二幕 · 入城",
    });
    const chapterThree = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: actTwo.id,
      chapterCreate: { number: 3, title: "长街雨未停", brief: completeBrief() },
    });
    const volumeTwo = await createNode(agent, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第二卷 · 天门将开",
    });
    const actThree = await createNode(agent, token, outlinePath, {
      level: "act",
      parentId: volumeTwo.id,
      title: "第三幕 · 山门问剑",
    });
    const chapterFour = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: actThree.id,
      chapterCreate: { number: 4, title: "问剑峰上", brief: completeBrief() },
    });
    const contents: Record<string, string> = {
      [chapterOne.chapter!.id]: "第一章初稿。沈砚在荒寺外藏起断臂，顾青听见骨裂声。",
      [chapterTwo.chapter!.id]: "第二章初稿。藏经阁里，沈砚借前人经验辨认残页。",
      [chapterThree.chapter!.id]: "第三章初稿。长街雨夜，血河宗追兵封住城门。",
      [chapterFour.chapter!.id]: "第四章初稿。问剑峰上，顾青替沈砚挡下一剑。",
    };
    for (const node of [chapterOne, chapterTwo, chapterThree, chapterFour]) {
      const chapter = await getChapter(agent, branchPath, node.chapter!.id);
      const response = await saveVersion(
        agent,
        token,
        branchPath,
        node.chapter!.id,
        chapter.version,
        contents[node.chapter!.id]!,
      );
      node.versionNodeId = response.version.versionNodeId;
    }
    return {
      book,
      volumeOne,
      actOne,
      chapterOne,
      chapterTwo,
      actTwo,
      chapterThree,
      volumeTwo,
      actThree,
      chapterFour,
    };
  }

  async function createNode(
    agent: SuperAgentTest,
    token: string,
    outlinePath: string,
    body: Record<string, unknown>,
  ): Promise<{
    id: string;
    chapter?: { id: string };
    versionNodeId?: string;
  }> {
    const response = await agent
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body)
      .expect(201);
    return response.body.data.node as {
      id: string;
      chapter?: { id: string };
      versionNodeId?: string;
    };
  }

  async function rebuild(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    idempotencyKey: string,
  ): Promise<SummaryRebuildRun> {
    const response = await agent
      .post(`${branchPath}/summaries/rebuild`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", idempotencyKey)
      .send({})
      .expect(202);
    return summaryRebuildRunResponseSchema.parse(response.body).data;
  }

  async function getRun(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    runId: string,
  ): Promise<SummaryRebuildRun> {
    void token;
    const response = await agent
      .get(`${branchPath}/summaries/rebuilds/${runId}`)
      .set("Origin", origin)
      .expect(200);
    return summaryRebuildRunResponseSchema.parse(response.body).data;
  }

  async function summaries(agent: SuperAgentTest, branchPath: string) {
    const response = await agent.get(`${branchPath}/summaries`).expect(200);
    return summaryWorkspaceResponseSchema.parse(response.body).data;
  }

  async function summariesForBranch(agent: SuperAgentTest, branchPath: string, branchId: string) {
    const response = await agent
      .get(branchPath.replace(/\/branches\/[^/]+$/, `/branches/${branchId}`) + "/summaries")
      .expect(200);
    return summaryWorkspaceResponseSchema.parse(response.body).data;
  }

  async function getChapter(agent: SuperAgentTest, branchPath: string, chapterId: string) {
    const response = await agent.get(`${branchPath}/chapters/${chapterId}`).expect(200);
    return response.body.data as { version: number; id: string };
  }

  async function saveVersion(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapterId: string,
    version: number,
    content: string,
  ) {
    const response = await agent
      .post(`${branchPath}/chapters/${chapterId}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version, content })
      .expect(201);
    return response.body.data as { version: { versionNodeId: string } };
  }

  async function insertOtherBranchSummary(
    branchId: string,
    workId: string,
    userId: string,
    scopeId: string,
  ) {
    const versionNodeId = uuidv7();
    const content = "旧分支全书概要";
    await databasePool.query(
      `INSERT INTO version_nodes (
         id, work_id, branch_id, user_id, parent_node_id, node_type, object_type,
         object_id, object_version, payload, actor_id, message
       ) VALUES ($1, $2, $3, $4, NULL, 'snapshot', 'summary', $5, 1, '{}'::jsonb, $4, '旧分支摘要')
       ON CONFLICT DO NOTHING`,
      [versionNodeId, workId, branchId, userId, scopeId],
    );
    await databasePool.query(
      `INSERT INTO summary_records (
         id, work_id, branch_id, user_id, level, scope_id, chapter_id, title, content,
         status, version, content_hash, input_hash, compiler_version, model_version,
         source_ranges, from_chapter, to_chapter, generated_at
       ) VALUES (
         $1, $2, $3, $4, 'book', $5, NULL, '旧分支全书', $6,
         'fresh', 1, $7, $7, 'summary-compiler-v1', 'deterministic-summary-v1',
         $8::jsonb, 1, NULL, now()
       )`,
      [
        uuidv7(),
        workId,
        branchId,
        userId,
        scopeId,
        content,
        hash(content),
        JSON.stringify([
          {
            nodeId: scopeId,
            versionNodeId,
            objectVersion: 1,
            chapterFrom: 1,
            chapterTo: null,
          },
        ]),
      ],
    );
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
        displayName: "摘要作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function userIdFor(agent: SuperAgentTest): Promise<string> {
    const response = await agent.get("/api/v1/auth/me").expect(200);
    return response.body.data.user.id as string;
  }

  async function createWork(agent: SuperAgentTest, title: string) {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        mode: "idea",
        title,
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);
    return response.body.data as { id: string; mainBranch: { id: string } };
  }
});

function findByScope(summaries: SummaryRecord[], scopeId: string): SummaryRecord {
  const summary = summaries.find((candidate) => candidate.scopeId === scopeId);
  if (!summary) {
    throw new Error(`Summary for scope ${scopeId} was not found`);
  }
  return summary;
}

function completeBrief() {
  return {
    goal: "推进断臂后的第一次反击，并埋下顾青的怀疑。",
    pov: "沈砚",
    location: "荒寺外山道",
    sceneBeats: ["沈砚藏起断臂。", "顾青撞见书页一角。", "追兵逼近。"],
    requiredFacts: ["左臂骨折，不能双手结印"],
  };
}

function hash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function withDatabaseName(baseUrl: string, databaseName: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function withRedisDatabase(baseUrl: string, database: number): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

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
