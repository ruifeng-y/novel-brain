import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  orchestratorRunStateSchema,
  ORCHESTRATOR_AGENT_WORKFLOW_JOB,
  type OrchestratorEvent,
  type OrchestratorRunState,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import { outputRefsFromStepOutput } from "@novel-brain/core";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

type OrchestratorTransaction = Pick<PoolClient, "query">;

export class OrchestratorNotFoundError extends Error {
  constructor(readonly code: "run_not_found" | "run_conflict") {
    super(code);
    this.name = "OrchestratorNotFoundError";
  }
}

export interface OrchestratorMutation {
  state: OrchestratorRunState;
  events: OrchestratorEvent[];
}

@Injectable()
export class AgentOrchestratorRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async findByIdempotency(
    userId: string,
    workId: string,
    branchId: string,
    idempotencyKey: string,
  ): Promise<OrchestratorRunState | null> {
    return this.withTenant(userId, (transaction) =>
      findByIdempotency(transaction, userId, workId, branchId, idempotencyKey),
    );
  }

  async schedule(input: {
    userId: string;
    state: OrchestratorRunState;
    event: OrchestratorEvent;
  }): Promise<OrchestratorRunState> {
    return this.withTenant(input.userId, async (transaction) => {
      await lockIdempotency(
        transaction,
        input.userId,
        input.state.workId,
        input.state.branchId,
        input.state.idempotencyKey,
      );
      const existing = await findByIdempotency(
        transaction,
        input.userId,
        input.state.workId,
        input.state.branchId,
        input.state.idempotencyKey,
      );
      if (existing) {
        return existing;
      }

      const conflict = await transaction.query<{ id: string }>(
        "SELECT id FROM jobs WHERE id = $1 AND user_id = $2",
        [input.state.runId, input.userId],
      );
      if (conflict.rowCount) {
        throw new OrchestratorNotFoundError("run_conflict");
      }

      const inserted = await transaction.query<{ id: string }>(
        `INSERT INTO jobs (
           id, work_id, branch_id, user_id, chapter_id, model_config_id, type, status,
           progress, current_step, priority, idempotency_key, budget, checkpoint,
           orchestration, cost, error_code, error_message, started_at, finished_at
         ) VALUES (
           $1, $2, $3, $4, NULL, NULL, $5, $6,
           0, 'orchestrator', $7, $8, $9::jsonb, $10::jsonb,
           $11::jsonb, $12::jsonb, NULL, NULL, NULL, NULL
         )
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          input.state.runId,
          input.state.workId,
          input.state.branchId,
          input.userId,
          ORCHESTRATOR_AGENT_WORKFLOW_JOB,
          input.state.status,
          Math.max(...input.state.tasks.map((task) => task.priority)),
          input.state.idempotencyKey,
          JSON.stringify(input.state.envelope.budget),
          JSON.stringify({
            step: "orchestrator",
            payload: { orchestratorSequence: input.state.lastSequence },
          }),
          JSON.stringify(input.state),
          JSON.stringify({ inputTokens: 0, outputTokens: 0, totalTokens: 0, costCny: 0 }),
        ],
      );
      if (!inserted.rowCount) {
        const replay = await findByIdempotency(
          transaction,
          input.userId,
          input.state.workId,
          input.state.branchId,
          input.state.idempotencyKey,
        );
        if (replay) {
          return replay;
        }
        throw new OrchestratorNotFoundError("run_conflict");
      }

      await appendEvents(transaction, input.state, [input.event], "orchestrator");
      await syncSteps(transaction, input.state);
      await appendCheckpoint(transaction, input.state, "orchestrator");
      return input.state;
    });
  }

  async load(runId: string, userId: string): Promise<OrchestratorRunState> {
    return this.withTenant(userId, async (transaction) => {
      const state = await loadState(transaction, runId, userId, false);
      if (!state) {
        throw new OrchestratorNotFoundError("run_not_found");
      }
      return state;
    });
  }

  async mutate(
    runId: string,
    userId: string,
    transition: (state: OrchestratorRunState) => OrchestratorMutation,
  ): Promise<OrchestratorRunState> {
    return this.withTenant(userId, async (transaction) => {
      await lockRun(transaction, runId);
      const state = await loadState(transaction, runId, userId, true);
      if (!state) {
        throw new OrchestratorNotFoundError("run_not_found");
      }
      const result = transition(state);
      if (result.events.length === 0) {
        return state;
      }
      await persist(transaction, result.state, result.events);
      return result.state;
    });
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: OrchestratorTransaction) => Promise<T>,
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
}

async function loadState(
  transaction: OrchestratorTransaction,
  runId: string,
  userId: string,
  lock: boolean,
): Promise<OrchestratorRunState | null> {
  const result = await transaction.query<{ orchestration: unknown }>(
    `SELECT j.orchestration
     FROM jobs j
     INNER JOIN works w ON w.id = j.work_id AND w.user_id = j.user_id
     WHERE j.id = $1
       AND j.user_id = $2
       AND j.type = 'agent_workflow'
       AND w.deleted_at IS NULL
     ${lock ? "FOR UPDATE OF j" : ""}`,
    [runId, userId],
  );
  const row = result.rows[0];
  if (!row?.orchestration) {
    return null;
  }
  return orchestratorRunStateSchema.parse(row.orchestration);
}

async function findByIdempotency(
  transaction: OrchestratorTransaction,
  userId: string,
  workId: string,
  branchId: string,
  idempotencyKey: string,
): Promise<OrchestratorRunState | null> {
  const result = await transaction.query<{ orchestration: unknown }>(
    `SELECT orchestration
     FROM jobs
     WHERE user_id = $1
       AND work_id = $2
       AND branch_id = $3
       AND idempotency_key = $4
       AND type = 'agent_workflow'
     LIMIT 1`,
    [userId, workId, branchId, idempotencyKey],
  );
  const row = result.rows[0];
  return row?.orchestration ? orchestratorRunStateSchema.parse(row.orchestration) : null;
}

async function lockIdempotency(
  transaction: OrchestratorTransaction,
  userId: string,
  workId: string,
  branchId: string,
  idempotencyKey: string,
): Promise<void> {
  await transaction.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('novelbrain:agent-orchestrator'),
       hashtext($1)
     )`,
    [`${userId}:${workId}:${branchId}:${idempotencyKey}`],
  );
}

async function lockRun(transaction: OrchestratorTransaction, runId: string): Promise<void> {
  await transaction.query(
    `SELECT pg_advisory_xact_lock(
       hashtext('novelbrain:agent-orchestrator-run'),
       hashtext($1)
     )`,
    [runId],
  );
}

async function persist(
  transaction: OrchestratorTransaction,
  state: OrchestratorRunState,
  events: OrchestratorEvent[],
): Promise<void> {
  const latest = events.at(-1);
  const currentStep = latest?.stepKey
    ? `${latest.taskKey ?? "task"}.${latest.stepKey}`
    : (latest?.taskKey ?? "orchestrator");
  const terminalTasks = state.tasks.filter((task) =>
    ["succeeded", "failed", "skipped", "cancelled"].includes(task.status),
  ).length;
  const progress =
    state.status === "waiting_review"
      ? 100
      : Math.round((terminalTasks / state.tasks.length) * 100);
  const started = state.status === "running" || state.status === "waiting_review";
  const finished = ["completed", "failed", "cancelled"].includes(state.status);
  const error =
    state.status === "failed"
      ? { code: "ORCHESTRATOR_TASK_FAILED", message: state.failureMessage ?? "Workflow failed" }
      : state.status === "cancelled"
        ? { code: "JOB_CANCELLED", message: state.cancelReason ?? "Workflow cancelled" }
        : { code: null, message: null };

  await transaction.query(
    `UPDATE jobs
     SET status = $2,
         progress = $3,
         current_step = $4,
         orchestration = $5::jsonb,
         checkpoint = $6::jsonb,
         error_code = $7,
         error_message = $8,
         started_at = CASE WHEN $9 THEN COALESCE(started_at, now()) ELSE started_at END,
         finished_at = CASE WHEN $10 THEN COALESCE(finished_at, now()) ELSE NULL END,
         updated_at = now()
     WHERE id = $1`,
    [
      state.runId,
      state.status,
      progress,
      currentStep,
      JSON.stringify(state),
      JSON.stringify({
        step: currentStep,
        payload: { orchestratorSequence: state.lastSequence },
      }),
      error.code,
      error.message,
      started,
      finished,
    ],
  );
  await appendEvents(transaction, state, events, currentStep);
  await syncSteps(transaction, state);
  await appendCheckpoint(transaction, state, currentStep);
}

async function appendEvents(
  transaction: OrchestratorTransaction,
  state: OrchestratorRunState,
  events: OrchestratorEvent[],
  currentStep: string,
): Promise<void> {
  for (const event of events) {
    await transaction.query(
      `INSERT INTO job_events (
         id, job_id, work_id, branch_id, user_id, sequence, event_type, payload, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (job_id, sequence) DO NOTHING`,
      [
        uuidv7(),
        state.runId,
        state.workId,
        state.branchId,
        state.ownerId,
        event.sequence,
        event.type,
        JSON.stringify({
          ...eventLogData(event),
          eventId: event.eventId,
          taskKey: event.taskKey,
          stepKey: event.stepKey,
          currentStep,
        }),
        event.occurredAt,
      ],
    );
  }
}

function eventLogData(event: OrchestratorEvent): Record<string, unknown> {
  if (event.type === "step.succeeded") {
    const output = event.data.output;
    return {
      outputKeys:
        typeof output === "object" && output !== null && !Array.isArray(output)
          ? Object.keys(output).sort()
          : [],
      outputBytes: output === undefined ? 0 : Buffer.byteLength(JSON.stringify(output), "utf8"),
    };
  }
  if (event.type === "tasks.added") {
    const tasks = Array.isArray(event.data.tasks) ? event.data.tasks : [];
    return {
      parentTaskKey: event.data.parentTaskKey,
      tasks: tasks.map((task) => {
        const candidate =
          typeof task === "object" && task !== null
            ? (task as { id?: unknown; key?: unknown; role?: unknown; steps?: unknown })
            : {};
        return {
          id: candidate.id,
          key: candidate.key,
          role: candidate.role,
          stepKeys: Array.isArray(candidate.steps)
            ? candidate.steps.map((step) =>
                typeof step === "object" && step !== null && "key" in step
                  ? (step as { key: unknown }).key
                  : null,
              )
            : [],
        };
      }),
    };
  }
  return event.data;
}

async function syncSteps(
  transaction: OrchestratorTransaction,
  state: OrchestratorRunState,
): Promise<void> {
  for (const task of state.tasks) {
    for (const step of task.steps) {
      if (step.status === "pending") {
        continue;
      }
      const stepKey = `${task.key}.${step.key}`;
      const inputHash = createHash("sha256").update(stableStringify(step.input)).digest("hex");
      const outputRefs = outputRefsFromStepOutput(step.output);
      const startedAt =
        step.status === "running" || step.status === "succeeded" || step.status === "failed"
          ? new Date()
          : null;
      const finishedAt = ["succeeded", "failed", "skipped", "cancelled"].includes(step.status)
        ? new Date()
        : null;
      await transaction.query(
        `INSERT INTO job_steps (
           id, job_id, work_id, branch_id, user_id, step_key, status, attempt,
           input_hash, output, output_refs, cost, error_code, error_message,
           started_at, finished_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16
         )
         ON CONFLICT (job_id, step_key) DO UPDATE SET
           status = EXCLUDED.status,
           attempt = EXCLUDED.attempt,
           input_hash = EXCLUDED.input_hash,
           output = EXCLUDED.output,
           output_refs = EXCLUDED.output_refs,
           error_code = EXCLUDED.error_code,
           error_message = EXCLUDED.error_message,
           started_at = COALESCE(job_steps.started_at, EXCLUDED.started_at),
           finished_at = EXCLUDED.finished_at`,
        [
          uuidv7(),
          state.runId,
          state.workId,
          state.branchId,
          state.ownerId,
          stepKey,
          step.status,
          step.attempt,
          inputHash,
          JSON.stringify(step.output),
          JSON.stringify(outputRefs),
          JSON.stringify({ estimatedCostCny: step.estimatedCostCny }),
          step.errorCode,
          step.errorMessage,
          startedAt,
          finishedAt,
        ],
      );
      await transaction.query(
        `INSERT INTO job_step_attempts (
           id, job_id, work_id, branch_id, user_id, step_key, attempt, status,
           input_hash, output_refs, checkpoint_revision, error_code, error_message,
           started_at, finished_at, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8,
           $9, $10::jsonb, 0, $11, $12, $13, $14, now()
         )
         ON CONFLICT (job_id, step_key, attempt) DO UPDATE SET
           status = EXCLUDED.status,
           output_refs = EXCLUDED.output_refs,
           error_code = EXCLUDED.error_code,
           error_message = EXCLUDED.error_message,
           finished_at = EXCLUDED.finished_at`,
        [
          uuidv7(),
          state.runId,
          state.workId,
          state.branchId,
          state.ownerId,
          stepKey,
          Math.max(1, step.attempt),
          step.status,
          inputHash,
          JSON.stringify(outputRefs),
          step.errorCode,
          step.errorMessage,
          startedAt ?? new Date(),
          finishedAt,
        ],
      );
    }
  }
}

async function appendCheckpoint(
  transaction: OrchestratorTransaction,
  state: OrchestratorRunState,
  currentStep: string,
): Promise<void> {
  const result = await transaction.query<{ checkpoint_version: number }>(
    "SELECT checkpoint_version FROM jobs WHERE id = $1 FOR UPDATE",
    [state.runId],
  );
  const revision = Number(result.rows[0]?.checkpoint_version ?? 0) + 1;
  const outputRefs = state.tasks.flatMap((task) =>
    task.steps.flatMap((step) => outputRefsFromStepOutput(step.output)),
  );
  const inputHash = createHash("sha256").update(stableStringify(state)).digest("hex");
  const checkpoint = {
    schemaVersion: 1,
    revision,
    step: currentStep,
    inputHash,
    outputRefs,
    payload: { status: state.status, lastSequence: state.lastSequence },
  };
  await transaction.query(
    `INSERT INTO job_checkpoints (
       id, job_id, work_id, branch_id, user_id, step_key, schema_version,
       revision, attempt, input_hash, output_refs, payload, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, 1, $7, 0, $8, $9::jsonb, $10::jsonb, now()
     )`,
    [
      uuidv7(),
      state.runId,
      state.workId,
      state.branchId,
      state.ownerId,
      currentStep,
      revision,
      inputHash,
      JSON.stringify(outputRefs),
      JSON.stringify(checkpoint),
    ],
  );
  await transaction.query(
    "UPDATE jobs SET checkpoint = $2::jsonb, checkpoint_version = $3 WHERE id = $1",
    [state.runId, JSON.stringify(checkpoint), revision],
  );
  await transaction.query(
    "UPDATE job_step_attempts SET checkpoint_revision = $2 WHERE job_id = $1",
    [state.runId, revision],
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
