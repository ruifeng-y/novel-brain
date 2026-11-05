import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  generationJobListResponseSchema,
  generationJobResponseSchema,
  generateChapterJobSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { FakeAiProvider } from "@novel-brain/ai";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { GenerationJobProcessor } from "../../worker/src/generation/generation.processor";
import { WorkerGenerationRepository } from "../../worker/src/generation/generation.repository";

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

describe("generation HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "generation-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "generation-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";

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

  it("queues one idempotent chapter generation job with a budget and checkpoint", async () => {
    const owner = await createAuthenticatedAgent("generation-owner@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    const config = await createModelConfig(owner, token);

    const first = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "generate-chapter-once")
      .send({
        budget: {
          maxCostCny: 1.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const firstJob = generationJobResponseSchema.parse(first.body).data;

    expect(firstJob).toMatchObject({
      type: "generate_chapter",
      chapterId: chapter.id,
      status: "queued",
      progress: 0,
      currentStep: "prepare",
      checkpoint: { step: "prepare", payload: {} },
      budget: {
        maxCostCny: 1.5,
        maxTokens: 12_000,
        maxRevisionRounds: 2,
      },
      cost: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 },
      error: null,
      contextPack: null,
    });
    expect(config.id).toBeTruthy();

    const replay = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "generate-chapter-once")
      .send({
        budget: {
          maxCostCny: 99,
          maxTokens: 99_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    expect(generationJobResponseSchema.parse(replay.body).data).toEqual(firstJob);

    const listed = await owner.get(`${branchPath}/jobs?chapterId=${chapter.id}`).expect(200);
    expect(generationJobListResponseSchema.parse(listed.body).data).toEqual([firstJob]);

    const canceled = await owner
      .post(`${branchPath}/jobs/${firstJob.id}/cancel`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    expect(generationJobResponseSchema.parse(canceled.body).data).toMatchObject({
      id: firstJob.id,
      status: "cancelled",
      error: { code: "JOB_CANCELLED" },
    });
    const events = await owner.get(`${branchPath}/jobs/${firstJob.id}/events`).expect(200);
    expect(events.text).toContain("job.canceled");

    const other = await createAuthenticatedAgent("generation-other@example.com");
    expect((await other.get(`${branchPath}/jobs/${firstJob.id}`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
  });

  it("runs the worker pipeline, persists a versioned context pack and exposes replayable SSE", async () => {
    const owner = await createAuthenticatedAgent("generation-success@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(owner, token, branchPath, chapter.id, "generation-success");
    const workerPayload = await readWorkerPayload(job.id);

    const processor = new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    );
    await processor.process(workerPayload);

    const completed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    const completedJob = generationJobResponseSchema.parse(completed.body).data;
    expect(completedJob).toMatchObject({
      status: "waiting_review",
      progress: 100,
      error: null,
      currentStep: "await_review",
      checkpoint: { step: "await_review" },
    });
    expect(completedJob.cost.totalTokens).toBeGreaterThan(0);
    expect(completedJob.contextPack).toMatchObject({
      version: 1,
      compilerVersion: "m0-context-v1",
      tokenBudget: 12_000,
    });
    expect(completedJob.contextPack?.selected.length).toBeGreaterThan(0);
    expect(completedJob.contextPack?.sourceRefs.length).toBeGreaterThan(0);

    const versions = await owner.get(`${branchPath}/chapters/${chapter.id}/versions`).expect(200);
    expect(versions.body.data.map((version: { version: number }) => version.version)).toEqual([
      2, 1,
    ]);
    const generatedVersions = await databasePool.query<{
      source: string;
      generation_step: string;
    }>(
      `SELECT source, generation_step
       FROM chapter_versions
       WHERE generation_job_id = $1
       ORDER BY version`,
      [job.id],
    );
    expect(generatedVersions.rows).toEqual([
      { source: "generated_draft", generation_step: "draft" },
      { source: "generated_revised", generation_step: "revise" },
    ]);

    const events = await owner.get(`${branchPath}/jobs/${job.id}/events`).expect(200);
    expect(events.headers["content-type"]).toContain("text/event-stream");
    expect(events.text).toContain("job.step.succeeded");
    expect(events.text).toContain("job.waiting_review");
  });

  it("preserves the draft checkpoint and resumes from the failed revise step", async () => {
    const owner = await createAuthenticatedAgent("generation-resume@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(owner, token, branchPath, chapter.id, "generation-resume");
    const workerPayload = await readWorkerPayload(job.id);

    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider({ failOperations: ["revise"] }),
    ).process(workerPayload);

    const failed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(failed.body).data).toMatchObject({
      status: "failed",
      checkpoint: { step: "revise" },
      error: {
        code: "MODEL_PROVIDER_ERROR",
        message: "模型服务暂时不可用，草稿和检查点已保留",
      },
    });
    const draftBeforeRetry = await databasePool.query<{
      id: string;
      source: string;
      generation_step: string;
    }>(
      `SELECT id, source, generation_step
       FROM chapter_versions
       WHERE generation_job_id = $1
       ORDER BY version`,
      [job.id],
    );
    expect(draftBeforeRetry.rows).toEqual([
      {
        id: draftBeforeRetry.rows[0]?.id,
        source: "generated_draft",
        generation_step: "draft",
      },
    ]);
    const beforeRetrySteps = await databasePool.query<{
      step_key: string;
      status: string;
      attempt: number;
      finished_at: Date | null;
    }>(
      `SELECT step_key, status, attempt, finished_at
       FROM job_steps
       WHERE job_id = $1
       ORDER BY created_at`,
      [job.id],
    );
    await databasePool.query(
      `UPDATE story_bibles
       SET cards = jsonb_set(cards, '{0,content}', '"重试后不应改写上下文"', false)
       WHERE work_id = $1`,
      [work.id],
    );

    const retried = await owner
      .post(`${branchPath}/jobs/${job.id}/retry`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(202);
    expect(generationJobResponseSchema.parse(retried.body).data).toMatchObject({
      status: "queued",
      checkpoint: { step: "revise" },
      error: null,
    });
    const retriedPayload = await readWorkerPayload(job.id);
    expect(retriedPayload.checkpoint.step).toBe("revise");
    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(retriedPayload);

    const completed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(completed.body).data).toMatchObject({
      status: "waiting_review",
      progress: 100,
      currentStep: "await_review",
    });
    const versions = await databasePool.query<{
      id: string;
      source: string;
      generation_step: string;
    }>(
      `SELECT id, source, generation_step
       FROM chapter_versions
       WHERE generation_job_id = $1
       ORDER BY version`,
      [job.id],
    );
    expect(versions.rows.map(({ source }) => source)).toEqual([
      "generated_draft",
      "generated_revised",
    ]);
    expect(versions.rows[0]?.id).toBe(draftBeforeRetry.rows[0]?.id);
    const afterRetrySteps = await databasePool.query<{
      step_key: string;
      status: string;
      attempt: number;
      finished_at: Date | null;
    }>(
      `SELECT step_key, status, attempt, finished_at
       FROM job_steps
       WHERE job_id = $1
       ORDER BY created_at`,
      [job.id],
    );
    expect(afterRetrySteps.rows.find((step) => step.step_key === "draft")?.finished_at).toEqual(
      beforeRetrySteps.rows.find((step) => step.step_key === "draft")?.finished_at,
    );
    expect(afterRetrySteps.rows.find((step) => step.step_key === "draft")?.attempt).toBe(1);
    const contextPacks = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM context_pack_versions WHERE job_id = $1",
      [job.id],
    );
    expect(contextPacks.rows[0]?.count).toBe("1");
    const contextSnapshot = await databasePool.query<{ snapshot: string }>(
      "SELECT snapshot::text AS snapshot FROM context_pack_versions WHERE job_id = $1",
      [job.id],
    );
    expect(contextSnapshot.rows[0]?.snapshot).not.toContain("重试后不应改写上下文");
  });

  it("stops at the budget limit after preserving the generated draft and checkpoint", async () => {
    const owner = await createAuthenticatedAgent("generation-budget@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const preview = await owner
      .get(`${branchPath}/chapters/${chapter.id}/context-preview?tokenBudget=12000`)
      .expect(200);
    const tokenUsed = preview.body.data.tokenUsed as number;
    const started = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "generation-budget")
      .send({
        budget: {
          maxCostCny: 100,
          maxTokens: tokenUsed + 800,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const job = generationJobResponseSchema.parse(started.body).data;

    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(await readWorkerPayload(job.id));

    const failed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(failed.body).data).toMatchObject({
      status: "failed",
      checkpoint: { step: "verify" },
      error: {
        code: "JOB_BUDGET_EXCEEDED",
        message: "本章生成预算已用完，草稿和检查点已保留",
      },
    });
    const versions = await databasePool.query<{ source: string; generation_step: string }>(
      `SELECT source, generation_step
       FROM chapter_versions
       WHERE generation_job_id = $1`,
      [job.id],
    );
    expect(versions.rows).toEqual([{ source: "generated_draft", generation_step: "draft" }]);
    const packs = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM context_pack_versions WHERE job_id = $1",
      [job.id],
    );
    expect(packs.rows[0]?.count).toBe("1");
  });

  async function startGeneration(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapterId: string,
    idempotencyKey: string,
  ) {
    const response = await agent
      .post(`${branchPath}/chapters/${chapterId}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    return generationJobResponseSchema.parse(response.body).data;
  }

  async function readWorkerPayload(jobId: string) {
    const result = await databasePool.query<{
      user_id: string;
      work_id: string;
      branch_id: string;
      chapter_id: string;
      model_config_id: string;
      idempotency_key: string;
      budget: Record<string, unknown>;
      checkpoint: Record<string, unknown>;
    }>(
      `SELECT user_id, work_id, branch_id, chapter_id, model_config_id,
              idempotency_key, budget, checkpoint
       FROM jobs WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Generation job was not persisted");
    }
    return generateChapterJobSchema.parse({
      jobId,
      jobType: "generate_chapter",
      workId: row.work_id,
      branchId: row.branch_id,
      chapterId: row.chapter_id,
      actorId: row.user_id,
      modelConfigId: row.model_config_id,
      idempotencyKey: row.idempotency_key,
      budget: row.budget,
      checkpoint: row.checkpoint,
    });
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
        displayName: "生成作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createWork(agent: SuperAgentTest) {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        mode: "idea",
        title: "忘川书",
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);
    return response.body.data as {
      id: string;
      mainBranch: { id: string };
    };
  }

  async function createCompleteBible(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<void> {
    const generated = await agent
      .post(`${branchPath}/story-bible/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    await agent
      .post(`${branchPath}/story-bible/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: generated.body.data.version })
      .expect(200);
  }

  async function createConfirmedSettings(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<void> {
    const entities = [
      {
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      },
      {
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "隐藏忘川书的外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折，不能双手结印。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "与顾青互相试探。",
        },
      },
      {
        type: "golden_finger",
        name: "忘川书",
        aliases: [],
        summary: "以记忆换取前人经验。",
        description: "",
        tags: [],
        data: {
          rules: "每次只能借用一位前人的经验。",
          cost: "永久失去一段重要记忆。",
          limits: "每次使用消耗一页。",
          growth: "缺失记忆会拼成完整人格。",
        },
      },
    ] as const;
    for (const entity of entities) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(entity)
        .expect(201);
      await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
    }
  }

  async function createChapter(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<{ id: string }> {
    const response = await agent
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        order: 1,
        title: "一只手也能结印",
        brief: {
          goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: [
            "沈砚藏起断臂，被顾青撞见。",
            "血河宗追兵逼近，两人被迫联手。",
            "沈砚单手结印，忘川书短暂显形。",
            "顾青看见书页一角，但没有点破。",
          ],
          requiredFacts: ["左臂骨折，不能双手结印", "顾青不知道忘川书完整来历"],
        },
      })
      .expect(201);
    return response.body.data as { id: string };
  }

  async function createModelConfig(agent: SuperAgentTest, token: string): Promise<{ id: string }> {
    const response = await agent
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-fake-generation-1234",
        purposes: ["writing"],
        isDefault: true,
      })
      .expect(200);
    return response.body.data as { id: string };
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
