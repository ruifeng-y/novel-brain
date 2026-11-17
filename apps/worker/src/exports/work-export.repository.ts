import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  EXPORT_WORK_JOB,
  exportCheckpointSchema,
  workExportManifestSchema,
  workExportRequestSchema,
  workExportSourceDescriptorSchema,
  type ExportWorkJob,
  type WorkExportManifest,
  type WorkExportRequest,
  type WorkExportSourceDescriptor,
} from "@novel-brain/contracts";
import { stableStringify } from "@novel-brain/core";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

type ExportCheckpoint = ExportWorkJob["checkpoint"];

export interface WorkExportJobIdentity {
  jobId: string;
  exportId: string;
  userId: string;
  workId: string;
  branchId: string;
}

export interface LoadedWorkExport extends WorkExportJobIdentity {
  request: WorkExportRequest;
  source: WorkExportSourceDescriptor;
  work: {
    id: string;
    title: string;
    penName: string;
    genre: "xianxia" | "history" | "urban";
    aiDisclosureRequired: boolean;
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
  checkpoint: ExportCheckpoint;
}

export interface RenderedWorkExport {
  loaded: LoadedWorkExport;
  manifest: WorkExportManifest;
  objectKey: string;
  checksum: string;
  contentType: string;
  fileName: string;
  byteSize: number;
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
        receipt_status: string;
        export_id: string;
        work_id: string;
        branch_id: string;
        request: WorkExportRequest;
        source_descriptor: WorkExportSourceDescriptor | null;
        checkpoint: unknown;
        work_title: string;
        work_pen_name: string;
        work_genre: "xianxia" | "history" | "urban";
        ai_disclosure_required: boolean;
        branch_name: string;
      }>(
        `SELECT j.status AS job_status, r.status AS receipt_status, j.checkpoint,
                r.id AS export_id, r.work_id, r.branch_id, r.request, r.source_descriptor,
                w.title AS work_title, w.pen_name AS work_pen_name, w.genre AS work_genre,
                w.ai_disclosure_required, b.name AS branch_name
           FROM jobs j
           JOIN work_export_receipts r ON r.job_id = j.id
           JOIN works w ON w.id = r.work_id
           JOIN work_branches b ON b.id = r.branch_id
          WHERE j.id = $1 AND j.user_id = $2 AND j.work_id = $3
            AND j.branch_id = $4 AND j.type = $5
            AND r.id = $6 AND r.user_id = $2 AND r.work_id = $3
            AND r.branch_id = $4 AND w.user_id = $2 AND b.user_id = $2
          FOR UPDATE OF r`,
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
      if (
        ["completed", "failed", "cancelled"].includes(loaded.job_status) ||
        ["completed", "failed", "expired"].includes(loaded.receipt_status)
      ) {
        return null;
      }
      if (!loaded.source_descriptor) {
        throw new WorkExportSourceChangedError();
      }
      const request = workExportRequestSchema.parse(loaded.request);
      const source = workExportSourceDescriptorSchema.parse(loaded.source_descriptor);
      const checkpoint = exportCheckpointSchema.parse(loaded.checkpoint);
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
      if (checkpoint.revision === 0) {
        const job = await client.query(
          `UPDATE jobs
              SET status = 'running', progress = 10, current_step = 'prepare',
                  started_at = coalesce(started_at, $2), updated_at = $2
            WHERE id = $1 AND user_id = $3 AND work_id = $4 AND branch_id = $5`,
          [payload.jobId, now, payload.actorId, payload.workId, payload.branchId],
        );
        if (job.rowCount !== 1) {
          throw new Error("Export job no longer exists");
        }
      } else {
        const job = await client.query(
          `UPDATE jobs
              SET status = 'running', started_at = coalesce(started_at, $2), updated_at = $2
            WHERE id = $1 AND user_id = $3 AND work_id = $4 AND branch_id = $5`,
          [payload.jobId, now, payload.actorId, payload.workId, payload.branchId],
        );
        if (job.rowCount !== 1) {
          throw new Error("Export job no longer exists");
        }
      }
      const receipt = await client.query(
        `UPDATE work_export_receipts
            SET status = 'running', updated_at = $2
          WHERE id = $1 AND user_id = $3 AND work_id = $4 AND branch_id = $5
            AND status IN ('queued', 'running')`,
        [payload.exportId, now, payload.actorId, payload.workId, payload.branchId],
      );
      if (receipt.rowCount !== 1) {
        throw new Error("Export receipt is no longer active");
      }
      const result: LoadedWorkExport = {
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
          aiDisclosureRequired: loaded.ai_disclosure_required,
        },
        branch: {
          id: payload.branchId,
          name: loaded.branch_name,
        },
        chapters,
        supplements: source.supplements,
        checkpoint,
      };
      if (checkpoint.revision === 0) {
        return this.checkpointPrepared(client, result, now);
      }
      return result;
    });
  }

  async listPendingJobs(limit = 50): Promise<ExportWorkJob[]> {
    const client = await this.pool.connect();
    let pending: Array<{
      export_id: string;
      job_id: string;
      user_id: string;
      work_id: string;
      branch_id: string;
      idempotency_key: string;
    }>;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_role', 'work_export_cleanup', true)");
      const result = await client.query<{
        export_id: string;
        job_id: string;
        user_id: string;
        work_id: string;
        branch_id: string;
        idempotency_key: string;
      }>(
        `SELECT id AS export_id, job_id, user_id, work_id, branch_id, idempotency_key
           FROM work_export_receipts
          WHERE status IN ('queued', 'running')
            AND expires_at > now()
          ORDER BY created_at
          LIMIT $1`,
        [limit],
      );
      await client.query("COMMIT");
      pending = result.rows;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    const jobs: ExportWorkJob[] = [];
    for (const row of pending) {
      const checkpoint = await this.withTenant(row.user_id, async (tenant) => {
        const job = await tenant.query<{ status: string; checkpoint: unknown }>(
          `SELECT status, checkpoint FROM jobs
            WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
              AND type = $5`,
          [row.job_id, row.user_id, row.work_id, row.branch_id, EXPORT_WORK_JOB],
        );
        const entry = job.rows[0];
        if (!entry || !["queued", "running"].includes(entry.status)) {
          return null;
        }
        return exportCheckpointSchema.parse(entry.checkpoint);
      });
      if (checkpoint) {
        jobs.push({
          jobId: row.job_id,
          jobType: EXPORT_WORK_JOB,
          workId: row.work_id,
          branchId: row.branch_id,
          actorId: row.user_id,
          idempotencyKey: row.idempotency_key,
          exportId: row.export_id,
          checkpoint,
        });
      }
    }
    return jobs;
  }

  async loadRendered(loaded: LoadedWorkExport): Promise<RenderedWorkExport | null> {
    return this.withTenant(loaded.userId, async (client) => {
      const result = await client.query<{
        status: string;
        manifest: unknown;
        artifact_object_key: string | null;
        checksum: string | null;
        content_type: string | null;
        file_name: string | null;
        byte_size: number | null;
      }>(
        `SELECT status, manifest, artifact_object_key, checksum, content_type, file_name, byte_size
           FROM work_export_receipts
          WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
        [loaded.exportId, loaded.userId, loaded.workId, loaded.branchId],
      );
      const row = result.rows[0];
      if (
        !row ||
        !["running", "completed"].includes(row.status) ||
        row.manifest === null ||
        !row.artifact_object_key ||
        !row.checksum ||
        !row.content_type ||
        !row.file_name ||
        row.byte_size === null
      ) {
        return null;
      }
      return {
        loaded,
        manifest: workExportManifestSchema.parse(row.manifest),
        objectKey: row.artifact_object_key,
        checksum: row.checksum,
        contentType: row.content_type,
        fileName: row.file_name,
        byteSize: row.byte_size,
      };
    });
  }

  async checkpointRendered(
    input: Omit<RenderedWorkExport, "loaded"> & { loaded: LoadedWorkExport },
  ): Promise<RenderedWorkExport> {
    return this.withTenant(input.loaded.userId, async (client) => {
      const now = new Date();
      const job = await client.query<{ checkpoint_version: number }>(
        `SELECT checkpoint_version FROM jobs
          WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
          FOR UPDATE`,
        [input.loaded.jobId, input.loaded.userId, input.loaded.workId, input.loaded.branchId],
      );
      const current = job.rows[0];
      if (!current) {
        throw new Error("Export job no longer exists");
      }
      const revision = Number(current.checkpoint_version) + 1;
      const checkpoint: ExportCheckpoint = {
        schemaVersion: 1,
        revision,
        step: "render",
        inputHash: input.manifest.manifestHash,
        outputRefs: [{ type: "artifact", id: input.loaded.exportId }],
        payload: {
          objectKey: input.objectKey,
          checksum: input.checksum,
          byteSize: input.byteSize,
          fileName: input.fileName,
          contentType: input.contentType,
        },
      };
      const receipt = await client.query(
        `UPDATE work_export_receipts
            SET manifest = $2::jsonb, artifact_object_key = $3, checksum = $4,
                byte_size = $5, file_name = $6, content_type = $7, updated_at = $8,
                error_code = NULL, error_message = NULL
          WHERE id = $1 AND user_id = $9 AND work_id = $10 AND branch_id = $11
            AND status = 'running'`,
        [
          input.loaded.exportId,
          JSON.stringify(input.manifest),
          input.objectKey,
          input.checksum,
          input.byteSize,
          input.fileName,
          input.contentType,
          now,
          input.loaded.userId,
          input.loaded.workId,
          input.loaded.branchId,
        ],
      );
      if (receipt.rowCount !== 1) {
        throw new Error("Export receipt no longer exists");
      }
      const updated = await client.query(
        `UPDATE jobs
            SET progress = 75, current_step = 'complete', checkpoint = $2::jsonb,
                checkpoint_version = $3, updated_at = $4
          WHERE id = $1 AND user_id = $5 AND work_id = $6 AND branch_id = $7`,
        [
          input.loaded.jobId,
          JSON.stringify(checkpoint),
          revision,
          now,
          input.loaded.userId,
          input.loaded.workId,
          input.loaded.branchId,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error("Export job no longer exists");
      }
      await saveJobStep(client, {
        loaded: input.loaded,
        step: "render",
        inputHash: input.manifest.manifestHash,
        outputRefs: checkpoint.outputRefs,
        now,
      });
      await saveJobCheckpoint(client, {
        loaded: input.loaded,
        revision,
        checkpoint,
        now,
      });
      await appendEvent(client, input.loaded, "job.step.succeeded", {
        step: "render",
        progress: 75,
        checkpoint,
      });
      return { ...input, loaded: { ...input.loaded, checkpoint } };
    });
  }

  async complete(input: RenderedWorkExport): Promise<void> {
    await this.withTenant(input.loaded.userId, async (client) => {
      const now = new Date();
      const job = await client.query<{ checkpoint_version: number }>(
        `SELECT checkpoint_version FROM jobs
          WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
          FOR UPDATE`,
        [input.loaded.jobId, input.loaded.userId, input.loaded.workId, input.loaded.branchId],
      );
      const current = job.rows[0];
      if (!current) {
        throw new Error("Export job no longer exists");
      }
      const revision = Number(current.checkpoint_version) + 1;
      const checkpoint: ExportCheckpoint = {
        schemaVersion: 1,
        revision,
        step: "complete",
        inputHash: input.manifest.manifestHash,
        outputRefs: [{ type: "artifact", id: input.loaded.exportId }],
        payload: {
          checksum: input.checksum,
          byteSize: input.byteSize,
          fileName: input.fileName,
        },
      };
      const receipt = await client.query(
        `UPDATE work_export_receipts
            SET status = 'completed', completed_at = $2, updated_at = $2,
                error_code = NULL, error_message = NULL
          WHERE id = $1 AND user_id = $3 AND work_id = $4 AND branch_id = $5
            AND status = 'running'`,
        [
          input.loaded.exportId,
          now,
          input.loaded.userId,
          input.loaded.workId,
          input.loaded.branchId,
        ],
      );
      if (receipt.rowCount !== 1) {
        throw new Error("Export receipt no longer exists");
      }
      const updated = await client.query(
        `UPDATE jobs
            SET status = 'completed', progress = 100, current_step = 'complete',
                checkpoint = $2::jsonb, checkpoint_version = $3,
                finished_at = $4, updated_at = $4
          WHERE id = $1 AND user_id = $5 AND work_id = $6 AND branch_id = $7`,
        [
          input.loaded.jobId,
          JSON.stringify(checkpoint),
          revision,
          now,
          input.loaded.userId,
          input.loaded.workId,
          input.loaded.branchId,
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error("Export job no longer exists");
      }
      await saveJobStep(client, {
        loaded: input.loaded,
        step: "complete",
        inputHash: input.manifest.manifestHash,
        outputRefs: checkpoint.outputRefs,
        now,
      });
      await saveJobCheckpoint(client, {
        loaded: input.loaded,
        revision,
        checkpoint,
        now,
      });
      await appendEvent(client, input.loaded, "job.completed", {
        exportId: input.loaded.exportId,
        checksum: input.checksum,
        byteSize: input.byteSize,
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

  async fail(
    loaded: WorkExportJobIdentity,
    error: { code: string; message: string },
  ): Promise<void> {
    await this.withTenant(loaded.userId, async (client) => {
      const now = new Date();
      const receipt = await client.query(
        `UPDATE work_export_receipts
            SET status = 'failed', error_code = $2, error_message = $3, updated_at = $4
          WHERE id = $1 AND user_id = $5 AND work_id = $6 AND branch_id = $7
            AND status NOT IN ('completed', 'expired')`,
        [
          loaded.exportId,
          error.code,
          error.message,
          now,
          loaded.userId,
          loaded.workId,
          loaded.branchId,
        ],
      );
      if (receipt.rowCount !== 1) {
        const current = await client.query<{ status: string }>(
          `SELECT status FROM work_export_receipts
            WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
          [loaded.exportId, loaded.userId, loaded.workId, loaded.branchId],
        );
        if (["completed", "expired"].includes(current.rows[0]?.status ?? "")) {
          return;
        }
        throw new Error("Export receipt no longer exists");
      }
      const job = await client.query(
        `UPDATE jobs SET status = 'failed', error_code = $2, error_message = $3,
                         finished_at = $4, updated_at = $4
          WHERE id = $1 AND user_id = $5 AND work_id = $6 AND branch_id = $7`,
        [
          loaded.jobId,
          error.code,
          error.message,
          now,
          loaded.userId,
          loaded.workId,
          loaded.branchId,
        ],
      );
      if (job.rowCount !== 1) {
        throw new Error("Export job no longer exists");
      }
      await appendEvent(client, loaded, "job.failed", error);
    });
  }

  async listExpiredObjectKeys(now = new Date()): Promise<string[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_role', 'work_export_cleanup', true)");
      const result = await client.query<{ artifact_object_key: string }>(
        `SELECT artifact_object_key FROM work_export_receipts
          WHERE expires_at <= $1 AND status = 'completed'
            AND artifact_object_key IS NOT NULL`,
        [now],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => row.artifact_object_key);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async markExpiredReceipts(now = new Date()): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.system_role', 'work_export_cleanup', true)");
      const result = await client.query(
        `UPDATE work_export_receipts
            SET status = 'expired', artifact_object_key = NULL,
                source_descriptor = NULL, updated_at = $1
          WHERE expires_at <= $1
            AND status IN ('queued', 'running', 'completed', 'failed')
            AND (status IN ('queued', 'running', 'failed')
              OR artifact_object_key IS NOT NULL OR source_descriptor IS NOT NULL)`,
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

  private async checkpointPrepared(
    client: PoolClient,
    loaded: LoadedWorkExport,
    now: Date,
  ): Promise<LoadedWorkExport> {
    const inputHash = sha256(
      stableStringify({
        request: loaded.request,
        source: loaded.source,
      }),
    );
    const checkpoint: ExportCheckpoint = {
      schemaVersion: 1,
      revision: 1,
      step: "prepare",
      inputHash,
      outputRefs: [],
      payload: {},
    };
    const job = await client.query(
      `UPDATE jobs
          SET status = 'running', progress = 25, current_step = 'render',
              checkpoint = $2::jsonb, checkpoint_version = $3,
              started_at = coalesce(started_at, $4), updated_at = $4
        WHERE id = $1 AND user_id = $5 AND work_id = $6 AND branch_id = $7`,
      [
        loaded.jobId,
        JSON.stringify(checkpoint),
        checkpoint.revision,
        now,
        loaded.userId,
        loaded.workId,
        loaded.branchId,
      ],
    );
    const receipt = await client.query(
      `UPDATE work_export_receipts
          SET status = 'running', updated_at = $2
        WHERE id = $1 AND user_id = $3 AND work_id = $4 AND branch_id = $5
          AND status IN ('queued', 'running')`,
      [loaded.exportId, now, loaded.userId, loaded.workId, loaded.branchId],
    );
    if (job.rowCount !== 1 || receipt.rowCount !== 1) {
      throw new Error("Export job or receipt no longer exists");
    }
    await saveJobStep(client, {
      loaded,
      step: "prepare",
      inputHash,
      outputRefs: [],
      now,
    });
    await saveJobCheckpoint(client, {
      loaded,
      revision: checkpoint.revision,
      checkpoint,
      now,
    });
    await appendEvent(client, loaded, "job.step.succeeded", {
      step: "prepare",
      progress: 25,
      checkpoint,
    });
    return { ...loaded, checkpoint };
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
  loaded: WorkExportJobIdentity,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const latest = await client.query<{ sequence: number }>(
    `SELECT coalesce(max(sequence), 0)::int AS sequence
       FROM job_events
      WHERE job_id = $1 AND user_id = $2`,
    [loaded.jobId, loaded.userId],
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

async function saveJobStep(
  client: PoolClient,
  input: {
    loaded: LoadedWorkExport;
    step: ExportCheckpoint["step"];
    inputHash: string;
    outputRefs: ExportCheckpoint["outputRefs"];
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO job_steps
      (id, job_id, user_id, work_id, branch_id, step_key, status, attempt,
       input_hash, output_refs, started_at, finished_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'succeeded', 1, $7, $8::jsonb, $9, $9, $9)
     ON CONFLICT (job_id, step_key) DO UPDATE
       SET status = 'succeeded', attempt = excluded.attempt,
           input_hash = excluded.input_hash, output_refs = excluded.output_refs,
           finished_at = excluded.finished_at
       WHERE job_steps.user_id = excluded.user_id
         AND job_steps.work_id = excluded.work_id
         AND job_steps.branch_id = excluded.branch_id`,
    [
      uuidv7(),
      input.loaded.jobId,
      input.loaded.userId,
      input.loaded.workId,
      input.loaded.branchId,
      input.step,
      input.inputHash,
      JSON.stringify(input.outputRefs),
      input.now,
    ],
  );
}

async function saveJobCheckpoint(
  client: PoolClient,
  input: {
    loaded: LoadedWorkExport;
    revision: number;
    checkpoint: ExportCheckpoint;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO job_checkpoints
      (id, job_id, user_id, work_id, branch_id, step_key, schema_version,
       revision, attempt, input_hash, output_refs, payload, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 1, $7, 1, $8, $9::jsonb, $10::jsonb, $11)
     ON CONFLICT (job_id, revision) DO UPDATE
       SET input_hash = excluded.input_hash, output_refs = excluded.output_refs,
           payload = excluded.payload
       WHERE job_checkpoints.user_id = excluded.user_id
         AND job_checkpoints.work_id = excluded.work_id
         AND job_checkpoints.branch_id = excluded.branch_id`,
    [
      uuidv7(),
      input.loaded.jobId,
      input.loaded.userId,
      input.loaded.workId,
      input.loaded.branchId,
      input.checkpoint.step,
      input.revision,
      input.checkpoint.inputHash,
      JSON.stringify(input.checkpoint.outputRefs),
      JSON.stringify(input.checkpoint),
      input.now,
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
