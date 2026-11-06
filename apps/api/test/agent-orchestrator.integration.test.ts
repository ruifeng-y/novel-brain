import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  agentGrantResponseSchema,
  ORCHESTRATOR_CONTRACT_VERSION,
  type AgentGrant,
  type AgentGrantCreateRequest,
  type OrchestratorApproveTaskCommand,
  type OrchestratorPauseCommand,
  type OrchestratorRunState,
  type OrchestratorScheduleCommand,
  type OrchestratorTask,
} from "@novel-brain/contracts";
import { AgentGrantStore, createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AgentGrantGuard } from "../../worker/src/agent-runtime/agent-grant.guard";
import {
  AgentOrchestrator,
  AgentOrchestratorRepository,
  type OrchestratorToolExecutor,
} from "../../worker/src/agent-runtime/agent-orchestrator";
import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
const origin = "http://localhost:3000";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3001";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("agent orchestrator integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "agent-orchestrator-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "agent-orchestrator-integration-proxy-secret";
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

  it("rejects unauthorized grants before scheduling and survives a worker restart", async () => {
    const owner = await createAuthenticatedAgent("orchestrator-owner@example.com");
    const ownerId = await userIdFor(owner);
    const other = await createAuthenticatedAgent("orchestrator-other@example.com");
    const otherId = await userIdFor(other);
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = branchPathFor(work);
    const draftTaskId = uuidv7();
    const reviseTaskId = uuidv7();
    const draftGrant = await createGrant(
      owner,
      token,
      branchPath,
      grantRequest(draftTaskId, ["context.read_pack", "draft.write_version"]),
    );
    const reviseGrant = await createGrant(
      owner,
      token,
      branchPath,
      grantRequest(reviseTaskId, ["draft.write_version"]),
    );
    const runId = uuidv7();
    const command = scheduleCommand(work, runId, ownerId, [
      task(draftTaskId, "draft", draftGrant.id, 20),
      task(reviseTaskId, "revise", reviseGrant.id, 10, ["draft"]),
    ]);

    const store = new AgentGrantStore(databaseUrl);
    const repository = new AgentOrchestratorRepository(databaseUrl);
    const guard = new AgentGrantGuard(store);
    const orchestrator = new AgentOrchestrator(repository, guard);
    let restarted: AgentOrchestrator | undefined;
    let restartedStore: AgentGrantStore | undefined;
    try {
      const first = await orchestrator.schedule(command, audit("schedule"));
      const duplicate = await orchestrator.schedule(command, audit("schedule-duplicate"));
      expect(duplicate).toEqual(first);
      await expect(orchestrator.get(runId, otherId)).rejects.toMatchObject({
        code: "run_not_found",
      });
      const jobs = await databasePool.query<{ count: string }>(
        "SELECT count(*) FROM jobs WHERE user_id = $1 AND type = 'agent_workflow'",
        [first.ownerId],
      );
      expect(jobs.rows[0]?.count).toBe("1");

      const unauthorized = scheduleCommand(work, uuidv7(), ownerId, [
        {
          ...task(draftTaskId, "curate", draftGrant.id, 10),
          role: "critic",
          steps: [
            {
              key: "read",
              toolName: "context.read_pack",
              input: { taskId: draftTaskId },
              estimatedCostCny: 0,
              estimatedTokens: 10,
            },
          ],
        },
      ]);
      await expect(
        orchestrator.schedule(unauthorized, audit("unauthorized")),
      ).rejects.toMatchObject({
        code: "grant_role_mismatch",
      });
      const afterRejection = await databasePool.query<{ count: string }>(
        "SELECT count(*) FROM jobs WHERE user_id = $1 AND type = 'agent_workflow'",
        [first.ownerId],
      );
      expect(afterRejection.rows[0]?.count).toBe("1");

      const subtaskId = uuidv7();
      const subtaskGrant = await createGrant(
        owner,
        token,
        branchPath,
        grantRequest(subtaskId, ["context.read_pack"]),
      );
      await expect(
        orchestrator.command(
          {
            type: "add_subtasks",
            schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
            commandId: uuidv7(),
            runId,
            actor: { type: "agent", id: subtaskGrant.id },
            parentTaskKey: "draft",
            tasks: [
              {
                ...task(subtaskId, "curate", subtaskGrant.id, 10, ["draft"]),
                role: "critic",
                steps: [
                  {
                    key: "read",
                    toolName: "context.read_pack",
                    input: { taskId: draftTaskId },
                    estimatedCostCny: 0,
                    estimatedTokens: 10,
                  },
                ],
              },
            ],
          },
          first.ownerId,
          audit("unauthorized-subtask"),
        ),
      ).rejects.toMatchObject({ code: "grant_role_mismatch" });
      const afterSubtaskRejection = await orchestrator.get(runId, first.ownerId);
      expect(afterSubtaskRejection.tasks).toHaveLength(2);

      const calls: string[] = [];
      const executor: OrchestratorToolExecutor = async ({ task: currentTask }) => {
        calls.push(currentTask.key);
        return { output: { taskKey: currentTask.key } };
      };
      const firstStep = await orchestrator.executeNext(
        runId,
        first.ownerId,
        executor,
        audit("run-1"),
      );
      expect(firstStep.executed).toEqual({ taskKey: "draft", stepKey: "write" });
      expect(calls).toEqual(["draft"]);

      restartedStore = new AgentGrantStore(databaseUrl);
      restarted = new AgentOrchestrator(
        new AgentOrchestratorRepository(databaseUrl),
        new AgentGrantGuard(restartedStore),
      );
      const secondStep = await restarted.executeNext(
        runId,
        first.ownerId,
        executor,
        audit("run-2"),
      );
      expect(secondStep.executed).toEqual({ taskKey: "revise", stepKey: "write" });
      expect(secondStep.state.status).toBe("completed");
      expect(calls).toEqual(["draft", "revise"]);

      const persisted = await databasePool.query<{
        status: string;
        orchestration: OrchestratorRunState;
      }>("SELECT status, orchestration FROM jobs WHERE id = $1", [runId]);
      expect(persisted.rows[0]?.status).toBe("completed");
      expect(persisted.rows[0]?.orchestration.tasks.map((candidate) => candidate.status)).toEqual([
        "succeeded",
        "succeeded",
      ]);
      const steps = await databasePool.query<{ step_key: string; status: string }>(
        "SELECT step_key, status FROM job_steps WHERE job_id = $1 ORDER BY step_key",
        [runId],
      );
      expect(steps.rows).toEqual([
        { step_key: "draft.write", status: "succeeded" },
        { step_key: "revise.write", status: "succeeded" },
      ]);
      const toolCalls = await databasePool.query<{ count: string }>(
        "SELECT count(*) FROM agent_tool_calls WHERE task_id = ANY($1::uuid[])",
        [[draftTaskId, reviseTaskId]],
      );
      expect(toolCalls.rows[0]?.count).toBe("2");
      const eventPayloads = await databasePool.query<{ payload: string }>(
        "SELECT payload::text AS payload FROM job_events WHERE job_id = $1",
        [runId],
      );
      expect(eventPayloads.rows.map((row) => row.payload).join(" ")).not.toContain("draft content");
      expect(eventPayloads.rows.map((row) => row.payload).join(" ")).toContain("outputKeys");
    } finally {
      await restarted?.close();
      await restartedStore?.close();
      await orchestrator.close();
      await store.close();
    }
  });

  it("pauses and resumes at a committed step boundary, then cancels remaining work", async () => {
    const owner = await createAuthenticatedAgent("orchestrator-pause@example.com");
    const ownerId = await userIdFor(owner);
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = branchPathFor(work);
    const taskId = uuidv7();
    const grant = await createGrant(
      owner,
      token,
      branchPath,
      grantRequest(taskId, ["draft.write_version"]),
    );
    const runId = uuidv7();
    const store = new AgentGrantStore(databaseUrl);
    const orchestrator = new AgentOrchestrator(
      new AgentOrchestratorRepository(databaseUrl),
      new AgentGrantGuard(store),
    );
    const calls: string[] = [];
    const executor: OrchestratorToolExecutor = async ({ task: currentTask }) => {
      calls.push(currentTask.key);
      return { output: { taskKey: currentTask.key } };
    };
    try {
      const scheduled = await orchestrator.schedule(
        scheduleCommand(work, runId, ownerId, [task(taskId, "draft", grant.id, 10)]),
        audit("pause-schedule"),
      );
      const paused = await orchestrator.command(
        pauseCommand(runId, scheduled.ownerId),
        scheduled.ownerId,
        audit("pause"),
      );
      expect(paused.status).toBe("paused");
      const skipped = await orchestrator.executeNext(
        runId,
        scheduled.ownerId,
        executor,
        audit("execute-paused"),
      );
      expect(skipped.executed).toBeNull();
      expect(calls).toEqual([]);

      const resumed = await orchestrator.command(
        {
          type: "resume",
          schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
          commandId: uuidv7(),
          runId,
          actor: { type: "human", id: scheduled.ownerId },
        },
        scheduled.ownerId,
        audit("resume"),
      );
      expect(resumed.status).toBe("queued");
      const executed = await orchestrator.executeNext(
        runId,
        scheduled.ownerId,
        executor,
        audit("execute-resumed"),
      );
      expect(executed.executed).toEqual({ taskKey: "draft", stepKey: "write" });
      expect(calls).toEqual(["draft"]);

      const cancelRunId = uuidv7();
      const cancelTaskId = uuidv7();
      const cancelGrant = await createGrant(
        owner,
        token,
        branchPath,
        grantRequest(cancelTaskId, ["draft.write_version"]),
      );
      const cancelScheduled = await orchestrator.schedule(
        scheduleCommand(work, cancelRunId, ownerId, [
          task(cancelTaskId, "draft", cancelGrant.id, 10),
        ]),
        audit("cancel-schedule"),
      );
      const cancelled = await orchestrator.command(
        {
          type: "cancel",
          schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
          commandId: uuidv7(),
          runId: cancelRunId,
          actor: { type: "human", id: cancelScheduled.ownerId },
          reason: "作者停止后续生成",
        },
        cancelScheduled.ownerId,
        audit("cancel"),
      );
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.tasks[0]?.status).toBe("cancelled");
      const afterCancel = await orchestrator.executeNext(
        cancelRunId,
        cancelScheduled.ownerId,
        executor,
        audit("execute-cancelled"),
      );
      expect(afterCancel.executed).toBeNull();
      expect(calls).toEqual(["draft"]);
    } finally {
      await orchestrator.close();
      await store.close();
    }
  });

  it("blocks high-risk work until a human approves and rechecks revocation before execution", async () => {
    const owner = await createAuthenticatedAgent("orchestrator-gate@example.com");
    const ownerId = await userIdFor(owner);
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = branchPathFor(work);
    const taskId = uuidv7();
    const grant = await createGrant(
      owner,
      token,
      branchPath,
      grantRequest(taskId, ["draft.write_version"]),
    );
    const runId = uuidv7();
    const store = new AgentGrantStore(databaseUrl);
    const orchestrator = new AgentOrchestrator(
      new AgentOrchestratorRepository(databaseUrl),
      new AgentGrantGuard(store),
    );
    const calls: string[] = [];
    const executor: OrchestratorToolExecutor = async ({ task: currentTask }) => {
      calls.push(currentTask.key);
      return { output: { taskKey: currentTask.key } };
    };
    try {
      const command = scheduleCommand(work, runId, ownerId, [
        {
          ...task(taskId, "risky", grant.id, 10),
          risk: "high",
          approval: "human",
        },
      ]);
      const scheduled = await orchestrator.schedule(command, audit("gate-schedule"));
      expect(scheduled.tasks[0]?.status).toBe("waiting_review");
      const blocked = await orchestrator.executeNext(
        runId,
        scheduled.ownerId,
        executor,
        audit("execute-before-approval"),
      );
      expect(blocked.executed).toBeNull();
      expect(calls).toEqual([]);

      await expect(
        orchestrator.command(
          {
            type: "approve_task",
            schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
            commandId: uuidv7(),
            runId,
            actor: { type: "agent", id: grant.id },
            taskKey: "risky",
            approvalId: uuidv7(),
          } as unknown as OrchestratorApproveTaskCommand,
          scheduled.ownerId,
          audit("agent-approval"),
        ),
      ).rejects.toThrow();

      const approved = await orchestrator.command(
        {
          type: "approve_task",
          schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
          commandId: uuidv7(),
          runId,
          actor: { type: "human", id: scheduled.ownerId },
          taskKey: "risky",
          approvalId: uuidv7(),
        },
        scheduled.ownerId,
        audit("human-approval"),
      );
      expect(approved.tasks[0]?.status).toBe("ready");

      await owner
        .post(`${branchPath}/agent-grants/${grant.id}/revoke`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ reason: "执行前撤销" })
        .expect(200);
      const replay = await orchestrator.schedule(command, audit("gate-replay"));
      expect(replay.runId).toBe(scheduled.runId);
      expect(replay.tasks[0]?.approvedBy).toBe(ownerId);
      await expect(
        orchestrator.executeNext(runId, scheduled.ownerId, executor, audit("execute-after-revoke")),
      ).rejects.toMatchObject({ code: "grant_revoked" });
      expect(calls).toEqual([]);
    } finally {
      await orchestrator.close();
      await store.close();
    }
  });

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
        displayName: "编排作者",
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
      .set("Idempotency-Key", uuidv7())
      .send({
        mode: "idea",
        title: "编排测试书",
        idea: "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);
    return response.body.data as { id: string; mainBranch: { id: string } };
  }

  async function userIdFor(agent: SuperAgentTest): Promise<string> {
    const response = await agent.get("/api/v1/auth/me").expect(200);
    return response.body.data.user.id as string;
  }

  async function createGrant(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    body: AgentGrantCreateRequest,
  ): Promise<AgentGrant> {
    const response = await agent
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body)
      .expect(201);
    return agentGrantResponseSchema.parse(response.body).data;
  }

  function scheduleCommand(
    work: { id: string; mainBranch: { id: string } },
    runId: string,
    ownerId: string,
    tasks: OrchestratorTask[],
  ): OrchestratorScheduleCommand {
    return {
      type: "schedule",
      schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
      commandId: uuidv7(),
      runId,
      idempotencyKey: `workflow:${runId}`,
      workId: work.id,
      branchId: work.mainBranch.id,
      actor: { type: "human", id: ownerId },
      envelope: {
        key: "chapter.agent.v1",
        version: 1,
        maxTasks: 8,
        maxDepth: 4,
        maxFanOut: 4,
        maxConcurrency: 2,
        dynamicSubtasks: true,
        budget: { maxCostCny: 5, maxTokens: 30_000, maxCalls: 20 },
      },
      tasks,
    };
  }

  function task(
    taskId: string,
    key: string,
    grantId: string,
    priority: number,
    dependsOn: string[] = [],
  ): OrchestratorTask {
    return {
      id: taskId,
      key,
      title: key,
      priority,
      dependsOn,
      role: "writer",
      grantId,
      resource: { type: "chapter", id: CHAPTER_ID },
      affectedResources: 1,
      risk: "low",
      approval: "none",
      steps: [
        {
          key: "write",
          toolName: "draft.write_version",
          input: { chapterId: CHAPTER_ID, content: `${key} content` },
          estimatedCostCny: 0.1,
          estimatedTokens: 100,
        },
      ],
    };
  }

  function grantRequest(taskId: string, tools: AgentGrantCreateRequest["tools"]) {
    return {
      taskId,
      role: "writer" as const,
      tools,
      resourceScope: {
        chapterIds: [CHAPTER_ID],
        settingIds: [],
        includeCanon: false,
      },
      budget: {
        maxCostCny: 2,
        maxTokens: 12_000,
        maxCalls: 8,
      },
      maxImpact: {
        maxSideEffect: "S1" as const,
        maxAffectedResources: 1,
      },
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    };
  }

  function branchPathFor(work: { id: string; mainBranch: { id: string } }): string {
    return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  }
});

function pauseCommand(runId: string, ownerId: string): OrchestratorPauseCommand {
  return {
    type: "pause",
    schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
    commandId: uuidv7(),
    runId,
    actor: { type: "human", id: ownerId },
    reason: "作者暂停",
  };
}

function audit(suffix: string) {
  return {
    requestId: `req_orchestrator_${suffix}`,
    ip: "127.0.0.1",
    userAgent: "vitest-agent-orchestrator",
  };
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
