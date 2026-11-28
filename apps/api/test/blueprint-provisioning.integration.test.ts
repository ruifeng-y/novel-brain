import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import {
  GENERATE_BLUEPRINT_JOB,
  STORY_BIBLE_CARD_KEYS,
  STORY_BIBLE_CARD_TITLES,
  WORKER_QUEUE_NAME,
  type GenerateBlueprintJob,
  workBlueprintResponseSchema,
  workResponseSchema,
} from "@novel-brain/contracts";
import { Queue } from "bullmq";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
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
      budget: { maxTokens: 120000, maxCostCny: 0.5 },
      allowedActions: ["retry", "cancel"],
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
      const retryAudit = await databasePool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM audit_logs
          WHERE action = 'blueprint.retried'
            AND target_type = 'work_blueprint'
            AND target_id = (
              SELECT id FROM work_blueprints WHERE work_id = $1 AND branch_id = $2
            )`,
        [work.id, work.mainBranch.id],
      );
      expect(retryAudit.rows[0]?.count).toBe(1);

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
    const failed = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    expect(failed.allowedActions).toEqual(["retry"]);

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

  it("refreshes the planning model when recovering a waiting blueprint", async () => {
    const owner = await createAuthenticatedAgent("blueprint-model-recovery@example.com");
    const work = await createIdeaWork(owner, "blueprint-model-recovery", null);
    const created = await databasePool.query<{ job_id: string; user_id: string }>(
      `SELECT wb.job_id, wb.user_id
         FROM work_blueprints AS wb
        WHERE wb.work_id = $1 AND wb.branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    const jobId = created.rows[0]!.job_id;
    const userId = created.rows[0]!.user_id;
    const modelConfigId = (
      await databasePool.query<{ id: string }>(
        `INSERT INTO model_configs
           (id, user_id, provider, label, base_url, model, purposes, encrypted_key,
            key_masked, is_default)
         VALUES (gen_random_uuid(), $1, 'deepseek', '规划模型',
                 'https://api.deepseek.com', 'deepseek-chat',
                 '["planning"]'::jsonb, 'encrypted', 'sk-****', true)
         RETURNING id`,
        [userId],
      )
    ).rows[0]!.id;
    await databasePool.query(
      `UPDATE jobs
          SET status = 'paused', model_config_id = NULL,
              error_code = 'MODEL_PROVIDER_ERROR'
        WHERE id = $1`,
      [jobId],
    );
    await databasePool.query(
      `UPDATE work_blueprints
          SET status = 'waiting_model_config'
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );

    const csrfToken = await csrf(owner);
    await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint/retry`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(202);

    const queue = new Queue<GenerateBlueprintJob>(WORKER_QUEUE_NAME, {
      connection: redis,
    });
    try {
      const queued = await waitForQueueJob(queue, jobId);
      expect(queued.data.modelConfigId).toBe(modelConfigId);
    } finally {
      await queue.close();
    }
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

  it("does not fall back to a writing-only model for blueprint planning", async () => {
    const owner = await createAuthenticatedAgent("blueprint-planning-model@example.com");
    await databasePool.query(
      `INSERT INTO model_configs
         (id, user_id, provider, label, base_url, model, purposes, encrypted_key,
          key_masked, is_default)
       SELECT $2, id, 'deepseek', '写作模型',
              'https://api.deepseek.com', 'deepseek-chat',
              '["writing"]'::jsonb, 'encrypted', 'sk-****', true
         FROM users WHERE email = $1`,
      ["blueprint-planning-model@example.com", uuidv7()],
    );

    const work = await createIdeaWork(owner, "blueprint-writing-only", null);
    const result = await databasePool.query<{ model_config_id: string | null }>(
      `SELECT model_config_id
         FROM jobs
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id],
    );

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

  it("updates the reviewed draft with an expected version and recomputes its hash", async () => {
    const owner = await createAuthenticatedAgent("blueprint-draft@example.com");
    const work = await createIdeaWork(owner, "blueprint-draft");
    await seedWaitingBlueprint(work, databasePool);
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);
    const original = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    const originalReplay = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    expect(originalReplay.draftHash).toBe(original.draftHash);

    const patched = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 1,
        operations: [
          {
            op: "replace",
            path: "/storyBible/cards/0/content",
            value: "一名被逐出宗门的杂役追查会吞噬记忆的古书。",
          },
        ],
      })
      .expect(200);

    const blueprint = workBlueprintResponseSchema.parse(patched.body).data;
    expect(blueprint).toMatchObject({
      status: "waiting_review",
      version: 2,
    });
    expect(blueprint.storyBibleDraft?.cards[0]?.content).toBe(
      "一名被逐出宗门的杂役追查会吞噬记忆的古书。",
    );
    expect(blueprint.draftHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(blueprint.draftHash).not.toBe(original.draftHash);

    const formalObjects = await databasePool.query<{
      locked_bibles: number;
      locked_settings: number;
      chapters: number;
      outline_nodes: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM story_bibles WHERE work_id = $1 AND status = 'locked')
           AS locked_bibles,
         (SELECT count(*)::int FROM entities WHERE work_id = $1 AND status = 'locked')
           AS locked_settings,
         (SELECT count(*)::int FROM chapters WHERE work_id = $1) AS chapters,
         (SELECT count(*)::int FROM outline_nodes WHERE work_id = $1) AS outline_nodes`,
      [work.id],
    );
    expect(formalObjects.rows[0]).toEqual({
      locked_bibles: 0,
      locked_settings: 0,
      chapters: 0,
      outline_nodes: 0,
    });

    const stale = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 1,
        operations: [{ op: "replace", path: "/storyBible/cards/1/content", value: "过期写入" }],
      })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");

    const requiredRemoval = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 2,
        operations: [{ op: "remove", path: "/coreSettings/0" }],
      })
      .expect(400);
    expect(requiredRemoval.body.error.code).toBe("VALIDATION_INVALID");

    const broadReplacement = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 2,
        operations: [
          {
            op: "replace",
            path: "/storyBible",
            value: validStoryBibleDraft(),
          },
        ],
      })
      .expect(400);
    expect(broadReplacement.body.error.code).toBe("VALIDATION_INVALID");

    const requiredFlagChange = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 2,
        operations: [
          {
            op: "replace",
            path: "/coreSettings/0/required",
            value: false,
          },
        ],
      })
      .expect(400);
    expect(requiredFlagChange.body.error.code).toBe("VALIDATION_INVALID");

    const wholeSettingReplacement = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 2,
        operations: [
          {
            op: "replace",
            path: "/coreSettings/0",
            value: { ...validCoreSettingsDraft()[0], required: false },
          },
        ],
      })
      .expect(400);
    expect(wholeSettingReplacement.body.error.code).toBe("VALIDATION_INVALID");

    const wholeOutlineNodeReplacement = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 2,
        operations: [
          {
            op: "replace",
            path: "/outline/nodes/0",
            value: { ...validOutlineDraft().nodes[0]!, id: uuidv7() },
          },
        ],
      })
      .expect(400);
    expect(wholeOutlineNodeReplacement.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("confirms a reviewed blueprint atomically and idempotently", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm");
    await seedWaitingBlueprint(work, databasePool);
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);
    const before = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    expect(before.draftHash).toMatch(/^[0-9a-f]{64}$/u);

    const beforeCounts = await formalObjectCounts(databasePool, work.id);
    expect(beforeCounts).toEqual({
      story_bibles: 0,
      story_bible_versions: 0,
      entities: 0,
      entity_versions: 0,
      outline_nodes: 0,
      volume_contracts: 0,
      scene_cards: 0,
      chapters: 0,
      chapter_versions: 0,
      character_profiles: 0,
      faction_profiles: 0,
      map_layers: 0,
      power_systems: 0,
      special_mechanisms: 0,
      item_techniques: 0,
      timeline_events: 0,
      character_profiles: 0,
      faction_profiles: 0,
      map_layers: 0,
      power_systems: 0,
      special_mechanisms: 0,
      item_techniques: 0,
      timeline_events: 0,
    });

    const confirmation = {
      expectedVersion: before.version,
      draftHash: before.draftHash,
      acknowledgements: [],
      confirmed: true,
    };
    const first = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send(confirmation)
      .expect(200);
    const confirmed = workBlueprintResponseSchema.parse(first.body).data;
    expect(confirmed).toMatchObject({
      status: "confirmed",
      confirmedBy: expect.any(String),
      confirmedAt: expect.any(String),
    });

    const second = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send(confirmation)
      .expect(200);
    expect(workBlueprintResponseSchema.parse(second.body).data).toEqual(confirmed);

    const changedHash = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ ...confirmation, draftHash: "b".repeat(64) })
      .expect(409);
    expect(changedHash.body.error.code).toBe("VERSION_CONFLICT");

    const editAfterConfirmation = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: confirmed.version,
        operations: [
          {
            op: "replace",
            path: "/storyBible/cards/0/content",
            value: "确认后不应再编辑。",
          },
        ],
      })
      .expect(400);
    expect(editAfterConfirmation.body.error.code).toBe("VALIDATION_INVALID");

    const budgetAfterConfirmation = await owner
      .post(`${blueprintPath}/budget`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: confirmed.version,
        maxTokens: 120000,
        maxCostCny: 0.5,
      })
      .expect(400);
    expect(budgetAfterConfirmation.body.error.code).toBe("VALIDATION_INVALID");

    const cancelAfterConfirmation = await owner
      .post(`${blueprintPath}/cancel`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ expectedVersion: confirmed.version })
      .expect(400);
    expect(cancelAfterConfirmation.body.error.code).toBe("VALIDATION_INVALID");

    const afterCounts = await formalObjectCounts(databasePool, work.id);
    expect(afterCounts).toEqual({
      story_bibles: 1,
      story_bible_versions: 1,
      entities: before.coreSettingsDraft.length,
      entity_versions: before.coreSettingsDraft.length,
      outline_nodes: before.outlineDraft?.nodes.length,
      volume_contracts: before.outlineDraft?.volumeContracts.length,
      scene_cards: before.outlineDraft?.sceneCards.length,
      chapters: before.outlineDraft?.nodes.filter((node) => node.level === "chapter").length,
      chapter_versions: 0,
      character_profiles: 1,
      faction_profiles: 1,
      map_layers: 1,
      power_systems: 1,
      special_mechanisms: 1,
      item_techniques: 1,
      timeline_events: 1,
    });

    const locked = await databasePool.query<{ story_bibles: number; entities: number }>(
      `SELECT
         (SELECT count(*)::int FROM story_bibles
           WHERE work_id = $1 AND branch_id = $2 AND status = 'locked') AS story_bibles,
         (SELECT count(*)::int FROM entities
           WHERE work_id = $1 AND branch_id = $2 AND status = 'locked') AS entities`,
      [work.id, work.mainBranch.id],
    );
    expect(locked.rows[0]).toEqual({
      story_bibles: 1,
      entities: before.coreSettingsDraft.length,
    });
    const draftWorldRuleIds =
      before.storyBibleDraft?.cards
        .find((card) => card.key === "worldLaws")
        ?.worldRules.map((rule) => rule.id) ?? [];
    const persistedWorldRuleIds = await databasePool.query<{ id: string }>(
      `SELECT id FROM story_bible_world_rules WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    expect(persistedWorldRuleIds.rows).toHaveLength(draftWorldRuleIds.length);
    expect(persistedWorldRuleIds.rows.map((rule) => rule.id)).not.toEqual(
      expect.arrayContaining(draftWorldRuleIds),
    );

    const head = await databasePool.query<{ node_type: string; parent_node_id: string | null }>(
      `SELECT vn.node_type, vn.parent_node_id
         FROM work_branches AS wb
         INNER JOIN version_nodes AS vn ON vn.id = wb.head_node_id
        WHERE wb.id = $1 AND wb.work_id = $2`,
      [work.mainBranch.id, work.id],
    );
    expect(head.rows[0]).toEqual({
      node_type: "blueprint_version",
      parent_node_id: expect.any(String),
    });

    const versionCounts = await databasePool.query<Record<string, number>>(
      `SELECT
         count(*) FILTER (WHERE node_type = 'story_bible_version')::int AS story_bible_versions,
         count(*) FILTER (WHERE node_type = 'entity_version')::int AS entity_versions,
         count(*) FILTER (WHERE node_type = 'outline_version')::int AS outline_versions,
         count(*) FILTER (WHERE node_type = 'blueprint_version')::int AS blueprint_versions
       FROM version_nodes
       WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    expect(versionCounts.rows[0]).toEqual({
      story_bible_versions: 1,
      entity_versions: before.coreSettingsDraft.length,
      outline_versions: 1,
      blueprint_versions: 1,
    });
  });

  it("blocks confirmation for unresolved P0 conflicts", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-p0@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-p0");
    const storyBible = validStoryBibleDraft();
    storyBible.cards[0]!.content = "主角意外获得现代枪械体系作为底牌。";
    await seedWaitingBlueprint(work, databasePool, {
      storyBible,
      conflicts: [
        {
          id: uuidv7(),
          severity: "P0",
          title: "题材禁用元素",
          detail: "蓝图包含题材禁用元素：现代枪械体系",
          affectedKeys: ["forbidden_element"],
          status: "open",
        },
      ],
    });
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const blueprint = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    expect(blueprint.allowedActions).not.toContain("confirm");
    const csrfToken = await csrf(owner);

    const blocked = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: blueprint.version,
        draftHash: blueprint.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(409);
    expect(blocked.body.error.code).toBe("BLUEPRINT_P0_CONFLICT");
    expect(await formalObjectCounts(databasePool, work.id)).toMatchObject({
      story_bibles: 0,
      entities: 0,
      outline_nodes: 0,
      chapters: 0,
    });

    const patched = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: blueprint.version,
        operations: [
          {
            op: "replace",
            path: "/storyBible/cards/0/content",
            value: "主角意外获得残卷，但每次使用都要付出记忆代价。",
          },
        ],
      })
      .expect(200);
    const ready = workBlueprintResponseSchema.parse(patched.body).data;
    expect(ready.conflicts).toEqual([]);

    const confirmed = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: ready.version,
        draftHash: ready.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(200);
    expect(workBlueprintResponseSchema.parse(confirmed.body).data.status).toBe("confirmed");
  });

  it("requires persisted not_applicable acknowledgements for required missing fields", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-missing@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-missing");
    const coreSettings = validCoreSettingsDraft();
    coreSettings[0]!.data = Object.fromEntries(
      Object.entries(coreSettings[0]!.data).filter(([key]) => key !== "genre"),
    );
    await seedWaitingBlueprint(work, databasePool, {
      coreSettings,
      missingFields: [
        {
          key: "genre_pack:genre",
          label: "genre",
          required: true,
          severity: "P0",
          message: "题材包必填字段 genre 未在蓝图中体现",
        },
      ],
    });
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);
    const before = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    expect(before.allowedActions).not.toContain("confirm");

    const blocked = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: before.version,
        draftHash: before.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(400);
    expect(blocked.body.error.code).toBe("BLUEPRINT_REQUIRED_FIELD_MISSING");

    const acknowledgement = {
      fieldKey: "genre_pack:genre",
      decision: "not_applicable" as const,
      reason: "本作暂不声明题材字段。",
    };
    const patched = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: before.version,
        operations: [
          {
            op: "replace",
            path: "/acknowledgements",
            value: [acknowledgement],
          },
        ],
      })
      .expect(200);
    const ready = workBlueprintResponseSchema.parse(patched.body).data;

    const confirmed = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: ready.version,
        draftHash: ready.draftHash,
        acknowledgements: [acknowledgement],
        confirmed: true,
      })
      .expect(200);
    expect(workBlueprintResponseSchema.parse(confirmed.body).data).toMatchObject({
      status: "confirmed",
      acknowledgements: [acknowledgement],
    });
  });

  it("does not waive required xianxia core settings through not_applicable", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-core-gate@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-core-gate");
    await seedWaitingBlueprint(work, databasePool, {
      coreSettings: validCoreSettingsDraft().filter(
        (candidate) => candidate.type !== "golden_finger",
      ),
    });
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);
    const before = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    const acknowledgement = {
      fieldKey: "core_setting:golden_finger",
      decision: "not_applicable" as const,
      reason: "本作不使用金手指。",
    };
    const patched = await owner
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: before.version,
        operations: [
          {
            op: "replace",
            path: "/acknowledgements",
            value: [acknowledgement],
          },
        ],
      })
      .expect(200);
    const ready = workBlueprintResponseSchema.parse(patched.body).data;

    const blocked = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: ready.version,
        draftHash: ready.draftHash,
        acknowledgements: [acknowledgement],
        confirmed: true,
      })
      .expect(400);
    expect(blocked.body.error.code).toBe("BLUEPRINT_REQUIRED_FIELD_MISSING");
  });

  it("rejects an outline that no longer matches the opening blueprint baseline", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-baseline@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-baseline");
    const outline = validOutlineDraft();
    await seedWaitingBlueprint(work, databasePool, {
      outline: {
        nodes: [outline.nodes[0]!],
        volumeContracts: [],
        sceneCards: [],
      },
    });
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const blueprint = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    const csrfToken = await csrf(owner);

    const blocked = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: blueprint.version,
        draftHash: blueprint.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(409);
    expect(blocked.body.error.code).toBe("BLUEPRINT_P0_CONFLICT");
    expect(await formalObjectCounts(databasePool, work.id)).toMatchObject({
      story_bibles: 0,
      entities: 0,
      outline_nodes: 0,
      chapters: 0,
    });
  });

  it("rejects incomplete or blank story-bible cards during confirmation", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-cards@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-cards");
    const storyBible = validStoryBibleDraft();
    storyBible.cards[0]!.content = "   ";
    storyBible.cards[0]!.complete = true;
    await seedWaitingBlueprint(work, databasePool, { storyBible });
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const blueprint = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    const csrfToken = await csrf(owner);

    const blocked = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: blueprint.version,
        draftHash: blueprint.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(409);
    expect(blocked.body.error.code).toBe("BLUEPRINT_P0_CONFLICT");
  });

  it("reports duplicate and dangling outline references as confirmation conflicts", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-references@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-references");
    const outline = validOutlineDraft();
    await seedWaitingBlueprint(work, databasePool, {
      outline: {
        ...outline,
        sceneCards: [
          ...outline.sceneCards,
          { ...outline.sceneCards[0]! },
          { ...outline.sceneCards[0]!, nodeId: uuidv7() },
        ],
      },
    });
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const blueprint = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    const csrfToken = await csrf(owner);

    const blocked = await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: blueprint.version,
        draftHash: blueprint.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(409);
    expect(blocked.body.error.code).toBe("BLUEPRINT_P0_CONFLICT");
    expect(await formalObjectCounts(databasePool, work.id)).toMatchObject({
      story_bibles: 0,
      entities: 0,
      outline_nodes: 0,
      scene_cards: 0,
    });
  });

  it("rolls back every formal projection when confirmation fails midway", async () => {
    const owner = await createAuthenticatedAgent("blueprint-confirm-rollback@example.com");
    const work = await createIdeaWork(owner, "blueprint-confirm-rollback");
    await seedWaitingBlueprint(work, databasePool);
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const blueprint = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;
    const root = blueprint.outlineDraft!.nodes.find((node) => node.level === "book")!;
    const userId = (
      await databasePool.query<{ user_id: string }>(`SELECT user_id FROM works WHERE id = $1`, [
        work.id,
      ])
    ).rows[0]!.user_id;
    const branch = (
      await databasePool.query<{ head_node_id: string }>(
        `SELECT head_node_id FROM work_branches WHERE id = $1`,
        [work.mainBranch.id],
      )
    ).rows[0]!;
    const outlineVersionNodeId = uuidv7();
    await databasePool.query(
      `INSERT INTO version_nodes
         (id, work_id, branch_id, user_id, parent_node_id, node_type, object_type,
          object_id, object_version, payload, actor_id, message)
       VALUES ($1, $2, $3, $4, $5, 'outline_version', 'outline', $6, 1, '{}'::jsonb,
               $4, '冲突测试节点')`,
      [outlineVersionNodeId, work.id, work.mainBranch.id, userId, branch.head_node_id, root.id],
    );
    await databasePool.query(
      `INSERT INTO outline_nodes
         (id, work_id, branch_id, user_id, level, parent_id, sort_order, title, summary,
          status, locked, version, tension, version_node_id)
       VALUES ($1, $2, $3, $4, 'book', NULL, 0, '冲突根节点', '', 'planned', false, 1,
               NULL, $5)`,
      [root.id, work.id, work.mainBranch.id, userId, outlineVersionNodeId],
    );
    const csrfToken = await csrf(owner);

    await owner
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: blueprint.version,
        draftHash: blueprint.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(500);

    expect(await formalObjectCounts(databasePool, work.id)).toMatchObject({
      story_bibles: 0,
      story_bible_versions: 0,
      entities: 0,
      entity_versions: 0,
      outline_nodes: 1,
      volume_contracts: 0,
      scene_cards: 0,
      chapters: 0,
      chapter_versions: 0,
    });
    const persisted = await databasePool.query<{ status: string; version: number }>(
      `SELECT status, version FROM work_blueprints WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    expect(persisted.rows[0]).toEqual({ status: "waiting_review", version: 1 });
  });

  it("rejects blueprint mutations from another tenant", async () => {
    const owner = await createAuthenticatedAgent("blueprint-tenant-owner@example.com");
    const work = await createIdeaWork(owner, "blueprint-tenant-owner");
    await seedWaitingBlueprint(work, databasePool);
    const outsider = await createAuthenticatedAgent("blueprint-tenant-outsider@example.com");
    const outsiderCsrf = await csrf(outsider);
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const blueprint = workBlueprintResponseSchema.parse(
      (await owner.get(blueprintPath).expect(200)).body,
    ).data;

    const confirm = await outsider
      .post(`${blueprintPath}/confirm`)
      .set("Origin", origin)
      .set("X-CSRF-Token", outsiderCsrf)
      .send({
        expectedVersion: blueprint.version,
        draftHash: blueprint.draftHash,
        acknowledgements: [],
        confirmed: true,
      })
      .expect(403);
    expect(confirm.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const patch = await outsider
      .patch(`${blueprintPath}/draft`)
      .set("Origin", origin)
      .set("X-CSRF-Token", outsiderCsrf)
      .send({
        expectedVersion: blueprint.version,
        operations: [{ op: "replace", path: "/storyBible/cards/0/content", value: "越权修改" }],
      })
      .expect(403);
    expect(patch.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const cancel = await outsider
      .post(`${blueprintPath}/cancel`)
      .set("Origin", origin)
      .set("X-CSRF-Token", outsiderCsrf)
      .send({ expectedVersion: blueprint.version })
      .expect(403);
    expect(cancel.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    await databasePool.query(
      `UPDATE work_blueprints
          SET status = 'budget_paused', version = 3
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    const budget = await outsider
      .post(`${blueprintPath}/budget`)
      .set("Origin", origin)
      .set("X-CSRF-Token", outsiderCsrf)
      .send({ expectedVersion: 3, maxTokens: 40000, maxCostCny: 0.3 })
      .expect(403);
    expect(budget.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("raises a paused budget and resumes the persisted checkpoint", async () => {
    const owner = await createAuthenticatedAgent("blueprint-budget-resume@example.com");
    const work = await createIdeaWork(owner, "blueprint-budget-resume");
    await seedWaitingBlueprint(work, databasePool);
    const checkpoint = {
      schemaVersion: 1,
      revision: 3,
      step: "outline",
      inputHash: "a".repeat(64),
      payload: { coreSettingsReady: true },
    };
    await databasePool.query(
      `UPDATE jobs
          SET status = 'paused', current_step = 'outline', progress = 60,
              budget = '{"maxTokens":30000,"maxCostCny":0.2}'::jsonb,
              cost = '{"inputTokens":1000,"outputTokens":500,"totalTokens":1500,"costCny":0.05}'::jsonb,
              checkpoint = $3::jsonb, checkpoint_version = 3,
              error_code = 'JOB_BUDGET_EXCEEDED', error_message = '超预算'
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id, JSON.stringify(checkpoint)],
    );
    await databasePool.query(
      `UPDATE work_blueprints
          SET status = 'budget_paused', current_step = 'outline', progress = 60,
              version = 3,
              cost = '{"inputTokens":1000,"outputTokens":500,"totalTokens":1500,"costCny":0.05}'::jsonb
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);
    const retryWhilePaused = await owner
      .post(`${blueprintPath}/retry`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(400);
    expect(retryWhilePaused.body.error.code).toBe("VALIDATION_INVALID");

    const resumed = await owner
      .post(`${blueprintPath}/budget`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({
        expectedVersion: 3,
        maxTokens: 40000,
        maxCostCny: 0.3,
      })
      .expect(202);
    expect(workBlueprintResponseSchema.parse(resumed.body).data).toMatchObject({
      status: "queued",
      version: 4,
      currentStep: "outline",
      budget: { maxTokens: 40000, maxCostCny: 0.3 },
      allowedActions: ["retry", "cancel"],
    });

    const persisted = await databasePool.query<{
      job_status: string;
      budget: { maxTokens: number; maxCostCny: number };
      checkpoint: { step: string; revision: number };
    }>(
      `SELECT status AS job_status, budget, checkpoint
         FROM jobs
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      job_status: "queued",
      budget: { maxTokens: 40000, maxCostCny: 0.3 },
      checkpoint: { step: "outline", revision: 3 },
    });

    const queue = new Queue<GenerateBlueprintJob>(WORKER_QUEUE_NAME, {
      connection: redis,
    });
    try {
      const queued = await waitForQueueJob(queue, resumed.body.data.jobId as string);
      expect(queued.data).toMatchObject({
        budget: { maxTokens: 40000, maxCostCny: 0.3 },
        checkpoint: { step: "outline", revision: 3 },
      });
    } finally {
      await queue.close();
    }
  });

  it("rejects a budget update that lowers either existing limit", async () => {
    const owner = await createAuthenticatedAgent("blueprint-budget-invalid@example.com");
    const work = await createIdeaWork(owner, "blueprint-budget-invalid");
    await seedWaitingBlueprint(work, databasePool);
    const checkpoint = {
      schemaVersion: 1,
      revision: 4,
      step: "outline",
      inputHash: "a".repeat(64),
      payload: { coreSettingsReady: true },
    };
    await databasePool.query(
      `UPDATE jobs
          SET status = 'paused', current_step = 'outline', progress = 60,
              budget = '{"maxTokens":30000,"maxCostCny":0.2}'::jsonb,
              cost = '{"inputTokens":1000,"outputTokens":500,"totalTokens":1500,"costCny":0.05}'::jsonb,
              checkpoint = $3::jsonb, checkpoint_version = 4
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id, JSON.stringify(checkpoint)],
    );
    await databasePool.query(
      `UPDATE work_blueprints
          SET status = 'budget_paused', current_step = 'outline', progress = 60,
              version = 4
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);

    const rejected = await owner
      .post(`${blueprintPath}/budget`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ expectedVersion: 4, maxTokens: 40000, maxCostCny: 0.1 })
      .expect(400);
    expect(rejected.body.error.code).toBe("VALIDATION_INVALID");

    const persisted = await databasePool.query<{
      blueprint_status: string;
      blueprint_version: number;
      job_status: string;
      budget: { maxTokens: number; maxCostCny: number };
      checkpoint: { revision: number };
    }>(
      `SELECT wb.status AS blueprint_status, wb.version AS blueprint_version,
              j.status AS job_status, j.budget, j.checkpoint
         FROM work_blueprints AS wb
         INNER JOIN jobs AS j ON j.id = wb.job_id
        WHERE wb.work_id = $1 AND wb.branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      blueprint_status: "budget_paused",
      blueprint_version: 4,
      job_status: "paused",
      budget: { maxTokens: 30000, maxCostCny: 0.2 },
      checkpoint: { revision: 4 },
    });
  });

  it("rejects cancellation after the blueprint has failed", async () => {
    const owner = await createAuthenticatedAgent("blueprint-cancel-failed@example.com");
    const work = await createIdeaWork(owner, "blueprint-cancel-failed");
    await seedWaitingBlueprint(work, databasePool);
    await databasePool.query(
      `UPDATE work_blueprints
          SET status = 'failed', version = 2
        WHERE work_id = $1 AND branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    await databasePool.query(
      `UPDATE jobs
          SET status = 'failed'
        WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
      [work.id, work.mainBranch.id],
    );
    const csrfToken = await csrf(owner);

    const rejected = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint/cancel`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ expectedVersion: 2 })
      .expect(400);
    expect(rejected.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("cancels without deleting the candidate or checkpoint", async () => {
    const owner = await createAuthenticatedAgent("blueprint-cancel@example.com");
    const work = await createIdeaWork(owner, "blueprint-cancel");
    await seedWaitingBlueprint(work, databasePool);
    const blueprintPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/blueprint`;
    const csrfToken = await csrf(owner);

    const cancelled = await owner
      .post(`${blueprintPath}/cancel`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .send({ expectedVersion: 1 })
      .expect(200);
    const blueprint = workBlueprintResponseSchema.parse(cancelled.body).data;
    expect(blueprint).toMatchObject({
      status: "cancelled",
      version: 2,
      currentStep: "await_review",
    });
    expect(blueprint.storyBibleDraft?.cards).toHaveLength(9);
    expect(blueprint.outlineDraft?.nodes.length).toBeGreaterThan(1);

    const retried = await owner
      .post(`${blueprintPath}/retry`)
      .set("Origin", origin)
      .set("X-CSRF-Token", csrfToken)
      .expect(400);
    expect(retried.body.error.code).toBe("VALIDATION_INVALID");

    const persisted = await databasePool.query<{
      job_status: string;
      checkpoint: { revision: number };
      story_bible_draft: { cards: unknown[] };
    }>(
      `SELECT j.status AS job_status, j.checkpoint,
              wb.story_bible_draft
         FROM jobs AS j
         INNER JOIN work_blueprints AS wb ON wb.job_id = j.id
        WHERE j.work_id = $1 AND j.branch_id = $2`,
      [work.id, work.mainBranch.id],
    );
    expect(persisted.rows[0]).toMatchObject({
      job_status: "cancelled",
      checkpoint: { revision: 0 },
      story_bible_draft: { cards: expect.any(Array) },
    });
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

async function seedWaitingBlueprint(
  work: { id: string; mainBranch: { id: string } },
  pool: ReturnType<typeof createDatabasePool>,
  options: {
    storyBible?: unknown;
    coreSettings?: unknown;
    outline?: unknown;
    missingFields?: unknown[];
    conflicts?: unknown[];
  } = {},
) {
  const record = await pool.query<{ user_id: string }>(`SELECT user_id FROM works WHERE id = $1`, [
    work.id,
  ]);
  const userId = record.rows[0]?.user_id;
  if (!userId) {
    throw new Error("Seeded work is missing its owner");
  }
  await pool.query(`UPDATE works SET scale_target = 'short' WHERE id = $1`, [work.id]);
  await pool.query(
    `UPDATE jobs
        SET status = 'waiting_review', progress = 100, current_step = 'await_review'
      WHERE work_id = $1 AND branch_id = $2 AND type = 'generate_blueprint'`,
    [work.id, work.mainBranch.id],
  );
  await pool.query(
    `UPDATE work_blueprints
        SET status = 'waiting_review', version = 1, progress = 100,
            current_step = 'await_review', story_bible_draft = $3::jsonb,
            core_settings_draft = $4::jsonb, outline_draft = $5::jsonb,
            missing_fields = $6::jsonb, conflicts = $7::jsonb,
            acknowledgements = '[]'::jsonb, draft_hash = NULL, updated_at = now()
      WHERE work_id = $1 AND branch_id = $2 AND user_id = $8`,
    [
      work.id,
      work.mainBranch.id,
      JSON.stringify(options.storyBible ?? validStoryBibleDraft()),
      JSON.stringify(options.coreSettings ?? validCoreSettingsDraft()),
      JSON.stringify(options.outline ?? validOutlineDraft()),
      JSON.stringify(options.missingFields ?? []),
      JSON.stringify(options.conflicts ?? []),
      userId,
    ],
  );
  return { userId };
}

async function formalObjectCounts(pool: ReturnType<typeof createDatabasePool>, workId: string) {
  const result = await pool.query<{
    story_bibles: number;
    story_bible_versions: number;
    entities: number;
    entity_versions: number;
    outline_nodes: number;
    volume_contracts: number;
    scene_cards: number;
    chapters: number;
    chapter_versions: number;
    character_profiles: number;
    faction_profiles: number;
    map_layers: number;
    power_systems: number;
    special_mechanisms: number;
    item_techniques: number;
    timeline_events: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM story_bibles WHERE work_id = $1) AS story_bibles,
       (SELECT count(*)::int FROM story_bible_versions WHERE work_id = $1)
         AS story_bible_versions,
       (SELECT count(*)::int FROM entities WHERE work_id = $1) AS entities,
       (SELECT count(*)::int FROM entity_versions WHERE work_id = $1) AS entity_versions,
       (SELECT count(*)::int FROM outline_nodes WHERE work_id = $1) AS outline_nodes,
       (SELECT count(*)::int FROM volume_contracts WHERE work_id = $1) AS volume_contracts,
       (SELECT count(*)::int FROM scene_cards WHERE work_id = $1) AS scene_cards,
       (SELECT count(*)::int FROM chapters WHERE work_id = $1) AS chapters,
       (SELECT count(*)::int FROM chapter_versions WHERE work_id = $1) AS chapter_versions,
       (SELECT count(*)::int FROM character_profiles WHERE work_id = $1) AS character_profiles,
       (SELECT count(*)::int FROM faction_profiles WHERE work_id = $1) AS faction_profiles,
       (SELECT count(*)::int FROM map_layers WHERE work_id = $1) AS map_layers,
       (SELECT count(*)::int FROM power_systems WHERE work_id = $1) AS power_systems,
       (SELECT count(*)::int FROM special_mechanisms WHERE work_id = $1) AS special_mechanisms,
       (SELECT count(*)::int FROM item_techniques WHERE work_id = $1) AS item_techniques,
       (SELECT count(*)::int FROM timeline_events WHERE work_id = $1) AS timeline_events`,
    [workId],
  );
  return result.rows[0]!;
}

function validStoryBibleDraft() {
  return {
    cards: STORY_BIBLE_CARD_KEYS.map((key) => ({
      key,
      title: STORY_BIBLE_CARD_TITLES[key],
      content: `${key} 内容`,
      complete: true,
      worldRules:
        key === "worldLaws"
          ? [1, 2, 3].map((index) => ({
              id: uuidv7(),
              name: `世界规则 ${index}`,
              constraint: `世界规则 ${index} 必须成立。`,
              scope: "全书",
              exceptions: [],
            }))
          : [],
    })),
  };
}

function validCoreSettingsDraft() {
  return (
    [
      "world_rule",
      "world_rule",
      "world_rule",
      "character",
      "faction",
      "map",
      "power_system",
      "golden_finger",
      "item",
      "timeline_event",
    ] as const
  ).map((type, index) => ({
    candidateId: uuidv7(),
    type,
    name: type === "world_rule" ? `世界规则 ${index + 1}` : `核心设定 ${index + 1}`,
    aliases: [],
    summary: `核心设定 ${index + 1} 摘要`,
    description: `核心设定 ${index + 1} 描述`,
    tags: [],
    data:
      index === 0
        ? {
            genre: "仙侠",
            world: "修真文明",
            map: "分层地图",
            powerSystem: "修炼体系",
            factions: "宗门势力",
            specialElements: ["灵物", "记忆代价", "洞天福地"],
            blessedLands: "洞天福地",
          }
        : {},
    required: true,
    source: "blueprint",
  }));
}

function validOutlineDraft() {
  const bookId = uuidv7();
  const volumeId = uuidv7();
  const acts = Array.from({ length: 3 }, (_, index) => ({
    id: uuidv7(),
    parentId: volumeId,
    level: "act" as const,
    sortOrder: index,
    title: `第 ${index + 1} 幕`,
    summary: `第 ${index + 1} 幕大纲`,
    status: "planned" as const,
    chapterNumber: null,
    brief: null,
    hook: null,
    foreshadow: null,
    tension: 40,
  }));
  const chapters = Array.from({ length: 12 }, (_, index) => ({
    id: uuidv7(),
    parentId: acts[index % acts.length]!.id,
    level: "chapter" as const,
    sortOrder: index,
    title: `第 ${index + 1} 章`,
    summary: `第 ${index + 1} 章大纲`,
    status: "planned" as const,
    chapterNumber: index + 1,
    brief: {
      goal: `完成第 ${index + 1} 章目标`,
      pov: "沈砚",
      location: "山门",
      sceneBeats: ["主角作出选择。"],
      requiredFacts: ["山门存在"],
    },
    hook: `第 ${index + 1} 章章末钩子`,
    foreshadow: index === 0 ? "全书伏笔" : null,
    tension: 50,
  }));
  const scenes = chapters.flatMap((chapter, chapterIndex) =>
    [0, 1].map((sceneIndex) => ({
      id: uuidv7(),
      parentId: chapter.id,
      level: "scene" as const,
      sortOrder: sceneIndex,
      title: `第 ${chapterIndex + 1} 章场景 ${sceneIndex + 1}`,
      summary: "场景大纲",
      status: "planned" as const,
      chapterNumber: null,
      brief: null,
      hook: null,
      foreshadow: null,
      tension: 55,
    })),
  );
  return {
    nodes: [
      {
        id: bookId,
        parentId: null,
        level: "book" as const,
        sortOrder: 0,
        title: "全书",
        summary: "全书大纲",
        status: "planned" as const,
        chapterNumber: null,
        brief: null,
        hook: null,
        foreshadow: null,
        tension: null,
      },
      {
        id: volumeId,
        parentId: bookId,
        level: "volume" as const,
        sortOrder: 0,
        title: "第一卷",
        summary: "第一卷大纲",
        status: "planned" as const,
        chapterNumber: null,
        brief: null,
        hook: null,
        foreshadow: null,
        tension: 35,
      },
      ...acts,
      ...chapters,
      ...scenes,
    ],
    volumeContracts: [
      {
        nodeId: volumeId,
        objective: "主角追查古书。",
        conflict: "宗门阻止主角。",
        turningPoints: ["发现线索"],
        exitConditions: ["进入内门"],
        plotLines: [],
      },
    ],
    sceneCards: scenes.map((scene) => ({
      nodeId: scene.id,
      title: scene.title,
      povLabel: "沈砚",
      locationLabel: "山门",
      storyTime: "入宗初期",
      beats: ["场景开始", "场景转折"],
      informationReleases: ["释放线索"],
      tension: 55,
    })),
  };
}
