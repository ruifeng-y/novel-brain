import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  agentGrantListResponseSchema,
  agentGrantResponseSchema,
  type AgentGrantCreateRequest,
} from "@novel-brain/contracts";
import { AgentGrantStore, createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  AgentGrantGuard,
  AgentGrantViolation,
} from "../../worker/src/agent-runtime/agent-grant.guard";
import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
const origin = "http://localhost:3000";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c31";
const OUT_OF_SCOPE_CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c32";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("agent runtime HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "agent-runtime-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "agent-runtime-integration-proxy-secret";
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

  it("issues, reads and revokes tenant-scoped grants with audit evidence and RLS", async () => {
    const owner = await createAuthenticatedAgent("agent-grant-owner@example.com");
    const other = await createAuthenticatedAgent("agent-grant-other@example.com");
    const work = await createWork(owner);
    const branchPath = branchPathFor(work);
    const token = await csrf(owner);
    const request = grantRequest();

    const created = await owner
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send(request)
      .expect(201);
    const grant = agentGrantResponseSchema.parse(created.body).data;
    expect(grant).toMatchObject({
      workId: work.id,
      branchId: work.mainBranch.id,
      taskId: request.taskId,
      role: "writer",
      state: "active",
      tools: ["context.read_pack", "draft.write_version"],
      budget: {
        maxCalls: 8,
        spentCostCny: 0,
        spentTokens: 0,
        callCount: 0,
      },
      revokedAt: null,
    });

    const rejectedUnknown = await owner
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ ...request, issuedBy: grant.issuedBy })
      .expect(400);
    expect(rejectedUnknown.body.error.code).toBe("VALIDATION_INVALID");

    const rejectedEscalation = await owner
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ ...request, role: "critic" })
      .expect(400);
    expect(rejectedEscalation.body.error.code).toBe("AGENT_GRANT_INVALID");

    const rejectedTool = await owner
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ ...request, tools: ["grant.issue"] })
      .expect(400);
    expect(rejectedTool.body.error.code).toBe("AGENT_GRANT_INVALID");

    const listed = await owner.get(`${branchPath}/agent-grants`).expect(200);
    expect(agentGrantListResponseSchema.parse(listed.body).data).toEqual([grant]);

    const otherToken = await csrf(other);
    expect((await other.get(`${branchPath}/agent-grants`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (await other.get(`${branchPath}/agent-grants/${grant.id}`).expect(403)).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${branchPath}/agent-grants/${grant.id}/revoke`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ reason: "越权撤销", version: grant.version })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const revoked = await owner
      .post(`${branchPath}/agent-grants/${grant.id}/revoke`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ reason: "作者取消本次生成", version: grant.version })
      .expect(200);
    const revokedGrant = agentGrantResponseSchema.parse(revoked.body).data;
    expect(revokedGrant).toMatchObject({
      state: "revoked",
      revocationReason: "作者取消本次生成",
    });
    expect(revokedGrant.revokedAt).toBeTruthy();

    const audit = await databasePool.query<{ action: string; decision: string }>(
      "SELECT action, decision FROM audit_logs WHERE target_id = $1 ORDER BY created_at",
      [grant.id],
    );
    expect(audit.rows).toEqual([
      { action: "agent_grant.issue", decision: "allow" },
      { action: "agent_grant.revoke", decision: "allow" },
    ]);

    const otherUserId = await userIdFor(other);
    await databasePool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'novelbrain_rls_test') THEN
          CREATE ROLE novelbrain_rls_test NOLOGIN;
        END IF;
      END
      $$;
    `);
    await databasePool.query("GRANT USAGE ON SCHEMA public TO novelbrain_rls_test");
    await databasePool.query(
      "GRANT SELECT ON agent_grants, agent_tool_calls TO novelbrain_rls_test",
    );
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE novelbrain_rls_test");
      await client.query("SELECT set_config('app.user_id', $1, true)", [otherUserId]);
      const hidden = await client.query<{ count: string }>("SELECT count(*) FROM agent_grants");
      expect(hidden.rows[0]?.count).toBe("0");
      await client.query("SELECT set_config('app.user_id', $1, true)", [grant.userId]);
      const visible = await client.query<{ count: string }>("SELECT count(*) FROM agent_grants");
      expect(visible.rows[0]?.count).toBe("1");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rechecks revocation at queue dispatch and before every running tool call", async () => {
    const owner = await createAuthenticatedAgent("agent-grant-boundary@example.com");
    const work = await createWork(owner);
    const branchPath = branchPathFor(work);
    const token = await csrf(owner);
    const grant = await createGrant(owner, token, branchPath, grantRequest());
    const store = new AgentGrantStore(databaseUrl);
    const guard = new AgentGrantGuard(store);
    const audit = auditContext("dispatch");

    try {
      await expect(
        guard.assertDispatch({
          userId: grant.userId,
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          audit,
        }),
      ).resolves.toMatchObject({ id: grant.id, state: "active" });

      const allowed = await guard.authorizeToolCall({
        userId: grant.userId,
        workId: grant.workId,
        branchId: grant.branchId,
        taskId: grant.taskId,
        grantId: grant.id,
        toolName: "draft.write_version",
        resource: { type: "chapter", id: CHAPTER_ID },
        input: { chapterId: CHAPTER_ID, content: "沈砚用右手结印。" },
        affectedResources: 1,
        estimatedCostCny: 0.05,
        estimatedTokens: 100,
        approval: null,
        audit,
      });
      expect(allowed.decision).toMatchObject({ decision: "allow", reason: "allowed" });

      await expect(
        guard.authorizeToolCall({
          userId: grant.userId,
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          toolName: "draft.write_version",
          resource: { type: "chapter", id: CHAPTER_ID },
          input: { chapterId: CHAPTER_ID, content: "草稿", canonCommit: true },
          affectedResources: 1,
          estimatedCostCny: 0.05,
          estimatedTokens: 100,
          approval: null,
          audit: auditContext("invalid-input"),
        }),
      ).rejects.toMatchObject({ code: "invalid_tool_input" });

      await owner
        .post(`${branchPath}/agent-grants/${grant.id}/revoke`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ reason: "运行中撤销", version: grant.version })
        .expect(200);

      await expect(
        guard.assertDispatch({
          userId: grant.userId,
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          audit: auditContext("dispatch-after-revoke"),
        }),
      ).rejects.toMatchObject({ code: "grant_revoked" });

      await expect(
        guard.authorizeToolCall({
          userId: grant.userId,
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          toolName: "draft.write_version",
          resource: { type: "chapter", id: CHAPTER_ID },
          input: { chapterId: CHAPTER_ID, content: "不应写入正文。" },
          affectedResources: 1,
          estimatedCostCny: 0.05,
          estimatedTokens: 100,
          approval: null,
          audit: auditContext("running-after-revoke"),
        }),
      ).rejects.toBeInstanceOf(AgentGrantViolation);

      const calls = await databasePool.query<{
        decision: string;
        reason: string;
        input_summary: Record<string, unknown>;
      }>(
        "SELECT decision, reason, input_summary FROM agent_tool_calls WHERE grant_id = $1 ORDER BY created_at",
        [grant.id],
      );
      expect(calls.rows.map(({ decision, reason }) => ({ decision, reason }))).toEqual([
        { decision: "allow", reason: "allowed" },
        { decision: "deny", reason: "grant_revoked" },
      ]);
      expect(JSON.stringify(calls.rows[0]?.input_summary)).not.toContain("沈砚用右手结印");
      expect(calls.rows[0]?.input_summary).toEqual({
        keys: ["chapterId", "content"],
        sizeBytes: expect.any(Number),
      });

      const auditRows = await databasePool.query<{ action: string; decision: string }>(
        "SELECT action, decision FROM audit_logs WHERE target_id = $1 ORDER BY created_at",
        [grant.id],
      );
      expect(auditRows.rows.map(({ action, decision }) => `${action}:${decision}`)).toEqual([
        "agent_grant.issue:allow",
        "agent_grant.dispatch_check:allow",
        "agent_tool_call.authorize:allow",
        "agent_grant.revoke:allow",
        "agent_grant.dispatch_check:deny",
        "agent_tool_call.authorize:deny",
      ]);
    } finally {
      await store.close();
    }
  });

  it("denies expired, out-of-scope, over-budget and cross-tenant calls", async () => {
    const owner = await createAuthenticatedAgent("agent-grant-deny@example.com");
    const other = await createAuthenticatedAgent("agent-grant-intruder@example.com");
    const work = await createWork(owner);
    const branchPath = branchPathFor(work);
    const token = await csrf(owner);
    const request = grantRequest();
    const grant = await createGrant(owner, token, branchPath, request);
    const store = new AgentGrantStore(databaseUrl);
    const guard = new AgentGrantGuard(store);
    const audit = auditContext("deny");

    try {
      await expect(
        guard.authorizeToolCall({
          userId: grant.userId,
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          toolName: "draft.write_version",
          resource: { type: "chapter", id: OUT_OF_SCOPE_CHAPTER_ID },
          input: { chapterId: OUT_OF_SCOPE_CHAPTER_ID, content: "越界草稿" },
          affectedResources: 1,
          estimatedCostCny: 0.01,
          estimatedTokens: 20,
          approval: null,
          audit,
        }),
      ).rejects.toMatchObject({ code: "resource_out_of_scope" });

      await expect(
        guard.assertDispatch({
          userId: await userIdFor(other),
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          audit: auditContext("cross-tenant"),
        }),
      ).rejects.toMatchObject({ code: "grant_not_found" });

      await databasePool.query(
        "UPDATE agent_grants SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [grant.id],
      );
      const expired = await owner.get(`${branchPath}/agent-grants/${grant.id}`).expect(200);
      expect(agentGrantResponseSchema.parse(expired.body).data.state).toBe("expired");
      await expect(
        guard.authorizeToolCall({
          userId: grant.userId,
          workId: grant.workId,
          branchId: grant.branchId,
          taskId: grant.taskId,
          grantId: grant.id,
          toolName: "draft.write_version",
          resource: { type: "chapter", id: CHAPTER_ID },
          input: { chapterId: CHAPTER_ID, content: "过期后不应写入" },
          affectedResources: 1,
          estimatedCostCny: 0.01,
          estimatedTokens: 20,
          approval: null,
          audit: auditContext("expired"),
        }),
      ).rejects.toMatchObject({ code: "grant_expired" });

      const budgetGrant = await createGrant(owner, token, branchPath, {
        ...grantRequest(),
        budget: { maxCostCny: 1, maxTokens: 1000, maxCalls: 1 },
      });
      await guard.authorizeToolCall({
        userId: budgetGrant.userId,
        workId: budgetGrant.workId,
        branchId: budgetGrant.branchId,
        taskId: budgetGrant.taskId,
        grantId: budgetGrant.id,
        toolName: "draft.write_version",
        resource: { type: "chapter", id: CHAPTER_ID },
        input: { chapterId: CHAPTER_ID, content: "第一次调用" },
        affectedResources: 1,
        estimatedCostCny: 0.1,
        estimatedTokens: 100,
        approval: null,
        audit: auditContext("budget-first"),
      });
      await expect(
        guard.authorizeToolCall({
          userId: budgetGrant.userId,
          workId: budgetGrant.workId,
          branchId: budgetGrant.branchId,
          taskId: budgetGrant.taskId,
          grantId: budgetGrant.id,
          toolName: "draft.write_version",
          resource: { type: "chapter", id: CHAPTER_ID },
          input: { chapterId: CHAPTER_ID, content: "第二次调用" },
          affectedResources: 1,
          estimatedCostCny: 0.1,
          estimatedTokens: 100,
          approval: null,
          audit: auditContext("budget-second"),
        }),
      ).rejects.toMatchObject({ code: "budget_exceeded" });
    } finally {
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
        displayName: "授权作者",
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
        title: "授权测试书",
        idea: "一个失去记忆的杂役寻找自己的过去。",
        genre: "xianxia",
        scaleTarget: "long",
        chapterLengthTarget: 3000,
      })
      .expect(200);
    return response.body.data as { id: string; mainBranch: { id: string } };
  }

  async function createGrant(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    body: AgentGrantCreateRequest,
  ) {
    const response = await agent
      .post(`${branchPath}/agent-grants`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send(body)
      .expect(201);
    return agentGrantResponseSchema.parse(response.body).data;
  }

  async function userIdFor(agent: SuperAgentTest): Promise<string> {
    const response = await agent.get("/api/v1/auth/me").expect(200);
    return response.body.data.user.id as string;
  }

  function branchPathFor(work: { id: string; mainBranch: { id: string } }): string {
    return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  }
});

function grantRequest(): AgentGrantCreateRequest {
  return {
    taskId: uuidv7(),
    role: "writer",
    tools: ["context.read_pack", "draft.write_version"],
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
      maxSideEffect: "S1",
      maxAffectedResources: 1,
    },
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  };
}

function auditContext(suffix: string) {
  return {
    requestId: `req_agent_${suffix}`,
    ip: "127.0.0.1",
    userAgent: "vitest-agent-runtime",
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
