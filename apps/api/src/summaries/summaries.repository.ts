import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { SummaryRebuildRequest } from "@novel-brain/contracts";
import {
  auditLogs,
  createDatabaseClient,
  createDatabasePool,
  summaryRebuildRuns,
  summaryRecords,
  toSummaryRebuildRunContract,
  toSummaryRecordContract,
  workBranches,
  works,
  type DatabaseClient,
  type SummaryRebuildRunRow,
  type SummaryRecordRow,
} from "@novel-brain/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface SummaryWorkContext {
  workId: string;
  branchId: string;
}

export interface SummaryAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface SummaryRebuildCreateResult {
  run: SummaryRebuildRunRow;
  created: boolean;
}

@Injectable()
export class SummariesRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<SummaryWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      return context;
    });
  }

  async listSummaries(userId: string, context: SummaryWorkContext): Promise<SummaryRecordRow[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(summaryRecords)
        .where(
          and(
            eq(summaryRecords.userId, userId),
            eq(summaryRecords.workId, context.workId),
            eq(summaryRecords.branchId, context.branchId),
          ),
        )
        .orderBy(
          asc(summaryRecords.fromChapter),
          asc(summaryRecords.level),
          asc(summaryRecords.title),
        ),
    );
  }

  async listRebuilds(userId: string, context: SummaryWorkContext): Promise<SummaryRebuildRunRow[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(summaryRebuildRuns)
        .where(
          and(
            eq(summaryRebuildRuns.userId, userId),
            eq(summaryRebuildRuns.workId, context.workId),
            eq(summaryRebuildRuns.branchId, context.branchId),
          ),
        )
        .orderBy(desc(summaryRebuildRuns.createdAt))
        .limit(20),
    );
  }

  async findRebuild(
    userId: string,
    context: SummaryWorkContext,
    runId: string,
  ): Promise<SummaryRebuildRunRow | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [run] = await transaction
        .select()
        .from(summaryRebuildRuns)
        .where(
          and(
            eq(summaryRebuildRuns.id, runId),
            eq(summaryRebuildRuns.userId, userId),
            eq(summaryRebuildRuns.workId, context.workId),
            eq(summaryRebuildRuns.branchId, context.branchId),
          ),
        )
        .limit(1);
      return run;
    });
  }

  async createRebuild(input: {
    userId: string;
    context: SummaryWorkContext;
    request: SummaryRebuildRequest;
    idempotencyKey: string;
    compilerVersion: string;
    modelVersion: string;
    audit: SummaryAuditContext;
  }): Promise<SummaryRebuildCreateResult> {
    return this.withTenant(input.userId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`summary-rebuild-idempotency:${input.context.branchId}:${input.idempotencyKey}`}))`,
      );
      const [existing] = await transaction
        .select()
        .from(summaryRebuildRuns)
        .where(
          and(
            eq(summaryRebuildRuns.userId, input.userId),
            eq(summaryRebuildRuns.workId, input.context.workId),
            eq(summaryRebuildRuns.branchId, input.context.branchId),
            eq(summaryRebuildRuns.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return { run: existing, created: false };
      }
      const now = new Date();
      const [run] = await transaction
        .insert(summaryRebuildRuns)
        .values({
          id: uuidv7(),
          workId: input.context.workId,
          branchId: input.context.branchId,
          userId: input.userId,
          status: "queued",
          levels: input.request.levels,
          idempotencyKey: input.idempotencyKey,
          compilerVersion: input.compilerVersion,
          modelVersion: input.modelVersion,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!run) {
        throw new Error("Failed to create summary rebuild run");
      }
      await transaction
        .update(summaryRecords)
        .set({
          status: "rebuilding",
          invalidatedAt: now,
          invalidationReason: `summary_rebuild:${run.id}`,
          updatedAt: now,
        })
        .where(
          and(
            eq(summaryRecords.userId, input.userId),
            eq(summaryRecords.workId, input.context.workId),
            eq(summaryRecords.branchId, input.context.branchId),
            inArray(summaryRecords.level, input.request.levels),
          ),
        );
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "summaries.rebuild_requested",
        targetType: "summary_rebuild",
        targetId: run.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
        createdAt: now,
      });
      return { run, created: true };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
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

export function toSummaryRecord(row: SummaryRecordRow) {
  return toSummaryRecordContract(row);
}

export function toSummaryRebuildRun(row: SummaryRebuildRunRow) {
  return toSummaryRebuildRunContract(row);
}
