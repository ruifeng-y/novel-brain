import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { createDatabaseClient, createDatabasePool, type DatabaseClient } from "./client";
import { costReservations, jobs } from "./schema";

export type CostFailureClass =
  "provider" | "timeout" | "rate_limit" | "schema" | "policy" | "budget" | "cancelled" | "unknown";

export type CostReservationStatus = "reserved" | "settled" | "released";

export interface CostReservationRecord {
  id: string;
  userId: string;
  workId: string;
  branchId: string;
  jobId: string;
  agentRunId: string | null;
  idempotencyKey: string;
  status: CostReservationStatus;
  reservedTokens: number;
  reservedCostCny: number;
  settledTokens: number;
  settledCostCny: number;
  failureClass: CostFailureClass | null;
  createdAt: Date;
  settledAt: Date | null;
}

type Transaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export class BudgetReservationError extends Error {
  readonly failureClass = "budget" as const;

  constructor(
    readonly details: {
      maxCostCny: number;
      maxTokens: number;
      usedCostCny: number;
      usedTokens: number;
      reservedCostCny: number;
      reservedTokens: number;
      requestedCostCny: number;
      requestedTokens: number;
    },
  ) {
    super("Generation budget reservation would exceed the job budget");
    this.name = "BudgetReservationError";
  }
}

export class CostSettlementConflictError extends Error {
  constructor(message = "Cost reservation was already settled with different usage") {
    super(message);
    this.name = "CostSettlementConflictError";
  }
}

