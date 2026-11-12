import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { SearchQuery, SearchRebuildProgress, SearchResult } from "@novel-brain/contracts";
import {
  createDatabaseClient,
  createDatabasePool,
  searchRebuildRuns,
  type DatabaseClient,
} from "@novel-brain/db";
import { sql, type SQL } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

interface SearchRow {
  [key: string]: unknown;
  work_id: string;
  source_type: SearchResult["sourceType"];
  source_id: string;
  title: string;
  content: string;
  version_node_id: string;
  score: number;
}

const SEARCH_REBUILD_BATCH_SIZE = 200;

@Injectable()
export class SearchRepository implements OnModuleDestroy {
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

  async rebuild(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<SearchRebuildProgress | "not_found"> {
    const created = await this.createRebuildRun(userId, workId, branchId);
    if (created === "not_found") {
      return created;
    }
    let current = created;
    while (current.status === "queued" || current.status === "running") {
      const next = await this.processRebuildRun(userId, workId, branchId, current.runId);
      if (next === "not_found") {
        return next;
      }
      current = next;
    }
    return current;
  }

  async startRebuild(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<SearchRebuildProgress | "not_found"> {
    const created = await this.createRebuildRun(userId, workId, branchId);
    if (created === "not_found") {
      return created;
    }
    return this.processRebuildRun(userId, workId, branchId, created.runId);
  }

  async processRebuildRun(
    userId: string,
    workId: string,
    branchId: string,
    runId: string,
  ): Promise<SearchRebuildProgress | "not_found"> {
    return this.withTenant(userId, async (transaction) => {
      const [run] = await transaction
        .select()
        .from(searchRebuildRuns)
        .where(
          sql`${searchRebuildRuns.id} = ${runId}::uuid
            AND ${searchRebuildRuns.userId} = ${userId}::uuid
            AND ${searchRebuildRuns.workId} = ${workId}::uuid
            AND ${searchRebuildRuns.branchId} = ${branchId}::uuid`,
        )
        .for("update")
        .limit(1);
      if (!run) {
        return "not_found";
      }
      if (run.status === "completed" || run.status === "failed") {
        return toRebuildProgress(run);
      }
      const stage = run.stage;
      if (stage > 4) {
        await cleanupSearchDocuments(transaction, userId, workId, branchId);
        const [completed] = await transaction
          .update(searchRebuildRuns)
          .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
          .where(sql`${searchRebuildRuns.id} = ${run.id}::uuid`)
          .returning();
        return completed ? toRebuildProgress(completed) : "not_found";
      }
      const result = await transaction.execute<{ source_id: string }>(
        rebuildStageSql(stage, userId, workId, branchId, run.stageOffset),
      );
      const indexed = run.indexed + result.rows.length;
      let nextStage = run.stage;
      let nextOffset = run.stageOffset + result.rows.length;
      if (result.rows.length < SEARCH_REBUILD_BATCH_SIZE) {
        nextStage += 1;
        nextOffset = 0;
      }
      const completed = nextStage > 4;
      if (completed) {
        await cleanupSearchDocuments(transaction, userId, workId, branchId);
      }
      const [updated] = await transaction
        .update(searchRebuildRuns)
        .set({
          status: completed ? "completed" : "running",
          stage: nextStage,
          stageOffset: nextOffset,
          indexed,
          completedAt: completed ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(sql`${searchRebuildRuns.id} = ${run.id}::uuid`)
        .returning();
      return updated ? toRebuildProgress(updated) : "not_found";
    });
  }

  async rebuildProgress(
    userId: string,
    workId: string,
    branchId: string,
    runId: string,
  ): Promise<SearchRebuildProgress | "not_found"> {
    return this.withTenant(userId, async (transaction) => {
      const [run] = await transaction
        .select()
        .from(searchRebuildRuns)
        .where(
          sql`${searchRebuildRuns.id} = ${runId}::uuid
            AND ${searchRebuildRuns.userId} = ${userId}::uuid
            AND ${searchRebuildRuns.workId} = ${workId}::uuid
            AND ${searchRebuildRuns.branchId} = ${branchId}::uuid`,
        )
        .limit(1);
      return run ? toRebuildProgress(run) : "not_found";
    });
  }

  private async createRebuildRun(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<SearchRebuildProgress | "not_found"> {
    return this.withTenant(userId, async (transaction) => {
      const context = (
        await transaction.execute<{ head_node_id: string }>(sql`
          SELECT branch.head_node_id
          FROM work_branches AS branch
          INNER JOIN works AS work ON work.id = branch.work_id AND work.user_id = branch.user_id
          WHERE branch.id = ${branchId}::uuid
            AND branch.work_id = ${workId}::uuid
            AND branch.user_id = ${userId}::uuid
            AND work.deleted_at IS NULL
          LIMIT 1
        `)
      ).rows[0];
      if (!context?.head_node_id) {
        return "not_found";
      }
      const totals = (
        await transaction.execute<{ total: number }>(sql`
          SELECT
            (SELECT count(*) FROM entities
              WHERE user_id = ${userId}::uuid AND work_id = ${workId}::uuid
                AND branch_id = ${branchId}::uuid AND deleted_at IS NULL
                AND status <> 'discarded') +
            (SELECT count(*) FROM facts
              WHERE user_id = ${userId}::uuid AND work_id = ${workId}::uuid
                AND branch_id = ${branchId}::uuid) +
            (SELECT count(*) FROM map_nodes
              WHERE user_id = ${userId}::uuid AND work_id = ${workId}::uuid
                AND branch_id = ${branchId}::uuid) +
            (SELECT count(*) FROM timeline_events
              WHERE user_id = ${userId}::uuid AND work_id = ${workId}::uuid
                AND branch_id = ${branchId}::uuid) +
            (SELECT count(*) FROM chapters
              WHERE user_id = ${userId}::uuid AND work_id = ${workId}::uuid
                AND branch_id = ${branchId}::uuid) AS total
        `)
      ).rows[0]?.total;
      const [created] = await transaction
        .insert(searchRebuildRuns)
        .values({
          id: uuidv7(),
          userId,
          workId,
          branchId,
          status: "running",
          stage: 0,
          stageOffset: 0,
          indexed: 0,
          expectedTotal: Number(totals ?? 0),
        })
        .returning();
      if (!created) {
        throw new Error("Failed to create search rebuild run");
      }
      return toRebuildProgress(created);
    });
  }

  async search(
    userId: string,
    workId: string,
    branchId: string,
    input: SearchQuery,
  ): Promise<SearchResult[] | "not_found"> {
    return this.withTenant(userId, async (transaction) => {
      const context = (
        await transaction.execute<{ id: string }>(sql`
        SELECT branch.id
        FROM work_branches AS branch
        INNER JOIN works AS work ON work.id = branch.work_id AND work.user_id = branch.user_id
        WHERE branch.id = ${branchId}::uuid
          AND branch.work_id = ${workId}::uuid
          AND branch.user_id = ${userId}::uuid
          AND work.deleted_at IS NULL
        LIMIT 1
      `)
      ).rows[0];
      if (!context) {
        return "not_found";
      }
      const rows = (
        await transaction.execute<SearchRow>(sql`
        WITH ranked AS (
          SELECT
            document.*,
            row_number() OVER (
              PARTITION BY document.source_type, document.source_id
              ORDER BY document.updated_at DESC, document.version_node_id DESC
            ) AS row_number
          FROM search_documents AS document
          WHERE document.user_id = ${userId}::uuid
            AND document.work_id = ${workId}::uuid
            AND document.branch_id = ${branchId}::uuid
        )
        SELECT
          work_id,
          source_type,
          source_id,
          title,
          content,
          version_node_id,
          GREATEST(
            similarity(title, ${input.q}),
            similarity(content, ${input.q}),
            similarity(aliases::text, ${input.q})
          )::float AS score
        FROM ranked
        WHERE row_number = 1
          AND (
            (source_type = 'entity' AND EXISTS (
              SELECT 1 FROM entities
              WHERE entities.id = ranked.source_id
                AND entities.deleted_at IS NULL
                AND entities.status <> 'discarded'
                AND EXISTS (
                  SELECT 1 FROM entity_versions AS version
                  WHERE version.entity_id = entities.id
                    AND version.version = entities.version
                    AND version.version_node_id = ranked.version_node_id
                )
            ))
            OR (source_type = 'fact' AND EXISTS (
              SELECT 1 FROM facts
              INNER JOIN canon_commits AS commit ON commit.id = facts.canon_commit_id
              WHERE facts.id = ranked.source_id
                AND facts.status = 'active'
                AND commit.version_node_id = ranked.version_node_id
            ))
            OR (source_type = 'map_node' AND EXISTS (
              SELECT 1 FROM map_nodes
              WHERE map_nodes.id = ranked.source_id
                AND map_nodes.version_node_id = ranked.version_node_id
            ))
            OR (source_type = 'timeline_event' AND EXISTS (
              SELECT 1 FROM timeline_events
              WHERE timeline_events.id = ranked.source_id
                AND timeline_events.version_node_id = ranked.version_node_id
            ))
            OR (source_type = 'chapter' AND EXISTS (
              SELECT 1 FROM chapters
              INNER JOIN chapter_versions AS version ON version.id = chapters.current_version_id
              WHERE chapters.id = ranked.source_id
                AND version.version_node_id = ranked.version_node_id
            ))
          )
          AND concat_ws(' ', title, content, aliases::text) ILIKE ${`%${input.q}%`}
        ORDER BY score DESC, updated_at DESC, source_id DESC
        LIMIT ${input.limit}
      `)
      ).rows;
      return rows.map((row) => ({
        id: row.source_id,
        workId: row.work_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        title: row.title,
        snippet: row.content.slice(0, 240),
        score: Number(row.score),
        versionNodeId: row.version_node_id,
      }));
    });
  }

  async globalSearch(userId: string, input: SearchQuery): Promise<SearchResult[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = (
        await transaction.execute<SearchRow>(sql`
          WITH ranked AS (
            SELECT
              document.*,
              row_number() OVER (
                PARTITION BY document.work_id, document.source_type, document.source_id
                ORDER BY document.updated_at DESC, document.version_node_id DESC
              ) AS row_number
            FROM search_documents AS document
            INNER JOIN work_branches AS branch ON branch.id = document.branch_id
            INNER JOIN works AS work ON work.id = document.work_id AND work.user_id = document.user_id
            WHERE document.user_id = ${userId}::uuid
              AND branch.name = 'main'
              AND work.deleted_at IS NULL
          )
          SELECT
            work_id,
            source_type,
            source_id,
            title,
            content,
            version_node_id,
            GREATEST(
              similarity(title, ${input.q}),
              similarity(content, ${input.q}),
              similarity(aliases::text, ${input.q})
            )::float AS score
          FROM ranked
          WHERE row_number = 1
            AND (
              (source_type = 'entity' AND EXISTS (
                SELECT 1 FROM entities
                WHERE entities.id = ranked.source_id
                  AND entities.deleted_at IS NULL
                  AND entities.status <> 'discarded'
                  AND EXISTS (
                    SELECT 1 FROM entity_versions AS version
                    WHERE version.entity_id = entities.id
                      AND version.version = entities.version
                      AND version.version_node_id = ranked.version_node_id
                  )
              ))
              OR (source_type = 'fact' AND EXISTS (
                SELECT 1 FROM facts
                INNER JOIN canon_commits AS commit ON commit.id = facts.canon_commit_id
                WHERE facts.id = ranked.source_id
                  AND facts.status = 'active'
                  AND commit.version_node_id = ranked.version_node_id
              ))
              OR (source_type = 'map_node' AND EXISTS (
                SELECT 1 FROM map_nodes
                WHERE map_nodes.id = ranked.source_id
                  AND map_nodes.version_node_id = ranked.version_node_id
              ))
              OR (source_type = 'timeline_event' AND EXISTS (
                SELECT 1 FROM timeline_events
                WHERE timeline_events.id = ranked.source_id
                  AND timeline_events.version_node_id = ranked.version_node_id
              ))
              OR (source_type = 'chapter' AND EXISTS (
                SELECT 1 FROM chapters
                INNER JOIN chapter_versions AS version ON version.id = chapters.current_version_id
                WHERE chapters.id = ranked.source_id
                  AND version.version_node_id = ranked.version_node_id
              ))
            )
            AND concat_ws(' ', title, content, aliases::text) ILIKE ${`%${input.q}%`}
          ORDER BY score DESC, updated_at DESC, source_id DESC
          LIMIT ${input.limit}
        `)
      ).rows;
      return rows.map((row) => ({
        id: row.source_id,
        workId: row.work_id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        title: row.title,
        snippet: row.content.slice(0, 240),
        score: Number(row.score),
        versionNodeId: row.version_node_id,
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

async function cleanupSearchDocuments(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
  branchId: string,
): Promise<void> {
  await transaction.execute(sql`
    DELETE FROM search_documents AS document
    WHERE document.user_id = ${userId}::uuid
      AND document.work_id = ${workId}::uuid
      AND document.branch_id = ${branchId}::uuid
      AND (
        (document.source_type = 'entity' AND NOT EXISTS (
          SELECT 1 FROM entities AS entity
          INNER JOIN entity_versions AS version
            ON version.entity_id = entity.id AND version.version = entity.version
          WHERE entity.id = document.source_id
            AND entity.deleted_at IS NULL
            AND entity.status <> 'discarded'
            AND version.version_node_id = document.version_node_id
        ))
        OR (document.source_type = 'fact' AND NOT EXISTS (
          SELECT 1 FROM facts AS fact
          INNER JOIN canon_commits AS commit ON commit.id = fact.canon_commit_id
          WHERE fact.id = document.source_id
            AND commit.version_node_id = document.version_node_id
        ))
        OR (document.source_type = 'map_node' AND NOT EXISTS (
          SELECT 1 FROM map_nodes AS node
          WHERE node.id = document.source_id
            AND node.version_node_id = document.version_node_id
        ))
        OR (document.source_type = 'timeline_event' AND NOT EXISTS (
          SELECT 1 FROM timeline_events AS event
          WHERE event.id = document.source_id
            AND event.version_node_id = document.version_node_id
        ))
        OR (document.source_type = 'chapter' AND NOT EXISTS (
          SELECT 1 FROM chapters AS chapter
          INNER JOIN chapter_versions AS version ON version.id = chapter.current_version_id
          WHERE chapter.id = document.source_id
            AND version.version_node_id = document.version_node_id
        ))
      )
  `);
}

function rebuildStageSql(
  stage: number,
  userId: string,
  workId: string,
  branchId: string,
  offset: number,
): SQL {
  const limit = sql.raw(String(SEARCH_REBUILD_BATCH_SIZE));
  const pageOffset = sql.raw(String(offset));
  switch (stage) {
    case 0:
      return sql`
        INSERT INTO search_documents (
          work_id, branch_id, user_id, source_type, source_id, entity_type, title, content,
          aliases, version_node_id, object_version, source_chapter_id, from_chapter, to_chapter,
          from_era, from_story_time_label, from_story_sort_key, to_era, to_story_time_label,
          to_story_sort_key, metadata, created_at, updated_at
        )
        SELECT
          entity.work_id, entity.branch_id, entity.user_id, 'entity', entity.id,
          entity.type, entity.name,
          concat_ws(E'\n', entity.summary, entity.description, entity.attributes::text),
          entity.aliases, version.version_node_id, entity.version, NULL, 1, NULL,
          NULL, NULL, NULL, NULL, NULL, NULL,
          jsonb_build_object('status', entity.status, 'tags', entity.tags),
          entity.created_at, entity.updated_at
        FROM entities AS entity
        INNER JOIN entity_versions AS version
          ON version.entity_id = entity.id AND version.version = entity.version
        WHERE entity.user_id = ${userId}::uuid
          AND entity.work_id = ${workId}::uuid
          AND entity.branch_id = ${branchId}::uuid
          AND entity.deleted_at IS NULL
          AND entity.status <> 'discarded'
        ORDER BY entity.id
        LIMIT ${limit} OFFSET ${pageOffset}
        ON CONFLICT (branch_id, source_type, source_id, version_node_id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          aliases = EXCLUDED.aliases,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING source_id
      `;
    case 1:
      return sql`
        INSERT INTO search_documents (
          work_id, branch_id, user_id, source_type, source_id, entity_type, title, content,
          aliases, version_node_id, object_version, source_chapter_id, from_chapter, to_chapter,
          from_era, from_story_time_label, from_story_sort_key, to_era, to_story_time_label,
          to_story_sort_key, metadata, created_at, updated_at
        )
        SELECT
          fact.work_id, fact.branch_id, fact.user_id, 'fact', fact.id, NULL,
          concat(fact.subject, ' · ', fact.predicate),
          concat(fact.subject, ' ', fact.predicate, ' ', fact.object),
          '[]'::jsonb, commit.version_node_id, 1, fact.chapter_id,
          fact.valid_from_chapter, fact.valid_to_chapter,
          NULL, NULL, NULL, NULL, NULL, NULL,
          jsonb_build_object('status', fact.status, 'risk', fact.risk),
          fact.created_at, fact.created_at
        FROM facts AS fact
        INNER JOIN canon_commits AS commit ON commit.id = fact.canon_commit_id
        WHERE fact.user_id = ${userId}::uuid
          AND fact.work_id = ${workId}::uuid
          AND fact.branch_id = ${branchId}::uuid
        ORDER BY fact.id
        LIMIT ${limit} OFFSET ${pageOffset}
        ON CONFLICT (branch_id, source_type, source_id, version_node_id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          source_chapter_id = EXCLUDED.source_chapter_id,
          from_chapter = EXCLUDED.from_chapter,
          to_chapter = EXCLUDED.to_chapter,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING source_id
      `;
    case 2:
      return sql`
        INSERT INTO search_documents (
          work_id, branch_id, user_id, source_type, source_id, entity_type, title, content,
          aliases, version_node_id, object_version, source_chapter_id, from_chapter, to_chapter,
          from_era, from_story_time_label, from_story_sort_key, to_era, to_story_time_label,
          to_story_sort_key, metadata, created_at, updated_at
        )
        SELECT
          node.work_id, node.branch_id, node.user_id, 'map_node', node.id, 'map',
          node.name, node.summary, '[]'::jsonb, node.version_node_id, 1, NULL,
          node.valid_from_chapter, node.valid_to_chapter,
          node.from_era, node.from_story_time_label, node.from_story_sort_key,
          node.to_era, node.to_story_time_label, node.to_story_sort_key,
          jsonb_build_object('nodeType', node.node_type, 'mapId', node.map_id),
          node.created_at, node.created_at
        FROM map_nodes AS node
        WHERE node.user_id = ${userId}::uuid
          AND node.work_id = ${workId}::uuid
          AND node.branch_id = ${branchId}::uuid
        ORDER BY node.id
        LIMIT ${limit} OFFSET ${pageOffset}
        ON CONFLICT (branch_id, source_type, source_id, version_node_id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          from_chapter = EXCLUDED.from_chapter,
          to_chapter = EXCLUDED.to_chapter,
          from_era = EXCLUDED.from_era,
          from_story_time_label = EXCLUDED.from_story_time_label,
          from_story_sort_key = EXCLUDED.from_story_sort_key,
          to_era = EXCLUDED.to_era,
          to_story_time_label = EXCLUDED.to_story_time_label,
          to_story_sort_key = EXCLUDED.to_story_sort_key,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING source_id
      `;
    case 3:
      return sql`
        INSERT INTO search_documents (
          work_id, branch_id, user_id, source_type, source_id, entity_type, title, content,
          aliases, version_node_id, object_version, source_chapter_id, from_chapter, to_chapter,
          from_era, from_story_time_label, from_story_sort_key, to_era, to_story_time_label,
          to_story_sort_key, metadata, created_at, updated_at
        )
        SELECT
          event.work_id, event.branch_id, event.user_id, 'timeline_event', event.id,
          'timeline_event', concat(event.era, ' · ', event.story_time_label),
          event.event_text, '[]'::jsonb, event.version_node_id, 1, NULL,
          event.valid_from_chapter, event.valid_to_chapter,
          event.from_era, event.from_story_time_label, event.from_story_sort_key,
          event.to_era, event.to_story_time_label, event.to_story_sort_key,
          jsonb_build_object('durationMinutes', event.duration_minutes),
          event.created_at, event.created_at
        FROM timeline_events AS event
        WHERE event.user_id = ${userId}::uuid
          AND event.work_id = ${workId}::uuid
          AND event.branch_id = ${branchId}::uuid
        ORDER BY event.id
        LIMIT ${limit} OFFSET ${pageOffset}
        ON CONFLICT (branch_id, source_type, source_id, version_node_id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          from_chapter = EXCLUDED.from_chapter,
          to_chapter = EXCLUDED.to_chapter,
          from_era = EXCLUDED.from_era,
          from_story_time_label = EXCLUDED.from_story_time_label,
          from_story_sort_key = EXCLUDED.from_story_sort_key,
          to_era = EXCLUDED.to_era,
          to_story_time_label = EXCLUDED.to_story_time_label,
          to_story_sort_key = EXCLUDED.to_story_sort_key,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING source_id
      `;
    case 4:
      return sql`
        INSERT INTO search_documents (
          work_id, branch_id, user_id, source_type, source_id, entity_type, title, content,
          aliases, version_node_id, object_version, source_chapter_id, from_chapter, to_chapter,
          from_era, from_story_time_label, from_story_sort_key, to_era, to_story_time_label,
          to_story_sort_key, metadata, created_at, updated_at
        )
        SELECT
          chapter.work_id, chapter.branch_id, chapter.user_id, 'chapter', chapter.id, NULL,
          chapter.title, version.content, '[]'::jsonb, version.version_node_id,
          chapter.version, chapter.id, chapter.number, chapter.number,
          NULL, NULL, NULL, NULL, NULL, NULL,
          jsonb_build_object('status', chapter.status),
          chapter.created_at, chapter.updated_at
        FROM chapters AS chapter
        INNER JOIN chapter_versions AS version ON version.id = chapter.current_version_id
        WHERE chapter.user_id = ${userId}::uuid
          AND chapter.work_id = ${workId}::uuid
          AND chapter.branch_id = ${branchId}::uuid
        ORDER BY chapter.id
        LIMIT ${limit} OFFSET ${pageOffset}
        ON CONFLICT (branch_id, source_type, source_id, version_node_id) DO UPDATE SET
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          source_chapter_id = EXCLUDED.source_chapter_id,
          from_chapter = EXCLUDED.from_chapter,
          to_chapter = EXCLUDED.to_chapter,
          metadata = EXCLUDED.metadata,
          updated_at = now()
        RETURNING source_id
      `;
    default:
      return sql`SELECT NULL::uuid AS source_id WHERE false`;
  }
}

function toRebuildProgress(run: typeof searchRebuildRuns.$inferSelect): SearchRebuildProgress {
  return {
    runId: run.id,
    status: run.status as SearchRebuildProgress["status"],
    indexed: run.indexed,
    expectedTotal: run.expectedTotal,
    stage: run.stage,
    stageOffset: run.stageOffset,
  };
}
