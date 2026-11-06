import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  characterDetailResponseSchema,
  factionDetailResponseSchema,
  itemResponseSchema,
  itemRightResponseSchema,
  mapDetailResponseSchema,
  mapNodeResponseSchema,
  powerRealmResponseSchema,
  powerSystemResponseSchema,
  settingChangeRequestResponseSchema,
  specialMechanismResponseSchema,
  worldSnapshotResponseSchema,
} from "@novel-brain/contracts";
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

describe("power systems, mechanisms and item rights HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "power-items-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "power-items-integration-proxy-secret";
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

  it("versions multi-path power systems, breakthrough ladders and configurable lifespan", async () => {
    const owner = await createAuthenticatedAgent("power-system@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    const created = await postJson(owner, token, `${base}/world/power-systems`, {
      name: "北域双路径",
      aliases: ["北域修行"],
      summary: "剑修与体修并行，寿命由境界决定。",
      description: "",
      tags: ["修行"],
      overview: "两条路径共享突破代价，但克制关系不同。",
      lifespanPolicy: {
        mode: "realm",
        unit: "年",
        basis: "境界",
        description: "不同境界提供不同寿命。",
        pathId: null,
        fixedAmount: null,
      },
      paths: [
        {
          name: "剑修",
          pathType: "剑道",
          description: "以剑意破境。",
          sortOrder: 0,
          realms: [
            {
              name: "引气",
              rank: 1,
              description: "",
              breakthroughConditions: "感应灵气。",
              breakthroughCosts: "",
              bottlenecks: "",
              counters: "被锁灵阵克制。",
              counteredBy: "",
              lifespanAmount: 120,
              prerequisiteRealmId: null,
            },
            {
              name: "筑基",
              rank: 2,
              description: "",
              breakthroughConditions: "灵台稳固。",
              breakthroughCosts: "三百灵石。",
              bottlenecks: "心魔未除不可筑基。",
              counters: "被破阵术克制。",
              counteredBy: "",
              lifespanAmount: 240,
              prerequisiteRealmId: null,
            },
          ],
        },
        {
          name: "体修",
          pathType: "肉身",
          description: "以气血淬体。",
          sortOrder: 1,
          realms: [
            {
              name: "锻骨",
              rank: 1,
              description: "",
              breakthroughConditions: "完成百日锻体。",
              breakthroughCosts: "",
              bottlenecks: "",
              counters: "",
              counteredBy: "",
              lifespanAmount: 150,
              prerequisiteRealmId: null,
            },
          ],
        },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const first = powerSystemResponseSchema.parse(created.body).data;
    expect(first.paths.map((path) => path.name)).toEqual(["剑修", "体修"]);
    expect(first.lifespanPolicy.mode).toBe("realm");
    expect(first.health.filter((finding) => finding.severity === "blocker")).toEqual([]);
    expect(first.latestVersionNodeId).toBeTruthy();

    const swordPath = first.paths[0]!;
    const foundation = swordPath.realms.find((realm) => realm.name === "筑基")!;
    const realm = await postJson(
      owner,
      token,
      `${base}/world/power-systems/${first.powerSystem.id}/paths/${swordPath.id}/realms`,
      {
        name: "金丹",
        rank: 3,
        description: "",
        breakthroughConditions: "金丹凝成。",
        breakthroughCosts: "一枚金丹。",
        bottlenecks: "灵台裂痕未愈则失败。",
        counters: "被雷法克制。",
        counteredBy: "克制阴灵。",
        lifespanAmount: 500,
        prerequisiteRealmId: foundation.id,
      },
    );
    expect(realm.status, JSON.stringify(realm.body)).toBe(201);
    powerRealmResponseSchema.parse(realm.body);

    const duplicateRank = await postJson(
      owner,
      token,
      `${base}/world/power-systems/${first.powerSystem.id}/paths/${swordPath.id}/realms`,
      {
        name: "旁门金丹",
        rank: 3,
        description: "",
        breakthroughConditions: "另辟蹊径。",
        breakthroughCosts: "",
        bottlenecks: "",
        counters: "",
        counteredBy: "",
        lifespanAmount: 500,
        prerequisiteRealmId: null,
      },
    );
    expect(duplicateRank.status).toBe(409);
    expect(duplicateRank.body.error.code).toBe("POWER_REALM_LADDER_INVALID");

    const updated = await owner
      .get(`${base}/world/power-systems/${first.powerSystem.id}`)
      .expect(200);
    const detail = powerSystemResponseSchema.parse(updated.body).data;
    expect(detail.paths[0]?.realms.map((entry) => entry.name)).toEqual(["引气", "筑基", "金丹"]);
    expect(detail.latestVersionNodeId).not.toBe(first.latestVersionNodeId);
    expect(detail.version).toBe(first.version + 1);

    const snapshot = worldSnapshotResponseSchema.parse(
      (await owner.get(`${base}/world/snapshot`).expect(200)).body,
    ).data;
    expect(snapshot.powerSystems.map((entry) => entry.powerSystem.label)).toContain("北域双路径");

    const locked = await owner
      .post(`${base}/entities/${first.powerSystem.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: detail.version })
      .expect(200);
    const lockedDetail = locked.body.data as { version: number; status: string };
    expect(lockedDetail.status).toBe("locked");
    const directPatch = await owner
      .patch(`${base}/world/power-systems/${first.powerSystem.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: lockedDetail.version, overview: "直接修改应当被拒绝。" });
    expect(directPatch.status).toBe(409);
    expect(directPatch.body.error.code).toBe("SETTING_LOCKED");

    const change = await owner
      .post(`${base}/entities/${first.powerSystem.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: lockedDetail.version,
        title: "补全金丹瓶颈",
        reason: "第 30 章写明金丹需要先修复灵台裂痕。",
        after: { powerSystem: { overview: "金丹突破前必须修复灵台裂痕。" } },
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 30 章",
            quote: "灵台有裂，金丹难成。",
            locator: "第 30 章 · 末段",
            confidence: 0.93,
          },
        ],
      });
    expect(change.status, JSON.stringify(change.body)).toBe(201);
    expect(settingChangeRequestResponseSchema.parse(change.body).data.status).toBe("pending");

    const outsider = await createAuthenticatedAgent("power-system-other@example.com");
    const forbidden = await outsider.get(`${base}/world/power-systems/${first.powerSystem.id}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("audits mechanism ownership and enforces locked change requests", async () => {
    const owner = await createAuthenticatedAgent("mechanism@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const character = await createCharacter(owner, token, base, "沈砚");
    const faction = await createFaction(owner, token, base, "太玄门");

    const created = await postJson(owner, token, `${base}/world/mechanisms`, {
      name: "忘川书",
      aliases: ["记忆之书"],
      summary: "吞噬记忆换取答案。",
      description: "",
      tags: ["机制"],
      mechanismType: "记忆交易",
      owner: {
        type: "character",
        id: character.character.id,
        branchId: work.mainBranch.id,
        label: "沈砚",
      },
      powerSystem: null,
      rules: "写下问题，交换一段记忆。",
      costs: "每次交换失去一段记忆。",
      limits: "同一天只能问一次。",
      growth: "回答越远，代价越高。",
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const mechanism = specialMechanismResponseSchema.parse(created.body).data;
    expect(mechanism.owner?.id).toBe(character.character.id);
    expect(mechanism.ownershipHistory).toHaveLength(1);

    const transferred = await postJson(
      owner,
      token,
      `${base}/world/mechanisms/${mechanism.mechanism.id}/ownership-transfers`,
      {
        version: mechanism.version,
        owner: {
          type: "faction",
          id: faction.faction.id,
          branchId: work.mainBranch.id,
          label: "太玄门",
        },
        reason: "第 40 章掌教夺走忘川书。",
        validity: {
          fromChapter: 40,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 40 章",
            quote: "掌教把忘川书收入袖中。",
            locator: "第 40 章 · 第 2 段",
            confidence: 0.96,
          },
        ],
      },
    );
    expect(transferred.status, JSON.stringify(transferred.body)).toBe(201);
    const moved = specialMechanismResponseSchema.parse(transferred.body).data;
    expect(moved.owner?.id).toBe(faction.faction.id);
    expect(moved.ownershipHistory).toHaveLength(2);
    expect(moved.ownershipHistory[1]?.previousOwner?.id).toBe(character.character.id);

    const locked = await owner
      .post(`${base}/entities/${mechanism.mechanism.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: moved.version })
      .expect(200);
    const lockedMechanism = locked.body.data as { version: number; status: string };
    expect(lockedMechanism.status).toBe("locked");
    const direct = await owner
      .patch(`${base}/world/mechanisms/${mechanism.mechanism.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: lockedMechanism.version, limits: "直接修改应被拒绝。" });
    expect(direct.status).toBe(409);
    expect(direct.body.error.code).toBe("SETTING_LOCKED");
    const change = await owner
      .post(`${base}/entities/${mechanism.mechanism.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: lockedMechanism.version,
        title: "补充忘川书限制",
        reason: "第 41 章确认每天只能问一次。",
        after: { mechanism: { limits: "同一天只能问一次，子时重置。" } },
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 41 章",
            quote: "子时之前，书页不再回应。",
            locator: "第 41 章 · 第 5 段",
            confidence: 0.9,
          },
        ],
      });
    expect(change.status, JSON.stringify(change.body)).toBe(201);
  });

  it("keeps ownership, custody, location, usage and disposal rights distinct", async () => {
    const owner = await createAuthenticatedAgent("item-rights@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const first = await createCharacter(owner, token, base, "沈砚");
    const second = await createCharacter(owner, token, base, "顾青");
    const third = await createCharacter(owner, token, base, "陈渡");
    const map = await createMap(owner, token, base, "北域");
    const node = await createMapNode(owner, token, base, map.map.id, "问剑峰");

    const created = await postJson(owner, token, `${base}/world/items`, {
      name: "共灵丹炉",
      aliases: [],
      summary: "由两名丹师共同持有的丹炉。",
      description: "",
      tags: ["资源"],
      kind: "resource",
      category: "丹炉",
      grade: "玄阶",
      effect: "可同时炼两炉丹。",
      cost: "每次开炉消耗一份灵炭。",
      limits: "离开丹房后效果减半。",
      ownershipModel: "shared",
      consumable: true,
      quantity: 5,
      equipmentSlot: null,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const item = itemResponseSchema.parse(created.body).data;
    expect(item.ownershipModel).toBe("shared");
    expect(item.quantity).toBe(5);

    const ownershipA = await postJson(owner, token, `${base}/world/items/${item.item.id}/rights`, {
      rightType: "ownership",
      holder: {
        type: "character",
        id: first.character.id,
        branchId: work.mainBranch.id,
        label: "沈砚",
      },
      sharePercent: 60,
      validity: {
        fromChapter: 1,
        toChapter: null,
        fromStoryTime: null,
        toStoryTime: null,
      },
      reason: "共同持有。",
    });
    expect(ownershipA.status, JSON.stringify(ownershipA.body)).toBe(201);
    itemRightResponseSchema.parse(ownershipA.body);
    const ownershipB = await postJson(owner, token, `${base}/world/items/${item.item.id}/rights`, {
      rightType: "ownership",
      holder: {
        type: "character",
        id: second.character.id,
        branchId: work.mainBranch.id,
        label: "顾青",
      },
      sharePercent: 40,
      validity: {
        fromChapter: 1,
        toChapter: null,
        fromStoryTime: null,
        toStoryTime: null,
      },
      reason: "共同持有。",
    });
    expect(ownershipB.status, JSON.stringify(ownershipB.body)).toBe(201);

    for (const right of [
      {
        rightType: "custody",
        holder: {
          type: "character",
          id: third.character.id,
          branchId: work.mainBranch.id,
          label: "陈渡",
        },
        reason: "由陈渡保管。",
      },
      {
        rightType: "usage",
        holder: {
          type: "faction",
          id: (await createFaction(owner, token, base, "丹盟")).faction.id,
          branchId: work.mainBranch.id,
          label: "丹盟",
        },
        reason: "丹盟拥有使用权。",
      },
      {
        rightType: "disposal",
        holder: {
          type: "character",
          id: first.character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        reason: "沈砚拥有处置权。",
      },
      {
        rightType: "location",
        holder: {
          type: "map_node",
          id: node.id,
          branchId: work.mainBranch.id,
          label: "问剑峰",
        },
        reason: "存放在问剑峰。",
      },
    ]) {
      const response = await postJson(owner, token, `${base}/world/items/${item.item.id}/rights`, {
        ...right,
        sharePercent: null,
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
    }

    const overAllocated = await postJson(
      owner,
      token,
      `${base}/world/items/${item.item.id}/rights`,
      {
        rightType: "ownership",
        holder: {
          type: "character",
          id: third.character.id,
          branchId: work.mainBranch.id,
          label: "陈渡",
        },
        sharePercent: 10,
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
        reason: "超额归属。",
      },
    );
    expect(overAllocated.status).toBe(409);
    expect(overAllocated.body.error.code).toBe("ITEM_RIGHT_CONFLICT");

    const detail = itemResponseSchema.parse(
      (await owner.get(`${base}/world/items/${item.item.id}`).expect(200)).body,
    ).data;
    expect(detail.rights.map((right) => right.rightType)).toEqual(
      expect.arrayContaining(["ownership", "custody", "usage", "disposal", "location"]),
    );

    const consumed = await postJson(owner, token, `${base}/world/items/${item.item.id}/consume`, {
      version: detail.version,
      quantity: 2,
      reason: "炼了两炉丹。",
    });
    expect(consumed.status, JSON.stringify(consumed.body)).toBe(200);
    expect(itemResponseSchema.parse(consumed.body).data.quantity).toBe(3);
    const tooMany = await postJson(owner, token, `${base}/world/items/${item.item.id}/consume`, {
      version: itemResponseSchema.parse(consumed.body).data.version,
      quantity: 4,
      reason: "数量不足。",
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe("ITEM_QUANTITY_INSUFFICIENT");
    const depleted = await postJson(owner, token, `${base}/world/items/${item.item.id}/consume`, {
      version: itemResponseSchema.parse(consumed.body).data.version,
      quantity: 3,
      reason: "最后三炉全部炼完。",
    });
    expect(depleted.status, JSON.stringify(depleted.body)).toBe(200);
    expect(itemResponseSchema.parse(depleted.body).data.quantity).toBe(0);
    const depletedRight = await postJson(
      owner,
      token,
      `${base}/world/items/${item.item.id}/rights`,
      {
        rightType: "usage",
        holder: {
          type: "character",
          id: third.character.id,
          branchId: work.mainBranch.id,
          label: "陈渡",
        },
        sharePercent: null,
        validity: {
          fromChapter: 50,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
        reason: "耗尽后不能再登记使用权。",
      },
    );
    expect(depletedRight.status).toBe(409);
    expect(depletedRight.body.error.code).toBe("ITEM_RIGHT_CONFLICT");

    const unique = await createItem(owner, token, base, {
      name: "斩灵剑",
      kind: "equipment",
      ownershipModel: "unique",
      quantity: 1,
      equipmentSlot: "main_hand",
    });
    const uniqueFirst = await postJson(
      owner,
      token,
      `${base}/world/items/${unique.item.id}/rights`,
      {
        rightType: "ownership",
        holder: {
          type: "character",
          id: first.character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        sharePercent: 100,
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
        reason: "唯一归属。",
      },
    );
    expect(uniqueFirst.status).toBe(201);
    const uniqueSecond = await postJson(
      owner,
      token,
      `${base}/world/items/${unique.item.id}/rights`,
      {
        rightType: "ownership",
        holder: {
          type: "character",
          id: second.character.id,
          branchId: work.mainBranch.id,
          label: "顾青",
        },
        sharePercent: 100,
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
        reason: "第二归属应被拒绝。",
      },
    );
    expect(uniqueSecond.status).toBe(409);
    expect(uniqueSecond.body.error.code).toBe("ITEM_RIGHT_CONFLICT");

    const otherBlade = await createItem(owner, token, base, {
      name: "断水刀",
      kind: "equipment",
      ownershipModel: "shared",
      equipmentSlot: "main_hand",
    });
    const currentUnique = itemResponseSchema.parse(
      (await owner.get(`${base}/world/items/${unique.item.id}`).expect(200)).body,
    ).data;
    const equipped = await postJson(owner, token, `${base}/world/items/${unique.item.id}/equip`, {
      version: currentUnique.version,
      holder: {
        type: "character",
        id: first.character.id,
        branchId: work.mainBranch.id,
        label: "沈砚",
      },
      reason: "主手装备斩灵剑。",
    });
    expect(equipped.status, JSON.stringify(equipped.body)).toBe(200);
    const currentBlade = itemResponseSchema.parse(
      (await owner.get(`${base}/world/items/${otherBlade.item.id}`).expect(200)).body,
    ).data;
    const conflict = await postJson(
      owner,
      token,
      `${base}/world/items/${otherBlade.item.id}/equip`,
      {
        version: currentBlade.version,
        holder: {
          type: "character",
          id: first.character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        reason: "同一主手位冲突。",
      },
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("EQUIPMENT_SLOT_CONFLICT");

    const outsider = await createAuthenticatedAgent("item-rights-other@example.com");
    const forbidden = await outsider.get(`${base}/world/items/${item.item.id}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("enables and forces RLS on every power, mechanism and item table", async () => {
    const tables = [
      "power_systems",
      "power_paths",
      "power_realms",
      "special_mechanisms",
      "mechanism_ownership_events",
      "item_techniques",
      "item_rights",
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
    const response = await postJson(agent, token, `${base}/characters`, {
      name,
      aliases: [],
      summary: "力量与物品测试人物。",
      description: "",
      tags: [],
      profile: {
        desire: "变强",
        fear: "失去记忆",
        goal: "进入天门",
        voiceSample: "",
        voiceGuide: "",
        disguise: "",
      },
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return characterDetailResponseSchema.parse(response.body).data;
  }

  async function createFaction(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await postJson(agent, token, `${base}/world/factions`, {
      name,
      aliases: [],
      summary: `${name}的势力档案。`,
      description: "",
      tags: [],
      profile: { overview: "", goals: "", resources: "", doctrine: "" },
    });
    return factionDetailResponseSchema.parse(response.body).data;
  }

  async function createMap(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await postJson(agent, token, `${base}/world/maps`, {
      name,
      aliases: [],
      summary: `${name}地图。`,
      description: "",
      tags: [],
      details: "",
    });
    return mapDetailResponseSchema.parse(response.body).data;
  }

  async function createMapNode(
    agent: SuperAgentTest,
    token: string,
    base: string,
    mapId: string,
    name: string,
  ) {
    const response = await postJson(agent, token, `${base}/world/maps/${mapId}/nodes`, {
      layerId: null,
      parentNodeId: null,
      name,
      nodeType: "landmark",
      summary: "",
      x: null,
      y: null,
      validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
    });
    return mapNodeResponseSchema.parse(response.body).data;
  }

  async function createItem(
    agent: SuperAgentTest,
    token: string,
    base: string,
    input: {
      name: string;
      kind: "item" | "technique" | "equipment" | "resource";
      ownershipModel: "shared" | "unique";
      quantity?: number;
      equipmentSlot?: string | null;
    },
  ) {
    const response = await postJson(agent, token, `${base}/world/items`, {
      name: input.name,
      aliases: [],
      summary: `${input.name}的说明。`,
      description: "",
      tags: [],
      kind: input.kind,
      category: "兵器",
      grade: "地阶",
      effect: "测试效果。",
      cost: "",
      limits: "",
      ownershipModel: input.ownershipModel,
      consumable: false,
      quantity: input.quantity ?? 1,
      equipmentSlot: input.equipmentSlot ?? null,
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return itemResponseSchema.parse(response.body).data;
  }

  async function postJson(agent: SuperAgentTest, token: string, path: string, body: unknown) {
    return agent.post(path).set("Origin", origin).set("X-CSRF-Token", token).send(body);
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
        displayName: "世界模拟作者",
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