export async function reserveBudgetInTransaction(
  transaction: Transaction,
  input: {
    userId: string;
    workId: string;
    branchId: string;
    jobId: string;
    agentRunId?: string | null;
    idempotencyKey: string;
    estimatedTokens: number;
    estimatedCostCny: number;
    now?: Date;
  },
): Promise<{ reservation: CostReservationRecord; created: boolean }> {
  const now = input.now ?? new Date();
  const [jobMetadata] = await transaction
    .select({ parentJobId: jobs.parentJobId })
    .from(jobs)
    .where(and(eq(jobs.id, input.jobId), eq(jobs.userId, input.userId)))
    .limit(1);
  if (!jobMetadata) {
    throw new Error("Cost reservation job is not accessible for this tenant");
  }
  const [parentJob] = jobMetadata.parentJobId
    ? await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, jobMetadata.parentJobId), eq(jobs.userId, input.userId)))
        .for("update")
        .limit(1)
    : [undefined];
  const [job] = await transaction
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, input.jobId), eq(jobs.userId, input.userId)))
    .for("update")
    .limit(1);
  if (!job || job.workId !== input.workId || job.branchId !== input.branchId) {
    throw new Error("Cost reservation job is not accessible for this tenant");
  }

  const [existing] = await transaction
    .select()
    .from(costReservations)
    .where(
      and(
        eq(costReservations.jobId, input.jobId),
        eq(costReservations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    return { reservation: toReservationRecord(existing), created: false };
  }

  const active = await activeReservationTotals(transaction, input.jobId);
  const cost = job.cost as { costCny?: unknown; totalTokens?: unknown };
  const budget = job.budget as { maxCostCny?: unknown; maxTokens?: unknown };
  const usedCostCny = finiteNumber(cost.costCny, 0);
  const usedTokens = finiteNumber(cost.totalTokens, 0);
  const maxCostCny = finiteNumber(budget.maxCostCny, Number.POSITIVE_INFINITY);
  const maxTokens = finiteNumber(budget.maxTokens, Number.POSITIVE_INFINITY);
  // ADR 0021 requires a hard stop before the provider call when the reservation cannot fit.
  if (
    usedCostCny + active.costCny + input.estimatedCostCny > maxCostCny ||
    usedTokens + active.tokens + input.estimatedTokens > maxTokens
  ) {
    throw new BudgetReservationError({
      maxCostCny,
      maxTokens,
      usedCostCny,
      usedTokens,
      reservedCostCny: active.costCny,
      reservedTokens: active.tokens,
      requestedCostCny: input.estimatedCostCny,
      requestedTokens: input.estimatedTokens,
    });
  }
  if (parentJob) {
    const planBudget = parentJob.budget as {
      taskMaxCostCny?: unknown;
      volumeMaxCostCny?: unknown;
      perTenThousandCharactersLimitCny?: unknown;
    };
    const taskMaxCostCny = finiteNumber(planBudget.taskMaxCostCny, Number.POSITIVE_INFINITY);
    const volumeMaxCostCny = finiteNumber(planBudget.volumeMaxCostCny, Number.POSITIVE_INFINITY);
    const perTenThousandCharactersLimitCny = finiteNumber(
      planBudget.perTenThousandCharactersLimitCny,
      Number.POSITIVE_INFINITY,
    );
    const planUsage = await batchPlanUsage(transaction, parentJob.id, job.chapterId);
    const limits = [
      {
        max: taskMaxCostCny,
        used: planUsage.taskCostCny,
        reserved: planUsage.taskReservedCostCny,
        label: "task",
      },
      {
        max: volumeMaxCostCny,
        used: planUsage.volumeCostCny,
        reserved: planUsage.volumeReservedCostCny,
        label: "volume",
      },
      {
        max: perTenThousandCharactersLimitCny,
        used: planUsage.taskCostCny,
        reserved: planUsage.taskReservedCostCny,
        label: "per_ten_thousand_characters",
      },
    ];
    const binding = limits.find(
      (limit) => limit.used + limit.reserved + input.estimatedCostCny > limit.max,
    );
    if (binding) {
      throw new BudgetReservationError({
        maxCostCny: binding.max,
        maxTokens: Number.POSITIVE_INFINITY,
        usedCostCny: binding.used,
        usedTokens: 0,
        reservedCostCny: binding.reserved,
        reservedTokens: 0,
        requestedCostCny: input.estimatedCostCny,
        requestedTokens: input.estimatedTokens,
      });
    }
  }

  const [reservation] = await transaction
    .insert(costReservations)
    .values({
      id: uuidv7(),
      userId: input.userId,
      workId: input.workId,
      branchId: input.branchId,
      jobId: input.jobId,
      agentRunId: input.agentRunId ?? null,
      idempotencyKey: input.idempotencyKey,
      status: "reserved",
      reservedTokens: input.estimatedTokens,
      reservedCostCny: roundCost(input.estimatedCostCny),
      settledTokens: 0,
      settledCostCny: 0,
      createdAt: now,
    })
    .returning();
  if (!reservation) {
    throw new Error("Cost reservation insert returned no row");
  }
  return { reservation: toReservationRecord(reservation), created: true };
}

async function batchPlanUsage(
  transaction: Transaction,
  planId: string,
  chapterId: string | null,
): Promise<{
  taskCostCny: number;
  taskReservedCostCny: number;
  volumeCostCny: number;
  volumeReservedCostCny: number;
}> {
  const result = await transaction.execute(sql`
    WITH RECURSIVE child_jobs AS (
      SELECT id, chapter_id, cost
      FROM jobs
      WHERE parent_job_id = ${planId}
    ),
    child_reservations AS (
      SELECT reservation.reserved_cost_cny, child.chapter_id
      FROM cost_reservations reservation
      INNER JOIN child_jobs child ON child.id = reservation.job_id
      WHERE reservation.status = 'reserved'
    ),
    ancestors AS (
      SELECT id, parent_id, level
      FROM outline_nodes
      WHERE chapter_id = ${chapterId}
      UNION ALL
      SELECT parent.id, parent.parent_id, parent.level
      FROM outline_nodes parent
      INNER JOIN ancestors child ON child.parent_id = parent.id
    ),
    volume_node AS (
      SELECT id FROM ancestors WHERE level = 'volume' LIMIT 1
    ),
    volume_descendants AS (
      SELECT id FROM volume_node
      UNION ALL
      SELECT node.id
      FROM outline_nodes node
      INNER JOIN volume_descendants parent ON node.parent_id = parent.id
    ),
    volume_chapters AS (
      SELECT chapter_id FROM outline_nodes
      WHERE id IN (SELECT id FROM volume_descendants) AND chapter_id IS NOT NULL
    )
    SELECT
      COALESCE((SELECT sum(COALESCE((cost ->> 'costCny')::numeric, 0)) FROM child_jobs), 0)::text
        AS task_cost,
      COALESCE((SELECT sum(reserved_cost_cny) FROM child_reservations), 0)::text
        AS task_reserved_cost,
      COALESCE((
        SELECT sum(COALESCE((cost ->> 'costCny')::numeric, 0))
        FROM child_jobs
        WHERE chapter_id IN (SELECT chapter_id FROM volume_chapters)
      ), 0)::text AS volume_cost,
      COALESCE((
        SELECT sum(reserved_cost_cny)
        FROM child_reservations
        WHERE chapter_id IN (SELECT chapter_id FROM volume_chapters)
      ), 0)::text AS volume_reserved_cost
  `);
  const row = result.rows[0] as
    | {
        task_cost: string;
        task_reserved_cost: string;
        volume_cost: string;
        volume_reserved_cost: string;
      }
    | undefined;
  return {
    taskCostCny: Number(row?.task_cost ?? 0),
    taskReservedCostCny: Number(row?.task_reserved_cost ?? 0),
    volumeCostCny: Number(row?.volume_cost ?? 0),
    volumeReservedCostCny: Number(row?.volume_reserved_cost ?? 0),
  };
}

export async function settleBudgetInTransaction(
  transaction: Transaction,
  input: {
    userId: string;
    jobId: string;
    idempotencyKey: string;
    actualTokens: number;
    actualCostCny: number;
    actualInputTokens?: number;
    actualOutputTokens?: number;
    now?: Date;
  },
): Promise<CostReservationRecord> {
  const now = input.now ?? new Date();
  const [job] = await transaction
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, input.jobId), eq(jobs.userId, input.userId)))
    .for("update")
    .limit(1);
  if (!job) {
    throw new Error("Cost settlement job is not accessible for this tenant");
  }
  const [existing] = await transaction
    .select()
    .from(costReservations)
    .where(
      and(
        eq(costReservations.jobId, input.jobId),
        eq(costReservations.idempotencyKey, input.idempotencyKey),
      ),
    )
    .for("update")
    .limit(1);
  if (!existing) {
    throw new Error("Cost reservation does not exist");
  }
  if (existing.status === "released") {
    throw new Error("Released cost reservations cannot be settled");
  }
  if (existing.status === "settled") {
    if (
      existing.settledTokens !== input.actualTokens ||
      roundCost(existing.settledCostCny) !== roundCost(input.actualCostCny)
    ) {
      throw new CostSettlementConflictError();
    }
    return toReservationRecord(existing);
  }
  const budgetOverrun =
    input.actualTokens > existing.reservedTokens ||
    roundCost(input.actualCostCny) > roundCost(existing.reservedCostCny);

  const [settled] = await transaction
    .update(costReservations)
    .set({
      status: "settled",
      settledTokens: input.actualTokens,
      settledCostCny: roundCost(input.actualCostCny),
      settledAt: now,
      failureClass: budgetOverrun ? "budget" : existing.failureClass,
    })
    .where(eq(costReservations.id, existing.id))
    .returning();
  if (!settled) {
    throw new Error("Cost settlement update returned no row");
  }
  const current = job.cost as {
    inputTokens?: unknown;
    outputTokens?: unknown;
    totalTokens?: unknown;
    costCny?: unknown;
  };
  const inputTokens =
    finiteNumber(current.inputTokens, 0) + finiteNumber(input.actualInputTokens, 0);
  const outputTokens =
    finiteNumber(current.outputTokens, 0) + finiteNumber(input.actualOutputTokens, 0);
  const totalTokens = finiteNumber(current.totalTokens, inputTokens + outputTokens);
  await transaction
    .update(jobs)
    .set({
      cost: {
        inputTokens,
        outputTokens,
        totalTokens: totalTokens + input.actualTokens,
        costCny: roundCost(finiteNumber(current.costCny, 0) + input.actualCostCny),
      },
      updatedAt: now,
    })
    .where(eq(jobs.id, job.id));
  return toReservationRecord(settled);
}

