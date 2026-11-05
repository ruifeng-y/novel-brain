import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type {
  StoryBibleCard,
  StoryBibleCardKey,
  StoryBibleVersionAction,
  StoryBibleVersionListQuery,
  StoryBibleWorldRule,
  StoryBibleWorldRuleListQuery,
} from "@novel-brain/contracts";
import {
  auditLogs,
  createDatabaseClient,
  createDatabasePool,
  storyBibleChangeRequests,
  storyBibles,
  storyBibleVersions,
  storyBibleWorldRules,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type StoryBibleRecord = InferSelectModel<typeof storyBibles>;
export type StoryBibleVersionRecord = InferSelectModel<typeof storyBibleVersions>;
export type StoryBibleChangeRequestRecord = InferSelectModel<typeof storyBibleChangeRequests>;
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

interface AppendVersionInput {
  userId: string;
  storyBibleId: string;
  expectedVersion: number;
  cards: StoryBibleCard[];
  status: StoryBibleRecord["status"];
  action: StoryBibleVersionAction;
  reason: string;
  readiness: Record<string, unknown>;
  proposalGeneratedAt?: Date | null;
  requireLocked?: boolean;
  audit: StoryBibleAuditContext;
}

interface CreateChangeRequestInput {
  userId: string;
  storyBibleId: string;
  expectedVersion: number;
  workId: string;
  branchId: string;
  cardKey: StoryBibleCardKey;
  title: string;
  reason: string;
  before: StoryBibleCard;
  after: StoryBibleCard;
  audit: StoryBibleAuditContext;
  idempotencyKey: string | null;
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

  async listVersions(
    userId: string,
    storyBibleId: string,
    query: StoryBibleVersionListQuery,
  ): Promise<{ versions: StoryBibleVersionRecord[]; nextCursor: string | null }> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select()
        .from(storyBibleVersions)
        .where(
          and(
            eq(storyBibleVersions.userId, userId),
            eq(storyBibleVersions.storyBibleId, storyBibleId),
            query.cursor ? lt(storyBibleVersions.id, query.cursor) : undefined,
          ),
        )
        .orderBy(desc(storyBibleVersions.id))
        .limit(query.limit + 1);
      const versions = rows.slice(0, query.limit);
      return {
        versions,
        nextCursor: rows.length > query.limit ? (versions.at(-1)?.id ?? null) : null,
      };
    });
  }

  async listWorldRules(
    userId: string,
    storyBibleId: string,
    query: StoryBibleWorldRuleListQuery,
  ): Promise<{ worldRules: StoryBibleWorldRule[]; nextCursor: string | null }> {
    return this.withTenant(userId, async (transaction) => {
      const [latestVersion] = await transaction
        .select({ id: storyBibleVersions.id })
        .from(storyBibleVersions)
        .where(
          and(
            eq(storyBibleVersions.userId, userId),
            eq(storyBibleVersions.storyBibleId, storyBibleId),
          ),
        )
        .orderBy(desc(storyBibleVersions.version))
        .limit(1);
      if (!latestVersion) {
        return { worldRules: [], nextCursor: null };
      }
      const rows = await transaction
        .select()
        .from(storyBibleWorldRules)
        .where(
          and(
            eq(storyBibleWorldRules.userId, userId),
            eq(storyBibleWorldRules.storyBibleVersionId, latestVersion.id),
            query.cursor ? lt(storyBibleWorldRules.id, query.cursor) : undefined,
          ),
        )
        .orderBy(desc(storyBibleWorldRules.id))
        .limit(query.limit + 1);
      const worldRules = rows.slice(0, query.limit).map((rule) => ({
        id: rule.id,
        name: rule.name,
        constraint: rule.constraint,
        scope: rule.scope,
        exceptions: rule.exceptions,
      }));
      return {
        worldRules,
        nextCursor: rows.length > query.limit ? (worldRules.at(-1)?.id ?? null) : null,
      };
    });
  }

  async appendVersion(
    input: AppendVersionInput,
  ): Promise<"not_found" | "locked" | "not_locked" | "version_conflict" | StoryBibleRecord> {
    return this.withTenant(input.userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.id, input.storyBibleId), eq(storyBibles.userId, input.userId)))
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (input.requireLocked) {
        if (current.status !== "locked") {
          return "not_locked";
        }
      } else if (current.status === "locked") {
        return "locked";
      }
      if (current.version !== input.expectedVersion) {
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
            eq(workBranches.userId, input.userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!branch?.headNodeId) {
        throw new Error("Story bible branch is missing its version head");
      }

      const createdAt = new Date();
      const versionId = uuidv7();
      const versionNodeId = uuidv7();
      const nextVersion = current.version + 1;
      const locked = input.status === "locked";
      const nextProposalGeneratedAt =
        input.proposalGeneratedAt === undefined
          ? current.proposalGeneratedAt
          : input.proposalGeneratedAt;
      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: current.workId,
        branchId: current.branchId,
        userId: input.userId,
        parentNodeId: branch.headNodeId,
        nodeType: "story_bible_version",
        objectType: "story_bible",
        objectId: current.id,
        objectVersion: nextVersion,
        snapshotId: versionId,
        payload: {
          action: input.action,
          reason: input.reason,
          cards: input.cards,
          readiness: input.readiness,
        },
        actorId: input.userId,
        message: input.reason,
      });
      await transaction.insert(storyBibleVersions).values({
        id: versionId,
        storyBibleId: current.id,
        workId: current.workId,
        branchId: current.branchId,
        userId: input.userId,
        version: nextVersion,
        cards: input.cards,
        readiness: input.readiness,
        action: input.action,
        reason: input.reason,
        versionNodeId,
        createdBy: input.userId,
        createdAt,
      });
      const worldRules = input.cards.find((card) => card.key === "worldLaws")?.worldRules ?? [];
      if (worldRules.length > 0) {
        await transaction.insert(storyBibleWorldRules).values(
          worldRules.map((rule) => ({
            id: rule.id,
            storyBibleVersionId: versionId,
            storyBibleId: current.id,
            workId: current.workId,
            branchId: current.branchId,
            userId: input.userId,
            name: rule.name,
            constraint: rule.constraint,
            scope: rule.scope,
            exceptions: rule.exceptions,
            createdAt,
          })),
        );
      }
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: createdAt })
        .where(eq(workBranches.id, branch.id));
      const [updated] = await transaction
        .update(storyBibles)
        .set({
          cards: input.cards,
          version: nextVersion,
          status: input.status,
          proposalGeneratedAt: nextProposalGeneratedAt,
          lockedAt: locked ? createdAt : null,
          lockedBy: locked ? input.userId : null,
          updatedAt: createdAt,
        })
        .where(and(eq(storyBibles.id, current.id), eq(storyBibles.version, current.version)))
        .returning();
      if (!updated) {
        throw new Error("Story bible version update lost its row lock");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: `story_bible.${input.action}`,
        targetType: "story_bible",
        targetId: current.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });
      return updated;
    });
  }

  async createChangeRequest(
    input: CreateChangeRequestInput,
  ): Promise<"not_locked" | "version_conflict" | StoryBibleChangeRequestRecord> {
    return this.withTenant(input.userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [storyBible] = await transaction
        .select()
        .from(storyBibles)
        .where(and(eq(storyBibles.id, input.storyBibleId), eq(storyBibles.userId, input.userId)))
        .for("update")
        .limit(1);
      if (!storyBible) {
        throw new Error("Story bible disappeared while creating a change request");
      }
      if (input.idempotencyKey) {
        const [existing] = await transaction
          .select()
          .from(storyBibleChangeRequests)
          .where(
            and(
              eq(storyBibleChangeRequests.userId, input.userId),
              eq(storyBibleChangeRequests.storyBibleId, input.storyBibleId),
              eq(storyBibleChangeRequests.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          return existing;
        }
      }
      if (storyBible.status !== "locked") {
        return "not_locked";
      }
      if (storyBible.version !== input.expectedVersion) {
        return "version_conflict";
      }
      const [request] = await transaction
        .insert(storyBibleChangeRequests)
        .values({
          id: uuidv7(),
          storyBibleId: input.storyBibleId,
          workId: input.workId,
          branchId: input.branchId,
          userId: input.userId,
          cardKey: input.cardKey,
          title: input.title,
          reason: input.reason,
          before: input.before,
          after: input.after,
          status: "pending",
          risk: "medium",
          source: "author",
          idempotencyKey: input.idempotencyKey,
          createdBy: input.userId,
        })
        .returning();
      if (!request) {
        throw new Error("Failed to create story bible change request");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "story_bible.change_requested",
        targetType: "story_bible",
        targetId: input.storyBibleId,
        decision: "pending",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });
      return request;
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
