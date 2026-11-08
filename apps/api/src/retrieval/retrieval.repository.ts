import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  type DomainRef,
  type RetrievalQuery,
  type RetrievalRelationshipHop,
  type RetrievalResult,
  type SettingEntityType,
  type StoryTimePoint,
} from "@novel-brain/contracts";
import {
  chapters,
  chapterVersions,
  createDatabaseClient,
  createDatabasePool,
  works,
  workBranches,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, eq, sql } from "drizzle-orm";
import type { Pool } from "pg";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface RetrievalWorkContext {
  workId: string;
  branchId: string;
}

export interface RetrievalSearchOutcome {
  results: RetrievalResult[];
  tookMs: number;
}

interface SearchRow {
  source_type: "entity" | "fact" | "timeline_event" | "map_node";
  source_id: string;
  entity_type: SettingEntityType | null;
  title: string;
  content: string;
  branch_id: string;
  version_node_id: string;
  object_version: number;
  source_chapter_id: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  from_chapter: number;
  to_chapter: number | null;
  from_era: string | null;
  from_story_time_label: string | null;
  from_story_sort_key: number | null;
  to_era: string | null;
  to_story_time_label: string | null;
  to_story_sort_key: number | null;
  matched_term: string;
  match_field: "name" | "aliases" | "title" | "content";
  match_kind:
    "canonical_name" | "alias" | "title" | "synonym" | "fuzzy" | "content" | "relationship";
  score: number;
  same_name_count: number;
}

interface RelationshipRow {
  relation_id: string;
  source_type: "character" | "faction";
  source_id: string;
  target_type: string;
  target_id: string;
  target_label: string | null;
  relation_type: string;
  version_node_id: string;
  branch_id: string;
}

interface DocumentRow {
  source_type: "entity" | "fact" | "timeline_event" | "map_node";
  source_id: string;
  entity_type: SettingEntityType | null;
  title: string;
  content: string;
  branch_id: string;
  version_node_id: string;
  object_version: number;
  source_chapter_id: string | null;
  chapter_number: number | null;
  chapter_title: string | null;
  from_chapter: number;
  to_chapter: number | null;
  from_era: string | null;
  from_story_time_label: string | null;
  from_story_sort_key: number | null;
  to_era: string | null;
  to_story_time_label: string | null;
  to_story_sort_key: number | null;
  same_name_count: number;
}

interface GraphNode {
  id: string;
  type: string;
  label: string;
}

