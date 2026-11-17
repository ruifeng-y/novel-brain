import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  EXPORT_WORK_JOB,
  workExportRequestSchema,
  workExportReceiptSchema,
  workExportSourceDescriptorSchema,
  type ExportSupplementSourceDescriptor,
  type WorkExportManifest,
  type WorkExportReceipt,
  type WorkExportRequest,
  type WorkExportSourceDescriptor,
} from "@novel-brain/contracts";
import { createDatabasePool } from "@novel-brain/db";
import type { Pool, PoolClient } from "pg";
import { uuidv7 } from "uuidv7";

const EXPORT_RETENTION_DAYS = 7;
const EXPORT_RECEIPT_COLUMNS = `id, job_id, work_id, branch_id, format, status, manifest,
  checksum, byte_size, file_name, content_type, error_code, error_message,
  created_at, completed_at, expires_at`;

interface ExportContext {
  workId: string;
  branchId: string;
}

export interface ExportAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

interface WorkRow {
  id: string;
  title: string;
  pen_name: string;
  genre: "xianxia" | "history" | "urban";
  ai_disclosure_required: boolean;
}

interface BranchRow {
  id: string;
  name: string;
  head_node_id: string | null;
}

interface ChapterRow {
  id: string;
  number: number;
  title: string;
  current_version_id: string | null;
}

interface ChapterVersionRow {
  id: string;
  chapter_id: string;
  version: number;
  content: string;
  content_hash: string;
  version_node_id: string;
}

interface OutlineRow {
  id: string;
  parent_id: string | null;
  level: string;
  chapter_id: string | null;
  title: string;
  sort_order: number;
}

interface ExportReceiptRow {
  id: string;
  job_id: string;
  work_id: string;
  branch_id: string;
  format: WorkExportReceipt["format"];
  status: WorkExportReceipt["status"];
  manifest: WorkExportManifest | null;
  checksum: string | null;
  byte_size: number | null;
  file_name: string | null;
  content_type: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date;
}

interface CreatedExport {
  created: boolean;
  receipt: WorkExportReceipt;
}

