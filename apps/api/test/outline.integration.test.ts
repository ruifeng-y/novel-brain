import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
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

describe("outline planning HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "outline-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "outline-integration-proxy-secret";
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

  it("builds five levels, rejects invalid parents, and stores briefs, contracts and scene cards", async () => {
    const owner = await createAuthenticatedAgent("outline-build@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = branchPathOf(work);
    const outlinePath = `${branchPath}/outline`;

    const empty = await owner.get(outlinePath).expect(200);
    expect(empty.body.data).toMatchObject({
      nodes: [],
      volumeContracts: [],
      sceneCards: [],
      readiness: {
        ruleVersion: "outline-readiness-v1",
        status: "not_ready",
        canProceed: false,
      },
      stats: { totalNodes: 0, chapterCount: 0 },
    });

    const book = await createNode(owner, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "忘川书",
    });
    const volume = await createNode(owner, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第一卷 · 少年出山",
    });
    const invalidAct = await owner
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ level: "act", parentId: book.id, title: "错挂的幕" })
      .expect(400);
    expect(invalidAct.body.error.code).toBe("OUTLINE_PARENT_INVALID");

    const act = await createNode(owner, token, outlinePath, {
      level: "act",
      parentId: volume.id,
      title: "第三幕 · 断臂",
    });
    const chapter = await createNode(owner, token, outlinePath, {
      level: "chapter",
      parentId: act.id,
      chapterCreate: {
        number: 48,
        title: "一只手也能结印",
        brief: completeBrief(),
      },
    });
    expect(chapter.chapter).toMatchObject({
      number: 48,
      title: "一只手也能结印",
      status: "planned",
    });
    const scene = await createNode(owner, token, outlinePath, {
      level: "scene",
      parentId: chapter.id,
      title: "藏起断臂",
    });

    const chapters = await owner.get(`${branchPath}/chapters`).expect(200);
    expect(chapters.body.data).toHaveLength(1);
    expect(chapters.body.data[0]).toMatchObject({
      id: chapter.chapter?.id,
      brief: completeBrief(),
    });

    const duplicateBook = await owner
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ level: "book", parentId: null, title: "第二本书" })
      .expect(400);
    expect(duplicateBook.body.error.code).toBe("OUTLINE_STRUCTURE_INVALID");

    const character = await createEntity(owner, token, branchPath, {
      type: "character",
      name: "沈砚",
      aliases: ["小砚"],
      summary: "隐藏忘川书的外门杂役。",
      description: "",
      tags: [],
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀。",
        relationshipSummary: "与顾青互相试探。",
      },
    });
    const map = await createEntity(owner, token, branchPath, {
      type: "map",
      name: "荒寺外山道",
      aliases: [],
      summary: "荒寺外的山道。",
      description: "",
      tags: [],
      data: { details: "荒寺外山道" },
    });

    const sceneCard = await owner
      .put(`${outlinePath}/nodes/${scene.id}/scene-card`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        title: "藏起断臂",
        pov: {
          type: "character",
          id: character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
          version: null,
        },
        location: {
          type: "map",
          id: map.id,
          branchId: work.mainBranch.id,
          label: "荒寺外山道",
          version: null,
        },
        storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
        beats: [{ description: "沈砚藏起断臂。" }, { description: "顾青撞见。" }],
        informationReleases: [
          { description: "顾青看见书页一角", constraint: "顾青不能知道完整来历" },
        ],
        tension: 72,
      })
      .expect(200);
    expect(sceneCard.body.data.node.id).toBe(scene.id);
    expect(sceneCard.body.data.replan).toMatchObject({
      ruleVersion: "outline-replan-v1",
      canApply: true,
      impacted: { nodeIds: [scene.id] },
    });

    const savedCard = (await owner.get(outlinePath).expect(200)).body.data.sceneCards.find(
      (card: { nodeId: string }) => card.nodeId === scene.id,
    );
    expect(savedCard).toMatchObject({
      title: "藏起断臂",
      pov: { label: "沈砚", type: "character" },
      location: { label: "荒寺外山道", type: "map" },
      storyTime: { era: "大玄历", label: "雨夜", sortKey: 100 },
      beats: [
        { order: 1, description: "沈砚藏起断臂。" },
        { order: 2, description: "顾青撞见。" },
      ],
      informationReleases: [
        {
          order: 1,
          description: "顾青看见书页一角",
          constraint: "顾青不能知道完整来历",
        },
      ],
      tension: 72,
    });

    const volumeContract = await owner
      .put(`${outlinePath}/nodes/${volume.id}/volume-contract`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        objective: "沈砚第一次真正面对血河宗。",
        conflict: "血河宗追捕与左臂重伤。",
        turningPoints: ["断臂", "忘川书显形"],
        exitConditions: ["离开南境", "顾青立场动摇"],
        plotLines: [{ name: "天门将开", status: "active", note: "主线" }],
      })
      .expect(200);
    expect(volumeContract.body.data.node.id).toBe(volume.id);

    const workspace = (await owner.get(outlinePath).expect(200)).body.data;
    expect(workspace.nodes.map((node: { level: string }) => node.level)).toEqual([
      "book",
      "volume",
      "act",
      "chapter",
      "scene",
    ]);
    expect(workspace.volumeContracts).toEqual([
      expect.objectContaining({
        nodeId: volume.id,
        objective: "沈砚第一次真正面对血河宗。",
        turningPoints: ["断臂", "忘川书显形"],
        exitConditions: ["离开南境", "顾青立场动摇"],
        plotLines: [{ name: "天门将开", status: "active", note: "主线" }],
      }),
    ]);
    expect(workspace.readiness).toMatchObject({
      ruleVersion: "outline-readiness-v1",
      status: "ready",
      canProceed: true,
    });
    expect(workspace.readiness.items.every((item: { ready: boolean }) => item.ready)).toBe(true);
    expect(workspace.stats).toMatchObject({
      totalNodes: 5,
      chapterCount: 1,
      plannedChapters: 1,
      tensionPoints: 1,
    });

    const readiness = await owner.get(`${outlinePath}/planning-readiness`).expect(200);
    expect(readiness.body.data).toEqual(workspace.readiness);
  });

  it("reorders subtrees, rejects cycles, and appends immutable versions with audit records", async () => {
    const owner = await createAuthenticatedAgent("outline-reorder@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const outlinePath = `${branchPathOf(work)}/outline`;
    const fixture = await createOutlineFixture(owner, token, outlinePath);

    const movedAct = await owner
      .post(`${outlinePath}/nodes/${fixture.actTwo.id}/move`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: fixture.actTwo.version, parentId: fixture.volume.id, sortOrder: 0 })
      .expect(200);
    expect(movedAct.body.data.node).toMatchObject({
      id: fixture.actTwo.id,
      parentId: fixture.volume.id,
      sortOrder: 0,
      version: fixture.actTwo.version + 1,
    });
    expect(movedAct.body.data.replan.impacted.nodeIds).toEqual([
      fixture.actTwo.id,
      fixture.chapterTwo.id,
    ]);

    const ordered = (await owner.get(outlinePath).expect(200)).body.data.nodes
      .filter((node: { parentId: string | null }) => node.parentId === fixture.volume.id)
      .map((node: { id: string }) => node.id);
    expect(ordered).toEqual([fixture.actTwo.id, fixture.actOne.id]);

    const currentActOne = movedAct.body.data.workspace.nodes.find(
      (node: { id: string }) => node.id === fixture.actOne.id,
    );
    const invalidParent = await owner
      .post(`${outlinePath}/nodes/${fixture.actOne.id}/move`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: currentActOne.version, parentId: fixture.actTwo.id, sortOrder: 0 })
      .expect(400);
    expect(invalidParent.body.error.code).toBe("OUTLINE_PARENT_INVALID");

    const cycle = await owner
      .post(`${outlinePath}/nodes/${fixture.actTwo.id}/move`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: movedAct.body.data.node.version,
        parentId: fixture.chapterTwo.id,
        sortOrder: 0,
      })
      .expect(400);
    expect(cycle.body.error.code).toBe("OUTLINE_PARENT_INVALID");

    const reparented = await owner
      .post(`${outlinePath}/nodes/${fixture.chapterOne.id}/move`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: fixture.chapterOne.version,
        parentId: fixture.actTwo.id,
        sortOrder: 0,
      })
      .expect(200);
    expect(reparented.body.data.node.parentId).toBe(fixture.actTwo.id);

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
      [fixture.chapterOne.id],
    );
    expect(versions.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_type: "outline_version",
          object_type: "outline_node",
          action: "outline.node_moved",
        }),
      ]),
    );
    const audits = await databasePool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY created_at`,
      [fixture.chapterOne.id],
    );
    expect(audits.rows.map((row) => row.action)).toContain("outline.node_moved");
  });

  it("locks and unlocks nodes while blocking descendant mutations until unlock", async () => {
    const owner = await createAuthenticatedAgent("outline-lock@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const outlinePath = `${branchPathOf(work)}/outline`;
    const fixture = await createOutlineFixture(owner, token, outlinePath);

    const locked = await owner
      .post(`${outlinePath}/nodes/${fixture.actOne.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: fixture.actOne.version })
      .expect(200);
    expect(locked.body.data.node).toMatchObject({
      id: fixture.actOne.id,
      locked: true,
      version: fixture.actOne.version + 1,
    });

    const blockedMove = await owner
      .post(`${outlinePath}/nodes/${fixture.chapterOne.id}/move`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: fixture.chapterOne.version,
        parentId: fixture.actTwo.id,
        sortOrder: 0,
      })
      .expect(409);
    expect(blockedMove.body.error.code).toBe("OUTLINE_NODE_LOCKED");

    const blockedCreate = await owner
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        level: "chapter",
        parentId: fixture.actOne.id,
        chapterId: fixture.chapterOne.chapter?.id,
      })
      .expect(409);
    expect(blockedCreate.body.error.code).toBe("OUTLINE_NODE_LOCKED");

    const unlocked = await owner
      .post(`${outlinePath}/nodes/${fixture.actOne.id}/unlock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: locked.body.data.node.version })
      .expect(200);
    expect(unlocked.body.data.node.locked).toBe(false);

    await owner
      .post(`${outlinePath}/nodes/${fixture.chapterOne.id}/move`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: fixture.chapterOne.version,
        parentId: fixture.actTwo.id,
        sortOrder: 0,
      })
      .expect(200);

    const audits = await databasePool.query<{ action: string }>(
      `SELECT action FROM audit_logs WHERE target_id = $1 ORDER BY created_at`,
      [fixture.actOne.id],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(["outline.node_locked", "outline.node_unlocked"]),
    );
  });

  it("returns stable re-plan impact and blocks invalid proposed parents", async () => {
    const owner = await createAuthenticatedAgent("outline-replan@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const outlinePath = `${branchPathOf(work)}/outline`;
    const fixture = await createOutlineFixture(owner, token, outlinePath);

    const invalid = await owner
      .post(`${outlinePath}/replan-check`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ nodeId: fixture.actOne.id, proposedParentId: fixture.book.id })
      .expect(200);
    expect(invalid.body.data).toMatchObject({
      ruleVersion: "outline-replan-v1",
      nodeId: fixture.actOne.id,
      canApply: false,
      blockers: [expect.objectContaining({ code: "OUTLINE_PARENT_INVALID" })],
    });

    const valid = await owner
      .post(`${outlinePath}/replan-check`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ nodeId: fixture.actOne.id, proposedParentId: fixture.volume.id })
      .expect(200);
    expect(valid.body.data).toMatchObject({
      ruleVersion: "outline-replan-v1",
      canApply: true,
      blockers: [],
      impacted: {
        nodeIds: [fixture.actOne.id, fixture.chapterOne.id, fixture.sceneOne.id],
        chapterIds: [fixture.chapterOne.chapter?.id],
        sceneNodeIds: [fixture.sceneOne.id],
      },
    });
  });

  it("rejects cross-tenant access and invalid scene references", async () => {
    const owner = await createAuthenticatedAgent("outline-owner@example.com");
    const other = await createAuthenticatedAgent("outline-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const outlinePath = `${branchPathOf(work)}/outline`;
    const fixture = await createOutlineFixture(owner, token, outlinePath);

    expect((await other.get(outlinePath).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${outlinePath}/nodes/${fixture.actOne.id}/lock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: fixture.actOne.version })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const character = await createEntity(owner, token, branchPathOf(work), {
      type: "character",
      name: "沈砚",
      aliases: [],
      summary: "外门杂役。",
      description: "",
      tags: [],
      data: {
        bodyState: "左臂骨折。",
        knowledgeBoundary: "不知道父母死因。",
        relationshipSummary: "与顾青互相试探。",
      },
    });

    const wrongBranch = await owner
      .put(`${outlinePath}/nodes/${fixture.sceneOne.id}/scene-card`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        title: "错分支引用",
        pov: {
          type: "character",
          id: character.id,
          branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1fff",
          label: "沈砚",
          version: null,
        },
        location: null,
        storyTime: null,
        beats: [{ description: "沈砚藏起断臂。" }],
        informationReleases: [],
        tension: 60,
      })
      .expect(400);
    expect(wrongBranch.body.error.code).toBe("OUTLINE_REFERENCE_INVALID");

    const wrongPovType = await owner
      .put(`${outlinePath}/nodes/${fixture.sceneOne.id}/scene-card`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        title: "错误 POV 类型",
        pov: {
          type: "map",
          id: character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
          version: null,
        },
        location: null,
        storyTime: null,
        beats: [{ description: "沈砚藏起断臂。" }],
        informationReleases: [],
        tension: 60,
      })
      .expect(400);
    expect(wrongPovType.body.error.code).toBe("OUTLINE_REFERENCE_INVALID");
  });

  async function createOutlineFixture(agent: SuperAgentTest, token: string, outlinePath: string) {
    const book = await createNode(agent, token, outlinePath, {
      level: "book",
      parentId: null,
      title: "忘川书",
    });
    const volume = await createNode(agent, token, outlinePath, {
      level: "volume",
      parentId: book.id,
      title: "第一卷",
    });
    const actOne = await createNode(agent, token, outlinePath, {
      level: "act",
      parentId: volume.id,
      title: "第一幕",
    });
    const actTwo = await createNode(agent, token, outlinePath, {
      level: "act",
      parentId: volume.id,
      title: "第二幕",
    });
    const chapterOne = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: actOne.id,
      chapterCreate: {
        number: 1,
        title: "第一章",
        brief: completeBrief(),
      },
    });
    const chapterTwo = await createNode(agent, token, outlinePath, {
      level: "chapter",
      parentId: actTwo.id,
      chapterCreate: {
        number: 2,
        title: "第二章",
        brief: completeBrief(),
      },
    });
    const sceneOne = await createNode(agent, token, outlinePath, {
      level: "scene",
      parentId: chapterOne.id,
      title: "场景一",
    });
    return { book, volume, actOne, actTwo, chapterOne, chapterTwo, sceneOne };
  }

  async function createNode(
    agent: SuperAgentTest,
    token: string,
    outlinePath: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${outlinePath}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body)
      .expect(201);
    return response.body.data.node as {
      id: string;
      version: number;
      level: string;
      parentId: string | null;
      sortOrder: number;
      chapter?: { id: string };
    };
  }

  async function createEntity(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    body: Record<string, unknown>,
  ) {
    const response = await agent
      .post(`${branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body)
      .expect(201);
    return response.body.data as { id: string; version: number };
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
        displayName: "大纲作者",
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

  function branchPathOf(work: { id: string; mainBranch: { id: string } }) {
    return `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
  }
});

function completeBrief() {
  return {
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
