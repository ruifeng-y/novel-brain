import "reflect-metadata";

import { createHash } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  chapterVersionSaveResponseSchema,
  volumeAuditReportResponseSchema,
  volumeAuditWorkspaceResponseSchema,
} from "@novel-brain/contracts";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import {
  M1_XIANXIA_SAMPLE_SEED,
  M1_XIANXIA_SAMPLE_EXPECTED_CHARACTERS,
  M1_XIANXIA_SAMPLE_SOURCE_HASH,
  M1_XIANXIA_SAMPLE_TARGET_CHARS,
  M1_XIANXIA_SAMPLE_VERSION,
  createM1XianxiaSample,
  sampleChapter,
} from "./fixtures/m1-xianxia-sample";

const suffix = `${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
const databaseUrl = dedicatedDatabaseUrl(`novelbrain_test_90_${suffix}`);
const redisUrl = dedicatedRedisUrl();
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("volume audit HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "volume-audit-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "volume-audit-integration-proxy-secret";
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

  it("runs a deterministic volume audit with locatable evidence", async () => {
    const sample = createM1XianxiaSample();
    expect(sample.version).toBe(M1_XIANXIA_SAMPLE_VERSION);
    expect(sample.seed).toBe(M1_XIANXIA_SAMPLE_SEED);
    expect(sample.chapters).toHaveLength(40);
    expect(sample.actualCharacters).toBeGreaterThanOrEqual(100_000);
    expect(sample.actualCharacters).toBeLessThanOrEqual(150_000);
    expect(sample.actualCharacters).toBe(M1_XIANXIA_SAMPLE_EXPECTED_CHARACTERS);
    expect(sample.actualCharacters).toBeGreaterThanOrEqual(M1_XIANXIA_SAMPLE_TARGET_CHARS * 0.95);
    expect(sample.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(sample.sourceHash).toBe(M1_XIANXIA_SAMPLE_SOURCE_HASH);
    expect(createM1XianxiaSample().sourceHash).toBe(sample.sourceHash);

    const owner = await createAuthenticatedAgent("volume-owner@example.com");
    const fixture = await createVolumeFixture(owner);

    const workspace = volumeAuditWorkspaceResponseSchema.parse(
      (await owner.get(fixture.volumeAuditPath).expect(200)).body,
    ).data;
    expect(workspace.goldenThreeLocked).toBe(true);
    expect(workspace.volumes).toEqual([
      expect.objectContaining({
        nodeId: fixture.volumeNodeId,
        chapterFrom: 1,
        chapterTo: 40,
        chapterCount: 40,
        writtenChapters: 40,
      }),
    ]);

    const first = await runAudit(owner, fixture);
    expect(first.report).toMatchObject({
      volumeNodeId: fixture.volumeNodeId,
      chapterFrom: 1,
      chapterTo: 40,
      status: "blocked",
      signoff: null,
    });
    expect(first.report.coverage).toHaveLength(40);
    expect(first.report.summary).toMatchObject({
      unresolvedLedger: 1,
      motivation: 1,
      antagonist: 1,
      powerInflation: 1,
      mapTime: 2,
      knowledgeLeak: 1,
    });
    const codes = first.report.findings.map((finding) => finding.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "UNRESOLVED_LEDGER_ENTRY",
        "MOTIVATION_BREAK",
        "ANTAGONIST_UNDERESTIMATION",
        "POWER_INFLATION",
        "TIMELINE_CONFLICT",
        "LOCATION_CONFLICT",
        "UNDISCLOSED_KNOWLEDGE",
      ]),
    );
    for (const finding of first.report.findings) {
      expect(finding.evidence.length).toBeGreaterThan(0);
      expect(finding.evidence[0]?.quote.length).toBeGreaterThan(0);
      expect(finding.evidence[0]?.locator).toContain("第 ");
      expect(finding.sourceRefs.length).toBeGreaterThan(0);
    }
    const power = first.report.findings.find((finding) => finding.code === "POWER_INFLATION")!;
    expect(power.evidence.map((evidence) => evidence.quote).join("\n")).toContain("踏入金丹");
    const ledger = first.report.findings.find(
      (finding) => finding.code === "UNRESOLVED_LEDGER_ENTRY",
    )!;
    expect(ledger.sourceRefs[0]).toMatchObject({ type: "story_ledger_entry" });

    const second = await runAudit(owner, fixture);
    expect(second.report.sourceHash).toBe(first.report.sourceHash);
    expect(second.auditId).not.toBe(first.auditId);

    const other = await createAuthenticatedAgent("volume-other@example.com");
    expect((await other.get(fixture.volumeAuditPath).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    const otherToken = await csrf(other);
    expect(
      (
        await other
          .post(fixture.volumeAuditPath)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .set("Idempotency-Key", crypto.randomUUID())
          .send({ volumeNodeId: fixture.volumeNodeId })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const blockedSignoff = await owner
      .post(`${fixture.volumeAuditPath}/${first.auditId}/signoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        version: first.report.version,
        decision: "accepted",
        rationale: "作者核对后认为本卷可以放行。",
      })
      .expect(409);
    expect(blockedSignoff.body.error.code).toBe("VOLUME_AUDIT_BLOCKED");

    const changes = await signVolumeAudit(
      owner,
      fixture,
      first.auditId,
      first.report.version,
      "changes_requested",
      "第 8 章连续越级、第 12 章反派降智都需补足因果后再验收。",
    );
    expect(changes.signoff).toMatchObject({
      decision: "changes_requested",
      signedOffBy: expect.any(String),
    });
    expect(changes.version).toBe(first.report.version + 1);

    const chapterTwenty = fixture.chapters[19]!;
    const repairedContent = chapterTwenty.content.replace(
      "沈砚收起断刀，转身离开，不再战斗。",
      "沈砚握紧断刀，转身迎上追兵。",
    );
    const revised = await saveVersion(
      owner,
      fixture,
      chapterTwenty.id,
      2,
      `${repairedContent}\n\n风停了。`,
    );
    const revisedAudit = await runAudit(owner, fixture);
    expect(
      revisedAudit.report.findings.some(
        (finding) =>
          finding.code === "MOTIVATION_BREAK" && finding.chapterVersionId === revised.versionId,
      ),
    ).toBe(false);
    await saveVersion(owner, fixture, chapterTwenty.id, 3, `${revised.content}\n\n顾青终于开口。`);
    const stale = await owner
      .post(`${fixture.volumeAuditPath}/${revisedAudit.auditId}/signoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        version: revisedAudit.report.version,
        decision: "changes_requested",
        rationale: "章节正文已经变化，需要重新运行卷末审计。",
      })
      .expect(409);
    expect(stale.body.error.code).toBe("VOLUME_AUDIT_STALE");

    const clean = await createCleanVolume(owner, fixture);
    const cleanRun = await owner
      .post(fixture.volumeAuditPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ volumeNodeId: clean.volumeNodeId })
      .expect(201);
    const cleanReport = volumeAuditReportResponseSchema.parse(cleanRun.body).data;
    expect(cleanReport).toMatchObject({ status: "passed", signoff: null });
    expect(cleanReport.summary.total).toBe(0);
    const accepted = await signVolumeAudit(
      owner,
      fixture,
      cleanReport.id,
      cleanReport.version,
      "accepted",
      "作者逐章核对本卷剧情线、伏笔与连续性证据，确认可以签收。",
    );
    expect(accepted.signoff).toMatchObject({ decision: "accepted" });
    expect(accepted.version).toBe(cleanReport.version + 1);
  });

  async function runAudit(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createVolumeFixture>>,
  ) {
    const response = await agent
      .post(fixture.volumeAuditPath)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({ volumeNodeId: fixture.volumeNodeId })
      .expect(201);
    const parsed = volumeAuditReportResponseSchema.parse(response.body).data;
    return { report: parsed, auditId: parsed.id };
  }

  async function signVolumeAudit(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createVolumeFixture>>,
    auditId: string,
    version: number,
    decision: "accepted" | "changes_requested",
    rationale: string,
  ) {
    const response = await agent
      .post(`${fixture.volumeAuditPath}/${auditId}/signoff`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ version, decision, rationale })
      .expect(200);
    return volumeAuditReportResponseSchema.parse(response.body).data;
  }

  async function saveVersion(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createVolumeFixture>>,
    chapterId: string,
    version: number,
    content: string,
  ) {
    const response = await agent
      .post(`${fixture.branchPath}/chapters/${chapterId}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({ version, content })
      .expect(201);
    return {
      content,
      versionId: chapterVersionSaveResponseSchema.parse(response.body).data.version.id,
    };
  }

  async function createVolumeFixture(agent: SuperAgentTest) {
    const token = await csrf(agent);
    const work = await createWork(agent, token);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(agent, token, branchPath);
    await createSevenSettingDomains(agent, token, branchPath);
    const volumeNodeId = await createVolumeOutline(agent, token, branchPath);
    const chapters = await createSampleChapters(agent, token, branchPath);
    await lockGoldenThree(agent, token, branchPath, chapters.slice(0, 3));
    await createLedgerFixture(agent, token, branchPath, chapters[0]!);
    for (const chapterNumber of [20, 24, 30, 31]) {
      const chapter = chapters[chapterNumber - 1]!;
      await agent
        .post(`${branchPath}/chapters/${chapter.id}/verify`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ chapterVersionId: chapter.versionId })
        .expect(200);
    }
    return {
      workId: work.id,
      branchPath,
      token,
      volumeNodeId,
      chapters,
      volumeAuditPath: `${branchPath}/volume-audits`,
    };
  }

  async function createCleanVolume(
    agent: SuperAgentTest,
    fixture: Awaited<ReturnType<typeof createVolumeFixture>>,
  ) {
    const outline = await agent.get(`${fixture.branchPath}/outline`).expect(200);
    const book = outline.body.data.nodes.find((node: { level: string }) => node.level === "book");
    const volume = await agent
      .post(`${fixture.branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        level: "volume",
        parentId: book.id,
        sortOrder: 2,
        title: "第二卷 · 清卷",
        summary: "用于验证无阻断项时的作者签收路径。",
      })
      .expect(201);
    const volumeNodeId = volume.body.data.node.id as string;
    const act = await agent
      .post(`${fixture.branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        level: "act",
        parentId: volumeNodeId,
        sortOrder: 1,
        title: "第一幕 · 清卷",
        summary: "无对抗冲突的收束幕。",
      })
      .expect(201);
    const chapter = await agent
      .post(`${fixture.branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        level: "chapter",
        parentId: act.body.data.node.id,
        sortOrder: 1,
        chapterCreate: {
          number: 41,
          title: "清卷",
          brief: {
            goal: "收束第一卷余波。",
            pov: "沈砚",
            location: "荒寺外山道",
            sceneBeats: ["沈砚继续上路。"],
            requiredFacts: ["左臂骨折，不能双手结印"],
          },
        },
      })
      .expect(201);
    const chapterId = chapter.body.data.node.chapter.id as string;
    await agent
      .post(`${fixture.branchPath}/chapters/${chapterId}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", fixture.token)
      .send({
        version: 1,
        content: "风停了。\n\n沈砚把断臂藏进袖中，继续往山上走。",
      })
      .expect(201);
    return { volumeNodeId, chapterId };
  }

  async function createWork(agent: SuperAgentTest, token: string) {
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

  async function createSevenSettingDomains(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<void> {
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
        aliases: ["小砚"],
        summary: "隐藏忘川书的外门杂役。",
        description: "",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折，不能双手结印。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "与顾青互相试探。",
        },
      },
      {
        type: "character",
        name: "罗刹长老",
        aliases: [],
        summary: "血河宗追杀沈砚的长老。",
        description: "",
        tags: ["反派"],
        data: {
          bodyState: "完好。",
          knowledgeBoundary: "不知道忘川书的真正来历。",
          relationshipSummary: "视沈砚为宗门叛徒。",
        },
      },
    ] as const;
    for (const entity of entities) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(entity)
        .expect(201);
      await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
    }
    const faction = await agent
      .post(`${branchPath}/world/factions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "血河宗",
        aliases: [],
        summary: "以血河秘术追杀叛徒的宗门。",
        description: "",
        tags: ["宗门"],
        profile: {
          overview: "盘踞北域血河。",
          goals: "夺回忘川书。",
          resources: "血河秘术与追兵。",
          doctrine: "叛徒必须带回宗内受审。",
        },
      })
      .expect(201);
    const map = await agent
      .post(`${branchPath}/world/maps`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "北域山河",
        aliases: [],
        summary: "沈砚逃亡经过的地图。",
        description: "",
        tags: ["地图"],
        details: "荒寺在山道北侧，血河城在南侧。",
      })
      .expect(201);
    await agent
      .post(`${branchPath}/world/maps/${map.body.data.map.id}/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        layerId: null,
        parentNodeId: null,
        name: "血河城",
        nodeType: "settlement",
        summary: "血河宗控制的城市。",
        x: null,
        y: null,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
      })
      .expect(201);
    const power = await agent
      .post(`${branchPath}/world/power-systems`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "大玄修炼体系",
        aliases: [],
        summary: "炼气、筑基、金丹、元婴、化神五境。",
        description: "",
        tags: ["力量体系"],
        overview: "越级突破需要付出寿元与记忆。",
        lifespanPolicy: {
          mode: "realm",
          unit: "年",
          basis: "境界",
          description: "境界越高寿元越长。",
          pathId: null,
          fixedAmount: null,
        },
        paths: [
          {
            name: "玄门正道",
            pathType: "orthodox",
            description: "以静心凝气为根基。",
            sortOrder: 0,
            realms: [
              realm("炼气", 1),
              realm("筑基", 2, "炼气"),
              realm("金丹", 3, "筑基"),
              realm("元婴", 4, "金丹"),
              realm("化神", 5, "元婴"),
            ],
          },
        ],
      })
      .expect(201);
    expect(power.body.data.paths[0].realms).toHaveLength(5);
    await agent
      .post(`${branchPath}/world/items`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "听潮剑",
        aliases: ["潮生"],
        summary: "会记录持剑者杀意的法器。",
        description: "",
        tags: ["法器"],
        kind: "equipment",
        category: "兵器",
        grade: "玄阶",
        effect: "剑身会记录持剑者的杀意。",
        cost: "杀意过重时会反噬持剑者。",
        limits: "不能离开主人超过七日。",
        ownershipModel: "unique",
        consumable: false,
        quantity: 1,
        equipmentSlot: "main_hand",
      })
      .expect(201);
    await agent
      .post(`${branchPath}/world/timeline/eras`)
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
    await agent
      .post(`${branchPath}/world/timeline/events`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        name: "天门洞开",
        aliases: [],
        summary: "第一卷末的天门开启事件，所有失去记忆的人被挡在门外。",
        description: "",
        tags: [],
        era: "大玄历",
        storyTime: { era: "大玄历", label: "卷一末", sortKey: 900 },
        durationMinutes: 60,
        durationLabel: "一个时辰",
        event: "天门洞开",
        validity: { fromChapter: 40, toChapter: null, fromStoryTime: null, toStoryTime: null },
      })
      .expect(201);
    expect(faction.body.data.faction.id).toBeTruthy();
  }

  async function createVolumeOutline(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<string> {
    const book = await agent
      .post(`${branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ level: "book", parentId: null, title: "忘川书", summary: "全书总纲。" })
      .expect(201);
    const bookId = book.body.data.node.id as string;
    const volume = await agent
      .post(`${branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        level: "volume",
        parentId: bookId,
        title: "第一卷 · 忘川",
        summary: "沈砚从杂役到踏入仙途的第一卷。",
      })
      .expect(201);
    const volumeId = volume.body.data.node.id as string;
    await agent
      .put(`${branchPath}/outline/nodes/${volumeId}/volume-contract`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        objective: "让沈砚在追杀中活下来并发现忘川书的代价。",
        conflict: "血河宗追杀与天门记忆规则。",
        turningPoints: ["断臂结印", "记忆代价", "天门开启"],
        exitConditions: ["沈砚进入天门", "父母之死线索浮出"],
        plotLines: [
          { name: "父母之死", status: "active", note: "卷末仍未回收。" },
          { name: "天门试炼", status: "resolved", note: "卷末开启。" },
        ],
      })
      .expect(200);
    return volumeId;
  }

  async function createSampleChapters(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<Array<{ id: string; versionId: string; number: number; content: string }>> {
    const outline = await agent.get(`${branchPath}/outline`).expect(200);
    const volumeNode = outline.body.data.nodes.find(
      (node: { level: string }) => node.level === "volume",
    );
    const act = await agent
      .post(`${branchPath}/outline/nodes`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        level: "act",
        parentId: volumeNode.id,
        sortOrder: 1,
        title: "第一幕 · 断臂",
        summary: "沈砚在追杀中被迫使用忘川书。",
      })
      .expect(201);
    const actNodeId = act.body.data.node.id as string;
    const chapters: Array<{ id: string; versionId: string; number: number; content: string }> = [];
    for (let number = 1; number <= 40; number += 1) {
      const content = sampleChapter(number);
      const created = await agent
        .post(`${branchPath}/outline/nodes`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          level: "chapter",
          parentId: actNodeId,
          sortOrder: number,
          title: `第 ${number} 章 忘川 ${number}`,
          chapterCreate: {
            number,
            title: `忘川 ${number}`,
            brief: chapterBrief(number),
          },
        })
        .expect(201);
      const chapterId = created.body.data.node.chapter.id as string;
      const version = await agent
        .post(`${branchPath}/chapters/${chapterId}/versions`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: 1, content })
        .expect(201);
      const saved = chapterVersionSaveResponseSchema.parse(version.body).data;
      chapters.push({
        id: chapterId,
        versionId: saved.version.id,
        number,
        content,
      });
    }
    return chapters;
  }

  async function lockGoldenThree(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapters: Array<{ id: string; versionId: string; content: string }>,
  ): Promise<void> {
    const contentHash = (content: string) => {
      return createHash("sha256").update(content).digest("hex");
    };
    const batch = await agent
      .post(`${branchPath}/golden-three/candidates`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "volume-audit-golden-three")
      .send({
        candidates: [
          {
            label: "候选 A · 钩子优先",
            strategy: "hook_focus",
            prompt: { key: "golden-three-opening", version: 3, hash: "a".repeat(64) },
            model: {
              provider: "deepseek",
              model: "deepseek-chat",
              parameters: { temperature: 0.7 },
            },
            context: { packVersionId: null, manifestHash: "b".repeat(64) },
            pins: [
              {
                chapterId: chapters[0]!.id,
                chapterVersionId: chapters[0]!.versionId,
                expectedContentHash: contentHash(chapters[0]!.content),
              },
            ],
          },
          {
            label: "候选 B · 人物优先",
            strategy: "character_focus",
            prompt: { key: "golden-three-opening", version: 3, hash: "c".repeat(64) },
            model: {
              provider: "deepseek",
              model: "deepseek-chat",
              parameters: { temperature: 0.6 },
            },
            context: { packVersionId: null, manifestHash: "d".repeat(64) },
            pins: [
              {
                chapterId: chapters[0]!.id,
                chapterVersionId: chapters[0]!.versionId,
                expectedContentHash: contentHash(chapters[0]!.content),
              },
            ],
          },
        ],
      })
      .expect(201);
    const candidate = batch.body.data.candidates[0] as {
      id: string;
      version: number;
      pins: Array<{ chapterId: string; chapterVersionId: string; content: string }>;
    };
    const dimensions = [
      "opening_hook",
      "protagonist_appeal",
      "world_rules",
      "core_conflict",
      "reader_promise",
      "chapter_end_hook",
    ];
    await agent
      .put(`${branchPath}/golden-three/candidates/${candidate.id}/reviews`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: candidate.version,
        reviews: dimensions.map((dimension, index) => {
          const pin = candidate.pins[index % candidate.pins.length]!;
          return {
            dimension,
            score: 4,
            evidence: {
              chapterId: pin.chapterId,
              chapterVersionId: pin.chapterVersionId,
              passage: pin.content.slice(0, 200),
              locator: `第 ${index + 1} 章 · 首句`,
            },
            reviewerOrigin: "model",
          };
        }),
      })
      .expect(200);
    await agent
      .post(`${branchPath}/golden-three/candidates/${candidate.id}/select`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: candidate.version + 1 })
      .expect(200);
    await agent
      .post(`${branchPath}/golden-three/candidates/${candidate.id}/continuation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: candidate.version + 2 })
      .expect(200);
    await agent
      .post(`${branchPath}/golden-three/candidates/${candidate.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: candidate.version + 3 })
      .expect(200);
  }

  async function createLedgerFixture(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapter: { id: string },
  ): Promise<void> {
    const created = await agent
      .post(`${branchPath}/ledger/entries`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", crypto.randomUUID())
      .send({
        kind: "foreshadow",
        title: "父母之死",
        summary: "沈砚以为父母是自杀。",
        responsibleRole: "protagonist",
        status: "planned",
        targetWindow: { fromChapter: 1, toChapter: 5 },
        importance: "must",
        readerPromise: "身世谜团",
        reason: "开篇埋下身世线索。",
      })
      .expect(201);
    const entry = created.body.data.entry as { id: string; version: number };
    await agent
      .post(`${branchPath}/ledger/entries/${entry.id}/transitions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: entry.version,
        action: "setup",
        chapterId: chapter.id,
        reason: "在第 1 章旧宅里埋下。",
        evidence: [
          {
            kind: "chapter",
            sourceId: chapter.id,
            label: "第 1 章",
            quote: "沈砚把父母的旧信压在箱底。",
            locator: "第 1 章 · 第 1 段",
            strength: "strong",
          },
        ],
      })
      .expect(200);
  }

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const csrfToken = await csrf(agent);
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
        displayName: "卷末审计作者",
      })
      .expect(200);
    return agent;
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
  }
});

function realm(name: string, rank: number, prerequisiteName?: string) {
  return {
    name,
    rank,
    description: `${name}境界。`,
    breakthroughConditions: prerequisiteName
      ? `从${prerequisiteName}突破，需要宗门试炼与完整记忆。`
      : "引气入体。",
    breakthroughCosts: rank >= 3 ? "消耗一段重要记忆。" : "",
    bottlenecks: "",
    counters: "",
    counteredBy: "",
    lifespanAmount: rank * 50,
    prerequisiteRealmId: null,
  };
}

function chapterBrief(number: number) {
  if (number === 20) {
    return {
      goal: "护住顾青，找到新的战斗方式。",
      pov: "沈砚",
      location: "荒寺外山道",
      sceneBeats: ["追兵逼近。", "沈砚选择断后。"],
      requiredFacts: ["左臂骨折，不能双手结印"],
    };
  }
  if (number === 31) {
    return {
      goal: "让沈砚避开血河宗的搜捕。",
      pov: "沈砚",
      location: "荒寺外山道",
      sceneBeats: ["沈砚藏身。", "追兵经过。"],
      requiredFacts: ["左臂骨折，不能双手结印"],
    };
  }
  return {
    goal: `推进第 ${number} 章的忘川书主线。`,
    pov: "沈砚",
    location: "荒寺外山道",
    sceneBeats: ["沈砚向前推进。", "顾青留下线索。"],
    requiredFacts: ["左臂骨折，不能双手结印"],
  };
}

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
  if (!databaseName.startsWith("novelbrain_test_90_")) {
    throw new Error("Volume audit tests must use a dedicated test database");
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
