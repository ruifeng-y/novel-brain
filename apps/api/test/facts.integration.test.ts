import "reflect-metadata";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  chapterWorkspaceResponseSchema,
  confirmedSettingListResponseSchema,
  contextPackPreviewResponseSchema,
  factProposalListResponseSchema,
  factProposalResponseSchema,
  generateChapterJobSchema,
  generationJobResponseSchema,
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

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";
const redisUrl = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2";
const origin = "http://localhost:3000";
const generatedContent = [
  "血从袖口滴下来，落在荒寺外的青石板上。",
  "沈砚把断臂藏进衣袍，只用右手结印。",
  "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
].join("\n\n");

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("fact proposal HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "facts-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "facts-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_CONNECTION_TESTER = "fake";

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

  it("extracts typed proposals from the current chapter version with source evidence", async () => {
    const owner = await createAuthenticatedAgent("facts-owner@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    const chapter = await createReadyChapter(owner, token, branchPath);
    const version = await saveChapterVersion(
      owner,
      token,
      branchPath,
      chapter.id,
      generatedContent,
    );

    const extracted = await owner
      .post(`${branchPath}/chapters/${chapter.id}/extract-facts`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const proposals = factProposalListResponseSchema.parse(extracted.body).data;

    expect(proposals.length).toBeGreaterThanOrEqual(2);
    expect(
      proposals.every(
        (proposal) =>
          proposal.chapterId === chapter.id &&
          proposal.sourceVersionId === version.id &&
          proposal.status === "proposed" &&
          proposal.decision === null &&
          ["low", "medium", "high"].includes(proposal.risk) &&
          generatedContent.includes(proposal.sourceSentence),
      ),
    ).toBe(true);
    expect(proposals.map((proposal) => proposal.sourceSentence)).toEqual(
      expect.arrayContaining([
        "沈砚把断臂藏进衣袍，只用右手结印。",
        "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
      ]),
    );

    const listed = await owner
      .get(`${branchPath}/chapters/${chapter.id}/fact-proposals`)
      .expect(200);
    expect(factProposalListResponseSchema.parse(listed.body).data).toEqual(proposals);

    const other = await createAuthenticatedAgent("facts-other@example.com");
    const forbiddenList = await other
      .get(`${branchPath}/chapters/${chapter.id}/fact-proposals`)
      .expect(403);
    expect(forbiddenList.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const firstProposal = proposals[0];
    if (!firstProposal) {
      throw new Error("Expected an extracted proposal");
    }
    const otherToken = await csrf(other);
    const forbiddenDecision = await other
      .post(`${branchPath}/fact-proposals/${firstProposal.id}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ action: "confirm" })
      .expect(403);
    expect(forbiddenDecision.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");

    for (const proposal of proposals) {
      await decide(owner, token, branchPath, proposal.id, {
        action: "supersede",
        reason: "作者确认改用新的正文版本",
      });
    }
    const reextracted = await owner
      .post(`${branchPath}/chapters/${chapter.id}/extract-facts`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    expect(
      factProposalListResponseSchema
        .parse(reextracted.body)
        .data.every((proposal) => proposal.status === "superseded"),
    ).toBe(true);
  });

  it("extracts proposals as part of the generation job and waits for review", async () => {
    const owner = await createAuthenticatedAgent("facts-worker@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    await createModelConfig(owner, token);
    const chapter = await createReadyChapter(owner, token, branchPath);
    const started = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-worker-generation")
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const job = generationJobResponseSchema.parse(started.body).data;

    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(await readWorkerPayload(job.id));

    const waiting = await owner.get(`${branchPath}/jobs/${job.id}`).expect(200);
    expect(generationJobResponseSchema.parse(waiting.body).data).toMatchObject({
      status: "waiting_review",
      progress: 100,
      currentStep: "await_review",
      checkpoint: { step: "await_review" },
      error: null,
    });
    const proposals = await owner
      .get(`${branchPath}/chapters/${chapter.id}/fact-proposals`)
      .expect(200);
    expect(factProposalListResponseSchema.parse(proposals.body).data.length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("records fact decisions without updating confirmed settings or later context", async () => {
    const owner = await createAuthenticatedAgent("facts-decisions@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    await createModelConfig(owner, token);
    const chapter = await createReadyChapter(owner, token, branchPath);
    const content = [
      "沈砚把断臂藏进衣袍，只用右手结印。",
      "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
      "血河宗追兵逼近荒寺，两人被迫联手。",
      "风穿过残钟，山道重新安静下来。",
    ].join("\n\n");
    await saveChapterVersion(owner, token, branchPath, chapter.id, content);
    const extracted = await owner
      .post(`${branchPath}/chapters/${chapter.id}/extract-facts`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const proposals = factProposalListResponseSchema.parse(extracted.body).data;
    expect(proposals).toHaveLength(4);
    const [confirmedProposal, modifiedProposal, rejectedProposal, pendingProposal] = proposals;
    if (!confirmedProposal || !modifiedProposal || !rejectedProposal || !pendingProposal) {
      throw new Error("Expected four extracted fact proposals");
    }
    const settingsBefore = confirmedSettingListResponseSchema.parse(
      (await owner.get(`${branchPath}/facts`).expect(200)).body,
    ).data;

    const confirmed = await decide(owner, token, branchPath, confirmedProposal.id, {
      action: "confirm",
      reason: "正文与作者意图一致",
    });
    expect(confirmed).toMatchObject({
      id: confirmedProposal.id,
      status: "confirmed",
      decision: {
        action: "confirm",
        actorName: "事实作者",
        reason: "正文与作者意图一致",
      },
    });
    expect(confirmed.decision?.decidedAt).toEqual(expect.any(String));

    const modified = await decide(owner, token, branchPath, modifiedProposal.id, {
      action: "modify_confirm",
      reason: "只写成察觉异常",
      modified: {
        object: "顾青只察觉沈砚在隐瞒，并未看见书页",
        risk: "low",
      },
    });
    expect(modified).toMatchObject({
      id: modifiedProposal.id,
      status: "modified_confirmed",
      object: "顾青只察觉沈砚在隐瞒，并未看见书页",
      risk: "low",
      decision: {
        action: "modify_confirm",
        reason: "只写成察觉异常",
      },
    });

    const rejected = await decide(owner, token, branchPath, rejectedProposal.id, {
      action: "reject",
      reason: "追兵位置与章纲不一致",
    });
    expect(rejected).toMatchObject({
      id: rejectedProposal.id,
      status: "rejected",
      decision: {
        action: "reject",
        reason: "追兵位置与章纲不一致",
      },
    });

    const settingsAfter = confirmedSettingListResponseSchema.parse(
      (await owner.get(`${branchPath}/facts`).expect(200)).body,
    ).data;
    expect(settingsAfter).toEqual(settingsBefore);

    await saveChapterVersion(owner, token, branchPath, chapter.id, content, 2);
    const reextracted = await owner
      .post(`${branchPath}/chapters/${chapter.id}/extract-facts`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({})
      .expect(200);
    const afterReextract = factProposalListResponseSchema.parse(reextracted.body).data;
    expect(afterReextract.find((proposal) => proposal.id === pendingProposal.id)).toMatchObject({
      status: "superseded",
      decision: {
        action: "supersede",
        actorName: "事实作者",
        reason: "正文已更新，旧事实提案自动替代",
      },
    });

    const context = contextPackPreviewResponseSchema.parse(
      (
        await owner
          .get(`${branchPath}/chapters/${chapter.id}/context-preview?tokenBudget=12000`)
          .expect(200)
      ).body,
    ).data;
    expect(context.selected.some((source) => source.key.startsWith("fact:"))).toBe(false);
    expect(JSON.stringify(context)).not.toContain(rejectedProposal.id);
  });

  it("approves a chapter without changing fact proposals or confirmed settings", async () => {
    const owner = await createAuthenticatedAgent("facts-approval@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    await createModelConfig(owner, token);
    const chapter = await createReadyChapter(owner, token, branchPath);
    const started = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-approval-generation")
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const job = generationJobResponseSchema.parse(started.body).data;
    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(await readWorkerPayload(job.id));

    const waitingChapter = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}`).expect(200)).body,
    ).data;
    const proposalsBefore = factProposalListResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}/fact-proposals`).expect(200)).body,
    ).data;
    const settingsBefore = confirmedSettingListResponseSchema.parse(
      (await owner.get(`${branchPath}/facts`).expect(200)).body,
    ).data;

    const approved = await owner
      .post(`${branchPath}/chapters/${chapter.id}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ action: "approve", version: waitingChapter.version })
      .expect(200);

    expect(approved.body.data).toMatchObject({
      chapter: {
        id: chapter.id,
        status: "approved",
      },
      decision: {
        action: "approve",
        actorName: "事实作者",
      },
    });
    expect(
      factProposalListResponseSchema.parse(
        (await owner.get(`${branchPath}/chapters/${chapter.id}/fact-proposals`).expect(200)).body,
      ).data,
    ).toEqual(proposalsBefore);
    expect(
      confirmedSettingListResponseSchema.parse(
        (await owner.get(`${branchPath}/facts`).expect(200)).body,
      ).data,
    ).toEqual(settingsBefore);
  });

  it("blocks fact submission with stable errors until approval and required decisions", async () => {
    const owner = await createAuthenticatedAgent("facts-submit-gates@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    await createModelConfig(owner, token);
    const chapter = await createReadyChapter(owner, token, branchPath);
    const started = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-submit-gate-generation")
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const job = generationJobResponseSchema.parse(started.body).data;
    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(await readWorkerPayload(job.id));
    const waitingChapter = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}`).expect(200)).body,
    ).data;

    const unapproved = await owner
      .post(`${branchPath}/chapters/${chapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-submit-unapproved")
      .send({ chapterVersionId: waitingChapter.currentVersionId })
      .expect(409);
    expect(unapproved.body.error).toMatchObject({
      code: "CANON_CHAPTER_NOT_APPROVED",
      details: { chapterStatus: "waiting_review" },
    });

    await owner
      .post(`${branchPath}/chapters/${chapter.id}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ action: "approve", version: waitingChapter.version })
      .expect(200);

    const undecided = await owner
      .post(`${branchPath}/chapters/${chapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-submit-undecided")
      .send({ chapterVersionId: waitingChapter.currentVersionId })
      .expect(409);
    expect(undecided.body.error.code).toBe("FACT_SUBMISSION_BLOCKED");
    expect(undecided.body.error.details.pendingRequiredFactIds.length).toBeGreaterThan(0);

    const commits = await databasePool.query<{ count: string }>(
      `SELECT count(*) FROM version_nodes
       WHERE branch_id = $1 AND node_type = 'canon_commit'`,
      [work.mainBranch.id],
    );
    expect(commits.rows[0]?.count).toBe("0");
  });

  it("submits confirmed facts once and only then updates confirmed settings", async () => {
    const owner = await createAuthenticatedAgent("facts-submit-success@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, token, branchPath);
    await createConfirmedSettings(owner, token, branchPath);
    await createModelConfig(owner, token);
    const chapter = await createReadyChapter(owner, token, branchPath);
    const started = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-submit-success-generation")
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const job = generationJobResponseSchema.parse(started.body).data;
    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(await readWorkerPayload(job.id));
    const waitingChapter = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}`).expect(200)).body,
    ).data;
    const proposals = factProposalListResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}/fact-proposals`).expect(200)).body,
    ).data;
    const requiredProposals = proposals.filter((proposal) => proposal.required);
    expect(requiredProposals).toHaveLength(2);
    for (const proposal of requiredProposals) {
      await decide(owner, token, branchPath, proposal.id, {
        action: "confirm",
        reason: "与本章正文一致",
      });
    }
    const proposalsBeforeSubmission = factProposalListResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}/fact-proposals`).expect(200)).body,
    ).data;
    const approved = await owner
      .post(`${branchPath}/chapters/${chapter.id}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ action: "approve", version: waitingChapter.version })
      .expect(200);
    expect(approved.body.data.chapter.status).toBe("approved");

    const settingsBeforeSubmission = confirmedSettingListResponseSchema.parse(
      (await owner.get(`${branchPath}/facts`).expect(200)).body,
    ).data;
    const headBefore = (await owner.get(`/api/v1/works/${work.id}`).expect(200)).body.data
      .mainBranch.headNodeId as string;
    const submissionBody = { chapterVersionId: waitingChapter.currentVersionId };
    const submitted = await owner
      .post(`${branchPath}/chapters/${chapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-submit-success")
      .send(submissionBody)
      .expect(200);
    const commit = submitted.body.data as {
      id: string;
      chapterId: string;
      chapterVersionId: string;
      versionNodeId: string;
      sourceChapter: { id: string; number: number; title: string };
      facts: Array<{ proposalId: string; decisionId: string }>;
      decisions: Array<{ proposalId: string; decisionId: string }>;
      summary: { factCount: number; text: string };
    };
    expect(commit).toMatchObject({
      chapterId: chapter.id,
      chapterVersionId: waitingChapter.currentVersionId,
      sourceChapter: {
        id: chapter.id,
        number: 1,
        title: "一只手也能结印",
      },
      summary: {
        factCount: 2,
      },
    });
    expect(commit.summary.text).toContain("第 1 章");
    expect(commit.facts.map((fact) => fact.proposalId)).toEqual(
      expect.arrayContaining(requiredProposals.map((proposal) => proposal.id)),
    );
    expect(commit.decisions.map((decision) => decision.proposalId)).toEqual(
      expect.arrayContaining(requiredProposals.map((proposal) => proposal.id)),
    );
    expect(
      factProposalListResponseSchema.parse(
        (await owner.get(`${branchPath}/chapters/${chapter.id}/fact-proposals`).expect(200)).body,
      ).data,
    ).toEqual(proposalsBeforeSubmission);
    expect(
      chapterWorkspaceResponseSchema.parse(
        (await owner.get(`${branchPath}/chapters/${chapter.id}`).expect(200)).body,
      ).data.status,
    ).toBe("approved");

    const graph = await databasePool.query<{
      commit_count: string;
      node_count: string;
      parent_node_id: string;
      snapshot_id: string;
      branch_head_node_id: string;
    }>(
      `SELECT
        (SELECT count(*) FROM canon_commits WHERE chapter_id = $1) AS commit_count,
        (SELECT count(*) FROM version_nodes WHERE object_id = $1 AND node_type = 'canon_commit') AS node_count,
        vn.parent_node_id,
        vn.snapshot_id,
        wb.head_node_id AS branch_head_node_id
       FROM version_nodes vn
       JOIN work_branches wb ON wb.id = vn.branch_id
       WHERE vn.id = $2`,
      [chapter.id, commit.versionNodeId],
    );
    expect(graph.rows[0]).toMatchObject({
      commit_count: "1",
      node_count: "1",
      parent_node_id: headBefore,
      snapshot_id: commit.id,
      branch_head_node_id: commit.versionNodeId,
    });

    const settingsAfterSubmission = await owner.get(`${branchPath}/facts`).expect(200);
    const submittedFacts = (
      settingsAfterSubmission.body.data as Array<Record<string, unknown>>
    ).filter((item) => item.kind === "fact");
    expect(submittedFacts).toHaveLength(2);
    expect(submittedFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "canon",
          sourceChapterId: chapter.id,
          status: "locked",
          validFromChapter: 1,
          validToChapter: null,
        }),
      ]),
    );
    expect(settingsAfterSubmission.body.data).not.toEqual(settingsBeforeSubmission);

    const secondChapter = await createReadyChapter(owner, token, branchPath, 2, "余波");
    const context = contextPackPreviewResponseSchema.parse(
      (
        await owner
          .get(`${branchPath}/chapters/${secondChapter.id}/context-preview?tokenBudget=12000`)
          .expect(200)
      ).body,
    ).data;
    expect(context.selected.map((source) => source.key)).toEqual(
      expect.arrayContaining(commit.facts.map((fact) => `setting:${fact.id}`)),
    );
    for (const fact of commit.facts) {
      const selectedFact = context.selected.find((source) => source.key === `setting:${fact.id}`);
      expect(selectedFact?.sourceRefs).toEqual([
        expect.objectContaining({
          sourceId: fact.id,
          citation: `第 ${chapter.number} 章事实 · ${fact.subject} · ${fact.predicate}：${fact.object}`,
        }),
      ]);
    }

    const [futureFact, expiredFact] = commit.facts;
    if (!futureFact || !expiredFact) {
      throw new Error("Expected submitted facts in the canon commit");
    }
    await databasePool.query("UPDATE facts SET valid_from_chapter = 3 WHERE id = $1", [
      futureFact.id,
    ]);
    await databasePool.query("UPDATE facts SET valid_to_chapter = 2 WHERE id = $1", [
      expiredFact.id,
    ]);

    const beforeValidity = contextPackPreviewResponseSchema.parse(
      (
        await owner
          .get(`${branchPath}/chapters/${secondChapter.id}/context-preview?tokenBudget=12000`)
          .expect(200)
      ).body,
    ).data;
    expect(beforeValidity.selected.map((source) => source.key)).not.toContain(
      `setting:${futureFact.id}`,
    );

    const thirdChapter = await createReadyChapter(owner, token, branchPath, 3, "回响");
    const afterValidity = contextPackPreviewResponseSchema.parse(
      (
        await owner
          .get(`${branchPath}/chapters/${thirdChapter.id}/context-preview?tokenBudget=12000`)
          .expect(200)
      ).body,
    ).data;
    expect(afterValidity.selected.map((source) => source.key)).toContain(
      `setting:${futureFact.id}`,
    );
    expect(afterValidity.selected.map((source) => source.key)).not.toContain(
      `setting:${expiredFact.id}`,
    );
    expect(
      afterValidity.selected.find((source) => source.key === `setting:${futureFact.id}`)
        ?.sourceRefs,
    ).toEqual([
      expect.objectContaining({
        sourceId: futureFact.id,
        citation: `第 ${chapter.number} 章事实 · ${futureFact.subject} · ${futureFact.predicate}：${futureFact.object}`,
      }),
    ]);

    const replayed = await owner
      .post(`${branchPath}/chapters/${chapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "facts-submit-success")
      .send(submissionBody)
      .expect(200);
    expect(replayed.body.data.id).toBe(commit.id);
    const counts = await databasePool.query<{ commits: string; facts: string; nodes: string }>(
      `SELECT
        (SELECT count(*) FROM canon_commits WHERE chapter_id = $1) AS commits,
        (SELECT count(*) FROM facts WHERE chapter_id = $1) AS facts,
        (SELECT count(*) FROM version_nodes WHERE object_id = $1 AND node_type = 'canon_commit') AS nodes`,
      [chapter.id],
    );
    expect(counts.rows[0]).toEqual({ commits: "1", facts: "2", nodes: "1" });
  });

  it("rejects cross-tenant chapter approval and fact submission", async () => {
    const owner = await createAuthenticatedAgent("facts-canon-owner@example.com");
    const other = await createAuthenticatedAgent("facts-canon-other@example.com");
    const work = await createWork(owner);
    const ownerToken = await csrf(owner);
    const otherToken = await csrf(other);
    const branchPath = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;
    await createCompleteBible(owner, ownerToken, branchPath);
    await createConfirmedSettings(owner, ownerToken, branchPath);
    await createModelConfig(owner, ownerToken);
    const chapter = await createReadyChapter(owner, ownerToken, branchPath);
    const started = await owner
      .post(`${branchPath}/chapters/${chapter.id}/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", ownerToken)
      .set("Idempotency-Key", "facts-canon-tenant-generation")
      .send({
        budget: {
          maxCostCny: 2.5,
          maxTokens: 12_000,
          maxRevisionRounds: 2,
        },
      })
      .expect(202);
    const job = generationJobResponseSchema.parse(started.body).data;
    await new GenerationJobProcessor(
      new WorkerGenerationRepository(),
      new FakeAiProvider(),
    ).process(await readWorkerPayload(job.id));
    const waitingChapter = chapterWorkspaceResponseSchema.parse(
      (await owner.get(`${branchPath}/chapters/${chapter.id}`).expect(200)).body,
    ).data;

    const review = await other
      .post(`${branchPath}/chapters/${chapter.id}/review`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .send({ action: "approve", version: waitingChapter.version })
      .expect(403);
    expect(review.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const submission = await other
      .post(`${branchPath}/chapters/${chapter.id}/canon/commit`)
      .set("Origin", origin)
      .set("X-CSRF-Token", otherToken)
      .set("Idempotency-Key", "facts-canon-tenant-submit")
      .send({ chapterVersionId: waitingChapter.currentVersionId })
      .expect(403);
    expect(submission.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
    const commits = await other.get(`${branchPath}/canon/commits`).expect(403);
    expect(commits.body.error.code).toBe("FORBIDDEN_TENANT_ACCESS");
  });

  async function decide(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    factProposalId: string,
    body: {
      action: "confirm" | "modify_confirm" | "reject" | "supersede";
      reason?: string;
      modified?: {
        subject?: string;
        predicate?: string;
        object?: string;
        risk?: "low" | "medium" | "high";
      };
    },
  ) {
    const response = await agent
      .post(`${branchPath}/fact-proposals/${factProposalId}/decision`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send(body)
      .expect(200);
    return factProposalResponseSchema.parse(response.body).data;
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
        displayName: "事实作者",
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
    return response.body.data as { id: string; mainBranch: { id: string } };
  }

  async function createReadyChapter(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    number = 1,
    title = "一只手也能结印",
  ): Promise<{ id: string; version: number }> {
    const response = await agent
      .post(`${branchPath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number,
        title,
        brief: {
          goal: "让沈砚在断臂后找到新的战斗方式，并让顾青第一次怀疑他。",
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["沈砚藏起断臂，被顾青撞见。", "血河宗追兵逼近，两人被迫联手。"],
          requiredFacts: ["左臂骨折，不能双手结印"],
        },
      })
      .expect(201);
    return response.body.data as { id: string; version: number };
  }

  async function saveChapterVersion(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
    chapterId: string,
    content: string,
    chapterVersion = 1,
  ): Promise<{ id: string; version: number }> {
    const response = await agent
      .post(`${branchPath}/chapters/${chapterId}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: chapterVersion, content })
      .expect(201);
    return response.body.data.version as { id: string; version: number };
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

  async function createConfirmedSettings(
    agent: SuperAgentTest,
    token: string,
    branchPath: string,
  ): Promise<void> {
    const settings = [
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
        aliases: [],
        summary: "隐藏忘川书的外门杂役。",
        description: "",
        tags: [],
        data: {
          bodyState: "左臂骨折，不能双手结印。",
          knowledgeBoundary: "不知道父母死于仇杀。",
          relationshipSummary: "与顾青互相试探。",
        },
      },
      {
        type: "golden_finger",
        name: "忘川书",
        aliases: [],
        summary: "以记忆换取前人经验。",
        description: "",
        tags: [],
        data: {
          rules: "每次只能借用一位前人的经验。",
          cost: "永久失去一段重要记忆。",
          limits: "每次使用消耗一页。",
          growth: "缺失记忆会拼成完整人格。",
        },
      },
    ] as const;
    for (const setting of settings) {
      const created = await agent
        .post(`${branchPath}/entities`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send(setting)
        .expect(201);
      await agent
        .post(`${branchPath}/entities/${created.body.data.id}/lock`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({ version: created.body.data.version })
        .expect(200);
    }
  }

  async function createModelConfig(agent: SuperAgentTest, token: string): Promise<void> {
    await agent
      .post("/api/v1/model-configs")
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        provider: "deepseek",
        label: "DeepSeek 正文",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-chat",
        apiKey: "sk-fake-facts-1234",
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
