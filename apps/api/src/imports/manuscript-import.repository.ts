import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  genrePacks,
  importChunks,
  importJobs,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

import type { ManuscriptSourceRange } from "@novel-brain/contracts";
import { isWellFormedUtf16 } from "@novel-brain/core";
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

interface ConfirmManuscriptInput {
  userId: string;
  importId: string;
  displayName: string;
  title: string;
  penName?: string;
  genre: string;
  scaleTarget: string;
  chapterLengthTarget: number;
  audit: WorksAuditContext;
  idempotencyKey: string;
}

interface ConfirmChapterInput {
  title: string;
  sourceRange: ManuscriptSourceRange;
}

type ChapterContentLoader = (
  transaction: DatabaseTransaction,
  index: number,
  sourceRange: ManuscriptSourceRange,
) => Promise<string>;

function checkpointNumber(checkpoint: Record<string, unknown>, key: string): number | undefined {
  const value = checkpoint[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
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
    metadata: Record<string, unknown>;
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
          metadata: input.metadata,
        })
        .returning();
      if (!job) {
        throw new Error("Failed to create manuscript import");
      }
      return job;
    });
  }

  async createChunked(input: {
    id: string;
    userId: string;
    sourceName: string;
    chunks: string[];
    idempotencyKey: string;
  }): Promise<ManuscriptImportJobRecord | "idempotency_conflict"> {
    return this.withTenant(input.userId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.idempotencyKey}`}))`,
      );
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ sourceName: input.sourceName, chunks: input.chunks }))
        .digest("hex");
      const [existing] = await transaction
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.userId, input.userId),
            eq(importJobs.mode, "manuscript_text"),
            eq(importJobs.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return existing.metadata.requestHash === requestHash ? existing : "idempotency_conflict";
      }
      let offset = 0;
      const [job] = await transaction
        .insert(importJobs)
        .values({
          id: input.id,
          userId: input.userId,
          mode: "manuscript_text",
          status: "queued",
          sourceKind: "paste",
          sourceName: input.sourceName,
          sourceText: "",
          idempotencyKey: input.idempotencyKey,
          chunkCount: input.chunks.length,
          processedChunks: 0,
          checkpoint: {
            nextUploadSequence: input.chunks.length,
            nextProcessSequence: 0,
            uploadedChunks: input.chunks.length,
          },
          metadata: { chunked: true, requestHash },
        })
        .returning();
      if (!job) {
        throw new Error("Failed to create chunked manuscript import");
      }
      await transaction.insert(importChunks).values(
        input.chunks.map((chunk, sequence) => {
          const startOffset = offset;
          offset += chunk.length;
          return {
            id: uuidv7(),
            importJobId: job.id,
            userId: input.userId,
            sequence,
            sourceText: chunk,
            startOffset,
            endOffset: offset,
            status: "pending",
          };
        }),
      );
      return job;
    });
  }

  async createChunkedStart(input: {
    id: string;
    userId: string;
    sourceName: string;
    chunkCount: number;
    idempotencyKey: string;
  }): Promise<ManuscriptImportJobRecord | "idempotency_conflict"> {
    return this.withTenant(input.userId, async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.idempotencyKey}`}))`,
      );
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ sourceName: input.sourceName, chunkCount: input.chunkCount }))
        .digest("hex");
      const [existing] = await transaction
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.userId, input.userId),
            eq(importJobs.mode, "manuscript_text"),
            eq(importJobs.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        return existing.metadata.requestHash === requestHash ? existing : "idempotency_conflict";
      }
      const [job] = await transaction
        .insert(importJobs)
        .values({
          id: input.id,
          userId: input.userId,
          mode: "manuscript_text",
          status: "queued",
          sourceKind: "paste",
          sourceName: input.sourceName,
          sourceText: "",
          idempotencyKey: input.idempotencyKey,
          chunkCount: input.chunkCount,
          processedChunks: 0,
          checkpoint: { nextUploadSequence: 0, nextProcessSequence: 0, uploadedChunks: 0 },
          metadata: { chunked: true, streamed: true, requestHash },
        })
        .returning();
      if (!job) {
        throw new Error("Failed to start chunked manuscript import");
      }
      return job;
    });
  }

  async appendChunk(input: {
    userId: string;
    importId: string;
    sequence: number;
    sourceText: string;
  }): Promise<
    ManuscriptImportJobRecord | "not_ready" | "sequence_conflict" | "invalid_text" | undefined
  > {
    if (!isWellFormedUtf16(input.sourceText)) {
      return "invalid_text";
    }
    return this.withTenant(input.userId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, input.importId),
            eq(importJobs.userId, input.userId),
            eq(importJobs.mode, "manuscript_text"),
            sql`${importJobs.metadata}->>'chunked' = 'true'`,
          ),
        )
        .for("update")
        .limit(1);
      if (!job || input.sequence >= job.chunkCount) {
        return undefined;
      }
      if (job.status === "cancelled" || job.status === "completed") {
        return "not_ready";
      }
      const [existing] = await transaction
        .select({ id: importChunks.id, sourceText: importChunks.sourceText })
        .from(importChunks)
        .where(
          and(
            eq(importChunks.importJobId, input.importId),
            eq(importChunks.userId, input.userId),
            eq(importChunks.sequence, input.sequence),
          ),
        )
        .limit(1);
      if (existing) {
        return existing.sourceText === input.sourceText ? job : "sequence_conflict";
      }
      const [last] = await transaction
        .select({ sequence: importChunks.sequence, endOffset: importChunks.endOffset })
        .from(importChunks)
        .where(
          and(eq(importChunks.importJobId, input.importId), eq(importChunks.userId, input.userId)),
        )
        .orderBy(desc(importChunks.sequence))
        .limit(1);
      const expectedSequence =
        checkpointNumber(job.checkpoint, "nextUploadSequence") ??
        checkpointNumber(job.checkpoint, "nextSequence") ??
        (last?.sequence ?? -1) + 1;
      if (input.sequence !== expectedSequence) {
        return "sequence_conflict";
      }
      const startOffset = last?.endOffset ?? 0;
      const endOffset = startOffset + input.sourceText.length;
      await transaction.insert(importChunks).values({
        id: uuidv7(),
        importJobId: input.importId,
        userId: input.userId,
        sequence: input.sequence,
        sourceText: input.sourceText,
        startOffset,
        endOffset,
        status: "pending",
      });
      const uploadedChunks =
        (checkpointNumber(job.checkpoint, "uploadedChunks") ??
          Math.max(0, checkpointNumber(job.checkpoint, "nextSequence") ?? 0)) + 1;
      const [updated] = await transaction
        .update(importJobs)
        .set({
          status:
            job.status === "partial" && uploadedChunks >= job.chunkCount ? "queued" : job.status,
          checkpoint: {
            ...job.checkpoint,
            nextUploadSequence: input.sequence + 1,
            uploadedChunks,
          },
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, input.importId))
        .returning();
      return updated;
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

  async sourceText(userId: string, importId: string): Promise<string | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, importId),
            eq(importJobs.userId, userId),
            eq(importJobs.mode, "manuscript_text"),
          ),
        )
        .limit(1);
      if (!job) {
        return undefined;
      }
      const chunks = await transaction
        .select({ sourceText: importChunks.sourceText })
        .from(importChunks)
        .where(and(eq(importChunks.importJobId, importId), eq(importChunks.userId, userId)))
        .orderBy(importChunks.sequence);
      return chunks.map((chunk) => chunk.sourceText).join("");
    });
  }

  async hasSourceText(userId: string, importId: string): Promise<boolean | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, importId),
            eq(importJobs.userId, userId),
            eq(importJobs.mode, "manuscript_text"),
          ),
        )
        .limit(1);
      if (!job) {
        return undefined;
      }
      const result = await transaction.execute<{ has_text: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM import_chunks
          WHERE import_job_id = ${importId}::uuid
            AND user_id = ${userId}::uuid
            AND source_text ~ E'\\S'
        ) AS has_text
      `);
      return Boolean(result.rows[0]?.has_text);
    });
  }

  async chaptersMatchSource(
    userId: string,
    importId: string,
    chapters: Array<{ content: string }>,
  ): Promise<boolean | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select({ chunkCount: importJobs.chunkCount })
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, importId),
            eq(importJobs.userId, userId),
            eq(importJobs.mode, "manuscript_text"),
          ),
        )
        .limit(1);
      if (!job) {
        return undefined;
      }
      let chapterIndex = 0;
      let chapterOffset = 0;
      for (let sequence = 0; sequence < job.chunkCount; sequence += 1) {
        const [chunk] = await transaction
          .select({ sourceText: importChunks.sourceText })
          .from(importChunks)
          .where(
            and(
              eq(importChunks.importJobId, importId),
              eq(importChunks.userId, userId),
              eq(importChunks.sequence, sequence),
            ),
          )
          .limit(1);
        if (!chunk) {
          return false;
        }
        let chunkOffset = 0;
        while (chunkOffset < chunk.sourceText.length) {
          const chapter = chapters[chapterIndex];
          if (!chapter) {
            return false;
          }
          const remainingChapter = chapter.content.slice(chapterOffset);
          const compareLength = Math.min(
            remainingChapter.length,
            chunk.sourceText.length - chunkOffset,
          );
          if (
            compareLength === 0 ||
            remainingChapter.slice(0, compareLength) !==
              chunk.sourceText.slice(chunkOffset, chunkOffset + compareLength)
          ) {
            return false;
          }
          chapterOffset += compareLength;
          chunkOffset += compareLength;
          if (chapterOffset === chapter.content.length) {
            chapterIndex += 1;
            chapterOffset = 0;
          }
        }
      }
      return chapterIndex === chapters.length && chapterOffset === 0;
    });
  }

  async setChunkedStatus(
    userId: string,
    importId: string,
    action: "pause" | "resume" | "cancel",
  ): Promise<ManuscriptImportJobRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [job] = await transaction
        .select()
        .from(importJobs)
        .where(
          and(
            eq(importJobs.id, importId),
            eq(importJobs.userId, userId),
            eq(importJobs.mode, "manuscript_text"),
            sql`${importJobs.metadata}->>'chunked' = 'true'`,
          ),
        )
        .for("update")
        .limit(1);
      if (!job) {
        return undefined;
      }
      if (action === "cancel") {
        if (job.status === "completed" || job.status === "cancelled") {
          return job;
        }
        const [cancelled] = await transaction
          .update(importJobs)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(importJobs.id, importId))
          .returning();
        return cancelled;
      }
      if (action === "pause") {
        if (job.status === "completed" || job.status === "cancelled" || job.status === "paused") {
          return job;
        }
        const [paused] = await transaction
          .update(importJobs)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(importJobs.id, importId))
          .returning();
        return paused;
      }
      const resetFailedChunks =
        action === "resume"
          ? await transaction
              .update(importChunks)
              .set({ status: "pending", errorMessage: null, updatedAt: new Date() })
              .where(
                and(
                  eq(importChunks.importJobId, importId),
                  eq(importChunks.userId, userId),
                  eq(importChunks.status, "failed"),
                ),
              )
              .returning({ id: importChunks.id })
          : [];
      if (resetFailedChunks.length > 0 || job.status === "partial" || job.status === "failed") {
        const [resumed] = await transaction
          .update(importJobs)
          .set({
            status: job.processedChunks > 0 ? "processing" : "queued",
            checkpoint: { ...job.checkpoint, manuscriptError: null },
            updatedAt: new Date(),
          })
          .where(eq(importJobs.id, importId))
          .returning();
        return resumed;
      }
      if (job.status !== "paused") {
        return job;
      }
      const [resumed] = await transaction
        .update(importJobs)
        .set({
          status: job.processedChunks > 0 ? "processing" : "queued",
          updatedAt: new Date(),
        })
        .where(eq(importJobs.id, importId))
        .returning();
      return resumed;
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
    chapters: Array<{ title: string; content: string; sourceRange: ManuscriptSourceRange }>;
    audit: WorksAuditContext;
    idempotencyKey: string;
  }): Promise<ConfirmedManuscriptResult | "not_ready" | undefined> {
    const result = await this.confirmWork(input, input.chapters, async (_transaction, index) => {
      return input.chapters[index]?.content ?? "";
    });
    if (result === "not_ready" || result === undefined) {
      return result;
    }
    return this.withTenant(input.userId, (transaction) =>
      this.readConfirmed(transaction, input.userId, result.workId),
    );
  }

  async confirmRanges(input: {
    userId: string;
    importId: string;
    displayName: string;
    title: string;
    penName?: string;
    genre: string;
    scaleTarget: string;
    chapterLengthTarget: number;
    chapters: Array<{ title: string; sourceRange: ManuscriptSourceRange }>;
    audit: WorksAuditContext;
    idempotencyKey: string;
  }): Promise<{ workId: string } | "not_ready" | undefined> {
    let chunkCursor: {
      sequence: number;
      sourceText: string;
      startOffset: number;
      endOffset: number;
    } | null = null;
    return this.confirmWork(input, input.chapters, async (transaction, _index, sourceRange) => {
      let content = "";
      let offset = sourceRange.start;
      while (offset < sourceRange.end) {
        if (!chunkCursor || offset < chunkCursor.startOffset || offset >= chunkCursor.endOffset) {
          const [chunk] = await transaction
            .select({
              sequence: importChunks.sequence,
              sourceText: importChunks.sourceText,
              startOffset: importChunks.startOffset,
              endOffset: importChunks.endOffset,
            })
            .from(importChunks)
            .where(
              and(
                eq(importChunks.importJobId, input.importId),
                eq(importChunks.userId, input.userId),
                sql`${importChunks.startOffset} <= ${offset}`,
                sql`${importChunks.endOffset} > ${offset}`,
              ),
            )
            .limit(1);
          if (!chunk) {
            throw new Error("Chunked manuscript source is incomplete");
          }
          chunkCursor = chunk;
        }
        const chunkOffset = offset - chunkCursor.startOffset;
        const available = Math.min(sourceRange.end, chunkCursor.endOffset) - offset;
        content += chunkCursor.sourceText.slice(chunkOffset, chunkOffset + available);
        offset += available;
      }
      return content;
    });
  }

  async validateChunkedRanges(
    userId: string,
    importId: string,
    chapters: Array<{ sourceRange: ManuscriptSourceRange }>,
  ): Promise<boolean | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const chunks = await transaction
        .select({
          startOffset: importChunks.startOffset,
          endOffset: importChunks.endOffset,
        })
        .from(importChunks)
        .where(and(eq(importChunks.importJobId, importId), eq(importChunks.userId, userId)))
        .orderBy(importChunks.sequence);
      if (chunks.length === 0) {
        return true;
      }
      const totalCharacters = chunks.at(-1)?.endOffset ?? 0;
      let expectedStart = 0;
      const boundaries = new Set<number>();
      for (const chapter of chapters) {
        if (
          chapter.sourceRange.start !== expectedStart ||
          chapter.sourceRange.end <= chapter.sourceRange.start
        ) {
          return false;
        }
        expectedStart = chapter.sourceRange.end;
        boundaries.add(chapter.sourceRange.start);
        boundaries.add(chapter.sourceRange.end);
      }
      if (expectedStart !== totalCharacters) {
        return false;
      }
      boundaries.delete(0);
      boundaries.delete(totalCharacters);
      for (const chunk of chunks) {
        const interiorBoundaries = [...boundaries].filter(
          (boundary) => boundary > chunk.startOffset && boundary < chunk.endOffset,
        );
        if (interiorBoundaries.length === 0) {
          continue;
        }
        const boundaryArray = sql.raw(`ARRAY[${interiorBoundaries.map(String).join(",")}]`);
        const result = await transaction.execute<{ boundary: number; pair: string }>(sql`
          SELECT boundary.value AS boundary,
                 substring(
                   chunk.source_text
                   FROM boundary.value - chunk.start_offset
                   FOR 2
                 ) AS pair
            FROM import_chunks AS chunk
            CROSS JOIN unnest(${boundaryArray}) AS boundary(value)
           WHERE chunk.import_job_id = ${importId}
             AND chunk.user_id = ${userId}
             AND chunk.start_offset = ${chunk.startOffset}
        `);
        for (const row of result.rows) {
          const previous = row.pair.charCodeAt(0);
          const next = row.pair.charCodeAt(1);
          if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
            return false;
          }
        }
      }
      return true;
    });
  }

  private async confirmWork(
    input: ConfirmManuscriptInput,
    chapterInputs: ConfirmChapterInput[],
    loadChapterContent: ChapterContentLoader,
  ): Promise<{ workId: string } | "not_ready" | undefined> {
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
      if (job.status !== "awaiting_confirmation" && job.status !== "completed") {
        return "not_ready";
      }
      if (job.status === "completed" && job.workId) {
        return { workId: job.workId };
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
      for (let batchStart = 0; batchStart < chapterInputs.length; batchStart += 100) {
        const batchInputs = chapterInputs.slice(batchStart, batchStart + 100);
        const batch = [];
        for (const [batchIndex, chapterInput] of batchInputs.entries()) {
          const index = batchStart + batchIndex;
          const content = await loadChapterContent(transaction, index, chapterInput.sourceRange);
          batch.push({
            chapterInput,
            content,
            chapterId: uuidv7(),
            versionId: uuidv7(),
            versionNodeId: uuidv7(),
          });
        }
        await transaction.insert(chapters).values(
          batch.map(({ chapterInput, chapterId, content }, batchIndex) => ({
            id: chapterId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            number: batchStart + batchIndex + 1,
            title: chapterInput.title,
            status: "writing",
            version: 1,
            wordCount: countWords(content),
          })),
        );
        const versionNodeValues = batch.map(
          ({ chapterInput, chapterId, versionNodeId, content }, batchIndex) => {
            const chapterNumber = batchStart + batchIndex + 1;
            const value = {
              id: versionNodeId,
              workId: work.id,
              branchId: branch.id,
              userId: input.userId,
              parentNodeId,
              nodeType: "chapter_version",
              objectType: "chapter",
              objectId: chapterId,
              objectVersion: 1,
              payload: {
                contentHash: createHash("sha256").update(content).digest("hex"),
                importId: input.importId,
                source: "manuscript_import",
                chapterNumber,
                sourceRange: chapterInput.sourceRange,
              },
              actorId: input.userId,
              message: `导入第 ${chapterNumber} 章`,
            };
            parentNodeId = versionNodeId;
            return value;
          },
        );
        await transaction.insert(versionNodes).values(versionNodeValues);
        await transaction.insert(chapterVersions).values(
          batch.map(({ chapterId, versionId, versionNodeId, content }) => ({
            id: versionId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            chapterId,
            version: 1,
            content,
            contentHash: createHash("sha256").update(content).digest("hex"),
            versionNodeId,
            source: "manuscript_import",
          })),
        );
        await transaction.execute(sql`
          UPDATE chapters AS chapter
             SET current_version_id = current_version.version_id,
                 updated_at = now()
            FROM unnest(
              ${sql.raw(`ARRAY[${batch.map(({ chapterId }) => `'${chapterId}'::uuid`).join(",")}]`)},
              ${sql.raw(`ARRAY[${batch.map(({ versionId }) => `'${versionId}'::uuid`).join(",")}]`)}
            ) AS current_version(chapter_id, version_id)
           WHERE chapter.id = current_version.chapter_id
        `);
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

      return { workId: work.id };
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
