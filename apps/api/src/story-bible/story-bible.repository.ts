import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  createDatabaseClient,
  createDatabasePool,
  storyBibles,
  storyBibleVersions,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type StoryBibleRecord = InferSelectModel<typeof storyBibles>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface StoryBibleWorkContext {
  workId: string;
  branchId: string;
  title: string;
  idea: string | null;
  genre: string;
  branchHeadNodeId: string | null;
}

export interface StoryBibleAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

@Injectable()
export class StoryBibleRepository implements OnModuleDestroy {
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
  ): Promise<StoryBibleWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({
          workId: works.id,
          branchId: workBranches.id,
          title: works.title,
          idea: works.idea,
          genre: works.genre,
          branchHeadNodeId: workBranches.headNodeId,
        })
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
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async getOrCreate(
    userId: string,
    context: StoryBibleWorkContext,
    initialCards: StoryBibleRecord["cards"],
    id: string,
  ): Promise<StoryBibleRecord> {
    return this.withTenant(userId, async (transaction) => {
      await transaction
        .insert(storyBibles)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          cards: initialCards,
        })
        .onConflictDoNothing({
          target: [storyBibles.workId, storyBibles.branchId],
        });

      const [storyBible] = await transaction
        .select()
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.userId, userId),
            eq(storyBibles.workId, context.workId),
            eq(storyBibles.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (!storyBible) {
        throw new Error("Failed to initialize story bible");
      }
      return storyBible;
    });
  }

  async updateProposal(
    userId: string,
    storyBibleId: string,
    expectedVersion: number,
    cards: StoryBibleRecord["cards"],
    generatedAt: Date,
  ): Promise<"not_found" | "locked" | "version_conflict" | StoryBibleRecord> {
    return this.updateUnlocked(userId, storyBibleId, expectedVersion, cards, {
      status: "proposed",
      proposalGeneratedAt: generatedAt,
    });
  }

  async updateCards(
    userId: string,
    storyBibleId: string,
    expectedVersion: number,
    cards: StoryBibleRecord["cards"],
  ): Promise<"not_found" | "locked" | "version_conflict" | StoryBibleRecord> {
    return this.updateUnlocked(userId, storyBibleId, expectedVersion, cards);
  }

  private async updateUnlocked(
    userId: string,
    storyBibleId: string,
    expectedVersion: number,
    cards: StoryBibleRecord["cards"],
    options?: { status: "proposed"; proposalGeneratedAt: Date },
  ): Promise<"not_found" | "locked" | "version_conflict" | StoryBibleRecord> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.id, storyBibleId), eq(storyBibles.userId, userId)))
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status === "locked") {
        return "locked";
      }
      if (current.version !== expectedVersion) {
        return "version_conflict";
      }
      const [updated] = await transaction
        .update(storyBibles)
        .set({
          cards,
          version: current.version + 1,
          updatedAt: new Date(),
          ...options,
        })
        .where(and(eq(storyBibles.id, current.id), eq(storyBibles.version, current.version)))
        .returning();
      return updated ?? "version_conflict";
    });
  }

  async lock(
    userId: string,
    storyBibleId: string,
    expectedVersion: number,
    readiness: Record<string, unknown>,
    audit: StoryBibleAuditContext,
  ): Promise<"not_found" | "locked" | "version_conflict" | StoryBibleRecord> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.id, storyBibleId), eq(storyBibles.userId, userId)))
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status === "locked") {
        return "locked";
      }
      if (current.version !== expectedVersion) {
        return "version_conflict";
      }

      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${current.branchId}))`);
      const [branch] = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            eq(workBranches.id, current.branchId),
            eq(workBranches.workId, current.workId),
            eq(workBranches.userId, userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!branch?.headNodeId) {
        throw new Error("Story bible branch is missing its version head");
      }

      const lockedAt = new Date();
      const bibleVersionId = uuidv7();
      const versionNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: current.workId,
        branchId: current.branchId,
        userId,
        parentNodeId: branch.headNodeId,
        nodeType: "story_bible_version",
        objectType: "story_bible",
        objectId: current.id,
        objectVersion: current.version,
        snapshotId: bibleVersionId,
        payload: {
          cards: current.cards,
          readiness,
        },
        actorId: userId,
        message: "锁定故事圣经",
      });
      await transaction.insert(storyBibleVersions).values({
        id: bibleVersionId,
        storyBibleId: current.id,
        workId: current.workId,
        branchId: current.branchId,
        userId,
        version: current.version,
        cards: current.cards,
        readiness,
        versionNodeId,
        createdBy: userId,
        createdAt: lockedAt,
      });
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: lockedAt })
        .where(eq(workBranches.id, branch.id));
      const [locked] = await transaction
        .update(storyBibles)
        .set({
          status: "locked",
          lockedAt,
          lockedBy: userId,
          updatedAt: lockedAt,
        })
        .where(and(eq(storyBibles.id, current.id), eq(storyBibles.version, current.version)))
        .returning();
      if (!locked) {
        return "version_conflict";
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "story_bible.locked",
        targetType: "story_bible",
        targetId: current.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return locked;
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
