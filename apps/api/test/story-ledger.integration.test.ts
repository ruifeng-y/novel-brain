import "reflect-metadata";

import { randomBytes } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  storyLedgerMutationResponseSchema,
  storyLedgerWorkspaceResponseSchema,
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
  `postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test_146_${randomBytes(4).toString("hex")}`;
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/13";
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("story ledger HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "story-ledger-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "story-ledger-integration-proxy-secret";
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

  it("versions plot threads, foreshadows and character arcs through their lifecycle", async () => {
    const owner = await createAuthenticatedAgent("ledger-owner@example.com");
    const other = await createAuthenticatedAgent("ledger-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const ledgerPath = `${base}/ledger`;

    const chapter = await createChapter(owner, token, base, 1, "旧宅夜雨");
    const event = await createTimelineEvent(owner, token, base);
    const character = await createCharacter(owner, token, base);

    const empty = storyLedgerWorkspaceResponseSchema.parse(
      (await owner.get(ledgerPath).expect(200)).body,
    ).data;
    expect(empty).toMatchObject({
      writtenThroughChapter: 0,
      entries: [],
      findings: [],
      summary: { total: 0, open: 0 },
    });

    const noSource = await owner
      .post(`${ledgerPath}/entries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        kind: "foreshadow",
        title: "没有埋设章",
        summary: "不允许直接进入已埋设状态。",
        responsibleRole: "protagonist",
        status: "planted",
        targetWindow: { fromChapter: 1, toChapter: 5 },
        importance: "must",
        readerPromise: "身世谜团",
        reason: "测试。",
      })
      .expect(400);
    expect(noSource.body.error.code).toBe("VALIDATION_INVALID");

    const foreshadow = await createEntry(owner, token, ledgerPath, {
      kind: "foreshadow",
      title: "父母之死",
      summary: "沈砚以为父母是自杀。",
      responsibleRole: "protagonist",
      targetWindow: { fromChapter: 1, toChapter: 5 },
      importance: "must",
      readerPromise: "身世谜团",
      relatedCharacterIds: [character.id],
    });
    expect(foreshadow).toMatchObject({
      kind: "foreshadow",
      status: "planned",
      version: 1,
    });

    const setup = await transition(owner, token, ledgerPath, foreshadow.id, {
      version: foreshadow.version,
      action: "setup",
      chapterId: chapter.id,
      reason: "在第 1 章旧宅里埋下。",
      evidence: [
        {
          kind: "chapter",
          label: "第 1 章",
          quote: "沈砚把父母的旧信压在箱底。",
          strength: "strong",
        },
      ],
    });
    expect(setup).toMatchObject({
      status: "planted",
      version: 2,
      sourceChapter: { id: chapter.id, number: 1 },
      history: [expect.objectContaining({ action: "setup", reason: "在第 1 章旧宅里埋下。" })],
    });

    const progressed = await transition(owner, token, ledgerPath, foreshadow.id, {
      version: setup.version,
      action: "progress",
      chapterId: chapter.id,
      reason: "旧信上的血印再次出现。",
      evidence: [],
    });
    expect(progressed).toMatchObject({ status: "progressed", version: 3 });

    const paidOff = await transition(owner, token, ledgerPath, foreshadow.id, {
      version: progressed.version,
      action: "payoff",
      chapterId: chapter.id,
      eventId: event.id,
      reason: "旧信与灭门事件对上，沈砚知道父母死于仇杀。",
      evidence: [
        {
          kind: "chapter",
          sourceId: chapter.id,
          label: "第 1 章",
          quote: "信纸夹层里是血河宗的追杀令。",
          locator: "第 1 章 · 末段",
          strength: "strong",
        },
      ],
    });
    expect(paidOff).toMatchObject({
      status: "paid_off",
      version: 4,
      sourceEvent: { eventId: event.id },
    });

    const invalidTransition = await owner
      .post(`${ledgerPath}/entries/${foreshadow.id}/transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: paidOff.version,
        action: "progress",
        chapterId: chapter.id,
        reason: "已经回收后不能再推进。",
        evidence: [],
      })
      .expect(409);
    expect(invalidTransition.body.error.code).toBe("LEDGER_TRANSITION_INVALID");

    const overdue = await createEntry(owner, token, ledgerPath, {
      kind: "foreshadow",
      title: "忘川书缺页",
      summary: "缺页一直藏在铜牌后面。",
      responsibleRole: "protagonist",
      sourceChapterId: chapter.id,
      status: "planted",
      reason: "第 1 章埋下缺页。",
      targetWindow: { fromChapter: 1, toChapter: 3 },
      importance: "must",
      readerPromise: "世界真相",
    });
    await createEntry(owner, token, ledgerPath, {
      kind: "foreshadow",
      title: "忘川书 缺页",
      summary: "重复记录。",
      responsibleRole: "protagonist",
      targetWindow: { fromChapter: 8, toChapter: 12 },
      importance: "optional",
      readerPromise: "世界真相",
    });
    const laterChapter = await createChapter(owner, token, base, 6, "过期进度");
    await databasePool.query(
      `UPDATE chapters SET status = 'writing', word_count = 3600 WHERE id = $1`,
      [laterChapter.id],
    );

    const plotThread = await createEntry(owner, token, ledgerPath, {
      kind: "plot_thread",
      title: "天门将开",
      summary: "天门开启与主角身世互相牵引。",
      responsibleRole: "ensemble",
      status: "planted",
      sourceChapterId: chapter.id,
      reason: "第 1 章埋下天门异象。",
      targetWindow: { fromChapter: 4, toChapter: 8 },
      threadType: "main",
      stakes: "错过天门开启，南境将失去庇护。",
      tension: 80,
    });
    const arc = await createEntry(owner, token, ledgerPath, {
      kind: "character_arc",
      title: "沈砚从证明自己到守护他人",
      summary: "弧光跨越前三卷。",
      responsibleRole: "protagonist",
      targetWindow: { fromChapter: 1, toChapter: 10 },
      characterId: character.id,
      startState: "只想证明自己不是废物。",
      desire: "被宗门认可。",
      fear: "再次被抛弃。",
      lie: "只有变强才值得被留下。",
      truth: "守护他人才能得到真正的归属。",
      endState: "主动承担代价。",
    });

    const patched = await owner
      .patch(`${ledgerPath}/entries/${plotThread.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        kind: "plot_thread",
        version: plotThread.version,
        tension: 88,
        summary: "天门将开，南境各方势力开始下注。",
      })
      .expect(200);
    expect(storyLedgerMutationResponseSchema.parse(patched.body).data.entry).toMatchObject({
      id: plotThread.id,
      tension: 88,
      version: 2,
    });

    await databasePool.query(
      `UPDATE chapters SET status = 'writing', word_count = 4000 WHERE id = $1`,
      [chapter.id],
    );
    const workspace = storyLedgerWorkspaceResponseSchema.parse(
      (await owner.get(ledgerPath).expect(200)).body,
    ).data;
    expect(workspace.writtenThroughChapter).toBe(6);
    expect(workspace.entries.map((entry) => entry.kind).sort()).toEqual([
      "character_arc",
      "foreshadow",
      "foreshadow",
      "foreshadow",
      "plot_thread",
    ]);
    expect(workspace.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "LEDGER_DUPLICATE",
          entryId: overdue.id,
        }),
        expect.objectContaining({
          code: "LEDGER_OVERDUE",
          entryId: overdue.id,
        }),
      ]),
    );
    expect(workspace.summary).toMatchObject({
      total: 5,
      open: 4,
      overdue: 1,
      paidOff: 1,
      mustPayoff: 2,
    });

    const versions = await databasePool.query<{
      node_type: string;
      object_type: string;
      object_version: number;
      action: string | null;
    }>(
      `SELECT node_type, object_type, object_version, payload->>'action' AS action
       FROM version_nodes
       WHERE object_id = $1
       ORDER BY created_at`,
      [foreshadow.id],
    );
    expect(versions.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_type: "ledger_version",
          object_type: "foreshadow",
          object_version: 1,
          action: "ledger.entry_created",
        }),
        expect.objectContaining({
          node_type: "ledger_version",
          object_type: "foreshadow",
          object_version: 4,
          action: "ledger.payoff",
        }),
      ]),
    );
    const audits = await databasePool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE target_id = ANY($1::uuid[]) ORDER BY created_at`,
      [[foreshadow.id, plotThread.id, arc.id]],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["ledger.entry_created", "ledger.entry_updated", "ledger.payoff"]),
    );

    await owner
      .delete(`${ledgerPath}/entries/${arc.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: arc.version, reason: "人物弧计划改到第二卷重新设计。" })
      .expect(200);
    expect(
      storyLedgerWorkspaceResponseSchema
        .parse((await owner.get(ledgerPath).expect(200)).body)
        .data.entries.map((entry) => entry.id),
    ).not.toContain(arc.id);
    const deleted = await databasePool.query<{ deleted_at: Date | null; history: unknown[] }>(
      `SELECT deleted_at, history FROM character_arcs WHERE id = $1`,
      [arc.id],
    );
    expect(deleted.rows[0]?.deleted_at).toBeInstanceOf(Date);
    expect(deleted.rows[0]?.history).toHaveLength(0);

    expect((await other.get(ledgerPath).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
  });

  it("isolates ledger state by branch and enables forced RLS", async () => {
    const owner = await createAuthenticatedAgent("ledger-branch@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const mainLedger = `${base}/ledger`;
    const chapter = await createChapter(owner, token, base, 1, "分叉点");

    const mainEntry = await createEntry(owner, token, mainLedger, {
      kind: "foreshadow",
      title: "主线玉佩",
      summary: "主线埋下的玉佩。",
      responsibleRole: "supporting",
      sourceChapterId: chapter.id,
      status: "planted",
      reason: "主线第 1 章埋下。",
      targetWindow: { fromChapter: 2, toChapter: 8 },
      importance: "optional",
      readerPromise: "人物关系",
    });

    const { rows: userRows } = await databasePool.query<{ user_id: string }>(
      `SELECT user_id FROM works WHERE id = $1`,
      [work.id],
    );
    const { rows: branchRows } = await databasePool.query<{ head_node_id: string }>(
      `SELECT head_node_id FROM work_branches WHERE id = $1`,
      [work.mainBranch.id],
    );
    const branchId = uuidv7();
    const branchHeadId = uuidv7();
    await databasePool.query(
      `INSERT INTO work_branches (id, work_id, user_id, name, head_node_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'what-if', null, 'active', now(), now())`,
      [branchId, work.id, userRows[0]?.user_id],
    );
    await databasePool.query(
      `INSERT INTO version_nodes
        (id, work_id, branch_id, user_id, parent_node_id, node_type, snapshot_id,
         object_type, object_id, object_version, payload, actor_id, message, created_at)
       VALUES ($1, $2, $3, $4, $5, 'snapshot', null, 'branch', $5, 1, '{}'::jsonb, $4, '分支起点', now())`,
      [branchHeadId, work.id, branchId, userRows[0]?.user_id, branchRows[0]?.head_node_id],
    );
    await databasePool.query(
      `UPDATE work_branches SET head_node_id = $1, updated_at = now() WHERE id = $2`,
      [branchHeadId, branchId],
    );

    const otherBranchLedger = `/api/v1/works/${work.id}/branches/${branchId}/ledger`;
    const isolated = storyLedgerWorkspaceResponseSchema.parse(
      (await owner.get(otherBranchLedger).expect(200)).body,
    ).data;
    expect(isolated.entries).toEqual([]);

    const branchEntry = await createEntry(owner, token, otherBranchLedger, {
      kind: "plot_thread",
      title: "另一条分支的选择",
      summary: "只存在于 what-if 分支。",
      responsibleRole: "protagonist",
      targetWindow: { fromChapter: 2, toChapter: 6 },
      threadType: "subplot",
      stakes: "验证分支不会污染主线。",
      tension: 50,
    });
    expect(branchEntry.branchId).toBe(branchId);

    const mainWorkspace = storyLedgerWorkspaceResponseSchema.parse(
      (await owner.get(mainLedger).expect(200)).body,
    ).data;
    expect(mainWorkspace.entries.map((entry) => entry.id)).toEqual([mainEntry.id]);
    const branchWorkspace = storyLedgerWorkspaceResponseSchema.parse(
      (await owner.get(otherBranchLedger).expect(200)).body,
    ).data;
    expect(branchWorkspace.entries.map((entry) => entry.id)).toEqual([branchEntry.id]);

    const tables = ["plot_threads", "foreshadows", "character_arcs"];
    const rls = await databasePool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
      [tables],
    );
    expect(rls.rows).toHaveLength(tables.length);
    for (const row of rls.rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }
    const policies = await databasePool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [tables],
    );
    expect(new Set(policies.rows.map((row) => row.tablename))).toEqual(new Set(tables));
  });

  async function createEntry(
    agent: SuperAgentTest,
    token: string,
    ledgerPath: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${ledgerPath}/entries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return storyLedgerMutationResponseSchema.parse(response.body).data.entry;
  }

  async function transition(
    agent: SuperAgentTest,
    token: string,
    ledgerPath: string,
    entryId: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${ledgerPath}/entries/${entryId}/transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return storyLedgerMutationResponseSchema.parse(response.body).data.entry;
  }

  async function createChapter(
    agent: SuperAgentTest,
    token: string,
    base: string,
    number: number,
    title: string,
  ) {
    const response = await agent
      .post(`${base}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number,
        title,
        brief: {
          goal: "埋下一条必须回收的线索。",
          pov: "沈砚",
          location: "旧宅",
          sceneBeats: ["沈砚发现旧信。", "血印浮现。"],
          requiredFacts: ["沈砚不知道父母死于仇杀"],
        },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data as { id: string; number: number; title: string };
  }

  async function createTimelineEvent(agent: SuperAgentTest, token: string, base: string) {
    await agent
      .post(`${base}/world/timeline/eras`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "大玄历",
        orderIndex: 1,
        startSortKey: 0,
        endSortKey: null,
        description: "大玄王朝纪年。",
      })
      .expect(201);
    const response = await agent
      .post(`${base}/world/timeline/events`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "旧宅血夜",
        aliases: [],
        summary: "沈砚父母遇害的真相。",
        description: "",
        tags: [],
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 100 },
        durationMinutes: 120,
        durationLabel: "一夜",
        event: "仇家屠村后伪装成自尽。",
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.event as { id: string };
  }

  async function createCharacter(agent: SuperAgentTest, token: string, base: string) {
    const response = await agent
      .post(`${base}/characters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "沈砚",
        aliases: [],
        summary: "隐藏忘川书的外门杂役。",
        description: "",
        tags: [],
        profile: {
          desire: "被宗门认可",
          fear: "再次被抛弃",
          goal: "进入天门",
          voiceSample: "",
          voiceGuide: "",
          disguise: "",
        },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.data.character as { id: string };
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
        displayName: "账本作者",
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
