import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  chapterVersionSaveResponseSchema,
  qualityWorkspaceResponseSchema,
  revisionPlanWorkspaceResponseSchema,
  writeActionJobSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { FakeAiProvider } from "@novel-brain/ai";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { WorkerGenerationRepository } from "../../worker/src/generation/generation.repository";
import { WritingActionProcessor } from "../../worker/src/writing-actions/writing-action.processor";

const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
const databaseUrl = dedicatedDatabaseUrl(`novelbrain_test_118_${suffix}`);
const redisUrl = dedicatedRedisUrl();
const origin = "http://localhost:3000";
const sourceContent = [
  "太震撼了！！！沈砚几乎不能呼吸！！！",
  "他看见顾青，心中一震！！！",
  "沈砚双手结印，断臂竟毫无妨碍。",
  "远处钟声未响。",
].join("\n\n");

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("targeted revision HTTP and worker integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "revision-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "revision-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.AI_PROVIDER_MODE = "fake";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1";

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
    await resetDatabase(databasePool);
    await redis.flushdb();
  });

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("creates two bounded revision rounds with immutable versions, diffs and approval gates", async () => {
    const owner = await createAuthenticatedAgent("revision-owner@example.com");
    const fixture = await createRevisionFixture(owner);
    const style = fixture.styleFinding;
    const block = {
      id: "block-1",
      start: style.evidence[0]!.startOffset,
      end: style.evidence[0]!.endOffset,
      label: "声线偏移段落",
    };

    const created = await startPlan(owner, fixture, {
      sourceVersionId: fixture.sourceVersionId,
      findingIds: [style.id],
      blocks: [block],
      constraints: {
        preserveOutsideSelection: true,
        protectLockedContent: true,
        authorInstruction: "保持克制，不要新增事实。",
      },
    });
    expect(created.plan).toMatchObject({ status: "active", maxRounds: 2 });
    expect(created.rounds[0]).toMatchObject({
      roundNumber: 1,
      status: "queued",
      selectedFindings: [{ findingId: style.id, severity: "P2" }],
    });
    expect(created.rounds[0]?.jobId).toBeTruthy();

    await runWorker(created.rounds[0]!.jobId!);
    const first = await getPlan(owner, fixture, created.plan.id);
    expect(first.plan.status).toBe("awaiting_feedback");
    expect(first.rounds[0]).toMatchObject({
      status: "waiting_review",
      unresolvedFindingIds: [],
    });
    expect(first.rounds[0]?.diff?.changes).toHaveLength(1);
    expect(first.rounds[0]?.diff?.unresolvedFindingIds).toEqual([]);
    expect(first.rounds[0]?.resultVersionId).toBeTruthy();

    const resultVersionId = first.rounds[0]!.resultVersionId!;
    const revised = await chapterVersion(resultVersionId);
    expect(revised.slice(0, block.start)).toBe(sourceContent.slice(0, block.start));
    expect(revised.slice(block.start)).not.toContain(style.evidence[0]!.quote);
    const versionCount = await queryCount(
      "SELECT count(*)::text AS count FROM chapter_versions WHERE chapter_id = $1",
      [fixture.chapterId],
    );
    expect(versionCount).toBe(2);

    const blockedCanon = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-canon-before-approval")
      .send({ chapterVersionId: resultVersionId })
      .expect(409);
    expect(blockedCanon.body.error.code).toBe("CANON_CHAPTER_NOT_APPROVED");

    const chapter = await chapterState(fixture.chapterId);
    await setChapterStatus(fixture.chapterId, "waiting_review");
    await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ action: "approve", version: chapter.version })
      .expect(200);
    const noFacts = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-canon-without-facts")
      .send({ chapterVersionId: resultVersionId })
      .expect(409);
    expect(noFacts.body.error.code).toBe("FACT_SUBMISSION_BLOCKED");

    await setChapterStatus(fixture.chapterId, "writing");
    const rewritten = await feedback(owner, fixture, created.plan.id, first.rounds[0]!.id, {
      action: "rewrite",
      reason: "保留当前方向，再收紧一次句长。",
      version: first.rounds[0]!.version,
    });
    expect(rewritten.rounds[0]?.status).toBe("rewrite_requested");

    const second = await addRound(owner, fixture, created.plan.id, {
      sourceVersionId: resultVersionId,
      findingIds: [style.id],
      blocks: [{ id: "block-2", start: 0, end: revised.length, label: "第二次收紧" }],
      constraints: {
        preserveOutsideSelection: true,
        protectLockedContent: true,
        authorInstruction: "只做第二次收紧。",
      },
    });
    expect(second.rounds).toHaveLength(2);
    await runWorker(second.rounds[1]!.jobId!);
    const completed = await getPlan(owner, fixture, created.plan.id);
    expect(completed.rounds[1]).toMatchObject({
      roundNumber: 2,
      status: "waiting_review",
      unresolvedFindingIds: [],
    });
    expect(completed.rounds[1]?.diff?.changes).toHaveLength(1);
    expect(
      await queryCount(
        "SELECT count(*)::text AS count FROM chapter_versions WHERE chapter_id = $1",
        [fixture.chapterId],
      ),
    ).toBe(3);

    const rewriteSecond = await feedback(owner, fixture, created.plan.id, completed.rounds[1]!.id, {
      action: "rewrite",
      reason: "作者希望开始第三轮。",
      version: completed.rounds[1]!.version,
    });
    expect(rewriteSecond.rounds[1]?.status).toBe("rewrite_requested");
    const limit = await owner
      .post(`${fixture.branchPath}/revisions/${created.plan.id}/rounds`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        sourceVersionId: completed.rounds[1]!.resultVersionId,
        findingIds: [style.id],
        blocks: [{ id: "block-3", start: 0, end: 1 }],
        constraints: {
          preserveOutsideSelection: true,
          protectLockedContent: true,
        },
      })
      .expect(409);
    expect(limit.body.error.code).toBe("REVISION_ROUND_LIMIT_REACHED");
  });

  it("blocks high-risk and locked content, persists opt-in feedback and never revives rejected findings", async () => {
    const owner = await createAuthenticatedAgent("revision-boundary@example.com");
    const fixture = await createRevisionFixture(owner);
    const style = fixture.styleFinding;
    const highRisk = fixture.highRiskFinding;
    const block = {
      id: "block-1",
      start: style.evidence[0]!.startOffset,
      end: style.evidence[0]!.endOffset,
    };

    const genericBypass = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/write-actions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-generic-bypass")
      .send({
        action: "targeted_revision",
        sourceVersionId: fixture.sourceVersionId,
        findingIds: [style.id],
        blocks: [block],
        constraints: {
          preserveOutsideSelection: true,
          protectLockedContent: true,
        },
      })
      .expect(409);
    expect(genericBypass.body.error.code).toBe("WRITING_ACTION_SELECTION_INVALID");

    const highRiskError = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/revisions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-high-risk")
      .send({
        sourceVersionId: fixture.sourceVersionId,
        findingIds: [highRisk.id],
        blocks: [block],
        constraints: {
          preserveOutsideSelection: true,
          protectLockedContent: true,
        },
      })
      .expect(409);
    expect(highRiskError.body.error.code).toBe("REVISION_FINDING_HIGH_RISK");

    await setChapterStatus(fixture.chapterId, "locked");
    const locked = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/revisions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-locked")
      .send({
        sourceVersionId: fixture.sourceVersionId,
        findingIds: [style.id],
        blocks: [block],
        constraints: {
          preserveOutsideSelection: true,
          protectLockedContent: true,
        },
      })
      .expect(409);
    expect(locked.body.error.code).toBe("REVISION_NOT_EDITABLE");
    await setChapterStatus(fixture.chapterId, "writing");

    const outOfRange = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/revisions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-out-of-range")
      .send({
        sourceVersionId: fixture.sourceVersionId,
        findingIds: [style.id],
        blocks: [{ id: "block-1", start: 0, end: 99_999 }],
        constraints: {
          preserveOutsideSelection: true,
          protectLockedContent: true,
        },
      })
      .expect(400);
    expect(outOfRange.body.error.code).toBe("VALIDATION_INVALID");

    const created = await startPlan(owner, fixture, {
      sourceVersionId: fixture.sourceVersionId,
      findingIds: [style.id],
      blocks: [block],
      constraints: {
        preserveOutsideSelection: true,
        protectLockedContent: true,
      },
    });
    await runWorker(created.rounds[0]!.jobId!);
    const reviewed = await getPlan(owner, fixture, created.plan.id);
    const rejected = await feedback(owner, fixture, created.plan.id, reviewed.rounds[0]!.id, {
      action: "reject",
      reason: "作者认为这段情绪失控是有意处理。",
      version: reviewed.rounds[0]!.version,
      findingId: style.id,
      evaluationOptIn: true,
    });
    expect(rejected.feedback.at(-1)).toMatchObject({
      action: "reject",
      findingId: style.id,
      evaluationOptIn: true,
    });
    expect(rejected.plan.status).toBe("rejected");
    expect(rejected.rounds[0]?.status).toBe("rejected");
    expect(rejected.evaluationFeedback).toHaveLength(1);
    expect(rejected.evaluationFeedback[0]?.evaluationOptIn).toBe(true);

    const rejectedAgain = await owner
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/revisions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", "revision-rejected-again")
      .send({
        sourceVersionId: reviewed.rounds[0]!.resultVersionId,
        findingIds: [style.id],
        blocks: [{ id: "block-1", start: 0, end: 1 }],
        constraints: {
          preserveOutsideSelection: true,
          protectLockedContent: true,
        },
      })
      .expect(409);
    expect(rejectedAgain.body.error.code).toBe("REVISION_FINDING_REJECTED");

    const other = await createAuthenticatedAgent("revision-other@example.com");
    expect(
      (await other.get(`${fixture.branchPath}/revisions/${created.plan.id}`).expect(403)).body.error
        .code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  async function startPlan(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createRevisionFixture>>,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${fixture.branchPath}/chapters/${fixture.chapterId}/revisions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", `revision-plan-${Math.random().toString(36).slice(2)}`)
      .send(body)
      .expect(202);
    return revisionPlanWorkspaceResponseSchema.parse(response.body).data;
  }

  async function addRound(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createRevisionFixture>>,
    planId: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${fixture.branchPath}/revisions/${planId}/rounds`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send(body)
      .expect(202);
    return revisionPlanWorkspaceResponseSchema.parse(response.body).data;
  }

  async function getPlan(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createRevisionFixture>>,
    planId: string,
  ) {
    return revisionPlanWorkspaceResponseSchema.parse(
      (await agent.get(`${fixture.branchPath}/revisions/${planId}`).expect(200)).body,
    ).data;
  }

  async function feedback(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createRevisionFixture>>,
    planId: string,
    roundId: string,
    body: Record<string, unknown>,
  ) {
    return revisionPlanWorkspaceResponseSchema.parse(
      (
        await agent
          .post(`${fixture.branchPath}/revisions/${planId}/rounds/${roundId}/feedback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", fixture.token)
          .send(body)
          .expect(200)
      ).body,
    ).data;
  }

  async function runWorker(jobId: string) {
    const payload = await readWorkerPayload(jobId);
    const repository = new WorkerGenerationRepository();
    try {
      await new WritingActionProcessor(repository, new FakeAiProvider()).process(payload);
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
      throw new Error("Revision job was not persisted");
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

  async function createRevisionFixture(agent: SuperAgentTest) {
    const work = await createWork(agent);
    const token = await csrf(agent);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(agent, token, branchPath);
    const character = await createConfirmedSettings(agent, token, branchPath);
    const chapter = await createChapter(agent, token, branchPath);
    await createModelConfig(agent, token);
    const userId = (await agent.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
    await databasePool.query(
      `INSERT INTO character_profiles
         (entity_id, work_id, branch_id, user_id, voice_sample, voice_guide)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (entity_id) DO UPDATE SET voice_sample = excluded.voice_sample, voice_guide = excluded.voice_guide`,
      [
        character.id,
        work.id,
        work.mainBranch.id,
        userId,
        "“我记得，只是还没想起来。”",
        "句子短，少用感叹。",
      ],
    );
    const saved = await agent
      .post(`${branchPath}/chapters/${chapter.id}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: chapter.version, content: sourceContent })
      .expect(201);
    const savedData = chapterVersionSaveResponseSchema.parse(saved.body).data;
    const quality = qualityWorkspaceResponseSchema.parse(
      (
        await agent
          .post(`${branchPath}/chapters/${chapter.id}/verify`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ chapterVersionId: savedData.version.id })
          .expect(200)
      ).body,
    ).data;
    const styleFinding = quality.findings.find((finding) => finding.code === "STYLE_DRIFT");
    const highRiskFinding = quality.findings.find((finding) => finding.severity === "P0");
    if (!styleFinding || !highRiskFinding) {
      throw new Error(`Revision fixture findings missing: ${JSON.stringify(quality.findings)}`);
    }
    return {
      workId: work.id,
      branchPath,
      chapterId: chapter.id,
      token,
      sourceVersionId: savedData.version.id,
      styleFinding,
      highRiskFinding,
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
        displayName: "定向修订作者",
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
    return response.body.data as { id: string; mainBranch: { id: string } };
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
  ): Promise<{ id: string }> {
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
    let characterId = "";
    for (const entity of entities) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(entity)
        .expect(201);
      if (entity.type === "character") {
        characterId = created.body.data.id as string;
      }
      await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
    }
    return { id: characterId };
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
          sceneBeats: ["沈砚藏起断臂。", "血河宗追兵逼近。"],
          requiredFacts: ["左臂骨折，不能双手结印"],
        },
      })
      .expect(201);
    return response.body.data as { id: string; version: number };
  }

  async function createModelConfig(agent: SuperAgentTest, token: string) {
    await agent
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-fake-revision-1234",
        purposes: ["writing"],
        isDefault: true,
      })
      .expect(200);
  }

  async function chapterVersion(versionId: string): Promise<string> {
    const result = await databasePool.query<{ content: string }>(
      "SELECT content FROM chapter_versions WHERE id = $1",
      [versionId],
    );
    return result.rows[0]?.content ?? "";
  }

  async function chapterState(chapterId: string): Promise<{ version: number; status: string }> {
    const result = await databasePool.query<{ version: number; status: string }>(
      "SELECT version, status FROM chapters WHERE id = $1",
      [chapterId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Chapter missing");
    }
    return row;
  }

  async function setChapterStatus(chapterId: string, status: string): Promise<void> {
    await databasePool.query("UPDATE chapters SET status = $2 WHERE id = $1", [chapterId, status]);
  }

  async function queryCount(sqlText: string, values: unknown[]): Promise<number> {
    const result = await databasePool.query<{ count: string }>(sqlText, values);
    return Number(result.rows[0]?.count ?? 0);
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
  if (!databaseName.startsWith("novelbrain_test_118_")) {
    throw new Error("Revision tests must use a dedicated test database");
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
