import "reflect-metadata";

import { createHash, randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createDatabasePool, runMigrations } from "@novel-brain/db";
import Redis from "ioredis";
import request, { type SuperAgentTest } from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { AppModule } from "../src/app.module";
import { MAIL_GATEWAY, type MailGateway } from "../src/auth/mail.gateway";
import { ApiExceptionFilter } from "../src/common/api-exception.filter";

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

  it("generates reviewed first-chapter candidates without changing current versions", async () => {
    const owner = await createAuthenticatedAgent("golden-three-generate@example.com");
    const work = await createWork(owner);
    const token = await csrf(owner);
    const basePath = branchPathOf(work);
    const chapters = await createGoldenThreeChapters(owner, token, basePath);
    const outlinePath = `${basePath}/golden-three`;

    const generated = await owner
      .post(`${outlinePath}/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-generate-1")
      .send({ candidateCount: 3 })
      .expect(201);
    const workspace = generated.body.data;
    expect(workspace.candidates).toHaveLength(3);
    expect(
      workspace.candidates.map((candidate: { strategy: string }) => candidate.strategy),
    ).toEqual(["hook_focus", "character_focus", "world_focus"]);
    for (const [index, candidate] of workspace.candidates.entries()) {
      expect(candidate.status).toBe("reviewed");
      expect(candidate.reviewSummary).toMatchObject({ completed: 6, requiredFailed: 0 });
      expect(candidate.prompt).toMatchObject({ key: "golden-three-generate", version: 1 });
      expect(candidate.model).toMatchObject({
        provider: "deterministic",
        model: "deterministic-golden-three-v1",
      });
      expect(candidate.context.manifestHash).toMatch(/^[a-f0-9]{64}$/);
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

    const repeated = await owner
      .post(`${outlinePath}/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-generate-1")
      .send({ candidateCount: 3 })
      .expect(201);
    expect(repeated.body.data.candidates.map((candidate: { id: string }) => candidate.id)).toEqual(
      workspace.candidates.map((candidate: { id: string }) => candidate.id),
    );

    const differentKey = await owner
      .post(`${outlinePath}/candidates/generate`)
      .set("Origin", origin)
      .set("X-CSRF-Token", token)
      .set("Idempotency-Key", "golden-three-generate-2")
      .send({ candidateCount: 3 })
      .expect(409);
    expect(differentKey.body.error.code).toBe("GOLDEN_THREE_CANDIDATES_EXIST");
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
