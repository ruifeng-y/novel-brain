import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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

describe("settings center HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "settings-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "settings-integration-proxy-secret";
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

  it("creates, edits, locks and versions a world rule", async () => {
    const owner = await createAuthenticatedAgent("settings-world@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: ["完整记忆律"],
        summary: "失去关键记忆的人无法通过天门。",
        description: "此规则对仙、凡、灵三界同时生效。",
        tags: ["天门", "记忆"],
        data: {
          rule: "通过天门时，任何被主动抹除的关键记忆都会导致通行失败。",
        },
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      workId: work.id,
      branchId: work.mainBranch.id,
      type: "world_rule",
      name: "天门只认完整记忆",
      aliases: ["完整记忆律"],
      status: "draft",
      source: "author",
      version: 1,
      data: {
        rule: "通过天门时，任何被主动抹除的关键记忆都会导致通行失败。",
      },
    });

    const edited = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        summary: "失去关键记忆的人无法通过天门，也无法伪造完整人格。",
        aliases: ["完整记忆律", "天门前律"],
      })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      version: 2,
      status: "draft",
      aliases: ["完整记忆律", "天门前律"],
    });

    const locked = await owner
      .post(`${path}/${created.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 2 })
      .expect(200);
    expect(locked.body.data).toMatchObject({
      version: 3,
      status: "locked",
    });

    const versions = await databasePool.query<{
      entity_versions: string;
      version_nodes: string;
      node_types: string[];
    }>(
      `SELECT
        (SELECT count(*) FROM entity_versions WHERE entity_id = $1) AS entity_versions,
        (SELECT count(*) FROM version_nodes WHERE object_type = 'setting' AND object_id = $1) AS version_nodes,
        (SELECT array_agg(node_type ORDER BY created_at) FROM version_nodes WHERE object_type = 'setting' AND object_id = $1) AS node_types`,
      [created.body.data.id],
    );
    expect(versions.rows[0]).toEqual({
      entity_versions: "3",
      version_nodes: "3",
      node_types: ["entity_version", "entity_version", "entity_version"],
    });
  });

  it("lists entity versions with cursor pagination and rejects foreign cursors", async () => {
    const owner = await createAuthenticatedAgent("settings-version-list-owner@example.com");
    const other = await createAuthenticatedAgent("settings-version-list-other@example.com");
    const work = await createWork(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const token = await csrf(owner);
    const createdResponse = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "版本列表规则",
        aliases: [],
        summary: "第一版摘要",
        description: "",
        tags: [],
        data: { rule: "第一版规则正文。" },
      });
    if (createdResponse.status !== 201) {
      throw new Error(`Failed to create versioned rule: ${JSON.stringify(createdResponse.body)}`);
    }
    const created = createdResponse.body.data as { id: string; version: number };

    let currentVersion = created.version;
    for (const summary of ["版本二摘要", "版本三摘要"]) {
      const edited = await owner
        .patch(`${path}/${created.id}`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: currentVersion, summary })
        .expect(200);
      currentVersion = edited.body.data.version;
    }

    const first = await owner.get(`${path}/${created.id}/versions?limit=2`).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.data.map((entry: { version: number }) => entry.version)).toEqual([3, 2]);
    expect(first.body.data[0]).toMatchObject({
      version: 3,
      node: expect.any(String),
      createdAt: expect.any(String),
      actor: expect.any(String),
      reason: expect.any(String),
      snapshot: {
        domain: "world_rule",
        payload: {
          type: "world_rule",
          name: "版本列表规则",
          summary: "版本三摘要",
          status: "draft",
        },
      },
      summary: {
        name: "版本列表规则",
        summary: "版本三摘要",
        status: "draft",
      },
    });
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));

    const second = await owner
      .get(`${path}/${created.id}/versions?limit=2&cursor=${first.body.meta.nextCursor}`)
      .expect(200);
    expect(second.body.data.map((entry: { version: number }) => entry.version)).toEqual([1]);
    expect(second.body.meta.nextCursor).toBeNull();

    const otherWork = await createWork(other);
    const otherToken = await csrf(other);
    const otherPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/entities`;
    const otherRule = await createWorldRule(other, otherPath, otherToken, "其他租户规则", 0);
    await other
      .patch(`${otherPath}/${otherRule.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version: otherRule.version, summary: "其他租户第二版。" })
      .expect(200);
    const foreignPage = await other
      .get(`${otherPath}/${otherRule.id}/versions?limit=1`)
      .expect(200);

    const invalidCursor = await owner
      .get(`${path}/${created.id}/versions?limit=1&cursor=${foreignPage.body.meta.nextCursor}`)
      .expect(400);
    expect(invalidCursor.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("stores a character body state, knowledge boundary and relationship summary", async () => {
    const owner = await createAuthenticatedAgent("settings-character@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: ["小砚"],
        summary: "被宗门抛弃的外门杂役。",
        description: "谨慎、记仇，但会为救过自己的人承担风险。",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折，不能双手结印。",
          knowledgeBoundary: "不知道父母死于仇杀，也不知道忘川书的缺页去向。",
          relationshipSummary: "与顾青表面亲近，实际互相试探。",
        },
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      type: "character",
      name: "沈砚",
      data: {
        bodyState: "左臂骨折，不能双手结印。",
        knowledgeBoundary: "不知道父母死于仇杀，也不知道忘川书的缺页去向。",
        relationshipSummary: "与顾青表面亲近，实际互相试探。",
      },
    });

    const fetched = await owner.get(`${path}/${created.body.data.id}`).expect(200);
    expect(fetched.body.data.data).toEqual(created.body.data.data);
    const listed = await owner.get(`${path}?type=character`).expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].id).toBe(created.body.data.id);
  });

  it("enforces canonical names and aliases within the work branch scope", async () => {
    const owner = await createAuthenticatedAgent("settings-alias-scope@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门",
        aliases: ["The Gate"],
        summary: "天门会拦截失去关键记忆的人。",
        description: "",
        tags: [],
        data: { rule: "失去关键记忆者无法通行。" },
      })
      .expect(201);

    const duplicateName = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "  天门  ",
        aliases: [],
        summary: "重复规范名。",
        description: "",
        tags: [],
        data: { rule: "任何角色都不能绕过天门。" },
      })
      .expect(409);
    expect(duplicateName.body.error.code).toBe("SETTING_NAME_CONFLICT");

    const aliasCollision = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: ["  the   gate "],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
      })
      .expect(409);
    expect(aliasCollision.body.error.code).toBe("SETTING_ALIAS_CONFLICT");

    const sameNameDifferentType = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "faction",
        name: "天门",
        aliases: ["天门宗"],
        summary: "控制天门的宗门。",
        description: "",
        tags: [],
        data: { details: "宗门负责维护天门秩序。" },
      })
      .expect(201);
    expect(sameNameDifferentType.body.data.name).toBe("天门");

    const otherWork = await createWork(owner, "另一本书");
    const otherToken = await csrf(owner);
    const otherPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/entities`;
    await owner
      .post(otherPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        type: "world_rule",
        name: "另一本天门",
        aliases: ["the gate"],
        summary: "另一部作品可以复用别名。",
        description: "",
        tags: [],
        data: { rule: "只在这部作品生效。" },
      })
      .expect(201);
  });

  it("defines typed custom fields and validates entity values without breaking existing data", async () => {
    const owner = await createAuthenticatedAgent("settings-custom-fields@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const fieldsPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/custom-fields`;

    const createdField = await owner
      .post(fieldsPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        key: "fate",
        label: "命格",
        fieldType: "single_select",
        appliesTo: "character",
        required: true,
        options: ["剑骨", "凡骨"],
        relationTarget: null,
        sortOrder: 10,
      })
      .expect(201);
    expect(createdField.body.data).toMatchObject({
      key: "fate",
      label: "命格",
      fieldType: "single_select",
      appliesTo: "character",
      required: true,
      options: ["剑骨", "凡骨"],
      enabled: true,
      schemaVersion: 1,
    });

    const missingRequired = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
      })
      .expect(400);
    expect(missingRequired.body.error.code).toBe("CUSTOM_FIELD_REQUIRED");

    const invalidOption = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
        customFields: { fate: "魔骨" },
      })
      .expect(400);
    expect(invalidOption.body.error.code).toBe("CUSTOM_FIELD_INVALID");

    const createdEntity = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
        customFields: { fate: "剑骨" },
      })
      .expect(201);
    expect(createdEntity.body.data.customFields).toEqual({ fate: "剑骨" });

    const updatedDefinition = await owner
      .patch(`${fieldsPath}/${createdField.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        schemaVersion: 1,
        label: "命格",
        required: true,
        options: ["剑骨", "凡骨", "仙骨"],
        enabled: true,
        sortOrder: 10,
      })
      .expect(200);
    expect(updatedDefinition.body.data.schemaVersion).toBe(2);

    const updatedEntity = await owner
      .patch(`${entitiesPath}/${createdEntity.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: createdEntity.body.data.version,
        customFields: { fate: "仙骨" },
      })
      .expect(200);
    expect(updatedEntity.body.data.customFields).toEqual({ fate: "仙骨" });

    const immutableType = await owner
      .patch(`${fieldsPath}/${createdField.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ schemaVersion: 2, fieldType: "text" })
      .expect(400);
    expect(immutableType.body.error.code).toBe("CUSTOM_FIELD_IMMUTABLE");

    const listedFields = await owner.get(fieldsPath).expect(200);
    expect(listedFields.body.data).toHaveLength(1);
    expect(listedFields.body.data[0].schemaVersion).toBe(2);

    const disabled = await owner
      .patch(`${fieldsPath}/${createdField.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ schemaVersion: 2, enabled: false })
      .expect(200);
    expect(disabled.body.data.schemaVersion).toBe(3);
    const historicalEdit = await owner
      .patch(`${entitiesPath}/${createdEntity.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: updatedEntity.body.data.version,
        summary: "外门杂役，正在隐藏忘川书的存在。",
        customFields: { fate: "仙骨" },
      })
      .expect(200);
    expect(historicalEdit.body.data.customFields).toEqual({ fate: "仙骨" });
    const disabledChange = await owner
      .patch(`${entitiesPath}/${createdEntity.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: historicalEdit.body.data.version,
        customFields: { fate: "魔骨" },
      })
      .expect(400);
    expect(disabledChange.body.error.code).toBe("CUSTOM_FIELD_INVALID");
  });

  it("stores golden finger rules, cost, limits and growth constraints", async () => {
    const owner = await createAuthenticatedAgent("settings-golden-finger@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "golden_finger",
        name: "忘川书",
        aliases: [],
        summary: "以重要记忆换取前人经验。",
        description: "每次翻页都会永久失去一段作者指定范围内的记忆。",
        tags: ["核心金手指"],
        data: {
          rules: "每次只能借用一位前人的经验。",
          cost: "永久失去一段重要记忆。",
          limits: "每次使用消耗一页，目前只剩七页。",
          growth: "缺失的记忆会逐步拼成一个完整人格。",
        },
      })
      .expect(201);

    expect(created.body.data).toMatchObject({
      type: "golden_finger",
      data: {
        rules: "每次只能借用一位前人的经验。",
        cost: "永久失去一段重要记忆。",
        limits: "每次使用消耗一页，目前只剩七页。",
        growth: "缺失的记忆会逐步拼成一个完整人格。",
      },
    });
  });

  it("rejects direct edits, alias changes and deletes after a setting is locked", async () => {
    const owner = await createAuthenticatedAgent("settings-locked@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: ["完整记忆律"],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);
    const locked = await owner
      .post(`${path}/${created.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 1 })
      .expect(200);

    const aliasEdit = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        aliases: ["完整记忆律", "天门前律"],
      })
      .expect(409);
    expect(aliasEdit.body.error.code).toBe("SETTING_LOCKED");

    const directEdit = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        summary: "锁定后不应被覆盖。",
      })
      .expect(409);
    expect(directEdit.body.error.code).toBe("SETTING_LOCKED");

    const directDelete = await owner
      .delete(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(409);
    expect(directDelete.body.error.code).toBe("SETTING_LOCKED");
  });

  it("records proposal evidence and conflict decisions before confirmation", async () => {
    const owner = await createAuthenticatedAgent("settings-proposals@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const user = (await owner.get("/api/v1/auth/me").expect(200)).body.data.user;

    const conflicted = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);

    const conflictedProposal = await owner
      .post(`${entitiesPath}/${conflicted.body.data.id}/proposals`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        reason: "从第一章提取到与现有设定相似的世界规则。",
        conflictType: "duplicate_name",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "天门不会为失去记忆的人开启。",
            locator: "第 1 章 · 第 3 段",
            confidence: 0.91,
          },
        ],
      })
      .expect(201);
    expect(conflictedProposal.body.data).toMatchObject({
      entityId: conflicted.body.data.id,
      status: "pending",
      conflictType: "duplicate_name",
      proposedBy: user.id,
      evidence: [
        {
          kind: "chapter",
          label: "第 1 章",
          quote: "天门不会为失去记忆的人开启。",
        },
      ],
    });
    expect(
      (await owner.get(`${entitiesPath}/${conflicted.body.data.id}`).expect(200)).body.data.status,
    ).toBe("proposed");

    const unresolved = await owner
      .post(
        `${entitiesPath}/${conflicted.body.data.id}/proposals/${conflictedProposal.body.data.id}/decision`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        decision: "accept",
        reason: "确认这条设定。",
        conflictType: "duplicate_name",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "作者核对",
            quote: "两条规则仍然冲突。",
            locator: "",
            confidence: null,
          },
        ],
      })
      .expect(409);
    expect(unresolved.body.error.code).toBe("SETTING_CONFLICT_UNRESOLVED");

    const rejected = await owner
      .post(
        `${entitiesPath}/${conflicted.body.data.id}/proposals/${conflictedProposal.body.data.id}/decision`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        decision: "reject",
        reason: "与已确认规则重复，废弃该提案。",
        conflictType: "duplicate_name",
        evidence: [
          {
            kind: "entity",
            sourceId: conflicted.body.data.id,
            label: "天门只认完整记忆",
            quote: "主动抹除关键记忆会导致天门通行失败。",
            locator: "设定详情",
            confidence: 1,
          },
        ],
      })
      .expect(200);
    expect(rejected.body.data).toMatchObject({
      status: "rejected",
      decidedBy: user.id,
      decisionReason: "与已确认规则重复，废弃该提案。",
      decisionConflictType: "duplicate_name",
    });
    expect(
      (await owner.get(`${entitiesPath}/${conflicted.body.data.id}`).expect(200)).body.data.status,
    ).toBe("discarded");

    const accepted = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门会记住每一次违约",
        aliases: [],
        summary: "每次违约都会留下可追踪的印记。",
        description: "",
        tags: [],
        data: { rule: "违约者再次通行时会被天门识别。" },
      })
      .expect(201);
    const acceptedProposal = await owner
      .post(`${entitiesPath}/${accepted.body.data.id}/proposals`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        reason: "新规则候选。",
        conflictType: "none",
        evidence: [
          {
            kind: "ai_suggestion",
            sourceId: null,
            label: "连续性检查",
            quote: "建议补全天门对违约的识别规则。",
            locator: "第 2 章设定检查",
            confidence: 0.74,
          },
        ],
      })
      .expect(201);
    const confirmed = await owner
      .post(
        `${entitiesPath}/${accepted.body.data.id}/proposals/${acceptedProposal.body.data.id}/decision`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        decision: "accept",
        reason: "与前文一致，确认进入已确认设定。",
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 2 章",
            quote: "天门在石壁上留下了违约者的名字。",
            locator: "第 2 章 · 末段",
            confidence: 0.93,
          },
        ],
      })
      .expect(200);
    expect(confirmed.body.data).toMatchObject({
      status: "accepted",
      decidedBy: user.id,
      decisionReason: "与前文一致，确认进入已确认设定。",
    });
    const lockedEntity = await owner.get(`${entitiesPath}/${accepted.body.data.id}`).expect(200);
    expect(lockedEntity.body.data.status).toBe("locked");
    expect(lockedEntity.body.data.version).toBe(3);
  });

  it("routes locked field and alias changes through recorded change requests", async () => {
    const owner = await createAuthenticatedAgent("settings-change-request@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: ["完整记忆律"],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);
    const locked = await owner
      .post(`${path}/${created.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 1 })
      .expect(200);

    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await owner
      .post(`${branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门前律注",
        aliases: [],
        summary: "完整记忆律也被记在残碑背面。",
        description: "",
        tags: [],
        data: { rule: "残碑会复述完整记忆律。" },
      })
      .expect(201);
    await owner
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number: 1,
        title: "断碑夜雨",
        brief: {
          goal: "让沈砚发现完整记忆律。",
          pov: "沈砚",
          location: "荒寺",
          sceneBeats: ["发现碑文"],
          requiredFacts: ["完整记忆律"],
        },
      })
      .expect(201);

    const changeRequest = await owner
      .post(`${path}/${locked.body.data.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        title: "补全天门别名",
        reason: "第一章正文使用了“天门前律”这一称呼。",
        after: {
          aliases: ["完整记忆律", "天门前律"],
          summary: "失去关键记忆的人无法通过天门，也不能伪造完整人格。",
        },
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 1 章",
            quote: "天门前律，只认完整记忆。",
            locator: "第 1 章 · 第 2 段",
            confidence: 0.97,
          },
        ],
      })
      .expect(201);
    expect(changeRequest.body.data).toMatchObject({
      entityId: locked.body.data.id,
      entityVersion: locked.body.data.version,
      title: "补全天门别名",
      status: "pending",
      conflictType: "none",
      before: {
        aliases: ["完整记忆律"],
        summary: "失去关键记忆的人无法通过天门。",
      },
      after: {
        aliases: ["完整记忆律", "天门前律"],
        summary: "失去关键记忆的人无法通过天门，也不能伪造完整人格。",
      },
      evidence: [
        {
          kind: "chapter",
          label: "第 1 章",
          quote: "天门前律，只认完整记忆。",
        },
      ],
      impact: expect.objectContaining({
        chapterCount: 1,
        settingRefCount: 1,
        versionRefCount: expect.any(Number),
        hasImpact: true,
      }),
    });
    expect((changeRequest.body.data as { impact: { message: string } }).impact.message).toContain(
      "影响",
    );

    const listed = await owner.get(`${path}/${locked.body.data.id}/change-requests`).expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].reason).toBe("第一章正文使用了“天门前律”这一称呼。");

    const unlocked = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门不认伪造人格",
        aliases: [],
        summary: "伪造人格无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "伪造人格会被天门识破。" },
      })
      .expect(201);
    const notLocked = await owner
      .post(`${path}/${unlocked.body.data.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: unlocked.body.data.version,
        title: "不应允许",
        reason: "未锁定记录直接编辑即可。",
        after: { summary: "直接编辑即可。" },
        conflictType: "none",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "作者说明",
            quote: "尚未锁定。",
            locator: "",
            confidence: null,
          },
        ],
      })
      .expect(409);
    expect(notLocked.body.error.code).toBe("SETTING_NOT_LOCKED");
  });

  it("requires a proposal decision before editing, locking or deleting a proposed setting", async () => {
    const owner = await createAuthenticatedAgent("settings-proposal-state@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除记忆会导致通行失败。" },
      })
      .expect(201);
    await owner
      .post(`${path}/${created.body.data.id}/proposals`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        reason: "等待作者确认。",
        conflictType: "none",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "作者说明",
            quote: "需要确认这条规则。",
            locator: "",
            confidence: null,
          },
        ],
      })
      .expect(201);
    const proposed = await owner.get(`${path}/${created.body.data.id}`).expect(200);

    const edit = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: proposed.body.data.version, summary: "绕过提案直接修改" })
      .expect(409);
    expect(edit.body.error.code).toBe("SETTING_PROPOSAL_STATE");
    const lock = await owner
      .post(`${path}/${created.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: proposed.body.data.version })
      .expect(409);
    expect(lock.body.error.code).toBe("SETTING_PROPOSAL_STATE");
    const remove = await owner
      .delete(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .expect(409);
    expect(remove.body.error.code).toBe("SETTING_PROPOSAL_STATE");
  });

  it("lists only locked settings in the read-only confirmed-settings projection", async () => {
    const owner = await createAuthenticatedAgent("settings-confirmed@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const confirmed = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);
    await owner
      .post(`${path}/${confirmed.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 1 })
      .expect(200);
    await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
      })
      .expect(201);

    const response = await owner
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/facts`)
      .expect(200);
    expect(response.body.data).toEqual([
      {
        id: confirmed.body.data.id,
        type: "world_rule",
        name: "天门只认完整记忆",
        summary: "失去关键记忆的人无法通过天门。",
        source: "author",
        status: "locked",
        version: 2,
        lockedAt: expect.any(String),
      },
    ]);
  });

  it("rejects type-specific fields that do not belong to the setting", async () => {
    const owner = await createAuthenticatedAgent("settings-type-fields@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
      })
      .expect(201);

    const response = await owner
      .patch(`${path}/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        data: { rule: "人物档案不应接受世界规则字段。" },
      })
      .expect(400);
    expect(response.body.error.code).toBe("SETTING_DOMAIN_DATA_FORBIDDEN");
  });

  it("cannot read or mutate another author's settings", async () => {
    const owner = await createAuthenticatedAgent("settings-owner@example.com");
    const other = await createAuthenticatedAgent("settings-other@example.com");
    const work = await createWork(owner);
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去关键记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除关键记忆会导致天门通行失败。" },
      })
      .expect(201);

    expect((await other.get(path).expect(403)).body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    expect((await other.get(`${path}/${created.body.data.id}`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .patch(`${path}/${created.body.data.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: 1, summary: "越权修改" })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${path}/${created.body.data.id}/lock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: 1 })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .delete(`${path}/${created.body.data.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (await other.get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/facts`).expect(403))
        .body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("serves typed data for all seven setting columns", async () => {
    const owner = await createAuthenticatedAgent("settings-seven-columns@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;

    const item = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "item",
        name: "听潮剑",
        aliases: ["潮生"],
        summary: "会记录持剑者杀意的法器。",
        description: "太玄门内门弟子配剑。",
        tags: ["法器"],
        data: {
          category: "兵器",
          grade: "玄阶",
          effect: "剑身会记录持剑者的杀意。",
          cost: "杀意过重时会反噬持剑者。",
          ownership: "顾青",
          limits: "不能离开主人超过七日。",
        },
      })
      .expect(201);
    expect(item.body.data).toMatchObject({
      type: "item",
      name: "听潮剑",
      data: { category: "兵器", grade: "玄阶", ownership: "顾青" },
    });

    const timelineEvent = await owner
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "timeline_event",
        name: "忘川村灭门",
        aliases: [],
        summary: "十六年前改变沈砚命运的事件。",
        description: "",
        tags: ["背景事件"],
        data: {
          era: "大玄历",
          storyTime: "十六年前",
          duration: "一夜",
          event: "沈砚父母被杀，真相被伪装成自杀。",
        },
      })
      .expect(201);
    expect(timelineEvent.body.data).toMatchObject({
      type: "timeline_event",
      data: { era: "大玄历", storyTime: "十六年前", duration: "一夜" },
    });

    const items = await owner.get(`${path}?type=item`).expect(200);
    expect(items.body.data.map((entry: { name: string }) => entry.name)).toEqual(["听潮剑"]);
    const timeline = await owner.get(`${path}?type=timeline_event`).expect(200);
    expect(timeline.body.data.map((entry: { name: string }) => entry.name)).toEqual(["忘川村灭门"]);
  });

  it("validates relation references and change-request type drift", async () => {
    const owner = await createAuthenticatedAgent("settings-relations@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const entitiesPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const fieldsPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/custom-fields`;

    const item = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "item",
        name: "半枚青玉",
        aliases: [],
        summary: "与沈砚身世有关的旧玉。",
        description: "",
        tags: ["线索"],
        data: {
          category: "信物",
          grade: "",
          effect: "记录身世线索。",
          cost: "",
          ownership: "顾青",
          limits: "",
        },
      })
      .expect(201);
    const worldRule = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除记忆会导致通行失败。" },
      })
      .expect(201);

    await owner
      .post(fieldsPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        key: "related_relic",
        label: "关联物品",
        fieldType: "relation_ref",
        appliesTo: "character",
        required: false,
        options: [],
        relationTarget: "item",
        sortOrder: 20,
      })
      .expect(201);

    const character = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "顾青受命监视他。",
        },
        customFields: { related_relic: item.body.data.id },
      })
      .expect(201);
    expect(character.body.data.customFields.related_relic).toBe(item.body.data.id);

    const wrongType = await owner
      .post(entitiesPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "顾青",
        aliases: [],
        summary: "太玄门内门弟子。",
        description: "",
        tags: [],
        data: {
          bodyState: "健康。",
          knowledgeBoundary: "知道沈砚的部分身世。",
          relationshipSummary: "奉命监视沈砚。",
        },
        customFields: { related_relic: worldRule.body.data.id },
      })
      .expect(400);
    expect(wrongType.body.error.code).toBe("CUSTOM_FIELD_INVALID");

    const locked = await owner
      .post(`${entitiesPath}/${item.body.data.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: item.body.data.version })
      .expect(200);
    const drifted = await owner
      .post(`${entitiesPath}/${locked.body.data.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        title: "补全物品代价",
        reason: "正文已经写明清玉会灼伤持玉者。",
        after: { data: { bodyState: "不应该出现在物品里。" } },
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 46 章",
            quote: "青玉贴在手心，像一块烧红的铁。",
            locator: "第 46 章 · 末段",
            confidence: 0.95,
          },
        ],
      })
      .expect(400);
    expect(drifted.body.error.code).toBe("VALIDATION_INVALID");

    const valid = await owner
      .post(`${entitiesPath}/${locked.body.data.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        title: "补全物品代价",
        reason: "正文已经写明清玉会灼伤持玉者。",
        after: { data: { cost: "贴身携带会灼伤皮肤。" } },
        conflictType: "none",
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 46 章",
            quote: "青玉贴在手心，像一块烧红的铁。",
            locator: "第 46 章 · 末段",
            confidence: 0.95,
          },
        ],
      })
      .expect(201);
    expect(valid.body.data.after.data).toMatchObject({
      category: "信物",
      cost: "贴身携带会灼伤皮肤。",
    });
  });

  it("paginates setting entities with tenant-scoped stable cursors", async () => {
    const owner = await createAuthenticatedAgent("settings-entity-pagination@example.com");
    const other = await createAuthenticatedAgent("settings-entity-pagination-other@example.com");
    const work = await createWork(owner);
    const otherWork = await createWork(other, "另一本设定分页作品");
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const otherPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/entities`;
    const createdIds: string[] = [];
    for (const [index, name] of ["天门一", "天门二", "天门三"].entries()) {
      const created = await createWorldRule(owner, path, token, name, index);
      createdIds.push(created.id);
    }
    const foreign = await createWorldRule(other, otherPath, otherToken, "他人设定", 0);

    const first = await owner.get(`${path}?limit=2`).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));
    expect(first.body.data.map((entity: { id: string }) => entity.id)).toEqual(
      createdIds.slice(0, 2),
    );

    const last = await owner
      .get(`${path}?limit=2&cursor=${first.body.meta.nextCursor}`)
      .expect(200);
    expect(last.body.data.map((entity: { id: string }) => entity.id)).toEqual(createdIds.slice(2));
    expect(last.body.meta.nextCursor).toBeNull();

    expect((await owner.get(`${path}?cursor=not-a-uuid`).expect(400)).body.error.code).toBe(
      "VALIDATION_INVALID",
    );
    expect((await owner.get(`${path}?limit=0`).expect(400)).body.error.code).toBe(
      "VALIDATION_INVALID",
    );
    expect(
      (await owner.get(`${path}?limit=1&cursor=${foreign.id}`).expect(400)).body.error.code,
    ).toBe("VALIDATION_INVALID");
  });

  it("paginates custom field definitions with tenant-scoped stable cursors", async () => {
    const owner = await createAuthenticatedAgent("settings-field-pagination@example.com");
    const other = await createAuthenticatedAgent("settings-field-pagination-other@example.com");
    const work = await createWork(owner);
    const otherWork = await createWork(other, "另一本字段分页作品");
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/custom-fields`;
    const otherPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/custom-fields`;
    const createdIds: string[] = [];
    for (const [index, key] of ["field_a", "field_b", "field_c"].entries()) {
      const created = await owner
        .post(path)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          key,
          label: `字段${index + 1}`,
          fieldType: "text",
          appliesTo: "all",
          required: false,
          options: [],
          relationTarget: null,
          sortOrder: 0,
        })
        .expect(201);
      createdIds.push(created.body.data.id);
    }
    const foreign = await other
      .post(otherPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        key: "foreign",
        label: "他人字段",
        fieldType: "text",
        appliesTo: "all",
        required: false,
        options: [],
        relationTarget: null,
        sortOrder: 0,
      })
      .expect(201);

    const first = await owner.get(`${path}?limit=2`).expect(200);
    expect(first.body.data.map((field: { id: string }) => field.id)).toEqual(
      createdIds.slice(0, 2),
    );
    expect(first.body.meta.nextCursor).toEqual(expect.any(String));

    const last = await owner
      .get(`${path}?limit=2&cursor=${first.body.meta.nextCursor}`)
      .expect(200);
    expect(last.body.data.map((field: { id: string }) => field.id)).toEqual(createdIds.slice(2));
    expect(last.body.meta.nextCursor).toBeNull();

    expect((await owner.get(`${path}?cursor=not-a-uuid`).expect(400)).body.error.code).toBe(
      "VALIDATION_INVALID",
    );
    expect(
      (await owner.get(`${path}?limit=1&cursor=${foreign.body.data.id}`).expect(400)).body.error
        .code,
    ).toBe("VALIDATION_INVALID");
  });

  it("paginates setting proposals with tenant-scoped cursors", async () => {
    const owner = await createAuthenticatedAgent("settings-proposal-page-owner@example.com");
    const other = await createAuthenticatedAgent("settings-proposal-page-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await createWorldRule(owner, path, token, "分页提案规则", 0);
    const proposalIds = [uuidv7(), uuidv7(), uuidv7()];
    const evidence = JSON.stringify([
      {
        kind: "author_note",
        sourceId: null,
        label: "作者说明",
        quote: "用于验证分页。",
        locator: "",
        confidence: null,
      },
    ]);
    for (const [index, proposalId] of proposalIds.entries()) {
      await databasePool.query(
        `INSERT INTO setting_proposals
          (id, entity_id, work_id, branch_id, user_id, entity_version, status, conflict_type,
           evidence, reason, proposed_by, created_at)
         VALUES ($1, $2, $3, $4, (SELECT id FROM users ORDER BY created_at LIMIT 1), 1,
                 'pending', 'none', $5::jsonb, $6, (SELECT id FROM users ORDER BY created_at LIMIT 1),
                 now() - ($7::text || ' seconds')::interval)`,
        [
          proposalId,
          created.id,
          work.id,
          work.mainBranch.id,
          evidence,
          `分页提案 ${index + 1}`,
          String(3 - index),
        ],
      );
    }

    const first = await owner.get(`${path}/${created.id}/proposals?limit=2`).expect(200);
    expect(first.body.data.map((proposal: { id: string }) => proposal.id)).toEqual(
      proposalIds.slice(0, 2),
    );
    expect(first.body.meta.nextCursor).toBe(proposalIds[1]);
    const second = await owner
      .get(`${path}/${created.id}/proposals?limit=2&cursor=${first.body.meta.nextCursor}`)
      .expect(200);
    expect(second.body.data.map((proposal: { id: string }) => proposal.id)).toEqual([
      proposalIds[2],
    ]);
    expect(second.body.meta.nextCursor).toBeNull();

    const otherWork = await createWork(other);
    const otherToken = await csrf(other);
    const otherPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/entities`;
    const otherEntity = await createWorldRule(other, otherPath, otherToken, "其他租户提案", 0);
    const otherProposalId = uuidv7();
    await databasePool.query(
      `INSERT INTO setting_proposals
        (id, entity_id, work_id, branch_id, user_id, entity_version, status, conflict_type,
         evidence, reason, proposed_by)
       VALUES ($1, $2, $3, $4, (SELECT id FROM users WHERE email = $5), 1, 'pending', 'none',
               $6::jsonb, '其他租户提案', (SELECT id FROM users WHERE email = $5))`,
      [
        otherProposalId,
        otherEntity.id,
        otherWork.id,
        otherWork.mainBranch.id,
        "settings-proposal-page-other@example.com",
        evidence,
      ],
    );
    const denied = await owner
      .get(`${path}/${created.id}/proposals?limit=1&cursor=${otherProposalId}`)
      .expect(400);
    expect(denied.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("paginates setting change requests with tenant-scoped cursors", async () => {
    const owner = await createAuthenticatedAgent("settings-change-page-owner@example.com");
    const other = await createAuthenticatedAgent("settings-change-page-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await createWorldRule(owner, path, token, "分页修改规则", 0);
    const locked = await owner
      .post(`${path}/${created.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: created.version })
      .expect(200);

    const createChange = async (title: string) =>
      (
        await owner
          .post(`${path}/${created.id}/change-requests`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: locked.body.data.version,
            title,
            reason: `${title}原因`,
            after: { summary: `${title}摘要` },
            conflictType: "none",
            evidence: [
              {
                kind: "author_note",
                sourceId: null,
                label: "作者说明",
                quote: title,
                locator: "",
                confidence: null,
              },
            ],
          })
          .expect(201)
      ).body.data.id as string;
    const requestIds = [
      await createChange("修改请求一"),
      await createChange("修改请求二"),
      await createChange("修改请求三"),
    ];

    const first = await owner.get(`${path}/${created.id}/change-requests?limit=2`).expect(200);
    expect(first.body.data.map((request: { id: string }) => request.id)).toEqual(
      requestIds.slice(0, 2),
    );
    expect(first.body.meta.nextCursor).toBe(requestIds[1]);
    const second = await owner
      .get(`${path}/${created.id}/change-requests?limit=2&cursor=${first.body.meta.nextCursor}`)
      .expect(200);
    expect(second.body.data.map((request: { id: string }) => request.id)).toEqual([requestIds[2]]);
    expect(second.body.meta.nextCursor).toBeNull();

    const otherWork = await createWork(other);
    const otherToken = await csrf(other);
    const otherPath = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranch.id}/entities`;
    const otherEntity = await createWorldRule(other, otherPath, otherToken, "其他租户修改", 0);
    const otherLocked = await other
      .post(`${otherPath}/${otherEntity.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version: otherEntity.version })
      .expect(200);
    const otherRequest = await other
      .post(`${otherPath}/${otherEntity.id}/change-requests`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        version: otherLocked.body.data.version,
        title: "其他租户修改请求",
        reason: "用于验证跨租户游标失败。",
        after: { summary: "其他租户摘要" },
        conflictType: "none",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "作者说明",
            quote: "其他租户",
            locator: "",
            confidence: null,
          },
        ],
      })
      .expect(201);
    const denied = await owner
      .get(`${path}/${created.id}/change-requests?limit=1&cursor=${otherRequest.body.data.id}`)
      .expect(400);
    expect(denied.body.error.code).toBe("VALIDATION_INVALID");
  });

  it("restores an old setting version through a new rollback node without rewriting history", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-version@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await createWorldRule(owner, path, token, "天门旧规", 0);
    const edited = await owner
      .patch(`${path}/${created.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.version,
        summary: "后来被改坏的天门规则。",
        aliases: ["错误别名"],
      })
      .expect(200);

    const previousSnapshots = await databasePool.query<{
      version: number;
      snapshot: Record<string, unknown>;
      version_node_id: string;
    }>(
      `SELECT ev.version, ev.snapshot, ev.version_node_id
         FROM entity_versions ev
        WHERE ev.entity_id = $1
        ORDER BY ev.version`,
      [created.id],
    );
    expect(previousSnapshots.rows.map((row) => row.version)).toEqual([1, 2]);

    const restored = await owner
      .post(`${path}/${created.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: edited.body.data.version,
        targetVersion: 1,
        reason: "恢复第一版天门规则。",
      })
      .expect(200);
    expect(restored.body.data).toMatchObject({
      id: created.id,
      name: "天门旧规",
      summary: "第一版天门规则",
      aliases: [],
      status: "draft",
      version: 3,
    });

    const history = await databasePool.query<{
      version: number;
      snapshot: Record<string, unknown>;
      version_node_id: string;
      node_type: string;
      parent_node_id: string | null;
    }>(
      `SELECT ev.version, ev.snapshot, ev.version_node_id, vn.node_type, vn.parent_node_id
         FROM entity_versions ev
         JOIN version_nodes vn ON vn.id = ev.version_node_id
        WHERE ev.entity_id = $1
        ORDER BY ev.version`,
      [created.id],
    );
    expect(history.rows.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(history.rows.map((row) => row.node_type)).toEqual([
      "entity_version",
      "entity_version",
      "rollback",
    ]);
    expect(history.rows[0]?.snapshot).toEqual(previousSnapshots.rows[0]?.snapshot);
    expect(history.rows[1]?.snapshot).toEqual(previousSnapshots.rows[1]?.snapshot);
    expect(history.rows[2]?.snapshot).toMatchObject({
      name: "天门旧规",
      summary: "第一版天门规则",
      version: 3,
    });
    expect(history.rows[2]?.parent_node_id).toBe(history.rows[1]?.version_node_id);
    const branch = await databasePool.query<{ head_node_id: string }>(
      "SELECT head_node_id FROM work_branches WHERE id = $1",
      [work.mainBranch.id],
    );
    expect(branch.rows[0]?.head_node_id).toBe(history.rows[2]?.version_node_id);

    const locked = await owner
      .post(`${path}/${created.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: restored.body.data.version })
      .expect(200);
    const nodesBeforeBlockedRestore = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM version_nodes
        WHERE object_type = 'setting' AND object_id = $1`,
      [created.id],
    );
    const blocked = await owner
      .post(`${path}/${created.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: locked.body.data.version,
        targetVersion: 2,
        reason: "锁定记录不能绕过修改请求直接恢复。",
      })
      .expect(409);
    expect(blocked.body.error.code).toBe("SETTING_LOCKED");
    const nodesAfterBlockedRestore = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM version_nodes
        WHERE object_type = 'setting' AND object_id = $1`,
      [created.id],
    );
    expect(nodesAfterBlockedRestore.rows[0]?.count).toBe(nodesBeforeBlockedRestore.rows[0]?.count);
  });

  it("restores the exact historical custom-field snapshot without newer values", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-custom-fields@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    await owner
      .post(`${base}/custom-fields`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        key: "fate",
        label: "命格",
        fieldType: "text",
        appliesTo: "all",
        required: false,
        options: [],
        relationTarget: null,
        sortOrder: 0,
      })
      .expect(201);
    const created = await owner
      .post(`${base}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name: "天门命格律",
        aliases: [],
        summary: "第一版命格规则。",
        description: "",
        tags: [],
        data: { rule: "命格决定天门开启顺序。" },
        customFields: { fate: "剑骨" },
      })
      .expect(201);
    await owner
      .post(`${base}/custom-fields`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        key: "curse",
        label: "反噬",
        fieldType: "text",
        appliesTo: "all",
        required: false,
        options: [],
        relationTarget: null,
        sortOrder: 1,
      })
      .expect(201);
    const edited = await owner
      .patch(`${base}/entities/${created.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        customFields: { fate: "仙骨", curse: "每七日反噬一次" },
      })
      .expect(200);
    expect(edited.body.data.customFields).toEqual({
      fate: "仙骨",
      curse: "每七日反噬一次",
    });

    const restored = await owner
      .post(`${base}/entities/${created.body.data.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: edited.body.data.version,
        targetVersion: 1,
        reason: "恢复第一版命格，同时移除后来增加的反噬字段。",
      })
      .expect(200);
    expect(restored.body.data.customFields).toEqual({ fate: "剑骨" });
    const stored = await databasePool.query<{ key: string; value: unknown }>(
      `SELECT cfd.key, cfv.value
         FROM custom_field_values cfv
         JOIN custom_field_definitions cfd ON cfd.id = cfv.field_definition_id
        WHERE cfv.entity_id = $1
        ORDER BY cfd.key`,
      [created.body.data.id],
    );
    expect(stored.rows).toEqual([{ key: "fate", value: "剑骨" }]);
  });

  it("restores character profiles from the historical entity snapshot", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-character@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const character = await owner
      .post(`${base}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死因。",
          relationshipSummary: "顾青负责监视他。",
        },
      })
      .expect(201);

    const updated = await owner
      .patch(`${base}/characters/${character.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: character.body.data.version,
        profile: {
          desire: "找回失去的记忆",
          fear: "再次被宗门抛弃",
          goal: "进入内门",
          voiceSample: "我不欠任何人。",
          voiceGuide: "短句，克制。",
          disguise: "装作不在意。",
        },
      })
      .expect(200);
    expect(updated.body.data.profile).toMatchObject({
      desire: "找回失去的记忆",
      goal: "进入内门",
    });

    const restored = await owner
      .post(`${base}/entities/${character.body.data.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: updated.body.data.version,
        targetVersion: 1,
        reason: "恢复人物初版档案。",
      })
      .expect(200);
    expect(restored.body.data.version).toBe(3);
    const profile = await databasePool.query<{
      desire: string;
      fear: string;
      goal: string;
      voice_sample: string;
      voice_guide: string;
      disguise: string;
    }>(
      `SELECT desire, fear, goal, voice_sample, voice_guide, disguise
         FROM character_profiles
        WHERE entity_id = $1`,
      [character.body.data.id],
    );
    expect(profile.rows[0]).toEqual({
      desire: "",
      fear: "",
      goal: "",
      voice_sample: "",
      voice_guide: "",
      disguise: "",
    });
  });

  it("rejects generic domain data patches and updates dedicated projections in one truth source", async () => {
    const owner = await createAuthenticatedAgent("settings-domain-single-source@example.com");
    const work = await createWork(owner, "单一真源作品");
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    const character = await owner
      .post(`${base}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: [],
        summary: "外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折。",
          knowledgeBoundary: "不知道父母死因。",
          relationshipSummary: "顾青负责监视他。",
        },
      })
      .expect(201);

    const characterRejected = await owner
      .patch(`${base}/entities/${character.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: character.body.data.version,
        data: { bodyState: "左臂已愈。" },
      })
      .expect(400);
    expect(characterRejected.body.error.code).toBe("SETTING_DOMAIN_DATA_FORBIDDEN");

    const characterUpdated = await owner
      .patch(`${base}/characters/${character.body.data.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: character.body.data.version,
        name: "沈砚·改",
        summary: "内门弟子。",
        profile: {
          desire: "找回失去的记忆",
          fear: "再次被宗门抛弃",
          goal: "进入内门",
          voiceSample: "我不欠任何人。",
          voiceGuide: "短句，克制。",
          disguise: "装作不在意。",
        },
      })
      .expect(200);
    expect(characterUpdated.body.data.character.label).toBe("沈砚·改");
    const characterProjection = await owner
      .get(`${base}/entities/${character.body.data.id}`)
      .expect(200);
    expect(characterProjection.body.data).toMatchObject({
      name: "沈砚·改",
      summary: "内门弟子。",
      version: 2,
    });

    const map = await owner
      .post(`${base}/world/maps`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "北域",
        aliases: [],
        summary: "北域地图。",
        description: "",
        tags: [],
        details: "第一版地图说明。",
      })
      .expect(201);
    const mapRejected = await owner
      .patch(`${base}/entities/${map.body.data.map.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: map.body.data.version,
        data: { details: "第二版地图说明。" },
      })
      .expect(400);
    expect(mapRejected.body.error.code).toBe("SETTING_DOMAIN_DATA_FORBIDDEN");
    const mapUpdated = await owner
      .patch(`${base}/world/maps/${map.body.data.map.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: map.body.data.version,
        name: "北域·改",
        summary: "更新后的北域地图。",
        details: "第二版地图说明。",
      })
      .expect(200);
    expect(mapUpdated.body.data.map.label).toBe("北域·改");
    const mapProjection = await owner.get(`${base}/entities/${map.body.data.map.id}`).expect(200);
    expect(mapProjection.body.data).toMatchObject({
      name: "北域·改",
      summary: "更新后的北域地图。",
      version: 2,
      data: { details: "第二版地图说明。" },
    });

    await owner
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
    const timelineEvent = await owner
      .post(`${base}/world/timeline/events`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "忘川村灭门",
        aliases: [],
        summary: "改变沈砚命运的事件。",
        description: "",
        tags: [],
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 16 },
        durationMinutes: 0,
        durationLabel: "一夜",
        event: "第一版事件描述。",
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
      })
      .expect(201);
    const timelineRejected = await owner
      .patch(`${base}/entities/${timelineEvent.body.data.event.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        data: { event: "第二版事件描述。" },
      })
      .expect(400);
    expect(timelineRejected.body.error.code).toBe("SETTING_DOMAIN_DATA_FORBIDDEN");
    const timelineUpdated = await owner
      .patch(`${base}/world/timeline/events/${timelineEvent.body.data.event.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 1,
        name: "忘川村灭门·改",
        summary: "更新后的关键事件。",
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 16 },
        durationMinutes: 0,
        durationLabel: "一夜",
        event: "第二版事件描述。",
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
      })
      .expect(200);
    expect(timelineUpdated.body.data.event.label).toBe("忘川村灭门·改");
    const timelineProjection = await owner
      .get(`${base}/entities/${timelineEvent.body.data.event.id}`)
      .expect(200);
    expect(timelineProjection.body.data).toMatchObject({
      name: "忘川村灭门·改",
      summary: "更新后的关键事件。",
      version: 2,
      data: { event: "第二版事件描述。" },
    });
  });

  it("lists and restores a character domain snapshot written by the character API", async () => {
    const owner = await createAuthenticatedAgent("settings-character-domain-history@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const created = await owner
      .post(`${base}/characters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "沈砚",
        aliases: ["小砚"],
        summary: "外门杂役。",
        description: "正在隐藏忘川书的存在。",
        tags: ["主角"],
        profile: {
          desire: "找回失去的记忆",
          fear: "再次被宗门抛弃",
          goal: "进入内门",
          voiceSample: "我不欠任何人。",
          voiceGuide: "短句，克制。",
          disguise: "装作不在意。",
        },
      })
      .expect(201);
    const updated = await owner
      .patch(`${base}/characters/${created.body.data.character.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        profile: {
          desire: "查清父母死因",
          fear: "被忘川书吞噬",
          goal: "进入天门",
          voiceSample: "我必须知道真相。",
          voiceGuide: "极短句，压抑。",
          disguise: "假装顺从。",
        },
      })
      .expect(200);
    await databasePool.query(
      `UPDATE entity_versions
          SET snapshot = $2::jsonb
        WHERE entity_id = $1 AND version = 1`,
      [
        created.body.data.character.id,
        JSON.stringify({
          profile: {
            desire: "找回失去的记忆",
            fear: "再次被宗门抛弃",
            goal: "进入内门",
            voiceSample: "我不欠任何人。",
            voiceGuide: "短句，克制。",
            disguise: "装作不在意。",
          },
          relationships: [],
          stateTransitions: [],
          knowledgeStates: [],
        }),
      ],
    );

    const history = await owner
      .get(`${base}/entities/${created.body.data.character.id}/versions?limit=2`)
      .expect(200);
    expect(history.body.data.map((entry: { version: number }) => entry.version)).toEqual([2, 1]);
    expect(history.body.data[0]).toMatchObject({
      snapshot: {
        domain: "character",
        payload: {
          type: "character",
          name: "沈砚",
          domain: {
            profile: {
              desire: "查清父母死因",
              fear: "被忘川书吞噬",
              goal: "进入天门",
            },
          },
        },
      },
      summary: {
        name: "沈砚",
        summary: "外门杂役。",
        status: "draft",
      },
    });
    expect(history.body.data[1]).toMatchObject({
      snapshot: {
        domain: "character",
        payload: {
          profile: {
            desire: "找回失去的记忆",
            fear: "再次被宗门抛弃",
            goal: "进入内门",
          },
        },
      },
      summary: {
        name: null,
        summary: null,
        status: null,
      },
    });

    await owner
      .post(`${base}/entities/${created.body.data.character.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: updated.body.data.version,
        targetVersion: 1,
        reason: "恢复人物初版档案。",
      })
      .expect(200);
    const restored = await owner
      .get(`${base}/characters/${created.body.data.character.id}`)
      .expect(200);
    expect(restored.body.data.profile).toEqual({
      desire: "找回失去的记忆",
      fear: "再次被宗门抛弃",
      goal: "进入内门",
      voiceSample: "我不欠任何人。",
      voiceGuide: "短句，克制。",
      disguise: "装作不在意。",
    });
  });

  it("restores the power-system projection while preserving its lifespan policy", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-power-system@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const created = await owner
      .post(`${base}/world/power-systems`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "北域双路径",
        aliases: [],
        summary: "剑修与体修并行。",
        description: "",
        tags: ["修行"],
        overview: "第一版力量体系总览。",
        lifespanPolicy: {
          mode: "fixed",
          unit: "年",
          basis: "",
          description: "固定寿元。",
          pathId: null,
          fixedAmount: 120,
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
                description: "感应天地灵气。",
                breakthroughConditions: "感应灵气。",
                breakthroughCosts: "",
                bottlenecks: "",
                counters: "锁灵阵。",
                counteredBy: "",
                lifespanAmount: 120,
                prerequisiteRealmId: null,
              },
              {
                name: "筑基",
                rank: 2,
                description: "灵台稳固。",
                breakthroughConditions: "灵台稳固。",
                breakthroughCosts: "三百灵石。",
                bottlenecks: "心魔未除。",
                counters: "破阵术。",
                counteredBy: "护山阵。",
                lifespanAmount: 240,
                prerequisiteRealmId: null,
              },
            ],
          },
        ],
      })
      .expect(201);
    await owner
      .patch(`${base}/world/power-systems/${created.body.data.powerSystem.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: created.body.data.version,
        overview: "第二版力量体系总览。",
        lifespanPolicy: {
          mode: "custom",
          unit: "载",
          basis: "修为",
          description: "第二版寿元规则。",
          pathId: null,
          fixedAmount: null,
        },
      })
      .expect(200);
    await owner
      .post(`${base}/world/power-systems/${created.body.data.powerSystem.id}/paths`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "体修",
        pathType: "炼体",
        description: "以肉身破境。",
        sortOrder: 1,
        realms: [],
      })
      .expect(201);
    const changed = await owner
      .get(`${base}/world/power-systems/${created.body.data.powerSystem.id}`)
      .expect(200);
    const history = await owner
      .get(`${base}/entities/${created.body.data.powerSystem.id}/versions?limit=1`)
      .expect(200);
    expect(history.body.data[0]).toMatchObject({
      snapshot: {
        domain: "power_system",
        payload: {
          type: "power_system",
          name: "北域双路径",
          domain: {
            overview: "第二版力量体系总览。",
            lifespanPolicy: {
              mode: "custom",
              unit: "载",
              basis: "修为",
              description: "第二版寿元规则。",
              pathId: null,
              fixedAmount: null,
            },
          },
        },
      },
      summary: {
        name: "北域双路径",
        summary: "剑修与体修并行。",
        status: "draft",
      },
    });
    expect(history.body.data[0].snapshot.payload.domain.paths).toHaveLength(2);

    const restored = await owner
      .post(`${base}/entities/${created.body.data.powerSystem.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: changed.body.data.version,
        targetVersion: 1,
        reason: "恢复第一版力量体系与完整修行路径。",
      });
    if (restored.status !== 200) {
      throw new Error(`Failed to restore power system: ${JSON.stringify(restored.body)}`);
    }

    const detail = await owner
      .get(`${base}/world/power-systems/${created.body.data.powerSystem.id}`)
      .expect(200);
    expect(detail.body.data.overview).toBe("第一版力量体系总览。");
    expect(detail.body.data.lifespanPolicy).toEqual({
      mode: "fixed",
      unit: "年",
      basis: "",
      description: "固定寿元。",
      pathId: null,
      fixedAmount: 120,
    });
    expect(detail.body.data.paths).toHaveLength(1);
    expect(detail.body.data.paths[0]).toMatchObject({
      name: "剑修",
      pathType: "剑道",
      description: "以剑意破境。",
      sortOrder: 0,
    });
    expect(detail.body.data.paths[0].realms).toHaveLength(2);
    expect(detail.body.data.paths[0].realms[0]).toMatchObject({
      name: "引气",
      rank: 1,
      description: "感应天地灵气。",
      breakthroughConditions: "感应灵气。",
      breakthroughCosts: "",
      bottlenecks: "",
      counters: "锁灵阵。",
      counteredBy: "",
      lifespanAmount: 120,
      prerequisiteRealmId: null,
    });
    expect(detail.body.data.paths[0].realms[1]).toMatchObject({
      name: "筑基",
      rank: 2,
      description: "灵台稳固。",
      breakthroughConditions: "灵台稳固。",
      breakthroughCosts: "三百灵石。",
      bottlenecks: "心魔未除。",
      counters: "破阵术。",
      counteredBy: "护山阵。",
      lifespanAmount: 240,
      prerequisiteRealmId: null,
    });
    expect(detail.body.data.version).toBe(4);
    const restoredHistory = await owner
      .get(`${base}/entities/${created.body.data.powerSystem.id}/versions?limit=1`)
      .expect(200);
    expect(restoredHistory.body.data[0].snapshot.payload.domain.paths).toHaveLength(1);
    expect(restoredHistory.body.data[0].snapshot.payload.domain.paths[0].versionNodeId).toBe(
      restoredHistory.body.data[0].node,
    );
    expect(
      restoredHistory.body.data[0].snapshot.payload.domain.paths[0].realms.map(
        (realm: { versionNodeId: string }) => realm.versionNodeId,
      ),
    ).toEqual([restoredHistory.body.data[0].node, restoredHistory.body.data[0].node]);
  });

  it("restores faction and timeline projections from historical snapshots", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-domain-projections@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const faction = await owner
      .post(`${base}/world/factions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "太玄门",
        aliases: [],
        summary: "北域第一剑宗。",
        description: "",
        tags: [],
        profile: {
          overview: "第一版势力总览。",
          goals: "守住北域剑道正统。",
          resources: "十二座剑峰与三处灵石矿。",
          doctrine: "剑心不可折，门规不可废。",
        },
      })
      .expect(201);
    const updatedFaction = await owner
      .patch(`${base}/world/factions/${faction.body.data.faction.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: faction.body.data.version,
        profile: {
          overview: "第二版势力总览。",
          goals: "扩张到南域。",
          resources: "新增两座灵矿。",
          doctrine: "先胜后礼。",
        },
      })
      .expect(200);
    const factionHistory = await owner
      .get(`${base}/entities/${faction.body.data.faction.id}/versions?limit=2`)
      .expect(200);
    expect(factionHistory.body.data[0]).toMatchObject({
      snapshot: {
        domain: "faction",
        payload: {
          type: "faction",
          name: "太玄门",
          domain: {
            profile: {
              overview: "第二版势力总览。",
              goals: "扩张到南域。",
              resources: "新增两座灵矿。",
              doctrine: "先胜后礼。",
            },
          },
        },
      },
    });
    await owner
      .post(`${base}/entities/${faction.body.data.faction.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: updatedFaction.body.data.version,
        targetVersion: 1,
        reason: "恢复势力初版总览。",
      })
      .expect(200);
    const factionDetail = await owner
      .get(`${base}/world/factions/${faction.body.data.faction.id}`)
      .expect(200);
    expect(factionDetail.body.data.profile).toEqual({
      overview: "第一版势力总览。",
      goals: "守住北域剑道正统。",
      resources: "十二座剑峰与三处灵石矿。",
      doctrine: "剑心不可折，门规不可废。",
    });

    await owner
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
    const timelineEvent = await owner
      .post(`${base}/world/timeline/events`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "忘川村灭门",
        aliases: [],
        summary: "改变沈砚命运的事件。",
        description: "",
        tags: [],
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 16 },
        durationMinutes: 0,
        durationLabel: "一夜",
        event: "第一版事件描述。",
        validity: {
          fromChapter: 1,
          toChapter: null,
          fromStoryTime: null,
          toStoryTime: null,
        },
      });
    if (timelineEvent.status !== 201) {
      throw new Error(`Failed to create timeline event: ${JSON.stringify(timelineEvent.body)}`);
    }
    const timelineEntity = await owner
      .get(`${base}/entities/${timelineEvent.body.data.event.id}`)
      .expect(200);
    const updatedTimeline = await owner
      .patch(`${base}/world/timeline/events/${timelineEvent.body.data.event.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: timelineEntity.body.data.version,
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 16 },
        event: "第二版事件描述。",
      })
      .expect(200);
    expect(updatedTimeline.body.data.eventText).toBe("第二版事件描述。");
    const updatedTimelineEntity = await owner
      .get(`${base}/entities/${timelineEvent.body.data.event.id}`)
      .expect(200);
    await owner
      .post(`${base}/entities/${timelineEvent.body.data.event.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: updatedTimelineEntity.body.data.version,
        targetVersion: 1,
        reason: "恢复时间线初版事件。",
      })
      .expect(200);
    const timeline = await owner.get(`${base}/world/timeline`).expect(200);
    expect(
      timeline.body.data.events.find(
        (event: { event: { id: string } }) => event.event.id === timelineEvent.body.data.event.id,
      )?.eventText,
    ).toBe("第一版事件描述。");
  });

  it("allows only one concurrent restore for the same current version", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-concurrency@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await createWorldRule(owner, path, token, "并发恢复规则", 0);
    const edited = await owner
      .patch(`${path}/${created.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: created.version, summary: "并发恢复前的第二版。" })
      .expect(200);
    const payload = {
      version: edited.body.data.version,
      targetVersion: 1,
      reason: "只允许一个并发恢复成功。",
    };
    const restore = () =>
      owner
        .post(`${path}/${created.id}/restore`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(payload);

    const responses = await Promise.all([restore(), restore()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(responses.find((response) => response.status === 409)?.body.error.code).toBe(
      "VERSION_CONFLICT",
    );
    const versions = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM entity_versions
        WHERE entity_id = $1`,
      [created.id],
    );
    expect(versions.rows[0]?.count).toBe("3");
  });

  it("fails closed when another tenant attempts to restore a setting version", async () => {
    const owner = await createAuthenticatedAgent("settings-restore-owner@example.com");
    const other = await createAuthenticatedAgent("settings-restore-other@example.com");
    const work = await createWork(owner);
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const path = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`;
    const created = await createWorldRule(owner, path, ownerToken, "租户恢复规则", 0);
    const edited = await owner
      .patch(`${path}/${created.id}`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({ version: created.version, summary: "租户恢复第二版。" })
      .expect(200);
    const before = await databasePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM entity_versions WHERE entity_id = $1",
      [created.id],
    );

    const denied = await other
      .post(`${path}/${created.id}/restore`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        version: edited.body.data.version,
        targetVersion: 1,
        reason: "越权恢复。",
      })
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const deniedHistory = await other.get(`${path}/${created.id}/versions?limit=1`).expect(403);
    expect(deniedHistory.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const after = await databasePool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM entity_versions WHERE entity_id = $1",
      [created.id],
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it("fails closed across tenants for custom fields, proposals and change requests", async () => {
    const owner = await createAuthenticatedAgent("settings-child-owner@example.com");
    const other = await createAuthenticatedAgent("settings-child-other@example.com");
    const work = await createWork(owner);
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    await owner
      .post(`${base}/custom-fields`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        key: "fate",
        label: "命格",
        fieldType: "single_select",
        appliesTo: "character",
        required: false,
        options: ["剑骨", "凡骨"],
        relationTarget: null,
        sortOrder: 0,
      })
      .expect(201);
    const entity = await owner
      .post(`${base}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        summary: "失去记忆的人无法通过天门。",
        description: "",
        tags: [],
        data: { rule: "主动抹除记忆会导致通行失败。" },
      })
      .expect(201);
    const proposal = await owner
      .post(`${base}/entities/${entity.body.data.id}/proposals`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .send({
        version: entity.body.data.version,
        reason: "等待作者确认。",
        conflictType: "none",
        evidence: [
          {
            kind: "author_note",
            sourceId: null,
            label: "作者说明",
            quote: "这条规则需要进入已确认设定。",
            locator: "",
            confidence: null,
          },
        ],
      })
      .expect(201);

    expect((await other.get(`${base}/custom-fields`).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${base}/custom-fields`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            key: "fate",
            label: "命格",
            fieldType: "text",
            appliesTo: "character",
          })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (await other.get(`${base}/entities/${entity.body.data.id}/proposals`).expect(403)).body.error
        .code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(
            `${base}/entities/${entity.body.data.id}/proposals/${proposal.body.data.id}/decision`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            decision: "accept",
            reason: "越权确认",
            conflictType: "none",
            evidence: [
              {
                kind: "author_note",
                sourceId: null,
                label: "越权",
                quote: "越权",
                locator: "",
                confidence: null,
              },
            ],
          })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (await other.get(`${base}/entities/${entity.body.data.id}/change-requests`).expect(403)).body
        .error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  it("enables and forces RLS on every settings table", async () => {
    const tables = [
      "custom_field_definitions",
      "custom_field_values",
      "setting_proposals",
      "setting_change_requests",
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
        displayName: "设定作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }

  async function createWork(agent: SuperAgentTest, title = "忘川书") {
    const token = await csrf(agent);
    const response = await agent
      .post("/api/v1/works")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        mode: "idea",
        title,
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

  async function createWorldRule(
    agent: SuperAgentTest,
    path: string,
    token: string,
    name: string,
    index: number,
  ): Promise<{ id: string; version: number }> {
    const response = await agent
      .post(path)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "world_rule",
        name,
        aliases: [],
        summary: index === 0 ? "第一版天门规则" : `第${index + 1}版天门规则`,
        description: "",
        tags: [],
        data: { rule: `第${index + 1}版天门规则正文。` },
      });
    if (response.status !== 201) {
      throw new Error(`Failed to create world rule: ${JSON.stringify(response.body)}`);
    }
    return response.body.data as { id: string; version: number };
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
