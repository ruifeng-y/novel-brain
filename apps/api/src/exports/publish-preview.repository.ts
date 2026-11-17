import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  workExportManifestSchema,
  workExportSourceDescriptorSchema,
  type PublishCheckRequest,
  type PublishPlatformPreset,
  type PublishPreview,
  type PublishPreviewListQuery,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import { resolveGoldenThreeEvidence } from "@novel-brain/core";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

export interface PublishContext {
  workId: string;
  branchId: string;
}

export interface PublishPreviewSource {
  exportId: string;
  work: {
    id: string;
    title: string;
    penName: string;
    genre: "xianxia" | "history" | "urban";
  };
  branch: {
    id: string;
    headNodeId: string;
  };
  export: {
    id: string;
    format: "txt" | "markdown" | "docx" | "epub";
    completed: true;
    manifestHash: string;
    sourceVersionNodeId: string;
    requestedVersionNodeId: string | null;
  };
  chapters: Array<{
    chapterId: string;
    chapterNumber: number;
    title: string;
    chapterVersionId: string;
    versionNodeId: string;
    content: string;
    characterCount: number;
    volumeNodeId: string | null;
    volumeNumber: number | null;
    volumeTitle: string | null;
  }>;
  goldenThree: {
    locked: boolean;
    openingHookScore: number | null;
    chapterEndHookScore: number | null;
  };
}

type PreviewRow = {
  id: string;
  export_id: string;
  work_id: string;
  branch_id: string;
  platform_preset: PublishPlatformPreset;
  status: "ready" | "warning" | "blocked";
  publish_ready: boolean;
  source_version_node_id: string;
  requested_version_node_id: string | null;
  manifest_hash: string;
  platform: PublishPreview["platform"];
  metadata: PublishPreview["metadata"];
  checks: PublishPreview["checks"];
  catalog: PublishPreview["catalog"];
  reader_preview: PublishPreview["readerPreview"];
  publish_copy: PublishPreview["publishCopy"];
  created_at: Date;
  updated_at: Date;
  head_node_id: string | null;
};

type IdempotencyReplayRow = PreviewRow & {
  request_hash: string | null;
};

const PREVIEW_COLUMNS = `preview.id, preview.export_id, preview.work_id, preview.branch_id,
  preview.platform_preset, preview.status, preview.publish_ready,
  preview.source_version_node_id, preview.requested_version_node_id, preview.manifest_hash,
  preview.platform, preview.metadata, preview.checks, preview.catalog,
  preview.reader_preview, preview.publish_copy, preview.created_at, preview.updated_at,
  branch.head_node_id`;

