import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  agentGrantResponseSchema,
  agentRunTraceListResponseSchema,
  agentRunTraceResponseSchema,
  contextPackPreviewResponseSchema,
  generationJobListResponseSchema,
  jobRecoveryResponseSchema,
  generationJobResponseSchema,
  generateChapterJobSchema,
  WORKER_JOB_STEPS,
  type WorkerJobStep,
} from "@novel-brain/contracts";
import {
  AgentGrantStore,
  BudgetReservationError,
  CostLedger,
  CostSettlementConflictError,
  createDatabasePool,
  runMigrations,
} from "@novel-brain/db";
import { AiProviderError, FakeAiProvider, type AiGateway } from "@novel-brain/ai";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { AgentGrantGuard } from "../../worker/src/agent-runtime/agent-grant.guard";
import { GenerationJobProcessor } from "../../worker/src/generation/generation.processor";
import { WorkerGenerationRepository } from "../../worker/src/generation/generation.repository";
import { ByokAiGatewayFactory } from "../../worker/src/generation/model-provider.factory";

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

class SimulatedWorkerCrash extends Error {
  constructor(step: string) {
    super(`Simulated worker kill after ${step}`);
    this.name = "SimulatedWorkerCrash";
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
    await resetDatabase(databasePool);
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

  it("blocks context compilation deterministically when the branch is archived", async () => {
    const owner = await createAuthenticatedAgent("generation-stale-branch@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);

    await databasePool.query("UPDATE work_branches SET status = 'archived' WHERE id = $1", [
      work.mainBranch.id,
    ]);

    const stale = await owner
      .get(`${branchPath}/chapters/${chapter.id}/context-preview?tokenBudget=12000`)
      .expect(409);
    expect(stale.body.error).toMatchObject({
      code: "JOB_CONTEXT_BRANCH_STALE",
      details: { branchId: work.mainBranch.id },
    });
  });

  it("runs the worker pipeline, persists a versioned context pack and exposes replayable SSE", async () => {
    const owner = await createAuthenticatedAgent("generation-success@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    await databasePool.query(
      "UPDATE works SET settings = jsonb_build_object('styleSample', $2::text) WHERE id = $1",
      [work.id, "短句白描，避免华丽比喻。"],
    );
    const unrelated = await owner
      .post(`${branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "faction",
        name: "无关宗门",
        aliases: [],
        summary: "本章不会出现",
        description: "",
        tags: [],
        data: { details: "与当前场景无关。" },
      })
      .expect(201);
    await owner
      .post(`${branchPath}/entities/${unrelated.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: unrelated.body.data.version })
      .expect(200);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const preview = contextPackPreviewResponseSchema.parse(
      (
        await owner
          .get(`${branchPath}/chapters/${chapter.id}/context-preview?tokenBudget=12000`)
          .expect(200)
      ).body,
    ).data;
    expect(preview.selected.map((source) => source.key)).toContain("style:sample");
    expect(preview.selected.map((source) => source.key)).toContain("story-bible:world-rules");
    expect(preview.selected.map((source) => source.label)).toContain("沈砚");
    expect(preview.selected.map((source) => source.label)).not.toContain("无关宗门");
    const job = await startGeneration(owner, token, branchPath, chapter.id, "generation-success");
    const workerPayload = await readWorkerPayload(job.id);

    const processor = new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    );
    const logLines: string[] = [];
    processor.setTraceLogger({
      info: (payload) => logLines.push(JSON.stringify(payload)),
      warn: (payload) => logLines.push(JSON.stringify(payload)),
    });
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
      compilerVersion: "m1-context-v1",
      tokenBudget: 12_000,
      task: "chapter_draft",
      chapterNumber: 1,
      effectiveTokenBudget: 12_000,
    });
    expect(completedJob.contextPack?.selected.length).toBeGreaterThan(0);
    expect(completedJob.contextPack?.selected.map((source) => source.layer)).toContain("P0");
    expect(completedJob.contextPack?.budget?.layers.P0.selectedCount).toBeGreaterThan(0);
    expect(completedJob.contextPack?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
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

    const tracesResponse = await owner.get(`${branchPath}/agent-runs?jobId=${job.id}`).expect(200);
    const traces = agentRunTraceListResponseSchema.parse(tracesResponse.body).data;
    expect(traces.map((trace) => trace.run.stepKey)).toEqual(["draft", "verify", "revise"]);
    expect((tracesResponse.body as { meta: { nextCursor: string | null } }).meta).toHaveProperty(
      "nextCursor",
    );
    expect(traces.every((trace) => trace.run.status === "succeeded")).toBe(true);
    expect(traces.every((trace) => trace.modelCalls.length === 1)).toBe(true);
    expect(traces.every((trace) => trace.costReservations[0]?.status === "settled")).toBe(true);
    expect(traces.map((trace) => trace.replay?.provider)).toEqual([
      "deepseek",
      "deepseek",
      "deepseek",
    ]);
    expect(traces.every((trace) => trace.replay?.model === "deepseek-chat")).toBe(true);
    expect(traces.every((trace) => trace.replay?.parameters.maxTokens === 2_000)).toBe(true);
    expect(traces.every((trace) => trace.promptVersions[0]?.promptHash.length === 64)).toBe(true);

    const traceJson = JSON.stringify(traces);
    expect(traceJson).not.toContain("sk-fake-generation-1234");
    expect(traceJson).not.toContain("沈砚把断臂藏进衣袍");
    expect(traceJson).not.toContain('"prompt":');
    expect(traceJson).not.toContain('"output":');

    const detailed = await owner.get(`${branchPath}/agent-runs/${traces[0]?.run.id}`).expect(200);
    expect(agentRunTraceResponseSchema.parse(detailed.body).data).toEqual(traces[0]);

    const byChapter = await owner
      .get(`${branchPath}/agent-runs?chapterId=${chapter.id}`)
      .expect(200);
    expect(agentRunTraceListResponseSchema.parse(byChapter.body).data).toEqual(traces);

    const other = await createAuthenticatedAgent("generation-trace-other@example.com");
    expect(
      (await other.get(`${branchPath}/agent-runs?jobId=${job.id}`).expect(403)).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const grantResponse = await owner
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        taskId: uuidv7(),
        role: "writer",
        tools: ["context.read_pack"],
        resourceScope: { chapterIds: [chapter.id], settingIds: [], includeCanon: false },
        budget: { maxCostCny: 0.5, maxTokens: 1_000, maxCalls: 2 },
        maxImpact: { maxSideEffect: "S0", maxAffectedResources: 1 },
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .expect(201);
    const grant = agentGrantResponseSchema.parse(grantResponse.body).data;
    const grantStore = new AgentGrantStore(databaseUrl);
    try {
      await new AgentGrantGuard(grantStore).authorizeToolCall({
        userId: await userIdFor(owner),
        workId: work.id,
        branchId: work.mainBranch.id,
        taskId: grant.taskId,
        grantId: grant.id,
        agentRunId: traces[0]?.run.id,
        toolName: "context.read_pack",
        resource: { type: "chapter", id: chapter.id },
        input: { taskId: grant.taskId },
        affectedResources: 1,
        estimatedCostCny: 0.01,
        estimatedTokens: 100,
        approval: null,
        audit: {
          requestId: "req_trace_tool_call",
          ip: "127.0.0.1",
          userAgent: "integration-test",
        },
      });
    } finally {
      await grantStore.close();
    }
    const tracedTool = agentRunTraceListResponseSchema.parse(
      (await owner.get(`${branchPath}/agent-runs?jobId=${job.id}`).expect(200)).body,
    ).data;
    expect(tracedTool[0]?.toolCalls).toMatchObject([
      {
        toolName: "context.read_pack",
        decision: "allow",
        status: "authorized",
      },
    ]);

    expect(logLines.join("\n")).not.toContain("sk-fake-generation-1234");
    expect(logLines.join("\n")).not.toContain("沈砚");
    expect(logLines.join("\n")).not.toContain("完整上下文");
    expect(logLines.join("\n")).not.toContain("本章参考");
  });

  it("serializes concurrent budget reservations and settles each reservation once", async () => {
    const owner = await createAuthenticatedAgent("generation-cost-race@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-cost-race",
      { maxCostCny: 1, maxTokens: 30_000, maxRevisionRounds: 2 },
    );
    const ledger = new CostLedger(databaseUrl);
    const userId = await userIdFor(owner);
    try {
      const results = await Promise.allSettled([
        ledger.reserve({
          userId,
          workId: work.id,
          branchId: work.mainBranch.id,
          jobId: job.id,
          idempotencyKey: "race-a",
          estimatedTokens: 1_000,
          estimatedCostCny: 0.6,
        }),
        ledger.reserve({
          userId,
          workId: work.id,
          branchId: work.mainBranch.id,
          jobId: job.id,
          idempotencyKey: "race-b",
          estimatedTokens: 1_000,
          estimatedCostCny: 0.6,
        }),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<CostLedger["reserve"]>>> =>
          result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(BudgetReservationError);

      const winner = fulfilled[0]!.value.reservation;
      const settled = await ledger.settle({
        userId,
        jobId: job.id,
        idempotencyKey: winner.idempotencyKey,
        actualTokens: 1_000,
        actualCostCny: 0.4,
      });
      expect(settled).toMatchObject({
        id: winner.id,
        status: "settled",
        settledTokens: 1_000,
        settledCostCny: 0.4,
      });
      const replay = await ledger.settle({
        userId,
        jobId: job.id,
        idempotencyKey: winner.idempotencyKey,
        actualTokens: 1_000,
        actualCostCny: 0.4,
      });
      expect(replay).toEqual(settled);

      await expect(
        ledger.settle({
          userId,
          jobId: job.id,
          idempotencyKey: winner.idempotencyKey,
          actualTokens: 2_000,
          actualCostCny: 0.8,
        }),
      ).rejects.toBeInstanceOf(CostSettlementConflictError);

      const stored = await databasePool.query<{ total: string; cost: string }>(
        "SELECT cost->>'totalTokens' AS total, cost->>'costCny' AS cost FROM jobs WHERE id = $1",
        [job.id],
      );
      expect(stored.rows[0]).toEqual({ total: "1000", cost: "0.4" });
      const reservationCount = await databasePool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM cost_reservations WHERE job_id = $1",
        [job.id],
      );
      expect(reservationCount.rows[0]?.count).toBe("1");
    } finally {
      await ledger.close();
    }
  });

  it("settles an overrun reservation and preserves the actual job cost", async () => {
    const owner = await createAuthenticatedAgent("generation-cost-overrun@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-cost-overrun",
      { maxCostCny: 1, maxTokens: 30_000, maxRevisionRounds: 2 },
    );
    const ledger = new CostLedger(databaseUrl);
    const userId = await userIdFor(owner);
    try {
      const reserved = await ledger.reserve({
        userId,
        workId: work.id,
        branchId: work.mainBranch.id,
        jobId: job.id,
        idempotencyKey: "overrun",
        estimatedTokens: 1_000,
        estimatedCostCny: 0.4,
      });

      const settled = await ledger.settle({
        userId,
        jobId: job.id,
        idempotencyKey: reserved.reservation.idempotencyKey,
        actualTokens: 1_001,
        actualCostCny: 0.41,
      });
      expect(settled).toMatchObject({
        status: "settled",
        settledTokens: 1_001,
        settledCostCny: 0.41,
        failureClass: "budget",
      });
      const replay = await ledger.settle({
        userId,
        jobId: job.id,
        idempotencyKey: reserved.reservation.idempotencyKey,
        actualTokens: 1_001,
        actualCostCny: 0.41,
      });
      expect(replay).toEqual(settled);

      const stored = await databasePool.query<{ total: string; cost: string }>(
        "SELECT cost->>'totalTokens' AS total, cost->>'costCny' AS cost FROM jobs WHERE id = $1",
        [job.id],
      );
      expect(stored.rows[0]).toEqual({ total: "1001", cost: "0.41" });
      const reservation = await databasePool.query<{
        status: string;
        settled_tokens: number;
        settled_cost_cny: number;
        failure_class: string;
      }>(
        `SELECT status, settled_tokens, settled_cost_cny, failure_class
         FROM cost_reservations
         WHERE id = $1`,
        [reserved.reservation.id],
      );
      expect(reservation.rows[0]).toEqual({
        status: "settled",
        settled_tokens: 1_001,
        settled_cost_cny: 0.41,
        failure_class: "budget",
      });
    } finally {
      await ledger.close();
    }
  });

  it("classifies provider rate limits with trace evidence and an author escalation reason", async () => {
    const owner = await createAuthenticatedAgent("generation-rate-limit@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-rate-limit",
    );
    const provider: AiGateway = {
      async generateText() {
        throw new AiProviderError("rate limited", { failureClass: "rate_limit" });
      },
      async *streamText() {
        yield { text: "", done: true };
      },
    };
    await new GenerationJobProcessor(new WorkerGenerationRepository(), provider).process(
      await readWorkerPayload(job.id),
    );

    const failed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(failed.body).data).toMatchObject({
      status: "failed",
      error: { code: "MODEL_RATE_LIMITED" },
    });
    const traces = agentRunTraceListResponseSchema.parse(
      (await owner.get(`${branchPath}/agent-runs?jobId=${job.id}`).expect(200)).body,
    ).data;
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({
      run: {
        status: "failed",
        failureClass: "rate_limit",
        escalationReason: "模型服务限流，请稍后从断点重试",
      },
      modelCalls: [
        {
          status: "failed",
          failureClass: "rate_limit",
          errorCode: "MODEL_RATE_LIMITED",
        },
      ],
      costReservations: [{ status: "released", failureClass: "rate_limit" }],
    });
  });

  it("uses the job's decrypted BYOK configuration for every provider call", async () => {
    const owner = await createAuthenticatedAgent("generation-byok@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await owner
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "openai-compatible",
        label: "白名单正文",
        baseUrl: "https://8.8.8.8/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-byok-generation-4321",
        purposes: ["writing"],
        isDefault: true,
      })
      .expect(200);
    const job = await startGeneration(owner, token, branchPath, chapter.id, "generation-byok");
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://8.8.8.8/v1/chat/completions");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk-byok-generation-4321",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "gpt-4.1-mini",
      });
      return new Response(
        JSON.stringify({
          id: "byok-response",
          model: "gpt-4.1-mini",
          choices: [
            {
              message: { content: "沈砚把断臂藏进衣袍，只用右手结印。" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 12 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new ByokAiGatewayFactory({ mode: "byok", fetchImpl }),
    ).process(await readWorkerPayload(job.id));

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const completed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(completed.body).data).toMatchObject({
      status: "waiting_review",
      error: null,
    });
    const usage = await databasePool.query<{ model: string; count: string }>(
      "SELECT model, count(*)::text AS count FROM usage_records WHERE job_id = $1 GROUP BY model",
      [job.id],
    );
    expect(usage.rows).toEqual([{ model: "gpt-4.1-mini", count: "3" }]);
    const persisted = await databasePool.query<{ text: string }>(
      `SELECT concat_ws(' ', error_message, checkpoint::text, cost::text) AS text
       FROM jobs WHERE id = $1`,
      [job.id],
    );
    expect(persisted.rows[0]?.text).not.toContain("sk-byok-generation-4321");
  });

  it("allows only one worker to own a durable job during concurrent redelivery", async () => {
    const owner = await createAuthenticatedAgent("generation-concurrent@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-concurrent",
    );
    const workerPayload = await readWorkerPayload(job.id);
    const fake = new FakeAiProvider();
    let providerCalls = 0;
    let releaseDraft!: () => void;
    const draftReleased = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    let markDraftStarted!: () => void;
    const draftStarted = new Promise<void>((resolve) => {
      markDraftStarted = resolve;
    });
    const provider = {
      async generateText(input: Parameters<FakeAiProvider["generateText"]>[0]) {
        providerCalls += 1;
        if (providerCalls === 1) {
          markDraftStarted();
          await draftReleased;
        }
        return fake.generateText(input);
      },
      streamText(input: Parameters<FakeAiProvider["generateText"]>[0]) {
        return fake.streamText(input);
      },
    };

    const firstWorker = new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      provider,
    ).process(workerPayload);
    await draftStarted;
    const secondWorker = new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      provider,
    ).process(workerPayload);
    await secondWorker;
    releaseDraft();
    await firstWorker;

    expect(providerCalls).toBe(3);
    const records = await databasePool.query<{ usage_count: string; trace_count: string }>(
      `SELECT
         (SELECT count(*)::text FROM usage_records WHERE job_id = $1) AS usage_count,
         (SELECT count(*)::text FROM agent_runs WHERE job_id = $1) AS trace_count`,
      [job.id],
    );
    expect(records.rows[0]).toEqual({ usage_count: "3", trace_count: "3" });
  });

