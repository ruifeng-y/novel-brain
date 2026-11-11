import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  genrePacks,
  importJobs,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { countWords } from "./manuscript-import.parser";
import type { WorksAuditContext } from "../works/works.repository";

export type ManuscriptImportJobRecord = InferSelectModel<typeof importJobs>;
export type ChapterRecord = InferSelectModel<typeof chapters>;
export type ChapterVersionRecord = InferSelectModel<typeof chapterVersions>;
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface ConfirmedManuscriptResult {
  workId: string;
  branchId: string;
  chapters: ChapterRecord[];
  chapterVersions: Array<ChapterVersionRecord & { parentNodeId: string | null }>;
}

@Injectable()
export class ManuscriptImportRepository implements OnModuleDestroy {
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
    userId: string;
    sourceName: string;
    sourceText: string;
  }): Promise<ManuscriptImportJobRecord> {
    return this.withTenant(input.userId, async (transaction) => {
      const [job] = await transaction
        .insert(importJobs)
        .values({
          id: input.id,
          userId: input.userId,
          mode: "manuscript_text",
          status: "awaiting_confirmation",
          sourceKind: "file",
          sourceName: input.sourceName,
          sourceText: input.sourceText,
        })
        .returning();
      if (!job) {
        throw new Error("Failed to create manuscript import");
      }
      return job;
    });
  }

  async find(userId: string, importId: string): Promise<ManuscriptImportJobRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, importId),
            eq(importJobs.userId, userId),
            eq(importJobs.mode, "manuscript_text"),
          ),
        )
        .limit(1);
      return job;
    });
  }

  async confirm(input: {
    userId: string;
    importId: string;
    displayName: string;
    title: string;
    penName?: string;
    genre: string;
    scaleTarget: string;
    chapterLengthTarget: number;
    chapters: Array<{ title: string; content: string }>;
    audit: WorksAuditContext;
    idempotencyKey: string;
  }): Promise<ConfirmedManuscriptResult | undefined> {
    return this.withTenant(input.userId, async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [job] = await transaction
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, input.importId),
            eq(importJobs.userId, input.userId),
            eq(importJobs.mode, "manuscript_text"),
          ),
        )
        .limit(1)
        .for("update");
      if (!job) {
        return undefined;
      }
      if (job.status === "completed" && job.workId) {
        return this.readConfirmed(transaction, input.userId, job.workId);
      }

      const workId = uuidv7();
      const branchId = uuidv7();
      const rootNodeId = uuidv7();
      const [genrePack] = await transaction
        .select()
        .from(genrePacks)
        .where(eq(genrePacks.key, input.genre))
        .orderBy(desc(genrePacks.version))
        .limit(1);
      if (!genrePack) {
        throw new Error("Genre pack is unavailable");
      }
      const [work] = await transaction
        .insert(works)
        .values({
          id: workId,
          userId: input.userId,
          title: input.title,
          penName: input.penName ?? input.displayName,
          genre: input.genre,
          status: "draft",
          scaleTarget: input.scaleTarget,
          chapterLengthTarget: input.chapterLengthTarget,
          sourceMode: "manuscript_import",
          templatePackId: genrePack.id,
          settings: {
            importId: input.importId,
            genrePack: {
              key: genrePack.key,
              version: genrePack.version,
              fields: genrePack.fields,
            },
          },
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      if (!work) {
        throw new Error("Failed to create imported work");
      }

      const [branch] = await transaction
        .insert(workBranches)
        .values({
          id: branchId,
          workId: work.id,
          userId: input.userId,
          name: "main",
          status: "active",
        })
        .returning();
      if (!branch) {
        throw new Error("Failed to create imported work main branch");
      }

      await transaction.insert(versionNodes).values({
        id: rootNodeId,
        workId: work.id,
        branchId: branch.id,
        userId: input.userId,
        nodeType: "snapshot",
        objectType: "work",
        objectId: work.id,
        objectVersion: 1,
        snapshotId: rootNodeId,
        payload: { sourceMode: "manuscript_import", importId: input.importId },
        actorId: input.userId,
        message: "创建旧稿导入作品",
      });

      let parentNodeId = rootNodeId;
      for (const [index, chapterInput] of input.chapters.entries()) {
        const chapterId = uuidv7();
        const versionId = uuidv7();
        const versionNodeId = uuidv7();
        const chapterNumber = index + 1;
        const contentHash = createHash("sha256").update(chapterInput.content).digest("hex");

        const [chapter] = await transaction
          .insert(chapters)
          .values({
            id: chapterId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            number: chapterNumber,
            title: chapterInput.title,
            status: "writing",
            version: 1,
            wordCount: countWords(chapterInput.content),
          })
          .returning();
        if (!chapter) {
          throw new Error("Failed to create imported chapter");
        }

        await transaction.insert(versionNodes).values({
          id: versionNodeId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          parentNodeId,
          nodeType: "chapter_version",
          objectType: "chapter",
          objectId: chapter.id,
          objectVersion: 1,
          payload: { contentHash, importId: input.importId, source: "manuscript_import" },
          actorId: input.userId,
          message: `导入第 ${chapterNumber} 章`,
        });

        await transaction.insert(chapterVersions).values({
          id: versionId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          chapterId: chapter.id,
          version: 1,
          content: chapterInput.content,
          contentHash,
          versionNodeId,
          source: "manuscript_import",
        });

        await transaction
          .update(chapters)
          .set({ currentVersionId: versionId, updatedAt: new Date() })
          .where(eq(chapters.id, chapter.id));
        parentNodeId = versionNodeId;
      }

      await transaction
        .update(workBranches)
        .set({ headNodeId: parentNodeId, updatedAt: new Date() })
        .where(eq(workBranches.id, branch.id));
      await transaction
        .update(importJobs)
        .set({
          status: "completed",
          workId: work.id,
          branchId: branch.id,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, input.importId));
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "manuscript_import.completed",
        targetType: "work",
        targetId: work.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });

      return this.readConfirmed(transaction, input.userId, work.id);
    });
  }

  private async readConfirmed(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
  ): Promise<ConfirmedManuscriptResult> {
    const [branch] = await transaction
      .select()
      .from(workBranches)
      .where(
        and(
          eq(workBranches.workId, workId),
          eq(workBranches.userId, userId),
          eq(workBranches.name, "main"),
        ),
      )
      .limit(1);
    if (!branch) {
      throw new Error("Imported work is missing its main branch");
    }
    const chapterRecords = await transaction
      .select()
      .from(chapters)
      .where(and(eq(chapters.workId, workId), eq(chapters.userId, userId)))
      .orderBy(chapters.number);
    const versionRecords = await transaction
      .select()
      .from(chapterVersions)
      .where(and(eq(chapterVersions.workId, workId), eq(chapterVersions.userId, userId)))
      .orderBy(chapterVersions.createdAt);
    const nodeRecords = await transaction
      .select()
      .from(versionNodes)
      .where(
        and(
          eq(versionNodes.workId, workId),
          eq(versionNodes.userId, userId),
          eq(versionNodes.nodeType, "chapter_version"),
        ),
      );
    const parentByNodeId = new Map(
      nodeRecords.map((node) => [node.id, node.parentNodeId] as const),
    );
    const versionByChapterId = new Map(
      versionRecords.map((version) => [version.chapterId, version]),
    );
    return {
      workId,
      branchId: branch.id,
      chapters: chapterRecords,
      chapterVersions: chapterRecords.flatMap((chapter) => {
        const version = versionByChapterId.get(chapter.id);
        return version
          ? [{ ...version, parentNodeId: parentByNodeId.get(version.versionNodeId) ?? null }]
          : [];
      }),
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
