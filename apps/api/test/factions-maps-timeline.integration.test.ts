import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  characterDetailResponseSchema,
  factionDetailResponseSchema,
  mapDetailResponseSchema,
  mapEdgeResponseSchema,
  mapLayerResponseSchema,
  mapMarkerResponseSchema,
  mapNodeResponseSchema,
  mapRouteResponseSchema,
  settingChangeRequestResponseSchema,
  timelineEraResponseSchema,
  timelineEventResponseSchema,
  worldSnapshotResponseSchema,
  worldTimelineResponseSchema,
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

describe("factions, maps and story timeline HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "world-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "world-integration-proxy-secret";
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

  it("builds a cross-layer map route, detects hierarchy errors and replays a version point", async () => {
    const owner = await createAuthenticatedAgent("world-map@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const map = await createMap(owner, token, base, "北域");
    const validity = {
      fromChapter: 1,
      toChapter: null as number | null,
      fromStoryTime: null,
      toStoryTime: null,
    };

    const outer = await postJson(owner, token, `${base}/world/maps/${map.map.id}/layers`, {
      name: "外域",
      parentLayerId: null,
      sortOrder: 0,
      minScale: 0,
      maxScale: 50,
      validity,
    });
    const outerLayer = mapLayerResponseSchema.parse(outer.body).data;
    const inner = await postJson(owner, token, `${base}/world/maps/${map.map.id}/layers`, {
      name: "内门",
      parentLayerId: outerLayer.id,
      sortOrder: 1,
      minScale: 50,
      maxScale: 100,
      validity,
    });
    const innerLayer = mapLayerResponseSchema.parse(inner.body).data;

    const village = await createNode(owner, token, base, map.map.id, {
      layerId: outerLayer.id,
      parentNodeId: null,
      name: "忘川村",
      nodeType: "settlement",
      summary: "太玄山脚的小村。",
      x: 0.1,
      y: 0.8,
      validity,
    });
    const pass = await createNode(owner, token, base, map.map.id, {
      layerId: outerLayer.id,
      parentNodeId: village.id,
      name: "断魂峡",
      nodeType: "passage",
      summary: "进出北域的唯一官道。",
      x: 0.3,
      y: 0.6,
      validity,
    });
    const gate = await createNode(owner, token, base, map.map.id, {
      layerId: outerLayer.id,
      parentNodeId: village.id,
      name: "太玄山门",
      nodeType: "landmark",
      summary: "山门与护山大阵所在。",
      x: 0.5,
      y: 0.4,
      validity,
    });
    const sect = await createNode(owner, token, base, map.map.id, {
      layerId: innerLayer.id,
      parentNodeId: gate.id,
      name: "问剑峰",
      nodeType: "sect",
      summary: "内门主峰。",
      x: 0.7,
      y: 0.2,
      validity,
    });

    await createEdge(owner, token, base, map.map.id, {
      layerId: outerLayer.id,
      fromNodeId: village.id,
      toNodeId: pass.id,
      routeType: "road",
      bidirectional: true,
      travelMinutes: 30,
      validity,
    });
    await createEdge(owner, token, base, map.map.id, {
      layerId: outerLayer.id,
      fromNodeId: pass.id,
      toNodeId: gate.id,
      routeType: "trail",
      bidirectional: true,
      travelMinutes: 45,
      validity,
    });
    await createEdge(owner, token, base, map.map.id, {
      layerId: innerLayer.id,
      fromNodeId: gate.id,
      toNodeId: sect.id,
      routeType: "secret",
      bidirectional: true,
      travelMinutes: 60,
      validity,
    });

    const route = mapRouteResponseSchema.parse(
      (
        await owner
          .get(
            `${base}/world/maps/${map.map.id}/routes?fromNodeId=${village.id}&toNodeId=${sect.id}`,
          )
          .expect(200)
      ).body,
    ).data;
    expect(route).toMatchObject({
      pathNodeIds: [village.id, pass.id, gate.id, sect.id],
      travelMinutes: 135,
    });
    const outsider = await createAuthenticatedAgent("world-map-other@example.com");
    expect(
      (
        await outsider
          .get(
            `${base}/world/maps/${map.map.id}/routes?fromNodeId=${village.id}&toNodeId=${sect.id}`,
          )
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const marker = await postJson(owner, token, `${base}/world/maps/${map.map.id}/markers`, {
      layerId: outerLayer.id,
      nodeId: gate.id,
      label: "护山大阵",
      markerType: "danger",
      x: 0.5,
      y: 0.4,
      validity,
    });
    mapMarkerResponseSchema.parse(marker.body);
    const before = mapDetailResponseSchema.parse(
      (await owner.get(`${base}/world/maps/${map.map.id}`).expect(200)).body,
    ).data;

    const secondMap = await createMap(owner, token, base, "南疆");
    const secondRoot = await createNode(owner, token, base, secondMap.map.id, {
      layerId: null,
      parentNodeId: null,
      name: "南疆边境",
      nodeType: "region",
      summary: "另一张地图。",
      x: null,
      y: null,
      validity,
    });
    const mismatch = await owner
      .post(`${base}/world/maps/${map.map.id}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        layerId: null,
        parentNodeId: secondRoot.id,
        name: "错误归属节点",
        nodeType: "other",
        summary: "父节点不属于当前地图。",
        x: null,
        y: null,
        validity,
      })
      .expect(409);
    expect(mismatch.body.error.code).toBe("MAP_NODE_PARENT_MISMATCH");

    await createNode(owner, token, base, map.map.id, {
      layerId: innerLayer.id,
      parentNodeId: sect.id,
      name: "后山禁地",
      nodeType: "dungeon",
      summary: "版本查询后新增的节点。",
      x: 0.9,
      y: 0.1,
      validity,
    });

    const historical = worldSnapshotResponseSchema.parse(
      (
        await owner
          .get(`${base}/world/snapshot?versionNodeId=${before.latestVersionNodeId}`)
          .expect(200)
      ).body,
    ).data;
    const historicalMap = historical.maps.find((entry) => entry.map.id === map.map.id);
    expect(historicalMap?.nodes.map((node) => node.name)).not.toContain("后山禁地");

    const current = worldSnapshotResponseSchema.parse(
      (await owner.get(`${base}/world/snapshot`).expect(200)).body,
    ).data;
    expect(
      current.maps.find((entry) => entry.map.id === map.map.id)?.nodes.map((node) => node.name),
    ).toContain("后山禁地");
  });

  it("detects control-area and itinerary conflicts with source evidence", async () => {
    const owner = await createAuthenticatedAgent("world-conflicts@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const map = await createMap(owner, token, base, "北域");
    const validity = {
      fromChapter: 1,
      toChapter: null as number | null,
      fromStoryTime: null,
      toStoryTime: null,
    };
    const village = await createNode(owner, token, base, map.map.id, {
      layerId: null,
      parentNodeId: null,
      name: "忘川村",
      nodeType: "settlement",
      summary: "",
      x: 0.1,
      y: 0.8,
      validity,
    });
    const sect = await createNode(owner, token, base, map.map.id, {
      layerId: null,
      parentNodeId: null,
      name: "太玄门",
      nodeType: "sect",
      summary: "",
      x: 0.5,
      y: 0.4,
      validity,
    });
    await createEdge(owner, token, base, map.map.id, {
      layerId: null,
      fromNodeId: village.id,
      toNodeId: sect.id,
      routeType: "road",
      bidirectional: true,
      travelMinutes: 180,
      validity,
    });

    const taiXuan = await createFaction(owner, token, base, "太玄门");
    const bloodRiver = await createFaction(owner, token, base, "血河宗");
    await postJson(owner, token, `${base}/world/factions/${taiXuan.faction.id}/relationships`, {
      target: {
        type: "faction",
        id: bloodRiver.faction.id,
        branchId: work.mainBranch.id,
        label: "血河宗",
      },
      relationType: "enemy",
      validity,
      sourceChapterId: null,
    });
    await postJson(owner, token, `${base}/world/factions/${taiXuan.faction.id}/territories`, {
      node: {
        type: "map_node",
        id: village.id,
        branchId: work.mainBranch.id,
        label: "忘川村",
      },
      controlLevel: "direct",
      validity: {
        ...validity,
        toChapter: 9,
      },
      evidence: [
        {
          kind: "chapter",
          sourceId: null,
          label: "第 1 章",
          quote: "村口插着太玄门的青旗。",
          locator: "第 1 章 · 第 2 段",
          confidence: 0.94,
        },
      ],
    });
    const overlap = await owner
      .post(`${base}/world/factions/${bloodRiver.faction.id}/territories`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        node: {
          type: "map_node",
          id: village.id,
          branchId: work.mainBranch.id,
          label: "忘川村",
        },
        controlLevel: "military",
        validity: {
          ...validity,
          fromChapter: 5,
        },
        evidence: [
          {
            kind: "chapter",
            sourceId: null,
            label: "第 5 章",
            quote: "血河宗旗插上了村口。",
            locator: "第 5 章 · 第 6 段",
            confidence: 0.9,
          },
        ],
      })
      .expect(409);
    expect(overlap.body.error.code).toBe("CONTROL_AREA_OVERLAP");

    const character = await createCharacter(owner, token, base, "沈砚");
    const insufficient = await owner
      .post(`${base}/world/timeline/itineraries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        character: {
          type: "character",
          id: character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        fromNode: {
          type: "map_node",
          id: village.id,
          branchId: work.mainBranch.id,
          label: "忘川村",
        },
        toNode: {
          type: "map_node",
          id: sect.id,
          branchId: work.mainBranch.id,
          label: "太玄门",
        },
        departure: { era: "大玄历", label: "第一日辰时", sortKey: 1000 },
        arrival: { era: "大玄历", label: "第一日午时", sortKey: 1120 },
        travelMinutes: 120,
        validity,
        sourceChapterId: null,
        evidence: [],
      })
      .expect(409);
    expect(insufficient.body.error.code).toBe("MAP_ROUTE_TRAVEL_TIME_CONFLICT");

    const itinerary = await postJson(owner, token, `${base}/world/timeline/itineraries`, {
      character: {
        type: "character",
        id: character.id,
        branchId: work.mainBranch.id,
        label: "沈砚",
      },
      fromNode: {
        type: "map_node",
        id: village.id,
        branchId: work.mainBranch.id,
        label: "忘川村",
      },
      toNode: {
        type: "map_node",
        id: sect.id,
        branchId: work.mainBranch.id,
        label: "太玄门",
      },
      departure: { era: "大玄历", label: "第一日辰时", sortKey: 1000 },
      arrival: { era: "大玄历", label: "第一日酉时", sortKey: 1180 },
      travelMinutes: 180,
      validity,
      sourceChapterId: null,
      evidence: [
        {
          kind: "chapter",
          sourceId: null,
          label: "第 2 章",
          quote: "沈砚走了整整一日才到山门。",
          locator: "第 2 章 · 第 1 段",
          confidence: 0.8,
        },
      ],
    });
    expect(itinerary.body.data.routeTravelMinutes).toBe(180);

    const itineraryOverlap = await owner
      .post(`${base}/world/timeline/itineraries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        character: {
          type: "character",
          id: character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        fromNode: {
          type: "map_node",
          id: sect.id,
          branchId: work.mainBranch.id,
          label: "太玄门",
        },
        toNode: {
          type: "map_node",
          id: village.id,
          branchId: work.mainBranch.id,
          label: "忘川村",
        },
        departure: { era: "大玄历", label: "第一日申时", sortKey: 1100 },
        arrival: { era: "大玄历", label: "第二日寅时", sortKey: 1400 },
        travelMinutes: 300,
        validity,
        sourceChapterId: null,
        evidence: [],
      })
      .expect(409);
    expect(itineraryOverlap.body.error.code).toBe("ITINERARY_OVERLAP");

    const expiredMap = await createMap(owner, token, base, "旧路");
    const oldStart = await createNode(owner, token, base, expiredMap.map.id, {
      layerId: null,
      parentNodeId: null,
      name: "旧渡口",
      nodeType: "passage",
      summary: "",
      x: null,
      y: null,
      validity: { ...validity, toChapter: 3 },
    });
    const oldEnd = await createNode(owner, token, base, expiredMap.map.id, {
      layerId: null,
      parentNodeId: null,
      name: "旧驿道",
      nodeType: "landmark",
      summary: "",
      x: null,
      y: null,
      validity: { ...validity, toChapter: 3 },
    });
    await createEdge(owner, token, base, expiredMap.map.id, {
      layerId: null,
      fromNodeId: oldStart.id,
      toNodeId: oldEnd.id,
      routeType: "trail",
      bidirectional: true,
      travelMinutes: 30,
      validity: { ...validity, toChapter: 3 },
    });
    const expiredRoute = await owner
      .post(`${base}/world/timeline/itineraries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        character: {
          type: "character",
          id: character.id,
          branchId: work.mainBranch.id,
          label: "沈砚",
        },
        fromNode: {
          type: "map_node",
          id: oldStart.id,
          branchId: work.mainBranch.id,
          label: "旧渡口",
        },
        toNode: {
          type: "map_node",
          id: oldEnd.id,
          branchId: work.mainBranch.id,
          label: "旧驿道",
        },
        departure: { era: "大玄历", label: "第五日辰时", sortKey: 5000 },
        arrival: { era: "大玄历", label: "第五日午时", sortKey: 5060 },
        travelMinutes: 60,
        validity: { ...validity, fromChapter: 5 },
        sourceChapterId: null,
        evidence: [],
      })
      .expect(409);
    expect(expiredRoute.body.error.code).toBe("MAP_ROUTE_DISCONNECTED");
  });

  it("orders timeline events, locks domain writes and enforces tenant isolation", async () => {
    const owner = await createAuthenticatedAgent("world-timeline@example.com");
    const other = await createAuthenticatedAgent("world-timeline-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const validity = {
      fromChapter: 1,
      toChapter: null as number | null,
      fromStoryTime: null,
      toStoryTime: null,
    };

    const era = await postJson(owner, token, `${base}/world/timeline/eras`, {
      name: "大玄历",
      orderIndex: 1,
      startSortKey: 0,
      endSortKey: null,
      description: "大玄王朝纪年。",
    });
    timelineEraResponseSchema.parse(era.body);
    const first = await createTimelineEvent(owner, token, base, {
      name: "忘川村灭门",
      summary: "十六年前改变沈砚命运的事件。",
      era: "大玄历",
      storyTime: { era: "大玄历", label: "十六年前", sortKey: 100 },
      durationMinutes: 720,
      durationLabel: "一夜",
      event: "仇家屠村后伪装成自尽。",
      validity,
    });
    await createTimelineEvent(owner, token, base, {
      name: "沈砚入山",
      summary: "沈砚被太玄门收为杂役。",
      era: "大玄历",
      storyTime: { era: "大玄历", label: "十年前", sortKey: 200 },
      durationMinutes: 60,
      durationLabel: "半日",
      event: "他第一次见到护山大阵。",
      validity,
    });
    const duplicate = await owner
      .post(`${base}/world/timeline/events`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "重复时间点",
        aliases: [],
        summary: "与已有事件占用同一故事时间。",
        description: "",
        tags: [],
        era: "大玄历",
        storyTime: { era: "大玄历", label: "十六年前", sortKey: 100 },
        durationMinutes: 30,
        durationLabel: "半个时辰",
        event: "测试冲突。",
        validity,
      })
      .expect(409);
    expect(duplicate.body.error.code).toBe("TIMELINE_EVENT_OVERLAP");

    const timeline = worldTimelineResponseSchema.parse(
      (await owner.get(`${base}/world/timeline`).expect(200)).body,
    ).data;
    expect(timeline.events.map((event) => event.storyTime.sortKey)).toEqual([100, 200]);

    const faction = await createFaction(owner, token, base, "太玄门");
    const locked = await owner
      .post(`${base}/entities/${faction.faction.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: faction.version })
      .expect(200);
    expect(locked.body.data.status).toBe("locked");

    const direct = await owner
      .post(`${base}/world/factions/${faction.faction.id}/relationships`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        target: {
          type: "faction",
          id: faction.faction.id,
          branchId: work.mainBranch.id,
          label: "太玄门",
        },
        relationType: "neutral",
        validity,
        sourceChapterId: null,
      })
      .expect(409);
    expect(direct.body.error.code).toBe("SETTING_LOCKED");

    const change = settingChangeRequestResponseSchema.parse(
      (
        await owner
          .post(`${base}/entities/${faction.faction.id}/change-requests`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: locked.body.data.version,
            title: "更新太玄门目标",
            reason: "第 20 章确认太玄门也在追查忘川书。",
            after: { data: { details: "追查忘川书并守住天门。" } },
            conflictType: "none",
            evidence: [
              {
                kind: "chapter",
                sourceId: null,
                label: "第 20 章",
                quote: "掌教命人查清忘川书的下落。",
                locator: "第 20 章 · 末段",
                confidence: 0.95,
              },
            ],
          })
          .expect(201)
      ).body,
    ).data;
    expect(change.status).toBe("pending");

    expect(
      (await other.get(`${base}/world/factions/${faction.faction.id}`).expect(403)).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${base}/world/timeline/events`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({
            name: "越权事件",
            aliases: [],
            summary: "越权写入。",
            description: "",
            tags: [],
            era: "大玄历",
            storyTime: { era: "大玄历", label: "越权", sortKey: 999 },
            durationMinutes: 1,
            durationLabel: "一息",
            event: "越权。",
            validity,
          })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    expect(first.event.id).toBeTruthy();
  });

  it("enables and forces RLS on every world domain table", async () => {
    const tables = [
      "faction_profiles",
      "faction_relationships",
      "map_control",
      "map_layers",
      "map_nodes",
      "map_edges",
      "map_markers",
      "timeline_eras",
      "timeline_events",
      "character_itineraries",
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

  async function createMap(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await postJson(agent, token, `${base}/world/maps`, {
      name,
      aliases: [],
      summary: `${name}地图。`,
      description: "",
      tags: [],
      details: `${name}的地形与势力分布。`,
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return mapDetailResponseSchema.parse(response.body).data;
  }

  async function createFaction(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await postJson(agent, token, `${base}/world/factions`, {
      name,
      aliases: [],
      summary: `${name}的势力档案。`,
      description: "",
      tags: [],
      profile: {
        overview: `${name}盘踞北域。`,
        goals: "扩张控制区。",
        resources: "灵脉与弟子。",
        doctrine: "强者为尊。",
      },
    });
    return factionDetailResponseSchema.parse(response.body).data;
  }

  async function createCharacter(agent: SuperAgentTest, token: string, base: string, name: string) {
    const response = await postJson(agent, token, `${base}/characters`, {
      name,
      aliases: [],
      summary: "行程测试人物。",
      description: "",
      tags: [],
      profile: {
        desire: "找回记忆",
        fear: "被忘川书吞噬",
        goal: "进入天门",
        voiceSample: "",
        voiceGuide: "",
        disguise: "",
      },
    });
    if (response.status !== 201) {
      throw new Error(`${response.status}: ${JSON.stringify(response.body)}`);
    }
    return characterDetailResponseSchema.parse(response.body).data.character;
  }

  async function createNode(
    agent: SuperAgentTest,
    token: string,
    base: string,
    mapId: string,
    payload: Record<string, unknown>,
  ) {
    const response = await postJson(agent, token, `${base}/world/maps/${mapId}/nodes`, payload);
    return mapNodeResponseSchema.parse(response.body).data;
  }

  async function createEdge(
    agent: SuperAgentTest,
    token: string,
    base: string,
    mapId: string,
    payload: Record<string, unknown>,
  ) {
    const response = await postJson(agent, token, `${base}/world/maps/${mapId}/edges`, payload);
    return mapEdgeResponseSchema.parse(response.body).data;
  }

  async function createTimelineEvent(
    agent: SuperAgentTest,
    token: string,
    base: string,
    input: {
      name: string;
      summary: string;
      era: string;
      storyTime: { era: string; label: string; sortKey: number };
      durationMinutes: number;
      durationLabel: string;
      event: string;
      validity: {
        fromChapter: number;
        toChapter: number | null;
        fromStoryTime: null;
        toStoryTime: null;
      };
    },
  ) {
    const response = await postJson(agent, token, `${base}/world/timeline/events`, {
      name: input.name,
      aliases: [],
      summary: input.summary,
      description: "",
      tags: [],
      era: input.era,
      storyTime: input.storyTime,
      durationMinutes: input.durationMinutes,
      durationLabel: input.durationLabel,
      event: input.event,
      validity: input.validity,
    });
    return timelineEventResponseSchema.parse(response.body).data;
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
