import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import {
  GENERATE_BLUEPRINT_JOB,
  WORKER_QUEUE_NAME,
  type GenerateBlueprintJob,
  workResponseSchema,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { BlueprintJobQueue } from "../src/blueprints/blueprint.queue";
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

describe("blueprint provisioning API", () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication["getHttpServer"]>;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "blueprint-provisioning-auth-secret";
    process.env.PROXY_IP_SECRET = "blueprint-provisioning-proxy-secret";
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
    httpServer = app.getHttpServer();
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

  it("returns a deterministic blueprint estimate", async () => {
    const owner = await createAuthenticatedAgent("blueprint-estimate@example.com");
    const response = await owner
      .get("/api/v1/blueprint-estimates")
      .query({
        genre: "urban",
        scaleTarget: "short",
        chapterLengthTarget: 3000,
      })
      .expect(200);

    expect(response.body.data).toMatchObject({
      ruleVersion: "blueprint-estimate-v1",
      planned: { volumes: 1, chapters: 12, scenes: 24 },
      estimatedTokens: 40000,
      defaultBudget: { maxTokens: 48000, maxCostCny: 0.5 },
    });
    expect(response.body.data.assumptions).toHaveLength(3);
  });

  it("creates a queued blueprint job for an idea work", async () => {
    const owner = await createAuthenticatedAgent("blueprint-create@example.com");
    const csrfToken = await csrf(owner);
    const requestBody = {
      mode: "idea" as const,
      title: "忘川书",
      idea: "一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。",
      genre: "xianxia" as const,
      scaleTarget: "long" as const,
      chapterLengthTarget: 3000,
      blueprintBudget: { maxTokens: 120000, maxCostCny: 0.5 },
    };
    const response = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "idea-blueprint-create")
      .send(requestBody)
      .expect(200);
    const work = workResponseSchema.parse(response.body).data;

    const jobResult = await databasePool.query<{
      id: string;
      type: string;
      status: string;
      budget: { maxTokens: number; maxCostCny: number };
      checkpoint: { step: string };
    }>(
      `SELECT id, type, status, budget, checkpoint
         FROM jobs
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id],
    );
    expect(jobResult.rows).toHaveLength(1);
    expect(jobResult.rows[0]).toMatchObject({
      type: "generate_blueprint",
      status: "queued",
      budget: { maxTokens: 120000, maxCostCny: 0.5 },
      checkpoint: { step: "prepare" },
    });

    const blueprintResult = await databasePool.query<{
      id: string;
      job_id: string;
      status: string;
      progress: number;
      current_step: string;
    }>(
      `SELECT id, job_id, status, progress, current_step
         FROM work_blueprints
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    expect(blueprintResult.rows[0]).toMatchObject({
      job_id: jobResult.rows[0]!.id,
      status: "queued",
      progress: 0,
      current_step: "prepare",
    });

    const queue = new Queue<GenerateBlueprintJob>(WORKER_QUEUE_NAME, {
      connection: redis,
    });
    try {
      const queued = await waitForQueueJob(queue, jobResult.rows[0]!.id);
      expect(queued.data).toMatchObject({
        jobId: jobResult.rows[0]!.id,
        jobType: GENERATE_BLUEPRINT_JOB,
        workId: work.id,
        branchId: work.mainBranch.id,
        budget: { maxTokens: 120000, maxCostCny: 0.5 },
      });
    } finally {
      await queue.close();
    }

    const replay = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "idea-blueprint-create")
      .send(requestBody)
      .expect(200);
    expect(workResponseSchema.parse(replay.body).data.id).toBe(work.id);
    const replayJobs = await databasePool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM jobs
        WHERE work_id = $1 AND type = 'generate_blueprint'`,
      [work.id],
    );
    expect(replayJobs.rows[0]?.count).toBe(1);
  });

  it("reads queued blueprints and fails closed for blank or cross-tenant work", async () => {
    const owner = await createAuthenticatedAgent("blueprint-reader@example.com");
    const ideaWork = await createIdeaWork(owner, "blueprint-read");
    const blueprintPath = `/api/v1/works/${ideaWork.id}/branches/${ideaWork.mainBranch.id}/blueprint`;
    const blueprint = await owner.get(blueprintPath).expect(200);

    expect(blueprint.body.data).toMatchObject({
      workId: ideaWork.id,
      branchId: ideaWork.mainBranch.id,
      status: "queued",
      progress: 0,
      currentStep: "prepare",
    });
    expect(blueprint.body.data.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );

    const csrfToken = await csrf(owner);
    const blankResponse = await owner
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", "blank-no-blueprint")
      .send({ mode: "blank", title: "空白无蓝图" })
      .expect(200);
    const blankWork = workResponseSchema.parse(blankResponse.body).data;
    const blank = await owner
      .get(`/api/v1/works/${blankWork.id}/branches/${blankWork.mainBranch.id}/blueprint`)
      .expect(404);
    expect(blank.body.error.code).toBe("BLUEPRINT_NOT_FOUND");

    const outsider = await createAuthenticatedAgent("blueprint-outsider@example.com");
    const forbidden = await outsider.get(blueprintPath).expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("retries queue delivery from the persisted queued state", async () => {
    const owner = await createAuthenticatedAgent("blueprint-queue-retry@example.com");
    const queue = app.get(BlueprintJobQueue);
    const enqueue = vi.spyOn(queue, "enqueue").mockRejectedValueOnce(new Error("redis down"));
    try {
      const work = await createIdeaWork(owner, "blueprint-retry");
      const response = await owner
        .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`)
        .expect(200);
      expect(response.body.data.status).toBe("queued");
      expect(response.body.data.jobId).toBeTruthy();
      expect(enqueue).toHaveBeenCalledTimes(1);

      const csrfToken = await csrf(owner);
      const retried = await owner
        .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint/retry`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .expect(202);
      expect(retried.body.data.jobId).toBe(response.body.data.jobId);
      expect(enqueue).toHaveBeenCalledTimes(2);

      const queueJob = new Queue<GenerateBlueprintJob>(WORKER_QUEUE_NAME, {
        connection: redis,
      });
      try {
        const queued = await waitForQueueJob(queueJob, retried.body.data.jobId as string);
        expect(queued.data.jobId).toBe(retried.body.data.jobId);
      } finally {
        await queueJob.close();
      }
    } finally {
      enqueue.mockRestore();
    }
  });

  it("requeues a failed blueprint from its persisted checkpoint", async () => {
    const owner = await createAuthenticatedAgent("blueprint-failed-retry@example.com");
    const work = await createIdeaWork(owner, "blueprint-failed-retry");
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const before = await owner.get(blueprintPath).expect(200);
    await databasePool.query(
      `UPDATE jobs
          SET status = 'failed', checkpoint_version = 2,
              checkpoint = $3::jsonb, error_code = 'MODEL_RATE_LIMITED',
              error_message = '限流'
        WHERE id = $1 AND user_id = (SELECT user_id FROM works WHERE id = $2)`,
      [
        before.body.data.jobId,
        work.id,
        JSON.stringify({
          schemaVersion: 1,
          revision: 2,
          step: "core_settings",
          inputHash: "a".repeat(64),
          payload: { storyBibleReady: true },
        }),
      ],
    );
    await databasePool.query(
      `UPDATE work_blueprints
          SET status = 'failed', current_step = 'core_settings', progress = 35
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );

    const csrfToken = await csrf(owner);
    const retried = await owner
      .post(`${blueprintPath}/retry`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(202);
    expect(retried.body.data).toMatchObject({
      status: "queued",
      currentStep: "core_settings",
    });

    const persisted = await databasePool.query<{ job_status: string; blueprint_status: string }>(
      `SELECT j.status AS job_status, wb.status AS blueprint_status
         FROM jobs AS j
         INNER JOIN work_blueprints AS wb ON wb.job_id = j.id
        WHERE j.id = $1`,
      [before.body.data.jobId],
    );
    expect(persisted.rows[0]).toEqual({
      job_status: "queued",
      blueprint_status: "queued",
    });
  });

  it("uses the estimated default budget when no override is supplied", async () => {
    const owner = await createAuthenticatedAgent("blueprint-default-budget@example.com");
    const work = await createIdeaWork(owner, "blueprint-default-budget", null);
    const result = await databasePool.query<{
      budget: { maxTokens: number; maxCostCny: number };
      model_config_id: string | null;
    }>(
      `SELECT budget, model_config_id
         FROM jobs
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id],
    );

    expect(result.rows[0]?.budget).toEqual({ maxTokens: 216000, maxCostCny: 1 });
    expect(result.rows[0]?.model_config_id).toBeNull();
  });

  it("does not enqueue an orphan job during a concurrent idempotent replay", async () => {
    const owner = await createAuthenticatedAgent("blueprint-concurrent@example.com");
    const csrfToken = await csrf(owner);
    const requestBody = {
      mode: "idea" as const,
      title: "并发蓝图",
      idea: "一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。",
      genre: "xianxia" as const,
      scaleTarget: "short" as const,
      chapterLengthTarget: 3000,
    };
    const send = () =>
      owner
        .post("/api/v1/works")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .set("Idempotency-Key", "concurrent-idea-blueprint")
        .send(requestBody)
        .expect(200);
    const [first, second] = await Promise.all([send(), send()]);
    const works = [
      workResponseSchema.parse(first.body).data,
      workResponseSchema.parse(second.body).data,
    ];
    expect(works[0]!.id).toBe(works[1]!.id);

    const jobResult = await databasePool.query<{ id: string; count: number }>(
      `SELECT min(id::text) AS id, count(*)::int AS count
         FROM jobs
        WHERE user_id = (SELECT user_id FROM works WHERE id = $1)
          AND type = 'generate_blueprint'`,
      [works[0]!.id],
    );
    expect(jobResult.rows[0]?.count).toBe(1);

    const queue = new Queue<GenerateBlueprintJob>(WORKER_QUEUE_NAME, {
      connection: redis,
    });
    try {
      const jobs = await queue.getJobs(["waiting", "delayed", "active", "completed", "failed"]);
      expect(jobs.filter((job) => job.data.jobType === GENERATE_BLUEPRINT_JOB)).toHaveLength(1);
    } finally {
      await queue.close();
    }
  });

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
    const agent = request.agent(httpServer);
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
        displayName: "蓝图作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createIdeaWork(
    agent: SuperAgentTest,
    idempotencyKey: string,
    blueprintBudget: { maxTokens: number; maxCostCny: number } | null = {
      maxTokens: 120000,
      maxCostCny: 0.5,
    },
  ) {
    const csrfToken = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        mode: "idea",
        title: "忘川书",
        idea: "一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
        ...(blueprintBudget ? { blueprintBudget } : {}),
      })
      .expect(200);
    return workResponseSchema.parse(response.body).data;
  }
});

async function waitForQueueJob(
  queue: Queue<GenerateBlueprintJob>,
  jobId: string,
): Promise<NonNullable<Awaited<ReturnType<Queue<GenerateBlueprintJob>["getJob"]>>>> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const job = await queue.getJob(jobId);
    if (job) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Queued blueprint job ${jobId} was not found`);
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const adminUrl = new URL(url);
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
