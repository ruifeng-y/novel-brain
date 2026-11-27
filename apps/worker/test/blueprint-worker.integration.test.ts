import { createDatabasePool, runMigrations } from "@novel-brain/db";
import {
  AiProviderError,
  FakeAiProvider,
  type AiGateway,
  type GenerationRequest,
} from "@novel-brain/ai";
import type { GenerateBlueprintJob } from "@novel-brain/contracts";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BlueprintJobProcessor } from "../src/blueprints/blueprint.processor";
import { WorkerBlueprintRepository } from "../src/blueprints/blueprint.repository";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://novelbrain:novelbrain@localhost:5432/novelbrain_test";

describe("blueprint worker persistence", () => {
  let pool: ReturnType<typeof createDatabasePool>;
  let repository: WorkerBlueprintRepository;

  beforeAll(async () => {
    await ensureDatabaseExists(databaseUrl);
    process.env.DATABASE_URL = databaseUrl;
    await runMigrations(databaseUrl);
    pool = createDatabasePool(databaseUrl);
    repository = new WorkerBlueprintRepository();
  });

  afterAll(async () => {
    await repository?.onModuleDestroy();
    await pool?.end();
  });

  it("persists candidates, checkpoints and ready notification without prose", async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
    const seeded = await seedQueuedBlueprint(pool);
    const processor = new BlueprintJobProcessor(repository, new FakeAiProvider());

    await processor.process(seeded.payload);

    const blueprint = await pool.query<{
      status: string;
      progress: number;
      current_step: string;
      story_bible_draft: { cards: unknown[] };
      core_settings_draft: unknown[];
      outline_draft: { nodes: unknown[]; sceneCards: unknown[] };
      cost: { totalTokens: number };
    }>(
      `SELECT status, progress, current_step, story_bible_draft, core_settings_draft,
              outline_draft, cost
         FROM work_blueprints
        WHERE id = $1`,
      [seeded.blueprintId],
    );
    expect(blueprint.rows[0]).toMatchObject({
      status: "waiting_review",
      progress: 100,
      current_step: "await_review",
    });
    expect(blueprint.rows[0]?.story_bible_draft.cards).toHaveLength(9);
    expect(blueprint.rows[0]?.core_settings_draft.length).toBeGreaterThanOrEqual(7);
    expect(blueprint.rows[0]?.outline_draft.nodes.length).toBeGreaterThan(1);
    expect(blueprint.rows[0]?.outline_draft.sceneCards).toHaveLength(24);
    expect(blueprint.rows[0]?.cost.totalTokens).toBeGreaterThan(0);

    const steps = await pool.query<{ step_key: string; status: string }>(
      `SELECT step_key, status
         FROM job_steps
        WHERE job_id = $1
        ORDER BY created_at, step_key`,
      [seeded.jobId],
    );
    expect(steps.rows).toHaveLength(6);
    expect(steps.rows.every((step) => step.status === "succeeded")).toBe(true);

    const checkpoints = await pool.query<{ revision: number; step_key: string }>(
      `SELECT revision, step_key
         FROM job_checkpoints
        WHERE job_id = $1
        ORDER BY revision`,
      [seeded.jobId],
    );
    expect(checkpoints.rows.map((checkpoint) => checkpoint.revision)).toEqual([1, 2, 3, 4, 5, 6]);

    const notification = await pool.query<{
      type: string;
      payload: { title: string; message: string; href: string };
      dedupe_key: string;
    }>(
      `SELECT type, payload, dedupe_key
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [seeded.userId],
    );
    expect(notification.rows).toHaveLength(1);
    expect(notification.rows[0]).toMatchObject({
      type: "review_required",
      payload: {
        title: "故事蓝图已生成",
        href: `/workspace/${seeded.workId}/blueprint`,
      },
      dedupe_key: `blueprint:${seeded.jobId}:ready:6`,
    });

    const prose = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM chapter_versions
        WHERE work_id = $1`,
      [seeded.workId],
    );
    expect(prose.rows[0]?.count).toBe(0);
  });

  it("waits for model configuration without creating candidates", async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
    const seeded = await seedQueuedBlueprint(pool);
    await pool.query(`UPDATE jobs SET model_config_id = NULL WHERE id = $1`, [seeded.jobId]);
    const provider = new FailIfCalledGateway();

    await new BlueprintJobProcessor(repository, provider).process(seeded.payload);

    const blueprint = await pool.query<{
      status: string;
      story_bible_draft: unknown;
      core_settings_draft: unknown[];
    }>(
      `SELECT status, story_bible_draft, core_settings_draft
         FROM work_blueprints WHERE id = $1`,
      [seeded.blueprintId],
    );
    expect(blueprint.rows[0]).toMatchObject({
      status: "waiting_model_config",
      story_bible_draft: null,
      core_settings_draft: [],
    });
    expect(provider.calls).toBe(0);
    await expectNotification(
      pool,
      seeded.userId,
      "job_failed",
      `blueprint:${seeded.jobId}:waiting_model_config`,
    );
  });

  it("pauses at the budget gate before calling the provider", async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
    const seeded = await seedQueuedBlueprint(pool);
    await pool.query(
      `UPDATE jobs
          SET budget = '{"maxTokens":1000,"maxCostCny":0.1}'::jsonb
        WHERE id = $1`,
      [seeded.jobId],
    );
    const provider = new FailIfCalledGateway();

    await new BlueprintJobProcessor(repository, provider).process(seeded.payload);

    const blueprint = await pool.query<{ status: string; cost: { totalTokens: number } }>(
      `SELECT status, cost FROM work_blueprints WHERE id = $1`,
      [seeded.blueprintId],
    );
    expect(blueprint.rows[0]).toMatchObject({
      status: "budget_paused",
      cost: { totalTokens: 0 },
    });
    expect(provider.calls).toBe(0);
    await expectNotification(
      pool,
      seeded.userId,
      "job_failed",
      `blueprint:${seeded.jobId}:budget:1`,
    );
  });

  it("records provider rate limits as a failed notification with preserved checkpoint", async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
    const seeded = await seedQueuedBlueprint(pool);
    const provider = new RateLimitedGateway();

    await new BlueprintJobProcessor(repository, provider).process(seeded.payload);

    const job = await pool.query<{
      status: string;
      error_code: string;
      checkpoint_version: number;
    }>(
      `SELECT status, error_code, checkpoint_version
         FROM jobs WHERE id = $1`,
      [seeded.jobId],
    );
    expect(job.rows[0]).toMatchObject({
      status: "failed",
      error_code: "MODEL_RATE_LIMITED",
      checkpoint_version: 1,
    });
    await expectNotification(
      pool,
      seeded.userId,
      "job_failed",
      `blueprint:${seeded.jobId}:failed:1:MODEL_RATE_LIMITED`,
    );
  });
});