export async function releaseBudgetInTransaction(
  transaction: Transaction,
  input: {
    userId: string;
    jobId: string;
    idempotencyKey: string;
    failureClass: CostFailureClass;
    now?: Date;
  },
): Promise<CostReservationRecord | null> {
  const [existing] = await transaction
    .select()
    .from(costReservations)
    .where(
      and(
        eq(costReservations.jobId, input.jobId),
        eq(costReservations.idempotencyKey, input.idempotencyKey),
        eq(costReservations.userId, input.userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!existing) {
    return null;
  }
  if (existing.status !== "reserved") {
    return toReservationRecord(existing);
  }
  const [released] = await transaction
    .update(costReservations)
    .set({
      status: "released",
      failureClass: input.failureClass,
    })
    .where(eq(costReservations.id, existing.id))
    .returning();
  return released ? toReservationRecord(released) : null;
}

export class CostLedger {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async reserve(input: Parameters<typeof reserveBudgetInTransaction>[1]) {
    return this.withTenant(input.userId, (transaction) =>
      reserveBudgetInTransaction(transaction, input),
    );
  }

  async settle(input: Parameters<typeof settleBudgetInTransaction>[1]) {
    return this.withTenant(input.userId, (transaction) =>
      settleBudgetInTransaction(transaction, input),
    );
  }

  async release(input: Parameters<typeof releaseBudgetInTransaction>[1]) {
    return this.withTenant(input.userId, (transaction) =>
      releaseBudgetInTransaction(transaction, input),
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: Transaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction as unknown as Transaction);
    });
  }
}

async function activeReservationTotals(
  transaction: Transaction,
  jobId: string,
): Promise<{ costCny: number; tokens: number }> {
  const rows = await transaction
    .select({
      costCny: costReservations.reservedCostCny,
      tokens: costReservations.reservedTokens,
    })
    .from(costReservations)
    .where(and(eq(costReservations.jobId, jobId), eq(costReservations.status, "reserved")));
  return rows.reduce(
    (totals, row) => ({
      costCny: roundCost(totals.costCny + row.costCny),
      tokens: totals.tokens + row.tokens,
    }),
    { costCny: 0, tokens: 0 },
  );
}

function toReservationRecord(record: typeof costReservations.$inferSelect): CostReservationRecord {
  return {
    id: record.id,
    userId: record.userId,
    workId: record.workId,
    branchId: record.branchId,
    jobId: record.jobId,
    agentRunId: record.agentRunId,
    idempotencyKey: record.idempotencyKey,
    status: record.status as CostReservationStatus,
    reservedTokens: record.reservedTokens,
    reservedCostCny: record.reservedCostCny,
    settledTokens: record.settledTokens,
    settledCostCny: record.settledCostCny,
    failureClass: record.failureClass as CostFailureClass | null,
    createdAt: record.createdAt,
    settledAt: record.settledAt,
  };
}

export function calculateModelCallCost(tokens: number, costPerTokenCny: number): number {
  return Number((tokens * costPerTokenCny).toFixed(8));
}

function finiteNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}
