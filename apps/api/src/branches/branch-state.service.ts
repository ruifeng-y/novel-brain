import { HttpStatus, Injectable } from '@nestjs/common';
import {
  branchCommits,
  branchIdMappings,
  chapterVersions,
  workBranches,
  works,
  type WorkBranchRow,
} from '@novel/db';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { branchesError } from './branches.errors';

export type BranchDatabase = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

const CLONE_TABLES = [
  'story_bibles',
  'entities',
  'entity_custom_fields',
  'entity_relations',
  'character_profiles',
  'character_states',
  'character_state_revisions',
  'power_system_profiles',
  'golden_fingers',
  'item_technique_profiles',
  'item_ownerships',
  'timeline_eras',
  'timeline_event_nodes',
  'chapter_outlines',
  'chapters',
  'chapter_versions',
  'fact_proposals',
  'facts',
  'canon_commits',
  'canon_snapshots',
  'story_bible_revisions',
  'threads',
  'foreshadows',
  'character_arcs',
  'map_nodes',
  'map_connections',
  'map_images',
  'map_markers',
  'character_presences',
] as const;

export type BranchStateCloneTable = (typeof CLONE_TABLES)[number];

const EXTERNAL_REFERENCE_TABLES = new Set(['users', 'model_configs', 'works']);
const SELF_REFERENCING_TABLES = new Set(['timeline_event_nodes', 'chapter_outlines', 'map_nodes']);

type ForeignKey = {
  tableName: string;
  columnName: string;
  referenceTable: string;
};

type CloneRow = Record<string, unknown> & { id: string };

const raw = (value: string) => sql.raw(`"${value}"`);

export type ResolvedRequestBranch = {
  branchId: string;
  forkBranchId: string;
  idMap: Map<string, string>;
};

@Injectable()
export class BranchStateService {
  private foreignKeysPromise: Promise<Map<string, ForeignKey[]>> | null = null;

  constructor(private readonly database: DatabaseService) {}

