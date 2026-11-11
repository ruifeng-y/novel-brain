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

const signedOffCards = [
  ["oneSentence", "一句话故事"],
  ["sellingPoints", "核心卖点"],
  ["protagonist", "主角"],
  ["goldenFinger", "金手指"],
  ["worldLaws", "世界铁律"],
  ["mainPlot", "主线"],
  ["subplots", "支线"],
  ["ending", "结局方向"],
  ["readerPromise", "读者承诺"],
] as const;

const worldRule = {
  id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c60",
  name: "境界差距",
  constraint: "境界差距不能靠情绪直接抹平，越阶必须付出寿元、资源或关系代价。",
  scope: "所有战斗与冲突",
  exceptions: ["主角在付出寿元代价时可以短暂抗衡一位境界。"],
};

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("story bible HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "story-bible-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "story-bible-integration-proxy-secret";
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

  it("initializes exactly the nine signed-off cards with empty readiness", async () => {
    const owner = await createAuthenticatedAgent("bible-empty@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );

    const response = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .expect(200);

    expect(response.body.data).toMatchObject({
      workId: work.id,
      branchId: work.mainBranch.id,
      version: 1,
      status: "draft",
      lockedAt: null,
      lockedBy: null,
      proposal: null,
      readiness: {
        status: "not_ready",
        completed: 0,
        total: 9,
        canLock: false,
      },
    });
    expect(
      response.body.data.cards.map((card: { key: string; title: string }) => [
        card.key,
        card.title,
      ]),
    ).toEqual(signedOffCards);
    expect(
      response.body.data.cards.every(
        (card: { content: string; complete: boolean }) =>
          card.content === "" && card.complete === false,
      ),
    ).toBe(true);
    expect(response.body.data.readiness.missingCards).toHaveLength(9);
  });

  it("generates a reviewable nine-card proposal as an immutable unlocked version", async () => {
    const owner = await createAuthenticatedAgent("bible-proposal@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);

    const generated = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);

    expect(generated.body.data).toMatchObject({
      version: 2,
      status: "proposed",
      proposal: {
        source: "work_premise",
      },
      lockedAt: null,
      lockedBy: null,
      readiness: {
        status: "ready",
        completed: 9,
        total: 9,
        canLock: true,
        missingCards: [],
      },
    });
    expect(generated.body.data.proposal.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(generated.body.data.cards).toHaveLength(9);
    expect(
      generated.body.data.cards.every(
        (card: { content: string; complete: boolean }) => card.content.length > 0 && card.complete,
      ),
    ).toBe(true);
    expect(generated.body.data.cards[0].content).toContain("被宗门抛弃的杂役");

    const versionCounts = await databasePool.query<{
      bible_versions: string;
      version_nodes: string;
    }>(
      `SELECT
        (SELECT count(*) FROM story_bible_versions WHERE story_bible_id = $1) AS bible_versions,
        (SELECT count(*) FROM version_nodes WHERE object_type = 'story_bible' AND object_id = $1) AS version_nodes`,
      [generated.body.data.id],
    );
    expect(versionCounts.rows[0]).toEqual({ bible_versions: "1", version_nodes: "1" });
  });

  it("appends immutable edit versions and exposes queryable world rules", async () => {
    const owner = await createAuthenticatedAgent("bible-history@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;

    const generated = await owner
      .post(`${basePath}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);

    const edited = await owner
      .patch(basePath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: generated.body.data.version,
        reason: "按开篇战斗规则收紧越阶条件。",
        cards: [
          {
            key: "oneSentence",
            content: "一个失去名字的杂役，用吞噬记忆的古书寻找自己的过去。",
          },
          {
            key: "worldLaws",
            content: "境界差距：越阶必须付出寿元、资源或关系代价。",
            worldRules: [worldRule],
          },
        ],
      })
      .expect(200);

    expect(edited.body.data.version).toBe(3);
    const worldRules = await owner.get(`${basePath}/world-rules`).expect(200);
    expect(worldRules.body.data).toHaveLength(1);
    expect(worldRules.body.data[0]).toMatchObject(worldRule);

    const versions = await owner.get(`${basePath}/versions?limit=1`).expect(200);
    expect(versions.body.data).toEqual([
      expect.objectContaining({
        action: "edited",
        reason: "按开篇战斗规则收紧越阶条件。",
      }),
    ]);
    expect(versions.body.meta.nextCursor).toEqual(expect.any(String));
    const olderVersions = await owner
      .get(`${basePath}/versions?limit=1&cursor=${versions.body.meta.nextCursor}`)
      .expect(200);
    expect(olderVersions.body.data).toEqual([
      expect.objectContaining({ action: "proposed", reason: "生成九卡提案" }),
    ]);

    const graph = await databasePool.query<{
      version: number;
      action: string;
      reason: string;
      actor_id: string;
      own_node_id: string;
      parent_node_id: string | null;
      branch_head_node_id: string | null;
    }>(
      `SELECT sbv.version, sbv.action, sbv.reason, vn.id AS own_node_id, vn.actor_id, vn.parent_node_id,
              wb.head_node_id AS branch_head_node_id
       FROM story_bible_versions sbv
       JOIN version_nodes vn ON vn.id = sbv.version_node_id
       JOIN work_branches wb ON wb.id = sbv.branch_id
       WHERE sbv.story_bible_id = $1
       ORDER BY sbv.version`,
      [generated.body.data.id],
    );
    expect(graph.rows).toHaveLength(2);
    expect(graph.rows[1]?.parent_node_id).toBe(graph.rows[0]?.own_node_id);
    expect(graph.rows[1]?.branch_head_node_id).toBe(graph.rows[1]?.own_node_id);
  });

  it("blocks locking when structured world rules conflict", async () => {
    const owner = await createAuthenticatedAgent("bible-conflict@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
    const generated = await owner
      .post(`${basePath}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);

    const edited = await owner
      .patch(basePath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: generated.body.data.version,
        reason: "测试同名世界铁律冲突。",
        cards: [
          {
            key: "worldLaws",
            content: "两条同名规则互相冲突。",
            worldRules: [
              { ...worldRule, constraint: "越阶必须付出寿元。" },
              {
                ...worldRule,
                id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c61",
                constraint: "越阶不需要代价。",
              },
            ],
          },
        ],
      })
      .expect(200);

    expect(edited.body.data.readiness).toMatchObject({
      status: "partial",
      completed: 9,
      canLock: false,
    });
    expect(edited.body.data.readiness.issues).toEqual([
      expect.objectContaining({
        code: "contradictory_world_rule",
        key: "worldLaws",
        title: "世界铁律",
      }),
    ]);

    const locked = await owner
      .post(`${basePath}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: edited.body.data.version })
      .expect(409);
    expect(locked.body.error).toMatchObject({
      code: "BIBLE_NOT_READY",
      details: {
        issues: [expect.objectContaining({ code: "contradictory_world_rule" })],
      },
    });
  });

  it("edits unlocked cards, reports partial readiness and rejects stale versions", async () => {
    const owner = await createAuthenticatedAgent("bible-edit@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);
    const initial = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .expect(200);

    const edited = await owner
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: initial.body.data.version,
        reason: "补齐一句话故事与主角。",
        cards: [
          {
            key: "oneSentence",
            content: "一个失去名字的杂役，用别人的记忆寻找自己的过去。",
          },
          {
            key: "protagonist",
            content: "主角沈砚谨慎、记仇，但会为救过自己的人承担风险。",
          },
        ],
      })
      .expect(200);

    expect(edited.body.data).toMatchObject({
      version: 2,
      status: "draft",
      readiness: {
        status: "partial",
        completed: 2,
        total: 9,
        canLock: false,
      },
    });
    expect(edited.body.data.readiness.missingCards).toHaveLength(7);
    expect(edited.body.data.cards[0]).toMatchObject({
      key: "oneSentence",
      title: "一句话故事",
      content: "一个失去名字的杂役，用别人的记忆寻找自己的过去。",
      complete: true,
    });
    expect(edited.body.data.cards[2]).toMatchObject({
      key: "protagonist",
      content: "主角沈砚谨慎、记仇，但会为救过自己的人承担风险。",
      complete: true,
    });
    const readiness = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/readiness`)
      .expect(200);
    expect(readiness.body.data).toMatchObject({
      status: "partial",
      completed: 2,
      total: 9,
      canLock: false,
    });

    const stale = await owner
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: initial.body.data.version,
        reason: "旧版本不应覆盖新内容。",
        cards: [{ key: "oneSentence", content: "旧版本不应覆盖新内容。" }],
      })
      .expect(409);
    expect(stale.body.error.code).toBe("VERSION_CONFLICT");
  });

  it("rejects locking until all nine cards are complete", async () => {
    const owner = await createAuthenticatedAgent("bible-not-ready@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);
    const initial = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .expect(200);

    const locked = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: initial.body.data.version })
      .expect(409);

    expect(locked.body.error).toMatchObject({
      code: "BIBLE_NOT_READY",
      details: {
        completed: 0,
        total: 9,
      },
    });
    expect(locked.body.error.details.missingCards).toHaveLength(9);
    const versions = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM story_bible_versions",
    );
    expect(versions.rows[0]?.count).toBe("0");
  });

  it("locks a ready bible into the version graph and rejects direct edits and deletes", async () => {
    const owner = await createAuthenticatedAgent("bible-lock@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);
    const generated = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const user = await owner.get("/api/v1/auth/me").expect(200);

    const locked = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: generated.body.data.version })
      .expect(200);

    expect(locked.body.data).toMatchObject({
      id: generated.body.data.id,
      version: generated.body.data.version + 1,
      status: "locked",
      lockedBy: user.body.data.user.id,
      readiness: {
        status: "ready",
        completed: 9,
        total: 9,
        canLock: false,
      },
    });
    expect(locked.body.data.lockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const versionGraph = await databasePool.query<{
      bible_version_id: string;
      version_node_id: string;
      node_type: string;
      actor_id: string;
      parent_node_id: string | null;
      snapshot_id: string;
      branch_head_node_id: string;
    }>(
      `SELECT
        sbv.id AS bible_version_id,
        vn.id AS version_node_id,
        vn.node_type,
        vn.actor_id,
        vn.parent_node_id,
        vn.snapshot_id,
        wb.head_node_id AS branch_head_node_id
      FROM story_bible_versions sbv
      JOIN version_nodes vn ON vn.id = sbv.version_node_id
      JOIN work_branches wb ON wb.id = sbv.branch_id
      WHERE sbv.story_bible_id = $1
      ORDER BY sbv.version`,
      [generated.body.data.id],
    );
    expect(versionGraph.rows).toHaveLength(2);
    expect(versionGraph.rows[1]).toMatchObject({
      node_type: "story_bible_version",
      actor_id: user.body.data.user.id,
      parent_node_id: versionGraph.rows[0]?.version_node_id,
      branch_head_node_id: versionGraph.rows[1]?.version_node_id,
      snapshot_id: versionGraph.rows[1]?.bible_version_id,
    });
    const overview = await owner.get(`/api/v1/works/${work.id}`).expect(200);
    expect(overview.body.data.readiness.items).toContainEqual({
      key: "story_bible",
      label: "故事圣经",
      ready: true,
    });

    const directEdit = await owner
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        reason: "锁定后不应被覆盖。",
        cards: [{ key: "oneSentence", content: "锁定后不应被覆盖。" }],
      })
      .expect(409);
    expect(directEdit.body.error.code).toBe("BIBLE_LOCKED");

    const directDelete = await owner
      .delete(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/cards/oneSentence`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(409);
    expect(directDelete.body.error.code).toBe("BIBLE_LOCKED");
  });

  it("accepts locked change requests and records audited unlock history", async () => {
    const owner = await createAuthenticatedAgent("bible-unlock@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const token = await csrf(owner);
    const user = await owner.get("/api/v1/auth/me").expect(200);
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
    const generated = await owner
      .post(`${basePath}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const locked = await owner
      .post(`${basePath}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: generated.body.data.version })
      .expect(200);

    const changeRequest = await owner
      .post(`${basePath}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "bible-change-request-1")
      .send({
        version: locked.body.data.version,
        cardKey: "worldLaws",
        title: "调整越阶代价",
        reason: "第 3 章战斗需要更清晰的代价。",
        after: {
          key: "worldLaws",
          title: "世界铁律",
          content: "越阶必须付出寿元或关系代价。",
          complete: true,
          worldRules: [worldRule],
        },
      })
      .expect(201);
    expect(changeRequest.body.data).toMatchObject({
      status: "pending",
      risk: "medium",
      source: "author",
      cardKey: "worldLaws",
    });
    const retriedChangeRequest = await owner
      .post(`${basePath}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "bible-change-request-1")
      .send({
        version: locked.body.data.version,
        cardKey: "worldLaws",
        title: "调整越阶代价",
        reason: "第 3 章战斗需要更清晰的代价。",
        after: {
          key: "worldLaws",
          title: "世界铁律",
          content: "越阶必须付出寿元或关系代价。",
          complete: true,
          worldRules: [worldRule],
        },
      })
      .expect(201);
    expect(retriedChangeRequest.body.data.id).toBe(changeRequest.body.data.id);

    const storedRequest = await databasePool.query<{
      before: { content: string };
      after: { content: string };
      status: string;
    }>("SELECT before, after, status FROM story_bible_change_requests WHERE id = $1", [
      changeRequest.body.data.id,
    ]);
    expect(storedRequest.rows[0]).toMatchObject({
      before: { key: "worldLaws" },
      after: { content: "越阶必须付出寿元或关系代价。" },
      status: "pending",
    });
    const requestCount = await databasePool.query<{ count: string }>(
      "SELECT count(*) FROM story_bible_change_requests WHERE story_bible_id = $1",
      [generated.body.data.id],
    );
    expect(requestCount.rows[0]?.count).toBe("1");

    const unlocked = await owner
      .post(`${basePath}/unlock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: locked.body.data.version, reason: "开篇前需要调整设定。" })
      .expect(200);
    expect(unlocked.body.data).toMatchObject({
      status: "draft",
      lockedAt: null,
      lockedBy: null,
    });

    const audit = await databasePool.query<{ action: string; actor_id: string }>(
      "SELECT action, actor_id FROM audit_logs WHERE target_id = $1 ORDER BY created_at",
      [generated.body.data.id],
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual(
      [
        "story_bible.proposed",
        "story_bible.locked",
        "story_bible.change_requested",
        "story_bible.unlocked",
      ].sort(),
    );
    expect(audit.rows.every((row) => row.actor_id === user.body.data.user.id)).toBe(true);

    const history = await owner.get(`${basePath}/versions`).expect(200);
    expect(history.body.data.map((version: { action: string }) => version.action)).toEqual([
      "unlocked",
      "locked",
      "proposed",
    ]);
  });

  it("keeps the nine-card invariant, rejects invalid updates and isolates tenants", async () => {
    const owner = await createAuthenticatedAgent("bible-owner@example.com");
    const other = await createAuthenticatedAgent("bible-other@example.com");
    const work = await createWork(
      owner,
      "忘川书",
      "一个被宗门抛弃的杂役，靠吞噬记忆的古书爬上仙途。",
    );
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const initial = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .expect(200);

    const unlockedDelete = await owner
      .delete(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible/cards/oneSentence`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .expect(400);
    expect(unlockedDelete.body.error.code).toBe("VALIDATION_INVALID");

    const duplicateKeys = await owner
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        version: initial.body.data.version,
        reason: "测试重复卡片键。",
        cards: [
          { key: "oneSentence", content: "第一份内容" },
          { key: "oneSentence", content: "重复键内容" },
        ],
      })
      .expect(400);
    expect(duplicateKeys.body.error.code).toBe("VALIDATION_INVALID");

    const invalidKey = await owner
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        version: initial.body.data.version,
        reason: "测试未知卡片键。",
        cards: [{ key: "unknownCard", content: "不应写入" }],
      })
      .expect(400);
    expect(invalidKey.body.error.code).toBe("VALIDATION_INVALID");

    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
    expect((await other.get(path).expect(403)).body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    expect((await other.get(`${path}/readiness`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect((await other.get(`${path}/versions`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect((await other.get(`${path}/world-rules`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${path}/generate`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({})
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .patch(path)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            version: initial.body.data.version,
            reason: "越权修改。",
            cards: [{ key: "oneSentence", content: "越权内容" }],
          })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${path}/lock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: initial.body.data.version })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${path}/unlock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: initial.body.data.version, reason: "越权解锁。" })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${path}/change-requests`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            version: initial.body.data.version,
            cardKey: "oneSentence",
            title: "越权修改请求",
            reason: "越权修改请求。",
            after: {
              key: "oneSentence",
              title: "一句话故事",
              content: "越权内容",
              complete: true,
              worldRules: [],
            },
          })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .delete(`${path}/cards/oneSentence`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const unchanged = await owner.get(path).expect(200);
    expect(unchanged.body.data.cards).toHaveLength(9);
    expect(unchanged.body.data.cards[0].content).toBe("");
  });

  it("keeps the M0 story bible template scoped to xianxia works", async () => {
    const owner = await createAuthenticatedAgent("bible-history@example.com");
    const work = await createWork(
      owner,
      "旧朝档案",
      "一个失忆的书吏从旧朝档案里追查自己的名字。",
      "history",
    );
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/story-bible`;
    const initial = await owner.get(path).expect(200);

    const generated = await owner
      .post(`${path}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(400);
    expect(generated.body.error.code).toBe("VALIDATION_INVALID");

    const edited = await owner
      .patch(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: initial.body.data.version,
        reason: "历史作品不应写入仙侠模板。",
        cards: [{ key: "oneSentence", content: "历史作品不应写入仙侠模板。" }],
      })
      .expect(400);
    expect(edited.body.error.code).toBe("VALIDATION_INVALID");

    const locked = await owner
      .post(`${path}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: initial.body.data.version })
      .expect(400);
    expect(locked.body.error.code).toBe("VALIDATION_INVALID");
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
        displayName: "林见鹿",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createWork(
    agent: SuperAgentTest,
    title: string,
    idea: string,
    genre: "xianxia" | "history" | "urban" = "xianxia",
  ) {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        mode: "idea",
        title,
        idea,
        genre,
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
