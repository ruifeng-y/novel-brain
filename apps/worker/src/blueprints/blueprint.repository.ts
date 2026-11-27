import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  BLUEPRINT_JOB_STEPS,
  blueprintCheckpointSchema,
  type BlueprintCheckpoint,
  type BlueprintCoreSettingDraft,
  type BlueprintCost,
  type BlueprintJobStep,
  type BlueprintOutlineDraft,
  type BlueprintStoryBibleDraft,
  type GenerateBlueprintJob,
} from "@novel-brain/contracts";
import type { GenerationResult } from "@novel-brain/ai";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

import {
  BlueprintJobStore,
  type BlueprintFailure,
  type BlueprintStepCommit,
  type LoadedBlueprintJob,
} from "./blueprint.processor";
import { addBlueprintCost } from "./blueprint.cost";

type DatabaseClient = PoolClient;

interface LoadedRow {
  job_id: string;
  job_status: string;
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
  field_schema: Array<{
    key: string;
    required: boolean;
  }> | null;
  provider: string | null;
  base_url: string | null;
  model: string | null;
  encrypted_key: string | null;
  pending_step_key: string | null;
  pending_provider_result: unknown | null;
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
        `SELECT j.id AS job_id, j.status AS job_status, j.user_id, j.work_id,
                j.branch_id, j.model_config_id,
                j.idempotency_key, j.budget, j.checkpoint, j.cost AS job_cost,
                wb.id AS blueprint_id, wb.status AS blueprint_status, wb.progress,
                wb.story_bible_draft, wb.core_settings_draft, wb.outline_draft,
                w.title, w.pen_name, w.idea, w.genre, w.scale_target,
                w.chapter_length_target, w.template_pack_id,
                gp.fields, gp.field_schema, gp.rules, gp.ui_hints, gp.generation_guidance,
                mc.provider, mc.base_url, mc.model, mc.encrypted_key,
                pending_step.step_key AS pending_step_key,
                pending_step.output->'providerResult' AS pending_provider_result
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
           LEFT JOIN LATERAL (
             SELECT js.step_key, js.output
               FROM job_steps AS js
              WHERE js.job_id = j.id
                AND js.status IN ('running', 'failed')
                AND js.output ? 'providerResult'
              ORDER BY js.started_at DESC
              LIMIT 1
           ) AS pending_step ON true
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
      const checkpoint = blueprintCheckpointSchema.parse(row.checkpoint);
      const pendingProviderResult = parsePendingProviderResult(
        row.pending_provider_result,
        row.pending_step_key,
      );
      const modelRatePerTokenCny = row.model ? configuredModelRate(row.model) : undefined;
      const contextWindowTokens = row.model ? configuredContextWindowTokens(row.model) : undefined;
      return {
        job: {
          id: row.job_id,
          status: row.job_status,
          userId: row.user_id,
          workId: row.work_id,
          branchId: row.branch_id,
          modelConfigId: row.model_config_id,
          idempotencyKey: row.idempotency_key,
          budget: row.budget,
          checkpoint,
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
                fieldSchema: row.field_schema ?? [],
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
                ...(modelRatePerTokenCny !== undefined
                  ? { ratePerTokenCny: modelRatePerTokenCny }
                  : {}),
                ...(contextWindowTokens !== undefined
                  ? { contextWindowTokens: contextWindowTokens }
                  : {}),
              }
            : null,
        ...(pendingProviderResult ? { pendingProviderResult } : {}),
      };
    });
  }

  async begin(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
  ): Promise<BlueprintCheckpoint | undefined> {
    return this.withTenantTransaction(payload.actorId, async (client) => {
      const current = await client.query<{
        job_status: string;
        blueprint_status: string;
        checkpoint: unknown;
      }>(
        `SELECT j.status AS job_status, wb.status AS blueprint_status, j.checkpoint
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
          WHERE j.id = $1 AND j.user_id = $2
          FOR UPDATE OF j, wb`,
        [payload.jobId, payload.actorId],
      );
      const row = current.rows[0];
      if (
        !row ||
        !["queued", "running"].includes(row.job_status) ||
        !["queued", "running"].includes(row.blueprint_status)
      ) {
        return undefined;
      }
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
      return blueprintCheckpointSchema.parse(row.checkpoint);
    });
  }

  async isRunnable(payload: GenerateBlueprintJob): Promise<boolean> {
    return this.withTenant(payload.actorId, async (client) => {
      const result = await client.query<{ runnable: boolean }>(
        `SELECT (j.status = 'running' AND wb.status = 'running') AS runnable
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
          WHERE j.id = $1 AND j.user_id = $2`,
        [payload.jobId, payload.actorId],
      );
      return result.rows[0]?.runnable === true;
    });
  }

  async reserveProviderCall(
    payload: GenerateBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    projectedTokens: number,
    projectedCostCny: number,
  ): Promise<boolean> {
    return this.withTenantTransaction(payload.actorId, async (client) => {
      const current = await client.query<{ job_status: string; blueprint_status: string }>(
        `SELECT j.status AS job_status, wb.status AS blueprint_status
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
          WHERE j.id = $1 AND j.user_id = $2
          FOR UPDATE OF j, wb`,
        [payload.jobId, payload.actorId],
      );
      const row = current.rows[0];
      if (row?.job_status !== "running" || row.blueprint_status !== "running") {
        return false;
      }
      await client.query(
        `UPDATE cost_reservations
            SET status = 'released', failure_class = 'unknown'
          WHERE job_id = $1 AND status = 'reserved'`,
        [payload.jobId],
      );
      const stepResult = await client.query<{ attempt: number }>(
        `INSERT INTO job_steps
           (id, job_id, work_id, branch_id, user_id, step_key, status, attempt,
            input_hash, output, cost, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'running', 1, $7, '{}'::jsonb,
                 '{}'::jsonb, now())
         ON CONFLICT (job_id, step_key)
         DO UPDATE SET status = 'running', attempt = job_steps.attempt + 1,
                       input_hash = EXCLUDED.input_hash, output = '{}'::jsonb,
                       cost = '{}'::jsonb, error_code = NULL, error_message = NULL,
                       started_at = now(), finished_at = NULL
         RETURNING attempt`,
        [
          uuidv7(),
          payload.jobId,
          payload.workId,
          payload.branchId,
          payload.actorId,
          step,
          checkpoint.inputHash,
        ],
      );
      const attempt = stepResult.rows[0]?.attempt;
      if (!attempt) {
        throw new Error("Blueprint step reservation returned no attempt");
      }
      await client.query(
        `INSERT INTO job_step_attempts
           (id, job_id, work_id, branch_id, user_id, step_key, attempt, status,
            input_hash, output_refs, cost, checkpoint_revision, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'running', $8, '[]'::jsonb,
                 '{}'::jsonb, $9, now())`,
        [
          uuidv7(),
          payload.jobId,
          payload.workId,
          payload.branchId,
          payload.actorId,
          step,
          attempt,
          checkpoint.inputHash,
          checkpoint.revision,
        ],
      );
      await client.query(
        `INSERT INTO cost_reservations
           (id, user_id, work_id, branch_id, job_id, idempotency_key, status,
            reserved_tokens, reserved_cost_cny)
         VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8)`,
        [
          uuidv7(),
          payload.actorId,
          payload.workId,
          payload.branchId,
          payload.jobId,
          blueprintReservationKey(step, attempt),
          projectedTokens,
          projectedCostCny,
        ],
      );
      await appendJobEvent(client, payload, "blueprint.step.started", {
        step,
        attempt,
        checkpointRevision: checkpoint.revision,
        projectedTokens,
        projectedCostCny,
      });
      return true;
    });
  }

  async recordProviderResult(
    payload: GenerateBlueprintJob,
    step: BlueprintJobStep,
    checkpoint: BlueprintCheckpoint,
    result: GenerationResult,
    cost: BlueprintCost,
  ): Promise<void> {
    await this.withTenantTransaction(payload.actorId, async (client) => {
      const current = await client.query<{ attempt: number }>(
        `SELECT attempt
           FROM job_steps
          WHERE job_id = $1 AND step_key = $2
          FOR UPDATE`,
        [payload.jobId, step],
      );
      const attempt = current.rows[0]?.attempt;
      if (!attempt) {
        throw new Error("Blueprint provider result has no reserved step attempt");
      }
      await client.query(
        `UPDATE job_steps
            SET status = 'running',
                output = COALESCE(output, '{}'::jsonb) ||
                         jsonb_build_object('providerResult', $3::jsonb,
                                            'costRecorded', true),
                cost = $4::jsonb
          WHERE job_id = $1 AND step_key = $2`,
        [payload.jobId, step, JSON.stringify(result), JSON.stringify(cost)],
      );
      await client.query(
        `UPDATE job_step_attempts
            SET output_refs = $4::jsonb, cost = $5::jsonb
          WHERE job_id = $1 AND step_key = $2 AND attempt = $3`,
        [
          payload.jobId,
          step,
          attempt,
          JSON.stringify([
            {
              type: "provider_request",
              id: result.providerRequestId ?? blueprintReservationKey(step, attempt),
            },
          ]),
          JSON.stringify(cost),
        ],
      );
      await client.query(
        `UPDATE cost_reservations
            SET status = 'settled', settled_tokens = $3, settled_cost_cny = $4,
                settled_at = now()
          WHERE job_id = $1 AND idempotency_key = $2`,
        [payload.jobId, blueprintReservationKey(step, attempt), cost.totalTokens, cost.costCny],
      );
      await client.query(
        `UPDATE jobs
            SET cost = jsonb_build_object(
                  'inputTokens', COALESCE((cost->>'inputTokens')::int, 0) + $2,
                  'outputTokens', COALESCE((cost->>'outputTokens')::int, 0) + $3,
                  'totalTokens', COALESCE((cost->>'totalTokens')::int, 0) + $4,
                  'costCny', COALESCE((cost->>'costCny')::double precision, 0) + $5
                ),
                updated_at = now()
          WHERE id = $1 AND user_id = $6`,
        [
          payload.jobId,
          cost.inputTokens,
          cost.outputTokens,
          cost.totalTokens,
          cost.costCny,
          payload.actorId,
        ],
      );
      await client.query(
        `UPDATE work_blueprints
            SET cost = jsonb_build_object(
                  'inputTokens', COALESCE((cost->>'inputTokens')::int, 0) + $4,
                  'outputTokens', COALESCE((cost->>'outputTokens')::int, 0) + $5,
                  'totalTokens', COALESCE((cost->>'totalTokens')::int, 0) + $6,
                  'costCny', COALESCE((cost->>'costCny')::double precision, 0) + $7
                ),
                updated_at = now()
          WHERE work_id = $1 AND branch_id = $2 AND user_id = $3`,
        [
          payload.workId,
          payload.branchId,
          payload.actorId,
          cost.inputTokens,
          cost.outputTokens,
          cost.totalTokens,
          cost.costCny,
        ],
      );
      await appendJobEvent(client, payload, "blueprint.provider.completed", {
        step,
        attempt,
        checkpointRevision: checkpoint.revision,
        inputTokens: cost.inputTokens,
        outputTokens: cost.outputTokens,
      });
    });
  }

  async commitStep(commit: BlueprintStepCommit): Promise<BlueprintCheckpoint> {
    return this.withTenantTransaction(commit.payload.actorId, async (client) => {
      const current = await client.query<{
        cost: BlueprintCost;
        checkpoint_version: number;
        checkpoint: unknown;
      }>(
        `SELECT cost, checkpoint_version, checkpoint
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
      const currentCheckpoint = blueprintCheckpointSchema.parse(row.checkpoint);
      const stepState = await client.query<{
        attempt: number;
        output: Record<string, unknown>;
        cost: BlueprintCost;
      }>(
        `SELECT attempt, output, cost
           FROM job_steps
          WHERE job_id = $1 AND step_key = $2
          FOR UPDATE`,
        [commit.payload.jobId, commit.step],
      );
      const attempt = stepState.rows[0]?.attempt ?? 1;
      const providerCostRecorded = stepState.rows[0]?.output.costRecorded === true;
      const cost = providerCostRecorded ? row.cost : addBlueprintCost(row.cost, commit.result.cost);
      const checkpoint: BlueprintCheckpoint = {
        schemaVersion: 1,
        revision,
        step: commit.nextStep,
        inputHash: currentCheckpoint.inputHash,
        payload: commit.result.checkpointPayload,
      };
      await client.query(
        `INSERT INTO job_steps
           (id, job_id, work_id, branch_id, user_id, step_key, status, attempt,
            output, cost, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', 1, $7::jsonb, $8::jsonb,
                 now(), now())
         ON CONFLICT (job_id, step_key)
         DO UPDATE SET status = 'succeeded', output = EXCLUDED.output,
                       cost = EXCLUDED.cost, finished_at = now()`,
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
        `UPDATE job_steps
            SET attempt = $3
          WHERE job_id = $1 AND step_key = $2`,
        [commit.payload.jobId, commit.step, attempt],
      );
      await client.query(
        `INSERT INTO job_step_attempts
           (id, job_id, work_id, branch_id, user_id, step_key, attempt, status,
            input_hash, output_refs, cost, checkpoint_revision, started_at, finished_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'succeeded', $8, '[]'::jsonb,
                 $9::jsonb, $10, now(), now())
         ON CONFLICT (job_id, step_key, attempt)
         DO UPDATE SET status = 'succeeded', checkpoint_revision = EXCLUDED.checkpoint_revision,
                       cost = EXCLUDED.cost, finished_at = now()`,
        [
          uuidv7(),
          commit.payload.jobId,
          commit.payload.workId,
          commit.payload.branchId,
          commit.payload.actorId,
          commit.step,
          attempt,
          checkpoint.inputHash,
          JSON.stringify(commit.result.cost),
          revision,
        ],
      );
      await client.query(
        `INSERT INTO job_checkpoints
           (id, job_id, work_id, branch_id, user_id, step_key, schema_version,
            revision, attempt, input_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10::jsonb)`,
        [
          uuidv7(),
          commit.payload.jobId,
          commit.payload.workId,
          commit.payload.branchId,
          commit.payload.actorId,
          commit.step,
          revision,
          attempt,
          checkpoint.inputHash,
          JSON.stringify(checkpoint),
        ],
      );
      await client.query(
        `UPDATE jobs
            SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'running' END,
                progress = $3, current_step = $4,
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
      await appendJobEvent(client, commit.payload, "blueprint.step.succeeded", {
        step: commit.step,
        attempt,
        checkpointRevision: revision,
        inputTokens: commit.result.cost.inputTokens,
        outputTokens: commit.result.cost.outputTokens,
      });
      return checkpoint;
    });
  }

  async completeReady(
    payload: GenerateBlueprintJob,
    loaded: LoadedBlueprintJob,
    checkpoint: BlueprintCheckpoint,
  ): Promise<void> {
    await this.withTenantTransaction(payload.actorId, async (client) => {
      const current = await client.query<{ job_status: string; blueprint_status: string }>(
        `SELECT j.status AS job_status, wb.status AS blueprint_status
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
          WHERE j.id = $1 AND j.user_id = $2
          FOR UPDATE OF j, wb`,
        [payload.jobId, payload.actorId],
      );
      const row = current.rows[0];
      if (row?.job_status !== "running" || row.blueprint_status !== "running") {
        return;
      }
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
        type: "blueprint_ready",
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
      const current = await client.query<{ job_status: string; blueprint_status: string }>(
        `SELECT j.status AS job_status, wb.status AS blueprint_status
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
          WHERE j.id = $1 AND j.user_id = $2
          FOR UPDATE OF j, wb`,
        [payload.jobId, payload.actorId],
      );
      const row = current.rows[0];
      if (row?.job_status === "cancelled" || row?.blueprint_status === "cancelled") {
        return;
      }
      await client.query(
        `UPDATE jobs
            SET status = 'paused', current_step = $3,
                error_code = 'MODEL_PROVIDER_ERROR',
                error_message = '缺少可用的故事蓝图模型配置', updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [payload.jobId, payload.actorId, loaded.job.checkpoint.step],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = 'waiting_model_config', current_step = $3, updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId, loaded.job.checkpoint.step],
      );
      await recordNotification(client, {
        userId: payload.actorId,
        workId: payload.workId,
        branchId: payload.branchId,
        type: "blueprint_waiting_model_config",
        targetId: payload.jobId,
        title: "故事蓝图正在等待模型配置",
        message: "配置可用的规划模型后，可从当前检查点继续。",
        href: `/workspace/settings/account`,
        dedupeKey: `blueprint:${payload.jobId}:waiting_model_config:${loaded.job.checkpoint.revision}`,
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
      const current = await client.query<{ job_status: string; blueprint_status: string }>(
        `SELECT j.status AS job_status, wb.status AS blueprint_status
           FROM jobs AS j
           INNER JOIN work_blueprints AS wb
             ON wb.job_id = j.id
            AND wb.user_id = j.user_id
            AND wb.work_id = j.work_id
            AND wb.branch_id = j.branch_id
          WHERE j.id = $1 AND j.user_id = $2
          FOR UPDATE OF j, wb`,
        [payload.jobId, payload.actorId],
      );
      const row = current.rows[0];
      if (row?.job_status === "cancelled" || row?.blueprint_status === "cancelled") {
        return;
      }
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
        type: "blueprint_budget_paused",
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
      const current = await client.query<{ cost: BlueprintCost; status: string }>(
        `SELECT cost, status
           FROM jobs
          WHERE id = $1 AND user_id = $2
          FOR UPDATE`,
        [payload.jobId, payload.actorId],
      );
      const existingCost = current.rows[0]?.cost;
      if (!existingCost) {
        throw new Error("Blueprint job disappeared during failure recording");
      }
      const cancelled = current.rows[0]?.status === "cancelled";
      const stepState = await client.query<{
        attempt: number;
        output: Record<string, unknown>;
      }>(
        `SELECT attempt, output
           FROM job_steps
          WHERE job_id = $1 AND step_key = $2
          FOR UPDATE`,
        [payload.jobId, step],
      );
      const attempt = stepState.rows[0]?.attempt;
      const failureCostRecorded = stepState.rows[0]?.output.costRecorded === true;
      const currentCost =
        failure.cost && !failureCostRecorded
          ? addBlueprintCost(existingCost, failure.cost)
          : existingCost;
      if (attempt) {
        if (failure.failureClass === "schema") {
          await client.query(
            `UPDATE job_steps
                SET output = output - 'providerResult' - 'costRecorded'
              WHERE job_id = $1 AND step_key = $2`,
            [payload.jobId, step],
          );
        }
        await client.query(
          `UPDATE job_steps
              SET status = 'failed', error_code = $3, error_message = $4,
                  finished_at = now()
            WHERE job_id = $1 AND step_key = $2`,
          [payload.jobId, step, failure.code, failure.message],
        );
        await client.query(
          `UPDATE job_step_attempts
              SET status = 'failed', error_code = $4, error_message = $5,
                  cost = COALESCE($6::jsonb, cost), checkpoint_revision = $7,
                  finished_at = now()
            WHERE job_id = $1 AND step_key = $2 AND attempt = $3`,
          [
            payload.jobId,
            step,
            attempt,
            failure.code,
            failure.message,
            failure.cost ? JSON.stringify(failure.cost) : null,
            checkpoint.revision,
          ],
        );
        if (failure.cost) {
          await client.query(
            `UPDATE cost_reservations
                SET status = 'settled', settled_tokens = $3, settled_cost_cny = $4,
                    failure_class = $5, settled_at = now()
              WHERE job_id = $1 AND idempotency_key = $2`,
            [
              payload.jobId,
              blueprintReservationKey(step, attempt),
              failure.cost.totalTokens,
              failure.cost.costCny,
              failure.failureClass,
            ],
          );
        } else {
          await client.query(
            `UPDATE cost_reservations
                SET status = 'released', failure_class = $3
              WHERE job_id = $1 AND idempotency_key = $2 AND status = 'reserved'`,
            [payload.jobId, blueprintReservationKey(step, attempt), failure.failureClass],
          );
        }
      }
      await client.query(
        `UPDATE jobs
            SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
                current_step = $3, error_code = $4,
                error_message = $5, cost = $6::jsonb,
                finished_at = now(), updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [
          payload.jobId,
          payload.actorId,
          step,
          failure.code,
          failure.message,
          JSON.stringify(currentCost),
        ],
      );
      await client.query(
        `UPDATE work_blueprints
            SET status = CASE WHEN status = 'cancelled' THEN 'cancelled' ELSE 'failed' END,
                current_step = $3, cost = $4::jsonb,
                updated_at = now()
          WHERE id = $1 AND user_id = $2`,
        [loaded.blueprint.id, payload.actorId, step, JSON.stringify(currentCost)],
      );
      await appendJobEvent(client, payload, "blueprint.step.failed", {
        step,
        ...(attempt ? { attempt } : {}),
        checkpointRevision: checkpoint.revision,
        errorCode: failure.code,
        failureClass: failure.failureClass,
        retryable: failure.retryable,
        ...(failure.cost ? { totalTokens: failure.cost.totalTokens } : {}),
      });
      if (!cancelled) {
        await recordNotification(client, {
          userId: payload.actorId,
          workId: payload.workId,
          branchId: payload.branchId,
          type: "blueprint_failed",
          targetId: payload.jobId,
          title: "故事蓝图生成失败",
          message: failure.message,
          href: `/workspace/${payload.workId}/blueprint`,
          dedupeKey: `blueprint:${payload.jobId}:failed:${checkpoint.revision}`,
        });
      }
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
    type:
      | "blueprint_ready"
      | "blueprint_failed"
      | "blueprint_waiting_model_config"
      | "blueprint_budget_paused";
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

async function appendJobEvent(
  client: DatabaseClient,
  payload: GenerateBlueprintJob,
  eventType: string,
  eventPayload: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO job_events
       (id, job_id, work_id, branch_id, user_id, sequence, event_type, payload)
     VALUES (
       $1, $2, $3, $4, $5,
       (SELECT COALESCE(MAX(sequence), 0) + 1 FROM job_events WHERE job_id = $2),
       $6, $7::jsonb
     )`,
    [
      uuidv7(),
      payload.jobId,
      payload.workId,
      payload.branchId,
      payload.actorId,
      eventType,
      JSON.stringify(eventPayload),
    ],
  );
}

function blueprintReservationKey(step: BlueprintJobStep, attempt: number): string {
  return `blueprint:${step}:attempt:${attempt}`;
}

function parsePendingProviderResult(
  value: unknown,
  stepKey: string | null,
): { step: BlueprintJobStep; result: GenerationResult } | undefined {
  if (
    !stepKey ||
    !BLUEPRINT_JOB_STEPS.includes(stepKey as BlueprintJobStep) ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const usage = record.usage;
  if (
    typeof record.text !== "string" ||
    typeof record.model !== "string" ||
    record.finishReason !== "stop" ||
    !usage ||
    typeof usage !== "object" ||
    Array.isArray(usage)
  ) {
    return undefined;
  }
  const usageRecord = usage as Record<string, unknown>;
  if (typeof usageRecord.inputTokens !== "number" || typeof usageRecord.outputTokens !== "number") {
    return undefined;
  }
  return {
    step: stepKey as BlueprintJobStep,
    result: {
      text: record.text,
      model: record.model,
      finishReason: "stop",
      usage: {
        inputTokens: usageRecord.inputTokens,
        outputTokens: usageRecord.outputTokens,
      },
      ...(typeof record.providerRequestId === "string"
        ? { providerRequestId: record.providerRequestId }
        : {}),
    },
  };
}

function configuredModelRate(model: string): number | undefined {
  const modelRates = parseConfiguredModelRates();
  const modelRate = modelRates[model];
  if (modelRate !== undefined) {
    return modelRate;
  }
  const value = Number(process.env.BLUEPRINT_MODEL_RATE_PER_TOKEN_CNY ?? "");
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function configuredContextWindowTokens(model: string): number | undefined {
  const modelContextWindows = parseConfiguredModelContextWindows();
  const modelContextWindow = modelContextWindows[model];
  if (modelContextWindow !== undefined) {
    return modelContextWindow;
  }
  const value = Number(process.env.BLUEPRINT_MODEL_CONTEXT_WINDOW_TOKENS ?? "");
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function parseConfiguredModelRates(): Record<string, number> {
  return parseConfiguredModelNumbers(process.env.BLUEPRINT_MODEL_RATES_JSON);
}

function parseConfiguredModelContextWindows(): Record<string, number> {
  return parseConfiguredModelNumbers(process.env.BLUEPRINT_MODEL_CONTEXT_WINDOWS_JSON);
}

function parseConfiguredModelNumbers(raw: string | undefined): Record<string, number> {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([model, value]) =>
        typeof value === "number" && Number.isFinite(value) && value > 0 ? [[model, value]] : [],
      ),
    );
  } catch {
    return {};
  }
}