@Injectable()
export class RetrievalRepository implements OnModuleDestroy {
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
  ): Promise<RetrievalWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
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

  async search(
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
  ): Promise<RetrievalSearchOutcome> {
    const startedAt = performance.now();
    const results = await this.withTenant(userId, async (transaction) => {
      const scopedInput = await this.scopeToTargetChapterVersion(
        transaction,
        userId,
        workId,
        branchId,
        input,
      );
      if (!scopedInput) {
        return [];
      }
      const rows = await this.searchRows(transaction, userId, workId, branchId, scopedInput);
      const direct = rows.map((row) => this.toResult(row));
      if (!scopedInput.expandRelationships || scopedInput.relationshipDepth === 0) {
        return direct;
      }
      const expanded = await this.expandRelationships(
        transaction,
        userId,
        workId,
        branchId,
        scopedInput,
        direct,
      );
      const directById = new Map(direct.map((result) => [result.id, result]));
      const relatedOnly: RetrievalResult[] = [];
      for (const result of expanded) {
        const existing = directById.get(result.id);
        if (existing) {
          if (existing.relationshipPath.length === 0) {
            existing.relationshipPath = result.relationshipPath;
          }
          continue;
        }
        relatedOnly.push(result);
      }
      return [...direct, ...relatedOnly];
    });
    const ranked = results
      .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
      .slice(0, input.limit);
    return {
      results: ranked,
      tookMs: Math.round((performance.now() - startedAt) * 10) / 10,
    };
  }

  private async scopeToTargetChapterVersion(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
  ): Promise<RetrievalQuery | null> {
    if (input.versionNodeId !== null) {
      return input;
    }
    const [anchor] = await transaction
      .select({ versionNodeId: chapterVersions.versionNodeId })
      .from(chapters)
      .innerJoin(
        chapterVersions,
        and(
          eq(chapterVersions.id, chapters.currentVersionId),
          eq(chapterVersions.userId, userId),
          eq(chapterVersions.workId, workId),
          eq(chapterVersions.branchId, branchId),
        ),
      )
      .where(
        and(
          eq(chapters.userId, userId),
          eq(chapters.workId, workId),
          eq(chapters.branchId, branchId),
          eq(chapters.number, input.chapterNumber),
        ),
      )
      .limit(1);
    return anchor ? { ...input, versionNodeId: anchor.versionNodeId } : null;
  }

  private async searchRows(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
  ): Promise<SearchRow[]> {
    const terms = [input.query, ...input.synonyms];
    const storyTime = input.storyTime;
    const result = await transaction.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT node.id, node.parent_node_id, 0 AS depth
        FROM version_nodes AS node
        WHERE ${input.versionNodeId}::uuid IS NOT NULL
          AND node.id = ${input.versionNodeId}::uuid
          AND node.user_id = ${userId}::uuid
          AND node.branch_id = ${branchId}::uuid
        UNION ALL
        SELECT parent.id, parent.parent_node_id, child.depth + 1
        FROM version_nodes AS parent
        INNER JOIN ancestors AS child ON parent.id = child.parent_node_id
        WHERE parent.user_id = ${userId}::uuid
          AND parent.branch_id = ${branchId}::uuid
      ),
      documents AS (
        SELECT document.*,
          CASE
            WHEN ${input.versionNodeId}::uuid IS NULL THEN 0
            ELSE ancestor.depth
          END AS version_depth
        FROM search_documents AS document
        LEFT JOIN ancestors AS ancestor ON ancestor.id = document.version_node_id
        WHERE document.user_id = ${userId}::uuid
          AND document.work_id = ${workId}::uuid
          AND document.branch_id = ${branchId}::uuid
          AND document.source_type = ANY(${sql.param(input.sourceKinds)}::text[])
          AND (
            cardinality(${sql.param(input.entityTypes)}::text[]) = 0
            OR document.entity_type = ANY(${sql.param(input.entityTypes)}::text[])
          )
          AND (${input.versionNodeId}::uuid IS NULL OR ancestor.id IS NOT NULL)
      ),
      current_documents AS (
        SELECT document.*,
          row_number() OVER (
            PARTITION BY document.source_type, document.source_id
            ORDER BY document.version_depth ASC, document.created_at DESC,
              document.version_node_id DESC
          ) AS current_rank
        FROM documents AS document
      ),
      active_documents AS (
        SELECT document.*
        FROM current_documents AS document
        WHERE document.current_rank = 1
          AND document.from_chapter <= ${input.chapterNumber}
          AND (document.to_chapter IS NULL OR document.to_chapter >= ${input.chapterNumber})
          AND (
            ${storyTime?.era ?? null}::text IS NULL
            OR document.from_era IS NULL
            OR document.from_era = ${storyTime?.era ?? null}::text
          )
          AND (
            ${storyTime?.sortKey ?? null}::integer IS NULL
            OR document.from_story_sort_key IS NULL
            OR (
              document.from_story_sort_key <= ${storyTime?.sortKey ?? null}::integer
              AND (
                document.to_story_sort_key IS NULL
                OR document.to_story_sort_key >= ${storyTime?.sortKey ?? null}::integer
              )
            )
          )
          AND NOT (
            document.source_type = 'fact'
            AND coalesce(document.metadata->>'status', 'active') = 'superseded'
          )
          AND (
            ${input.povCharacterId}::uuid IS NULL
            OR document.source_type <> 'fact'
            OR EXISTS (
              SELECT 1
              FROM character_knowledge_states AS knowledge
              WHERE knowledge.user_id = ${userId}::uuid
                AND knowledge.work_id = ${workId}::uuid
                AND knowledge.branch_id = ${branchId}::uuid
                AND knowledge.character_id = ${input.povCharacterId}::uuid
                AND knowledge.objective_fact_id = document.source_id
                AND EXISTS (
                  SELECT 1
                  FROM ancestors AS knowledge_version
                  WHERE knowledge_version.id = knowledge.version_node_id
                )
                AND knowledge.state = 'knowledge'
                AND knowledge.valid_from_chapter <= ${input.chapterNumber}
                AND (
                  knowledge.valid_to_chapter IS NULL
                  OR knowledge.valid_to_chapter >= ${input.chapterNumber}
                )
            )
          )
      ),
      scored AS (
        SELECT document.*, term.term, term.ordinality,
          CASE
            WHEN term.ordinality > 1 THEN 0.86
            WHEN lower(document.title) = lower(term.term) THEN 1
            WHEN lower(document.aliases::text) LIKE '%' || lower(term.term) || '%' THEN 0.98
            WHEN lower(document.title) LIKE '%' || lower(term.term) || '%' THEN 0.9
            WHEN lower(document.aliases::text) LIKE '%' || lower(term.term) || '%' THEN 0.88
            WHEN similarity(document.title, term.term) >= 0.2 THEN 0.76
            WHEN word_similarity(term.term, document.title) >= 0.33 THEN 0.74
            WHEN lower(document.content) LIKE '%' || lower(term.term) || '%' THEN 0.6
            ELSE 0.5
          END AS score,
          CASE
            WHEN term.ordinality > 1 THEN
              CASE
                WHEN lower(document.aliases::text) LIKE '%' || lower(term.term) || '%'
                  THEN 'aliases'
                WHEN document.source_type IN ('fact', 'timeline_event')
                  THEN 'title'
                ELSE 'name'
              END
            WHEN lower(document.aliases::text) LIKE '%' || lower(term.term) || '%'
              THEN 'aliases'
            WHEN lower(document.title) LIKE '%' || lower(term.term) || '%'
              THEN CASE
                WHEN document.source_type IN ('fact', 'timeline_event') THEN 'title'
                ELSE 'name'
              END
            WHEN similarity(document.title, term.term) >= 0.2
              OR word_similarity(term.term, document.title) >= 0.33
              THEN CASE
                WHEN document.source_type IN ('fact', 'timeline_event') THEN 'title'
                ELSE 'name'
              END
            ELSE 'content'
          END AS match_field,
          CASE
            WHEN term.ordinality > 1 THEN 'synonym'
            WHEN lower(document.title) = lower(term.term)
              OR lower(document.title) LIKE '%' || lower(term.term) || '%'
              THEN CASE
                WHEN document.source_type IN ('fact', 'timeline_event') THEN 'title'
                ELSE 'canonical_name'
              END
            WHEN lower(document.aliases::text) LIKE '%' || lower(term.term) || '%'
              THEN 'alias'
            WHEN similarity(document.title, term.term) >= 0.2
              OR word_similarity(term.term, document.title) >= 0.33
              THEN 'fuzzy'
            ELSE 'content'
          END AS match_kind
        FROM active_documents AS document
        CROSS JOIN unnest(${sql.param(terms)}::text[]) WITH ORDINALITY AS term(term, ordinality)
        WHERE
          lower(document.title) LIKE '%' || lower(term.term) || '%'
          OR lower(document.aliases::text) LIKE '%' || lower(term.term) || '%'
          OR lower(document.content) LIKE '%' || lower(term.term) || '%'
          OR similarity(document.title, term.term) >= 0.2
          OR word_similarity(term.term, document.title) >= 0.33
          OR word_similarity(term.term, document.content) >= 0.33
      ),
      ranked AS (
        SELECT scored.*,
          row_number() OVER (
            PARTITION BY scored.source_type, scored.source_id
            ORDER BY scored.score DESC, scored.ordinality ASC
          ) AS result_rank
        FROM scored
      ),
      final AS (
        SELECT ranked.*,
          count(*) OVER (PARTITION BY lower(ranked.title)) AS same_name_count
        FROM ranked
        WHERE ranked.result_rank = 1
      )
      SELECT
        final.source_type,
        final.source_id,
        final.entity_type,
        final.title,
        final.content,
        final.branch_id,
        final.version_node_id,
        final.object_version,
        final.source_chapter_id,
        chapter.number AS chapter_number,
        chapter.title AS chapter_title,
        final.from_chapter,
        final.to_chapter,
        final.from_era,
        final.from_story_time_label,
        final.from_story_sort_key,
        final.to_era,
        final.to_story_time_label,
        final.to_story_sort_key,
        final.term AS matched_term,
        final.match_field,
        final.match_kind,
        final.score,
        final.same_name_count
      FROM final
      LEFT JOIN chapters AS chapter ON chapter.id = final.source_chapter_id
      ORDER BY final.score DESC, final.title ASC, final.source_id ASC
      LIMIT ${Math.min(input.limit * 4, 200)}
    `);
    return result.rows as unknown as SearchRow[];
  }

  private async expandRelationships(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
    direct: RetrievalResult[],
  ): Promise<RetrievalResult[]> {
    const maxDepth = input.relationshipDepth;
    const queue: Array<{
      node: GraphNode;
      depth: number;
      path: RetrievalRelationshipHop[];
    }> = direct
      .filter((result) => result.sourceKind !== "fact")
      .map((result) => ({
        node: {
          id: result.source.id,
          type: sourceRefType(result),
          label: result.label,
        },
        depth: 0,
        path: [],
      }));
    const visited = new Set(queue.map((item) => item.node.id));
    const documents = new Map<string, DocumentRow>();
    const results: RetrievalResult[] = [];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || current.depth >= maxDepth) {
        continue;
      }
      const edges = await this.fetchRelationships(
        transaction,
        userId,
        workId,
        branchId,
        input,
        current.node.id,
      );
      const unseen = edges
        .map((edge) => neighborOf(edge, current.node.id))
        .filter((neighbor): neighbor is GraphNode => Boolean(neighbor))
        .filter((neighbor) => !visited.has(neighbor.id));
      if (unseen.length === 0) {
        continue;
      }
      const loaded = await this.loadDocuments(transaction, userId, workId, branchId, input, [
        ...new Set(unseen.map((neighbor) => neighbor.id)),
      ]);
      for (const document of loaded) {
        documents.set(document.source_id, document);
      }
      for (const edge of edges) {
        const neighbor = neighborOf(edge, current.node.id);
        if (!neighbor || visited.has(neighbor.id)) {
          continue;
        }
        visited.add(neighbor.id);
        const targetDocument = documents.get(neighbor.id);
        if (targetDocument) {
          neighbor.label = targetDocument.title;
        }
        const hop = relationshipHop(edge, current.node, neighbor, branchId);
        const path = [...current.path, hop];
        if (targetDocument) {
          results.push(this.toRelationshipResult(targetDocument, path, current.depth + 1));
        }
        queue.push({ node: neighbor, depth: current.depth + 1, path });
      }
    }
    return results;
  }

  private async fetchRelationships(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
    nodeId: string,
  ): Promise<RelationshipRow[]> {
    const storyTime = input.storyTime;
    const result = await transaction.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT node.id, node.parent_node_id
        FROM version_nodes AS node
        WHERE ${input.versionNodeId}::uuid IS NOT NULL
          AND node.id = ${input.versionNodeId}::uuid
          AND node.user_id = ${userId}::uuid
          AND node.branch_id = ${branchId}::uuid
        UNION ALL
        SELECT parent.id, parent.parent_node_id
        FROM version_nodes AS parent
        INNER JOIN ancestors AS child ON parent.id = child.parent_node_id
        WHERE parent.user_id = ${userId}::uuid
          AND parent.branch_id = ${branchId}::uuid
      )
      SELECT
        relationship.id AS relation_id,
        'character'::text AS source_type,
        relationship.source_character_id AS source_id,
        relationship.target_type,
        relationship.target_id,
        relationship.target_label,
        relationship.relation_type,
        relationship.version_node_id,
        relationship.branch_id
      FROM character_relationships AS relationship
      WHERE relationship.user_id = ${userId}::uuid
        AND relationship.work_id = ${workId}::uuid
        AND relationship.branch_id = ${branchId}::uuid
        AND (
          relationship.source_character_id = ${nodeId}::uuid
          OR relationship.target_id = ${nodeId}::uuid
        )
        AND (
          ${input.versionNodeId}::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM ancestors
            WHERE ancestors.id = relationship.version_node_id
          )
        )
        AND relationship.valid_from_chapter <= ${input.chapterNumber}
        AND (
          relationship.valid_to_chapter IS NULL
          OR relationship.valid_to_chapter >= ${input.chapterNumber}
        )
        AND (
          ${storyTime?.sortKey ?? null}::integer IS NULL
          OR relationship.from_story_sort_key IS NULL
          OR (
            relationship.from_story_sort_key <= ${storyTime?.sortKey ?? null}::integer
            AND (
              relationship.to_story_sort_key IS NULL
              OR relationship.to_story_sort_key >= ${storyTime?.sortKey ?? null}::integer
            )
          )
        )
      UNION ALL
      SELECT
        relationship.id AS relation_id,
        'faction'::text AS source_type,
        relationship.source_faction_id AS source_id,
        relationship.target_type,
        relationship.target_id,
        relationship.target_label,
        relationship.relation_type,
        relationship.version_node_id,
        relationship.branch_id
      FROM faction_relationships AS relationship
      WHERE relationship.user_id = ${userId}::uuid
        AND relationship.work_id = ${workId}::uuid
        AND relationship.branch_id = ${branchId}::uuid
        AND (
          relationship.source_faction_id = ${nodeId}::uuid
          OR relationship.target_id = ${nodeId}::uuid
        )
        AND (
          ${input.versionNodeId}::uuid IS NULL
          OR EXISTS (
            SELECT 1
            FROM ancestors
            WHERE ancestors.id = relationship.version_node_id
          )
        )
        AND relationship.valid_from_chapter <= ${input.chapterNumber}
        AND (
          relationship.valid_to_chapter IS NULL
          OR relationship.valid_to_chapter >= ${input.chapterNumber}
        )
        AND (
          ${storyTime?.sortKey ?? null}::integer IS NULL
          OR relationship.from_story_sort_key IS NULL
          OR (
            relationship.from_story_sort_key <= ${storyTime?.sortKey ?? null}::integer
            AND (
              relationship.to_story_sort_key IS NULL
              OR relationship.to_story_sort_key >= ${storyTime?.sortKey ?? null}::integer
            )
          )
        )
    `);
    return result.rows as unknown as RelationshipRow[];
  }

  private async loadDocuments(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    branchId: string,
    input: RetrievalQuery,
    sourceIds: string[],
  ): Promise<DocumentRow[]> {
    if (sourceIds.length === 0) {
      return [];
    }
    const storyTime = input.storyTime;
    const result = await transaction.execute(sql`
      WITH RECURSIVE ancestors AS (
        SELECT node.id, node.parent_node_id, 0 AS depth
        FROM version_nodes AS node
        WHERE ${input.versionNodeId}::uuid IS NOT NULL
          AND node.id = ${input.versionNodeId}::uuid
          AND node.user_id = ${userId}::uuid
          AND node.branch_id = ${branchId}::uuid
        UNION ALL
        SELECT parent.id, parent.parent_node_id, child.depth + 1
        FROM version_nodes AS parent
        INNER JOIN ancestors AS child ON parent.id = child.parent_node_id
        WHERE parent.user_id = ${userId}::uuid
          AND parent.branch_id = ${branchId}::uuid
      ),
      documents AS (
        SELECT document.*,
          CASE
            WHEN ${input.versionNodeId}::uuid IS NULL THEN 0
            ELSE ancestor.depth
          END AS version_depth
        FROM search_documents AS document
        LEFT JOIN ancestors AS ancestor ON ancestor.id = document.version_node_id
        WHERE document.user_id = ${userId}::uuid
          AND document.work_id = ${workId}::uuid
          AND document.branch_id = ${branchId}::uuid
          AND document.source_id = ANY(${sql.param(sourceIds)}::uuid[])
          AND (${input.versionNodeId}::uuid IS NULL OR ancestor.id IS NOT NULL)
      ),
      current_documents AS (
        SELECT document.*,
          row_number() OVER (
            PARTITION BY document.source_type, document.source_id
            ORDER BY document.version_depth ASC, document.created_at DESC,
              document.version_node_id DESC
          ) AS current_rank
        FROM documents AS document
      )
      SELECT
        document.source_type,
        document.source_id,
        document.entity_type,
        document.title,
        document.content,
        document.branch_id,
        document.version_node_id,
        document.object_version,
        document.source_chapter_id,
        chapter.number AS chapter_number,
        chapter.title AS chapter_title,
        document.from_chapter,
        document.to_chapter,
        document.from_era,
        document.from_story_time_label,
        document.from_story_sort_key,
        document.to_era,
        document.to_story_time_label,
        document.to_story_sort_key,
        count(*) OVER (PARTITION BY lower(document.title)) AS same_name_count
      FROM current_documents AS document
      LEFT JOIN chapters AS chapter ON chapter.id = document.source_chapter_id
      WHERE document.current_rank = 1
        AND document.from_chapter <= ${input.chapterNumber}
        AND (document.to_chapter IS NULL OR document.to_chapter >= ${input.chapterNumber})
        AND (
          ${storyTime?.sortKey ?? null}::integer IS NULL
          OR document.from_story_sort_key IS NULL
          OR (
            document.from_story_sort_key <= ${storyTime?.sortKey ?? null}::integer
            AND (
              document.to_story_sort_key IS NULL
              OR document.to_story_sort_key >= ${storyTime?.sortKey ?? null}::integer
            )
          )
        )
    `);
    return result.rows as unknown as DocumentRow[];
  }

  private toResult(row: SearchRow): RetrievalResult {
    return {
      id: row.source_id,
      sourceKind: row.source_type,
      matchKind: row.match_kind,
      score: Number(row.score),
      label: row.title,
      canonicalName: row.title,
      entityType: row.entity_type,
      summary: this.summaryFor(row.source_type, row.content, row.match_field, row.title),
      source: this.domainRef(row, row.source_type, row.source_id, row.title),
      validity: {
        fromChapter: row.from_chapter,
        toChapter: row.to_chapter,
        fromStoryTime: storyTimeFrom(
          row.from_era,
          row.from_story_time_label,
          row.from_story_sort_key,
        ),
        toStoryTime: storyTimeFrom(row.to_era, row.to_story_time_label, row.to_story_sort_key),
      },
      sourceChapter: chapterRef(row),
      matchedTerm: row.matched_term,
      matchedField: row.match_field,
      relationshipPath: [],
      disambiguation: {
        sameNameCount: Number(row.same_name_count),
        key: `${row.source_type}:${row.title}`,
      },
    };
  }

  private toRelationshipResult(
    row: DocumentRow,
    path: RetrievalRelationshipHop[],
    depth: number,
  ): RetrievalResult {
    return {
      id: row.source_id,
      sourceKind: row.source_type,
      matchKind: "relationship",
      score: Math.max(0.2, 0.55 - depth * 0.15),
      label: row.title,
      canonicalName: row.title,
      entityType: row.entity_type,
      summary: this.summaryFor(row.source_type, row.content, "relationship", row.title),
      source: this.domainRef(row, row.source_type, row.source_id, row.title),
      validity: {
        fromChapter: row.from_chapter,
        toChapter: row.to_chapter,
        fromStoryTime: storyTimeFrom(
          row.from_era,
          row.from_story_time_label,
          row.from_story_sort_key,
        ),
        toStoryTime: storyTimeFrom(row.to_era, row.to_story_time_label, row.to_story_sort_key),
      },
      sourceChapter: chapterRef(row),
      matchedTerm: path[0]?.relationType ?? "relationship",
      matchedField: "relationship",
      relationshipPath: path,
      disambiguation: {
        sameNameCount: Number(row.same_name_count),
        key: `${row.source_type}:${row.title}`,
      },
    };
  }

  private domainRef(
    row: SearchRow | DocumentRow,
    type: string,
    id: string,
    label: string,
  ): DomainRef {
    return {
      type: domainRefType(type, row.entity_type),
      id,
      branchId: row.branch_id,
      label,
      version: {
        branchId: row.branch_id,
        versionNodeId: row.version_node_id,
        objectVersion: row.object_version,
      },
    };
  }

  private summaryFor(
    sourceType: SearchRow["source_type"],
    content: string,
    matchField: RetrievalResult["matchedField"],
    title: string,
  ): string {
    const normalized = content.trim();
    if (normalized) {
      return normalized.length > 500 ? `${normalized.slice(0, 500)}…` : normalized;
    }
    if (matchField === "relationship") {
      return `与「${title}」存在实体图关系。`;
    }
    if (sourceType === "fact") {
      return `来源事实：${title}`;
    }
    if (sourceType === "timeline_event") {
      return `故事时间线事件：${title}`;
    }
    if (sourceType === "map_node") {
      return `地图节点：${title}`;
    }
    return `设定实体：${title}`;
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

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function neighborOf(edge: RelationshipRow, currentId: string): GraphNode | undefined {
  if (edge.source_id === currentId) {
    return {
      id: edge.target_id,
      type: edge.target_type,
      label: edge.target_label ?? edge.target_id,
    };
  }
  if (edge.target_id === currentId) {
    return {
      id: edge.source_id,
      type: edge.source_type,
      label: edge.source_type === "character" ? "人物" : "势力",
    };
  }
  return undefined;
}

function relationshipHop(
  edge: RelationshipRow,
  current: GraphNode,
  neighbor: GraphNode,
  branchId: string,
): RetrievalRelationshipHop {
  const direction = edge.source_id === current.id ? "outgoing" : "incoming";
  const from =
    direction === "outgoing"
      ? {
          type: domainRefType(current.type, null),
          id: current.id,
          branchId,
          label: current.label,
          version: null,
        }
      : {
          type: domainRefType(neighbor.type, null),
          id: neighbor.id,
          branchId,
          label: neighbor.label,
          version: null,
        };
  const to =
    direction === "outgoing"
      ? {
          type: domainRefType(neighbor.type, null),
          id: neighbor.id,
          branchId,
          label: neighbor.label,
          version: null,
        }
      : {
          type: domainRefType(current.type, null),
          id: current.id,
          branchId,
          label: current.label,
          version: null,
        };
  return {
    relationId: edge.relation_id,
    relationType: edge.relation_type,
    direction,
    from,
    to,
  };
}

function sourceRefType(result: RetrievalResult): string {
  if (result.sourceKind === "entity" && result.entityType) {
    return result.entityType;
  }
  return result.sourceKind;
}

function domainRefType(type: string, entityType: SettingEntityType | null): DomainRef["type"] {
  if (type === "entity" && entityType) {
    return entityType;
  }
  if (type === "character" || type === "faction" || type === "map" || type === "item") {
    return type;
  }
  if (
    type === "map_node" ||
    type === "timeline_event" ||
    type === "fact" ||
    type === "world_rule" ||
    type === "power_system" ||
    type === "golden_finger"
  ) {
    return type;
  }
  return "map";
}

function chapterRef(row: SearchRow | DocumentRow) {
  if (!row.source_chapter_id || row.chapter_number === null) {
    return null;
  }
  return {
    chapterId: row.source_chapter_id,
    number: row.chapter_number,
    title: row.chapter_title ?? `第 ${row.chapter_number} 章`,
  };
}

function storyTimeFrom(
  era: string | null,
  label: string | null,
  sortKey: number | null,
): StoryTimePoint | null {
  if (!era || !label || sortKey === null) {
    return null;
  }
  return { era, label, sortKey };
}
