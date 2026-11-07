import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  batchPlanResponseSchema,
  type BatchPlanSummary,
  type BatchWorkItem,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { BatchPlanRepository } from "../src/batch-plan/batch-plan.repository";
import { BatchPlanService } from "../src/batch-plan/batch-plan.service";
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

describe("batch plan integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "batch-plan-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "batch-plan-integration-proxy-secret";
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

  it("persists, replays and pages a tenant-scoped plan without loading chapter payloads", async () => {
    const owner = await createAuthenticatedAgent("batch-plan-owner@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = branchPathOf(work);
    const outlinePath = `${branchPath}/outline`;
    const book = await createNode(owner, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "批量测试书",
    });
    const volumes = [];
    const chapterIds: string[] = [];
    for (let index = 1; index <= 2; index += 1) {
      const volume = await createNode(owner, token, outlinePath, {
        level: "volume",
        parentId: book.id,
        title: `第${index}卷`,
      });
      volumes.push(volume);
      const act = await createNode(owner, token, outlinePath, {
        level: "act",
        parentId: volume.id,
        title: `第${index}卷第一幕`,
      });
      for (let chapter = 1; chapter <= 3; chapter += 1) {
        const chapterNode = await createNode(owner, token, outlinePath, {
          level: "chapter",
          parentId: act.id,
          chapterCreate: {
            number: (index - 1) * 3 + chapter,
            title: `第${(index - 1) * 3 + chapter}章`,
            brief: completeBrief((index - 1) * 3 + chapter),
          },
        });
        chapterIds.push(chapterNode.chapter?.id as string);
      }
    }

    const idempotencyKey = "batch-plan-small";
    const first = await postPlan(owner, branchPath, token, idempotencyKey, { type: "book" });
    expect(first.status).toBe(202);
    const plan = batchPlanResponseSchema.parse(first.body).data;
    expect(plan.counts).toMatchObject({
      total: 1 + 2 + 6 + 6 * 7,
      book: 1,
      volume: 2,
      chapter: 6,
      step: 42,
    });
    expect(plan.scheduling).toMatchObject({
      caps: { global: 4, perWork: 2, perUser: 2 },
      effectivePerWork: 2,
      priority: 100,
      initialRunnableKeys: expect.arrayContaining([expect.stringMatching(/^step:/)]),
    });
    expect(plan.jobId).toBe(plan.id);
    expect(plan.scheduling.initialRunnableKeys).toHaveLength(2);

    const volumePlan = await postPlan(owner, branchPath, token, "batch-plan-volume-ok", {
      type: "volume",
      volumeNodeIds: [volumes[0]!.id],
    });
    expect(batchPlanResponseSchema.parse(volumePlan.body).data.counts).toMatchObject({
      total: 1 + 1 + 3 + 21,
      volume: 1,
      chapter: 3,
      step: 21,
    });
    const rangePlan = await postPlan(owner, branchPath, token, "batch-plan-range-ok", {
      type: "range",
      fromChapterNumber: 1,
      toChapterNumber: 3,
    });
    expect(batchPlanResponseSchema.parse(rangePlan.body).data.counts).toMatchObject({
      total: 1 + 1 + 3 + 21,
      volume: 1,
      chapter: 3,
      step: 21,
    });
    const chapterPlan = await postPlan(owner, branchPath, token, "batch-plan-chapter-ok", {
      type: "chapter",
      chapterIds: chapterIds.slice(0, 2),
    });
    expect(batchPlanResponseSchema.parse(chapterPlan.body).data.counts).toMatchObject({
      total: 1 + 1 + 2 + 14,
      volume: 1,
      chapter: 2,
      step: 14,
    });

    const replay = await postPlan(owner, branchPath, token, idempotencyKey, { type: "book" });
    expect(replay.status).toBe(202);
    expect(replay.body.meta.replayed).toBe(true);
    expect(batchPlanResponseSchema.parse(replay.body).data.id).toBe(plan.id);

    const jobCount = await tenantQuery<{ count: string }>(
      plan.userId,
      "SELECT count(*)::text AS count FROM jobs WHERE user_id = $1 AND id = $2 AND type = 'batch_plan'",
      [plan.userId, plan.id],
    );
    expect(jobCount.rows[0]?.count).toBe("1");

    const pageOne = await owner
      .get(`${branchPath}/batch-plans/${plan.id}/items?limit=5`)
      .expect(200);
    expect(pageOne.body.data).toHaveLength(5);
    expect(pageOne.body.data[0]).toMatchObject({ type: "book", key: "book", parentKey: null });
    expect(pageOne.body.data[0]).not.toHaveProperty("content");
    expect(pageOne.body.meta.nextCursor).toEqual(expect.any(String));
    const pageTwo = await owner
      .get(
        `${branchPath}/batch-plans/${plan.id}/items?limit=5&cursor=${pageOne.body.meta.nextCursor}`,
      )
      .expect(200);
    expect(pageTwo.body.data).toHaveLength(5);
    expect(pageTwo.body.data[0]?.sortOrder).toBeGreaterThan(pageOne.body.data[4]?.sortOrder);

    const steps = await owner
      .get(`${branchPath}/batch-plans/${plan.id}/items?type=step&limit=100`)
      .expect(200);
    expect(steps.body.data.every((item: BatchWorkItem) => item.type === "step")).toBe(true);

    const conflicting = await postPlan(owner, branchPath, token, idempotencyKey, {
      type: "volume",
      volumeNodeIds: [volumes[0]!.id],
    });
    expect(conflicting.status).toBe(409);
    expect(conflicting.body.error.code).toBe("BATCH_PLAN_IDEMPOTENCY_CONFLICT");

    const restartedRepository = new BatchPlanRepository();
    const restartedService = new BatchPlanService(restartedRepository);
    try {
      const restarted = await restartedService.get(
        plan.userId,
        {
          workId: plan.workId,
          branchId: plan.branchId,
        },
        plan.id,
      );
      expect(restarted.id).toBe(plan.id);
      expect(restarted.counts.total).toBe(plan.counts.total);
      const restartedPage = await restartedService.listItems(
        plan.userId,
        { workId: plan.workId, branchId: plan.branchId },
        plan.id,
        { limit: 3 },
      );
      expect(restartedPage.items).toHaveLength(3);
      expect(restartedPage.items[0]?.key).toBe("book");
    } finally {
      await restartedRepository.onModuleDestroy();
    }

    const other = await createAuthenticatedAgent("batch-plan-other@example.com");
    await other.get(`${branchPath}/batch-plans/${plan.id}`).expect(404);
    const otherToken = await csrf(other);
    const crossWrite = await postPlan(other, branchPath, otherToken, "batch-plan-cross-tenant", {
      type: "book",
    });
    expect(crossWrite.status).toBe(404);
    expect(crossWrite.body.error.code).toBe("BATCH_PLAN_NOT_FOUND");
  });

  it("rejects non-continuous ranges and invalid volumes before persisting a plan", async () => {
    const owner = await createAuthenticatedAgent("batch-plan-invalid@example.com");
    const work = await createWork(owner, "批量非法范围");
    const token = await csrf(owner);
    const branchPath = branchPathOf(work);
    const outlinePath = `${branchPath}/outline`;
    const book = await createNode(owner, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "非法范围书",
    });
    const volume = await createNode(owner, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第一卷",
    });
    const act = await createNode(owner, token, outlinePath, {
      level: "act",
      parentId: volume.id,
      title: "第一幕",
    });
    for (const number of [1, 2, 4]) {
      await createNode(owner, token, outlinePath, {
        level: "chapter",
        parentId: act.id,
        chapterCreate: {
          number,
          title: `第${number}章`,
          brief: completeBrief(number),
        },
      });
    }

    const range = await postPlan(owner, branchPath, token, "batch-plan-gap", {
      type: "range",
      fromChapterNumber: 1,
      toChapterNumber: 4,
    });
    expect(range.status).toBe(400);
    expect(range.body.error.code).toBe("BATCH_PLAN_INVALID");
    expect(range.body.error.details.missingChapterNumbers).toContain(3);

    const uncommitted = await postPlan(owner, branchPath, token, "batch-plan-canon", {
      type: "range",
      fromChapterNumber: 2,
      toChapterNumber: 2,
    });
    expect(uncommitted.status).toBe(400);
    expect(uncommitted.body.error.details.uncommittedChapterNumbers).toContain(1);

    const invalidVolume = await postPlan(owner, branchPath, token, "batch-plan-volume", {
      type: "volume",
      volumeNodeIds: [uuidv7()],
    });
    expect(invalidVolume.status).toBe(400);
    expect(invalidVolume.body.error.code).toBe("BATCH_PLAN_INVALID");
  });

  it("creates a bounded 4,000-chapter plan concurrently and keeps one idempotent root job", async () => {
    const owner = await createAuthenticatedAgent("batch-plan-max@example.com");
    const work = await createWork(owner, "四千章压力书");
    const token = await csrf(owner);
    const branchPath = branchPathOf(work);
    const userId = await userIdFor(owner);
    await seedMaximumOutline(databasePool, {
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
    });

    const idempotencyKey = "batch-plan-max";
    const responses = await Promise.all([
      postPlan(owner, branchPath, token, idempotencyKey, { type: "book" }),
      postPlan(owner, branchPath, token, idempotencyKey, { type: "book" }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([202, 202]);
    const plans = responses.map((response) => batchPlanResponseSchema.parse(response.body).data);
    expect(plans[0]?.id).toBe(plans[1]?.id);
    const plan = plans[0] as BatchPlanSummary;
    expect(plan.counts).toMatchObject({
      total: 1 + 40 + 4_000 + 4_000 * 7,
      book: 1,
      volume: 40,
      chapter: 4_000,
      step: 28_000,
    });

    const jobCount = await tenantQuery<{ count: string }>(
      userId,
      "SELECT count(*)::text AS count FROM jobs WHERE user_id = $1 AND type = 'batch_plan'",
      [userId],
    );
    expect(jobCount.rows[0]?.count).toBe("1");
    const itemCount = await tenantQuery<{ count: string }>(
      userId,
      "SELECT count(*)::text AS count FROM job_work_items WHERE job_id = $1",
      [plan.id],
    );
    expect(itemCount.rows[0]?.count).toBe(String(plan.counts.total));

    const firstPage = await owner
      .get(`${branchPath}/batch-plans/${plan.id}/items?limit=1`)
      .expect(200);
    expect(firstPage.body.data[0]).toMatchObject({ type: "book", key: "book" });
    expect(firstPage.body.data[0]).not.toHaveProperty("content");
  }, 60_000);

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
        displayName: "批量作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createWork(agent: SuperAgentTest, title = "编排测试书") {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", uuidv7())
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

  async function userIdFor(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
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
    if (response.status !== 201) {
      throw new Error(`Outline node creation failed: ${JSON.stringify(response.body)}`);
    }
    return response.body.data.node as {
      id: string;
      version: number;
      sortOrder: number;
      chapter?: { id: string };
    };
  }

  function postPlan(
    agent: SuperAgentTest,
    branchPath: string,
    token: string,
    idempotencyKey: string,
    scope: Record<string, unknown>,
  ) {
    return agent
      .post(`${branchPath}/batch-plans`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", idempotencyKey)
      .send({ scope, approvalMode: "per_volume", priorityClass: "batch", maxConcurrency: 2 });
  }

  function branchPathOf(work: { id: string; mainBranch: { id: string } }): string {
    return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  }

  async function tenantQuery<T extends Record<string, unknown>>(
    userId: string,
    sql: string,
    values: unknown[] = [],
  ) {
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await client.query<T>(sql, values);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
});

function completeBrief(number: number) {
  return {
    goal: `推进第${number}章目标`,
    pov: "沈砚",
    location: "山门",
    sceneBeats: ["发现线索", "做出选择"],
    requiredFacts: ["沈砚左臂受伤"],
  };
}

async function seedMaximumOutline(
  pool: ReturnType<typeof createDatabasePool>,
  input: { userId: string; workId: string; branchId: string },
): Promise<void> {
  const bookNodeId = uuidv7();
  const versionNodeId = uuidv7();
  const volumeIds = Array.from({ length: 40 }, () => uuidv7());
  const chapterIds = Array.from({ length: 4_000 }, () => uuidv7());
  const chapterNodeIds = Array.from({ length: 4_000 }, () => uuidv7());
  const chapterNumbers = Array.from({ length: 4_000 }, (_, index) => index + 1);
  const chapterSortOrders = Array.from({ length: 4_000 }, (_, index) => (index % 100) + 1);
  const chapterVolumeIds = Array.from(
    { length: 4_000 },
    (_, index) => volumeIds[Math.floor(index / 100)]!,
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [input.userId]);
    await client.query(
      `INSERT INTO version_nodes (
       id, work_id, branch_id, user_id, parent_node_id, node_type, snapshot_id,
       object_type, object_id, object_version, payload, actor_id, message, created_at
     ) VALUES ($1, $2, $3, $4, NULL, 'outline_version', NULL, 'outline', $5, 1,
       '{}'::jsonb, $4, 'batch plan maximum fixture', now())`,
      [versionNodeId, input.workId, input.branchId, input.userId, bookNodeId],
    );
    await client.query(
      `INSERT INTO outline_nodes (
       id, work_id, branch_id, user_id, level, parent_id, sort_order, title, summary,
       status, locked, version, chapter_id, tension, version_node_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 'book', NULL, 0, '四千章压力书', '批量计划夹具',
       'planned', false, 1, NULL, NULL, $5, now(), now())`,
      [bookNodeId, input.workId, input.branchId, input.userId, versionNodeId],
    );
    await client.query(
      `INSERT INTO outline_nodes (
       id, work_id, branch_id, user_id, level, parent_id, sort_order, title, summary,
       status, locked, version, chapter_id, tension, version_node_id, created_at, updated_at
     ) SELECT volume_id, $2, $3, $4, 'volume', $1, volume_number, '第' || volume_number || '卷',
       '', 'planned', false, 1, NULL, NULL, $5, now(), now()
       FROM unnest($6::uuid[], $7::integer[]) AS fixture(volume_id, volume_number)`,
      [
        bookNodeId,
        input.workId,
        input.branchId,
        input.userId,
        versionNodeId,
        volumeIds,
        Array.from({ length: 40 }, (_, index) => index + 1),
      ],
    );
    await client.query(
      `INSERT INTO chapters (
       id, work_id, branch_id, user_id, number, title, status, version,
       current_version_id, word_count, brief, created_at, updated_at
     ) SELECT chapter_id, $2, $3, $4, chapter_number, '第' || chapter_number || '章',
       'planned', 1, NULL, 0, '{}'::jsonb, now(), now()
       FROM unnest($1::uuid[], $5::integer[]) AS fixture(chapter_id, chapter_number)`,
      [chapterIds, input.workId, input.branchId, input.userId, chapterNumbers],
    );
    await client.query(
      `INSERT INTO outline_nodes (
       id, work_id, branch_id, user_id, level, parent_id, sort_order, title, summary,
       status, locked, version, chapter_id, tension, version_node_id, created_at, updated_at
     ) SELECT node_id, $2, $3, $4, 'chapter', volume_id, sort_order,
       '第' || chapter_number || '章', '', 'planned', false, 1, chapter_id, NULL, $5, now(), now()
       FROM unnest($1::uuid[], $6::uuid[], $7::uuid[], $8::integer[], $9::integer[])
         AS fixture(node_id, chapter_id, volume_id, sort_order, chapter_number)`,
      [
        chapterNodeIds,
        input.workId,
        input.branchId,
        input.userId,
        versionNodeId,
        chapterIds,
        chapterVolumeIds,
        chapterSortOrders,
        chapterNumbers,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