  async snapshotVersion(
    userId: string,
    workId: string,
    sourceBranchId: string,
    chapterVersionId: string,
  ): Promise<void> {
    const [existing] = await this.database.db
      .select({ id: branchCommits.id })
      .from(branchCommits)
      .where(eq(branchCommits.chapterVersionId, chapterVersionId))
      .limit(1);
    if (existing) {
      return;
    }

    const [version] = await this.database.db
      .select({ version: chapterVersions })
      .from(chapterVersions)
      .innerJoin(workBranches, eq(workBranches.id, sourceBranchId))
      .where(eq(chapterVersions.id, chapterVersionId))
      .limit(1);
    if (!version) {
      throw branchesError(
        HttpStatus.NOT_FOUND,
        'VERSION_POINT_NOT_FOUND',
        'The selected version point is not available',
      );
    }

    const effectiveSourceId = await this.effectiveReadBranchId(sourceBranchId);
    const now = new Date();
    await this.database.db.transaction(async (tx) => {
      const [snapshotBranch] = await tx
        .insert(workBranches)
        .values({
          workId,
          name: `snapshot-${chapterVersionId}`,
          isMain: false,
          isSnapshot: true,
          parentBranchId: sourceBranchId,
          kind: 'experiment',
          reason: `版本点快照 ${chapterVersionId}`,
          forkPointKind: 'chapter_version',
          forkChapterVersionId: chapterVersionId,
          baselineMaterializedAt: now,
          status: 'active',
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.cloneBranchRows(tx, workId, effectiveSourceId, snapshotBranch.id, false);
      await tx.insert(branchCommits).values({
        workId,
        sourceBranchId,
        snapshotBranchId: snapshotBranch.id,
        chapterVersionId,
        message: `保存第 ${version.version.version} 版正文后的完整状态`,
        createdBy: userId,
        createdAt: now,
      });
    });
  }

  async effectiveReadBranchId(branchId: string): Promise<string> {
    const [branch] = await this.database.db
      .select()
      .from(workBranches)
      .where(eq(workBranches.id, branchId))
      .limit(1);
    if (!branch) {
      return branchId;
    }
    if (branch.stateBranchId) {
      return branch.stateBranchId;
    }
    return branch.baselineBranchId && !branch.baselineMaterializedAt
      ? branch.baselineBranchId
      : branch.id;
  }

  async resolveSnapshotBranchId(commitId: string, initialBranchId: string): Promise<string> {
    let branchId = initialBranchId;
    let cursor = commitId;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [branch] = await this.database.db
        .select({ isSnapshot: workBranches.isSnapshot })
        .from(workBranches)
        .where(eq(workBranches.id, branchId))
        .limit(1);
      if (branch?.isSnapshot) {
        return branchId;
      }

      const [commit] = await this.database.db
        .select({
          parentCommitId: branchCommits.parentCommitId,
          snapshotBranchId: branchCommits.snapshotBranchId,
        })
        .from(branchCommits)
        .where(eq(branchCommits.id, cursor))
        .limit(1);
      if (!commit?.parentCommitId) {
        return branchId;
      }
      cursor = commit.parentCommitId;
      branchId = commit.snapshotBranchId;
    }
    return branchId;
  }

  async logicalBranchId(branchId: string): Promise<string> {
    const [owner] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(eq(workBranches.stateBranchId, branchId))
      .limit(1);
    if (owner) {
      return owner.id;
    }
    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(eq(workBranches.id, branchId))
      .limit(1);
    return branch?.id ?? branchId;
  }

  async resolveRequestBranch(
    branchId: string,
    method: string,
    path: string,
    userId: string,
  ): Promise<ResolvedRequestBranch> {
    const [row] = await this.database.db
      .select({ branch: workBranches })
      .from(workBranches)
      .innerJoin(works, eq(works.id, workBranches.workId))
      .where(and(eq(workBranches.id, branchId), eq(works.userId, userId)))
      .limit(1);
    const branch = row?.branch;
    if (!branch) {
      return {
        branchId,
        forkBranchId: branchId,
        idMap: await this.loadIdMap(branchId),
      };
    }
    if (branch.stateBranchId) {
      return {
        branchId: branch.stateBranchId,
        forkBranchId: branch.id,
        idMap: await this.loadIdMap(branch.stateBranchId),
      };
    }
    if (!branch.baselineBranchId || branch.baselineMaterializedAt) {
      return {
        branchId,
        forkBranchId: branchId,
        idMap: await this.loadIdMap(branchId),
      };
    }

    const readOnlyRequest =
      method === 'GET' ||
      method === 'HEAD' ||
      path.endsWith('/compare') ||
      path.endsWith('/cherry-pick');
    if (readOnlyRequest) {
      return { branchId: branch.baselineBranchId, forkBranchId: branchId, idMap: new Map() };
    }

    await this.materialize(branch.id);
    return {
      branchId: branch.id,
      forkBranchId: branch.id,
      idMap: await this.loadIdMap(branch.id),
    };
  }

  async materialize(branchId: string): Promise<WorkBranchRow> {
    return this.database.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${branchId}))`);
      const [branch] = await tx
        .select()
        .from(workBranches)
        .where(eq(workBranches.id, branchId))
        .limit(1);
      if (!branch) {
        throw branchesError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
      }
      if (!branch.baselineBranchId || branch.baselineMaterializedAt) {
        return branch;
      }

      const now = new Date();
      await this.cloneBranchRows(tx, branch.workId, branch.baselineBranchId, branch.id, true);
      const [updated] = await tx
        .update(workBranches)
        .set({ baselineMaterializedAt: now, updatedAt: now })
        .where(eq(workBranches.id, branch.id))
        .returning();
      return updated;
    });
  }

  async loadIdMap(forkBranchId: string): Promise<Map<string, string>> {
    const rows = await this.database.db
      .select({ sourceId: branchIdMappings.sourceId, targetId: branchIdMappings.targetId })
      .from(branchIdMappings)
      .where(eq(branchIdMappings.forkBranchId, forkBranchId));
    return new Map(rows.map((row) => [row.sourceId, row.targetId]));
  }

  remapValue<T>(value: T, idMap: Map<string, string>): T {
    if (idMap.size === 0) {
      return value;
    }
    if (typeof value === 'string') {
      return (idMap.get(value) ?? value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.remapValue(item, idMap)) as T;
    }
    if (value && typeof value === 'object') {
      const next: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        next[key] = this.remapValue(item, idMap);
      }
      return next as T;
    }
    return value;
  }

  async cloneBranchRows(
    tx: BranchDatabase,
    workId: string,
    sourceBranchId: string,
    targetBranchId: string,
    recordMappings: boolean,
    tables: readonly BranchStateCloneTable[] = CLONE_TABLES,
  ): Promise<void> {
    const foreignKeys = await this.loadForeignKeys();
    const sourceRows = new Map<string, CloneRow[]>();
    const idMaps = new Map<string, Map<string, string>>();

    for (const table of tables) {
      const result =
        table === 'chapter_versions'
          ? await tx.execute(
              sql`select row_to_json(version_row) as row
                  from chapter_versions version_row
                  join chapters chapter_row on chapter_row.id = version_row.chapter_id
                  where chapter_row.branch_id = ${sourceBranchId}`,
            )
          : await tx.execute(
              sql`select row_to_json(t) as row from ${raw(table)} t where t.branch_id = ${sourceBranchId}`,
            );
      const rows = (result.rows as Array<{ row: CloneRow }>).map((row) => row.row);
      sourceRows.set(table, rows);
      idMaps.set(table, new Map(rows.map((row) => [row.id, randomUUID()])));
    }

    for (const table of tables) {
      const rows = sourceRows.get(table) ?? [];
      if (rows.length === 0) {
        continue;
      }
      const tableForeignKeys = foreignKeys.get(table) ?? [];
      const transformed = rows.map((sourceRow) => {
        const row = structuredClone(sourceRow);
        row.id = idMaps.get(table)?.get(sourceRow.id) ?? randomUUID();
        if ('branch_id' in row) {
          row.branch_id = targetBranchId;
        }
        if ('work_id' in row) {
          row.work_id = workId;
        }

        for (const foreignKey of tableForeignKeys) {
          if (foreignKey.columnName === 'branch_id') {
            continue;
          }
          const value = row[foreignKey.columnName];
          if (typeof value !== 'string' || !value) {
            continue;
          }
          if (foreignKey.referenceTable === table) {
            row[foreignKey.columnName] = null;
            continue;
          }
          if (tables.includes(foreignKey.referenceTable as BranchStateCloneTable)) {
            row[foreignKey.columnName] = idMaps.get(foreignKey.referenceTable)?.get(value) ?? null;
            continue;
          }
          if (!EXTERNAL_REFERENCE_TABLES.has(foreignKey.referenceTable)) {
            row[foreignKey.columnName] = null;
          }
        }

        if (table === 'chapters' && typeof row.current_version_id === 'string') {
          row.current_version_id =
            idMaps.get('chapter_versions')?.get(row.current_version_id) ?? null;
        }
        if (table === 'canon_commits' && typeof row.snapshot_id === 'string') {
          row.snapshot_id = idMaps.get('canon_snapshots')?.get(row.snapshot_id) ?? null;
        }
        if (table === 'threads' && Array.isArray(row.participant_ids)) {
          row.participant_ids = row.participant_ids.map(
            (id) => idMaps.get('entities')?.get(String(id)) ?? id,
          );
        }
        return row;
      });

      await tx.execute(
        sql`insert into ${raw(table)} select * from jsonb_populate_recordset(null::${raw(table)}, ${JSON.stringify(transformed)}::jsonb)`,
      );
    }

    for (const table of SELF_REFERENCING_TABLES) {
      if (!tables.includes(table as BranchStateCloneTable)) {
        continue;
      }
      const rows = sourceRows.get(table) ?? [];
      const tableForeignKeys = (foreignKeys.get(table) ?? []).filter(
        (foreignKey) => foreignKey.referenceTable === table,
      );
      for (const sourceRow of rows) {
        const targetId = idMaps.get(table)?.get(sourceRow.id);
        if (!targetId) {
          continue;
        }
        for (const foreignKey of tableForeignKeys) {
          const sourceReference = sourceRow[foreignKey.columnName];
          if (typeof sourceReference !== 'string') {
            continue;
          }
          const targetReference = idMaps.get(table)?.get(sourceReference) ?? null;
          await tx.execute(
            sql`update ${raw(table)} set ${raw(foreignKey.columnName)} = ${targetReference} where id = ${targetId} and branch_id = ${targetBranchId}`,
          );
        }
      }
    }

    if (recordMappings) {
      for (const table of tables) {
        const rows = sourceRows.get(table) ?? [];
        for (const sourceRow of rows) {
          const targetId = idMaps.get(table)?.get(sourceRow.id);
          if (!targetId) {
            continue;
          }
          await tx.insert(branchIdMappings).values({
            forkBranchId: targetBranchId,
            tableName: table,
            sourceId: sourceRow.id,
            targetId,
          });
        }
      }
    }
  }

  private async loadForeignKeys(): Promise<Map<string, ForeignKey[]>> {
    if (!this.foreignKeysPromise) {
      this.foreignKeysPromise = this.database.pool
        .query<ForeignKey>(
          `select
             conrelid::regclass::text as "tableName",
             attribute.attname as "columnName",
             confrelid::regclass::text as "referenceTable"
           from pg_constraint constraint_row
           join lateral unnest(constraint_row.conkey) with ordinality as key(attnum, ordinality)
             on true
           join pg_attribute attribute
             on attribute.attrelid = constraint_row.conrelid
            and attribute.attnum = key.attnum
           where constraint_row.contype = 'f'`,
        )
        .then((result) => {
          const map = new Map<string, ForeignKey[]>();
          for (const row of result.rows) {
            const tableName = row.tableName.replace(/^public\./, '');
            const referenceTable = row.referenceTable.replace(/^public\./, '');
            map.set(tableName, [
              ...(map.get(tableName) ?? []),
              { ...row, tableName, referenceTable },
            ]);
          }
          return map;
        });
    }
    return this.foreignKeysPromise;
  }
}
