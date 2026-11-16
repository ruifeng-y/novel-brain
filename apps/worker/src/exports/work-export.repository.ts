import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  EXPORT_WORK_JOB,
  workExportRequestSchema,
  workExportSourceDescriptorSchema,
  type ExportWorkJob,
  type WorkExportManifest,
  type WorkExportRequest,
  type WorkExportSourceDescriptor,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

export interface LoadedWorkExport {
  jobId: string;
  exportId: string;
  userId: string;
  workId: string;
  branchId: string;
  request: WorkExportRequest;
  source: WorkExportSourceDescriptor;
  work: {
    id: string;
    title: string;
    penName: string;
    genre: "xianxia" | "history" | "urban";
  };
  branch: {
    id: string;
    name: string;
  };
  chapters: Array<{
    chapterId: string;
    chapterNumber: number;
    title: string;
    chapterVersionId: string;
    versionNodeId: string;
    content: string;
    volumeNodeId: string | null;
    volumeNumber: number | null;
    volumeTitle: string | null;
  }>;
  supplements: WorkExportSourceDescriptor["supplements"];
}

@Injectable()
export class WorkerWorkExportRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async loadAndBegin(payload: ExportWorkJob): Promise<LoadedWorkExport | null> {
    return this.withTenant(payload.actorId, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [payload.jobId]);
      const row = await client.query<{
        job_status: string;
        export_id: string;
        work_id: string;
        branch_id: string;
        request: WorkExportRequest;
        source_descriptor: WorkExportSourceDescriptor;
        work_title: string;
        work_pen_name: string;
        work_genre: "xianxia" | "history" | "urban";
        branch_name: string;
      }>(
        `SELECT j.status AS job_status, r.id AS export_id, r.work_id, r.branch_id,
                r.request, r.source_descriptor,
                w.title AS work_title, w.pen_name AS work_pen_name, w.genre AS work_genre,
                b.name AS branch_name
           FROM jobs j
           JOIN work_export_receipts r ON r.job_id = j.id
           JOIN works w ON w.id = r.work_id
           JOIN work_branches b ON b.id = r.branch_id
          WHERE j.id = $1 AND j.user_id = $2 AND j.work_id = $3
            AND j.branch_id = $4 AND j.type = $5
            AND r.id = $6`,
        [
          payload.jobId,
          payload.actorId,
          payload.workId,
          payload.branchId,
          EXPORT_WORK_JOB,
          payload.exportId,
        ],
      );
      const loaded = row.rows[0];
      if (!loaded) {
        return null;
      }
      if (["completed", "failed", "cancelled"].includes(loaded.job_status)) {
        return null;
      }
      const request = workExportRequestSchema.parse(loaded.request);
      const source = workExportSourceDescriptorSchema.parse(loaded.source_descriptor);
      const chapterVersions = await client.query<{
        id: string;
        chapter_id: string;
        content: string;
        content_hash: string;
        version_node_id: string;
      }>(
        `SELECT id, chapter_id, content, content_hash, version_node_id
           FROM chapter_versions
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
            AND id = ANY($4::uuid[])`,
        [
          payload.actorId,
          payload.workId,
          payload.branchId,
          source.chapters.map((chapter) => chapter.chapterVersionId),
        ],
      );
      const versionById = new Map(chapterVersions.rows.map((version) => [version.id, version]));
      const chapters = source.chapters.map((descriptor) => {
        const version = versionById.get(descriptor.chapterVersionId);
        if (
          !version ||
          version.chapter_id !== descriptor.chapterId ||
          version.version_node_id !== descriptor.versionNodeId ||
          version.content_hash !== descriptor.expectedContentHash ||
          sha256(version.content) !== descriptor.expectedContentHash
        ) {
          throw new WorkExportSourceChangedError();
        }
        return {
          chapterId: descriptor.chapterId,
          chapterNumber: descriptor.chapterNumber,
          title: descriptor.title,
          chapterVersionId: descriptor.chapterVersionId,
          versionNodeId: descriptor.versionNodeId,
          content: version.content,
          volumeNodeId: descriptor.volumeNodeId,
          volumeNumber: descriptor.volumeNumber,
          volumeTitle: descriptor.volumeTitle,
        };
      });
      for (const supplement of source.supplements) {
        if (sha256(supplement.content) !== supplement.contentSha256) {
          throw new WorkExportSourceChangedError();
        }
      }
      const now = new Date();
      await client.query(
        `UPDATE jobs
            SET status = 'running', progress = 10, current_step = 'prepare',
                started_at = coalesce(started_at, $2), updated_at = $2
          WHERE id = $1`,
        [payload.jobId, now],
      );
      await client.query(
        `UPDATE work_export_receipts SET status = 'running', updated_at = $2 WHERE id = $1`,
        [payload.exportId, now],
      );
      return {
        jobId: payload.jobId,
        exportId: payload.exportId,
        userId: payload.actorId,
        workId: payload.workId,
        branchId: payload.branchId,
        request,
        source,
        work: {
          id: payload.workId,
          title: loaded.work_title,
          penName: loaded.work_pen_name,
          genre: loaded.work_genre,
        },
        branch: {
          id: payload.branchId,
          name: loaded.branch_name,
        },
        chapters,
        supplements: source.supplements,
      };
    });
  }

  async complete(input: {
    loaded: LoadedWorkExport;
    manifest: WorkExportManifest;
    checksum: string;
    contentType: string;
    fileName: string;
    bytes: Uint8Array;
  }): Promise<void> {
    await this.withTenant(input.loaded.userId, async (client) => {
      const now = new Date();
      await client.query(
        `UPDATE work_export_receipts
            SET status = 'completed', manifest = $2::jsonb, artifact_payload = $3,
                checksum = $4, byte_size = $5, file_name = $6, content_type = $7,
                completed_at = $8, updated_at = $8, error_code = NULL, error_message = NULL
          WHERE id = $1`,
        [
          input.loaded.exportId,
          JSON.stringify(input.manifest),
          Buffer.from(input.bytes).toString("base64"),
          input.checksum,
          input.bytes.byteLength,
          input.fileName,
          input.contentType,
          now,
        ],
      );
      await client.query(
        `UPDATE jobs
            SET status = 'completed', progress = 100, current_step = 'complete',
                checkpoint = $2::jsonb, finished_at = $3, updated_at = $3
          WHERE id = $1`,
        [
          input.loaded.jobId,
          JSON.stringify({
            schemaVersion: 1,
            revision: 1,
            step: "complete",
            inputHash: input.manifest.manifestHash,
            outputRefs: [{ type: "artifact", id: input.loaded.exportId }],
            payload: {
              checksum: input.checksum,
              byteSize: input.bytes.byteLength,
              fileName: input.fileName,
            },
          }),
          now,
        ],
      );
      for (const step of ["prepare", "render", "complete"] as const) {
        await client.query(
          `INSERT INTO job_steps
            (id, job_id, user_id, work_id, branch_id, step_key, status,
             input_hash, output_refs, started_at, finished_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', $7, $8::jsonb, $9, $9, $9)
           ON CONFLICT (job_id, step_key) DO UPDATE
             SET status = 'succeeded',
                 input_hash = excluded.input_hash, output_refs = excluded.output_refs,
                 finished_at = excluded.finished_at`,
          [
            uuidv7(),
            input.loaded.jobId,
            input.loaded.userId,
            input.loaded.workId,
            input.loaded.branchId,
            step,
            input.manifest.manifestHash,
            JSON.stringify(
              step === "complete" ? [{ type: "artifact", id: input.loaded.exportId }] : [],
            ),
            now,
          ],
        );
      }
      await appendEvent(client, input.loaded, "job.completed", {
        exportId: input.loaded.exportId,
        checksum: input.checksum,
        byteSize: input.bytes.byteLength,
        fileName: input.fileName,
      });
      await client.query(
        `INSERT INTO audit_logs
          (id, actor_id, action, target_type, target_id, decision, correlation_id, ip, user_agent, created_at)
         VALUES ($1, $2, 'work_export.completed', 'work', $3, 'allowed', $4, 'worker', 'worker', $5)`,
        [uuidv7(), input.loaded.userId, input.loaded.workId, input.loaded.exportId, now],
      );
    });
  }

  async fail(loaded: LoadedWorkExport, error: { code: string; message: string }): Promise<void> {
    await this.withTenant(loaded.userId, async (client) => {
      const now = new Date();
      await client.query(
        `UPDATE work_export_receipts
            SET status = 'failed', error_code = $2, error_message = $3, updated_at = $4
          WHERE id = $1`,
        [loaded.exportId, error.code, error.message, now],
      );
      await client.query(
        `UPDATE jobs SET status = 'failed', error_code = $2, error_message = $3,
                         finished_at = $4, updated_at = $4 WHERE id = $1`,
        [loaded.jobId, error.code, error.message, now],
      );
      await appendEvent(client, loaded, "job.failed", error);
    });
  }

  async cleanupExpiredReceipts(now = new Date()): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_role', 'work_export_cleanup', true)");
      const result = await client.query(
        `UPDATE work_export_receipts
            SET status = 'expired', artifact_payload = NULL, updated_at = $1
          WHERE expires_at <= $1 AND artifact_payload IS NOT NULL`,
        [now],
      );
      await client.query("COMMIT");
      return result.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

async function appendEvent(
  client: PoolClient,
  loaded: LoadedWorkExport,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const latest = await client.query<{ sequence: number }>(
    `SELECT coalesce(max(sequence), 0)::int AS sequence FROM job_events WHERE job_id = $1`,
    [loaded.jobId],
  );
  await client.query(
    `INSERT INTO job_events
      (id, job_id, user_id, work_id, branch_id, sequence, event_type, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())`,
    [
      uuidv7(),
      loaded.jobId,
      loaded.userId,
      loaded.workId,
      loaded.branchId,
      Number(latest.rows[0]?.sequence ?? 0) + 1,
      eventType,
      JSON.stringify(payload),
    ],
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class WorkExportSourceChangedError extends Error {
  constructor() {
    super("Export source version changed before rendering");
    this.name = "WorkExportSourceChangedError";
  }
}
