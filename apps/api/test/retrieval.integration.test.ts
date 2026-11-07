import "reflect-metadata";

import crypto from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  characterDetailResponseSchema,
  characterKnowledgeStateResponseSchema,
  characterRelationshipResponseSchema,
  factionDetailResponseSchema,
  itemResponseSchema,
  mapDetailResponseSchema,
  mapNodeResponseSchema,
  retrievalResultListResponseSchema,
  timelineEventResponseSchema,
  type RetrievalResult,
  uuidV7Schema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import { Pool } from "pg";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

const baseDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const baseRedisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
const databaseUrl = withDatabaseName(
  baseDatabaseUrl,
  `novelbrain_test_112_${crypto.randomBytes(4).toString("hex")}`,
);
const redisUrl = withRedisDatabase(baseRedisUrl, 5 + Math.floor(Math.random() * 10));
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("structured retrieval HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "retrieval-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "retrieval-integration-proxy-secret";
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
    await dropDatabase(databaseUrl);
  });

  it("recalls canonical names, aliases, titles, synonyms and Chinese misspellings", async () => {
    const owner = await createAuthenticatedAgent("retrieval-recall@example.com");
    const { work, token } = await createWork(owner, "忘川检索录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const shen = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: ["小砚", "师尊"],
      summary: "被宗门抛弃的外门杂役。",
    });
    const faction = await createFaction(owner, token, base, "太玄门");
    await createItem(owner, token, base, "玄铁令");
    const map = await createMap(owner, token, base, "北域");
    const node = await createMapNode(owner, token, base, map.map.id, "问剑峰");
    const event = await createTimelineEvent(owner, token, base, {
      name: "问剑大会",
      summary: "北域年轻修士的试剑盛会。",
      storyTimeSortKey: 10,
      event: "沈砚在问剑大会夺魁。",
      validity: chapterValidity(1, null),
    });
    await createChapterWithVersion(owner, token, base, 5, "问剑大会");

    const canonical = await search(owner, token, base, { query: "沈砚", chapterNumber: 5 });
    const canonicalHit = findResult(canonical, shen.character.id);
    expect(canonicalHit).toMatchObject({
      sourceKind: "entity",
      matchKind: "canonical_name",
      matchedField: "name",
      entityType: "character",
      label: "沈砚",
      canonicalName: "沈砚",
    });
    expect(canonicalHit.source.version?.versionNodeId).toBe(shen.latestVersionNodeId);
    expect(canonicalHit.source.version?.objectVersion).toBe(shen.version);
    expect(canonicalHit.validity).toEqual(chapterValidity(1, null));
    expect(canonicalHit.sourceChapter).toBeNull();

    const alias = await search(owner, token, base, { query: "小砚", chapterNumber: 5 });
    expect(findResult(alias, shen.character.id)).toMatchObject({
      matchKind: "alias",
      matchedField: "aliases",
      matchedTerm: "小砚",
    });

    const title = await search(owner, token, base, { query: "问剑大会", chapterNumber: 5 });
    expect(findResult(title, event.event.id)).toMatchObject({
      sourceKind: "timeline_event",
      matchKind: "title",
      matchedField: "title",
      canonicalName: "问剑大会",
    });

    const place = await search(owner, token, base, { query: "问剑峰", chapterNumber: 5 });
    expect(findResult(place, node.id)).toMatchObject({
      sourceKind: "map_node",
      matchKind: "canonical_name",
      matchedField: "name",
      entityType: "map",
    });

    const factionHit = await search(owner, token, base, { query: "太玄门", chapterNumber: 5 });
    expect(findResult(factionHit, faction.faction.id)).toMatchObject({
      sourceKind: "entity",
      matchKind: "canonical_name",
      entityType: "faction",
    });

    const synonym = await search(owner, token, base, {
      query: "师父",
      synonyms: ["师尊"],
      chapterNumber: 5,
    });
    expect(findResult(synonym, shen.character.id)).toMatchObject({
      matchKind: "synonym",
      matchedTerm: "师尊",
    });

    const fuzzy = await search(owner, token, base, { query: "沈研", chapterNumber: 5 });
    expect(findResult(fuzzy, shen.character.id)).toMatchObject({
      matchKind: "fuzzy",
      matchedField: "name",
    });
  });

  it("expands typed entity relationships and filters them by chapter validity", async () => {
    const owner = await createAuthenticatedAgent("retrieval-relationships@example.com");
    const { work, token } = await createWork(owner, "忘川关系录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const shen = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: ["小砚"],
      summary: "被宗门抛弃的外门杂役。",
    });
    const gu = await createCharacter(owner, token, base, {
      name: "顾青",
      aliases: [],
      summary: "奉命监视外门杂役的内门弟子。",
    });
    const item = await createItem(owner, token, base, "忘川书");

    await addRelationship(owner, token, base, shen.character.id, {
      target: ref("character", gu.character.id, work.mainBranch.id, "顾青"),
      relationType: "ally",
      validity: chapterValidity(1, 10),
      sourceChapterId: null,
    });
    await addRelationship(owner, token, base, shen.character.id, {
      target: ref("item", item.item.id, work.mainBranch.id, "忘川书"),
      relationType: "owns",
      validity: chapterValidity(1, null),
      sourceChapterId: null,
    });
    await createChapterWithVersion(owner, token, base, 5, "荒寺夜谈");
    await createChapterWithVersion(owner, token, base, 11, "断念之后");

    const atFive = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 5,
      relationshipDepth: 1,
    });
    const ally = findResult(atFive, gu.character.id);
    expect(ally).toMatchObject({
      sourceKind: "entity",
      matchKind: "relationship",
      matchedField: "relationship",
      entityType: "character",
    });
    expect(ally.relationshipPath).toHaveLength(1);
    expect(ally.relationshipPath[0]).toMatchObject({
      relationType: "ally",
      direction: "outgoing",
      from: { id: shen.character.id, type: "character" },
      to: { id: gu.character.id, type: "character" },
    });
    expect(ally.source.version?.versionNodeId).toBe(gu.latestVersionNodeId);
    expect(findResult(atFive, item.item.id)?.relationshipPath[0]?.relationType).toBe("owns");

    const atEleven = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 11,
      relationshipDepth: 1,
    });
    expect(findResult(atEleven, gu.character.id)).toBeUndefined();
    expect(findResult(atEleven, item.item.id)).toBeDefined();

    const withoutExpansion = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 5,
      expandRelationships: false,
    });
    expect(findResult(withoutExpansion, gu.character.id)).toBeUndefined();
  });

  it("applies work, branch, version, chapter, story-time and POV hard filters", async () => {
    const owner = await createAuthenticatedAgent("retrieval-filters@example.com");
    const { work, token } = await createWork(owner, "忘川时间录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const userId = await userIdFor("retrieval-filters@example.com");
    const shen = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: ["小砚"],
      summary: "被宗门抛弃的外门杂役。",
    });
    const gu = await createCharacter(owner, token, base, {
      name: "顾青",
      aliases: [],
      summary: "后入场的内门弟子。",
    });

    const atShen = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 5,
      versionNodeId: shen.latestVersionNodeId,
    });
    expect(findResult(atShen, shen.character.id)).toBeDefined();
    expect(findResult(atShen, gu.character.id)).toBeUndefined();

    await createTimelineEvent(owner, token, base, {
      name: "问剑大会",
      summary: "过去发生的事件。",
      storyTimeSortKey: 10,
      event: "问剑大会已经结束。",
      validity: chapterValidity(1, null),
    });
    await createTimelineEvent(owner, token, base, {
      name: "天门开启",
      summary: "未来才会发生的事件。",
      storyTimeSortKey: 80,
      event: "天门在第十年开启。",
      validity: chapterValidity(10, null),
    });
    await createChapterWithVersion(owner, token, base, 10, "天门将开");

    const futureFact = await createFact({
      databasePool,
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
      chapterNumber: 10,
      subject: "未来秘宝",
      predicate: "出现于",
      object: "天门",
      validFromChapter: 10,
    });
    const futureAtFive = await search(owner, token, base, {
      query: "未来秘宝",
      chapterNumber: 5,
      sourceKinds: ["fact"],
    });
    expect(findResult(futureAtFive, futureFact.id)).toBeUndefined();

    const knownFact = await createFact({
      databasePool,
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
      chapterNumber: 1,
      subject: "玄铁令",
      predicate: "由",
      object: "沈砚持有",
      validFromChapter: 1,
    });
    const hiddenFact = await createFact({
      databasePool,
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
      chapterNumber: 1,
      subject: "血河令",
      predicate: "由",
      object: "血河宗持有",
      validFromChapter: 1,
    });
    await addKnowledgeState(owner, token, base, shen.character.id, {
      objectiveFactId: knownFact.id,
      state: "knowledge",
      claimedContent: "沈砚知道玄铁令在自己手里。",
      sourceKind: "observed",
      validity: chapterValidity(1, null),
      sourceChapterId: null,
    });
    await addKnowledgeState(owner, token, base, shen.character.id, {
      objectiveFactId: hiddenFact.id,
      state: "belief",
      claimedContent: "沈砚误以为血河令在顾青手里。",
      sourceKind: "inferred",
      validity: chapterValidity(1, null),
      sourceChapterId: null,
    });
    await createChapterWithVersion(owner, token, base, 5, "令符初现");

    const withoutPov = await search(owner, token, base, {
      query: "令",
      chapterNumber: 5,
      sourceKinds: ["fact"],
    });
    expect(findResult(withoutPov, knownFact.id)).toBeDefined();
    expect(findResult(withoutPov, hiddenFact.id)).toBeDefined();

    const withPov = await search(owner, token, base, {
      query: "令",
      chapterNumber: 5,
      sourceKinds: ["fact"],
      povCharacterId: shen.character.id,
    });
    expect(findResult(withPov, knownFact.id)).toBeDefined();
    expect(findResult(withPov, hiddenFact.id)).toBeUndefined();
    expect(findResult(withPov, knownFact.id)).toMatchObject({
      sourceKind: "fact",
      matchedField: "title",
      sourceChapter: { number: 1, title: "第 1 章" },
    });
    expect(findResult(withPov, knownFact.id)?.source.version?.versionNodeId).toBeTruthy();

    const chapterFive = await search(owner, token, base, {
      query: "天门",
      chapterNumber: 5,
      storyTime: { era: "大玄历", label: "第五年夏", sortKey: 20 },
    });
    expect(chapterFive.every((result) => result.canonicalName !== "天门开启")).toBe(true);

    const chapterTen = await search(owner, token, base, {
      query: "天门",
      chapterNumber: 10,
      storyTime: { era: "大玄历", label: "第十年夏", sortKey: 90 },
    });
    expect(chapterTen.some((result) => result.canonicalName === "天门开启")).toBe(true);

    const earlyStoryTime = await search(owner, token, base, {
      query: "问剑大会",
      chapterNumber: 5,
      storyTime: { era: "大玄历", label: "第一年春", sortKey: 5 },
    });
    expect(earlyStoryTime.every((result) => result.canonicalName !== "问剑大会")).toBe(true);
  });

  it("uses the target chapter version when versionNodeId is omitted", async () => {
    const owner = await createAuthenticatedAgent("retrieval-implicit-version@example.com");
    const { work, token } = await createWork(owner, "忘川隐式版本录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const earlyCharacter = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: [],
      summary: "第一章之前已经出场的主角。",
    });

    const firstChapter = await createChapterWithVersion(owner, token, base, 1, "断臂藏锋");
    await createChapterWithVersion(owner, token, base, 2, "内门来客");
    const futureCharacter = await createCharacter(owner, token, base, {
      name: "顾青",
      aliases: [],
      summary: "第二章之后才入场的内门弟子。",
    });
    await createChapterWithVersion(owner, token, base, 3, "顾青入院");

    const chapterOne = await search(owner, token, base, {
      query: "顾青",
      chapterNumber: 1,
    });
    expect(findResult(chapterOne, futureCharacter.character.id)).toBeUndefined();

    const chapterTwo = await search(owner, token, base, {
      query: "顾青",
      chapterNumber: 2,
    });
    expect(findResult(chapterTwo, futureCharacter.character.id)).toBeUndefined();

    const chapterThree = await search(owner, token, base, {
      query: "顾青",
      chapterNumber: 3,
    });
    expect(findResult(chapterThree, futureCharacter.character.id)).toBeDefined();
    expect(
      findResult(chapterThree, futureCharacter.character.id)?.source.version?.versionNodeId,
    ).toBe(futureCharacter.latestVersionNodeId);

    const early = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 1,
    });
    expect(findResult(early, earlyCharacter.character.id)).toBeDefined();
    expect(
      early.find((result) => result.id === earlyCharacter.character.id)?.source.version
        ?.versionNodeId,
    ).toBe(earlyCharacter.latestVersionNodeId);

    const explicitlyAnchored = await search(owner, token, base, {
      query: "顾青",
      chapterNumber: 1,
      versionNodeId: firstChapter.version.versionNodeId,
    });
    expect(findResult(explicitlyAnchored, futureCharacter.character.id)).toBeUndefined();
  });

  it("does not expand relationships introduced after the target chapter", async () => {
    const owner = await createAuthenticatedAgent("retrieval-relationship-version@example.com");
    const { work, token } = await createWork(owner, "忘川关系版本录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const shen = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: [],
      summary: "第一章之前已经出场的主角。",
    });
    const gu = await createCharacter(owner, token, base, {
      name: "顾青",
      aliases: [],
      summary: "第一章之前已经出场的同门。",
    });

    await createChapterWithVersion(owner, token, base, 1, "断臂藏锋");
    await addRelationship(owner, token, base, shen.character.id, {
      target: ref("character", gu.character.id, work.mainBranch.id, "顾青"),
      relationType: "ally",
      validity: chapterValidity(1, null),
      sourceChapterId: null,
    });
    await createChapterWithVersion(owner, token, base, 2, "同门试探");

    const chapterOne = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 1,
      relationshipDepth: 1,
    });
    expect(findResult(chapterOne, gu.character.id)).toBeUndefined();

    const current = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 2,
      relationshipDepth: 1,
    });
    expect(findResult(current, gu.character.id)).toBeDefined();
  });

  it("fails closed when the target chapter does not exist", async () => {
    const owner = await createAuthenticatedAgent("retrieval-missing-chapter@example.com");
    const { work, token } = await createWork(owner, "忘川缺章录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const shen = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: [],
      summary: "第一章之前已经出场的主角。",
    });
    await createChapterWithVersion(owner, token, base, 1, "断臂藏锋");
    const futureCharacter = await createCharacter(owner, token, base, {
      name: "顾青",
      aliases: [],
      summary: "后续章节才入场的人物。",
    });
    await addRelationship(owner, token, base, shen.character.id, {
      target: ref("character", futureCharacter.character.id, work.mainBranch.id, "顾青"),
      relationType: "ally",
      validity: chapterValidity(1, null),
      sourceChapterId: null,
    });

    const direct = await search(owner, token, base, {
      query: "顾青",
      chapterNumber: 2,
    });
    expect(direct).toEqual([]);

    const expanded = await search(owner, token, base, {
      query: "沈砚",
      chapterNumber: 2,
      relationshipDepth: 1,
    });
    expect(expanded).toEqual([]);
  });

  it("fails closed when the target chapter has no current version", async () => {
    const owner = await createAuthenticatedAgent("retrieval-unversioned-chapter@example.com");
    const { work, token } = await createWork(owner, "忘川空版本录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const shen = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: [],
      summary: "第一章之前已经出场的主角。",
    });
    const plannedChapter = await createPlannedChapter(owner, token, base, 2, "尚未落笔");
    const futureCharacter = await createCharacter(owner, token, base, {
      name: "顾青",
      aliases: [],
      summary: "第二章之后才入场的人物。",
    });
    await addRelationship(owner, token, base, shen.character.id, {
      target: ref("character", futureCharacter.character.id, work.mainBranch.id, "顾青"),
      relationType: "ally",
      validity: chapterValidity(1, null),
      sourceChapterId: null,
    });

    expect(plannedChapter.currentVersionId).toBeNull();
    expect(
      await search(owner, token, base, {
        query: "顾青",
        chapterNumber: 2,
      }),
    ).toEqual([]);
    expect(
      await search(owner, token, base, {
        query: "沈砚",
        chapterNumber: 2,
        relationshipDepth: 1,
      }),
    ).toEqual([]);
  });

  it("disambiguates same-name Chinese entities", async () => {
    const owner = await createAuthenticatedAgent("retrieval-homonyms@example.com");
    const { work, token } = await createWork(owner, "忘川同名录");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const userId = await userIdFor("retrieval-homonyms@example.com");
    const primary = await createCharacter(owner, token, base, {
      name: "沈砚",
      aliases: [],
      summary: "外门杂役。",
    });
    const duplicateId = await insertDuplicateCharacter({
      databasePool,
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
      name: "沈砚",
      summary: "另一条分支导入的同名人物。",
    });
    await createChapterWithVersion(owner, token, base, 5, "同名之争");

    const results = await search(owner, token, base, { query: "沈砚", chapterNumber: 5 });
    const sameName = results.filter((result) => result.canonicalName === "沈砚");
    expect(sameName.map((result) => result.id).sort()).toEqual(
      [primary.character.id, duplicateId].sort(),
    );
    for (const result of sameName) {
      expect(result.disambiguation.sameNameCount).toBe(2);
      expect(result.disambiguation.key).toBe("entity:沈砚");
    }
  });

  it("isolates tenants and branches", async () => {
    const owner = await createAuthenticatedAgent("retrieval-tenant-a@example.com");
    const intruder = await createAuthenticatedAgent("retrieval-tenant-b@example.com");
    const first = await createWork(owner, "忘川甲录");
    const second = await createWork(owner, "忘川乙录");
    const token = await csrf(owner);
    const userId = await userIdFor("retrieval-tenant-a@example.com");
    const firstBase = `/api/v1/works/${first.work.id}/branches/${first.work.mainBranch.id}`;
    const secondBase = `/api/v1/works/${second.work.id}/branches/${second.work.mainBranch.id}`;
    const firstCharacter = await createCharacter(owner, token, firstBase, {
      name: "沈砚",
      aliases: [],
      summary: "甲作品的人物。",
    });
    const secondCharacter = await createCharacter(owner, token, secondBase, {
      name: "沈砚",
      aliases: [],
      summary: "乙作品的人物。",
    });
    const siblingBranch = await insertBranchWithCharacter({
      databasePool,
      userId,
      workId: first.work.id,
      name: "苏照",
      summary: "甲作品的平行版本人物。",
    });
    const siblingBase = `/api/v1/works/${first.work.id}/branches/${siblingBranch.branchId}`;
    await createChapterWithVersion(owner, token, firstBase, 5, "甲录第五章");
    await createChapterWithVersion(owner, token, secondBase, 5, "乙录第五章");
    await createChapterWithVersion(owner, token, siblingBase, 5, "平行第五章");

    const inFirst = await search(owner, token, firstBase, {
      query: "沈砚",
      chapterNumber: 5,
    });
    expect(findResult(inFirst, firstCharacter.character.id)).toBeDefined();
    expect(findResult(inFirst, secondCharacter.character.id)).toBeUndefined();
    expect(findResult(inFirst, siblingBranch.characterId)).toBeUndefined();

    const inSecond = await search(owner, token, secondBase, {
      query: "沈砚",
      chapterNumber: 5,
    });
    expect(findResult(inSecond, secondCharacter.character.id)).toBeDefined();
    expect(findResult(inSecond, firstCharacter.character.id)).toBeUndefined();

    const inSibling = await search(owner, token, siblingBase, {
      query: "苏照",
      chapterNumber: 5,
    });
    expect(findResult(inSibling, siblingBranch.characterId)).toBeDefined();
    expect(findResult(inSibling, firstCharacter.character.id)).toBeUndefined();

    await searchExpectStatus(
      intruder,
      await csrf(intruder),
      firstBase,
      {
        query: "沈砚",
        chapterNumber: 5,
      },
      403,
    );
  });

  it("uses the shared index for a representative large work and measures latency", async () => {
    const owner = await createAuthenticatedAgent("retrieval-large@example.com");
    const { work, token } = await createWork(owner, "忘川大作品");
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const userId = await userIdFor("retrieval-large@example.com");
    await seedSearchDocuments({
      databasePool,
      userId,
      workId: work.id,
      branchId: work.mainBranch.id,
      versionNodeId: work.mainBranch.headNodeId,
      count: 10_000,
    });
    await createChapterWithVersion(owner, token, base, 5, "大作品第五章");

    const indexes = await databasePool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'search_documents'",
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    expect(indexNames).toEqual(
      expect.arrayContaining(["search_documents_trgm_idx", "search_documents_tsv_idx"]),
    );
    const documentIds = await databasePool.query<{ id: string }>("SELECT id FROM search_documents");
    expect(documentIds.rows.length).toBeGreaterThanOrEqual(10_000);
    expect(documentIds.rows.every((row) => uuidV7Schema.safeParse(row.id).success)).toBe(true);

    const planClient = await databasePool.connect();
    try {
      await planClient.query("SET enable_seqscan = off");
      const planResult = await planClient.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT document.id
         FROM search_documents AS document
         WHERE document.user_id = $1
           AND document.work_id = $2
           AND document.branch_id = $3
           AND document.from_chapter <= 5
           AND (document.to_chapter IS NULL OR document.to_chapter >= 5)
           AND (
             lower(document.title) LIKE '%' || lower($4) || '%'
             OR lower(document.aliases::text) LIKE '%' || lower($4) || '%'
             OR lower(document.content) LIKE '%' || lower($4) || '%'
             OR similarity(document.title, $4) >= 0.2
             OR word_similarity($4, document.title) >= 0.33
           )`,
        [userId, work.id, work.mainBranch.id, "测试人物9999"],
      );
      const plan = JSON.stringify(planResult.rows[0]?.["QUERY PLAN"]);
      console.log(`retrieval query plan=${plan}`);
      expect(plan).toContain("search_documents_user_work_branch_idx");

      const textPlanResult = await planClient.query<{ "QUERY PLAN": unknown }>(
        `EXPLAIN (FORMAT JSON)
         SELECT document.id
         FROM search_documents AS document
         WHERE lower(
           document.title || ' ' || coalesce(document.content, '') || ' ' ||
           document.aliases::text
         ) LIKE '%' || lower($1) || '%'`,
        ["测试人物9999"],
      );
      const textPlan = JSON.stringify(textPlanResult.rows[0]?.["QUERY PLAN"]);
      console.log(`retrieval text plan=${textPlan}`);
      expect(textPlan).toContain("search_documents_trgm_idx");
    } finally {
      planClient.release();
    }

    const samples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const startedAt = performance.now();
      const results = await search(owner, token, base, {
        query: `测试人物${2_900 + index}`,
        chapterNumber: 5,
        limit: 10,
      });
      samples.push(performance.now() - startedAt);
      expect(results.some((result) => result.canonicalName === `测试人物${2_900 + index}`)).toBe(
        true,
      );
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
    console.log(`retrieval large-work latency p95=${p95.toFixed(1)}ms`);
    expect(p95).toBeLessThan(1_500);

    const rls = await databasePool.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'search_documents'",
    );
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
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
        displayName: "检索测试作者",
      })
      .expect(200);
    return agent;
  }

  async function createWork(agent: SuperAgentTest, title: string) {
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
    return {
      token,
      work: response.body.data as {
        id: string;
        mainBranch: { id: string; headNodeId: string };
      },
    };
  }

  async function createChapterWithVersion(
    agent: SuperAgentTest,
    token: string,
    base: string,
    number: number,
    title: string,
  ) {
    const created = await createPlannedChapter(agent, token, base, number, title);
    const saved = await postJson(agent, token, `${base}/chapters/${created.id}/versions`, {
      version: created.version,
      content: `第 ${number} 章正文。`,
    });
    if (saved.status !== 201) {
      throw new Error(`${saved.status}: ${JSON.stringify(saved.body)}`);
    }
    return saved.body.data as {
      chapter: { id: string; number: number; version: number };
      version: { id: string; versionNodeId: string };
    };
  }

  async function createPlannedChapter(
    agent: SuperAgentTest,
    token: string,
    base: string,
    number: number,
    title: string,
  ) {
    const created = await postJson(agent, token, `${base}/chapters`, {
      number,
      title,
      brief: retrievalChapterBrief(),
    });
    if (created.status !== 201) {
      throw new Error(`${created.status}: ${JSON.stringify(created.body)}`);
    }
    return created.body.data as {
      id: string;
      number: number;
      version: number;
      currentVersionId: string | null;
    };
  }

  async function createCharacter(
    agent: SuperAgentTest,
    token: string,
    base: string,
    input: { name: string; aliases: string[]; summary: string },
  ) {
    const response = await postJson(agent, token, `${base}/characters`, {
      name: input.name,
      aliases: input.aliases,
      summary: input.summary,
      description: "",
      tags: [],
      profile: {
        desire: "找回记忆",
        fear: "成为祭品",
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
      details: `${name}的地形与势力分布。`,
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
      summary: `${name}的地标说明。`,
      x: null,
      y: null,
      validity: chapterValidity(1, null),
    });
    return mapNodeResponseSchema.parse(response.body).data;
  }

  async function createItem(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await postJson(agent, token, `${base}/world/items`, {
      name,
      aliases: [],
      summary: `${name}的说明。`,
      description: "",
      tags: [],
      kind: "item",
      category: "法器",
      grade: "地阶",
      effect: "测试效果。",
      cost: "",
      limits: "",
      ownershipModel: "unique",
      consumable: false,
      quantity: 1,
      equipmentSlot: null,
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return itemResponseSchema.parse(response.body).data;
  }

  async function createTimelineEvent(
    agent: SuperAgentTest,
    token: string,
    base: string,
    input: {
      name: string;
      summary: string;
      storyTimeSortKey: number;
      event: string;
      validity: ReturnType<typeof chapterValidity>;
    },
  ) {
    await ensureTimelineEra(agent, token, base);
    const response = await postJson(agent, token, `${base}/world/timeline/events`, {
      name: input.name,
      aliases: [],
      summary: input.summary,
      description: "",
      tags: [],
      era: "大玄历",
      storyTime: {
        era: "大玄历",
        label: `第 ${input.storyTimeSortKey} 时序`,
        sortKey: input.storyTimeSortKey,
      },
      durationMinutes: 0,
      durationLabel: "",
      event: input.event,
      validity: input.validity,
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return timelineEventResponseSchema.parse(response.body).data;
  }

  async function ensureTimelineEra(agent: SuperAgentTest, token: string, base: string) {
    if (timelineEras.has(base)) {
      return;
    }
    const response = await postJson(agent, token, `${base}/world/timeline/eras`, {
      name: "大玄历",
      orderIndex: 0,
      startSortKey: 0,
      endSortKey: null,
      description: "检索测试使用的故事纪元。",
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    timelineEras.add(base);
  }

  async function addRelationship(
    agent: SuperAgentTest,
    token: string,
    base: string,
    characterId: string,
    body: Record<string, unknown>,
  ) {
    const response = await postJson(
      agent,
      token,
      `${base}/characters/${characterId}/relationships`,
      body,
    );
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return characterRelationshipResponseSchema.parse(response.body).data;
  }

  async function addKnowledgeState(
    agent: SuperAgentTest,
    token: string,
    base: string,
    characterId: string,
    body: Record<string, unknown>,
  ) {
    const response = await postJson(
      agent,
      token,
      `${base}/characters/${characterId}/knowledge-states`,
      body,
    );
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return characterKnowledgeStateResponseSchema.parse(response.body).data;
  }

  async function search(
    agent: SuperAgentTest,
    token: string,
    base: string,
    body: Record<string, unknown>,
  ): Promise<RetrievalResult[]> {
    const response = await postJson(agent, token, `${base}/retrieval/search`, body);
    if (response.status !== 200) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return retrievalResultListResponseSchema.parse(response.body).data;
  }

  async function searchExpectStatus(
    agent: SuperAgentTest,
    token: string,
    base: string,
    body: Record<string, unknown>,
    status: number,
  ) {
    const response = await postJson(agent, token, `${base}/retrieval/search`, body);
    expect(response.status).toBe(status);
  }

  async function postJson(agent: SuperAgentTest, token: string, path: string, body: unknown) {
    return agent.post(path).set("Origin", origin).set("X-CSRF-Token", token).send(body);
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
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

function findResult(results: RetrievalResult[], id: string): RetrievalResult | undefined {
  return results.find((result) => result.id === id);
}

function chapterValidity(fromChapter: number, toChapter: number | null) {
  return {
    fromChapter,
    toChapter,
    fromStoryTime: null,
    toStoryTime: null,
  };
}

function retrievalChapterBrief() {
  return {
    goal: "让沈砚在断臂后找到新的战斗方式。",
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

function ref(
  type: "character" | "item" | "map" | "faction" | "map_node" | "timeline_event",
  id: string,
  branchId: string,
  label: string,
) {
  return { type, id, branchId, label, version: null };
}

interface FactFixtureInput {
  databasePool: ReturnType<typeof createDatabasePool>;
  userId: string;
  workId: string;
  branchId: string;
  chapterNumber: number;
  subject: string;
  predicate: string;
  object: string;
  validFromChapter: number;
  validToChapter?: number | null;
}

const factChapters = new Map<
  string,
  { chapterId: string; chapterVersionId: string; commitId: string; versionNodeId: string }
>();
const timelineEras = new Set<string>();

async function createFact(input: FactFixtureInput): Promise<{ id: string }> {
  const chapter = await ensureFactChapter(input);
  const proposalId = uuidv7();
  const decisionId = uuidv7();
  const factId = uuidv7();
  const now = new Date();
  await input.databasePool.query(
    `INSERT INTO fact_proposals
      (id, work_id, branch_id, user_id, chapter_id, source_version_id, extraction_key,
       subject, predicate, object, source_sentence, status, confidence, risk, required,
       created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       'confirmed', 1, 'low', false, $12, $12)`,
    [
      proposalId,
      input.workId,
      input.branchId,
      input.userId,
      chapter.chapterId,
      chapter.chapterVersionId,
      `retrieval-fixture:${factId}`,
      input.subject,
      input.predicate,
      input.object,
      `${input.subject}${input.predicate}${input.object}。`,
      now,
    ],
  );
  await input.databasePool.query(
    `INSERT INTO fact_decisions
      (id, work_id, branch_id, user_id, chapter_id, fact_proposal_id, action, actor_id,
       actor_name, reason, original_payload, resulting_payload, decided_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirm', $4, '检索测试作者', 'fixture',
       '{}'::jsonb, '{}'::jsonb, $7)`,
    [decisionId, input.workId, input.branchId, input.userId, chapter.chapterId, proposalId, now],
  );
  await input.databasePool.query(
    `INSERT INTO facts
      (id, work_id, branch_id, user_id, chapter_id, fact_proposal_id, decision_id,
       source_version_id, canon_commit_id, subject, predicate, object, risk, required,
       status, valid_from_chapter, valid_to_chapter, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'low', false,
       'active', $13, $14, $15)`,
    [
      factId,
      input.workId,
      input.branchId,
      input.userId,
      chapter.chapterId,
      proposalId,
      decisionId,
      chapter.chapterVersionId,
      chapter.commitId,
      input.subject,
      input.predicate,
      input.object,
      input.validFromChapter,
      input.validToChapter ?? null,
      now,
    ],
  );
  return { id: factId };
}

async function ensureFactChapter(input: FactFixtureInput) {
  const key = `${input.branchId}:${input.chapterNumber}`;
  const cached = factChapters.get(key);
  if (cached) {
    return cached;
  }
  const existing = await input.databasePool.query<{
    chapter_id: string;
    chapter_version_id: string;
  }>(
    `SELECT chapter.id AS chapter_id, chapter.current_version_id AS chapter_version_id
     FROM chapters AS chapter
     INNER JOIN chapter_versions AS version ON version.id = chapter.current_version_id
     WHERE chapter.work_id = $1
       AND chapter.branch_id = $2
       AND chapter.user_id = $3
       AND chapter.number = $4`,
    [input.workId, input.branchId, input.userId, input.chapterNumber],
  );
  const existingChapter = existing.rows[0];
  const head = await input.databasePool.query<{ head_node_id: string | null }>(
    "SELECT head_node_id FROM work_branches WHERE id = $1",
    [input.branchId],
  );
  const chapterId = existingChapter?.chapter_id ?? uuidv7();
  const chapterVersionId = existingChapter?.chapter_version_id ?? uuidv7();
  const commitId = uuidv7();
  const versionNodeId = uuidv7();
  const now = new Date();
  await input.databasePool.query(
    `INSERT INTO version_nodes
      (id, work_id, branch_id, user_id, parent_node_id, node_type, object_type, object_id,
       object_version, payload, actor_id, message, created_at)
     VALUES ($1, $2, $3, $4, $5, 'canon_commit', 'chapter', $6, 1, '{}'::jsonb, $4, $7, $8)`,
    [
      versionNodeId,
      input.workId,
      input.branchId,
      input.userId,
      head.rows[0]?.head_node_id ?? null,
      chapterId,
      `检索测试第 ${input.chapterNumber} 章`,
      now,
    ],
  );
  if (!existingChapter) {
    await input.databasePool.query(
      `INSERT INTO chapters
        (id, work_id, branch_id, user_id, number, title, status, version, current_version_id,
         word_count, brief, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'locked', 1, NULL, 0, '{}'::jsonb, $7, $7)`,
      [
        chapterId,
        input.workId,
        input.branchId,
        input.userId,
        input.chapterNumber,
        `第 ${input.chapterNumber} 章`,
        now,
      ],
    );
    await input.databasePool.query(
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
        `${input.subject}${input.predicate}${input.object}。`,
        `retrieval-fixture-${chapterVersionId}`,
        versionNodeId,
        now,
      ],
    );
    await input.databasePool.query("UPDATE chapters SET current_version_id = $1 WHERE id = $2", [
      chapterVersionId,
      chapterId,
    ]);
  }
  await input.databasePool.query(
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
      `retrieval-commit-${commitId}`,
      now,
    ],
  );
  await input.databasePool.query(
    "UPDATE work_branches SET head_node_id = $1, updated_at = $2 WHERE id = $3",
    [versionNodeId, now, input.branchId],
  );
  const value = { chapterId, chapterVersionId, commitId, versionNodeId };
  factChapters.set(key, value);
  return value;
}

async function insertDuplicateCharacter(input: {
  databasePool: ReturnType<typeof createDatabasePool>;
  userId: string;
  workId: string;
  branchId: string;
  name: string;
  summary: string;
}): Promise<string> {
  const head = await input.databasePool.query<{ head_node_id: string | null }>(
    "SELECT head_node_id FROM work_branches WHERE id = $1",
    [input.branchId],
  );
  const entityId = uuidv7();
  const versionNodeId = uuidv7();
  const now = new Date();
  await input.databasePool.query(
    `INSERT INTO version_nodes
      (id, work_id, branch_id, user_id, parent_node_id, node_type, object_type, object_id,
       object_version, payload, actor_id, message, created_at)
     VALUES ($1, $2, $3, $4, $5, 'entity_version', 'character', $6, 1, '{}'::jsonb, $4, $7, $8)`,
    [
      versionNodeId,
      input.workId,
      input.branchId,
      input.userId,
      head.rows[0]?.head_node_id ?? null,
      entityId,
      "导入同名人物",
      now,
    ],
  );
  await input.databasePool.query(
    `INSERT INTO entities
      (id, work_id, branch_id, user_id, type, name, aliases, summary, description, attributes,
       tags, status, source, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'character', $5, '[]'::jsonb, $6, '', '{}'::jsonb,
       '[]'::jsonb, 'draft', 'import', 1, $7, $7)`,
    [entityId, input.workId, input.branchId, input.userId, input.name, input.summary, now],
  );
  await input.databasePool.query(
    `INSERT INTO entity_versions
      (id, entity_id, work_id, branch_id, user_id, version, snapshot, version_node_id,
       created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $5, $8)`,
    [
      uuidv7(),
      entityId,
      input.workId,
      input.branchId,
      input.userId,
      JSON.stringify({ summary: input.summary }),
      versionNodeId,
      now,
    ],
  );
  await input.databasePool.query(
    "UPDATE work_branches SET head_node_id = $1, updated_at = $2 WHERE id = $3",
    [versionNodeId, now, input.branchId],
  );
  return entityId;
}

async function insertBranchWithCharacter(input: {
  databasePool: ReturnType<typeof createDatabasePool>;
  userId: string;
  workId: string;
  name: string;
  summary: string;
}): Promise<{ branchId: string; characterId: string }> {
  const branchId = uuidv7();
  const rootNodeId = uuidv7();
  const now = new Date();
  await input.databasePool.query(
    `INSERT INTO work_branches
      (id, work_id, user_id, name, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
    [branchId, input.workId, input.userId, "what-if", now],
  );
  await input.databasePool.query(
    `INSERT INTO version_nodes
      (id, work_id, branch_id, user_id, node_type, object_type, object_id, object_version,
       snapshot_id, payload, actor_id, message, created_at)
     VALUES ($1, $2, $3, $4, 'snapshot', 'work', $2, 1, $1, '{}'::jsonb, $4, $5, $6)`,
    [rootNodeId, input.workId, branchId, input.userId, "创建平行版本", now],
  );
  await input.databasePool.query(
    "UPDATE work_branches SET head_node_id = $1, updated_at = $2 WHERE id = $3",
    [rootNodeId, now, branchId],
  );
  const characterId = await insertDuplicateCharacter({
    databasePool: input.databasePool,
    userId: input.userId,
    workId: input.workId,
    branchId,
    name: input.name,
    summary: input.summary,
  });
  return { branchId, characterId };
}

async function seedSearchDocuments(input: {
  databasePool: ReturnType<typeof createDatabasePool>;
  userId: string;
  workId: string;
  branchId: string;
  versionNodeId: string;
  count: number;
}): Promise<void> {
  const ids = Array.from({ length: input.count }, () => uuidv7());
  const titles = Array.from({ length: input.count }, (_, index) => `测试人物${index + 1}`);
  await input.databasePool.query(
    `INSERT INTO search_documents
      (id, work_id, branch_id, user_id, source_type, source_id, entity_type, title, content,
       aliases, version_node_id, object_version, source_chapter_id, from_chapter, to_chapter,
       metadata, created_at, updated_at)
     SELECT document_id, $1, $2, $3, 'entity', document_id, 'character',
       document_title, '大型作品中的江湖人物。',
       '[]'::jsonb, $4, 1, NULL, 1, NULL, '{}'::jsonb, now(), now()
     FROM unnest($5::uuid[], $6::text[]) AS document(document_id, document_title)`,
    [input.workId, input.branchId, input.userId, input.versionNodeId, ids, titles],
  );
}

function withDatabaseName(databaseUrl: string, databaseName: string): string {
  const target = new URL(databaseUrl);
  target.pathname = `/${databaseName}`;
  return target.toString();
}

function withRedisDatabase(redisUrl: string, database: number): string {
  const target = new URL(redisUrl);
  target.pathname = `/${database}`;
  return target.toString();
}

async function ensureDatabaseExists(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const adminPool = createAdminPool(adminUrl.toString());
  try {
    await adminPool.query(`CREATE DATABASE "${quoteIdentifier(databaseName)}"`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}

async function dropDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    return;
  }
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/postgres";
  const adminPool = createAdminPool(adminUrl.toString());
  try {
    await adminPool.query(
      `DROP DATABASE IF EXISTS "${quoteIdentifier(databaseName)}" WITH (FORCE)`,
    );
  } finally {
    await adminPool.end();
  }
}

function quoteIdentifier(value: string): string {
  return value.replaceAll('"', '""');
}

function createAdminPool(databaseUrl: string): Pool {
  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 2,
  });
}

function isDuplicateDatabase(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P04";
}
