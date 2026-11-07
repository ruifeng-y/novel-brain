import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  agentRunTraceListResponseSchema,
  chapterVersionListResponseSchema,
  generationJobListResponseSchema,
  writeActionJobSchema,
  writingActionJobListResponseSchema,
  writingActionRecoveryResponseSchema,
  writingActionJobResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { AiProviderError, FakeAiProvider, type AiGateway } from "@novel-brain/ai";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { WorkerGenerationRepository } from "../../worker/src/generation/generation.repository";
import { WritingActionProcessor } from "../../worker/src/writing-actions/writing-action.processor";

const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
const databaseUrl = dedicatedDatabaseUrl(`novelbrain_test_116_${suffix}`);
const redisUrl = dedicatedRedisUrl();
const origin = "http://localhost:3000";
const sourceContent = "风停。\n\nSELECTED_BLOCK\n\n钟声未响。";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("writing action HTTP and worker integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "writing-action-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "writing-action-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.AI_PROVIDER_MODE = "fake";
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

  it("runs all nine actions through the API and fake worker with versions, cost and trace", async () => {
    const owner = await createAuthenticatedAgent("writing-actions-owner@example.com");
    const fixture = await createWritingFixture(owner);
    const selectionStart = sourceContent.indexOf("SELECTED_BLOCK");
    const requests = [
      {
        action: "continue",
        sourceVersionId: fixture.sourceVersionId,
        targetLength: 500,
      },
      {
        action: "rewrite",
        sourceVersionId: fixture.sourceVersionId,
        instruction: "收紧动作描写",
      },
      {
        action: "expand",
        sourceVersionId: fixture.sourceVersionId,
        targetLength: 900,
      },
      {
        action: "condense",
        sourceVersionId: fixture.sourceVersionId,
        targetLength: 300,
      },
      {
        action: "change_pov",
        sourceVersionId: fixture.sourceVersionId,
        pov: "顾青",
      },
      {
        action: "add_hook",
        sourceVersionId: fixture.sourceVersionId,
        hookStyle: "reversal",
      },
      {
        action: "generate_title",
        sourceVersionId: fixture.sourceVersionId,
        count: 3,
      },
      {
        action: "generate_summary",
        sourceVersionId: fixture.sourceVersionId,
        maxLength: 160,
      },
      {
        action: "selection_rewrite",
        sourceVersionId: fixture.sourceVersionId,
        selection: { start: selectionStart, end: selectionStart + "SELECTED_BLOCK".length },
        instruction: "只增强紧张感",
      },
    ] as const;

    for (const [index, actionRequest] of requests.entries()) {
      const job = await startAction(
        owner,
        fixture.branchPath,
        fixture.chapterId,
        actionRequest,
        `writing-action-${actionRequest.action}-${index}`,
      );
      expect(job).toMatchObject({
        type: "write_action",
        action: actionRequest.action,
        status: "queued",
        sourceVersionId: fixture.sourceVersionId,
      });

      await runWorker(job.id);
      const completedResponse = await owner.get(`${fixture.branchPath}/write-actions/${job.id}`);
      expect(completedResponse.status, JSON.stringify(completedResponse.body)).toBe(200);
      const completed = writingActionJobResponseSchema.parse(completedResponse.body).data;
      expect(completed).toMatchObject({
        status: "waiting_review",
        progress: 100,
        error: null,
        currentStep: "await_review",
      });
      expect(completed.cost.totalTokens).toBeGreaterThan(0);
      expect(completed.contextPack?.task).toBe("chapter_revision");
      expect(completed.output?.versionNodeId).toBeTruthy();
      expect(completed.output?.provenance).toMatchObject({
        promptKey: `writing.${actionRequest.action}`,
        promptVersion: 1,
        provider: "deepseek",
        model: "deepseek-chat",
      });

      if (actionRequest.action === "generate_title") {
        expect(completed.output).toMatchObject({
          kind: "title_options",
          chapterVersionId: null,
        });
        expect(completed.output?.kind === "title_options" && completed.output.titles).toHaveLength(
          3,
        );
      } else if (actionRequest.action === "generate_summary") {
        expect(completed.output).toMatchObject({
          kind: "summary",
          chapterVersionId: null,
        });
        expect(
          completed.output?.kind === "summary" && completed.output.summary.length,
        ).toBeLessThanOrEqual(160);
      } else if (actionRequest.action === "add_hook") {
        expect(completed.output).toMatchObject({
          kind: "hooks",
          chapterVersionId: null,
        });
        expect(completed.output?.kind === "hooks" && completed.output.hooks).toHaveLength(3);
      } else {
        expect(completed.output).toMatchObject({
          kind: "chapter_text",
        });
        if (completed.output?.kind !== "chapter_text") {
          throw new Error("Expected chapter text output");
        }
        expect(completed.output.chapterVersionId).toBeTruthy();
        if (actionRequest.action === "continue") {
          expect(completed.output.content.startsWith("风停。")).toBe(true);
        }
        if (actionRequest.action === "selection_rewrite") {
          expect(completed.output.content.startsWith("风停。\n\n")).toBe(true);
          expect(completed.output.content.endsWith("\n\n钟声未响。")).toBe(true);
          expect(completed.output.content).not.toContain("SELECTED_BLOCK");
          expect(completed.output.affectedRange).toMatchObject({
            originalStart: selectionStart,
            originalEnd: selectionStart + "SELECTED_BLOCK".length,
            start: selectionStart,
          });
          expect(
            completed.output.content.slice(
              completed.output.affectedRange?.start,
              completed.output.affectedRange?.end,
            ),
          ).toContain("改写片段");
        }
      }

      const traces = agentRunTraceListResponseSchema.parse(
        (await owner.get(`${fixture.branchPath}/agent-runs?jobId=${job.id}`).expect(200)).body,
      ).data;
      expect(traces).toHaveLength(1);
      expect(traces[0]?.run.stepKey).toBe("generate");
      expect(traces[0]?.modelCalls).toHaveLength(1);
      expect(traces[0]?.modelCalls[0]?.costCny).toBeGreaterThan(0);
      expect(traces[0]?.promptVersions[0]?.key).toBe(`writing.${actionRequest.action}`);
    }

    const listed = writingActionJobListResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/chapters/${fixture.chapterId}/write-actions`)
          .expect(200)
      ).body,
    ).data;
    expect(listed).toHaveLength(9);
    const firstPage = writingActionJobListResponseSchema.parse(
      (
        await owner
          .get(`${fixture.branchPath}/chapters/${fixture.chapterId}/write-actions?limit=2`)
          .expect(200)
      ).body,
    );
    expect(firstPage.data).toHaveLength(2);
    expect(firstPage.meta.nextCursor).toEqual(expect.any(String));
    const secondPage = writingActionJobListResponseSchema.parse(
      (
        await owner
          .get(
            `${fixture.branchPath}/chapters/${fixture.chapterId}/write-actions?limit=2&cursor=${firstPage.meta.nextCursor}`,
          )
          .expect(200)
      ).body,
    );
    expect(secondPage.data.map((job) => job.id)).not.toEqual(firstPage.data.map((job) => job.id));

    const versions = chapterVersionListResponseSchema.parse(
      (await owner.get(`${fixture.branchPath}/chapters/${fixture.chapterId}/versions`).expect(200))
        .body,
    ).data;
    expect(versions.at(-1)?.content).toBe(sourceContent);
    expect(versions.some((version) => version.id === fixture.sourceVersionId)).toBe(true);

    const generationJobs = generationJobListResponseSchema.parse(
      (await owner.get(`${fixture.branchPath}/jobs?chapterId=${fixture.chapterId}`).expect(200))
        .body,
    ).data;
    expect(generationJobs).toEqual([]);

    const replayed = await startAction(
      owner,
      fixture.branchPath,
      fixture.chapterId,
      requests[1],
      "writing-action-rewrite-1",
    );
    expect(replayed.id).toBe(listed.find((job) => job.action === "rewrite")?.id);
    const stored = await databasePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM writing_actions WHERE chapter_id = $1",
      [fixture.chapterId],
    );
    expect(stored.rows[0]?.count).toBe("9");

    const other = await createAuthenticatedAgent("writing-actions-other@example.com");
    const forbidden = await other
      .get(`${fixture.branchPath}/write-actions/${listed[0]?.id}`)
      .expect(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("keeps the source manuscript after cancel and failure, then retries from checkpoint", async () => {
    const owner = await createAuthenticatedAgent("writing-actions-recovery@example.com");
    const fixture = await createWritingFixture(owner);
    const before = await versionCount(fixture.chapterId);

    const cancelled = await startAction(
      owner,
      fixture.branchPath,
      fixture.chapterId,
      {
        action: "generate_summary",
        sourceVersionId: fixture.sourceVersionId,
        maxLength: 120,
      },
      "writing-action-cancel",
    );
    const cancelToken = await csrf(owner);
    const cancelResponse = await owner
      .post(`${fixture.branchPath}/write-actions/${cancelled.id}/cancel`)
      .set("Origin", origin)
      .set("X-CSRF-Token", cancelToken)
      .send({});
    expect(cancelResponse.status, JSON.stringify(cancelResponse.body)).toBe(200);
    const cancelledResult = writingActionJobResponseSchema.parse(cancelResponse.body).data;
    expect(cancelledResult).toMatchObject({
      status: "cancelled",
      output: null,
      checkpoint: { step: "prepare" },
    });
    expect(await versionCount(fixture.chapterId)).toBe(before);

    const firstRetryToken = await csrf(owner);
    const retried = writingActionJobResponseSchema.parse(
      (
        await owner
          .post(`${fixture.branchPath}/write-actions/${cancelled.id}/retry`)
          .set("Origin", origin)
          .set("X-CSRF-Token", firstRetryToken)
          .send({})
          .expect(202)
      ).body,
    ).data;
    expect(retried.status).toBe("queued");
    await runWorker(retried.id);
    expect(
      writingActionJobResponseSchema.parse(
        (await owner.get(`${fixture.branchPath}/write-actions/${retried.id}`).expect(200)).body,
      ).data,
    ).toMatchObject({ status: "waiting_review" });

    const failingJob = await startAction(
      owner,
      fixture.branchPath,
      fixture.chapterId,
      {
        action: "rewrite",
        sourceVersionId: fixture.sourceVersionId,
        instruction: "保留事实，收紧节奏",
      },
      "writing-action-failure",
    );
    const beforeFailure = await versionCount(fixture.chapterId);
    const fake = new FakeAiProvider();
    const failingProvider: AiGateway = {
      async generateText(input) {
        if (input.operation === "rewrite") {
          throw new AiProviderError("policy blocked", { failureClass: "policy" });
        }
        return fake.generateText(input);
      },
      streamText(input) {
        return fake.streamText(input);
      },
    };
    await runWorker(failingJob.id, failingProvider);
    const failed = writingActionJobResponseSchema.parse(
      (await owner.get(`${fixture.branchPath}/write-actions/${failingJob.id}`).expect(200)).body,
    ).data;
    expect(failed).toMatchObject({
      status: "failed",
      output: null,
      checkpoint: { step: "generate" },
      error: { code: "MODEL_POLICY_BLOCKED" },
    });
    expect(await versionCount(fixture.chapterId)).toBe(beforeFailure);
    const unchanged = await databasePool.query<{ content: string }>(
      "SELECT content FROM chapter_versions WHERE id = $1",
      [fixture.sourceVersionId],
    );
    expect(unchanged.rows[0]?.content).toBe(sourceContent);

    const secondRetryToken = await csrf(owner);
    const recovered = writingActionJobResponseSchema.parse(
      (
        await owner
          .post(`${fixture.branchPath}/write-actions/${failingJob.id}/retry`)
          .set("Origin", origin)
          .set("X-CSRF-Token", secondRetryToken)
          .send({})
          .expect(202)
      ).body,
    ).data;
    await runWorker(recovered.id);
    const recoveredJob = writingActionJobResponseSchema.parse(
      (await owner.get(`${fixture.branchPath}/write-actions/${recovered.id}`).expect(200)).body,
    ).data;
    expect(recoveredJob).toMatchObject({
      status: "waiting_review",
      error: null,
      output: { kind: "chapter_text" },
    });
    expect(await versionCount(fixture.chapterId)).toBe(beforeFailure + 1);
  });

  it("settles overruns atomically and stops duplicate retries from charging again", async () => {
    const owner = await createAuthenticatedAgent("writing-action-overrun@example.com");
    const fixture = await createWritingFixture(owner);
    const before = await versionCount(fixture.chapterId);
    const job = await startAction(
      owner,
      fixture.branchPath,
      fixture.chapterId,
      {
        action: "rewrite",
        sourceVersionId: fixture.sourceVersionId,
        instruction: "保留事实，收紧节奏",
        budget: {
          maxCostCny: 100,
          maxTokens: 1_000_000,
          maxRevisionRounds: 0,
        },
      },
      "writing-action-overrun",
    );
    const recoveryToken = await csrf(owner);
    let providerCalls = 0;
    const provider: AiGateway = {
      async generateText(input) {
        providerCalls += 1;
        return {
          text: "超量返回的修订稿",
          model: input.model ?? "fake-overrun",
          finishReason: "stop",
          usage: { inputTokens: 0, outputTokens: 500_000 },
        };
      },
      async *streamText() {
        yield { text: "", done: true };
      },
    };

    const payload = await readWorkerPayload(job.id);
    const repository = new WorkerGenerationRepository();
    try {
      const processor = new WritingActionProcessor(repository, provider);
      await processor.process(payload);
      await processor.process(payload);
    } finally {
      await repository.onModuleDestroy();
    }

    const paused = writingActionJobResponseSchema.parse(
      (await owner.get(`${fixture.branchPath}/write-actions/${job.id}`).expect(200)).body,
    ).data;
    expect(paused).toMatchObject({
      status: "paused",
      output: null,
      checkpoint: { step: "generate" },
      error: { code: "JOB_BUDGET_EXCEEDED" },
      cost: {
        inputTokens: 0,
        outputTokens: 500_000,
        totalTokens: 500_000,
        costCny: 1,
      },
    });
    expect(providerCalls).toBe(1);
    expect(await versionCount(fixture.chapterId)).toBe(before);
    const modelCall = await databasePool.query<{
      status: string;
      failure_class: string;
      input_tokens: number;
      output_tokens: number;
    }>(
      `SELECT status, failure_class, input_tokens, output_tokens
       FROM model_calls
       WHERE job_id = $1`,
      [job.id],
    );
    expect(modelCall.rows[0]).toEqual({
      status: "failed",
      failure_class: "budget",
      input_tokens: 0,
      output_tokens: 500_000,
    });
    const usage = await databasePool.query<{
      prompt_tokens: number;
      completion_tokens: number;
      cost_cny: number;
    }>(
      `SELECT prompt_tokens, completion_tokens, cost_cny
       FROM usage_records
       WHERE job_id = $1 AND step_key = 'generate'`,
      [job.id],
    );
    expect(usage.rows).toEqual([
      {
        prompt_tokens: 0,
        completion_tokens: 500_000,
        cost_cny: 1,
      },
    ]);
    const reservation = await databasePool.query<{
      status: string;
      settled_tokens: number;
      settled_cost_cny: number;
      failure_class: string;
    }>(
      `SELECT status, settled_tokens, settled_cost_cny, failure_class
       FROM cost_reservations
       WHERE job_id = $1 AND idempotency_key LIKE 'generation:generate:%'`,
      [job.id],
    );
    expect(reservation.rows).toEqual([
      {
        status: "settled",
        settled_tokens: 500_000,
        settled_cost_cny: 1,
        failure_class: "budget",
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
      reason: "作者确认提高写作动作预算并从当前断点继续",
      idempotencyKey: "writing-action-overrun-recover",
      expectedCheckpointVersion: paused.checkpoint.revision,
      budget: {
        maxCostCny: 101,
      },
    };
    const recovered = await owner
      .post(`${fixture.branchPath}/write-actions/${job.id}/recover`)
      .set("Origin", origin)
      .set("X-CSRF-Token", recoveryToken)
      .send(recoveryRequest)
      .expect(202);
    const recoveredData = writingActionRecoveryResponseSchema.parse(recovered.body).data;
    expect(recoveredData.job).toMatchObject({
      id: job.id,
      status: "queued",
      budget: {
        maxCostCny: 101,
      },
      checkpoint: { step: "generate" },
    });

    await runWorker(job.id);
    const completed = writingActionJobResponseSchema.parse(
      (await owner.get(`${fixture.branchPath}/write-actions/${job.id}`).expect(200)).body,
    ).data;
    expect(completed).toMatchObject({
      status: "waiting_review",
      error: null,
      output: { kind: "chapter_text" },
    });
    const overrunUsage = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM usage_records
       WHERE job_id = $1 AND step_key = 'generate' AND completion_tokens = 500_000`,
      [job.id],
    );
    expect(overrunUsage.rows[0]?.count).toBe("1");
  });

  async function startAction(
    agent: SuperAgentTest,
    branchPath: string,
    chapterId: string,
    body: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    const token = await csrf(agent);
    const response = await agent
      .post(`${branchPath}/chapters/${chapterId}/write-actions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", idempotencyKey)
      .send(body)
      .expect(202);
    return writingActionJobResponseSchema.parse(response.body).data;
  }

  async function runWorker(jobId: string, provider: AiGateway = new FakeAiProvider()) {
    const payload = await readWorkerPayload(jobId);
    const repository = new WorkerGenerationRepository();
    try {
      await new WritingActionProcessor(repository, provider).process(payload);
    } finally {
      await repository.onModuleDestroy();
    }
  }

  async function readWorkerPayload(jobId: string) {
    const result = await databasePool.query<{
      user_id: string;
      work_id: string;
      branch_id: string;
      chapter_id: string;
      source_version_id: string;
      model_config_id: string;
      idempotency_key: string;
      action: string;
      action_input: Record<string, unknown>;
      budget: Record<string, unknown>;
      checkpoint: Record<string, unknown>;
    }>(
      `SELECT user_id, work_id, branch_id, chapter_id, source_version_id,
              model_config_id, idempotency_key, action, action_input, budget, checkpoint
       FROM jobs WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Writing action job was not persisted");
    }
    return writeActionJobSchema.parse({
      jobId,
      jobType: "write_action",
      workId: row.work_id,
      branchId: row.branch_id,
      chapterId: row.chapter_id,
      actorId: row.user_id,
      modelConfigId: row.model_config_id,
      idempotencyKey: row.idempotency_key,
      action: row.action,
      sourceVersionId: row.source_version_id,
      input: row.action_input,
      budget: row.budget,
      checkpoint: row.checkpoint,
    });
  }

  async function versionCount(chapterId: string) {
    const result = await databasePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM chapter_versions WHERE chapter_id = $1",
      [chapterId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async function createWritingFixture(agent: SuperAgentTest) {
    const work = await createWork(agent);
    const token = await csrf(agent);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(agent, token, branchPath);
    await createConfirmedSettings(agent, token, branchPath);
    const chapter = await createChapter(agent, token, branchPath);
    await createModelConfig(agent, token);
    const saved = await agent
      .post(`${branchPath}/chapters/${chapter.id}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: chapter.version, content: sourceContent })
      .expect(201);
    return {
      branchPath,
      chapterId: chapter.id,
      sourceVersionId: saved.body.data.version.id as string,
    };
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
        displayName: "写作动作作者",
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

  async function createChapter(agent: SuperAgentTest, token: string, branchPath: string) {
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
          ],
          requiredFacts: ["左臂骨折，不能双手结印"],
        },
      })
      .expect(201);
    return response.body.data as { id: string; version: number };
  }

  async function createModelConfig(agent: SuperAgentTest, token: string) {
    const response = await agent
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-fake-writing-action-1234",
        purposes: ["writing"],
        isDefault: true,
      })
      .expect(200);
    return response.body.data as { id: string };
  }
});

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
  if (!databaseName.startsWith("novelbrain_test_116_")) {
    throw new Error("Writing action tests must use a dedicated test database");
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
  await pool.query("TRUNCATE TABLE users CASCADE");
}