@Injectable()
export class PublishPreviewRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async loadSource(
    userId: string,
    context: PublishContext,
    exportId: string,
  ): Promise<PublishPreviewSource | "not_found" | "not_ready" | "expired" | "source_changed"> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<{
        status: string;
        format: "txt" | "markdown" | "docx" | "epub";
        manifest: unknown;
        source_descriptor: unknown;
        expires_at: Date;
        work_title: string;
        work_pen_name: string;
        work_genre: "xianxia" | "history" | "urban";
        head_node_id: string | null;
      }>(
        `SELECT receipt.status, receipt.format, receipt.manifest, receipt.source_descriptor,
                receipt.expires_at, work.title AS work_title, work.pen_name AS work_pen_name,
                work.genre AS work_genre, branch.head_node_id
           FROM work_export_receipts receipt
           JOIN works work ON work.id = receipt.work_id
           JOIN work_branches branch ON branch.id = receipt.branch_id
          WHERE receipt.id = $1 AND receipt.user_id = $2
            AND receipt.work_id = $3 AND receipt.branch_id = $4
            AND work.user_id = $2 AND branch.user_id = $2`,
        [exportId, userId, context.workId, context.branchId],
      );
      const row = result.rows[0];
      if (!row) {
        return "not_found";
      }
      if (row.expires_at.getTime() <= Date.now()) {
        return "expired";
      }
      if (row.status !== "completed" || !row.manifest || !row.source_descriptor) {
        return "not_ready";
      }
      const manifest = workExportManifestSchema.parse(row.manifest);
      const source = workExportSourceDescriptorSchema.parse(row.source_descriptor);
      const versionResult = await client.query<{
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
          userId,
          context.workId,
          context.branchId,
          source.chapters.map((chapter) => chapter.chapterVersionId),
        ],
      );
      const versions = new Map(versionResult.rows.map((version) => [version.id, version]));
      const chapters = source.chapters.map((descriptor) => {
        const version = versions.get(descriptor.chapterVersionId);
        if (
          !version ||
          version.chapter_id !== descriptor.chapterId ||
          version.version_node_id !== descriptor.versionNodeId ||
          version.content_hash !== descriptor.expectedContentHash ||
          sha256(version.content) !== descriptor.expectedContentHash
        ) {
          throw new PublishSourceChangedError();
        }
        return {
          chapterId: descriptor.chapterId,
          chapterNumber: descriptor.chapterNumber,
          title: descriptor.title,
          chapterVersionId: descriptor.chapterVersionId,
          versionNodeId: descriptor.versionNodeId,
          content: version.content,
          characterCount: [...version.content].length,
          volumeNodeId: descriptor.volumeNodeId,
          volumeNumber: descriptor.volumeNumber,
          volumeTitle: descriptor.volumeTitle,
        };
      });
      const golden = await client.query<{
        chapter_pins: Array<{
          chapterId: string;
          chapterNumber: number;
          chapterVersionId: string;
          versionNodeId: string;
          contentHash: string;
        }>;
        review_snapshot: Array<{
          dimension: string;
          score: number;
          evidenceChapterVersionId?: string;
        }>;
      }>(
        `SELECT chapter_pins, review_snapshot FROM golden_three_locks
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3`,
        [userId, context.workId, context.branchId],
      );
      const goldenLock = golden.rows[0];
      const goldenThree = resolveGoldenThreeEvidence(
        chapters,
        goldenLock
          ? {
              chapterPins: goldenLock.chapter_pins,
              reviewSnapshot: goldenLock.review_snapshot,
            }
          : null,
      );
      return {
        exportId,
        work: {
          id: context.workId,
          title: row.work_title,
          penName: row.work_pen_name,
          genre: row.work_genre,
        },
        branch: {
          id: context.branchId,
          headNodeId: row.head_node_id ?? manifest.branch.resolvedVersionNodeId,
        },
        export: {
          id: exportId,
          format: row.format,
          completed: true as const,
          manifestHash: manifest.manifestHash,
          sourceVersionNodeId: manifest.branch.resolvedVersionNodeId,
          requestedVersionNodeId: manifest.branch.requestedVersionNodeId,
        },
        chapters,
        goldenThree,
      };
    }).catch((error: unknown) => {
      if (error instanceof PublishSourceChangedError) {
        return "source_changed";
      }
      throw error;
    });
  }

  async save(
    userId: string,
    context: PublishContext,
    request: PublishCheckRequest,
    idempotencyKey: string,
    requestHash: string,
    preview: Omit<PublishPreview, "id" | "createdAt" | "updatedAt" | "stale" | "staleReason">,
  ): Promise<PublishPreview> {
    return this.withTenant(userId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${userId}:${idempotencyScope(context)}:${idempotencyKey}`,
      ]);
      const replay = await this.findIdempotentWithClient(
        client,
        userId,
        context,
        idempotencyKey,
        requestHash,
      );
      if (replay === "conflict") {
        throw new PublishIdempotencyConflictError();
      }
      if (replay) {
        return replay;
      }
      const now = new Date();
      const id = uuidv7();
      await client.query(
        `INSERT INTO publish_previews
          (id, user_id, work_id, branch_id, export_id, platform_preset, status, publish_ready,
           source_version_node_id, requested_version_node_id, manifest_hash, platform,
           metadata, checks, catalog, reader_preview, publish_copy, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb,
                 $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18, $18)`,
        [
          id,
          userId,
          context.workId,
          context.branchId,
          request.exportId,
          request.platformPreset,
          preview.status,
          preview.publishReady,
          preview.sourceVersionNodeId,
          preview.requestedVersionNodeId,
          preview.manifestHash,
          JSON.stringify(preview.platform),
          JSON.stringify(preview.metadata),
          JSON.stringify(preview.checks),
          JSON.stringify(preview.catalog),
          JSON.stringify(preview.readerPreview),
          JSON.stringify(preview.publishCopy),
          now,
        ],
      );
      await client.query(
        `INSERT INTO idempotency_records
          (id, user_id, scope, idempotency_key, request_hash, resource_type, resource_id, created_at)
         VALUES ($1, $2, $3, $4, $5, 'publish_preview', $6, $7)
         ON CONFLICT (user_id, scope, idempotency_key) DO UPDATE
           SET id = EXCLUDED.id,
               request_hash = EXCLUDED.request_hash,
               resource_type = EXCLUDED.resource_type,
               resource_id = EXCLUDED.resource_id,
               created_at = EXCLUDED.created_at
         WHERE idempotency_records.created_at <= now() - interval '24 hours'`,
        [uuidv7(), userId, idempotencyScope(context), idempotencyKey, requestHash, id, now],
      );
      const row = await this.getRow(client, userId, context, id);
      if (!row) {
        throw new Error("Failed to create publish preview");
      }
      return toPreview(row);
    });
  }

  async findIdempotent(
    userId: string,
    context: PublishContext,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PublishPreview | "conflict" | null> {
    return this.withTenant(userId, (client) =>
      this.findIdempotentWithClient(client, userId, context, idempotencyKey, requestHash),
    );
  }

  async get(
    userId: string,
    context: PublishContext,
    previewId: string,
  ): Promise<PublishPreview | null> {
    return this.withTenant(userId, async (client) => {
      const row = await this.getRow(client, userId, context, previewId);
      return row ? toPreview(row) : null;
    });
  }

  async list(
    userId: string,
    context: PublishContext,
    query: PublishPreviewListQuery,
  ): Promise<{ previews: PublishPreview[]; nextCursor: string | null }> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<PreviewRow>(
        `SELECT ${PREVIEW_COLUMNS}
           FROM publish_previews preview
           JOIN work_branches branch ON branch.id = preview.branch_id
          WHERE preview.user_id = $1 AND preview.work_id = $2 AND preview.branch_id = $3
            AND (
              $4::uuid IS NULL
              OR (preview.created_at, preview.id) < (
                SELECT anchor.created_at, anchor.id
                  FROM publish_previews anchor
                 WHERE anchor.id = $4 AND anchor.user_id = $1
                   AND anchor.work_id = $2 AND anchor.branch_id = $3
              )
            )
          ORDER BY preview.created_at DESC, preview.id DESC
          LIMIT $5`,
        [userId, context.workId, context.branchId, query.cursor ?? null, query.limit + 1],
      );
      const hasMore = result.rows.length > query.limit;
      const rows = result.rows.slice(0, query.limit);
      return {
        previews: rows.map(toPreview),
        nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
      };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async getRow(
    client: PoolClient,
    userId: string,
    context: PublishContext,
    previewId: string,
  ): Promise<PreviewRow | undefined> {
    const result = await client.query<PreviewRow>(
      `SELECT ${PREVIEW_COLUMNS}
         FROM publish_previews preview
         JOIN work_branches branch ON branch.id = preview.branch_id
        WHERE preview.id = $1 AND preview.user_id = $2
          AND preview.work_id = $3 AND preview.branch_id = $4`,
      [previewId, userId, context.workId, context.branchId],
    );
    return result.rows[0];
  }

  private async findIdempotentWithClient(
    client: PoolClient,
    userId: string,
    context: PublishContext,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PublishPreview | "conflict" | null> {
    const result = await client.query<IdempotencyReplayRow>(
      `SELECT ${PREVIEW_COLUMNS}, record.request_hash
         FROM idempotency_records record
         JOIN publish_previews preview ON preview.id = record.resource_id
         JOIN work_branches branch ON branch.id = preview.branch_id
        WHERE record.user_id = $1 AND record.scope = $2
          AND record.idempotency_key = $3
          AND record.created_at > now() - interval '24 hours'
          AND record.resource_type = 'publish_preview'
          AND preview.user_id = $1 AND preview.work_id = $4 AND preview.branch_id = $5`,
      [userId, idempotencyScope(context), idempotencyKey, context.workId, context.branchId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return row.request_hash === requestHash ? toPreview(row) : "conflict";
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

function toPreview(row: PreviewRow): PublishPreview {
  const stale =
    row.requested_version_node_id === null &&
    row.head_node_id !== null &&
    row.head_node_id !== row.source_version_node_id;
  return {
    id: row.id,
    exportId: row.export_id,
    workId: row.work_id,
    branchId: row.branch_id,
    platformPreset: row.platform_preset,
    status: row.status,
    publishReady: row.publish_ready,
    stale,
    staleReason: stale ? "作品版本已变化，请重新运行发布检查。" : null,
    sourceVersionNodeId: row.source_version_node_id,
    requestedVersionNodeId: row.requested_version_node_id,
    manifestHash: row.manifest_hash,
    platform: row.platform,
    metadata: row.metadata,
    checks: row.checks,
    catalog: row.catalog,
    readerPreview: row.reader_preview,
    publishCopy: row.publish_copy,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class PublishSourceChangedError extends Error {
  constructor() {
    super("Publish preview source changed");
    this.name = "PublishSourceChangedError";
  }
}

export class PublishIdempotencyConflictError extends Error {
  constructor() {
    super("Publish preview idempotency conflict");
    this.name = "PublishIdempotencyConflictError";
  }
}

function idempotencyScope(context: PublishContext): string {
  return `publish-check:${context.workId}:${context.branchId}`;
}