class FailIfCalledGateway implements AiGateway {
  calls = 0;

  async generateText(): Promise<never> {
    this.calls += 1;
    throw new Error("Provider must not be called");
  }

  async *streamText(): AsyncIterable<{ text: string; done: boolean }> {
    yield { text: "", done: true };
  }
}

class RateLimitedGateway extends FailIfCalledGateway {
  override async generateText(_input: GenerationRequest): Promise<never> {
    this.calls += 1;
    throw new AiProviderError("rate limited", {
      failureClass: "rate_limit",
      retryable: true,
    });
  }
}

async function expectNotification(
  pool: ReturnType<typeof createDatabasePool>,
  userId: string,
  type: string,
  dedupeKey: string,
) {
  const notification = await pool.query<{ type: string; payload: unknown }>(
    `SELECT type, payload FROM notifications
      WHERE user_id = $1 AND dedupe_key = $2`,
    [userId, dedupeKey],
  );
  expect(notification.rows).toHaveLength(1);
  expect(notification.rows[0]?.type).toBe(type);
}

async function seedQueuedBlueprint(pool: ReturnType<typeof createDatabasePool>) {
  const userId = uuidv7();
  const existingPack = await pool.query<{ id: string }>(
    `SELECT id FROM genre_packs WHERE key = 'xianxia' ORDER BY version DESC LIMIT 1`,
  );
  const packId = existingPack.rows[0]?.id ?? uuidv7();
  const workId = uuidv7();
  const branchId = uuidv7();
  const versionNodeId = uuidv7();
  const modelConfigId = uuidv7();
  const jobId = uuidv7();
  const blueprintId = uuidv7();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, display_name)
     VALUES ($1, $2, 'hash', '蓝图 Worker 作者')`,
    [userId, `${userId}@example.com`],
  );
  await pool.query(
    `INSERT INTO model_configs
       (id, user_id, provider, label, base_url, model, purposes, encrypted_key,
        key_masked, is_default)
     VALUES ($1, $2, 'deepseek', '规划模型', 'https://api.deepseek.com',
             'deepseek-chat', '["planning"]'::jsonb, 'encrypted', 'sk-****', true)`,
    [modelConfigId, userId],
  );
  if (!existingPack.rows[0]) {
    await pool.query(
      `INSERT INTO genre_packs
         (id, key, version, label, fields, rules, ui_hints, generation_guidance)
       VALUES ($1, 'xianxia', 1, '仙侠',
               '{"genre":"仙侠","world":"修真世界"}'::jsonb,
               '[]'::jsonb,
               '{"worldLabel":"修真世界"}'::jsonb,
               '{"protagonistArchetypes":["杂役"],"conflictSeeds":["旧案"],
                 "worldRuleSeeds":["力量有代价"],"forbiddenElements":["无代价飞升"]}'::jsonb)`,
      [packId],
    );
  }
  await pool.query(
    `INSERT INTO works
       (id, user_id, title, pen_name, genre, scale_target, chapter_length_target,
        source_mode, idea, template_pack_id, settings)
     VALUES ($1, $2, '忘川书', '蓝图 Worker 作者', 'xianxia', 'short', 3000,
             'idea', '一个被宗门抛弃的杂役，意外得到一本会吞噬记忆的古书。',
             $3, '{}'::jsonb)`,
    [workId, userId, packId],
  );
  await pool.query(
    `INSERT INTO work_branches (id, work_id, user_id, name)
     VALUES ($1, $2, $3, 'main')`,
    [branchId, workId, userId],
  );
  await pool.query(
    `INSERT INTO version_nodes
       (id, work_id, branch_id, user_id, node_type, object_type, object_id,
        object_version, snapshot_id, payload, actor_id, message)
     VALUES ($1, $2, $3, $4, 'snapshot', 'work', $2, 1, $1, '{}'::jsonb, $4, '创建作品')`,
    [versionNodeId, workId, branchId, userId],
  );
  await pool.query(`UPDATE work_branches SET head_node_id = $2 WHERE id = $1`, [
    branchId,
    versionNodeId,
  ]);
  const estimate = {
    ruleVersion: "blueprint-estimate-v1",
    planned: { volumes: 1, chapters: 12, scenes: 24 },
    estimatedTokens: 40000,
    estimatedCostCny: 0.08,
    defaultBudget: { maxTokens: 48000, maxCostCny: 0.5 },
    assumptions: ["测试估算"],
  };
  const checkpoint = {
    schemaVersion: 1,
    revision: 0,
    step: "prepare",
    inputHash: "a".repeat(64),
    payload: {},
  };
  await pool.query(
    `INSERT INTO jobs
       (id, work_id, branch_id, user_id, model_config_id, job_type, type, status,
        progress, current_step, idempotency_key, budget, checkpoint, cost)
     VALUES ($1, $2, $3, $4, $5, 'book', 'generate_blueprint', 'queued',
             0, 'prepare', $6, '{"maxTokens":600000,"maxCostCny":10}'::jsonb,
             $7::jsonb,
             '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"costCny":0}'::jsonb)`,
    [
      jobId,
      workId,
      branchId,
      userId,
      modelConfigId,
      `blueprint-${jobId}`,
      JSON.stringify(checkpoint),
    ],
  );
  await pool.query(
    `INSERT INTO work_blueprints
       (id, work_id, branch_id, user_id, job_id, input_hash, estimate, cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb,
             '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"costCny":0}'::jsonb)`,
    [blueprintId, workId, branchId, userId, jobId, "a".repeat(64), JSON.stringify(estimate)],
  );
  const payload: GenerateBlueprintJob = {
    jobId,
    jobType: "generate_blueprint",
    workId,
    branchId,
    actorId: userId,
    modelConfigId,
    idempotencyKey: `blueprint-${jobId}`,
    budget: { maxTokens: 600000, maxCostCny: 10 },
    checkpoint: {
      schemaVersion: 1,
      revision: 0,
      step: "prepare",
      inputHash: "a".repeat(64),
      payload: {},
    },
  };
  return { userId, workId, jobId, blueprintId, payload };
}

async function ensureDatabaseExists(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!databaseName || databaseName === "postgres") {
    throw new Error("TEST_DATABASE_URL must name a dedicated test database");
  }
  const adminUrl = new URL(url);
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
