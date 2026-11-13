import "reflect-metadata";

import { createHash, randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  GENERATE_GOLDEN_THREE_JOB,
  WORKER_QUEUE_NAME,
  generateGoldenThreeJobSchema,
  goldenThreeGenerationJobResponseSchema,
  workerJobSchema,
} from "@novel-brain/contracts";
import { Worker } from "bullmq";
import { FakeAiProvider, type AiGateway } from "@novel-brain/ai";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import { GoldenThreeRepository } from "@novel-brain/golden-three";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { WorkerGenerationRepository } from "../../worker/src/generation/generation.repository";
import { WorkerGoldenThreeContextCompiler } from "../../worker/src/golden-three/golden-three-context.compiler";
import { GoldenThreeJobProcessor } from "../../worker/src/golden-three/golden-three.processor";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const databaseUrl = dedicatedDatabaseUrl(
  process.env.TEST_DATABASE_URL ??
    "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test",
);
const redisUrl = dedicatedRedisUrl(process.env.TEST_REDIS_URL ?? "redis://localhost:6379/2");
const origin = "http://localhost:3000";

class CapturingMailGateway implements MailGateway {
  codes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.codes.set(email, code);
  }
}

describe("golden three HTTP integration", () => {
  let app: INestApplication;
  let databasePool: ReturnType<typeof createDatabasePool>;
  let redis: Redis;
  const mail = new CapturingMailGateway();

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.REDIS_URL = redisUrl;
    process.env.AUTH_SECRET = "golden-three-integration-auth-secret";
    process.env.PROXY_IP_SECRET = "golden-three-integration-proxy-secret";
    process.env.ALLOW_INSECURE_LOCAL_PROXY_IP = "true";
    process.env.APP_ORIGIN = origin;
    process.env.NODE_ENV = "test";
    process.env.MODEL_CONNECTION_TESTER = "fake";
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
    process.env.MODEL_PROVIDER_ALLOWLIST = "https://8.8.8.8/v1";

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

  async function startGoldenThreeGeneration(
    agent: SuperAgentTest,
    outlinePath: string,
    idempotencyKey: string,
    token: string,
    candidateCount: 2 | 3 = 3,
  ) {
    const response = await agent
      .post(`${outlinePath}/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", idempotencyKey)
      .send({ candidateCount });
    if (response.status !== 202) {
      throw new Error(`Golden three generation failed: ${response.status} ${response.text}`);
    }
    return goldenThreeGenerationJobResponseSchema.parse(response.body).data;
  }

  async function runGoldenThreeWorker(
    jobId: string,
    options: {
      stepHook?: (stepKey: string) => void | Promise<void>;
      forbidContextCompile?: boolean;
    } = {},
  ) {
    const result = await databasePool.query<{
      user_id: string;
      work_id: string;
      branch_id: string;
      chapter_id: string;
      model_config_id: string;
      idempotency_key: string;
      orchestration: Record<string, unknown>;
      budget: Record<string, unknown>;
      checkpoint: Record<string, unknown>;
    }>(
      `SELECT user_id, work_id, branch_id, chapter_id, model_config_id,
              idempotency_key, orchestration, budget, checkpoint
         FROM jobs WHERE id = $1`,
      [jobId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("Golden three job was not persisted");
    }
    const payload = generateGoldenThreeJobSchema.parse({
      jobId,
      jobType: "generate_golden_three",
      workId: row.work_id,
      branchId: row.branch_id,
      chapterId: row.chapter_id,
      actorId: row.user_id,
      modelConfigId: row.model_config_id,
      idempotencyKey: row.idempotency_key,
      candidateCount: row.orchestration.candidateCount,
      budget: row.budget,
      checkpoint: row.checkpoint,
    });
    const generationRepository = new WorkerGenerationRepository();
    const contextCompiler = new WorkerGoldenThreeContextCompiler(generationRepository);
    const repository = new GoldenThreeRepository(
      options.forbidContextCompile
        ? {
            compile() {
              throw new Error("Golden three resume must reuse the saved ContextPack");
            },
          }
        : contextCompiler,
      { create: () => goldenThreeTestProvider() },
      options.stepHook,
    );
    try {
      await new GoldenThreeJobProcessor(repository).process(payload);
    } finally {
      await generationRepository.onModuleDestroy();
      await repository.onModuleDestroy();
    }
  }

  async function runGoldenThreeQueue(jobId: string, options: { failFirstAfterStep?: string } = {}) {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const worker = new Worker(
      WORKER_QUEUE_NAME,
      async (job) => {
        const payload = workerJobSchema.parse(job.data);
        if (payload.jobType !== GENERATE_GOLDEN_THREE_JOB || payload.jobId !== jobId) {
          throw new Error("Unexpected job delivered to golden-three queue test");
        }
        const generationRepository = new WorkerGenerationRepository();
        const repository = new GoldenThreeRepository(
          new WorkerGoldenThreeContextCompiler(generationRepository),
          { create: () => goldenThreeTestProvider() },
          options.failFirstAfterStep && job.attemptsMade === 0
            ? (stepKey) => {
                if (stepKey.endsWith(options.failFirstAfterStep!)) {
                  throw new Error("simulated worker crash");
                }
              }
            : undefined,
        );
        try {
          await new GoldenThreeJobProcessor(repository).process(payload);
        } finally {
          await generationRepository.onModuleDestroy();
          await repository.onModuleDestroy();
        }
      },
      { connection, concurrency: 1 },
    );
    try {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await databasePool.query<{ status: string }>(
          "SELECT status FROM jobs WHERE id = $1",
          [jobId],
        );
        if (["completed", "failed", "cancelled"].includes(result.rows[0]?.status ?? "")) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error("Golden three queue worker did not reach a terminal state");
    } finally {
      await worker.close();
      if (connection.status === "ready") {
        await connection.quit();
      } else {
        connection.disconnect();
      }
    }
  }

  function goldenThreeTestProvider(): AiGateway {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Fake model provider is not allowed in production");
    }
    const failOnCall = Number(process.env.GOLDEN_THREE_FAKE_FAILURE_AT ?? "");
    const usageMultiplier = Number(process.env.GOLDEN_THREE_FAKE_USAGE_MULTIPLIER ?? "1");
    const delayMs = Number(process.env.GOLDEN_THREE_FAKE_DELAY_MS ?? "0");
    const emptyOnCall = Number(process.env.GOLDEN_THREE_FAKE_EMPTY_AT ?? "");
    return new FakeAiProvider({
      failOperations:
        process.env.GOLDEN_THREE_FAKE_FAILURE === "1" ||
        (Number.isInteger(failOnCall) && failOnCall > 0)
          ? ["draft"]
          : [],
      ...(Number.isInteger(failOnCall) && failOnCall > 0 ? { failOnCall } : {}),
      ...(Number.isFinite(usageMultiplier) && usageMultiplier > 0 ? { usageMultiplier } : {}),
      ...(Number.isFinite(delayMs) && delayMs > 0 ? { delayMs } : {}),
      ...(Number.isInteger(emptyOnCall) && emptyOnCall > 0 ? { emptyOnCall } : {}),
    });
  }

  async function generationJob(agent: SuperAgentTest, outlinePath: string, jobId: string) {
    const response = await agent.get(`${outlinePath}/generation/${jobId}`).expect(200);
    return goldenThreeGenerationJobResponseSchema.parse(response.body).data;
  }

  afterAll(async () => {
    await app?.close();
    await databasePool?.end();
    redis?.disconnect();
  });

  it("creates a two-candidate batch without changing the existing chapter versions", async () => {
    const owner = await createAuthenticatedAgent("golden-three-candidates@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const outlinePath = `${basePath}/golden-three`;

    const empty = await owner.get(outlinePath).expect(200);
    expect(empty.body.data).toMatchObject({
      candidates: [],
      selectedCandidateId: null,
      lock: null,
      styleBaseline: null,
      gate: {
        candidateId: null,
        canLock: false,
        blockers: [expect.objectContaining({ code: "NO_CANDIDATES" })],
      },
    });

    const createdResponse = await owner
      .post(`${outlinePath}/candidates`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-batch-1")
      .send({
        candidates: [
          candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "F"),
          candidateInput("候选 B · 人物优先", "character_focus", chapters, "A"),
        ],
      });
    expect(createdResponse.status, JSON.stringify(createdResponse.body)).toBe(201);
    const created = createdResponse;

    expect(created.body.data.candidates).toHaveLength(2);
    expect(created.body.data.candidates[0]).toMatchObject({
      label: "候选 A · 钩子优先",
      status: "draft",
      prompt: { key: "golden-three-opening", version: 3 },
      model: { provider: "deepseek", model: "deepseek-chat" },
      context: { packVersionId: null, manifestHash: "c".repeat(64) },
      reviewSummary: { completed: 0, total: 6, requiredFailed: 0 },
    });
    expect(created.body.data.candidates[0].pins).toHaveLength(1);
    expect(created.body.data.candidates[0].pins[0]).toMatchObject({
      chapterNumber: 1,
      chapterVersion: 1,
      content: chapters[0]!.content,
    });

    const persisted = (await owner.get(outlinePath).expect(200)).body.data;
    expect(persisted.candidates).toHaveLength(2);
    expect(persisted.gate).toMatchObject({
      canLock: false,
      blockers: [expect.objectContaining({ code: "NO_SELECTION" })],
    });

    const chapterOne = (await owner.get(`${basePath}/chapters/${chapters[0]!.id}`).expect(200)).body
      .data;
    expect(chapterOne.currentVersionId).toBe(chapters[0]!.versionId);
    expect(chapterOne.status).toBe("writing");

    const repeated = await owner
      .post(`${outlinePath}/candidates`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-batch-1")
      .send({
        candidates: [
          candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
          candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
        ],
      })
      .expect(201);
    expect(repeated.body.data.candidates.map((entry: { id: string }) => entry.id)).toEqual(
      created.body.data.candidates.map((entry: { id: string }) => entry.id),
    );
  });

  it("records six evidence reviews, blocks failed dimensions, and locks with an audited override", async () => {
    const owner = await createAuthenticatedAgent("golden-three-lock@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const outlinePath = `${basePath}/golden-three`;
    const batch = (
      await owner
        .post(`${outlinePath}/candidates`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "golden-three-lock-batch")
        .send({
          candidates: [
            candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
            candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
          ],
        })
        .expect(201)
    ).body.data;
    const candidate = batch.candidates[0] as {
      id: string;
      version: number;
      pins: Array<{ chapterId: string; chapterVersionId: string; content: string }>;
    };

    const reviewResponse = await owner
      .put(`${outlinePath}/candidates/${candidate.id}/reviews`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: candidate.version,
        reviews: [
          "opening_hook",
          "protagonist_appeal",
          "world_rules",
          "core_conflict",
          "reader_promise",
          "chapter_end_hook",
        ].map((dimension, index) => {
          const pin = candidate.pins[index % candidate.pins.length]!;
          return {
            dimension,
            score: dimension === "world_rules" ? 3 : 4,
            evidence: {
              chapterId: pin.chapterId,
              chapterVersionId: pin.chapterVersionId,
              passage: pin.content,
              locator: `第 ${index + 1} 章 · 首句`,
            },
            reviewerOrigin: "model",
          };
        }),
      })
      .expect(200);
    const reviewed = reviewResponse.body.data.candidates[0];
    expect(reviewed).toMatchObject({
      status: "reviewed",
      version: 2,
      reviewSummary: {
        completed: 6,
        requiredFailed: 1,
        failedDimensions: ["world_rules"],
      },
    });

    const selected = await owner
      .post(`${outlinePath}/candidates/${candidate.id}/select`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: reviewed.version })
      .expect(200);
    expect(selected.body.data.selectedCandidateId).toBe(candidate.id);
    expect(
      selected.body.data.candidates.find((entry: { id: string }) => entry.id === candidate.id),
    ).toMatchObject({ status: "selected", version: 3 });
    const selectionNode = await databasePool.query<{ id: string }>(
      `SELECT id
         FROM version_nodes
        WHERE object_id = $1
          AND object_type = 'golden_three_candidate'
          AND payload->>'action' = 'golden_three.candidate_selected'
        ORDER BY created_at DESC
        LIMIT 1`,
      [candidate.id],
    );
    expect(selectionNode.rows[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );

    const blocked = await owner
      .post(`${outlinePath}/candidates/${candidate.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 3 })
      .expect(409);
    expect(blocked.body.error).toMatchObject({
      code: "GOLDEN_THREE_REVIEW_FAILED",
      details: { failedDimensions: ["world_rules"] },
    });

    const continued = await owner
      .post(`${outlinePath}/candidates/${candidate.id}/continuation`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 3 })
      .expect(200);
    const continuedCandidate = continued.body.data.candidates.find(
      (entry: { id: string }) => entry.id === candidate.id,
    );
    expect(continuedCandidate).toMatchObject({ status: "selected", version: 4 });
    expect(
      continuedCandidate.continuation.pins.map(
        (pin: { chapterNumber: number }) => pin.chapterNumber,
      ),
    ).toEqual([2, 3]);
    expect(continuedCandidate.continuation.styleSource).toMatchObject({
      candidateId: candidate.id,
      strategy: "hook_focus",
      candidateLabel: "候选 A · 钩子优先",
      chapterId: candidate.pins[0]!.chapterId,
      chapterVersionId: candidate.pins[0]!.chapterVersionId,
      chapterVersionNodeId: candidate.pins[0]!.versionNodeId,
      chapterTitle: candidate.pins[0]!.chapterTitle,
      contentHash: candidate.pins[0]!.contentHash,
      excerpt: candidate.pins[0]!.content,
    });
    const continuationSource = await databasePool.query<{
      selection_node_id: string;
      style_source: Record<string, unknown>;
    }>(
      `SELECT payload->'styleSource'->>'selectionVersionNodeId' AS selection_node_id,
              payload->'styleSource' AS style_source
         FROM version_nodes
        WHERE object_id = $1 AND object_type = 'golden_three_continuation'
        ORDER BY created_at DESC
        LIMIT 1`,
      [candidate.id],
    );
    expect(continuationSource.rows[0]?.selection_node_id).toBe(selectionNode.rows[0]?.id);
    expect(continuationSource.rows[0]?.style_source).toMatchObject({
      candidateId: candidate.id,
      chapterId: candidate.pins[0]!.chapterId,
      chapterVersionId: candidate.pins[0]!.chapterVersionId,
    });

    const locked = await owner
      .post(`${outlinePath}/candidates/${candidate.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: 4,
        override: {
          policy: "author_override_v1",
          rationale: "作者已复核开篇方向，接受世界规则展示暂低于标准，后续在第二章补足。",
        },
      })
      .expect(200);
    const lockedWorkspace = locked.body.data;
    expect(lockedWorkspace).toMatchObject({
      selectedCandidateId: candidate.id,
      lock: {
        candidateId: candidate.id,
        override: {
          policy: "author_override_v1",
          rationale: "作者已复核开篇方向，接受世界规则展示暂低于标准，后续在第二章补足。",
        },
      },
      styleBaseline: {
        sourceType: "golden_three",
        sourceId: lockedWorkspace.lock.id,
        profile: {
          strategy: "hook_focus",
          candidateLabel: "候选 A · 钩子优先",
        },
      },
      gate: {
        candidateId: candidate.id,
        canLock: false,
        blockers: [expect.objectContaining({ code: "CANDIDATE_LOCKED" })],
      },
    });
    expect(lockedWorkspace.lock.chapterPins).toHaveLength(3);
    expect(lockedWorkspace.styleBaseline.profile.excerpts).toHaveLength(3);
    expect(lockedWorkspace.styleBaseline.versionNodeId).toBe(lockedWorkspace.lock.versionNodeId);

    for (const chapter of chapters) {
      const stored = (await owner.get(`${basePath}/chapters/${chapter.id}`).expect(200)).body.data;
      expect(stored).toMatchObject({
        status: "locked",
        currentVersionId: chapter.versionId,
      });
    }
    const versions = await databasePool.query<{
      node_type: string;
      object_type: string;
      action: string | null;
    }>(
      `SELECT node_type, object_type, payload->>'action' AS action
       FROM version_nodes
       WHERE object_id = $1 OR payload->>'candidateId' = $1::text
       ORDER BY created_at`,
      [candidate.id],
    );
    expect(versions.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          node_type: "outline_version",
          object_type: "golden_three_review",
          action: "golden_three.reviews_recorded",
        }),
        expect.objectContaining({
          node_type: "outline_version",
          object_type: "golden_three_candidate",
          action: "golden_three.candidate_selected",
        }),
        expect.objectContaining({
          node_type: "outline_version",
          object_type: "golden_three_continuation",
          action: "golden_three.continuation_recorded",
        }),
        expect.objectContaining({
          node_type: "snapshot",
          object_type: "golden_three_lock",
          action: "golden_three.locked",
        }),
      ]),
    );
    const audits = await databasePool.query<{ action: string }>(
      `SELECT action FROM audit_logs
       WHERE target_id = $1 OR target_id = $2
       ORDER BY created_at`,
      [candidate.id, lockedWorkspace.lock.id],
    );
    expect(audits.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "golden_three.reviews_recorded",
        "golden_three.candidate_selected",
        "golden_three.continuation_recorded",
        "golden_three.locked",
      ]),
    );
  });

  it("requires a selected candidate continuation before locking", async () => {
    const owner = await createAuthenticatedAgent("golden-three-continuation-required@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const outlinePath = `${basePath}/golden-three`;
    const batch = await owner
      .post(`${outlinePath}/candidates`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-continuation-required")
      .send({
        candidates: [
          candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
          candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
        ],
      })
      .expect(201);
    const candidate = batch.body.data.candidates[0] as {
      id: string;
      version: number;
      pins: Array<{
        chapterId: string;
        chapterVersionId: string;
        content: string;
      }>;
    };
    const reviewed = await owner
      .put(`${outlinePath}/candidates/${candidate.id}/reviews`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: candidate.version,
        reviews: [
          "opening_hook",
          "protagonist_appeal",
          "world_rules",
          "core_conflict",
          "reader_promise",
          "chapter_end_hook",
        ].map((dimension, index) => ({
          dimension,
          score: 4,
          evidence: {
            chapterId: candidate.pins[0]!.chapterId,
            chapterVersionId: candidate.pins[0]!.chapterVersionId,
            passage: candidate.pins[0]!.content,
            locator: `第 1 章 · 证据 ${index + 1}`,
          },
          reviewerOrigin: "model",
        })),
      })
      .expect(200);
    await owner
      .post(`${outlinePath}/candidates/${candidate.id}/select`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: reviewed.body.data.candidates[0].version })
      .expect(200);
    const continuationPins = await databasePool.query<{
      chapter_id: string;
      chapter_number: number;
      chapter_title: string;
      chapter_version_id: string;
      chapter_version: number;
      version_node_id: string;
      content_hash: string;
      content: string;
    }>(
      `SELECT chapter.id AS chapter_id,
              chapter.number AS chapter_number,
              chapter.title AS chapter_title,
              version.id AS chapter_version_id,
              version.version AS chapter_version,
              version.version_node_id,
              version.content_hash,
              version.content
         FROM chapters chapter
         JOIN chapter_versions version ON version.id = chapter.current_version_id
        WHERE chapter.branch_id = $1 AND chapter.number IN (2, 3)
        ORDER BY chapter.number`,
      [work.mainBranch.id],
    );
    const legacyContinuationPin = continuationPins.rows.map((pin) => ({
      chapterId: pin.chapter_id,
      chapterNumber: pin.chapter_number,
      chapterTitle: pin.chapter_title,
      chapterVersionId: pin.chapter_version_id,
      chapterVersion: pin.chapter_version,
      versionNodeId: pin.version_node_id,
      contentHash: pin.content_hash,
      wordCount: Array.from(pin.content).length,
      content: pin.content,
    }));
    const legacyContinuationNodeId = uuidv7();
    await databasePool.query(
      `INSERT INTO version_nodes (
         id, work_id, branch_id, user_id, parent_node_id, node_type, object_type,
         object_id, object_version, payload, actor_id, message, created_at
       )
       SELECT $1, candidate.work_id, candidate.branch_id, candidate.user_id,
              branch.head_node_id, 'outline_version', 'golden_three_continuation',
              candidate.id, candidate.version + 1, $3::jsonb,
              candidate.user_id, '历史续写缺少来源引用', now()
         FROM golden_three_candidates candidate
         JOIN work_branches branch ON branch.id = candidate.branch_id
        WHERE candidate.id = $2`,
      [
        legacyContinuationNodeId,
        candidate.id,
        JSON.stringify({
          action: "golden_three.continuation_recorded",
          candidateId: candidate.id,
          pins: legacyContinuationPin,
        }),
      ],
    );
    await databasePool.query(
      `UPDATE work_branches SET head_node_id = $1, updated_at = now() WHERE id = $2`,
      [legacyContinuationNodeId, work.mainBranch.id],
    );
    await databasePool.query(
      `UPDATE golden_three_candidates
          SET version = version + 1, updated_at = now()
        WHERE id = $1`,
      [candidate.id],
    );
    const lock = await owner
      .post(`${outlinePath}/candidates/${candidate.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: reviewed.body.data.candidates[0].version + 2 })
      .expect(409);
    expect(lock.body.error.code).toBe("GOLDEN_THREE_CONTINUATION_REQUIRED");
    const workspace = await owner.get(outlinePath).expect(200);
    expect(workspace.body.data.gate).toMatchObject({
      candidateId: candidate.id,
      canLock: false,
      blockers: [expect.objectContaining({ code: "CONTINUATION_REQUIRED" })],
    });
  });

  it("generates draft first-chapter candidates with provenance without changing current versions", async () => {
    const owner = await createAuthenticatedAgent("golden-three-generate@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const outlinePath = `${basePath}/golden-three`;
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    const queued = await startGoldenThreeGeneration(
      owner,
      outlinePath,
      "golden-three-generate-1",
      token,
    );
    expect(queued.status).toBe("queued");
    expect((await owner.get(outlinePath).expect(200)).body.data.activeGenerationJob).toMatchObject({
      id: queued.id,
      status: "queued",
    });
    const beforeWorker = await databasePool.query<{ candidates: string; model_calls: string }>(
      `SELECT
         (SELECT count(*) FROM golden_three_candidates WHERE generation_job_id = $1) AS candidates,
         (SELECT count(*) FROM model_calls WHERE job_id = $1) AS model_calls`,
      [queued.id],
    );
    expect(beforeWorker.rows[0]).toEqual({ candidates: "0", model_calls: "0" });
    await runGoldenThreeWorker(queued.id);
    const resumedJob = await generationJob(owner, outlinePath, queued.id);
    expect(resumedJob).toMatchObject({
      status: "completed",
      progress: 100,
    });
    const workspace = (await owner.get(outlinePath).expect(200)).body.data;
    expect(workspace.candidates).toHaveLength(3);
    expect(
      workspace.candidates.map((candidate: { strategy: string }) => candidate.strategy),
    ).toEqual(["hook_focus", "character_focus", "world_focus"]);
    for (const [index, candidate] of workspace.candidates.entries()) {
      expect(candidate.status).toBe("draft");
      expect(candidate.reviews).toEqual([]);
      expect(candidate.reviewSummary).toMatchObject({ completed: 0, requiredFailed: 0 });
      expect(candidate.prompt).toMatchObject({ key: "golden-three-opening", version: 1 });
      expect(candidate.model).toMatchObject({
        provider: "fake",
        model: "deepseek-chat",
      });
      expect(candidate.context.manifestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(candidate.trace).toMatchObject({
        jobId: expect.any(String),
        agentRunId: expect.any(String),
        modelCallId: expect.any(String),
      });
      expect(candidate.pins.map((pin: { chapterNumber: number }) => pin.chapterNumber)).toEqual([
        1,
      ]);
      expect(candidate.pins[0].chapterVersion).toBe(index + 2);
    }

    for (const chapter of chapters) {
      const stored = (await owner.get(`${basePath}/chapters/${chapter.id}`).expect(200)).body.data;
      expect(stored.currentVersionId).toBe(chapter.versionId);
    }
    const versionCount = await databasePool.query<{ count: string }>(
      `SELECT count(*) FROM chapter_versions WHERE chapter_id = ANY($1::uuid[])`,
      [chapters.map((chapter) => chapter.id)],
    );
    expect(versionCount.rows[0]?.count).toBe("6");

    const jobId = workspace.candidates[0].trace.jobId as string;
    const provenance = await databasePool.query<{
      context_packs: string;
      prompts: string;
      agent_runs: string;
      model_calls: string;
      usage_records: string;
      reservations: string;
      job_steps: string;
      job_step_attempts: string;
      checkpoints: string;
      events: string;
      providers: string[];
      max_tokens: number;
      context_tokens: number;
    }>(
      `SELECT
         (SELECT count(*) FROM context_pack_versions WHERE job_id = $1) AS context_packs,
         (SELECT count(*) FROM prompt_versions WHERE job_id = $1) AS prompts,
         (SELECT count(*) FROM agent_runs WHERE job_id = $1) AS agent_runs,
         (SELECT count(*) FROM model_calls WHERE job_id = $1) AS model_calls,
         (SELECT count(*) FROM usage_records WHERE job_id = $1) AS usage_records,
         (SELECT count(*) FROM cost_reservations WHERE job_id = $1) AS reservations,
         (SELECT count(*) FROM job_steps WHERE job_id = $1) AS job_steps,
         (SELECT count(*) FROM job_step_attempts WHERE job_id = $1) AS job_step_attempts,
         (SELECT count(*) FROM job_checkpoints WHERE job_id = $1) AS checkpoints,
         (SELECT count(*) FROM job_events WHERE job_id = $1) AS events,
         (SELECT array_agg(DISTINCT provider) FROM model_calls WHERE job_id = $1) AS providers,
         (SELECT (budget->>'maxTokens')::int FROM jobs WHERE id = $1) AS max_tokens,
         (SELECT token_used FROM context_pack_versions WHERE job_id = $1) AS context_tokens`,
      [jobId],
    );
    expect(provenance.rows[0]).toMatchObject({
      context_packs: "1",
      prompts: "3",
      agent_runs: "3",
      model_calls: "3",
      usage_records: "3",
      reservations: "3",
      job_steps: "3",
      job_step_attempts: "3",
      checkpoints: "5",
      events: "4",
      providers: ["fake"],
    });
    expect(provenance.rows[0]?.max_tokens).toBe(
      Number(provenance.rows[0]?.context_tokens) * 3 + 1_600 * 3,
    );
    const reservations = await databasePool.query<{
      reserved_tokens: number;
      settled_tokens: number;
    }>(
      `SELECT reserved_tokens, settled_tokens
         FROM cost_reservations
        WHERE job_id = $1
        ORDER BY idempotency_key`,
      [jobId],
    );
    expect(reservations.rows).toHaveLength(3);
    for (const reservation of reservations.rows) {
      expect(reservation.reserved_tokens).toBe(Number(provenance.rows[0]?.context_tokens) + 1_600);
      expect(reservation.settled_tokens).toBeGreaterThan(0);
    }

    const repeated = await startGoldenThreeGeneration(
      owner,
      outlinePath,
      "golden-three-generate-1",
      token,
    );
    expect(repeated.id).toBe(queued.id);
    expect(repeated.status).toBe("completed");

    const differentKey = await owner
      .post(`${outlinePath}/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-generate-2")
      .send({ candidateCount: 3 })
      .expect(409);
    expect(differentKey.body.error.code).toBe("GOLDEN_THREE_CANDIDATES_EXIST");
  });

  it("resumes a worker interruption from the last successful candidate checkpoint", async () => {
    const owner = await createAuthenticatedAgent("golden-three-resume@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const outlinePath = `${basePath}/golden-three`;
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    const queued = await startGoldenThreeGeneration(
      owner,
      outlinePath,
      "golden-three-resume-checkpoint",
      token,
    );
    await expect(
      runGoldenThreeWorker(queued.id, {
        stepHook: (stepKey) => {
          if (stepKey.endsWith("hook_focus")) {
            throw new Error("simulated worker crash");
          }
        },
      }),
    ).rejects.toThrow("simulated worker crash");

    const interrupted = await databasePool.query<{
      status: string;
      succeeded_steps: string;
      model_calls: string;
      usage_records: string;
    }>(
      `SELECT job.status,
              (SELECT count(*) FROM job_steps
                WHERE job_id = job.id AND status = 'succeeded') AS succeeded_steps,
              (SELECT count(*) FROM model_calls WHERE job_id = job.id) AS model_calls,
              (SELECT count(*) FROM usage_records WHERE job_id = job.id) AS usage_records
         FROM jobs job
        WHERE job.id = $1`,
      [queued.id],
    );
    expect(interrupted.rows[0]).toEqual({
      status: "running",
      succeeded_steps: "1",
      model_calls: "3",
      usage_records: "1",
    });

    await runGoldenThreeWorker(queued.id, { forbidContextCompile: true });
    const resumedJob = await generationJob(owner, outlinePath, queued.id);
    expect(resumedJob).toMatchObject({
      status: "completed",
      progress: 100,
    });
    expect((await owner.get(outlinePath).expect(200)).body.data.candidates).toHaveLength(3);
    const resumed = await databasePool.query<{
      model_calls: string;
      usage_records: string;
      succeeded_steps: string;
      failed_steps: string;
    }>(
      `SELECT
         (SELECT count(*) FROM model_calls WHERE job_id = $1) AS model_calls,
         (SELECT count(*) FROM usage_records WHERE job_id = $1) AS usage_records,
         (SELECT count(*) FROM job_steps WHERE job_id = $1 AND status = 'succeeded')
           AS succeeded_steps,
         (SELECT count(*) FROM job_steps WHERE job_id = $1 AND status = 'failed')
           AS failed_steps`,
      [queued.id],
    );
    expect(resumed.rows[0]).toEqual({
      model_calls: "3",
      usage_records: "3",
      succeeded_steps: "3",
      failed_steps: "0",
    });
  });

  it("resumes a real BullMQ redelivery from the database checkpoint", async () => {
    const owner = await createAuthenticatedAgent("golden-three-bullmq-resume@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const outlinePath = `${basePath}/golden-three`;
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    const queued = await startGoldenThreeGeneration(
      owner,
      outlinePath,
      "golden-three-bullmq-resume",
      token,
    );
    await runGoldenThreeQueue(queued.id, { failFirstAfterStep: "hook_focus" });

    expect(await generationJob(owner, outlinePath, queued.id)).toMatchObject({
      status: "completed",
      progress: 100,
    });
    expect((await owner.get(outlinePath).expect(200)).body.data.candidates).toHaveLength(3);
    const result = await databasePool.query<{
      model_calls: string;
      usage_records: string;
      succeeded_steps: string;
    }>(
      `SELECT
         (SELECT count(*) FROM model_calls WHERE job_id = $1) AS model_calls,
         (SELECT count(*) FROM usage_records WHERE job_id = $1) AS usage_records,
         (SELECT count(*) FROM job_steps WHERE job_id = $1 AND status = 'succeeded')
           AS succeeded_steps`,
      [queued.id],
    );
    expect(result.rows[0]).toEqual({
      model_calls: "3",
      usage_records: "3",
      succeeded_steps: "3",
    });
  });

  it("reads historical completed golden-three jobs without a second state machine", async () => {
    const email = "golden-three-history@example.com";
    const owner = await createAuthenticatedAgent(email);
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const outlinePath = `${basePath}/golden-three`;
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const batch = await owner
      .post(`${outlinePath}/candidates`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-history-candidates")
      .send({
        candidates: [
          candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
          candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
        ],
      })
      .expect(201);
    const batchId = batch.body.data.candidates[0].batchId as string;
    const legacyJobId = uuidv7();
    await databasePool.query(
      `INSERT INTO jobs (
         id, work_id, branch_id, user_id, type, status, progress, current_step,
         idempotency_key, golden_three_generation_key, budget, checkpoint, cost,
         orchestration, started_at, finished_at, created_at, updated_at
       )
       SELECT $1, $2, $3, users.id, 'agent_workflow', 'completed', 100, 'completed',
              'golden-three-history-job', 'golden-three-history-job',
              '{"maxTokens":30000,"maxCostCny":0.2,"maxRevisionRounds":0}'::jsonb,
              jsonb_build_object('batchId', $5::text, 'stage', 'completed'),
              '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"costCny":0}'::jsonb,
              '{"kind":"golden_three_generation","candidateCount":2}'::jsonb,
              now(), now(), now(), now()
         FROM users
        WHERE users.email = $4`,
      [legacyJobId, work.id, work.mainBranch.id, email, batchId],
    );

    const workspace = (await owner.get(outlinePath).expect(200)).body.data;
    expect(workspace.candidates).toHaveLength(2);
    expect(workspace.activeGenerationJob).toBeNull();
    const jobs = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM jobs
        WHERE work_id = $1 AND branch_id = $2 AND golden_three_generation_key IS NOT NULL`,
      [work.id, work.mainBranch.id],
    );
    expect(jobs.rows[0]?.count).toBe("1");
  });

  it("returns a recoverable empty-chapter error before creating candidates", async () => {
    const owner = await createAuthenticatedAgent("golden-three-empty@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const outlinePath = `${basePath}/golden-three`;
    for (let number = 1; number <= 3; number += 1) {
      await owner
        .post(`${basePath}/chapters`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .send({
          number,
          title: `第 ${number} 章`,
          brief: {
            goal: `推进第 ${number} 章。`,
            pov: "沈砚",
            location: "荒寺",
            sceneBeats: ["行动"],
            requiredFacts: ["沈砚不能暴露忘川书"],
          },
        })
        .expect(201);
    }
    const empty = await owner
      .post(`${outlinePath}/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-empty-1")
      .send({ candidateCount: 3 })
      .expect(409);
    expect(empty.body.error).toMatchObject({
      code: "GOLDEN_THREE_CHAPTERS_EMPTY",
      details: { chapterNumbers: [1], retryable: true },
    });
    expect((await owner.get(outlinePath).expect(200)).body.data.candidates).toHaveLength(0);
  });

  it("blocks generation without an author writing model", async () => {
    const owner = await createAuthenticatedAgent("golden-three-no-model@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);

    const response = await owner
      .post(`${basePath}/golden-three/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-no-model")
      .send({ candidateCount: 3 })
      .expect(409);
    expect(response.body.error.code).toBe("GOLDEN_THREE_MODEL_REQUIRED");
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
    ).toHaveLength(0);
  });

  it("fails before writing provenance when a deterministic fake is selected in production", async () => {
    const owner = await createAuthenticatedAgent("golden-three-production-fake@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    process.env.NODE_ENV = "production";
    try {
      const queued = await startGoldenThreeGeneration(
        owner,
        `${basePath}/golden-three`,
        "golden-three-production-fake",
        token,
      );
      await runGoldenThreeWorker(queued.id);
      expect(await generationJob(owner, `${basePath}/golden-three`, queued.id)).toMatchObject({
        status: "failed",
        error: { code: "GOLDEN_THREE_GENERATION_FAILED" },
      });
      process.env.NODE_ENV = "test";
      const repeated = await owner
        .post(`${basePath}/golden-three/candidates/generate`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "golden-three-production-fake")
        .send({ candidateCount: 3 })
        .expect(502);
      expect(repeated.body.error).toMatchObject({
        code: "GOLDEN_THREE_GENERATION_FAILED",
        details: { failureClass: "provider", retryable: true },
      });
    } finally {
      process.env.NODE_ENV = "test";
    }
    const jobs = await databasePool.query<{
      count: string;
      status: string;
      model_calls: string;
    }>(
      `SELECT count(*)::text AS count,
              (SELECT status FROM jobs WHERE idempotency_key = $1 LIMIT 1) AS status,
              (SELECT count(*)::text
                 FROM model_calls
                WHERE job_id = (SELECT id FROM jobs WHERE idempotency_key = $1 LIMIT 1))
                AS model_calls
         FROM jobs
        WHERE idempotency_key = $1`,
      ["golden-three-production-fake"],
    );
    expect(jobs.rows[0]).toMatchObject({
      count: "1",
      status: "failed",
      model_calls: "0",
    });
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
    ).toHaveLength(0);
  });

  it("blocks a second golden-three generation while another run is active", async () => {
    const email = "golden-three-concurrent@example.com";
    const owner = await createAuthenticatedAgent(email);
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);
    await databasePool.query(
      `INSERT INTO jobs (
         id, work_id, branch_id, user_id, type, status, progress, current_step,
         idempotency_key, budget, checkpoint, cost, orchestration, started_at, created_at, updated_at
       )
       SELECT $1, $2, $3, users.id, 'agent_workflow', 'running', 5, 'generating_candidates',
              'golden-three-active-run', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb,
              '{"kind":"golden_three_generation"}'::jsonb, now(), now(), now()
         FROM users
        WHERE users.email = $4`,
      [uuidv7(), work.id, work.mainBranch.id, email],
    );
    const response = await owner
      .post(`${basePath}/golden-three/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-second-run")
      .send({ candidateCount: 3 })
      .expect(409);
    expect(response.body.error).toMatchObject({
      code: "GOLDEN_THREE_GENERATION_IN_PROGRESS",
      details: { retryable: true },
    });
    const manual = await owner
      .post(`${basePath}/golden-three/candidates`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-manual-during-generation")
      .send({
        candidates: [
          candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
          candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
        ],
      })
      .expect(409);
    expect(manual.body.error.code).toBe("GOLDEN_THREE_GENERATION_IN_PROGRESS");
  });

  it("serializes concurrent generation attempts with different idempotency keys", async () => {
    const owner = await createAuthenticatedAgent("golden-three-concurrent-race@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    process.env.GOLDEN_THREE_FAKE_DELAY_MS = "100";
    try {
      const generate = (key: string) =>
        owner
          .post(`${basePath}/golden-three/candidates/generate`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", key)
          .send({ candidateCount: 3 });
      const responses = await Promise.all([
        generate("golden-three-race-a"),
        generate("golden-three-race-b"),
      ]);
      expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
      const blocked = responses.find((response) => response.status === 409);
      expect(blocked?.body.error).toMatchObject({
        code: "GOLDEN_THREE_GENERATION_IN_PROGRESS",
        details: { retryable: true },
      });
    } finally {
      delete process.env.GOLDEN_THREE_FAKE_DELAY_MS;
    }
    const jobs = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM jobs
        WHERE idempotency_key IN ('golden-three-race-a', 'golden-three-race-b')`,
    );
    expect(jobs.rows[0]?.count).toBe("1");
  });

  it("expires a stale running job so generation can recover", async () => {
    const email = "golden-three-stale-recovery@example.com";
    const owner = await createAuthenticatedAgent(email);
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);
    const staleJobId = uuidv7();
    await databasePool.query(
      `INSERT INTO jobs (
         id, work_id, branch_id, user_id, type, status, progress, current_step,
         idempotency_key, golden_three_generation_key, budget, checkpoint, cost,
         orchestration, started_at, created_at, updated_at
       )
       SELECT $1, $2, $3, users.id, 'agent_workflow', 'running', 5, 'generating_candidates',
              'golden-three-stale-run', 'golden-three-stale-run', '{}'::jsonb, '{}'::jsonb,
              '{}'::jsonb, '{"kind":"golden_three_generation"}'::jsonb,
              now() - interval '30 minutes', now(), now()
         FROM users
        WHERE users.email = $4`,
      [staleJobId, work.id, work.mainBranch.id, email],
    );
    process.env.GOLDEN_THREE_STALE_JOB_MS = "1000";
    try {
      await owner
        .post(`${basePath}/golden-three/candidates/generate`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "golden-three-after-stale")
        .send({ candidateCount: 3 })
        .expect(202);
    } finally {
      delete process.env.GOLDEN_THREE_STALE_JOB_MS;
    }
    const stale = await databasePool.query<{
      status: string;
      failure_class: string;
      checkpoint_count: string;
      event_count: string;
    }>(
      `SELECT job.status,
              job.checkpoint->>'failureClass' AS failure_class,
              (SELECT count(*) FROM job_checkpoints WHERE job_id = job.id) AS checkpoint_count,
              (SELECT count(*) FROM job_events WHERE job_id = job.id) AS event_count
         FROM jobs job
        WHERE job.id = $1`,
      [staleJobId],
    );
    expect(stale.rows[0]).toEqual({
      status: "failed",
      failure_class: "timeout",
      checkpoint_count: "1",
      event_count: "1",
    });
  });

  it.each([
    { label: "success", env: {} },
    { label: "schema", env: { GOLDEN_THREE_FAKE_EMPTY_AT: "1" } },
    { label: "budget", env: { GOLDEN_THREE_FAKE_USAGE_MULTIPLIER: "100" } },
  ])(
    "records actual usage when the lease is lost during $label handling",
    async ({ label, env }) => {
      const owner = await createAuthenticatedAgent(`golden-three-lease-${label}@example.com`);
      const work = await createWork(owner);
      const token = await csrf(owner);
      const basePath = branchPathOf(work);
      await createGoldenThreeChapters(owner, token, basePath);
      await createModelConfig(owner, token);
      await createGoldenThreeContext(owner, token, basePath);
      const key = `golden-three-lease-${label}`;
      for (const [name, value] of Object.entries(env)) {
        process.env[name] = value;
      }
      process.env.GOLDEN_THREE_FAKE_DELAY_MS = "100";
      try {
        const queued = await startGoldenThreeGeneration(
          owner,
          `${basePath}/golden-three`,
          key,
          token,
        );
        const pending = runGoldenThreeWorker(queued.id);
        const jobId = await waitForGoldenCallInFlight(key);
        await databasePool.query(
          `UPDATE jobs
            SET status = 'failed',
                golden_three_lease_version = golden_three_lease_version + 1,
                error_code = 'JOB_ATTEMPTS_EXHAUSTED',
                error_message = '测试回收租约',
                updated_at = now()
          WHERE id = $1`,
          [jobId],
        );
        await pending;
      } finally {
        for (const name of Object.keys(env)) {
          delete process.env[name];
        }
        delete process.env.GOLDEN_THREE_FAKE_DELAY_MS;
      }
      const usage = await databasePool.query<{
        usage_count: string;
        total_tokens: number;
      }>(
        `SELECT count(*)::text AS usage_count,
              coalesce(sum(prompt_tokens + completion_tokens), 0)::int AS total_tokens
         FROM usage_records usage
         JOIN jobs job ON job.id = usage.job_id
        WHERE job.golden_three_generation_key = $1`,
        [key],
      );
      expect(usage.rows[0]?.usage_count).toBe("1");
      expect(usage.rows[0]?.total_tokens).toBeGreaterThan(0);
      const reservations = await databasePool.query<{ statuses: string[] }>(
        `SELECT array_agg(reservation.status ORDER BY reservation.status) AS statuses
           FROM cost_reservations reservation
           JOIN jobs job ON job.id = reservation.job_id
          WHERE job.golden_three_generation_key = $1`,
        [key],
      );
      expect(reservations.rows[0]?.statuses).toEqual(["released", "released", "settled"]);
      expect(
        (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
      ).toHaveLength(0);
    },
  );

  it("returns a recoverable model failure without persisting template candidates", async () => {
    const owner = await createAuthenticatedAgent("golden-three-model-failure@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    process.env.GOLDEN_THREE_FAKE_FAILURE = "1";
    let failedJobId = "";
    try {
      const queued = await startGoldenThreeGeneration(
        owner,
        `${basePath}/golden-three`,
        "golden-three-model-failure",
        token,
      );
      failedJobId = queued.id;
      await runGoldenThreeWorker(queued.id);
      expect(await generationJob(owner, `${basePath}/golden-three`, queued.id)).toMatchObject({
        status: "failed",
        error: { code: "GOLDEN_THREE_GENERATION_FAILED" },
      });
      process.env.GOLDEN_THREE_FAKE_FAILURE = "0";
      const repeated = await owner
        .post(`${basePath}/golden-three/candidates/generate`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "golden-three-model-failure")
        .send({ candidateCount: 3 })
        .expect(502);
      expect(repeated.body.error).toMatchObject({
        code: "GOLDEN_THREE_GENERATION_FAILED",
        details: { failureClass: "provider", retryable: true },
      });
    } finally {
      delete process.env.GOLDEN_THREE_FAKE_FAILURE;
    }
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
    ).toHaveLength(0);
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.activeGenerationJob,
    ).toMatchObject({
      id: failedJobId,
      status: "failed",
      error: { code: "GOLDEN_THREE_GENERATION_FAILED" },
    });
    const failure = await databasePool.query<{
      job_status: string;
      model_call_status: string;
      reservation_status: string;
      job_count: string;
      model_call_count: string;
      checkpoint_count: string;
      event_count: string;
      attempt_count: string;
      attempt_statuses: string[];
    }>(
      `SELECT job.status AS job_status,
              call.status AS model_call_status,
              reservation.status AS reservation_status,
              (SELECT count(*) FROM jobs WHERE idempotency_key = $1) AS job_count,
              (SELECT count(*) FROM model_calls WHERE job_id = job.id) AS model_call_count,
              (SELECT count(*) FROM job_checkpoints WHERE job_id = job.id) AS checkpoint_count,
              (SELECT count(*) FROM job_events WHERE job_id = job.id) AS event_count,
              (SELECT count(*) FROM job_step_attempts WHERE job_id = job.id) AS attempt_count,
              (SELECT array_agg(status ORDER BY step_key) FROM job_step_attempts WHERE job_id = job.id)
                AS attempt_statuses
         FROM jobs job
         JOIN model_calls call ON call.job_id = job.id
         JOIN cost_reservations reservation ON reservation.id = call.cost_reservation_id
        WHERE job.idempotency_key = $1
        LIMIT 1`,
      ["golden-three-model-failure"],
    );
    expect(failure.rows[0]).toEqual({
      job_status: "failed",
      model_call_status: "failed",
      reservation_status: "released",
      job_count: "1",
      model_call_count: "3",
      checkpoint_count: "2",
      event_count: "4",
      attempt_count: "3",
      attempt_statuses: ["skipped", "failed", "skipped"],
    });
  });

  it("releases remaining reservations and preserves partial cost after a later model failure", async () => {
    const owner = await createAuthenticatedAgent("golden-three-partial-failure@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    process.env.GOLDEN_THREE_FAKE_FAILURE_AT = "2";
    try {
      const queued = await startGoldenThreeGeneration(
        owner,
        `${basePath}/golden-three`,
        "golden-three-partial-failure",
        token,
      );
      await runGoldenThreeWorker(queued.id);
      expect(await generationJob(owner, `${basePath}/golden-three`, queued.id)).toMatchObject({
        status: "failed",
        error: { code: "GOLDEN_THREE_GENERATION_FAILED" },
      });
    } finally {
      delete process.env.GOLDEN_THREE_FAKE_FAILURE_AT;
    }
    const result = await databasePool.query<{
      job_status: string;
      budget_input_tokens: number;
      budget_output_tokens: number;
      usage_input_tokens: number;
      usage_output_tokens: number;
      reservation_statuses: string[];
      step_statuses: string[];
      model_call_statuses: string[];
      attempt_statuses: string[];
      checkpoint_count: string;
      checkpoint_revisions: number[];
      event_count: string;
    }>(
      `SELECT job.status AS job_status,
              (job.cost->>'inputTokens')::int AS budget_input_tokens,
              (job.cost->>'outputTokens')::int AS budget_output_tokens,
              (SELECT coalesce(sum(prompt_tokens), 0)::int FROM usage_records WHERE job_id = job.id)
                AS usage_input_tokens,
              (SELECT coalesce(sum(completion_tokens), 0)::int FROM usage_records WHERE job_id = job.id)
                AS usage_output_tokens,
              (SELECT array_agg(status ORDER BY status) FROM cost_reservations WHERE job_id = job.id)
                AS reservation_statuses,
              (SELECT array_agg(status ORDER BY step_key) FROM job_steps WHERE job_id = job.id)
                AS step_statuses,
              (SELECT array_agg(status ORDER BY step_key) FROM model_calls WHERE job_id = job.id)
                AS model_call_statuses,
              (SELECT array_agg(status ORDER BY step_key) FROM job_step_attempts WHERE job_id = job.id)
                AS attempt_statuses,
              (SELECT count(*) FROM job_checkpoints WHERE job_id = job.id) AS checkpoint_count,
              (SELECT array_agg(revision ORDER BY revision) FROM job_checkpoints WHERE job_id = job.id)
                AS checkpoint_revisions,
              (SELECT count(*) FROM job_events WHERE job_id = job.id) AS event_count
         FROM jobs job
        WHERE job.idempotency_key = $1`,
      ["golden-three-partial-failure"],
    );
    expect(result.rows[0]).toMatchObject({
      job_status: "failed",
      reservation_statuses: ["released", "released", "settled"],
      step_statuses: ["failed", "succeeded", "skipped"],
      model_call_statuses: ["failed", "succeeded", "failed"],
      attempt_statuses: ["failed", "succeeded", "skipped"],
      checkpoint_count: "3",
      checkpoint_revisions: [3, 4, 5],
      event_count: "4",
    });
    expect(result.rows[0]?.budget_input_tokens).toBe(result.rows[0]?.usage_input_tokens);
    expect(result.rows[0]?.budget_output_tokens).toBe(result.rows[0]?.usage_output_tokens);
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
    ).toHaveLength(0);
  });

  it("hard-stops generation when the configured cost budget is too low", async () => {
    const owner = await createAuthenticatedAgent("golden-three-budget@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    process.env.GOLDEN_THREE_MAX_COST_CNY = "0.0001";
    try {
      const start = () =>
        owner
          .post(`${basePath}/golden-three/candidates/generate`)
          .set("Origin", origin)
          .set("X-CSRF-Token", token)
          .set("Idempotency-Key", "golden-three-budget")
          .send({ candidateCount: 3 })
          .expect(202);
      const queued = await Promise.all([start(), start()]);
      await runGoldenThreeWorker(queued[0].body.data.id);
      expect(
        await generationJob(owner, `${basePath}/golden-three`, queued[0].body.data.id),
      ).toMatchObject({
        status: "failed",
        error: { code: "GOLDEN_THREE_GENERATION_FAILED" },
      });
      const repeated = await owner
        .post(`${basePath}/golden-three/candidates/generate`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "golden-three-budget")
        .send({ candidateCount: 3 })
        .expect(502);
      expect(repeated.body.error).toMatchObject({
        code: "GOLDEN_THREE_GENERATION_FAILED",
        details: { failureClass: "budget", retryable: true },
      });
    } finally {
      delete process.env.GOLDEN_THREE_MAX_COST_CNY;
    }
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
    ).toHaveLength(0);
    const jobs = await databasePool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM jobs WHERE idempotency_key = $1`,
      ["golden-three-budget"],
    );
    expect(jobs.rows[0]?.count).toBe("1");
  });

  it("fails closed when actual model usage exceeds the reserved budget", async () => {
    const owner = await createAuthenticatedAgent("golden-three-actual-budget@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    await createGoldenThreeChapters(owner, token, basePath);
    await createModelConfig(owner, token);
    await createGoldenThreeContext(owner, token, basePath);

    process.env.GOLDEN_THREE_FAKE_USAGE_MULTIPLIER = "100";
    try {
      const queued = await startGoldenThreeGeneration(
        owner,
        `${basePath}/golden-three`,
        "golden-three-actual-budget",
        token,
      );
      await runGoldenThreeWorker(queued.id);
      expect(await generationJob(owner, `${basePath}/golden-three`, queued.id)).toMatchObject({
        status: "failed",
        error: { code: "GOLDEN_THREE_GENERATION_FAILED" },
      });
    } finally {
      delete process.env.GOLDEN_THREE_FAKE_USAGE_MULTIPLIER;
    }
    const result = await databasePool.query<{
      job_status: string;
      total_tokens: number;
      max_tokens: number;
      reservation_statuses: string[];
      model_call_statuses: string[];
    }>(
      `SELECT job.status AS job_status,
              (job.cost->>'totalTokens')::int AS total_tokens,
              (job.budget->>'maxTokens')::int AS max_tokens,
              (SELECT array_agg(status ORDER BY status) FROM cost_reservations WHERE job_id = job.id)
                AS reservation_statuses,
              (SELECT array_agg(status ORDER BY step_key) FROM model_calls WHERE job_id = job.id)
                AS model_call_statuses,
              (SELECT array_agg(status ORDER BY step_key) FROM job_step_attempts WHERE job_id = job.id)
                AS attempt_statuses
         FROM jobs job
        WHERE job.idempotency_key = $1`,
      ["golden-three-actual-budget"],
    );
    expect(result.rows[0]?.job_status).toBe("failed");
    expect(result.rows[0]?.total_tokens).toBeGreaterThan(Number(result.rows[0]?.max_tokens));
    expect(result.rows[0]?.reservation_statuses).toEqual(["released", "released", "settled"]);
    expect(result.rows[0]?.model_call_statuses).toEqual(["failed", "failed", "failed"]);
    expect(result.rows[0]?.attempt_statuses).toEqual(["skipped", "failed", "skipped"]);
    expect(
      (await owner.get(`${basePath}/golden-three`).expect(200)).body.data.candidates,
    ).toHaveLength(0);
  });

  it("rejects cross-tenant access, unsupported evidence and locking before selection", async () => {
    const owner = await createAuthenticatedAgent("golden-three-owner@example.com");
    const other = await createAuthenticatedAgent("golden-three-other@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const otherToken = await csrf(other);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const outlinePath = `${basePath}/golden-three`;
    const candidate = (
      await owner
        .post(`${outlinePath}/candidates`)
        .set("Origin", origin)
        .set("X-CSRF-Token", token)
        .set("Idempotency-Key", "golden-three-security")
        .send({
          candidates: [
            candidateInput("候选 A · 钩子优先", "hook_focus", chapters, "f"),
            candidateInput("候选 B · 人物优先", "character_focus", chapters, "a"),
          ],
        })
        .expect(201)
    ).body.data.candidates[0] as {
      id: string;
      version: number;
      pins: Array<{ chapterId: string; chapterVersionId: string; content: string }>;
    };

    expect((await other.get(outlinePath).expect(403)).body.error.code).toBe(
      "FORBIDDEN_TENANT_ACCESS",
    );
    expect(
      (
        await other
          .post(`${outlinePath}/candidates/generate`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .set("Idempotency-Key", "golden-three-other-generate")
          .send({ candidateCount: 3 })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");
    expect(
      (
        await other
          .post(`${outlinePath}/candidates/${candidate.id}/lock`)
          .set("Origin", origin)
          .set("X-CSRF-Token", otherToken)
          .send({ version: candidate.version })
          .expect(403)
      ).body.error.code,
    ).toBe("FORBIDDEN_TENANT_ACCESS");

    const invalidEvidence = await owner
      .put(`${outlinePath}/candidates/${candidate.id}/reviews`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        version: candidate.version,
        reviews: [
          "opening_hook",
          "protagonist_appeal",
          "world_rules",
          "core_conflict",
          "reader_promise",
          "chapter_end_hook",
        ].map((dimension, index) => {
          const pin = candidate.pins[index % candidate.pins.length]!;
          return {
            dimension,
            score: 4,
            evidence: {
              chapterId: pin.chapterId,
              chapterVersionId: pin.chapterVersionId,
              passage: "这句原文并不在候选章节里。",
              locator: `第 ${index + 1} 章 · 首句`,
            },
            reviewerOrigin: "model",
          };
        }),
      })
      .expect(400);
    expect(invalidEvidence.body.error.code).toBe("VALIDATION_INVALID");

    const beforeSelection = await owner
      .post(`${outlinePath}/candidates/${candidate.id}/lock`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: candidate.version })
      .expect(409);
    expect(beforeSelection.body.error.code).toBe("GOLDEN_THREE_SELECTION_REQUIRED");

    const afterRejectedReview = (await owner.get(outlinePath).expect(200)).body.data.candidates[0];
    expect(afterRejectedReview).toMatchObject({
      status: "draft",
      version: candidate.version,
      reviewSummary: { completed: 0 },
    });
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
        displayName: "黄金三章作者",
      })
      .expect(200);
    return agent;
  }

  async function waitForGoldenCallInFlight(key: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const result = await databasePool.query<{ id: string }>(
        `SELECT job.id
           FROM jobs job
           JOIN job_steps step ON step.job_id = job.id AND step.status = 'running'
          WHERE job.golden_three_generation_key = $1
          LIMIT 1`,
        [key],
      );
      if (result.rows[0]) {
        return result.rows[0].id;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Golden three provider call did not start for ${key}`);
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
      .set("Idempotency-Key", randomUUID())
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

async function createGoldenThreeChapters(agent: SuperAgentTest, token: string, basePath: string) {
  const chapters: Array<{
    id: string;
    versionId: string;
    contentHash: string;
    content: string;
    number: number;
  }> = [];
  for (let number = 1; number <= 3; number += 1) {
    const content = [
      "残剑割掌，血逆流上碑，碑文里浮出他母亲的名字。",
      "铜牌背面刻着沈砚自己的名字，追兵已经进了山门。",
      "他记得自己赢了，却忘了为什么要赢。",
    ][number - 1]!;
    const created = await agent
      .post(`${basePath}/chapters`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({
        number,
        title: ["断碑夜雨", "铜牌背面", "忘名之价"][number - 1],
        brief: {
          goal: `完成第 ${number} 章的开篇推进。`,
          pov: "沈砚",
          location: "荒寺外山道",
          sceneBeats: ["发现异常", "被迫行动"],
          requiredFacts: ["沈砚不能暴露忘川书"],
        },
      })
      .expect(201);
    const chapterId = created.body.data.id as string;
    const version = await agent
      .post(`${basePath}/chapters/${chapterId}/versions`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .send({ version: 1, content })
      .expect(201);
    chapters.push({
      id: chapterId,
      versionId: version.body.data.version.id as string,
      contentHash: createHash("sha256").update(content).digest("hex"),
      content,
      number,
    });
  }
  return chapters;
}

async function createModelConfig(agent: SuperAgentTest, token: string): Promise<void> {
  const response = await agent
    .post("/api/v1/model-configs")
    .set("Origin", origin)
    .set("X-CSRF-Token", token)
    .send({
      provider: "openai-compatible",
      label: "黄金三章正文",
      baseUrl: "https://8.8.8.8/v1",
      model: "deepseek-chat",
      apiKey: "sk-fake-golden-three-1234",
      purposes: ["writing"],
      isDefault: true,
    });
  expect(response.status).toBe(200);
}

async function createGoldenThreeContext(
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
}

function candidateInput(
  label: string,
  strategy: "hook_focus" | "character_focus" | "world_focus",
  chapters: Array<{ id: string; versionId: string; contentHash: string }>,
  hashSeed: string,
) {
  return {
    label,
    strategy,
    prompt: {
      key: "golden-three-opening",
      version: 3,
      hash: hashSeed.toLowerCase().repeat(64).slice(0, 64),
    },
    model: {
      provider: "deepseek",
      model: "deepseek-chat",
      parameters: { temperature: 0.7 },
    },
    context: {
      packVersionId: null,
      manifestHash: "c".repeat(64),
    },
    pins: [
      {
        chapterId: chapters[0]!.id,
        chapterVersionId: chapters[0]!.versionId,
        expectedContentHash: chapters[0]!.contentHash,
      },
    ],
  };
}

function dedicatedDatabaseUrl(baseUrl: string): string {
  const target = new URL(baseUrl);
  target.pathname = `/novelbrain_test_147_${suffix}`;
  return target.toString();
}

function dedicatedRedisUrl(baseUrl: string): string {
  const target = new URL(baseUrl);
  target.pathname = `/${3 + (Number.parseInt(suffix.slice(0, 2), 16) % 12)}`;
  return target.toString();
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName.startsWith("novelbrain_test_147_")) {
    throw new Error("Golden three tests must use a dedicated test database");
  }
  const adminUrl = new URL(url);
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
