import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  ImportCandidateStatus,
  ImportCandidateType,
  ImportUnparsed,
} from "@novel-brain/contracts";
import {
  createDatabaseClient,
  createDatabasePool,
  importCandidates,
  importConflicts,
  importJobs,
  importReports,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

export type ImportJobRecord = InferSelectModel<typeof importJobs>;
export type ImportCandidateRecord = InferSelectModel<typeof importCandidates>;
export type ImportConflictRecord = InferSelectModel<typeof importConflicts>;
export type ImportReportRecord = InferSelectModel<typeof importReports>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface SettingsImportCandidateInput {
  id: string;
  type: ImportCandidateType;
  name: string;
  summary: string;
  payload: Record<string, unknown>;
  sourceExcerpt: string;
  confidence: number;
  status: ImportCandidateStatus;
}

export interface SettingsImportRecord {
  job: ImportJobRecord;
  candidates: ImportCandidateRecord[];
  conflicts: ImportConflictRecord[];
  report: ImportReportRecord;
}

@Injectable()
export class SettingsImportRepository implements OnModuleDestroy {
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

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }

  async create(input: {
    id: string;
    reportId: string;
    userId: string;
    sourceKind: "paste" | "file";
    sourceName: string | null;
    sourceText: string;
    candidates: SettingsImportCandidateInput[];
    conflicts: Array<{
      id: string;
      type: "contradictory_setting";
      summary: string;
      primaryCandidateId: string;
      secondaryCandidateId: string;
    }>;
    unparsed: ImportUnparsed[];
  }): Promise<SettingsImportRecord> {
    return this.withTenant(input.userId, async (transaction) => {
      const [job] = await transaction
        .insert(importJobs)
        .values({
          id: input.id,
          userId: input.userId,
          mode: "settings",
          status: "awaiting_confirmation",
          sourceKind: input.sourceKind,
          sourceName: input.sourceName,
          sourceText: input.sourceText,
        })
        .returning();
      if (!job) {
        throw new Error("Failed to create settings import");
      }

      const candidateRecords =
        input.candidates.length === 0
          ? []
          : await transaction
              .insert(importCandidates)
              .values(
                input.candidates.map((candidate) => ({
                  id: candidate.id,
                  importJobId: job.id,
                  userId: input.userId,
                  candidateType: candidate.type,
                  name: candidate.name,
                  summary: candidate.summary,
                  payload: candidate.payload,
                  sourceExcerpt: candidate.sourceExcerpt,
                  confidence: candidate.confidence,
                  status: candidate.status,
                })),
              )
              .returning();

      const [report] = await transaction
        .insert(importReports)
        .values({
          id: input.reportId,
          importJobId: job.id,
          userId: input.userId,
          acceptedCandidateIds: candidateRecords
            .filter((candidate) => candidate.status === "accepted")
            .map((candidate) => candidate.id),
          pendingCandidateIds: candidateRecords
            .filter((candidate) => candidate.status === "pending")
            .map((candidate) => candidate.id),
          unparsed: input.unparsed,
        })
        .returning();
      if (!report) {
        throw new Error("Failed to create settings import report");
      }

      const conflictRecords =
        input.conflicts.length === 0
          ? []
          : await transaction
              .insert(importConflicts)
              .values(
                input.conflicts.map((conflict) => ({
                  id: conflict.id,
                  importJobId: job.id,
                  userId: input.userId,
                  conflictType: conflict.type,
                  summary: conflict.summary,
                  primaryCandidateId: conflict.primaryCandidateId,
                  secondaryCandidateId: conflict.secondaryCandidateId,
                  decision: "pending",
                })),
              )
              .returning();

      return { job, candidates: candidateRecords, conflicts: conflictRecords, report };
    });
  }

  async find(userId: string, importId: string): Promise<SettingsImportRecord | undefined> {
    return this.withTenant(userId, (transaction) => this.readRecord(transaction, userId, importId));
  }

  async decideConflict(input: {
    userId: string;
    importId: string;
    conflictId: string;
    decision: "use_primary" | "use_secondary";
    reason?: string;
  }): Promise<SettingsImportRecord | undefined> {
    return this.withTenant(input.userId, async (transaction) => {
      const [conflict] = await transaction
        .select()
        .from(importConflicts)
        .where(
          and(
            eq(importConflicts.id, input.conflictId),
            eq(importConflicts.importJobId, input.importId),
            eq(importConflicts.userId, input.userId),
          ),
        )
        .limit(1);
      if (!conflict) {
        return undefined;
      }

      await transaction
        .update(importConflicts)
        .set({
          decision: input.decision,
          reason: input.reason ?? null,
          decidedAt: new Date(),
        })
        .where(eq(importConflicts.id, conflict.id));

      const acceptedCandidateId =
        input.decision === "use_primary"
          ? conflict.primaryCandidateId
          : conflict.secondaryCandidateId;
      const pendingCandidateId =
        input.decision === "use_primary"
          ? conflict.secondaryCandidateId
          : conflict.primaryCandidateId;
      await transaction
        .update(importCandidates)
        .set({ status: "accepted" })
        .where(
          and(
            eq(importCandidates.id, acceptedCandidateId),
            eq(importCandidates.importJobId, input.importId),
            eq(importCandidates.userId, input.userId),
          ),
        );
      await transaction
        .update(importCandidates)
        .set({ status: "pending" })
        .where(
          and(
            eq(importCandidates.id, pendingCandidateId),
            eq(importCandidates.importJobId, input.importId),
            eq(importCandidates.userId, input.userId),
          ),
        );

      const candidates = await transaction
        .select()
        .from(importCandidates)
        .where(
          and(
            eq(importCandidates.importJobId, input.importId),
            eq(importCandidates.userId, input.userId),
          ),
        );
      await transaction
        .update(importReports)
        .set({
          acceptedCandidateIds: candidates
            .filter((candidate) => candidate.status === "accepted")
            .map((candidate) => candidate.id),
          pendingCandidateIds: candidates
            .filter((candidate) => candidate.status === "pending")
            .map((candidate) => candidate.id),
        })
        .where(
          and(
            eq(importReports.importJobId, input.importId),
            eq(importReports.userId, input.userId),
          ),
        );

      return this.readRecord(transaction, input.userId, input.importId);
    });
  }

  async markCompleted(input: {
    userId: string;
    importId: string;
    workId: string;
    branchId: string;
  }): Promise<SettingsImportRecord> {
    return this.withTenant(input.userId, async (transaction) => {
      const [job] = await transaction
        .update(importJobs)
        .set({
          status: "completed",
          workId: input.workId,
          branchId: input.branchId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(importJobs.id, input.importId), eq(importJobs.userId, input.userId)))
        .returning();
      if (!job) {
        throw new Error("Settings import disappeared during confirmation");
      }
      const record = await this.readRecord(transaction, input.userId, input.importId);
      if (!record) {
        throw new Error("Settings import disappeared after confirmation");
      }
      return record;
    });
  }

  private async readRecord(
    transaction: DatabaseTransaction,
    userId: string,
    importId: string,
  ): Promise<SettingsImportRecord | undefined> {
    const [job] = await transaction
      .select()
      .from(importJobs)
      .where(and(eq(importJobs.id, importId), eq(importJobs.userId, userId)))
      .limit(1);
    if (!job) {
      return undefined;
    }
    const candidates = await transaction
      .select()
      .from(importCandidates)
      .where(and(eq(importCandidates.importJobId, importId), eq(importCandidates.userId, userId)));
    const conflicts = await transaction
      .select()
      .from(importConflicts)
      .where(and(eq(importConflicts.importJobId, importId), eq(importConflicts.userId, userId)));
    const [report] = await transaction
      .select()
      .from(importReports)
      .where(and(eq(importReports.importJobId, importId), eq(importReports.userId, userId)))
      .limit(1);
    if (!report) {
      throw new Error("Settings import is missing its report");
    }
    return { job, candidates, conflicts, report };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
