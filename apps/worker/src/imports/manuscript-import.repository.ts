import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  MAX_MANUSCRIPT_CHAPTERS,
  PROCESS_IMPORT_JOB,
  manuscriptScanStateSchema,
  type ImportProcessJob,
  type ManuscriptScanState,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";

import {
  IMPORT_RECOVERY_SYSTEM_ROLE,
  createManuscriptScanState,
  manuscriptChaptersFromScan,
  scanManuscriptChunk,
} from "@novel-brain/core";

interface ImportJobRow {
  status: string;
  chunk_count: number;
  processed_chunks: number;
  checkpoint: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

interface ImportChunkRow {
  sequence: number;
  source_text: string;
  start_offset: number;
  end_offset: number;
}

export interface ImportProcessStep {
  continue: boolean;
  failed: boolean;
}

@Injectable()
export class WorkerManuscriptImportRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl, {
      query_timeout: 15_000,
      statement_timeout: 15_000,
    });
  }

  async processNextChunk(actorId: string, importId: string): Promise<ImportProcessStep> {
    return this.withTenant(actorId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `manuscript-import:${actorId}:${importId}`,
      ]);
      const jobResult = await client.query<ImportJobRow>(
        `SELECT status, chunk_count, processed_chunks, checkpoint, metadata
           FROM import_jobs
          WHERE id = $1
            AND user_id = $2
            AND mode = 'manuscript_text'
            AND metadata->>'chunked' = 'true'
          FOR UPDATE`,
        [importId, actorId],
      );
      const job = jobResult.rows[0];
      if (!job) {
        return { continue: false, failed: true };
      }
      if (
        job.status === "paused" ||
        job.status === "partial" ||
        job.status === "failed" ||
        job.status === "cancelled" ||
        job.status === "completed" ||
        job.status === "awaiting_confirmation"
      ) {
        return { continue: false, failed: false };
      }

      const expectedSequence =
        checkpointNumber(job.checkpoint, "nextProcessSequence") ?? job.processed_chunks;
      const chunkResult = await client.query<ImportChunkRow>(
        `SELECT sequence, source_text, start_offset, end_offset
           FROM import_chunks
          WHERE import_job_id = $1
            AND user_id = $2
            AND status = 'pending'
            AND sequence = $3
          FOR UPDATE`,
        [importId, actorId, expectedSequence],
      );
      const chunk = chunkResult.rows[0];
      if (!chunk) {
        const uploadedChunks = await this.uploadedChunkCount(
          client,
          actorId,
          importId,
          job.checkpoint,
        );
        const completed =
          uploadedChunks >= job.chunk_count && job.processed_chunks >= job.chunk_count;
        await client.query(
          `UPDATE import_jobs
              SET status = $2, updated_at = now()
            WHERE id = $1`,
          [importId, completed ? "awaiting_confirmation" : "processing"],
        );
        return { continue: false, failed: false };
      }

      const failureSequenceText = process.env.FAKE_IMPORT_FAILURE_SEQUENCE?.trim() ?? "";
      const failureSequence = failureSequenceText ? Number(failureSequenceText) : Number.NaN;
      if (Number.isInteger(failureSequence) && failureSequence === chunk.sequence) {
        await client.query(
          `UPDATE import_chunks
              SET status = 'failed', error_message = $3, updated_at = now()
            WHERE import_job_id = $1 AND user_id = $2 AND sequence = $4`,
          [importId, actorId, "分块处理暂时失败，可继续导入。", chunk.sequence],
        );
        await client.query(
          `UPDATE import_jobs
              SET status = 'partial',
                  checkpoint = jsonb_set(
                    checkpoint,
                    '{manuscriptError}',
                    to_jsonb($2::text),
                    true
                  ),
                  updated_at = now()
            WHERE id = $1`,
          [importId, `sequence ${chunk.sequence}`],
        );
        return { continue: false, failed: true };
      }

      try {
        const previousState = await this.manuscriptStateFromCheckpoint(
          client,
          actorId,
          importId,
          job.checkpoint,
          job.metadata,
          expectedSequence,
        );
        if (previousState.offset !== chunk.start_offset) {
          throw new Error("分块检查点与原文偏移不一致");
        }
        const nextState = scanManuscriptChunk(
          previousState,
          chunk.source_text,
          chunk.sequence === job.chunk_count - 1,
          { headingStarts: headingStartsFromMetadata(job.metadata) },
        );
        if (
          chunk.sequence === job.chunk_count - 1 &&
          manuscriptChaptersFromScan(nextState, nextState.offset).chapters.length >
            MAX_MANUSCRIPT_CHAPTERS
        ) {
          throw new Error("章节数量超过 V1 导入上限");
        }
        const processedChunks = job.processed_chunks + 1;
        const uploadedChunks = await this.uploadedChunkCount(
          client,
          actorId,
          importId,
          job.checkpoint,
        );
        const completed = uploadedChunks >= job.chunk_count && processedChunks >= job.chunk_count;
        await client.query(
          `UPDATE import_chunks
              SET status = 'processed', error_message = NULL, updated_at = now()
            WHERE import_job_id = $1 AND user_id = $2 AND sequence = $3`,
          [importId, actorId, chunk.sequence],
        );
        await client.query(
          `UPDATE import_jobs
              SET status = $2,
                  processed_chunks = $3,
                  checkpoint = $4::jsonb,
                  updated_at = now()
            WHERE id = $1`,
          [
            importId,
            completed ? "awaiting_confirmation" : "processing",
            processedChunks,
            JSON.stringify({
              ...job.checkpoint,
              nextProcessSequence: chunk.sequence + 1,
              uploadedChunks,
              sourceCharacterCount: chunk.end_offset,
              manuscript: nextState,
              manuscriptError: null,
            }),
          ],
        );
        return { continue: !completed, failed: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "分块处理失败";
        await client.query(
          `UPDATE import_chunks
              SET status = 'failed', error_message = $3, updated_at = now()
            WHERE import_job_id = $1 AND user_id = $2 AND sequence = $4`,
          [importId, actorId, message.slice(0, 500), chunk.sequence],
        );
        await client.query(
          `UPDATE import_jobs
              SET status = 'partial',
                  checkpoint = jsonb_set(checkpoint, '{manuscriptError}', to_jsonb($2::text), true),
                  updated_at = now()
            WHERE id = $1`,
          [importId, message.slice(0, 500)],
        );
        return { continue: false, failed: true };
      }
    });
  }

  async listRecoverableJobs(limit = 50): Promise<ImportProcessJob[]> {
    const client = await this.pool.connect();
    let rows: Array<{
      id: string;
      user_id: string;
      processed_chunks: number;
      checkpoint: Record<string, unknown>;
    }>;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_role', $1, true)", [
        IMPORT_RECOVERY_SYSTEM_ROLE,
      ]);
      const result = await client.query<{
        id: string;
        user_id: string;
        processed_chunks: number;
        checkpoint: Record<string, unknown>;
      }>(
        `SELECT job.id, job.user_id, job.processed_chunks, job.checkpoint
           FROM import_jobs AS job
          WHERE job.mode = 'manuscript_text'
            AND job.metadata->>'chunked' = 'true'
            AND job.status IN ('queued', 'processing')
            AND EXISTS (
              SELECT 1
                FROM import_chunks AS chunk
               WHERE chunk.import_job_id = job.id
                 AND chunk.user_id = job.user_id
                 AND chunk.status = 'pending'
            )
          ORDER BY job.updated_at
          LIMIT $1`,
        [Math.max(1, Math.min(200, limit))],
      );
      rows = result.rows;
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return rows.map((row) => {
      const nextProcessSequence = checkpointNumber(row.checkpoint, "nextProcessSequence") ?? 0;
      const uploadedChunks = checkpointNumber(row.checkpoint, "uploadedChunks") ?? 0;
      return {
        jobType: PROCESS_IMPORT_JOB,
        importId: row.id,
        workId: null,
        branchId: null,
        actorId: row.user_id,
        idempotencyKey: `manuscript-import-${row.id}-${nextProcessSequence}-${uploadedChunks}`,
        checkpoint: {
          schemaVersion: 1,
          revision: row.processed_chunks,
          nextProcessSequence,
          uploadedChunks,
          processedChunks: row.processed_chunks,
        },
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async manuscriptStateFromCheckpoint(
    client: PoolClient,
    userId: string,
    importId: string,
    checkpoint: Record<string, unknown>,
    metadata: Record<string, unknown>,
    expectedSequence: number,
  ): Promise<ManuscriptScanState> {
    if (checkpoint.manuscript) {
      return manuscriptScanStateSchema.parse(checkpoint.manuscript);
    }
    let state = createManuscriptScanState();
    if (expectedSequence === 0) {
      return state;
    }
    let lastSequence = -1;
    while (lastSequence + 1 < expectedSequence) {
      const processedChunks = await client.query<{
        sequence: number;
        source_text: string;
        start_offset: number;
      }>(
        `SELECT sequence, source_text, start_offset
           FROM import_chunks
          WHERE import_job_id = $1
            AND user_id = $2
            AND status = 'processed'
            AND sequence > $3
            AND sequence < $4
          ORDER BY sequence
          LIMIT 4`,
        [importId, userId, lastSequence, expectedSequence],
      );
      if (processedChunks.rows.length === 0) {
        throw new Error("旧分块检查点不完整，无法重建解析状态");
      }
      for (const chunk of processedChunks.rows) {
        if (chunk.sequence !== lastSequence + 1 || chunk.start_offset !== state.offset) {
          throw new Error("旧分块检查点不连续，无法重建解析状态");
        }
        state = scanManuscriptChunk(state, chunk.source_text, false, {
          headingStarts: headingStartsFromMetadata(metadata),
        });
        lastSequence = chunk.sequence;
      }
    }
    if (lastSequence + 1 !== expectedSequence) {
      throw new Error("旧分块检查点不连续，无法重建解析状态");
    }
    return state;
  }

  private async uploadedChunkCount(
    client: PoolClient,
    userId: string,
    importId: string,
    checkpoint: Record<string, unknown>,
  ): Promise<number> {
    const checkpointCount = checkpointNumber(checkpoint, "uploadedChunks");
    if (checkpointCount !== undefined) {
      return checkpointCount;
    }
    const result = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM import_chunks
        WHERE import_job_id = $1 AND user_id = $2`,
      [importId, userId],
    );
    return result.rows[0]?.count ?? 0;
  }
}

function headingStartsFromMetadata(metadata: Record<string, unknown>): number[] {
  return Array.isArray(metadata.sourceHeadingStarts)
    ? metadata.sourceHeadingStarts.filter(
        (value): value is number => typeof value === "number" && Number.isInteger(value),
      )
    : [];
}

function checkpointNumber(checkpoint: Record<string, unknown>, key: string): number | undefined {
  const value = checkpoint[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
