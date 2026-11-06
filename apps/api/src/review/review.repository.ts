import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { ChapterReviewAction, ChapterReviewRequest } from "@novel-brain/contracts";
import {
  auditLogs,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  reviewDecisions,
  users,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import type { WorksAuditContext } from "../works/works.repository";
import { qualityGateForChapterVersion } from "./quality-gate";

export type ReviewDecisionRecord = InferSelectModel<typeof reviewDecisions>;

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export type ReviewResult =
  | { kind: "not_found" }
  | { kind: "version_conflict" }
  | { kind: "invalid_state"; status: string }
  | { kind: "quality_blocked"; gate: Awaited<ReturnType<typeof qualityGateForChapterVersion>> }
  | {
      kind: "reviewed";
      chapterId: string;
      decision: ReviewDecisionRecord;
    };

@Injectable()
export class ReviewRepository implements OnModuleDestroy {
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

  async review(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
    input: ChapterReviewRequest,
    audit: WorksAuditContext,
  ): Promise<ReviewResult> {
    return this.withTenant(userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
      const [row] = await transaction
        .select({
          chapter: chapters,
          actorName: users.displayName,
        })
        .from(chapters)
        .innerJoin(works, and(eq(works.id, chapters.workId), eq(works.userId, chapters.userId)))
        .innerJoin(
          workBranches,
          and(
            eq(workBranches.id, chapters.branchId),
            eq(workBranches.workId, chapters.workId),
            eq(workBranches.userId, chapters.userId),
          ),
        )
        .innerJoin(users, eq(users.id, userId))
        .where(
          and(
            eq(chapters.id, chapterId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            eq(chapters.userId, userId),
            isNull(works.deletedAt),
            isNull(users.deletedAt),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        return { kind: "not_found" };
      }
      if (row.chapter.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (input.action === "approve" && row.chapter.currentVersionId) {
        const gate = await qualityGateForChapterVersion(
          transaction,
          userId,
          row.chapter.id,
          row.chapter.currentVersionId,
        );
        if (!gate.canApprove) {
          return { kind: "quality_blocked", gate };
        }
      }
      if (input.action === "approve" && row.chapter.status === "approved") {
        const existing = await findLatestDecision(transaction, row.chapter.id, "approve");
        if (existing) {
          return { kind: "reviewed", chapterId: row.chapter.id, decision: existing };
        }
      }
      if (row.chapter.status !== "waiting_review") {
        return { kind: "invalid_state", status: row.chapter.status };
      }

      const now = new Date();
      const resultingStatus = input.action === "approve" ? "approved" : "rejected";
      const [updated] = await transaction
        .update(chapters)
        .set({
          status: resultingStatus,
          version: row.chapter.version + 1,
          updatedAt: now,
        })
        .where(and(eq(chapters.id, row.chapter.id), eq(chapters.version, row.chapter.version)))
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      const [decision] = await transaction
        .insert(reviewDecisions)
        .values({
          id: uuidv7(),
          workId,
          branchId,
          userId,
          chapterId,
          chapterVersionId: row.chapter.currentVersionId,
          action: input.action,
          actorId: userId,
          actorName: row.actorName,
          reason: input.reason ?? defaultReason(input.action),
          decidedAt: now,
        })
        .returning();
      if (!decision) {
        throw new Error("Failed to record chapter review decision");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: input.action === "approve" ? "chapter.approved" : "chapter.rejected",
        targetType: "chapter",
        targetId: chapterId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { kind: "reviewed", chapterId, decision };
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

async function findLatestDecision(
  transaction: DatabaseTransaction,
  chapterId: string,
  action: ChapterReviewAction,
): Promise<ReviewDecisionRecord | undefined> {
  const [decision] = await transaction
    .select()
    .from(reviewDecisions)
    .where(and(eq(reviewDecisions.chapterId, chapterId), eq(reviewDecisions.action, action)))
    .orderBy(desc(reviewDecisions.decidedAt))
    .limit(1);
  return decision;
}

function defaultReason(action: ChapterReviewAction): string {
  return action === "approve" ? "作者批准本章" : "作者驳回本章";
}
