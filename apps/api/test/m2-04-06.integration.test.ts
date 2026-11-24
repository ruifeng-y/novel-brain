import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  PROCESS_IMPORT_JOB,
  branchComparisonResponseSchema,
  branchCreateResponseSchema,
  canonCommitResponseSchema,
  changeAnalysisResponseSchema,
  changeApplyResponseSchema,
  changeRequestResponseSchema,
  chapterWorkspaceResponseSchema,
  chunkedImportProgressResponseSchema,
  factProposalListResponseSchema,
  factProposalResponseSchema,
  generateChapterJobSchema,
  generationJobResponseSchema,
  mergeApplyResponseSchema,
  mergeItemDecisionResponseSchema,
  manuscriptImportResponseSchema,
  notificationListResponseSchema,
  outlineNodeMutationResponseSchema,
  outlineWorkspaceResponseSchema,
  searchRebuildResponseSchema,
  searchResponseSchema,
  settingEntityResponseSchema,
  storyLedgerMutationResponseSchema,
  storyLedgerWorkspaceResponseSchema,
  versionRollbackResponseSchema,
  workResponseSchema,
} from "@novel-brain/contracts";
import { FakeAiProvider } from "@novel-brain/ai";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { GenerationJobProcessor } from "../../worker/src/generation/generation.processor";
import { WorkerGenerationRepository } from "../../worker/src/generation/generation.repository";
import { ManuscriptImportProcessor } from "../../worker/src/imports/manuscript-import.processor";
import { WorkerManuscriptImportRepository } from "../../worker/src/imports/manuscript-import.repository";

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

