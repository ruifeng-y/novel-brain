import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  blueprintCheckpointSchema,
  type BlueprintCheckpoint,
  type BlueprintConflict,
  type BlueprintCoreSettingDraft,
  type BlueprintCost,
  type BlueprintJobStep,
  type BlueprintMissingField,
  type BlueprintOutlineDraft,
  type BlueprintStoryBibleDraft,
  type GenerateBlueprintJob,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

import {
  BlueprintJobStore,
  type BlueprintFailure,
  type BlueprintStepCommit,
  type LoadedBlueprintJob,
} from "./blueprint.processor";

type DatabaseClient = PoolClient;

interface LoadedRow {
  job_id: string;
  user_id: string;
  work_id: string;
  branch_id: string;
  model_config_id: string | null;
  idempotency_key: string;
  budget: GenerateBlueprintJob["budget"];
  checkpoint: unknown;
  job_cost: BlueprintCost;
  blueprint_id: string;
  blueprint_status: string;
  progress: number;
  story_bible_draft: BlueprintStoryBibleDraft | null;
  core_settings_draft: BlueprintCoreSettingDraft[];
  outline_draft: BlueprintOutlineDraft | null;
  title: string;
  pen_name: string;
  idea: string | null;
  genre: string;
  scale_target: string;
  chapter_length_target: number;
  template_pack_id: string | null;
  fields: Record<string, unknown> | null;
  rules: Array<{ key: string; label: string }> | null;
  ui_hints: Record<string, unknown> | null;
  generation_guidance: Record<string, unknown> | null;
  provider: string | null;
  base_url: string | null;
  model: string | null;
  encrypted_key: string | null;
}