@Injectable()
export class WorkExportRepository implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
  }

  async findByIdempotencyKey(
    userId: string,
    context: ExportContext,
    idempotencyKey: string,
    request: WorkExportRequest,
  ): Promise<WorkExportReceipt | "conflict" | null> {
    const row = await this.withTenant(userId, async (client) => {
      const result = await client.query<ExportReceiptRow & { request_matches: boolean }>(
        `SELECT ${EXPORT_RECEIPT_COLUMNS}, request = $5::jsonb AS request_matches
           FROM work_export_receipts
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 AND idempotency_key = $4`,
        [userId, context.workId, context.branchId, idempotencyKey, JSON.stringify(request)],
      );
      return result.rows[0] ?? null;
    });
    if (!row) {
      return null;
    }
    return row.request_matches ? toReceipt(row) : "conflict";
  }

  async createQueuedExport(input: {
    userId: string;
    context: ExportContext;
    idempotencyKey: string;
    request: WorkExportRequest;
    audit: ExportAuditContext;
  }): Promise<CreatedExport> {
    return this.withTenant(input.userId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `${input.userId}:${input.context.workId}:${input.context.branchId}:${input.idempotencyKey}`,
      ]);
      const replay = await client.query<ExportReceiptRow & { request_matches: boolean }>(
        `SELECT ${EXPORT_RECEIPT_COLUMNS}, request = $5::jsonb AS request_matches
           FROM work_export_receipts
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 AND idempotency_key = $4`,
        [
          input.userId,
          input.context.workId,
          input.context.branchId,
          input.idempotencyKey,
          JSON.stringify(input.request),
        ],
      );
      if (replay.rows[0]) {
        if (!replay.rows[0].request_matches) {
          throw new WorkExportIdempotencyConflictError();
        }
        return { created: false, receipt: toReceipt(replay.rows[0]) };
      }

      const source = await resolveExportSource(client, {
        userId: input.userId,
        context: input.context,
        request: workExportRequestSchema.parse(input.request),
      });
      const now = new Date();
      const jobId = uuidv7();
      const exportId = uuidv7();
      const expiresAt = new Date(now.getTime() + EXPORT_RETENTION_DAYS * 86_400_000);
      await client.query(
        `INSERT INTO jobs
          (id, work_id, branch_id, user_id, type, status, progress, current_step,
           idempotency_key, budget, checkpoint, cost, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', 0, 'prepare', $6,
                 '{"maxTokens":0,"maxCostCny":0,"maxRevisionRounds":0}'::jsonb,
                 '{"schemaVersion":1,"revision":0,"step":"prepare","inputHash":null,"outputRefs":[],"payload":{}}'::jsonb,
                 '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"costCny":0}'::jsonb,
                 $7, $7)`,
        [
          jobId,
          input.context.workId,
          input.context.branchId,
          input.userId,
          EXPORT_WORK_JOB,
          input.idempotencyKey,
          now,
        ],
      );
      await client.query(
        `INSERT INTO work_export_receipts
          (id, job_id, user_id, work_id, branch_id, idempotency_key, format, status,
           request, source_descriptor, created_at, updated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8::jsonb, $9::jsonb, $10, $10, $11)`,
        [
          exportId,
          jobId,
          input.userId,
          input.context.workId,
          input.context.branchId,
          input.idempotencyKey,
          input.request.format,
          JSON.stringify(input.request),
          JSON.stringify(source),
          now,
          expiresAt,
        ],
      );
      await appendEvent(client, {
        jobId,
        userId: input.userId,
        workId: input.context.workId,
        branchId: input.context.branchId,
        eventType: "job.created",
        payload: { exportId, status: "queued", format: input.request.format },
      });
      await client.query(
        `INSERT INTO audit_logs
          (id, actor_id, action, target_type, target_id, decision, correlation_id, ip, user_agent, created_at)
         VALUES ($1, $2, 'work_export.created', 'work', $3, 'allowed', $4, $5, $6, $7)`,
        [
          uuidv7(),
          input.userId,
          input.context.workId,
          input.audit.requestId,
          input.audit.ip,
          input.audit.userAgent,
          now,
        ],
      );
      const row = await client.query<ExportReceiptRow>(
        `SELECT ${EXPORT_RECEIPT_COLUMNS}
           FROM work_export_receipts
          WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
        [exportId, input.userId, input.context.workId, input.context.branchId],
      );
      if (!row.rows[0]) {
        throw new Error("Failed to create work export receipt");
      }
      return { created: true, receipt: toReceipt(row.rows[0]) };
    });
  }

  async list(
    userId: string,
    context: ExportContext,
    page: { cursor?: string | undefined; limit: number },
  ): Promise<{ receipts: WorkExportReceipt[]; nextCursor: string | null }> {
    return this.withTenant(userId, async (client) => {
      const values: unknown[] = [userId, context.workId, context.branchId];
      let cursorSql = "";
      if (page.cursor) {
        cursorSql = "AND id < $4";
        values.push(page.cursor);
      }
      values.push(page.limit + 1);
      const result = await client.query<ExportReceiptRow>(
        `SELECT ${EXPORT_RECEIPT_COLUMNS}
           FROM work_export_receipts
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 ${cursorSql}
          ORDER BY id DESC
          LIMIT $${values.length}`,
        values,
      );
      const hasMore = result.rows.length > page.limit;
      const rows = hasMore ? result.rows.slice(0, page.limit) : result.rows;
      return {
        receipts: rows.map(toReceipt),
        nextCursor: hasMore ? (rows.at(-1)?.id ?? null) : null,
      };
    });
  }

  async get(
    userId: string,
    context: ExportContext,
    exportId: string,
  ): Promise<WorkExportReceipt | null> {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<ExportReceiptRow>(
        `SELECT ${EXPORT_RECEIPT_COLUMNS}
           FROM work_export_receipts
          WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
        [exportId, userId, context.workId, context.branchId],
      );
      return result.rows[0] ? toReceipt(result.rows[0]) : null;
    });
  }

  async download(
    userId: string,
    context: ExportContext,
    exportId: string,
  ): Promise<
    | {
        objectKey: string;
        checksum: string;
        contentType: string;
        fileName: string;
      }
    | "not_found"
    | "not_ready"
    | "expired"
  > {
    return this.withTenant(userId, async (client) => {
      const result = await client.query<{
        status: WorkExportReceipt["status"];
        artifact_object_key: string | null;
        checksum: string | null;
        content_type: string | null;
        file_name: string | null;
        expires_at: Date;
      }>(
        `SELECT status, artifact_object_key, checksum, content_type, file_name, expires_at
           FROM work_export_receipts
          WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4`,
        [exportId, userId, context.workId, context.branchId],
      );
      const row = result.rows[0];
      if (!row) {
        return "not_found";
      }
      if (row.status !== "completed" || row.expires_at.getTime() <= Date.now()) {
        return row.expires_at.getTime() <= Date.now() ? "expired" : "not_ready";
      }
      if (!row.artifact_object_key || !row.checksum || !row.content_type || !row.file_name) {
        return "not_ready";
      }
      return {
        objectKey: row.artifact_object_key,
        checksum: row.checksum,
        contentType: row.content_type,
        fileName: row.file_name,
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
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

async function resolveExportSource(
  client: PoolClient,
  input: {
    userId: string;
    context: ExportContext;
    request: WorkExportRequest;
  },
): Promise<WorkExportSourceDescriptor> {
  const work = await client.query<WorkRow>(
    `SELECT id, title, pen_name, genre, ai_disclosure_required FROM works
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [input.context.workId, input.userId],
  );
  const branch = await client.query<BranchRow>(
    `SELECT id, name, head_node_id FROM work_branches
      WHERE id = $1 AND work_id = $2 AND user_id = $3`,
    [input.context.branchId, input.context.workId, input.userId],
  );
  if (!work.rows[0] || !branch.rows[0]) {
    throw new WorkExportSourceInvalidError("作品或分支不存在");
  }
  const sourceNodeId = input.request.sourceVersionNodeId ?? branch.rows[0].head_node_id;
  if (!sourceNodeId) {
    throw new WorkExportSourceInvalidError("当前分支还没有可导出的版本");
  }
  const ancestors = await client.query<{ id: string; created_at: Date }>(
    `WITH RECURSIVE nodes AS (
       SELECT id, parent_node_id, created_at FROM version_nodes
        WHERE id = $1 AND user_id = $2 AND work_id = $3 AND branch_id = $4
       UNION ALL
       SELECT parent.id, parent.parent_node_id, parent.created_at FROM version_nodes parent
       JOIN nodes child ON parent.id = child.parent_node_id
       WHERE parent.user_id = $2 AND parent.work_id = $3 AND parent.branch_id = $4
     )
     SELECT id, created_at FROM nodes`,
    [sourceNodeId, input.userId, input.context.workId, input.context.branchId],
  );
  if (ancestors.rows.length === 0) {
    throw new WorkExportSourceInvalidError("指定的历史版本不属于当前分支");
  }
  const historical = input.request.sourceVersionNodeId !== null;
  const ancestorIds = ancestors.rows.map((row) => row.id);
  const sourceCreatedAt = ancestors.rows.find((row) => row.id === sourceNodeId)?.created_at ?? null;

  const outline = await client.query<OutlineRow>(
    historical
      ? `SELECT id, parent_id, level, chapter_id, title, sort_order
           FROM outline_nodes
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
            AND version_node_id = ANY($4::uuid[])`
      : `SELECT id, parent_id, level, chapter_id, title, sort_order
           FROM outline_nodes
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3`,
    historical
      ? [input.userId, input.context.workId, input.context.branchId, ancestorIds]
      : [input.userId, input.context.workId, input.context.branchId],
  );
  const chapterRows = await client.query<ChapterRow>(
    `SELECT id, number, title, current_version_id FROM chapters
      WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
      ORDER BY number`,
    [input.userId, input.context.workId, input.context.branchId],
  );
  const historicalChapterTitles = historical
    ? await client.query<{ chapter_id: string; title: string }>(
        `WITH title_events AS (
           SELECT object_id AS chapter_id, payload->>'title' AS title, created_at
             FROM version_nodes
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
              AND object_type = 'chapter_brief'
              AND id = ANY($4::uuid[])
              AND payload->>'title' IS NOT NULL
           UNION ALL
           SELECT object_id, payload->'after'->>'title', created_at
             FROM version_nodes
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
              AND node_type = 'change_apply'
              AND object_type = 'chapter'
              AND id = ANY($4::uuid[])
              AND payload->'after'->>'title' IS NOT NULL
           UNION ALL
           SELECT item.object_id,
                  coalesce(source.payload->>'title', source.payload->'after'->>'title'),
                  merge.created_at
             FROM version_nodes merge
             CROSS JOIN LATERAL jsonb_array_elements_text(merge.payload->'itemIds') AS item_id
             JOIN merge_items item ON item.id = item_id.value::uuid
             JOIN version_nodes source ON source.id = item.source_node_id
            WHERE merge.user_id = $1 AND merge.work_id = $2 AND merge.branch_id = $3
              AND merge.node_type = 'branch_merge'
              AND merge.id = ANY($4::uuid[])
              AND item.object_type = 'chapter'
              AND coalesce(source.payload->>'title', source.payload->'after'->>'title') IS NOT NULL
         )
         SELECT DISTINCT ON (chapter_id) chapter_id, title
           FROM title_events
          ORDER BY chapter_id, created_at DESC`,
        [input.userId, input.context.workId, input.context.branchId, ancestorIds],
      )
    : null;
  const historicalTitleByChapter = new Map(
    historicalChapterTitles?.rows.map((row) => [row.chapter_id, row.title]) ?? [],
  );
  const historicalVersions = historical
    ? await client.query<ChapterVersionRow>(
        `SELECT DISTINCT ON (chapter_id)
                id, chapter_id, version, content, content_hash, version_node_id
           FROM chapter_versions
          WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
            AND version_node_id = ANY($4::uuid[])
          ORDER BY chapter_id, version DESC`,
        [input.userId, input.context.workId, input.context.branchId, ancestorIds],
      )
    : null;
  const historicalVersionByChapter = new Map(
    historicalVersions?.rows.map((row) => [row.chapter_id, row]) ?? [],
  );
  const selectableChapters = historical
    ? chapterRows.rows.filter((chapter) => historicalVersionByChapter.has(chapter.id))
    : chapterRows.rows;
  const selectedChapters = selectChapters(selectableChapters, outline.rows, input.request);
  if (selectedChapters.length === 0) {
    throw new WorkExportSourceInvalidError("导出范围没有章节");
  }

  const selectedIds = selectedChapters.map((chapter) => chapter.id);
  if (historical) {
    await assertHistoricalChapterOutlineIsExact(client, {
      userId: input.userId,
      context: input.context,
      ancestorIds,
      chapterIds: selectedIds,
    });
  }
  const versions =
    historicalVersions ??
    (await client.query<ChapterVersionRow>(
      `SELECT id, chapter_id, version, content, content_hash, version_node_id
         FROM chapter_versions
        WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
          AND id = ANY(
            SELECT current_version_id FROM chapters
             WHERE id = ANY($4::uuid[]) AND current_version_id IS NOT NULL
          )`,
      [input.userId, input.context.workId, input.context.branchId, selectedIds],
    ));
  const versionByChapter = new Map(versions.rows.map((row) => [row.chapter_id, row]));
  const chapterOutlines = new Map(
    outline.rows
      .filter((row) => row.level === "chapter" && row.chapter_id)
      .map((row) => [row.chapter_id as string, row]),
  );
  const outlineById = new Map(outline.rows.map((row) => [row.id, row]));
  const descriptorChapters = selectedChapters.map((chapter) => {
    const version = versionByChapter.get(chapter.id);
    if (!version) {
      throw new WorkExportSourceInvalidError(`章节 ${chapter.number} 在指定版本中没有正文`);
    }
    const title = historical ? historicalTitleByChapter.get(chapter.id) : chapter.title;
    if (!title) {
      throw new WorkExportSourceInvalidError(`章节 ${chapter.number} 在指定版本中缺少精确标题`);
    }
    const chapterOutline = chapterOutlines.get(chapter.id);
    const volume = chapterOutline ? findVolume(chapterOutline, outlineById) : null;
    return {
      chapterId: chapter.id,
      chapterNumber: chapter.number,
      title,
      chapterVersionId: version.id,
      versionNodeId: version.version_node_id,
      expectedContentHash: version.content_hash,
      volumeNodeId: volume?.id ?? null,
      volumeNumber: volume ? volume.sort_order + 1 : null,
      volumeTitle: volume?.title ?? null,
    };
  });
  const supplements = await resolveSupplements(client, {
    userId: input.userId,
    context: input.context,
    request: input.request,
    ancestorIds,
    historical,
    sourceCreatedAt,
  });
  return workExportSourceDescriptorSchema.parse({
    resolvedVersionNodeId: sourceNodeId,
    chapters: descriptorChapters,
    supplements,
  });
}

function selectChapters(
  chapters: ChapterRow[],
  outline: OutlineRow[],
  request: WorkExportRequest,
): ChapterRow[] {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const scope = request.scope;
  switch (scope.kind) {
    case "book":
      return chapters;
    case "current_chapter": {
      const chapter = byId.get(scope.chapterId);
      return chapter ? [chapter] : [];
    }
    case "selected_chapters":
      return chapters.filter((chapter) => scope.chapterIds.includes(chapter.id));
    case "chapter_range":
      return chapters.filter(
        (chapter) => chapter.number >= scope.fromChapter && chapter.number <= scope.toChapter,
      );
    case "volume": {
      const volume = outline.find(
        (node) => node.id === scope.volumeNodeId && node.level === "volume",
      );
      if (!volume) {
        return [];
      }
      const descendantIds = new Set<string>([volume.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const node of outline) {
          if (node.parent_id && descendantIds.has(node.parent_id) && !descendantIds.has(node.id)) {
            descendantIds.add(node.id);
            changed = true;
          }
        }
      }
      const chapterIds = new Set(
        outline
          .filter((node) => node.chapter_id && descendantIds.has(node.id))
          .map((node) => node.chapter_id as string),
      );
      return chapters.filter((chapter) => chapterIds.has(chapter.id));
    }
  }
}

function findVolume(
  chapterOutline: OutlineRow,
  outlineById: Map<string, OutlineRow>,
): OutlineRow | null {
  let current: OutlineRow | undefined = chapterOutline;
  while (current) {
    if (current.level === "volume") {
      return current;
    }
    current = current.parent_id ? outlineById.get(current.parent_id) : undefined;
  }
  return null;
}

async function resolveSupplements(
  client: PoolClient,
  input: {
    userId: string;
    context: ExportContext;
    request: WorkExportRequest;
    ancestorIds: string[];
    historical: boolean;
    sourceCreatedAt: Date | null;
  },
): Promise<ExportSupplementSourceDescriptor[]> {
  const supplements: ExportSupplementSourceDescriptor[] = [];
  if (input.request.options.includeStoryBible) {
    const bible = input.historical
      ? await client.query<{ id: string; version_node_id: string; cards: unknown }>(
          `SELECT id, version_node_id, cards FROM story_bible_versions
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
              AND version_node_id = ANY($4::uuid[])
            ORDER BY version DESC LIMIT 1`,
          [input.userId, input.context.workId, input.context.branchId, input.ancestorIds],
        )
      : await client.query<{ id: string; version_node_id: string | null; cards: unknown }>(
          `SELECT id, NULL::uuid AS version_node_id, cards FROM story_bibles
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 LIMIT 1`,
          [input.userId, input.context.workId, input.context.branchId],
        );
    if (bible.rows[0]) {
      supplements.push(
        supplement(
          "story_bible",
          bible.rows[0].id,
          bible.rows[0].version_node_id,
          "故事圣经",
          JSON.stringify(bible.rows[0].cards, null, 2),
        ),
      );
    }
  }
  if (input.request.options.includeSettingsAppendix) {
    const settings = await client.query<{
      name: string;
      entity_type: string;
      summary: string;
      attributes: unknown;
      version_node_id: string | null;
    }>(
      input.historical
        ? `SELECT name, entity_type, summary, attributes, version_node_id
             FROM (
               SELECT DISTINCT ON (ev.entity_id)
                      ev.snapshot->>'name' AS name,
                      ev.snapshot->>'type' AS entity_type,
                      ev.snapshot->>'summary' AS summary,
                      ev.snapshot->'attributes' AS attributes,
                      ev.version_node_id
                 FROM entity_versions ev
                 JOIN version_nodes vn ON vn.id = ev.version_node_id
                WHERE ev.user_id = $1 AND ev.work_id = $2 AND ev.branch_id = $3
                  AND ev.version_node_id = ANY($4::uuid[])
                ORDER BY ev.entity_id, vn.created_at DESC, ev.version DESC
             ) latest
            ORDER BY entity_type, name`
        : `SELECT name, type AS entity_type, summary, attributes,
                  NULL::uuid AS version_node_id
             FROM entities
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 AND deleted_at IS NULL
            ORDER BY type, name`,
      input.historical
        ? [input.userId, input.context.workId, input.context.branchId, input.ancestorIds]
        : [input.userId, input.context.workId, input.context.branchId],
    );
    supplements.push(
      supplement(
        "settings",
        `settings:${input.context.branchId}`,
        null,
        "设定附录",
        settings.rows
          .map(
            (row) =>
              `【${row.entity_type}】${row.name}\n${row.summary}\n${JSON.stringify(row.attributes)}`,
          )
          .join("\n\n"),
      ),
    );
  }
  if (input.request.options.includeOutline) {
    if (input.historical) {
      await assertHistoricalOutlineIsExact(client, input);
    }
    const outline = await client.query<OutlineRow>(
      input.historical
        ? `SELECT id, parent_id, level, chapter_id, title, sort_order
             FROM outline_nodes
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
              AND version_node_id = ANY($4::uuid[])
            ORDER BY sort_order, created_at`
        : `SELECT id, parent_id, level, chapter_id, title, sort_order
             FROM outline_nodes WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
            ORDER BY sort_order, created_at`,
      input.historical
        ? [input.userId, input.context.workId, input.context.branchId, input.ancestorIds]
        : [input.userId, input.context.workId, input.context.branchId],
    );
    supplements.push(
      supplement(
        "outline",
        `outline:${input.context.branchId}`,
        null,
        "大纲",
        outline.rows.map((row) => `${row.level}: ${row.title}`).join("\n"),
      ),
    );
  }
  if (input.request.options.includeForeshadowLedger) {
    if (input.historical) {
      await assertHistoricalForeshadowsAreExact(client, input);
    }
    const foreshadows = await client.query<{
      id: string;
      title: string;
      summary: string;
      status: string;
      target_from_chapter: number;
      target_to_chapter: number;
    }>(
      input.historical
        ? `SELECT id, title, summary, status, target_from_chapter, target_to_chapter
             FROM foreshadows
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 AND deleted_at IS NULL
              AND version_node_id = ANY($4::uuid[])
            ORDER BY target_to_chapter, title`
        : `SELECT id, title, summary, status, target_from_chapter, target_to_chapter
             FROM foreshadows
            WHERE user_id = $1 AND work_id = $2 AND branch_id = $3 AND deleted_at IS NULL
            ORDER BY target_to_chapter, title`,
      input.historical
        ? [input.userId, input.context.workId, input.context.branchId, input.ancestorIds]
        : [input.userId, input.context.workId, input.context.branchId],
    );
    supplements.push(
      supplement(
        "foreshadows",
        `foreshadows:${input.context.branchId}`,
        null,
        "伏笔账本",
        foreshadows.rows
          .map(
            (row) =>
              `${row.title} [${row.status}] ${row.target_from_chapter}-${row.target_to_chapter}\n${row.summary}`,
          )
          .join("\n\n"),
      ),
    );
  }
  if (input.request.options.includeChangeHistory) {
    if (input.historical && !input.sourceCreatedAt) {
      throw new WorkExportSourceInvalidError("指定历史版本缺少可用的时间边界");
    }
    const changes = await client.query<{
      id: string;
      title: string;
      reason: string;
      status: string;
      created_at: Date;
    }>(
      `SELECT id, title, reason, status, created_at FROM change_requests
        WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
          ${input.historical ? "AND created_at <= $4" : ""}
        ORDER BY created_at`,
      input.historical
        ? [input.userId, input.context.workId, input.context.branchId, input.sourceCreatedAt]
        : [input.userId, input.context.workId, input.context.branchId],
    );
    supplements.push(
      supplement(
        "change_history",
        `changes:${input.context.branchId}`,
        null,
        "修改记录",
        changes.rows
          .map(
            (row) => `${row.created_at.toISOString()} ${row.title} [${row.status}]\n${row.reason}`,
          )
          .join("\n\n"),
      ),
    );
  }
  return supplements;
}

async function assertHistoricalChapterOutlineIsExact(
  client: PoolClient,
  input: {
    userId: string;
    context: ExportContext;
    ancestorIds: string[];
    chapterIds: string[];
  },
): Promise<void> {
  const drift = await client.query(
    `WITH RECURSIVE lineage AS (
       SELECT id, parent_id, version_node_id
         FROM outline_nodes
        WHERE user_id = $1 AND work_id = $2 AND branch_id = $3
          AND chapter_id = ANY($4::uuid[])
       UNION ALL
       SELECT parent.id, parent.parent_id, parent.version_node_id
         FROM outline_nodes parent
         JOIN lineage child ON parent.id = child.parent_id
        WHERE parent.user_id = $1 AND parent.work_id = $2 AND parent.branch_id = $3
     )
     SELECT 1
       FROM lineage node
      WHERE NOT (node.version_node_id = ANY($5::uuid[]))
        AND EXISTS (
          SELECT 1 FROM version_nodes version
           WHERE version.user_id = $1 AND version.work_id = $2 AND version.branch_id = $3
             AND version.object_type = 'outline_node'
             AND version.object_id = node.id
             AND version.id = ANY($5::uuid[])
        )
      LIMIT 1`,
    [
      input.userId,
      input.context.workId,
      input.context.branchId,
      input.chapterIds,
      input.ancestorIds,
    ],
  );
  if (drift.rows[0]) {
    throw new WorkExportSourceInvalidError("指定历史版本的章节/卷大纲已被后续修改，无法精确导出");
  }
}

async function assertHistoricalOutlineIsExact(
  client: PoolClient,
  input: { userId: string; context: ExportContext; ancestorIds: string[] },
): Promise<void> {
  const drift = await client.query(
    `SELECT 1
       FROM outline_nodes node
      WHERE node.user_id = $1 AND node.work_id = $2 AND node.branch_id = $3
        AND NOT (node.version_node_id = ANY($4::uuid[]))
        AND EXISTS (
          SELECT 1 FROM version_nodes version
           WHERE version.user_id = $1 AND version.work_id = $2 AND version.branch_id = $3
             AND version.object_type = 'outline_node'
             AND version.object_id = node.id
             AND version.id = ANY($4::uuid[])
        )
      LIMIT 1`,
    [input.userId, input.context.workId, input.context.branchId, input.ancestorIds],
  );
  if (drift.rows[0]) {
    throw new WorkExportSourceInvalidError("指定历史版本的大纲已被后续修改，无法精确导出");
  }
}

async function assertHistoricalForeshadowsAreExact(
  client: PoolClient,
  input: { userId: string; context: ExportContext; ancestorIds: string[] },
): Promise<void> {
  const drift = await client.query(
    `SELECT 1
       FROM foreshadows entry
      WHERE entry.user_id = $1 AND entry.work_id = $2 AND entry.branch_id = $3
        AND NOT (entry.version_node_id = ANY($4::uuid[]))
        AND EXISTS (
          SELECT 1 FROM version_nodes version
           WHERE version.user_id = $1 AND version.work_id = $2 AND version.branch_id = $3
             AND version.object_type = 'foreshadow'
             AND version.object_id = entry.id
             AND version.id = ANY($4::uuid[])
        )
      LIMIT 1`,
    [input.userId, input.context.workId, input.context.branchId, input.ancestorIds],
  );
  if (drift.rows[0]) {
    throw new WorkExportSourceInvalidError("指定历史版本的伏笔账本已被后续修改，无法精确导出");
  }
}

function supplement(
  kind: ExportSupplementSourceDescriptor["kind"],
  id: string,
  versionNodeId: string | null,
  title: string,
  content: string,
): ExportSupplementSourceDescriptor {
  return {
    kind,
    id,
    versionNodeId,
    title,
    content,
    contentSha256: sha256(content),
  };
}

function toReceipt(row: ExportReceiptRow): WorkExportReceipt {
  const expired = row.expires_at.getTime() <= Date.now() && row.status === "completed";
  return workExportReceiptSchema.parse({
    id: row.id,
    jobId: row.job_id,
    workId: row.work_id,
    branchId: row.branch_id,
    format: row.format,
    status: expired ? "expired" : row.status,
    manifest: row.manifest,
    checksum: row.checksum,
    byteSize: row.byte_size,
    fileName: row.file_name,
    contentType: row.content_type,
    error:
      row.error_code && row.error_message
        ? { code: row.error_code, message: row.error_message }
        : null,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    expiresAt: row.expires_at.toISOString(),
  });
}

async function appendEvent(
  client: PoolClient,
  input: {
    jobId: string;
    userId: string;
    workId: string;
    branchId: string;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const latest = await client.query<{ sequence: number }>(
    `SELECT coalesce(max(sequence), 0)::int AS sequence
       FROM job_events
      WHERE job_id = $1 AND user_id = $2`,
    [input.jobId, input.userId],
  );
  await client.query(
    `INSERT INTO job_events
      (id, job_id, user_id, work_id, branch_id, sequence, event_type, payload, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now())`,
    [
      uuidv7(),
      input.jobId,
      input.userId,
      input.workId,
      input.branchId,
      Number(latest.rows[0]?.sequence ?? 0) + 1,
      input.eventType,
      JSON.stringify(input.payload),
    ],
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class WorkExportSourceInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkExportSourceInvalidError";
  }
}

export class WorkExportIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key is already bound to a different export request");
    this.name = "WorkExportIdempotencyConflictError";
  }
}