describe("M2 change, branch, search and chunked import integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  let importRepository: WorkerManuscriptImportRepository;
  let importProcessor: ManuscriptImportProcessor;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "m2-04-06-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "m2-04-06-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1,https://api.deepseek.com";

    await runMigrations(databaseUrl);
    databasePool = createDatabasePool(databaseUrl, {
      query_timeout: 30_000,
      statement_timeout: 30_000,
    });
    redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MAIL_GATEWAY)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    importRepository = new WorkerManuscriptImportRepository();
    importProcessor = new ManuscriptImportProcessor(importRepository);
  });

  beforeEach(async () => {
    mail.codes.clear();
    await databasePool.query("TRUNCATE TABLE users CASCADE");
    await redis.flushdb();
  });

  afterAll(async () => {
    await importRepository?.onModuleDestroy();
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("creates a branch, analyzes and applies a change, then selectively merges one object", async () => {
    const owner = await createAuthenticatedAgent("m2-change-owner@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token, "修改与平行版本");
    let branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    const branch = branchCreateResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            name: "what-if",
            sourceNodeId: work.mainBranch.headNodeId,
            reason: "验证另一条剧情线",
          })
          .expect(200)
      ).body,
    ).data;
    branchPath = `/api/v1/works/${work.id}/branches/${branch.id}`;
    const selectedBranchWork = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}?branchId=${branch.id}`).expect(200)).body,
    ).data;
    expect(selectedBranchWork.mainBranch.id).toBe(branch.id);

    const targetEntity = settingEntityResponseSchema.parse(
      (
        await owner
          .post(`${branchPath}/entities`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            type: "character",
            name: "沈砚",
            aliases: ["小砚"],
            summary: "左臂骨折，仍在追查旧案。",
            description: "外门杂役。",
            tags: ["主角"],
            data: {
              bodyState: "左臂骨折",
              knowledgeBoundary: "不知道父母死于仇杀",
              relationshipSummary: "与顾青互相试探",
            },
          })
          .expect(201)
      ).body,
    ).data;
    const branchBeforeChange = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}?branchId=${branch.id}`).expect(200)).body,
    ).data.mainBranch;
    const targetEntityId = targetEntity.id;
    const change = changeRequestResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${branch.id}/changes`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "m2-change-1")
          .send({
            title: "调整角色伤势",
            reason: "让后续战斗成立",
            targetVersion: targetEntity.version,
            targetType: "entity",
            targetId: targetEntityId,
            objectType: "entity",
            before: { version: targetEntity.version, summary: targetEntity.summary },
            after: { summary: "左臂恢复，旧案线索已经明确。" },
            risk: "high",
            source: "author",
          })
          .expect(200)
      ).body,
    ).data;

    const analysis = changeAnalysisResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${branch.id}/changes/${change.id}/analyze`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(analysis.impacts).toHaveLength(7);
    expect(analysis.change.status).toBe("awaiting_confirmation");

    const applied = changeApplyResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${branch.id}/changes/${change.id}/apply`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: analysis.change.version,
            expectedTargetVersion: targetEntity.version,
            confirmHighRisk: true,
            reason: "作者确认调整",
          })
          .expect(200)
      ).body,
    ).data;
    expect(applied.change.status).toBe("applied");
    expect(
      settingEntityResponseSchema.parse(
        (await owner.get(`${branchPath}/entities/${targetEntityId}`).expect(200)).body,
      ).data.summary,
    ).toBe("左臂恢复，旧案线索已经明确。");

    const rollback = versionRollbackResponseSchema.parse(
      (
        await owner
          .post(`${branchPath}/rollback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            targetNodeId: branchBeforeChange.headNodeId,
            expectedHeadNodeId: applied.versionNodeId,
            reason: "撤销这次角色状态修改",
          })
          .expect(200)
      ).body,
    ).data;
    expect(rollback.nodeType).toBe("rollback");
    expect(
      settingEntityResponseSchema.parse(
        (await owner.get(`${branchPath}/entities/${targetEntityId}`).expect(200)).body,
      ).data.summary,
    ).toBe("左臂骨折，仍在追查旧案。");

    const mainEntity = settingEntityResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            type: "character",
            name: "沈砚",
            aliases: ["小砚"],
            summary: "左臂暂时包扎，等待进一步处理。",
            description: "外门杂役。",
            tags: ["主角"],
            data: {
              bodyState: "左臂暂时包扎",
              knowledgeBoundary: "不知道父母死于仇杀",
              relationshipSummary: "与顾青互相试探",
            },
          })
          .expect(201)
      ).body,
    ).data;
    const mainChange = changeRequestResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/changes`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "m2-change-main")
          .send({
            title: "主线也调整角色伤势",
            reason: "形成目标侧冲突",
            targetVersion: mainEntity.version,
            targetType: "entity",
            targetId: mainEntity.id,
            objectType: "entity",
            before: { version: mainEntity.version, summary: mainEntity.summary },
            after: { summary: "左臂已恢复，准备追查血河宗。" },
            risk: "high",
            source: "author",
          })
          .expect(200)
      ).body,
    ).data;
    const mainAnalysis = changeAnalysisResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/changes/${mainChange.id}/analyze`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    const mainChangeApplied = changeApplyResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/changes/${mainChange.id}/apply`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: mainAnalysis.change.version,
            expectedTargetVersion: mainEntity.version,
            confirmHighRisk: true,
          })
          .expect(200)
      ).body,
    ).data;

    const comparison = branchComparisonResponseSchema.parse(
      (
        await owner
          .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/compare/${branch.id}`)
          .expect(200)
      ).body,
    ).data;
    expect(comparison.items.length).toBeGreaterThan(0);
    expect(comparison.items.some((candidate) => candidate.conflict)).toBe(true);
    const item = comparison.items.find((candidate) => candidate.changeKind === "changed")!;
    expect(item).toBeDefined();
    expect(item.conflict).toBe(true);

    const decision = mergeItemDecisionResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${item.id}/decision`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: item.version,
            action: "accept",
            reason: "接受该对象的差异",
          })
          .expect(200)
      ).body,
    ).data;
    expect(decision.status).toBe("accepted");

    const mergeApplied = mergeApplyResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            itemIds: [item.id],
            expectedTargetHeadNodeId: mainChangeApplied.versionNodeId,
            confirmHighRisk: true,
          })
          .expect(200)
      ).body,
    ).data;
    expect(
      settingEntityResponseSchema.parse(
        (
          await owner
            .get(
              `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${mainEntity.id}`,
            )
            .expect(200)
        ).body,
      ).data.summary,
    ).toBe("左臂恢复，旧案线索已经明确。");
    const mergeRollback = versionRollbackResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/rollback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            targetNodeId: mergeApplied.versionNodeId,
            expectedHeadNodeId: mergeApplied.versionNodeId,
            reason: "撤销这次对象摘取",
          })
          .expect(200)
      ).body,
    ).data;
    expect(mergeRollback.nodeType).toBe("rollback");
    expect(
      settingEntityResponseSchema.parse(
        (
          await owner
            .get(
              `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/entities/${mainEntity.id}`,
            )
            .expect(200)
        ).body,
      ).data.summary,
    ).toBe("左臂已恢复，准备追查血河宗。");
    const notifications = notificationListResponseSchema.parse(
      (await owner.get("/api/v1/notifications?limit=20").expect(200)).body,
    ).data;
    expect(notifications.some((notification) => notification.type === "merge_conflict")).toBe(true);
    const other = await createAuthenticatedAgent("m2-change-other@example.com");
    const otherToken = await csrf(other);
    await other.get(`/api/v1/works/${work.id}/branches/${branch.id}/changes?limit=20`).expect(403);
    await other
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${item.id}/decision`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version: item.version, action: "accept", reason: "越权测试" })
      .expect(404);
    expect(branchPath).toContain(branch.id);
  });

  it("compares five object types from a historical node and applies only accepted append-only merge items", async () => {
    const owner = await createAuthenticatedAgent("m3-263-matrix-owner@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token, "历史分支五类对象矩阵");
    const mainPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const chapterTitle = "共同章节";
    const entityName = "墨玉令牌";
    const outlineTitle = "第一卷 分叉";
    const ledgerTitle = "玉佩裂痕";
    const mainFactObject = "沈砚在主线决定返回荒寺。";
    const branchFactObject = "沈砚在平行版本决定离开荒寺。";

    await ensureModelConfig(owner, token);
    await createGenerationPrerequisites(owner, token, mainPath);
    const mainChapter = await createReadyChapter(owner, token, mainPath, chapterTitle);
    const mainCommit = await generateAndCommitFact(
      owner,
      token,
      mainPath,
      mainChapter.id,
      mainFactObject,
    );
    const mainChapterAfterCommit = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${mainPath}/chapters/${mainChapter.id}`).expect(200)).body,
    ).data;
    const sourceNodeId = mainChapterAfterCommit.currentVersion?.versionNodeId;
    if (!sourceNodeId) {
      throw new Error("Expected the main chapter to have a committed version node");
    }

    const mainEntity = await createMatrixEntity(owner, token, mainPath, entityName, "主线旧设定");
    const mainOutline = await createMatrixOutline(
      owner,
      token,
      mainPath,
      outlineTitle,
      "主线旧大纲",
    );
    const mainLedger = await createMatrixLedger(owner, token, mainPath, ledgerTitle, "主线旧伏笔");
    const mainBeforeBranch = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}`).expect(200)).body,
    ).data.mainBranch;
    expect(sourceNodeId).not.toBe(mainBeforeBranch.headNodeId);

    const branch = branchCreateResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            name: "历史节点分支",
            sourceNodeId,
            reason: "从明确历史版本验证五类对象比较与摘取",
          })
          .expect(200)
      ).body,
    ).data;
    expect(branch.headNodeId).toBe(sourceNodeId);
    const branchPath = `/api/v1/works/${work.id}/branches/${branch.id}`;

    await createGenerationPrerequisites(owner, token, branchPath);
    const branchChapter = await createReadyChapter(owner, token, branchPath, chapterTitle);
    const branchCommit = await generateAndCommitFact(
      owner,
      token,
      branchPath,
      branchChapter.id,
      branchFactObject,
    );
    expect(branchCommit.versionNodeId).not.toBe(mainCommit.versionNodeId);
    expect(branchCommit.branchId).toBe(branch.id);
    const branchChapterAfterCommit = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${branchChapter.id}`).expect(200)).body,
    ).data;
    const branchContent = branchChapterAfterCommit.currentVersion?.content;
    if (!branchContent) {
      throw new Error("Expected branch chapter content");
    }
    const branchEntity = await createMatrixEntity(
      owner,
      token,
      branchPath,
      entityName,
      "平行版本新设定",
    );
    const branchOutline = await createMatrixOutline(
      owner,
      token,
      branchPath,
      outlineTitle,
      "平行版本新大纲",
    );
    const branchLedger = await createMatrixLedger(
      owner,
      token,
      branchPath,
      ledgerTitle,
      "平行版本新伏笔",
    );

    const mainChapterBeforeMerge = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${mainPath}/chapters/${mainChapter.id}`).expect(200)).body,
    ).data;
    const mainContentBeforeMerge = "沈砚在主线第 2 版选择继续追查。";
    const chapterChange = changeRequestResponseSchema.parse(
      (
        await owner
          .post(`${mainPath}/changes`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "m3-263-main-chapter-change")
          .send({
            title: "修改主线章节正文",
            reason: "构造五类对象冲突矩阵",
            targetVersion: mainChapterBeforeMerge.version,
            targetType: "chapter",
            targetId: mainChapter.id,
            objectType: "chapter",
            before: {
              title: mainChapterBeforeMerge.title,
              content: mainChapterBeforeMerge.currentVersion?.content ?? "",
            },
            after: { title: mainChapterBeforeMerge.title, content: mainContentBeforeMerge },
            risk: "high",
            source: "author",
          })
          .expect(200)
      ).body,
    ).data;
    const chapterAnalysis = changeAnalysisResponseSchema.parse(
      (
        await owner
          .post(`${mainPath}/changes/${chapterChange.id}/analyze`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    await owner
      .post(`${mainPath}/changes/${chapterChange.id}/apply`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: chapterAnalysis.change.version,
        expectedTargetVersion: mainChapterBeforeMerge.version,
        confirmHighRisk: true,
        reason: "作者确认主线章节改写",
      })
      .expect(200);

    const mainEntityUpdated = settingEntityResponseSchema.parse(
      (
        await owner
          .patch(`${mainPath}/entities/${mainEntity.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ version: mainEntity.version, summary: "主线新设定" })
          .expect(200)
      ).body,
    ).data;
    const mainOutlineUpdated = outlineNodeMutationResponseSchema.parse(
      (
        await owner
          .patch(`${mainPath}/outline/nodes/${mainOutline.node.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ version: mainOutline.node.version, summary: "主线新大纲" })
          .expect(200)
      ).body,
    ).data;
    const mainLedgerUpdated = storyLedgerMutationResponseSchema.parse(
      (
        await owner
          .patch(`${mainPath}/ledger/entries/${mainLedger.entry.id}`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({ kind: "foreshadow", version: mainLedger.entry.version, summary: "主线新伏笔" })
          .expect(200)
      ).body,
    ).data;
    expect(mainEntityUpdated.id).not.toBe(branchEntity.id);
    expect(mainOutlineUpdated.node.id).not.toBe(branchOutline.node.id);
    expect(mainLedgerUpdated.entry.id).not.toBe(branchLedger.entry.id);

    const comparison = branchComparisonResponseSchema.parse(
      (
        await owner
          .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/compare/${branch.id}`)
          .expect(200)
      ).body,
    ).data;
    const expectedKeys = {
      chapter: "chapter:number:1",
      entity: `entity:item:name:${entityName}`,
      ledger: `ledger:name:${ledgerTitle}`,
      outline: `outline:name:${outlineTitle}`,
    } as const;
    const itemsByType = new Map(
      (["chapter", "entity", "outline", "ledger"] as const).map((objectType) => {
        const candidates = comparison.items.filter(
          (item) => item.objectType === objectType && item.objectKey === expectedKeys[objectType],
        );
        expect(
          candidates,
          `${objectType}: ${comparison.items
            .map((item) => `${item.objectType}=${item.objectKey}`)
            .join(", ")}`,
        ).toHaveLength(1);
        const item = candidates[0]!;
        expect(item.changeKind, objectType).toBe("changed");
        expect(item.conflict, objectType).toBe(true);
        expect(item.risk, objectType).toBe("high");
        return [objectType, item] as const;
      }),
    );
    const factItem = comparison.items.find(
      (item) =>
        item.objectType === "fact" &&
        item.sourcePayload.object === branchFactObject &&
        item.targetPayload.object === mainFactObject,
    );
    if (!factItem) {
      throw new Error("Expected a fact-level merge item");
    }
    expect(factItem.objectKey).toBe("fact:chapter:1:未明人物:事件:1");
    expect(factItem).toMatchObject({
      changeKind: "changed",
      conflict: true,
      risk: "high",
    });

    const acceptedIds: string[] = [];
    const allItems = [...itemsByType.values(), factItem];
    for (const item of allItems) {
      const rejected = mergeItemDecisionResponseSchema.parse(
        (
          await owner
            .post(
              `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${item.id}/decision`,
            )
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({
              version: item.version,
              action: "reject",
              reason: `验证 ${item.objectType} 单项拒绝`,
            })
            .expect(200)
        ).body,
      ).data;
      expect(rejected.status).toBe("rejected");
      const decision = mergeItemDecisionResponseSchema.parse(
        (
          await owner
            .post(
              `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${item.id}/decision`,
            )
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({
              version: rejected.version,
              action: "accept",
              reason: `接受 ${item.objectType} 对象`,
            })
            .expect(200)
        ).body,
      ).data;
      expect(decision.status).toBe("accepted");
      acceptedIds.push(item.id);
    }

    const acceptedObjectiveIds = (["chapter", "entity", "outline", "ledger"] as const).map(
      (objectType) => itemsByType.get(objectType)!.id,
    );
    const rejectedItem = comparison.items.find(
      (item) => !acceptedIds.includes(item.id) && item.changeKind === "changed",
    );
    if (!rejectedItem) {
      throw new Error("Expected an extra comparison item for reject-only evidence");
    }
    const rejectedDecision = mergeItemDecisionResponseSchema.parse(
      (
        await owner
          .post(
            `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${rejectedItem.id}/decision`,
          )
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            version: rejectedItem.version,
            action: "reject",
            reason: "验证拒绝项不会进入摘取应用",
          })
          .expect(200)
      ).body,
    ).data;
    expect(rejectedDecision.status).toBe("rejected");

    const mainBeforeApply = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}`).expect(200)).body,
    ).data.mainBranch;
    const mixedSelection = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        itemIds: [...acceptedIds, rejectedItem.id],
        expectedTargetHeadNodeId: mainBeforeApply.headNodeId,
        confirmHighRisk: true,
      })
      .expect(409);
    expect(mixedSelection.body.error.code).toBe("VERSION_CONFLICT");

    const missingConfirmation = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        itemIds: [factItem.id],
        expectedTargetHeadNodeId: mainBeforeApply.headNodeId,
      })
      .expect(409);
    expect(missingConfirmation.body.error.code).toBe("CHANGE_HIGH_RISK_CONFIRMATION_REQUIRED");
    const falseConfirmation = await owner
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        itemIds: [factItem.id],
        expectedTargetHeadNodeId: mainBeforeApply.headNodeId,
        confirmHighRisk: false,
      })
      .expect(409);
    expect(falseConfirmation.body.error.code).toBe("CHANGE_HIGH_RISK_CONFIRMATION_REQUIRED");

    const factMergeApplied = mergeApplyResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            itemIds: [factItem.id],
            expectedTargetHeadNodeId: mainBeforeApply.headNodeId,
            confirmHighRisk: true,
          })
          .expect(200)
      ).body,
    ).data;
    expect(factMergeApplied.applied).toEqual([factItem.id]);
    const factHistory = await databasePool.query<{
      id: string;
      parent_node_id: string | null;
      node_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, parent_node_id, node_type, payload
       FROM version_nodes
       WHERE work_id = $1 AND branch_id = $2
       ORDER BY created_at DESC LIMIT 2`,
      [work.id, work.mainBranch.id],
    );
    const factCanonNode = factHistory.rows.find((node) => node.node_type === "canon_commit");
    const factMergeNode = factHistory.rows.find((node) => node.node_type === "branch_merge");
    expect(factCanonNode).toMatchObject({
      node_type: "canon_commit",
      parent_node_id: mainBeforeApply.headNodeId,
      payload: {
        sourceChapterNumber: 1,
      },
    });
    expect(factMergeNode).toMatchObject({
      id: factMergeApplied.versionNodeId,
      node_type: "branch_merge",
      parent_node_id: factCanonNode?.id,
    });
    const factCommit = await databasePool.query<{
      id: string;
      version_node_id: string;
      chapter_version_id: string;
      idempotency_key: string;
    }>(
      `SELECT id, version_node_id, chapter_version_id, idempotency_key
       FROM canon_commits
       WHERE work_id = $1 AND branch_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [work.id, work.mainBranch.id],
    );
    expect(factCommit.rows[0]).toMatchObject({
      version_node_id: factCanonNode?.id,
      idempotency_key: `merge:${factItem.id}`,
    });
    const mergedFact = await databasePool.query<{
      canon_commit_id: string;
      status: string;
    }>(
      `SELECT canon_commit_id, status
       FROM facts
       WHERE work_id = $1 AND branch_id = $2 AND object = $3 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [work.id, work.mainBranch.id, branchFactObject],
    );
    expect(mergedFact.rows[0]).toMatchObject({
      canon_commit_id: factCommit.rows[0]?.id,
      status: "active",
    });
    const povProjection = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM character_knowledge_states
       WHERE work_id = $1 AND branch_id = $2 AND version_node_id = $3`,
      [work.id, work.mainBranch.id, factCanonNode?.id],
    );
    expect(Number(povProjection.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    const canonReplay = await owner
      .post(`${mainPath}/chapters/${mainChapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "m3-263-canon-replay")
      .send({ chapterVersionId: mainCommit.chapterVersionId })
      .expect(409);
    expect(canonReplay.body.error).toMatchObject({
      code: "CANON_IDEMPOTENCY_CONFLICT",
      details: { commitId: mainCommit.id },
    });
    const cherryPickVersionReplay = await owner
      .post(`${mainPath}/chapters/${mainChapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "m3-263-cherry-version-replay")
      .send({ chapterVersionId: factCommit.rows[0]?.chapter_version_id })
      .expect(409);
    expect(cherryPickVersionReplay.body.error.code).not.toBe("CANON_IDEMPOTENCY_CONFLICT");
    const supersededFact = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM facts
       WHERE work_id = $1 AND branch_id = $2 AND object = $3 AND status = 'superseded'`,
      [work.id, work.mainBranch.id, mainFactObject],
    );
    expect(supersededFact.rows[0]?.count).toBe("1");
    const untouchedFact = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM facts
       WHERE work_id = $1 AND branch_id = $2 AND object = $3 AND status = 'active'`,
      [work.id, work.mainBranch.id, mainCommit.facts[1]?.object],
    );
    expect(untouchedFact.rows[0]?.count).toBe("1");

    const factMergeBeforeRollback = await databasePool.query<{
      id: string;
      parent_node_id: string | null;
      node_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, parent_node_id, node_type, payload
       FROM version_nodes
       WHERE work_id = $1 AND id = $2`,
      [work.id, factMergeApplied.versionNodeId],
    );
    const factRollback = versionRollbackResponseSchema.parse(
      (
        await owner
          .post(`${mainPath}/rollback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            targetNodeId: factMergeApplied.versionNodeId,
            expectedHeadNodeId: factMergeApplied.versionNodeId,
            reason: "验证事实摘取回滚也追加节点",
          })
          .expect(200)
      ).body,
    ).data;
    expect(factRollback.nodeType).toBe("rollback");
    const factRollbackHistory = await databasePool.query<{
      id: string;
      parent_node_id: string | null;
      node_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, parent_node_id, node_type, payload
       FROM version_nodes
       WHERE work_id = $1 AND id = ANY($2::uuid[])`,
      [work.id, [factMergeApplied.versionNodeId, factRollback.versionNodeId]],
    );
    expect(
      factRollbackHistory.rows.find((node) => node.id === factMergeApplied.versionNodeId),
    ).toEqual(factMergeBeforeRollback.rows[0]);
    const factRollbackCanon = await databasePool.query<{ id: string }>(
      `SELECT id
       FROM version_nodes
       WHERE work_id = $1 AND branch_id = $2 AND node_type = 'canon_commit' AND payload->>'rollback' = 'true'
       ORDER BY created_at DESC LIMIT 1`,
      [work.id, work.mainBranch.id],
    );
    expect(
      factRollbackHistory.rows.find((node) => node.id === factRollback.versionNodeId),
    ).toMatchObject({
      node_type: "rollback",
      parent_node_id: factRollbackCanon.rows[0]?.id,
    });
    const factRollbackProjection = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM character_knowledge_states
       WHERE work_id = $1 AND branch_id = $2 AND version_node_id = $3`,
      [work.id, work.mainBranch.id, factRollbackCanon.rows[0]?.id],
    );
    expect(Number(factRollbackProjection.rows[0]?.count ?? 0)).toBeGreaterThan(0);
    const restoredFact = await databasePool.query<{ object: string }>(
      `SELECT object FROM facts
       WHERE work_id = $1 AND branch_id = $2 AND subject = $3 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [work.id, work.mainBranch.id, mainCommit.facts[0]?.subject],
    );
    expect(restoredFact.rows[0]?.object).toBe(mainFactObject);

    const objectMergeApplied = mergeApplyResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            itemIds: acceptedObjectiveIds,
            expectedTargetHeadNodeId: factRollback.versionNodeId,
            confirmHighRisk: true,
          })
          .expect(200)
      ).body,
    ).data;
    expect(objectMergeApplied.applied).toEqual(acceptedObjectiveIds);
    expect(objectMergeApplied.versionNodeId).not.toBe(factMergeApplied.versionNodeId);
    const mainAfterMerge = workResponseSchema.parse(
      (await owner.get(`/api/v1/works/${work.id}`).expect(200)).body,
    ).data.mainBranch;
    expect(mainAfterMerge.headNodeId).toBe(objectMergeApplied.versionNodeId);

    expect(
      chapterWorkspaceResponseSchema.parse(
        (await owner.get(`${mainPath}/chapters/${mainChapter.id}`).expect(200)).body,
      ).data.currentVersion?.content,
    ).toBe(branchContent);
    expect(
      settingEntityResponseSchema.parse(
        (await owner.get(`${mainPath}/entities/${mainEntity.id}`).expect(200)).body,
      ).data.summary,
    ).toBe("平行版本新设定");
    expect(
      outlineWorkspaceResponseSchema
        .parse((await owner.get(`${mainPath}/outline`).expect(200)).body)
        .data.nodes.find((node) => node.id === mainOutline.node.id)?.summary,
    ).toBe("平行版本新大纲");
    expect(
      storyLedgerWorkspaceResponseSchema
        .parse((await owner.get(`${mainPath}/ledger`).expect(200)).body)
        .data.entries.find((entry) => entry.id === mainLedger.entry.id)?.summary,
    ).toBe("平行版本新伏笔");
    const mainFactAfterMerge = await databasePool.query<{ object: string }>(
      `SELECT object FROM facts
       WHERE work_id = $1 AND branch_id = $2 AND subject = $3 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [work.id, work.mainBranch.id, mainCommit.facts[0]?.subject],
    );
    expect(mainFactAfterMerge.rows[0]?.object).toBe(mainFactObject);

    const objectMergeBeforeRollback = await databasePool.query<{
      id: string;
      parent_node_id: string | null;
      node_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, parent_node_id, node_type, payload
       FROM version_nodes
       WHERE work_id = $1 AND id = $2`,
      [work.id, objectMergeApplied.versionNodeId],
    );
    expect(objectMergeBeforeRollback.rows[0]).toBeDefined();
    const rollback = versionRollbackResponseSchema.parse(
      (
        await owner
          .post(`${mainPath}/rollback`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({
            targetNodeId: objectMergeApplied.versionNodeId,
            expectedHeadNodeId: objectMergeApplied.versionNodeId,
            reason: "验证摘取回滚追加新节点",
          })
          .expect(200)
      ).body,
    ).data;
    expect(rollback.nodeType).toBe("rollback");
    expect(rollback.versionNodeId).not.toBe(objectMergeApplied.versionNodeId);
    const versionHistory = await databasePool.query<{
      id: string;
      parent_node_id: string | null;
      node_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, parent_node_id, node_type, payload
       FROM version_nodes
       WHERE work_id = $1 AND id = ANY($2::uuid[])`,
      [work.id, [objectMergeApplied.versionNodeId, rollback.versionNodeId]],
    );
    const mergeNode = versionHistory.rows.find(
      (node) => node.id === objectMergeApplied.versionNodeId,
    );
    const rollbackNode = versionHistory.rows.find((node) => node.id === rollback.versionNodeId);
    expect(mergeNode).toEqual(objectMergeBeforeRollback.rows[0]);
    expect(rollbackNode).toMatchObject({
      id: rollback.versionNodeId,
      node_type: "rollback",
      parent_node_id: objectMergeApplied.versionNodeId,
    });
    expect(
      chapterWorkspaceResponseSchema.parse(
        (await owner.get(`${mainPath}/chapters/${mainChapter.id}`).expect(200)).body,
      ).data.currentVersion?.content,
    ).toBe(mainContentBeforeMerge);
    expect(
      settingEntityResponseSchema.parse(
        (await owner.get(`${mainPath}/entities/${mainEntity.id}`).expect(200)).body,
      ).data.summary,
    ).toBe("主线新设定");
    expect(
      outlineWorkspaceResponseSchema
        .parse((await owner.get(`${mainPath}/outline`).expect(200)).body)
        .data.nodes.find((node) => node.id === mainOutline.node.id)?.summary,
    ).toBe("主线新大纲");
    expect(
      storyLedgerWorkspaceResponseSchema
        .parse((await owner.get(`${mainPath}/ledger`).expect(200)).body)
        .data.entries.find((entry) => entry.id === mainLedger.entry.id)?.summary,
    ).toBe("主线新伏笔");

    const other = await createAuthenticatedAgent("m3-263-matrix-other@example.com");
    const otherToken = await csrf(other);
    const forbiddenBranch = await other
      .post(`/api/v1/works/${work.id}/branches`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ name: "越权分支", sourceNodeId, reason: "越权验证" })
      .expect(404);
    expect(forbiddenBranch.body.error.code).toBe("BRANCH_SOURCE_NOT_FOUND");
    const forbiddenCompare = await other
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/compare/${branch.id}`)
      .expect(404);
    expect(forbiddenCompare.body.error.code).toBe("BRANCH_SOURCE_NOT_FOUND");
    const forbiddenDecision = await other
      .post(
        `/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/${factItem.id}/decision`,
      )
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ version: factItem.version, action: "accept", reason: "越权验证" })
      .expect(404);
    expect(forbiddenDecision.body.error.code).toBe("CHANGE_NOT_FOUND");
    const forbiddenApply = await other
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranch.id}/merge-items/apply`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({
        itemIds: [factItem.id],
        expectedTargetHeadNodeId: rollback.versionNodeId,
        confirmHighRisk: true,
      })
      .expect(404);
    expect(forbiddenApply.body.error.code).toBe("BRANCH_SOURCE_NOT_FOUND");

    async function createReadyChapter(
      agent: SuperAgentTest,
      csrfToken: string,
      branchPath: string,
      title: string,
    ) {
      return chapterWorkspaceResponseSchema.parse(
        (
          await agent
            .post(`${branchPath}/chapters`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .send({
              number: 1,
              title,
              brief: {
                goal: "让沈砚在荒寺外确认下一步行动。",
                pov: "沈砚",
                location: "荒寺外山道",
                sceneBeats: ["沈砚握紧墨玉令牌。", "追兵逼近，他必须作出选择。"],
                requiredFacts: ["墨玉令牌仍在沈砚手中"],
              },
            })
            .expect(201)
        ).body,
      ).data;
    }

    async function createGenerationPrerequisites(
      agent: SuperAgentTest,
      csrfToken: string,
      branchPath: string,
    ) {
      const generated = await agent
        .post(`${branchPath}/story-bible/generate`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({})
        .expect(200);
      await agent
        .post(`${branchPath}/story-bible/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({ version: generated.body.data.version })
        .expect(200);

      for (const setting of [
        {
          type: "world_rule",
          name: "令牌会记录真实选择",
          aliases: [],
          summary: "持有令牌者的选择会留下痕迹。",
          description: "",
          tags: [],
          data: { rule: "令牌不能抹除已经发生的选择。" },
        },
        {
          type: "character",
          name: "沈砚",
          aliases: [],
          summary: "持有墨玉令牌的外门弟子。",
          description: "",
          tags: [],
          data: {
            bodyState: "左臂骨折。",
            knowledgeBoundary: "不知道令牌完整来历。",
            relationshipSummary: "与顾青互相试探。",
          },
        },
        {
          type: "golden_finger",
          name: "墨玉令牌",
          aliases: [],
          summary: "记录并提示真实选择的令牌。",
          description: "",
          tags: [],
          data: {
            rules: "只能提示一次选择后果。",
            cost: "每次提示消耗一段记忆。",
            limits: "每日只能使用一次。",
            growth: "完整选择会显现新的刻纹。",
          },
        },
      ] as const) {
        const created = settingEntityResponseSchema.parse(
          (
            await agent
              .post(`${branchPath}/entities`)
              .set("Origin", origin)
              .set("X-CSRF-Token", csrfToken)
              .send(setting)
              .expect(201)
          ).body,
        ).data;
        await agent
          .post(`${branchPath}/entities/${created.id}/lock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", csrfToken)
          .send({ version: created.version })
          .expect(200);
      }
    }

    async function generateAndCommitFact(
      agent: SuperAgentTest,
      csrfToken: string,
      branchPath: string,
      chapterId: string,
      modifiedObject: string,
    ) {
      const started = generationJobResponseSchema.parse(
        (
          await agent
            .post(`${branchPath}/chapters/${chapterId}/generate`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .set("Idempotency-Key", crypto.randomUUID())
            .send({
              budget: {
                maxCostCny: 2.5,
                maxTokens: 12_000,
                maxRevisionRounds: 2,
              },
            })
            .expect(202)
        ).body,
      ).data;
      const processor = new GenerationJobProcessor(
        new WorkerGenerationRepository(),
        new FakeAiProvider(),
      );
      await processor.process(await readWorkerPayload(started.id));
      const waiting = chapterWorkspaceResponseSchema.parse(
        (await agent.get(`${branchPath}/chapters/${chapterId}`).expect(200)).body,
      ).data;
      await agent
        .post(`${branchPath}/chapters/${chapterId}/verify`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .set("Idempotency-Key", crypto.randomUUID())
        .send({ chapterVersionId: waiting.currentVersionId })
        .expect(200);
      const reviewable = chapterWorkspaceResponseSchema.parse(
        (await agent.get(`${branchPath}/chapters/${chapterId}`).expect(200)).body,
      ).data;
      await agent
        .post(`${branchPath}/chapters/${chapterId}/review`)
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({ action: "approve", version: reviewable.version })
        .expect(200);

      const proposals = factProposalListResponseSchema.parse(
        (await agent.get(`${branchPath}/chapters/${chapterId}/fact-proposals`).expect(200)).body,
      ).data;
      expect(proposals.length).toBeGreaterThan(0);
      for (const [index, proposal] of proposals.entries()) {
        await agent
          .post(`${branchPath}/fact-proposals/${proposal.id}/decision`)
          .set("Origin", origin)
          .set("X-CSRF-Token", csrfToken)
          .send(
            index === 0
              ? {
                  action: "modify_confirm",
                  reason: "为五类对象矩阵保存不同事实",
                  modified: { object: modifiedObject, risk: "low" },
                }
              : { action: "confirm", reason: "正文事实已确认" },
          )
          .expect((response) => {
            factProposalResponseSchema.parse(response.body);
          });
      }
      const approved = chapterWorkspaceResponseSchema.parse(
        (await agent.get(`${branchPath}/chapters/${chapterId}`).expect(200)).body,
      ).data;
      return canonCommitResponseSchema.parse(
        (
          await agent
            .post(`${branchPath}/chapters/${chapterId}/canon/commit`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .set("Idempotency-Key", crypto.randomUUID())
            .send({ chapterVersionId: approved.currentVersionId })
            .expect(200)
        ).body,
      ).data;
    }

    async function createMatrixEntity(
      agent: SuperAgentTest,
      csrfToken: string,
      branchPath: string,
      name: string,
      summary: string,
    ) {
      return settingEntityResponseSchema.parse(
        (
          await agent
            .post(`${branchPath}/entities`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .send({
              type: "item",
              name,
              aliases: [],
              summary,
              description: "五类对象矩阵设定。",
              tags: [],
              data: {
                category: "信物",
                grade: "凡品",
                effect: "记录持有者已经作出的真实选择。",
                cost: "",
                ownership: "沈砚",
                limits: "",
              },
            })
            .expect(201)
        ).body,
      ).data;
    }

    async function createMatrixOutline(
      agent: SuperAgentTest,
      csrfToken: string,
      branchPath: string,
      title: string,
      summary: string,
    ) {
      const created = outlineNodeMutationResponseSchema.parse(
        (
          await agent
            .post(`${branchPath}/outline/nodes`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .send({ level: "book", parentId: null, title, summary: "旧大纲" })
            .expect(201)
        ).body,
      ).data;
      return outlineNodeMutationResponseSchema.parse(
        (
          await agent
            .patch(`${branchPath}/outline/nodes/${created.node.id}`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .send({ version: created.node.version, summary })
            .expect(200)
        ).body,
      ).data;
    }

    async function createMatrixLedger(
      agent: SuperAgentTest,
      csrfToken: string,
      branchPath: string,
      title: string,
      summary: string,
    ) {
      return storyLedgerMutationResponseSchema.parse(
        (
          await agent
            .post(`${branchPath}/ledger/entries`)
            .set("Origin", origin)
            .set("X-CSRF-Token", csrfToken)
            .set("Idempotency-Key", crypto.randomUUID())
            .send({
              kind: "foreshadow",
              title,
              summary,
              responsibleRole: "author",
              status: "planned",
              targetWindow: { fromChapter: 2, toChapter: 5 },
              importance: "must",
              readerPromise: "伏笔会在第一卷回收。",
            })
            .expect(201)
        ).body,
      ).data;
    }

    async function ensureModelConfig(agent: SuperAgentTest, csrfToken: string) {
      await agent
        .post("/api/v1/model-configs")
        .set("Origin", origin)
        .set("X-CSRF-Token", csrfToken)
        .send({
          provider: "deepseek",
          label: "DeepSeek 矩阵测试",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-chat",
          apiKey: "sk-fake-m3-263",
          purposes: ["writing"],
          isDefault: true,
        })
        .expect(200);
    }

    async function readWorkerPayload(jobId: string) {
      const result = await databasePool.query<{
        user_id: string;
        work_id: string;
        branch_id: string;
        chapter_id: string;
        model_config_id: string;
        idempotency_key: string;
        budget: Record<string, unknown>;
        checkpoint: Record<string, unknown>;
      }>(
        `SELECT user_id, work_id, branch_id, chapter_id, model_config_id,
                idempotency_key, budget, checkpoint
         FROM jobs WHERE id = $1`,
        [jobId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("Generation job was not persisted");
      }
      return generateChapterJobSchema.parse({
        jobId,
        jobType: "generate_chapter",
        workId: row.work_id,
        branchId: row.branch_id,
        chapterId: row.chapter_id,
        actorId: row.user_id,
        modelConfigId: row.model_config_id,
        idempotencyKey: row.idempotency_key,
        budget: row.budget,
        checkpoint: row.checkpoint,
      });
    }
  });

  it("rebuilds and searches the Chinese branch index", async () => {
    const owner = await createAuthenticatedAgent("m2-search-owner@example.com");
    const token = await csrf(owner);
    const work = await createWork(owner, token, "搜索索引");
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await owner
      .post(`${branchPath}/entities`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        type: "character",
        name: "沈砚",
        aliases: ["小砚"],
        summary: "隐藏忘川书的外门杂役。",
        description: "左臂骨折，仍然坚持调查真相。",
        tags: ["主角"],
        data: {
          bodyState: "左臂骨折",
          knowledgeBoundary: "不知道父母死于仇杀",
          relationshipSummary: "与顾青互相试探",
        },
      })
      .expect(201);

    let rebuilt = searchRebuildResponseSchema.parse(
      (
        await owner
          .post(`${branchPath}/search/rebuild`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(202)
      ).body,
    ).data;
    while (rebuilt.status === "queued" || rebuilt.status === "running") {
      rebuilt = searchRebuildResponseSchema.parse(
        (
          await owner
            .post(`${branchPath}/search/rebuilds/${rebuilt.runId}/process`)
            .set("Origin", origin)
            .set("X-CSRF-Token", token)
            .send({})
            .expect(200)
        ).body,
      ).data;
    }
    expect(rebuilt.indexed).toBeGreaterThan(0);
    expect(rebuilt.status).toBe("completed");
    const rebuildProgress = searchRebuildResponseSchema.parse(
      (await owner.get(`${branchPath}/search/rebuilds/${rebuilt.runId}`).expect(200)).body,
    ).data;
    expect(rebuildProgress).toMatchObject({
      runId: rebuilt.runId,
      status: "completed",
      indexed: rebuilt.indexed,
    });
    const results = searchResponseSchema.parse(
      (await owner.get(`${branchPath}/search?q=${encodeURIComponent("沈砚")}`).expect(200)).body,
    ).data;
    expect(results).toContainEqual(
      expect.objectContaining({ title: "沈砚", sourceType: "entity" }),
    );
    const other = await createAuthenticatedAgent("m2-search-other@example.com");
    await other.get(`${branchPath}/search?q=${encodeURIComponent("沈砚")}`).expect(403);
  });

  it("creates and resumes a chunked manuscript import", async () => {
    const owner = await createAuthenticatedAgent("m2-chunk-import@example.com");
    const token = await csrf(owner);
    const ownerId = (await owner.get("/api/v1/auth/me").expect(200)).body.data.user.id as string;
    const created = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunk-import-1")
          .send({
            sourceName: "大文件.txt",
            chunks: ["第一章 荒寺\n\n沈砚醒来。", "\n\n第二章 追兵\n\n血河宗赶到。"],
          })
          .expect(200)
      ).body,
    ).data;
    expect(created).toMatchObject({
      status: "queued",
      chunkCount: 2,
      processedChunks: 0,
      canConfirm: false,
    });
    const replayed = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunk-import-1")
          .send({
            sourceName: "大文件.txt",
            chunks: ["第一章 荒寺\n\n沈砚醒来。", "\n\n第二章 追兵\n\n血河宗赶到。"],
          })
          .expect(200)
      ).body,
    ).data;
    expect(replayed.importId).toBe(created.importId);
    const stored = await databasePool.query<{
      source_text: string;
      start_offset: number;
      end_offset: number;
    }>(
      `SELECT job.source_text, chunk.start_offset, chunk.end_offset
       FROM import_jobs AS job
       INNER JOIN import_chunks AS chunk ON chunk.import_job_id = job.id
       WHERE job.id = $1
       ORDER BY chunk.sequence`,
      [created.importId],
    );
    expect(stored.rows[0]?.source_text).toBe("");
    expect(stored.rows.map((row) => [row.start_offset, row.end_offset])).toEqual([
      [0, 13],
      [13, 29],
    ]);
    await owner
      .post(`/api/v1/imports/manuscripts/${created.importId}/pause`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const resumed = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post(`/api/v1/imports/manuscripts/${created.importId}/resume`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .send({})
          .expect(200)
      ).body,
    ).data;
    expect(resumed.status).toBe("queued");
    await processImport(ownerId, created.importId);
    const completed = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(completed).toMatchObject({
      status: "awaiting_confirmation",
      processedChunks: 2,
      canConfirm: true,
    });
    const chunkedPreview = manuscriptImportResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${created.importId}`).expect(200)).body,
    ).data;
    expect(chunkedPreview.chapters).toHaveLength(2);
    const other = await createAuthenticatedAgent("m2-chunk-other@example.com");
    const otherToken = await csrf(other);
    await other
      .post(`/api/v1/imports/manuscripts/${created.importId}/process`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({})
      .expect(403);

    const streamed = chunkedImportProgressResponseSchema.parse(
      (
        await owner
          .post("/api/v1/imports/manuscripts/chunked/start")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "chunk-stream-1")
          .send({ sourceName: "流式旧稿.txt", chunkCount: 2 })
          .expect(200)
      ).body,
    ).data;
    for (const [sequence, sourceText] of [
      "第一章 荒寺\n\n沈砚醒来。",
      "\n\n第二章 追兵\n\n血河宗赶到。",
    ].entries()) {
      await owner
        .post(`/api/v1/imports/manuscripts/${streamed.importId}/chunks`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ sequence, sourceText })
        .expect(200);
    }
    await processImport(ownerId, streamed.importId);
    const streamedDone = chunkedImportProgressResponseSchema.parse(
      (await owner.get(`/api/v1/imports/manuscripts/${streamed.importId}/progress`).expect(200))
        .body,
    ).data;
    expect(streamedDone.status).toBe("awaiting_confirmation");
  });

  async function createWork(agent: SuperAgentTest, token: string, title: string) {
    return workResponseSchema.parse(
      (
        await agent
          .post("/api/v1/works")
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", crypto.randomUUID())
          .send({
            mode: "idea",
            title,
            idea: "一个作者尝试修改自己的长篇故事。",
            genre: "xianxia",
            scaleTarget: "long",
            chapterLengthTarget: 3000,
          })
          .expect(200)
      ).body,
    ).data;
  }

  async function createAuthenticatedAgent(email: string): Promise<SuperAgentTest> {
    const agent = request.agent(app.getHttpServer());
    const token = await csrf(agent);
    await agent
      .post("/api/v1/auth/register/send-code")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ email })
      .expect(200);
    await agent
      .post("/api/v1/auth/register")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        email,
        code: mail.codes.get(email),
        password: "StrongPassword123",
        displayName: "M2 作者",
      })
      .expect(200);
    return agent;
  }

  async function processImport(actorId: string, importId: string) {
    await expect(
      importProcessor.process({
        jobType: PROCESS_IMPORT_JOB,
        workId: null,
        branchId: null,
        actorId,
        importId,
        idempotencyKey: `m2-integration-${importId}`,
        checkpoint: {
          schemaVersion: 1,
          revision: 0,
          nextProcessSequence: 0,
          uploadedChunks: 0,
          processedChunks: 0,
        },
      }),
    ).resolves.toBe("succeeded");
  }

  async function csrf(agent: SuperAgentTest): Promise<string> {
    return (await agent.get("/api/v1/auth/csrf").expect(200)).body.data.token as string;
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
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "42P04"
    )) {
      throw error;
    }
  } finally {
    await adminPool.end();
  }
}