  it("fails the durable job when its stored BYOK key cannot be decrypted", async () => {
    const owner = await createAuthenticatedAgent("generation-invalid-key@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    const config = await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-invalid-key",
    );
    await databasePool.query("UPDATE model_configs SET encrypted_key = $2 WHERE id = $1", [
      config.id,
      "not-an-encrypted-key",
    ]);

    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new ByokAiGatewayFactory({ mode: "byok" }),
    ).process(await readWorkerPayload(job.id));

    const failed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(failed.body).data).toMatchObject({
      status: "failed",
      checkpoint: { step: "draft" },
      error: {
        code: "MODEL_PROVIDER_ERROR",
        message: "模型配置无法读取，草稿和检查点已保留",
      },
    });
  });

  it("rejects generation when the locked story bible alone exceeds the token budget", async () => {
    const owner = await createAuthenticatedAgent("generation-required-bible@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    await databasePool.query(
      `UPDATE story_bibles
       SET cards = (
         SELECT jsonb_agg(jsonb_set(card, '{content}', to_jsonb($2::text)))
         FROM jsonb_array_elements(cards) AS card
       )
       WHERE work_id = $1`,
      [work.id, "不可淘汰的故事圣经硬约束。".repeat(1_000)],
    );

    const rejected = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "generation-required-bible")
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 200,
          maxRevisionRounds: 2,
        },
      })
      .expect(400);
    expect(rejected.body.error).toMatchObject({
      code: "JOB_BUDGET_EXCEEDED",
      details: {
        tokenBudget: 200,
      },
    });
    const jobs = await databasePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM jobs WHERE work_id = $1",
      [work.id],
    );
    expect(jobs.rows[0]?.count).toBe("0");
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

  it("resumes from the durable database checkpoint even when a redelivery payload is stale", async () => {
    const owner = await createAuthenticatedAgent("generation-stale-payload@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-stale-payload",
    );
    const workerPayload = await readWorkerPayload(job.id);

    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider({ failOperations: ["revise"] }),
    ).process(workerPayload);

    const before = await databasePool.query<{
      usage_count: string;
      trace_count: string;
      revise_calls: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM usage_records WHERE job_id = $1) AS usage_count,
         (SELECT count(*)::text FROM agent_runs WHERE job_id = $1) AS trace_count,
         (SELECT count(*)::text FROM model_calls WHERE job_id = $1 AND step_key = 'revise') AS revise_calls`,
      [job.id],
    );
    await owner
      .post(`${branchPath}/jobs/${job.id}/retry`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(202);

    const provider = new FakeAiProvider();
    const generateText = vi.spyOn(provider, "generateText");
    await new GenerationJobProcessor(new WorkerGenerationRepository(), provider).process({
      ...workerPayload,
      workId: crypto.randomUUID(),
      branchId: crypto.randomUUID(),
      chapterId: crypto.randomUUID(),
      modelConfigId: crypto.randomUUID(),
      idempotencyKey: "stale-redelivery-key",
      budget: { maxCostCny: 0.01, maxTokens: 1, maxRevisionRounds: 0 },
      checkpoint: { step: "prepare", payload: {} },
    });

    expect(generateText.mock.calls.map(([input]) => input.operation)).toEqual(["revise"]);
    const after = await databasePool.query<{
      usage_count: string;
      trace_count: string;
      revise_calls: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM usage_records WHERE job_id = $1) AS usage_count,
         (SELECT count(*)::text FROM agent_runs WHERE job_id = $1) AS trace_count,
         (SELECT count(*)::text FROM model_calls WHERE job_id = $1 AND step_key = 'revise') AS revise_calls`,
      [job.id],
    );
    expect(Number(after.rows[0]?.usage_count)).toBe(Number(before.rows[0]?.usage_count) + 1);
    expect(after.rows[0]?.trace_count).toBe(before.rows[0]?.trace_count);
    expect(Number(after.rows[0]?.revise_calls)).toBe(Number(before.rows[0]?.revise_calls) + 1);
  });

  it("stops before the provider call when the full output allowance exceeds the job budget", async () => {
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

    const provider = new FakeAiProvider();
    const generateText = vi.spyOn(provider, "generateText");
    await new GenerationJobProcessor(new WorkerGenerationRepository(), provider).process(
      await readWorkerPayload(job.id),
    );

    expect(generateText).not.toHaveBeenCalled();
    const failed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(failed.body).data).toMatchObject({
      status: "paused",
      checkpoint: { step: "draft" },
      error: {
        code: "JOB_BUDGET_EXCEEDED",
        message: "本次任务预算已用完，原稿和检查点已保留",
      },
    });
    const versions = await databasePool.query<{ source: string; generation_step: string }>(
      `SELECT source, generation_step
       FROM chapter_versions
       WHERE generation_job_id = $1`,
      [job.id],
    );
    expect(versions.rows).toEqual([]);
    const packs = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM context_pack_versions WHERE job_id = $1",
      [job.id],
    );
    expect(packs.rows[0]?.count).toBe("1");
  });

  it("records generation overruns once and stops duplicate worker deliveries", async () => {
    const owner = await createAuthenticatedAgent("generation-overrun@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(owner, token, branchPath, chapter.id, "generation-overrun", {
      maxCostCny: 100,
      maxTokens: 30_000,
      maxRevisionRounds: 2,
    });
    const payload = await readWorkerPayload(job.id);
    let providerCalls = 0;
    const provider: AiGateway = {
      async generateText(input) {
        providerCalls += 1;
        return {
          text: "超量返回的正文",
          model: input.model ?? "fake-overrun",
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 500_000 },
        };
      },
      async *streamText() {
        yield { text: "", done: true };
      },
    };
    const repository = new WorkerGenerationRepository();
    try {
      const processor = new GenerationJobProcessor(repository, provider);
      await processor.process(payload);
      await processor.process(payload);
    } finally {
      await repository.onModuleDestroy();
    }

    const paused = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    const pausedJob = generationJobResponseSchema.parse(paused.body).data;
    expect(pausedJob).toMatchObject({
      status: "paused",
      checkpoint: { step: "draft" },
      error: { code: "JOB_BUDGET_EXCEEDED" },
      cost: {
        inputTokens: 0,
        outputTokens: 500_000,
        totalTokens: 500_000,
        costCny: 1,
      },
    });
    expect(providerCalls).toBe(1);
    const usage = await databasePool.query<{
      prompt_tokens: number;
      completion_tokens: number;
      cost_cny: number;
    }>(
      `SELECT prompt_tokens, completion_tokens, cost_cny
       FROM usage_records
       WHERE job_id = $1 AND step_key = 'draft'`,
      [job.id],
    );
    expect(usage.rows).toEqual([
      {
        prompt_tokens: 0,
        completion_tokens: 500_000,
        cost_cny: 1,
      },
    ]);
    const overrunEvents = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM job_events
       WHERE job_id = $1 AND event_type = 'job.budget.exceeded'`,
      [job.id],
    );
    expect(overrunEvents.rows[0]?.count).toBe("1");

    const recoveryRequest = {
      reason: "作者确认提高本章预算并从草稿步骤继续",
      idempotencyKey: "generation-overrun-recover",
      expectedCheckpointVersion: pausedJob.checkpoint.revision,
      budget: {
        maxTokens: 600_000,
      },
    };
    const recovered = await owner
      .post(`${branchPath}/jobs/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(recoveryRequest)
      .expect(202);
    const recoveredData = jobRecoveryResponseSchema.parse(recovered.body).data;
    expect(recoveredData.job).toMatchObject({
      status: "queued",
      budget: {
        maxTokens: 600_000,
        maxCostCny: 100,
        maxRevisionRounds: 2,
      },
      checkpoint: { step: "draft" },
    });

    const replay = await owner
      .post(`${branchPath}/jobs/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(recoveryRequest)
      .expect(202);
    expect(jobRecoveryResponseSchema.parse(replay.body).data.recovery.id).toBe(
      recoveredData.recovery.id,
    );

    const resumedRepository = new WorkerGenerationRepository();
    try {
      await new GenerationJobProcessor(resumedRepository, new FakeAiProvider()).process(payload);
    } finally {
      await resumedRepository.onModuleDestroy();
    }

    const completed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(completed.body).data).toMatchObject({
      status: "waiting_review",
      error: null,
    });
    const overrunUsage = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM usage_records
       WHERE job_id = $1 AND step_key = 'draft' AND completion_tokens = 500_000`,
      [job.id],
    );
    expect(overrunUsage.rows[0]?.count).toBe("1");
  });

  it("restarts after a kill at every step boundary without duplicating versions or charges", async () => {
    const owner = await createAuthenticatedAgent("generation-crash-boundary@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-crash-boundary",
    );
    const payload = await readWorkerPayload(job.id);
    const crashed = new Set<WorkerJobStep>();

    for (const boundary of WORKER_JOB_STEPS) {
      const repository = new WorkerGenerationRepository();
      const processor = new GenerationJobProcessor(repository, new FakeAiProvider());
      processor.setStepBoundaryHook((step) => {
        if (step === boundary && !crashed.has(step)) {
          crashed.add(step);
          throw new SimulatedWorkerCrash(step);
        }
      });
      try {
        await expect(processor.process(payload)).rejects.toBeInstanceOf(SimulatedWorkerCrash);
      } finally {
        await repository.onModuleDestroy();
      }
    }

    const finalRepository = new WorkerGenerationRepository();
    try {
      await new GenerationJobProcessor(finalRepository, new FakeAiProvider()).process(payload);
    } finally {
      await finalRepository.onModuleDestroy();
    }

    const completed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(completed.body).data).toMatchObject({
      status: "waiting_review",
      progress: 100,
      error: null,
      checkpoint: {
        schemaVersion: 1,
        step: "await_review",
      },
    });

    const evidence = await databasePool.query<{
      versions: string;
      packs: string;
      reservations: string;
      usage_records: string;
      checkpoint_versions: string;
      step_attempts: string;
      job_tokens: string;
      usage_tokens: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM chapter_versions WHERE generation_job_id = $1) AS versions,
         (SELECT count(*)::text FROM context_pack_versions WHERE job_id = $1) AS packs,
         (SELECT count(*)::text FROM cost_reservations WHERE job_id = $1) AS reservations,
         (SELECT count(*)::text FROM usage_records WHERE job_id = $1) AS usage_records,
         (SELECT count(*)::text FROM job_checkpoints WHERE job_id = $1) AS checkpoint_versions,
         (SELECT count(*)::text FROM job_step_attempts WHERE job_id = $1) AS step_attempts,
         (SELECT cost->>'totalTokens' FROM jobs WHERE id = $1) AS job_tokens,
         (SELECT coalesce(sum(prompt_tokens + completion_tokens), 0)::text FROM usage_records WHERE job_id = $1) AS usage_tokens`,
      [job.id],
    );
    expect(evidence.rows[0]).toMatchObject({
      versions: "2",
      packs: "1",
      reservations: "3",
      usage_records: "3",
    });
    expect(evidence.rows[0]?.job_tokens).toBe(evidence.rows[0]?.usage_tokens);
    expect(Number(evidence.rows[0]?.checkpoint_versions)).toBeGreaterThanOrEqual(
      WORKER_JOB_STEPS.length,
    );
    expect(Number(evidence.rows[0]?.step_attempts)).toBeGreaterThanOrEqual(WORKER_JOB_STEPS.length);

    const checkpoints = await databasePool.query<{
      revision: number;
      schema_version: number;
      input_hash: string | null;
    }>(
      `SELECT revision, schema_version, input_hash
       FROM job_checkpoints
       WHERE job_id = $1
       ORDER BY revision`,
      [job.id],
    );
    expect(checkpoints.rows.every((row) => row.schema_version === 1)).toBe(true);
    expect(checkpoints.rows.every((row) => row.input_hash?.length === 64)).toBe(true);
    expect(new Set(checkpoints.rows.map((row) => row.revision)).size).toBe(checkpoints.rows.length);

    const attempts = await databasePool.query<{ step_key: string; attempt: number }>(
      `SELECT step_key, attempt
       FROM job_step_attempts
       WHERE job_id = $1 AND step_key IN ('draft', 'verify', 'revise')
       ORDER BY step_key`,
      [job.id],
    );
    expect(attempts.rows).toEqual([
      { step_key: "draft", attempt: 1 },
      { step_key: "revise", attempt: 1 },
      { step_key: "verify", attempt: 1 },
    ]);
  });

  it("retries a provider rate limit with bounded backoff and settles only the successful attempt", async () => {
    const owner = await createAuthenticatedAgent("generation-backoff@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(owner, token, branchPath, chapter.id, "generation-backoff");
    const fake = new FakeAiProvider();
    let draftCalls = 0;
    const provider: AiGateway = {
      async generateText(input) {
        if (input.operation === "draft" && draftCalls++ === 0) {
          throw new AiProviderError("rate limited", { failureClass: "rate_limit" });
        }
        return fake.generateText(input);
      },
      streamText(input) {
        return fake.streamText(input);
      },
    };
    const delays: number[] = [];
    const repository = new WorkerGenerationRepository();
    const processor = new GenerationJobProcessor(repository, provider);
    processor.configureRecovery({
      maxAutomaticAttempts: 2,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });
    try {
      await processor.process(await readWorkerPayload(job.id));
    } finally {
      await repository.onModuleDestroy();
    }

    expect(delays).toEqual([1_000]);
    const completed = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(completed.body).data).toMatchObject({
      status: "waiting_review",
      error: null,
    });
    const calls = await databasePool.query<{
      attempt: number;
      status: string;
      failure_class: string | null;
    }>(
      `SELECT attempt, status, failure_class
       FROM model_calls
       WHERE job_id = $1 AND step_key = 'draft'
       ORDER BY attempt`,
      [job.id],
    );
    expect(calls.rows).toEqual([
      { attempt: 1, status: "failed", failure_class: "rate_limit" },
      { attempt: 2, status: "succeeded", failure_class: null },
    ]);
    const reservations = await databasePool.query<{ status: string }>(
      `SELECT status
       FROM cost_reservations
       WHERE job_id = $1 AND idempotency_key LIKE 'generation:draft:%'
       ORDER BY created_at`,
      [job.id],
    );
    expect(reservations.rows.map((row) => row.status)).toEqual(["released", "settled"]);
    const attemptHashes = await databasePool.query<{ input_hash: string }>(
      `SELECT input_hash
       FROM job_step_attempts
       WHERE job_id = $1 AND step_key = 'draft'
       ORDER BY attempt`,
      [job.id],
    );
    expect(attemptHashes.rows).toHaveLength(2);
    expect(attemptHashes.rows[0]?.input_hash).toBe(attemptHashes.rows[1]?.input_hash);
  });

  it("recovers a cancelled job from the last checkpoint with permission, audit, and idempotency", async () => {
    const owner = await createAuthenticatedAgent("generation-recover-owner@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-recover-cancelled",
    );
    const payload = await readWorkerPayload(job.id);
    const repository = new WorkerGenerationRepository();
    const processor = new GenerationJobProcessor(repository, new FakeAiProvider());
    processor.setStepBoundaryHook(async (step) => {
      if (step === "compile_context") {
        await owner
          .post(`${branchPath}/jobs/${job.id}/cancel`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200);
      }
    });
    try {
      await processor.process(payload);
    } finally {
      await repository.onModuleDestroy();
    }

    const cancelledResponse = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    const cancelledJob = generationJobResponseSchema.parse(cancelledResponse.body).data;
    expect(cancelledJob).toMatchObject({
      status: "cancelled",
      checkpoint: { step: "compile_context" },
    });
    const recoveryRequest = {
      reason: "作者确认从编译后的检查点继续",
      idempotencyKey: "recover-cancelled-once",
      expectedCheckpointVersion: cancelledJob.checkpoint.revision,
    };

    const other = await createAuthenticatedAgent("generation-recover-other@example.com");
    const otherToken = await csrf(other);
    const forbidden = await other
      .post(`${branchPath}/jobs/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send(recoveryRequest)
      .expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    const conflict = await owner
      .post(`${branchPath}/jobs/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        ...recoveryRequest,
        idempotencyKey: "recover-cancelled-stale",
        expectedCheckpointVersion: Math.max(0, cancelledJob.checkpoint.revision - 1),
      })
      .expect(409);
    expect(conflict.body.error.code).toBe("JOB_RECOVERY_CONFLICT");

    const recovered = await owner
      .post(`${branchPath}/jobs/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(recoveryRequest)
      .expect(202);
    const recovery = jobRecoveryResponseSchema.parse(recovered.body).data;
    expect(recovery.recovery).toMatchObject({
      jobId: job.id,
      action: "retry",
      reason: recoveryRequest.reason,
      idempotencyKey: recoveryRequest.idempotencyKey,
      fromStatus: "cancelled",
      fromCheckpointVersion: cancelledJob.checkpoint.revision,
      resumeStep: "draft",
    });
    expect(recovery.recovery.checkpointVersion).toBeGreaterThan(
      recovery.recovery.fromCheckpointVersion,
    );

    const replay = await owner
      .post(`${branchPath}/jobs/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(recoveryRequest)
      .expect(202);
    expect(jobRecoveryResponseSchema.parse(replay.body).data.recovery.id).toBe(
      recovery.recovery.id,
    );

    const provider = new FakeAiProvider();
    const generateText = vi.spyOn(provider, "generateText");
    const resumedRepository = new WorkerGenerationRepository();
    try {
      await new GenerationJobProcessor(resumedRepository, provider).process(payload);
    } finally {
      await resumedRepository.onModuleDestroy();
    }
    expect(generateText.mock.calls.map(([input]) => input.operation)).toEqual([
      "draft",
      "verify",
      "revise",
    ]);

    const finished = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(finished.body).data).toMatchObject({
      status: "waiting_review",
      error: null,
      checkpoint: { step: "await_review" },
    });
    const evidence = await databasePool.query<{
      recoveries: string;
      audits: string;
      packs: string;
    }>(
      `SELECT
         (SELECT count(*)::text FROM job_recoveries WHERE job_id = $1) AS recoveries,
         (SELECT count(*)::text FROM audit_logs
          WHERE target_type = 'job' AND target_id = $1 AND action = 'job.recovered') AS audits,
         (SELECT count(*)::text FROM context_pack_versions WHERE job_id = $1) AS packs`,
      [job.id],
    );
    expect(evidence.rows[0]).toEqual({ recoveries: "1", audits: "1", packs: "1" });
  });

  it("releases interrupted in-flight reservations before starting the next attempt", async () => {
    const owner = await createAuthenticatedAgent("generation-interrupted-call@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    const chapter = await createChapter(owner, token, branchPath);
    await createModelConfig(owner, token);
    const job = await startGeneration(
      owner,
      token,
      branchPath,
      chapter.id,
      "generation-interrupted-call",
    );
    let payload = await readWorkerPayload(job.id);

    const interruptedRepository = new WorkerGenerationRepository();
    const interruptedProcessor = new GenerationJobProcessor(
      interruptedRepository,
      new FakeAiProvider(),
    );
    interruptedProcessor.setStepBoundaryHook((step) => {
      if (step === "compile_context") {
        throw new SimulatedWorkerCrash(step);
      }
    });
    try {
      await expect(interruptedProcessor.process(payload)).rejects.toBeInstanceOf(
        SimulatedWorkerCrash,
      );
    } finally {
      await interruptedRepository.onModuleDestroy();
    }

    payload = await readWorkerPayload(job.id);
    const orphanRepository = new WorkerGenerationRepository();
    try {
      await orphanRepository.startStep(payload, "draft", "a".repeat(64), 55);
      await orphanRepository.beginModelCall({
        payload,
        step: "draft",
        attempt: 1,
        role: "writer",
        prompt: "中断前已发出的草稿请求",
        system: "只输出正文",
        citations: [],
        estimatedTokens: 100,
        estimatedCostCny: 0.01,
        parameters: { operation: "draft" },
      });
    } finally {
      await orphanRepository.onModuleDestroy();
    }

    const resumedRepository = new WorkerGenerationRepository();
    try {
      await new GenerationJobProcessor(resumedRepository, new FakeAiProvider()).process(payload);
    } finally {
      await resumedRepository.onModuleDestroy();
    }

    const calls = await databasePool.query<{
      attempt: number;
      status: string;
      failure_class: string | null;
      error_code: string | null;
    }>(
      `SELECT attempt, status, failure_class, error_code
       FROM model_calls
       WHERE job_id = $1 AND step_key = 'draft'
       ORDER BY attempt`,
      [job.id],
    );
    expect(calls.rows).toEqual([
      {
        attempt: 1,
        status: "failed",
        failure_class: "unknown",
        error_code: "WORKER_INTERRUPTED",
      },
      {
        attempt: 2,
        status: "succeeded",
        failure_class: null,
        error_code: null,
      },
    ]);
    const reservations = await databasePool.query<{ status: string; settled_tokens: number }>(
      `SELECT status, settled_tokens
       FROM cost_reservations
       WHERE job_id = $1 AND idempotency_key LIKE 'generation:draft:%'
       ORDER BY created_at`,
      [job.id],
    );
    expect(reservations.rows).toEqual([
      { status: "released", settled_tokens: 0 },
      { status: "settled", settled_tokens: expect.any(Number) },
    ]);
    expect(reservations.rows[1]?.settled_tokens).toBeGreaterThan(0);
  });

  async function startGeneration(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapterId: string,
    idempotencyKey: string,
    budget = { maxCostCny: 2.5, maxTokens: 12_000, maxRevisionRounds: 2 },
  ) {
    const response = await agent
      .post(`${branchPath}/chapters/${chapterId}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", idempotencyKey)
      .send({ budget })
      .expect(202);
    return generationJobResponseSchema.parse(response.body).data;
  }

  async function userIdFor(agent: SuperAgentTest): Promise<string> {
    const response = await agent.get("/api/v1/auth/me").expect(200);
    return response.body.data.user.id as string;
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
        number: 1,
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

async function resetDatabase(pool: ReturnType<typeof createDatabasePool>): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await pool.query("TRUNCATE TABLE users CASCADE");
      return;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (attempt < 3 && (code === "40P01" || code === "55P03")) {
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        continue;
      }
      throw error;
    }
  }
}