@Injectable()
export class WorkerBlueprintRepository extends BlueprintJobStore implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    super();
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async withJobLock<T>(jobId: string, operation: () => Promise<T>): Promise<T | undefined> {
    const client = await this.pool.connect();
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_lock(
           hashtext('novelbrain:blueprint-job'),
           hashtext($1::text)
         ) AS locked`,
        [jobId],
      );
      locked = result.rows[0]?.locked === true;
      if (!locked) {
        return undefined;
      }
      return await operation();
    } finally {
      let unlockFailed = false;
      if (locked) {
        await client
          .query(
            `SELECT pg_advisory_unlock(
               hashtext('novelbrain:blueprint-job'),
               hashtext($1::text)
             )`,
            [jobId],
          )
          .catch(() => {
            unlockFailed = true;
          });
      }
      client.release(unlockFailed);
    }
  }

  async loadJob(payload: GenerateBlueprintJob): Promise<LoadedBlueprintJob | undefined> {
    return this.withTenant(payload.actorId, async (client) => {
      const result = await client.query<LoadedRow>(
        `SELECT j.id AS job_id, j.user_id, j.work_id, j.branch_id, j.model_config_id,
                j.idempotency_key, j.budget, j.checkpoint, j.cost AS job_cost,
                wb.id AS blueprint_id, wb.status AS blueprint_status, wb.progress,
                wb.story_bible_draft, wb.core_settings_draft, wb.outline_draft,
                w.title, w.pen_name, w.idea, w.genre, w.scale_target,
                w.chapter_length_target, w.template_pack_id,
                gp.fields, gp.rules, gp.ui_hints, gp.generation_guidance,
                mc.provider, mc.base_url, mc.model, mc.encrypted_key
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
           INNER JOIN works AS w
             ON w.id = j.work_id AND w.user_id = j.user_id
           LEFT JOIN genre_packs AS gp ON gp.id = w.template_pack_id
           LEFT JOIN model_configs AS mc
             ON mc.id = j.model_config_id
            AND mc.user_id = j.user_id
            AND mc.deleted_at IS NULL
          WHERE j.id = $1
            AND j.user_id = $2
            AND j.type = 'generate_blueprint'
            AND w.deleted_at IS NULL
          LIMIT 1`,
        [payload.jobId, payload.actorId],
      );
      const row = result.rows[0];
      if (!row) {
        return undefined;
      }
      return {
        job: {
          id: row.job_id,
          userId: row.user_id,
          workId: row.work_id,
          branchId: row.branch_id,
          modelConfigId: row.model_config_id,
          idempotencyKey: row.idempotency_key,
          budget: row.budget,
          checkpoint: blueprintCheckpointSchema.parse(row.checkpoint),
          cost: row.job_cost,
        },
        blueprint: {
          id: row.blueprint_id,
          status: row.blueprint_status,
          progress: row.progress,
          storyBible: row.story_bible_draft,
          coreSettings: row.core_settings_draft,
          outline: row.outline_draft,
        },
        work: {
          title: row.title,
          penName: row.pen_name,
          idea: row.idea,
          genre: row.genre,
          scaleTarget: row.scale_target,
          chapterLengthTarget: row.chapter_length_target,
          templatePackId: row.template_pack_id,
        },
        genrePack:
          row.fields && row.rules && row.ui_hints && row.generation_guidance
            ? {
                fields: row.fields,
                rules: row.rules,
                uiHints: row.ui_hints,
                generationGuidance: row.generation_guidance,
              }
            : null,
        modelConfig:
          row.provider && row.base_url && row.model && row.encrypted_key
            ? {
                provider: row.provider,
                baseUrl: row.base_url,
                model: row.model,
                encryptedKey: row.encrypted_key,
              }
            : null,
      };
    });
  }

  async begin(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
  ): Promise<BlueprintCheckpoint> {
    return this.withTenantTransaction(payload.actorId, async (client) => {
      await client.query(
        `UPDATE jobs
            SET status = 'running', started_at = COALESCE(started_at, now()),
                error_code = NULL, error_message = NULL, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [payload.jobId, payload.actorId],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = 'running', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId],
      );
      return loaded.job.checkpoint;
    });
  }

  async commitStep(commit: BlueprintStepCommit): Promise<BlueprintCheckpoint> {
    return this.withTenantTransaction(commit.payload.actorId, async (client) => {
      const current = await client.query<{
        cost: BlueprintCost;
        checkpoint_version: number;
      }>(
        `SELECT cost, checkpoint_version
           FROM jobs
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [commit.payload.jobId, commit.payload.actorId],
      );
      const row = current.rows[0];
      if (!row) {
        throw new Error("Blueprint job disappeared during step commit");
      }
      const revision = row.checkpoint_version + 1;
      const cost = addCost(row.cost, commit.result.cost);
      const checkpoint: BlueprintCheckpoint = {
        schemaVersion: 1,
        revision,
        step: commit.nextStep,
        inputHash: commit.payload.checkpoint.inputHash,
        payload: commit.result.checkpointPayload,
      };
      await client.query(
        `INSERT INTO job_steps
           (id, job_id, work_id, branch_id, user_id, step_key, status, attempt,
            output, cost, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', 1, $7::jsonb, $8::jsonb,
                 now(), now())
         ON CONFLICT (job_id, step_key)
         DO UPDATE SET status = 'succeeded', attempt = job_steps.attempt + 1,
                       output = EXCLUDED.output, cost = EXCLUDED.cost, finished_at = now()`,
        [
          uuidv7(),
          commit.payload.jobId,
          commit.payload.workId,
          commit.payload.branchId,
          commit.payload.actorId,
          commit.step,
          JSON.stringify(commit.result.output),
          JSON.stringify(commit.result.cost),
        ],
      );
      await client.query(
        `INSERT INTO job_checkpoints
           (id, job_id, work_id, branch_id, user_id, step_key, schema_version,
            revision, attempt, input_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 1, $8, $9::jsonb)`,
        [
          uuidv7(),
          commit.payload.jobId,
          commit.payload.workId,
          commit.payload.branchId,
          commit.payload.actorId,
          commit.step,
          revision,
          checkpoint.inputHash,
          JSON.stringify(checkpoint),
        ],
      );
      await client.query(
        `UPDATE jobs
            SET status = 'running', progress = $3, current_step = $4,
                checkpoint = $5::jsonb, checkpoint_version = $6, cost = $7::jsonb,
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          commit.payload.jobId,
          commit.payload.actorId,
          commit.progress,
          commit.nextStep,
          JSON.stringify(checkpoint),
          revision,
          JSON.stringify(cost),
        ],
      );
      await client.query(
        `UPDATE work_blueprints
            SET progress = $4, current_step = $5, cost = $6::jsonb,
                story_bible_draft = COALESCE($7::jsonb, story_bible_draft),
                core_settings_draft = COALESCE($8::jsonb, core_settings_draft),
                outline_draft = COALESCE($9::jsonb, outline_draft),
                missing_fields = COALESCE($10::jsonb, missing_fields),
                conflicts = COALESCE($11::jsonb, conflicts),
                updated_at = now()
          WHERE work_id = $1 AND branch_id = $2 AND user_id = $3`,
        [
          commit.payload.workId,
          commit.payload.branchId,
          commit.payload.actorId,
          commit.progress,
          commit.nextStep,
          JSON.stringify(cost),
          commit.result.storyBible ? JSON.stringify(commit.result.storyBible) : null,
          commit.result.coreSettings ? JSON.stringify(commit.result.coreSettings) : null,
          commit.result.outline ? JSON.stringify(commit.result.outline) : null,
          commit.result.missingFields ? JSON.stringify(commit.result.missingFields) : null,
          commit.result.conflicts ? JSON.stringify(commit.result.conflicts) : null,
        ],
      );
      return checkpoint;
    });
  }

  async completeReady(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    checkpoint: BlueprintCheckpoint,
  ): Promise<void> {
    await this.withTenantTransaction(payload.actorId, async (client) => {
      await client.query(
        `UPDATE jobs
            SET status = 'waiting_review', progress = 100, current_step = 'await_review',
                checkpoint = $3::jsonb, checkpoint_version = $4,
                error_code = NULL, error_message = NULL, finished_at = now(), updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          payload.jobId,
          payload.actorId,
          JSON.stringify({ ...checkpoint, step: "await_review", revision: checkpoint.revision }),
          checkpoint.revision,
        ],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = 'waiting_review', progress = 100, current_step = 'await_review',
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId],
      );
      await recordNotification(client, {
        userId: payload.actorId,
        workId: payload.workId,
        branchId: payload.branchId,
        type: "review_required",
        targetId: payload.jobId,
        title: "故事蓝图已生成",
        message: "故事圣经、核心设定和初始大纲已准备好，请逐项审阅。",
        href: `/workspace/${payload.workId}/blueprint`,
        dedupeKey: `blueprint:${payload.jobId}:ready:${checkpoint.revision}`,
      });
    });
  }

  async waitingModelConfig(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
  ): Promise<void> {
    await this.withTenantTransaction(payload.actorId, async (client) => {
      await client.query(
        `UPDATE jobs
            SET status = 'paused', current_step = 'prepare',
                error_code = 'MODEL_PROVIDER_ERROR',
                error_message = '缺少可用的故事蓝图模型配置', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [payload.jobId, payload.actorId],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = 'waiting_model_config', current_step = 'prepare', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId],
      );
      await recordNotification(client, {
        userId: payload.actorId,
        workId: payload.workId,
        branchId: payload.branchId,
        type: "job_failed",
        targetId: payload.jobId,
        title: "故事蓝图正在等待模型配置",
        message: "配置可用的规划模型后，可从当前检查点继续。",
        href: `/workspace/settings/account`,
        dedupeKey: `blueprint:${payload.jobId}:waiting_model_config`,
      });
    });
  }

  async pauseBudget(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    projectedTokens: number,
    projectedCostCny: number,
  ): Promise<void> {
    await this.withTenantTransaction(payload.actorId, async (client) => {
      await client.query(
        `UPDATE jobs
            SET status = 'paused', current_step = $3,
                error_code = 'JOB_BUDGET_EXCEEDED',
                error_message = '故事蓝图预计超过预算上限', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [payload.jobId, payload.actorId, step],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = 'budget_paused', current_step = $3, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId, step],
      );
      await recordNotification(client, {
        userId: payload.actorId,
        workId: payload.workId,
        branchId: payload.branchId,
        type: "job_failed",
        targetId: payload.jobId,
        title: "故事蓝图已暂停",
        message: `预计还需要 ${projectedTokens} token / ${projectedCostCny.toFixed(4)} 元，请调整预算后继续。`,
        href: `/workspace/${payload.workId}/blueprint`,
        dedupeKey: `blueprint:${payload.jobId}:budget:${checkpoint.revision}`,
      });
    });
  }

  async fail(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    failure: BlueprintFailure,
  ): Promise<void> {
    await this.withTenantTransaction(payload.actorId, async (client) => {
      await client.query(
        `UPDATE jobs
            SET status = 'failed', current_step = $3, error_code = $4,
                error_message = $5, finished_at = now(), updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [payload.jobId, payload.actorId, step, failure.code, failure.message],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = 'failed', current_step = $3, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId, step],
      );
      await recordNotification(client, {
        userId: payload.actorId,
        workId: payload.workId,
        branchId: payload.branchId,
        type: "job_failed",
        targetId: payload.jobId,
        title: "故事蓝图生成失败",
        message: failure.message,
        href: `/workspace/${payload.workId}/blueprint`,
        dedupeKey: `blueprint:${payload.jobId}:failed:${checkpoint.revision}:${failure.code}`,
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private withTenantTransaction<T>(
    userId: string,
    operation: (client: DatabaseClient) => Promise<T>,
  ): Promise<T> {
    return this.withTenant(userId, operation);
  }
}

async function recordNotification(
  client: DatabaseClient,
  input: {
    userId: string;
    workId: string;
    branchId: string;
    type: "review_required" | "job_failed";
    targetId: string;
    title: string;
    message: string;
    href: string;
    dedupeKey: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO notifications
       (id, user_id, work_id, branch_id, type, target_type, target_id,
        payload, dedupe_key, read_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'job', $6, $7::jsonb, $8, NULL, now())
     ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
    [
      uuidv7(),
      input.userId,
      input.workId,
      input.branchId,
      input.type,
      input.targetId,
      JSON.stringify({ title: input.title, message: input.message, href: input.href }),
      input.dedupeKey,
    ],
  );
}

function addCost(left: BlueprintCost, right: BlueprintCost): BlueprintCost {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
    costCny: left.costCny + right.costCny,
  };
}
