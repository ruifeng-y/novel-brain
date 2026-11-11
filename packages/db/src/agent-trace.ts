import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

import { createDatabaseClient, createDatabasePool, type DatabaseClient } from "./client";
import {
  agentRuns,
  agentToolCalls,
  costReservations,
  modelCalls,
  promptVersions,
  workBranches,
  works,
} from "./schema";

export type AgentRunRecord = InferSelectModel<typeof agentRuns>;
export type PromptVersionRecord = InferSelectModel<typeof promptVersions>;
export type ModelCallRecord = InferSelectModel<typeof modelCalls>;
export type AgentTraceToolCallRecord = InferSelectModel<typeof agentToolCalls>;
export type AgentTraceReservationRecord = InferSelectModel<typeof costReservations>;

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface AgentTraceScope {
  workId: string;
  branchId: string;
}

export interface AgentTraceFilter {
  chapterId?: string;
  jobId?: string;
  limit?: number;
  cursor?: string;
}

export interface AgentTraceRecord {
  run: AgentRunRecord;
  promptVersions: PromptVersionRecord[];
  modelCalls: ModelCallRecord[];
  toolCalls: AgentTraceToolCallRecord[];
  costReservations: AgentTraceReservationRecord[];
}

export class AgentTraceStore {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listTraces(
    userId: string,
    scope: AgentTraceScope,
    filter: AgentTraceFilter = {},
  ): Promise<{ traces: AgentTraceRecord[]; nextCursor: string | null } | "invalid_cursor"> {
    return this.withTenant(userId, async (transaction) => {
      const conditions = [
        eq(agentRuns.userId, userId),
        eq(agentRuns.workId, scope.workId),
        eq(agentRuns.branchId, scope.branchId),
      ];
      if (filter.chapterId) {
        conditions.push(eq(agentRuns.chapterId, filter.chapterId));
      }
      if (filter.jobId) {
        conditions.push(eq(agentRuns.jobId, filter.jobId));
      }
      if (filter.cursor) {
        const [cursor] = await transaction
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.id, filter.cursor),
              eq(agentRuns.userId, userId),
              eq(agentRuns.workId, scope.workId),
              eq(agentRuns.branchId, scope.branchId),
            ),
          )
          .limit(1);
        if (!cursor) {
          return "invalid_cursor";
        }
        conditions.push(gt(agentRuns.id, filter.cursor));
      }
      const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
      const runs = await transaction
        .select()
        .from(agentRuns)
        .where(and(...conditions))
        .orderBy(asc(agentRuns.id))
        .limit(limit + 1);
      const hasMore = runs.length > limit;
      const pageRuns = hasMore ? runs.slice(0, limit) : runs;
      return {
        traces: await hydrateTraces(transaction, pageRuns),
        nextCursor: hasMore ? (pageRuns.at(-1)?.id ?? null) : null,
      };
    });
  }

  async scopeExists(userId: string, scope: AgentTraceScope): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [row] = await transaction
        .select({ id: workBranches.id })
        .from(workBranches)
        .innerJoin(
          works,
          and(eq(works.id, workBranches.workId), eq(works.userId, workBranches.userId)),
        )
        .where(
          and(
            eq(works.id, scope.workId),
            eq(works.userId, userId),
            isNull(works.deletedAt),
            eq(workBranches.id, scope.branchId),
            eq(workBranches.workId, scope.workId),
            eq(workBranches.userId, userId),
          ),
        )
        .limit(1);
      return Boolean(row);
    });
  }

  async findTrace(
    userId: string,
    scope: AgentTraceScope,
    runId: string,
  ): Promise<AgentTraceRecord | null> {
    return this.withTenant(userId, async (transaction) => {
      const runs = await transaction
        .select()
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.id, runId),
            eq(agentRuns.userId, userId),
            eq(agentRuns.workId, scope.workId),
            eq(agentRuns.branchId, scope.branchId),
          ),
        )
        .limit(1);
      const traces = await hydrateTraces(transaction, runs);
      return traces[0] ?? null;
    });
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

async function hydrateTraces(
  transaction: DatabaseTransaction,
  runs: AgentRunRecord[],
): Promise<AgentTraceRecord[]> {
  if (runs.length === 0) {
    return [];
  }
  const runIds = runs.map((run) => run.id);
  const calls = await transaction
    .select()
    .from(modelCalls)
    .where(inArray(modelCalls.agentRunId, runIds))
    .orderBy(asc(modelCalls.createdAt));
  const toolCalls = await transaction
    .select()
    .from(agentToolCalls)
    .where(inArray(agentToolCalls.agentRunId, runIds))
    .orderBy(asc(agentToolCalls.createdAt));
  const reservations = await transaction
    .select()
    .from(costReservations)
    .where(inArray(costReservations.agentRunId, runIds))
    .orderBy(asc(costReservations.createdAt));
  const promptIds = [
    ...new Set(
      [
        ...runs.map((run) => run.promptVersionId),
        ...calls.map((call) => call.promptVersionId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const prompts =
    promptIds.length > 0
      ? await transaction
          .select()
          .from(promptVersions)
          .where(inArray(promptVersions.id, promptIds))
          .orderBy(asc(promptVersions.createdAt))
      : [];

  const callsByRun = groupBy(calls, "agentRunId");
  const toolsByRun = groupBy(toolCalls, "agentRunId");
  const reservationsByRun = groupBy(reservations, "agentRunId");
  return runs.map((run) => ({
    run,
    promptVersions: prompts.filter(
      (prompt) =>
        prompt.id === run.promptVersionId ||
        callsByRun.get(run.id)?.some((call) => call.promptVersionId === prompt.id),
    ),
    modelCalls: callsByRun.get(run.id) ?? [],
    toolCalls: toolsByRun.get(run.id) ?? [],
    costReservations: reservationsByRun.get(run.id) ?? [],
  }));
}

function groupBy<T extends { agentRunId: string | null }>(
  records: T[],
  key: keyof T,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const id = record[key];
    if (typeof id !== "string") {
      continue;
    }
    const group = groups.get(id) ?? [];
    group.push(record);
    groups.set(id, group);
  }
  return groups;
}
