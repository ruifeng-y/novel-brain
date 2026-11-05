import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  entities,
  storyBibles,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type { ChapterCreateRequest, ChapterPatchRequest } from "@novel-brain/contracts";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { countWords } from "../imports/manuscript-import.parser";
import type { WorksAuditContext } from "../works/works.repository";

export type ChapterRecord = InferSelectModel<typeof chapters>;
export type ChapterVersionRecord = InferSelectModel<typeof chapterVersions>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface ChapterWorkContext {
  workId: string;
  branchId: string;
}

export interface ChapterWithVersion {
  chapter: ChapterRecord;
  currentVersion: ChapterVersionRecord | null;
  parentNodeId: string | null;
}

export interface ChapterVersionWithParent extends ChapterVersionRecord {
  parentNodeId: string | null;
}

export interface ChapterReadinessSources {
  storyBibleLocked: boolean;
  lockedSettingTypes: string[];
}

@Injectable()
export class ChaptersRepository implements OnModuleDestroy {
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
  ): Promise<ChapterWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({
          workId: works.id,
          branchId: workBranches.id,
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

  async list(userId: string, context: ChapterWorkContext): Promise<ChapterWithVersion[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({
          chapter: chapters,
          currentVersion: chapterVersions,
          parentNodeId: versionNodes.parentNodeId,
        })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .leftJoin(versionNodes, eq(versionNodes.id, chapterVersions.versionNodeId))
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
          ),
        )
        .orderBy(asc(chapters.number));
      return rows.map(({ chapter, currentVersion, parentNodeId }) => ({
        chapter,
        currentVersion: currentVersion ?? null,
        parentNodeId: parentNodeId ?? null,
      }));
    });
  }

  async find(
    userId: string,
    context: ChapterWorkContext,
    chapterId: string,
  ): Promise<ChapterWithVersion | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [row] = await transaction
        .select({
          chapter: chapters,
          currentVersion: chapterVersions,
          parentNodeId: versionNodes.parentNodeId,
        })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .leftJoin(versionNodes, eq(versionNodes.id, chapterVersions.versionNodeId))
        .where(
          and(
            eq(chapters.id, chapterId),
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (!row) {
        return undefined;
      }
      return {
        chapter: row.chapter,
        currentVersion: row.currentVersion ?? null,
        parentNodeId: row.parentNodeId ?? null,
      };
    });
  }

  async readinessSources(
    userId: string,
    context: ChapterWorkContext,
  ): Promise<ChapterReadinessSources> {
    return this.withTenant(userId, async (transaction) => {
      const [storyBible] = await transaction
        .select({ id: storyBibles.id })
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.userId, userId),
            eq(storyBibles.workId, context.workId),
            eq(storyBibles.branchId, context.branchId),
            eq(storyBibles.status, "locked"),
          ),
        )
        .limit(1);
      const lockedSettings = await transaction
        .select({ type: entities.type })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.status, "locked"),
            sql`${entities.deletedAt} is null`,
          ),
        );
      return {
        storyBibleLocked: Boolean(storyBible),
        lockedSettingTypes: lockedSettings.map((setting) => setting.type),
      };
    });
  }

  async create(
    userId: string,
    context: ChapterWorkContext,
    input: ChapterCreateRequest,
    audit: WorksAuditContext,
  ): Promise<"order_exists" | ChapterRecord> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const [existing] = await transaction
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
            eq(chapters.number, input.order),
          ),
        )
        .limit(1);
      if (existing) {
        return "order_exists";
      }

      const now = new Date();
      const [chapter] = await transaction
        .insert(chapters)
        .values({
          id: uuidv7(),
          workId: context.workId,
          branchId: context.branchId,
          userId,
          number: input.order,
          title: input.title,
          status: "planned",
          version: 1,
          brief: input.brief,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!chapter) {
        throw new Error("Failed to create chapter");
      }
      await appendBriefVersion(transaction, userId, chapter, headNodeId, audit, "创建章纲");
      return chapter;
    });
  }

  async patch(
    userId: string,
    context: ChapterWorkContext,
    chapterId: string,
    input: ChapterPatchRequest,
    audit: WorksAuditContext,
  ): Promise<"not_found" | "not_editable" | "version_conflict" | ChapterRecord> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, chapterId),
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (!isChapterEditable(current.status)) {
        return "not_editable";
      }
      if (current.version !== input.version) {
        return "version_conflict";
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const [updated] = await transaction
        .update(chapters)
        .set({
          title: input.title ?? current.title,
          brief: input.brief ?? current.brief,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(chapters.id, current.id), eq(chapters.version, current.version)))
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await appendBriefVersion(transaction, userId, updated, headNodeId, audit, "编辑章纲");
      return updated;
    });
  }

  async saveVersion(
    userId: string,
    context: ChapterWorkContext,
    chapterId: string,
    expectedVersion: number,
    content: string,
    audit: WorksAuditContext,
  ): Promise<
    | "not_found"
    | "not_editable"
    | "version_conflict"
    | { chapter: ChapterRecord; version: ChapterVersionWithParent }
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(chapters)
        .where(
          and(
            eq(chapters.id, chapterId),
            eq(chapters.userId, userId),
            eq(chapters.workId, context.workId),
            eq(chapters.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (!isChapterEditable(current.status)) {
        return "not_editable";
      }
      if (current.version !== expectedVersion) {
        return "version_conflict";
      }
      const parentNodeId = await requireBranchHead(transaction, userId, context);
      const [latest] = await transaction
        .select({
          version: sql<number>`coalesce(max(${chapterVersions.version}), 0)`,
        })
        .from(chapterVersions)
        .where(eq(chapterVersions.chapterId, current.id));
      const versionNumber = Number(latest?.version ?? 0) + 1;
      const contentHash = createHash("sha256").update(content).digest("hex");
      const wordCount = countWords(content);
      const now = new Date();
      const versionId = uuidv7();
      const versionNodeId = uuidv7();

      await transaction.insert(versionNodes).values({
        id: versionNodeId,
        workId: current.workId,
        branchId: current.branchId,
        userId,
        parentNodeId,
        nodeType: "chapter_version",
        objectType: "chapter",
        objectId: current.id,
        objectVersion: versionNumber,
        payload: { contentHash, wordCount, source: "manual" },
        actorId: userId,
        message: `保存第 ${current.number} 章`,
        createdAt: now,
      });
      const [version] = await transaction
        .insert(chapterVersions)
        .values({
          id: versionId,
          workId: current.workId,
          branchId: current.branchId,
          userId,
          chapterId: current.id,
          version: versionNumber,
          content,
          contentHash,
          versionNodeId,
          source: "manual",
          createdAt: now,
        })
        .returning();
      if (!version) {
        throw new Error("Failed to create chapter version");
      }
      const [updated] = await transaction
        .update(chapters)
        .set({
          status: "writing",
          version: current.version + 1,
          currentVersionId: versionId,
          wordCount,
          updatedAt: now,
        })
        .where(and(eq(chapters.id, current.id), eq(chapters.version, current.version)))
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, current.branchId));
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "chapter.version_saved",
        targetType: "chapter",
        targetId: current.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return {
        chapter: updated,
        version: {
          ...version,
          parentNodeId,
        },
      };
    });
  }

  async listVersions(
    userId: string,
    context: ChapterWorkContext,
    chapterId: string,
  ): Promise<ChapterVersionWithParent[] | undefined> {
    const chapter = await this.find(userId, context, chapterId);
    if (!chapter) {
      return undefined;
    }
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({
          version: chapterVersions,
          parentNodeId: versionNodes.parentNodeId,
        })
        .from(chapterVersions)
        .innerJoin(versionNodes, eq(versionNodes.id, chapterVersions.versionNodeId))
        .where(
          and(
            eq(chapterVersions.userId, userId),
            eq(chapterVersions.workId, context.workId),
            eq(chapterVersions.branchId, context.branchId),
            eq(chapterVersions.chapterId, chapterId),
          ),
        )
        .orderBy(desc(chapterVersions.version));
      return rows.map(({ version, parentNodeId }) => ({
        ...version,
        parentNodeId,
      }));
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

async function appendBriefVersion(
  transaction: DatabaseTransaction,
  userId: string,
  chapter: ChapterRecord,
  parentNodeId: string,
  audit: WorksAuditContext,
  message: string,
): Promise<void> {
  const now = new Date();
  const versionNodeId = uuidv7();
  await transaction.insert(versionNodes).values({
    id: versionNodeId,
    workId: chapter.workId,
    branchId: chapter.branchId,
    userId,
    parentNodeId,
    nodeType: "outline_version",
    objectType: "chapter_brief",
    objectId: chapter.id,
    objectVersion: chapter.version,
    payload: { title: chapter.title, brief: chapter.brief },
    actorId: userId,
    message,
    createdAt: now,
  });
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, chapter.branchId));
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action: chapter.version === 1 ? "chapter.brief_created" : "chapter.brief_updated",
    targetType: "chapter",
    targetId: chapter.id,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

function isChapterEditable(status: string): boolean {
  return status === "planned" || status === "writing" || status === "changes_requested";
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: ChapterWorkContext,
): Promise<string> {
  const [branch] = await transaction
    .select()
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("Chapter branch is missing its version head");
  }
  return branch.headNodeId;
}
