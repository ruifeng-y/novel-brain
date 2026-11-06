import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  characterDetailResponseSchema,
  characterHistoryResponseSchema,
  characterKnowledgeProjectionResponseSchema,
  confirmedSettingListResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
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

describe("character domain HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "characters-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "characters-integration-proxy-secret";
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

  it("stores profiles, typed relationships and state transitions with historical replay", async () => {
    const owner = await createAuthenticatedAgent("characters-history@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const shen = await createCharacter(owner, token, base, "沈砚");
    const gu = await createCharacter(owner, token, base, "顾青");
    const gate = await createMapEntity(owner, token, base, "太玄门山门");

    const ally = await owner
      .post(`${base}/characters/${shen.id}/relationships`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        target: {
          type: "character",
          id: gu.id,
          branchId: work.mainBranch.id,
          label: "顾青",
        },
        relationType: "ally",
        validity: {
          fromChapter: 1,
          toChapter: 11,
          fromStoryTime: { era: "大玄历", label: "第一年春", sortKey: 10 },
          toStoryTime: null,
        },
        sourceChapterId: null,
      });
    if (ally.status !== 201) {
      throw new Error(JSON.stringify(ally.body));
    }
    expect(ally.body.data).toMatchObject({
      relationType: "ally",
      target: { id: gu.id, type: "character" },
    });
    await owner
      .post(`${base}/characters/${shen.id}/relationships`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        target: {
          type: "character",
          id: gu.id,
          branchId: work.mainBranch.id,
          label: "顾青",
        },
        relationType: "enemy",
        validity: { fromChapter: 12, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);

    await owner
      .post(`${base}/characters/${shen.id}/state-transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        stateKind: "body",
        stateKey: "overall",
        value: "左臂骨折",
        target: null,
        validity: { fromChapter: 1, toChapter: 9, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);
    await owner
      .post(`${base}/characters/${shen.id}/state-transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        stateKind: "body",
        stateKey: "overall",
        value: "伤势痊愈",
        target: null,
        validity: { fromChapter: 10, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);
    await owner
      .post(`${base}/characters/${shen.id}/state-transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        stateKind: "location",
        stateKey: "current_location",
        value: "太玄门山门",
        target: {
          type: "map",
          id: gate.id,
          branchId: work.mainBranch.id,
          label: "太玄门山门",
        },
        validity: { fromChapter: 5, toChapter: 9, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);

    const atNine = characterHistoryResponseSchema.parse(
      (await owner.get(`${base}/characters/${shen.id}/history?chapterNumber=9`).expect(200)).body,
    ).data;
    expect(atNine.relationships.map((edge) => edge.relationType)).toEqual(["ally"]);
    expect(atNine.stateTransitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stateKind: "body", value: "左臂骨折" }),
        expect.objectContaining({ stateKind: "location", value: "太玄门山门" }),
      ]),
    );

    const atTen = characterHistoryResponseSchema.parse(
      (await owner.get(`${base}/characters/${shen.id}/history?chapterNumber=10`).expect(200)).body,
    ).data;
    expect(atTen.stateTransitions).toEqual([
      expect.objectContaining({ stateKind: "body", value: "伤势痊愈" }),
    ]);

    const detail = characterDetailResponseSchema.parse(
      (await owner.get(`${base}/characters/${shen.id}`).expect(200)).body,
    ).data;
    expect(detail.latestVersionNodeId).toBeTruthy();
    const atVersion = characterHistoryResponseSchema.parse(
      (
        await owner
          .get(`${base}/characters/${shen.id}/history?versionNodeId=${detail.latestVersionNodeId}`)
          .expect(200)
      ).body,
    ).data;
    expect(atVersion.relationships).toHaveLength(2);
    expect(atVersion.stateTransitions).toHaveLength(3);

    const overlap = await owner
      .post(`${base}/characters/${shen.id}/state-transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        stateKind: "body",
        stateKey: "overall",
        value: "重叠状态",
        target: null,
        validity: { fromChapter: 5, toChapter: 12, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(409);
    expect(overlap.body.error.code).toBe("CHARACTER_STATE_OVERLAP");
  });

  it("keeps objective canon separate from knowledge, belief, suspicion, misbelief and unknown", async () => {
    const owner = await createAuthenticatedAgent("characters-knowledge@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const userId = await userIdFor("characters-knowledge@example.com");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const fact = await createCanonFact(databasePool, {
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
      object: "被仇家杀死",
    });
    const shen = await createCharacter(owner, token, base, "沈砚");

    await owner
      .post(`${base}/characters/${shen.id}/knowledge-states`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        objectiveFactId: fact.id,
        state: "unknown",
        claimedContent: null,
        sourceKind: "assumed",
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);

    const hidden = characterKnowledgeProjectionResponseSchema.parse(
      (await owner.get(`${base}/characters/${shen.id}/knowledge?chapterNumber=5`).expect(200)).body,
    ).data;
    expect(hidden.knownFacts).toEqual([]);
    expect(hidden.hiddenFactIds).toEqual([fact.id]);

    await owner
      .post(`${base}/characters/${shen.id}/knowledge-states`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        objectiveFactId: fact.id,
        state: "misbelief",
        claimedContent: "沈砚相信父母是自尽。",
        sourceKind: "told",
        validity: { fromChapter: 2, toChapter: 9, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);
    await owner
      .post(`${base}/characters/${shen.id}/knowledge-states`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        objectiveFactId: fact.id,
        state: "knowledge",
        claimedContent: "沈砚得知父母被仇家杀死。",
        sourceKind: "told",
        validity: { fromChapter: 10, toChapter: null, fromStoryTime: null, toStoryTime: null },
        sourceChapterId: null,
      })
      .expect(201);

    const beforeReveal = characterKnowledgeProjectionResponseSchema.parse(
      (await owner.get(`${base}/characters/${shen.id}/knowledge?chapterNumber=9`).expect(200)).body,
    ).data;
    expect(beforeReveal.knownFacts).toEqual([]);
    expect(beforeReveal.beliefs).toEqual([
      {
        objectiveFactId: fact.id,
        state: "misbelief",
        claimedContent: "沈砚相信父母是自尽。",
      },
    ]);

    const afterReveal = characterKnowledgeProjectionResponseSchema.parse(
      (await owner.get(`${base}/characters/${shen.id}/knowledge?chapterNumber=10`).expect(200))
        .body,
    ).data;
    expect(afterReveal.knownFacts).toEqual([
      expect.objectContaining({ id: fact.id, object: "被仇家杀死" }),
    ]);

    const confirmed = confirmedSettingListResponseSchema.parse(
      (await owner.get(`${base}/facts`).expect(200)).body,
    );
    expect(
      confirmed.data.find((entry) => entry.kind === "fact" && entry.object === "被仇家杀死"),
    ).toBeTruthy();
  });

  it("requires a change request once the character is locked and enforces tenant isolation", async () => {
    const owner = await createAuthenticatedAgent("characters-lock@example.com");
    const other = await createAuthenticatedAgent("characters-lock-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const character = await createCharacter(owner, token, base, "沈砚");

    const locked = await owner
      .post(`${base}/characters/${character.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: character.version })
      .expect(200);
    expect(locked.body.data.status).toBe("locked");

    const direct = await owner
      .patch(`${base}/characters/${character.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: locked.body.data.version, profile: { goal: "越权直改" } })
      .expect(409);
    expect(direct.body.error.code).toBe("SETTING_LOCKED");

    const change = await owner
      .post(`${base}/characters/${character.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        kind: "profile",
        title: "补全沈砚目标",
        reason: "第 20 章确认他进入天门是为了找回记忆。",
        after: { goal: "进入天门找回被抹去的记忆" },
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 20 章",
            quote: "我不是去求仙，是去把丢掉的东西拿回来。",
            locator: "第 20 章 · 末段",
            confidence: 0.97,
          },
        ],
      })
      .expect(201);
    expect(change.body.data).toMatchObject({
      kind: "profile",
      status: "pending",
      after: { goal: "进入天门找回被抹去的记忆" },
    });

    expect((await other.get(`${base}/characters`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${base}/characters/${character.id}/state-transitions`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            stateKind: "body",
            stateKey: "overall",
            value: "越权状态",
            target: null,
            validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
            sourceChapterId: null,
          })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("enables and forces RLS on every character domain table", async () => {
    const tables = [
      "character_profiles",
      "character_relationships",
      "character_state_transitions",
      "character_knowledge_states",
      "character_change_requests",
    ];
    const result = await databasePool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1::text[])`,
      [tables],
    );
    expect(result.rows).toHaveLength(tables.length);
    for (const row of result.rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
    const policies = await databasePool.query<{ tablename: string }>(
      `select tablename from pg_policies where schemaname = 'public' and tablename = any($1::text[])`,
      [tables],
    );
    expect(new Set(policies.rows.map((row) => row.tablename))).toEqual(new Set(tables));
  });

  async function createCharacter(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await agent
      .post(`${base}/characters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name,
        aliases: name === "沈砚" ? ["小砚"] : [],
        summary: name === "沈砚" ? "被宗门抛弃的外门杂役。" : "奉命监视沈砚的内门弟子。",
        description: "",
        tags: [],
        profile: {
          desire: name === "沈砚" ? "找回被抹去的记忆" : "完成师门任务",
          fear: name === "沈砚" ? "成为忘川书的下一个祭品" : "暴露自己的动摇",
          goal: name === "沈砚" ? "进入天门" : "看住沈砚",
          voiceSample: "",
          voiceGuide: "",
          disguise: name === "沈砚" ? "藏起左臂伤势" : "",
        },
      });
    if (response.status !== 201) {
      throw new Error(JSON.stringify(response.body));
    }
    const detail = characterDetailResponseSchema.parse(response.body).data;
    return {
      id: detail.character.id,
      version: detail.version,
      status: detail.status,
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
        displayName: "人物档案作者",
      })
      .expect(200);
    return agent;
  }

  async function createMapEntity(
    agent: SuperAgentTest,
    token: string,
    base: string,
    name: string,
  ): Promise<{ id: string }> {
    const response = await agent
      .post(`${base}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "map",
        name,
        aliases: [],
        summary: "人物位置回放使用的测试地图节点。",
        description: "",
        tags: [],
        data: { details: "山门位于太玄峰南侧。" },
      })
      .expect(201);
    return response.body.data as { id: string };
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

  async function userIdFor(email: string): Promise<string> {
    const result = await databasePool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error(`Missing user ${email}`);
    }
    return id;
  }
});

async function createCanonFact(
  pool: ReturnType<typeof createDatabasePool>,
  input: {
    userId: string;
    workId: string;
    branchId: string;
    object: string;
  },
): Promise<{ id: string }> {
  const chapterId = uuidv7();
  const versionNodeId = uuidv7();
  const chapterVersionId = uuidv7();
  const proposalId = uuidv7();
  const decisionId = uuidv7();
  const commitId = uuidv7();
  const factId = uuidv7();
  const now = new Date();
  const head = await pool.query<{ head_node_id: string | null }>(
    "SELECT head_node_id FROM work_branches WHERE id = $1",
    [input.branchId],
  );
  await pool.query(
    `INSERT INTO version_nodes
      (id, work_id, branch_id, user_id, parent_node_id, node_type, object_type, object_id,
       object_version, payload, actor_id, message, created_at)
     VALUES ($1, $2, $3, $4, $5, 'chapter_version', 'chapter', $6, 1, '{}'::jsonb, $4, $7, $8)`,
    [
      versionNodeId,
      input.workId,
      input.branchId,
      input.userId,
      head.rows[0]?.head_node_id ?? null,
      chapterId,
      "人物知识测试章节",
      now,
    ],
  );
  await pool.query(
    `INSERT INTO chapters
      (id, work_id, branch_id, user_id, number, title, status, version, current_version_id,
       word_count, brief, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, '第 1 章', 'locked', 1, NULL, 0, '{}'::jsonb, $5, $5)`,
    [chapterId, input.workId, input.branchId, input.userId, now],
  );
  await pool.query(
    `INSERT INTO chapter_versions
      (id, work_id, branch_id, user_id, chapter_id, version, content, content_hash,
       version_node_id, source, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, 'manual', $9)`,
    [
      chapterVersionId,
      input.workId,
      input.branchId,
      input.userId,
      chapterId,
      "沈砚父母被仇家杀死。",
      "fixture-content-hash",
      versionNodeId,
      now,
    ],
  );
  await pool.query("UPDATE work_branches SET head_node_id = $1, updated_at = $2 WHERE id = $3", [
    versionNodeId,
    now,
    input.branchId,
  ]);
  await pool.query(
    `INSERT INTO fact_proposals
      (id, work_id, branch_id, user_id, chapter_id, source_version_id, extraction_key,
       subject, predicate, object, source_sentence, status, confidence, risk, required,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '沈砚父母', '死因', $8,
       '沈砚父母被仇家杀死。', 'confirmed', 1, 'high', true, $9, $9)`,
    [
      proposalId,
      input.workId,
      input.branchId,
      input.userId,
      chapterId,
      chapterVersionId,
      `fixture:${factId}`,
      input.object,
      now,
    ],
  );
  await pool.query(
    `INSERT INTO fact_decisions
      (id, work_id, branch_id, user_id, chapter_id, fact_proposal_id, action, actor_id,
       actor_name, reason, original_payload, resulting_payload, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirm', $4, '测试作者', 'fixture',
       '{}'::jsonb, '{}'::jsonb, $7)`,
    [decisionId, input.workId, input.branchId, input.userId, chapterId, proposalId, now],
  );
  await pool.query(
    `INSERT INTO canon_commits
      (id, work_id, branch_id, user_id, chapter_id, chapter_version_id, version_node_id,
       idempotency_key, decision_snapshot, summary, actor_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, '{}'::jsonb, $4, $9)`,
    [
      commitId,
      input.workId,
      input.branchId,
      input.userId,
      chapterId,
      chapterVersionId,
      versionNodeId,
      `fixture-${commitId}`,
      now,
    ],
  );
  await pool.query(
    `INSERT INTO facts
      (id, work_id, branch_id, user_id, chapter_id, fact_proposal_id, decision_id,
       source_version_id, canon_commit_id, subject, predicate, object, risk, required,
       status, valid_from_chapter, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '沈砚父母', '死因', $10,
       'high', true, 'active', 1, $11)`,
    [
      factId,
      input.workId,
      input.branchId,
      input.userId,
      chapterId,
      proposalId,
      decisionId,
      chapterVersionId,
      commitId,
      input.object,
      now,
    ],
  );
  return { id: factId };
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
