import { randomBytes } from "node:crypto";

import {
  createContinuityPlan,
  generateContinuityFixture,
  sha256Json,
} from "@novel-brain/continuity-benchmark";
import {
  APPROVED_QUALITY_RUBRIC_SHA256,
  createApprovedQualityBenchmarkDataset,
  type QualityBenchmarkCandidate,
  type QualityMetricScore,
} from "@novel-brain/quality-benchmark";
import {
  createDatabaseClient,
  createDatabasePool,
  evalGates,
  evalRuns,
  evalScores,
  runMigrations,
  withTenantTransaction,
} from "@novel-brain/db";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvalRepository } from "../src/eval/eval.repository";
import { EvalService } from "../src/eval/eval.service";

const databaseUrl = dedicatedDatabaseUrl();

describe("Eval persistence integration", () => {
  let adminPool: ReturnType<typeof createDatabasePool>;
  let repository: EvalRepository;
  let service: EvalService;
  let ownerId: string;
  let otherUserId: string;
  let rlsRole: string;

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    await runMigrations(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    adminPool = createDatabasePool(databaseUrl);
    rlsRole = `eval_rls_${randomBytes(4).toString("hex")}`;
    await adminPool.query(`CREATE ROLE "${rlsRole}" NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO "${rlsRole}"`);
    await adminPool.query(`GRANT SELECT ON eval_runs, eval_scores, eval_gates TO "${rlsRole}"`);
    ownerId = uuidv7();
    otherUserId = uuidv7();
    await adminPool.query(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
      [
        ownerId,
        `eval-owner-${ownerId}@example.com`,
        "test-password-hash",
        "Eval Owner",
        otherUserId,
        `eval-other-${otherUserId}@example.com`,
        "test-password-hash",
        "Other User",
      ],
    );
    repository = new EvalRepository();
    service = new EvalService(repository);
  });

  afterAll(async () => {
    await repository?.onModuleDestroy();
    await adminPool?.end();
    await dropDatabase(databaseUrl);
    await dropRole(rlsRole);
  });

  it("persists tenant-scoped runs, scores and gates atomically", async () => {
    const baselineCandidate = createCandidate("integration-baseline", "prompt-v1");
    const candidateCandidate = createCandidate("integration-candidate", "prompt-v2");

    const baseline = await service.run(ownerId, baselineCandidate);
    const candidate = await service.run(ownerId, candidateCandidate);
    const repeated = await service.run(ownerId, baselineCandidate);
    const concurrentCandidate = createCandidate("integration-concurrent", "prompt-v3");
    const [concurrentFirst, concurrentSecond] = await Promise.all([
      service.run(ownerId, concurrentCandidate),
      service.run(ownerId, concurrentCandidate),
    ]);

    expect(repeated).toEqual(baseline);
    expect(concurrentFirst).toEqual(concurrentSecond);
    expect(await repository.reportByRunKey(ownerId, baseline.runId)).toEqual(baseline);
    expect(await repository.reportByRunKey(otherUserId, baseline.runId)).toBeUndefined();

    const gate = await service.gate(ownerId, baseline.runId, candidate.runId);
    expect(gate.rolloutAllowed).toBe(false);
    const otherRun = await service.run(
      otherUserId,
      createCandidate("integration-other", "prompt-v1"),
    );

    const db = createDatabaseClient(adminPool);
    const ownerRunIds = await withTenantTransaction(db, ownerId, async (transaction) =>
      transaction.select({ id: evalRuns.id, runKey: evalRuns.runKey }).from(evalRuns),
    );
    const otherRunIds = await withTenantTransaction(db, otherUserId, async (transaction) =>
      transaction.select({ id: evalRuns.id, runKey: evalRuns.runKey }).from(evalRuns),
    );
    const otherRunId = otherRunIds.find((run) => run.runKey === otherRun.runId)?.id;
    const candidateRunId = ownerRunIds.find((run) => run.runKey === candidate.runId)?.id;
    expect(otherRunId).toBeDefined();
    expect(candidateRunId).toBeDefined();

    const scoreError = await withTenantTransaction(db, ownerId, async (transaction) =>
      transaction.insert(evalScores).values({
        id: uuidv7(),
        userId: ownerId,
        runId: otherRunId!,
        sampleId: "cross-tenant-score",
        dimension: "outline_adherence",
        scorerType: "human_blind",
        scorerId: "cross-tenant-reviewer",
        value: 1,
        confidence: 1,
        evidenceQuote: "cross-tenant",
        evidenceQuotes: ["cross-tenant"],
        reviewerAttestationId: "cross-tenant-attestation",
        reviewedAt: new Date("2026-11-18T00:00:00.000Z"),
        blindPacketSha256: "a".repeat(64),
      }),
    ).catch((error: unknown) => error);
    expect(postgresError(scoreError)).toMatchObject({
      code: "23503",
      constraint: "eval_scores_run_user_fk",
    });

    const gateError = await withTenantTransaction(db, ownerId, async (transaction) =>
      transaction.insert(evalGates).values({
        id: uuidv7(),
        userId: ownerId,
        baselineRunId: otherRunId!,
        candidateRunId: candidateRunId!,
        rolloutAllowed: false,
        blockers: ["cross-tenant"],
        changedProvenance: [],
        p0Baseline: 0,
        p0Candidate: 0,
      }),
    ).catch((error: unknown) => error);
    expect(postgresError(gateError)).toMatchObject({
      code: "23503",
      constraint: expect.stringMatching(/^eval_gates_(baseline|candidate)_run_user_fk$/u),
    });

    const tenantRows = await withTenantTransaction(db, ownerId, async (transaction) => ({
      runs: await transaction
        .select({ id: evalRuns.id, continuityFindings: evalRuns.continuityFindings })
        .from(evalRuns)
        .where(eq(evalRuns.userId, ownerId)),
      scores: await transaction
        .select({
          id: evalScores.id,
          reviewerAttestationId: evalScores.reviewerAttestationId,
          blindPacketSha256: evalScores.blindPacketSha256,
        })
        .from(evalScores)
        .where(eq(evalScores.userId, ownerId)),
      gates: await transaction
        .select({ id: evalGates.id })
        .from(evalGates)
        .where(eq(evalGates.userId, ownerId)),
    }));

    expect(tenantRows.runs).toHaveLength(3);
    expect(tenantRows.runs.every((run) => run.continuityFindings.length > 0)).toBe(true);
    expect(tenantRows.scores.length).toBeGreaterThan(0);
    expect(
      tenantRows.scores
        .filter((score) => score.reviewerAttestationId !== null)
        .every(
          (score) =>
            score.reviewerAttestationId?.trim() &&
            /^[a-f0-9]{64}$/u.test(score.blindPacketSha256 ?? ""),
        ),
    ).toBe(true);
    expect(tenantRows.gates).toHaveLength(1);

    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE "${rlsRole}"`);
      const withoutContext = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM eval_runs",
      );
      expect(withoutContext.rows[0]?.count).toBe(0);

      await client.query("SELECT set_config('app.user_id', $1, true)", [ownerId]);
      const ownerRows = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM eval_runs",
      );
      expect(ownerRows.rows[0]?.count).toBe(3);

      await client.query("SELECT set_config('app.user_id', $1, true)", [otherUserId]);
      const otherRows = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM eval_runs",
      );
      expect(otherRows.rows[0]?.count).toBe(1);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  });
});

function createCandidate(candidateId: string, promptVersion: string): QualityBenchmarkCandidate {
  const dataset = createApprovedQualityBenchmarkDataset();
  const fixture = generateContinuityFixture({
    plan: createContinuityPlan({
      seed: dataset.manifest.seed,
      tier: dataset.manifest.continuityTier,
    }),
    sourceCommit: dataset.manifest.sourceCommit,
  });
  return {
    schemaVersion: 1,
    candidateId,
    datasetSha256: dataset.manifest.datasetSha256,
    rubricVersion: dataset.manifest.rubricVersion,
    provenance: {
      codeCommit: "integration-test",
      model: "deepseek-chat",
      promptVersion,
      contextCompilerVersion: "context-v1",
      agentContractVersion: "agent-v1",
    },
    continuityFindings: fixture.defects.map((defect) => ({
      family: defect.family,
      severity: defect.severity,
      chapterNumber: defect.chapterNumber,
      branchId: defect.branchId,
      entityIds: defect.entityIds,
      sourceFactId: defect.sourceFactId,
      versionNodeId: defect.versionNodeId,
      evidence: defect.evidence,
    })),
    humanScores: createHumanScores(dataset),
    decisions: [],
  };
}

function createHumanScores(
  dataset: ReturnType<typeof createApprovedQualityBenchmarkDataset>,
): QualityMetricScore[] {
  const samples = [...dataset.chapterSamples, ...dataset.adversarialCases];
  const blindPacketSha256 = sha256Json({
    datasetSha256: dataset.manifest.datasetSha256,
    rubricSha256: APPROVED_QUALITY_RUBRIC_SHA256,
  });
  return samples.flatMap((sample) => {
    const evidenceQuote = sample.text.slice(0, Math.min(16, sample.text.length));
    return [
      humanScore(
        sample.id,
        "outline_adherence",
        "reviewer-a",
        0.95,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
      humanScore(
        sample.id,
        "outline_adherence",
        "reviewer-b",
        0.95,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
      humanScore(
        sample.id,
        "hook_prose_score",
        "reviewer-a",
        4.5,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
      humanScore(
        sample.id,
        "hook_prose_score",
        "reviewer-b",
        4.5,
        evidenceQuote,
        sample.requiredBeats,
        blindPacketSha256,
      ),
    ];
  });
}

function humanScore(
  sampleId: string,
  dimension: QualityMetricScore["dimension"],
  scorerId: string,
  value: number,
  evidenceQuote: string,
  evidenceQuotes: readonly string[],
  blindPacketSha256: string,
): QualityMetricScore {
  return {
    sampleId,
    dimension,
    scorerType: "human_blind",
    scorerId,
    value,
    confidence: 0.9,
    evidenceQuote,
    evidenceQuotes,
    blindPacketSha256,
    reviewerAttestationId: `integration-attestation:${scorerId}`,
    reviewedAt: "2026-11-18T00:00:00.000Z",
  };
}

function dedicatedDatabaseUrl(): string {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test",
  );
  url.pathname = `/novelbrain_test_eval_${randomBytes(4).toString("hex")}`;
  return url.toString();
}

function postgresError(error: unknown): { code?: string; constraint?: string } | undefined {
  let current = error;
  while (current && typeof current === "object") {
    if ("code" in current) {
      return {
        code: typeof current.code === "string" ? current.code : undefined,
        constraint:
          "constraint" in current && typeof current.constraint === "string"
            ? current.constraint
            : undefined,
      };
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName.startsWith("novelbrain_test_eval_")) {
    throw new Error("Eval tests must use a dedicated test database");
  }
  target.pathname = "/postgres";
  const adminPool = createDatabasePool(target.toString());
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

async function dropDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  target.pathname = "/postgres";
  const adminPool = createDatabasePool(target.toString(), {
    query_timeout: 0,
    statement_timeout: 0,
  });
  try {
    await adminPool.query(
      `DROP DATABASE IF EXISTS "${databaseName.replaceAll('"', '""')}" WITH (FORCE)`,
    );
  } finally {
    await adminPool.end();
  }
}

async function dropRole(roleName: string | undefined): Promise<void> {
  if (!roleName) {
    return;
  }
  const baseUrl = new URL(databaseUrl);
  baseUrl.pathname = "/postgres";
  const adminPool = createDatabasePool(baseUrl.toString());
  try {
    await adminPool.query(`DROP ROLE IF EXISTS "${roleName}"`);
  } finally {
    await adminPool.end();
  }
}
