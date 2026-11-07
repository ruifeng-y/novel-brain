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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}
