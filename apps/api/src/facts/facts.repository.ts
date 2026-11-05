import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  FactDecisionAction,
  FactProposalDecisionRequest,
  FactRisk,
} from "@novel-brain/contracts";
import {
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  factDecisions,
  factProposals,
  refreshFactProposals,
  users,
  workBranches,
  works,
  type DatabaseClient,
  type FactProposalCandidate,
} from "@novel-brain/db";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type FactProposalRecord = InferSelectModel<typeof factProposals>;
export type FactDecisionRecord = InferSelectModel<typeof factDecisions>;

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface FactChapterContext {
  chapter: InferSelectModel<typeof chapters>;
  version: InferSelectModel<typeof chapterVersions> | null;
}

export interface FactProposalWithDecision {
  proposal: FactProposalRecord;
  decision: FactDecisionRecord | null;
}

export type FactDecisionResult =
  | { kind: "not_found" }
  | { kind: "not_pending"; value: FactProposalWithDecision }
  | { kind: "updated"; value: FactProposalWithDecision };

@Injectable()
export class FactsRepository implements OnModuleDestroy {
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

  async findChapterContext(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<FactChapterContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [row] = await transaction
        .select({ chapter: chapters, version: chapterVersions })
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
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.id, chapterId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            eq(chapters.userId, userId),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      return row;
    });
  }

  async list(
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<FactProposalWithDecision[]> {
    return this.withTenant(userId, async (transaction) =>
      this.listInTransaction(transaction, userId, workId, branchId, chapterId),
    );
  }

  async extract(
    userId: string,
    context: FactChapterContext,
    candidates: FactProposalCandidate[],
  ): Promise<FactProposalWithDecision[]> {
    return this.withTenant(userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${context.chapter.id}))`);
      const [actor] = await transaction
        .select({ displayName: users.displayName })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      if (!actor || !context.version) {
        throw new Error("Fact extraction context is incomplete");
      }
      await refreshFactProposals(transaction, {
        workId: context.chapter.workId,
        branchId: context.chapter.branchId,
        userId,
        chapterId: context.chapter.id,
        sourceVersionId: context.version.id,
        actorName: actor.displayName,
        candidates,
        newId: uuidv7,
      });
      return this.listInTransaction(
        transaction,
        userId,
        context.chapter.workId,
        context.chapter.branchId,
        context.chapter.id,
      );
    });
  }

  async decide(
    userId: string,
    workId: string,
    branchId: string,
    factProposalId: string,
    input: FactProposalDecisionRequest,
  ): Promise<FactDecisionResult> {
    return this.withTenant(userId, async (transaction) => {
      const [proposal] = await transaction
        .select()
        .from(factProposals)
        .where(
          and(
            eq(factProposals.id, factProposalId),
            eq(factProposals.userId, userId),
            eq(factProposals.workId, workId),
            eq(factProposals.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!proposal) {
        return { kind: "not_found" };
      }
      if (proposal.status !== "proposed") {
        return {
          kind: "not_pending",
          value: await this.withDecision(transaction, proposal),
        };
      }

      const [actor] = await transaction
        .select({ displayName: users.displayName })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)))
        .limit(1);
      if (!actor) {
        return { kind: "not_found" };
      }

      const now = new Date();
      const resultingStatus = decisionStatus(input.action);
      const originalPayload = payload(proposal);
      const resultingPayload = {
        subject: input.modified?.subject ?? proposal.subject,
        predicate: input.modified?.predicate ?? proposal.predicate,
        object: input.modified?.object ?? proposal.object,
        risk: input.modified?.risk ?? proposal.risk,
        status: resultingStatus,
      };
      const [decision] = await transaction
        .insert(factDecisions)
        .values({
          id: uuidv7(),
          workId: proposal.workId,
          branchId: proposal.branchId,
          userId,
          chapterId: proposal.chapterId,
          factProposalId: proposal.id,
          action: input.action,
          actorId: userId,
          actorName: actor.displayName,
          reason: input.reason ?? defaultReason(input.action),
          originalPayload,
          resultingPayload,
          decidedAt: now,
        })
        .returning();
      const [updated] = await transaction
        .update(factProposals)
        .set({
          subject: String(resultingPayload.subject),
          predicate: String(resultingPayload.predicate),
          object: String(resultingPayload.object),
          risk: resultingPayload.risk as FactRisk,
          status: resultingStatus,
          updatedAt: now,
        })
        .where(eq(factProposals.id, proposal.id))
        .returning();
      if (!updated || !decision) {
        throw new Error("Failed to record fact decision");
      }
      return { kind: "updated", value: { proposal: updated, decision } };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async listInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    chapterId: string,
  ): Promise<FactProposalWithDecision[]> {
    const proposals = await transaction
      .select()
      .from(factProposals)
      .where(
        and(
          eq(factProposals.userId, userId),
          eq(factProposals.workId, workId),
          eq(factProposals.branchId, branchId),
          eq(factProposals.chapterId, chapterId),
        ),
      )
      .orderBy(asc(factProposals.createdAt));
    if (proposals.length === 0) {
      return [];
    }
    const decisions = await transaction
      .select()
      .from(factDecisions)
      .where(
        inArray(
          factDecisions.factProposalId,
          proposals.map((proposal) => proposal.id),
        ),
      )
      .orderBy(desc(factDecisions.decidedAt));
    return proposals.map((proposal) => ({
      proposal,
      decision: decisions.find((decision) => decision.factProposalId === proposal.id) ?? null,
    }));
  }

  private async withDecision(
    transaction: DatabaseTransaction,
    proposal: FactProposalRecord,
  ): Promise<FactProposalWithDecision> {
    const [decision] = await transaction
      .select()
      .from(factDecisions)
      .where(eq(factDecisions.factProposalId, proposal.id))
      .orderBy(desc(factDecisions.decidedAt))
      .limit(1);
    return { proposal, decision: decision ?? null };
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

function decisionStatus(action: FactDecisionAction) {
  switch (action) {
    case "confirm":
      return "confirmed" as const;
    case "modify_confirm":
      return "modified_confirmed" as const;
    case "reject":
      return "rejected" as const;
    case "supersede":
      return "superseded" as const;
  }
}

function defaultReason(action: FactDecisionAction): string {
  switch (action) {
    case "confirm":
      return "作者确认事实提案";
    case "modify_confirm":
      return "作者修改后确认事实提案";
    case "reject":
      return "作者驳回事实提案";
    case "supersede":
      return "作者替代事实提案";
  }
}

function payload(proposal: FactProposalRecord): Record<string, unknown> {
  return {
    subject: proposal.subject,
    predicate: proposal.predicate,
    object: proposal.object,
    risk: proposal.risk,
    status: proposal.status,
  };
}
