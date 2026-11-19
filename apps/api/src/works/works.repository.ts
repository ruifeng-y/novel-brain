import { createHash } from "node:crypto";

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapterVersions,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  foreshadows,
  genrePacks,
  idempotencyRecords,
  modelConfigs,
  outlineNodes,
  qualityReports,
  storyBibles,
  versionNodes,
  volumeContracts,
  workBranches,
  workExportReceipts,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type {
  CursorPageQuery,
  ImportCandidateType,
  WorkGenre,
  WorkListQuery,
  WorkUpdateRequest,
} from "@novel-brain/contracts";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { toCursorPage, type CursorPageResult } from "../common/cursor-page";

export type WorkRecord = InferSelectModel<typeof works>;
export type WorkBranchRecord = InferSelectModel<typeof workBranches>;
export type GenrePackRecord = InferSelectModel<typeof genrePacks>;
export interface WorkListRow {
  work: WorkRecord;
  metrics: {
    totalWordCount: number;
    progress: {
      writtenChapters: number;
      plannedChapters: number;
      percent: number;
    };
    qualityScore: number | null;
    unrecoveredForeshadowCount: number;
    lastEditedAt: Date;
  };
}
type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
type CopyRow = Record<string, unknown>;
const COPY_JSON_COLUMNS = new Set([
  "settings",
  "tags",
  "cards",
  "readiness",
  "exceptions",
  "aliases",
  "attributes",
  "options",
  "value",
  "snapshot",
  "payload",
  "evidence",
  "turning_points",
  "exit_conditions",
  "plot_lines",
  "beats",
  "information_releases",
  "prerequisite_event_ids",
  "history",
  "related_character_ids",
  "related_faction_ids",
]);

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function selectCopyRows(
  transaction: DatabaseTransaction,
  table: string,
  userId: string,
  workId: string,
  branchId: string,
): Promise<CopyRow[]> {
  const result = await transaction.execute(
    sql`SELECT * FROM ${sql.raw(quotedIdentifier(table))}
        WHERE user_id = ${userId}
          AND work_id = ${workId}
          AND branch_id = ${branchId}`,
  );
  return (result as unknown as { rows: CopyRow[] }).rows;
}

async function insertCopyRow(
  transaction: DatabaseTransaction,
  table: string,
  row: CopyRow,
): Promise<void> {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => sql.raw(quotedIdentifier(column)));
  const values = entries.map(([column, value]) =>
    value !== null &&
    (COPY_JSON_COLUMNS.has(column) || (typeof value === "object" && !(value instanceof Date)))
      ? sql`${JSON.stringify(value)}::jsonb`
      : sql`${value}`,
  );
  await transaction.execute(
    sql`INSERT INTO ${sql.raw(quotedIdentifier(table))}
        (${sql.join(columns, sql.raw(", "))})
        VALUES (${sql.join(values, sql.raw(", "))})`,
  );
}

interface CopyEntityGraphInput {
  transaction: DatabaseTransaction;
  input: {
    userId: string;
    sourceWorkId: string;
    sourceBranchId: string;
    workId: string;
    branchId: string;
    rootNodeId: string;
    copiedStoryBibleId: string | null;
  };
  sourceEntities: Array<{ id: string; type: string }>;
  entityIdMap: Map<string, string>;
}

async function copyEntityGraph({
  transaction,
  input,
  sourceEntities,
  entityIdMap,
}: CopyEntityGraphInput): Promise<{
  mapNode: Map<string, string>;
  timelineEvent: Map<string, string>;
  versionNode: Map<string, string>;
}> {
  const versionNodeMap = new Map<string, string>();
  let headNodeId = input.rootNodeId;

  const cloneVersionNode = async (
    sourceVersionNodeId: string,
    nodeType: string,
    objectType: string,
    objectId: string,
    snapshotId: string | null = null,
  ): Promise<string> => {
    const mapped = versionNodeMap.get(sourceVersionNodeId);
    if (mapped) {
      return mapped;
    }
    const sourceResult = await transaction.execute(
      sql`SELECT * FROM version_nodes WHERE id = ${sourceVersionNodeId} LIMIT 1`,
    );
    const source = (sourceResult as unknown as { rows: CopyRow[] }).rows[0];
    if (!source) {
      throw new Error(`Missing source version node ${sourceVersionNodeId}`);
    }
    const newId = uuidv7();
    await insertCopyRow(transaction, "version_nodes", {
      id: newId,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      parent_node_id: headNodeId,
      node_type: nodeType,
      snapshot_id: snapshotId,
      object_type: objectType,
      object_id: objectId,
      object_version: source.object_version ?? 1,
      payload: { ...(source.payload as Record<string, unknown>), copiedFrom: source.id },
      actor_id: input.userId,
      message: "复制作品",
      created_at: new Date(),
    });
    versionNodeMap.set(sourceVersionNodeId, newId);
    headNodeId = newId;
    return newId;
  };

  const mapId = (map: Map<string, string>, sourceId: unknown, label: string): string => {
    if (typeof sourceId !== "string") {
      throw new Error(`Missing ${label} reference`);
    }
    const mapped = map.get(sourceId);
    if (!mapped) {
      throw new Error(`Missing ${label} mapping for ${sourceId}`);
    }
    return mapped;
  };
  const optionalId = (map: Map<string, string>, sourceId: unknown): string | null =>
    typeof sourceId === "string" ? (map.get(sourceId) ?? null) : null;
  const mapDomainId = (
    type: unknown,
    sourceId: unknown,
    maps: {
      mapNode: Map<string, string>;
    },
  ): string | null => {
    if (typeof sourceId !== "string") {
      return null;
    }
    if (type === "map_node") {
      return maps.mapNode.get(sourceId) ?? null;
    }
    return entityIdMap.get(sourceId) ?? null;
  };
  if (input.copiedStoryBibleId) {
    const storyBibleVersionIds = new Map<string, string>();
    for (const row of await selectCopyRows(
      transaction,
      "story_bible_versions",
      input.userId,
      input.sourceWorkId,
      input.sourceBranchId,
    )) {
      const newId = uuidv7();
      const newNodeId = await cloneVersionNode(
        String(row.version_node_id),
        "story_bible_version",
        "story_bible",
        input.copiedStoryBibleId,
        newId,
      );
      storyBibleVersionIds.set(String(row.id), newId);
      await insertCopyRow(transaction, "story_bible_versions", {
        ...row,
        id: newId,
        story_bible_id: input.copiedStoryBibleId,
        work_id: input.workId,
        branch_id: input.branchId,
        user_id: input.userId,
        version_node_id: newNodeId,
        created_by: input.userId,
      });
    }
    for (const row of await selectCopyRows(
      transaction,
      "story_bible_world_rules",
      input.userId,
      input.sourceWorkId,
      input.sourceBranchId,
    )) {
      const mappedVersionId = optionalId(storyBibleVersionIds, row.story_bible_version_id);
      if (!mappedVersionId) {
        continue;
      }
      await insertCopyRow(transaction, "story_bible_world_rules", {
        ...row,
        id: uuidv7(),
        story_bible_version_id: mappedVersionId,
        story_bible_id: input.copiedStoryBibleId,
        work_id: input.workId,
        branch_id: input.branchId,
        user_id: input.userId,
      });
    }
  }

  const customFieldDefinitionIds = new Map<string, string>();
  for (const row of await selectCopyRows(
    transaction,
    "custom_field_definitions",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    customFieldDefinitionIds.set(String(row.id), newId);
    await insertCopyRow(transaction, "custom_field_definitions", {
      ...row,
      id: newId,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "custom_field_values",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    await insertCopyRow(transaction, "custom_field_values", {
      ...row,
      id: uuidv7(),
      field_definition_id: mapId(
        customFieldDefinitionIds,
        row.field_definition_id,
        "custom field definition",
      ),
      entity_id: mapId(entityIdMap, row.entity_id, "entity"),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
    });
  }

  for (const row of await selectCopyRows(
    transaction,
    "entity_versions",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newEntityId = mapId(entityIdMap, row.entity_id, "entity");
    const newVersionId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "setting",
      newEntityId,
      newVersionId,
    );
    await insertCopyRow(transaction, "entity_versions", {
      ...row,
      id: newVersionId,
      entity_id: newEntityId,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }

  for (const [table, entityColumn] of [
    ["character_profiles", "entity_id"],
    ["faction_profiles", "entity_id"],
    ["special_mechanisms", "entity_id"],
    ["item_techniques", "entity_id"],
    ["power_systems", "entity_id"],
    ["timeline_events", "id"],
  ] as const) {
    for (const row of await selectCopyRows(
      transaction,
      table,
      input.userId,
      input.sourceWorkId,
      input.sourceBranchId,
    )) {
      const sourceEntityId = table === "timeline_events" ? row.id : row[entityColumn];
      await insertCopyRow(transaction, table, {
        ...row,
        ...(table === "timeline_events" ? {} : { [entityColumn]: null }),
        [entityColumn]: mapId(entityIdMap, sourceEntityId, "entity"),
        work_id: input.workId,
        branch_id: input.branchId,
        user_id: input.userId,
        ...(table === "timeline_events" ? { created_by: input.userId } : {}),
        ...(table === "special_mechanisms"
          ? {
              owner_id: mapDomainId(row.owner_type, row.owner_id, { mapNode: new Map() }),
              power_system_id: mapDomainId("power_system", row.power_system_id, {
                mapNode: new Map(),
              }),
            }
          : {}),
        ...(table === "item_techniques"
          ? {
              equipped_by_id: mapDomainId(row.equipped_by_type, row.equipped_by_id, {
                mapNode: new Map(),
              }),
            }
          : {}),
      });
    }
  }

  const powerPathIds = new Map<string, string>();
  const powerRealmIds = new Map<string, string>();
  for (const row of await selectCopyRows(
    transaction,
    "power_paths",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "power_path",
      newId,
    );
    powerPathIds.set(String(row.id), newId);
    await insertCopyRow(transaction, "power_paths", {
      ...row,
      id: newId,
      power_system_id: mapId(entityIdMap, row.power_system_id, "power system"),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  const sourcePowerRealms = await selectCopyRows(
    transaction,
    "power_realms",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  );
  for (const row of sourcePowerRealms) {
    powerRealmIds.set(String(row.id), uuidv7());
  }
  for (const row of sourcePowerRealms) {
    const newId = mapId(powerRealmIds, row.id, "power realm");
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "power_realm",
      newId,
    );
    await insertCopyRow(transaction, "power_realms", {
      ...row,
      id: newId,
      path_id: mapId(powerPathIds, row.path_id, "power path"),
      prerequisite_realm_id: optionalId(powerRealmIds, row.prerequisite_realm_id),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "power_systems",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const mappedPath = optionalId(powerPathIds, row.lifespan_path_id);
    if (mappedPath) {
      await transaction.execute(
        sql`UPDATE power_systems SET lifespan_path_id = ${mappedPath}
            WHERE work_id = ${input.workId} AND entity_id = ${mapId(
              entityIdMap,
              row.entity_id,
              "power system",
            )}`,
      );
    }
  }

  const mapLayerIds = new Map<string, string>();
  for (const row of await selectCopyRows(
    transaction,
    "map_layers",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    mapLayerIds.set(String(row.id), uuidv7());
  }
  for (const row of await selectCopyRows(
    transaction,
    "map_layers",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = mapId(mapLayerIds, row.id, "map layer");
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "map_layer",
      newId,
    );
    await insertCopyRow(transaction, "map_layers", {
      ...row,
      id: newId,
      map_id: mapId(entityIdMap, row.map_id, "map"),
      parent_layer_id: optionalId(mapLayerIds, row.parent_layer_id),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }

  const mapNodeIds = new Map<string, string>();
  for (const row of await selectCopyRows(
    transaction,
    "map_nodes",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    mapNodeIds.set(String(row.id), uuidv7());
  }
  for (const row of await selectCopyRows(
    transaction,
    "map_nodes",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = mapId(mapNodeIds, row.id, "map node");
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "map_node",
      newId,
    );
    await insertCopyRow(transaction, "map_nodes", {
      ...row,
      id: newId,
      map_id: mapId(entityIdMap, row.map_id, "map"),
      layer_id: optionalId(mapLayerIds, row.layer_id),
      parent_node_id: optionalId(mapNodeIds, row.parent_node_id),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }

  for (const row of await selectCopyRows(
    transaction,
    "map_edges",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "map_edge",
      newId,
    );
    await insertCopyRow(transaction, "map_edges", {
      ...row,
      id: newId,
      map_id: mapId(entityIdMap, row.map_id, "map"),
      layer_id: optionalId(mapLayerIds, row.layer_id),
      from_node_id: mapId(mapNodeIds, row.from_node_id, "map node"),
      to_node_id: mapId(mapNodeIds, row.to_node_id, "map node"),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "map_markers",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "map_marker",
      newId,
    );
    await insertCopyRow(transaction, "map_markers", {
      ...row,
      id: newId,
      map_id: mapId(entityIdMap, row.map_id, "map"),
      layer_id: optionalId(mapLayerIds, row.layer_id),
      node_id: optionalId(mapNodeIds, row.node_id),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }

  const timelineEventIds = new Map<string, string>();
  for (const entity of sourceEntities) {
    if (entity.type === "timeline_event") {
      timelineEventIds.set(entity.id, mapId(entityIdMap, entity.id, "timeline event"));
    }
  }
  const timelineEraIds = new Map<string, string>();
  for (const row of await selectCopyRows(
    transaction,
    "timeline_eras",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "timeline_era",
      newId,
    );
    timelineEraIds.set(String(row.id), newId);
    await insertCopyRow(transaction, "timeline_eras", {
      ...row,
      id: newId,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }

  const itemIds = new Map<string, string>();
  for (const entity of sourceEntities) {
    if (entity.type === "item") {
      itemIds.set(entity.id, mapId(entityIdMap, entity.id, "item"));
    }
  }
  const mapContext = { mapNode: mapNodeIds };
  for (const row of await selectCopyRows(
    transaction,
    "character_relationships",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "character_relationship",
      newId,
    );
    await insertCopyRow(transaction, "character_relationships", {
      ...row,
      id: newId,
      source_character_id: mapId(entityIdMap, row.source_character_id, "character"),
      target_id: mapDomainId(row.target_type, row.target_id, mapContext),
      source_chapter_id: null,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "faction_relationships",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "faction_relationship",
      newId,
    );
    await insertCopyRow(transaction, "faction_relationships", {
      ...row,
      id: newId,
      source_faction_id: mapId(entityIdMap, row.source_faction_id, "faction"),
      target_id: mapId(entityIdMap, row.target_id, "relationship target"),
      source_chapter_id: null,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "character_state_transitions",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "character_state",
      newId,
    );
    await insertCopyRow(transaction, "character_state_transitions", {
      ...row,
      id: newId,
      character_id: mapId(entityIdMap, row.character_id, "character"),
      target_id: mapDomainId(row.target_type, row.target_id, mapContext),
      source_chapter_id: null,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "character_itineraries",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "character_itinerary",
      newId,
    );
    await insertCopyRow(transaction, "character_itineraries", {
      ...row,
      id: newId,
      character_id: mapId(entityIdMap, row.character_id, "character"),
      from_node_id: mapId(mapNodeIds, row.from_node_id, "map node"),
      to_node_id: mapId(mapNodeIds, row.to_node_id, "map node"),
      evidence: mapCopiedJson(row.evidence, {
        entity: entityIdMap,
        mapNode: mapNodeIds,
        timelineEvent: timelineEventIds,
        versionNode: versionNodeMap,
        branchId: input.branchId,
      }),
      source_chapter_id: null,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "map_control",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "map_control",
      newId,
    );
    await insertCopyRow(transaction, "map_control", {
      ...row,
      id: newId,
      faction_id: mapId(entityIdMap, row.faction_id, "faction"),
      map_id: mapId(entityIdMap, row.map_id, "map"),
      node_id: mapDomainId(row.node_type, row.node_id, mapContext),
      evidence: mapCopiedJson(row.evidence, {
        entity: entityIdMap,
        mapNode: mapNodeIds,
        timelineEvent: timelineEventIds,
        versionNode: versionNodeMap,
        branchId: input.branchId,
      }),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "mechanism_ownership_events",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "mechanism_ownership",
      newId,
    );
    await insertCopyRow(transaction, "mechanism_ownership_events", {
      ...row,
      id: newId,
      mechanism_id: mapId(entityIdMap, row.mechanism_id, "mechanism"),
      previous_owner_id: mapDomainId(row.previous_owner_type, row.previous_owner_id, mapContext),
      owner_id: mapId(entityIdMap, row.owner_id, "mechanism owner"),
      evidence: mapCopiedJson(row.evidence, {
        entity: entityIdMap,
        mapNode: mapNodeIds,
        timelineEvent: timelineEventIds,
        versionNode: versionNodeMap,
        branchId: input.branchId,
      }),
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }
  for (const row of await selectCopyRows(
    transaction,
    "item_rights",
    input.userId,
    input.sourceWorkId,
    input.sourceBranchId,
  )) {
    const newId = uuidv7();
    const newNodeId = await cloneVersionNode(
      String(row.version_node_id),
      "entity_version",
      "item_right",
      newId,
    );
    await insertCopyRow(transaction, "item_rights", {
      ...row,
      id: newId,
      item_id: mapId(itemIds, row.item_id, "item"),
      holder_id: mapId(entityIdMap, row.holder_id, "item holder"),
      evidence: mapCopiedJson(row.evidence, {
        entity: entityIdMap,
        mapNode: mapNodeIds,
        timelineEvent: timelineEventIds,
        versionNode: versionNodeMap,
        branchId: input.branchId,
      }),
      source_chapter_id: null,
      work_id: input.workId,
      branch_id: input.branchId,
      user_id: input.userId,
      version_node_id: newNodeId,
      created_by: input.userId,
    });
  }

  for (const table of ["plot_threads", "foreshadows", "character_arcs"] as const) {
    for (const row of await selectCopyRows(
      transaction,
      table,
      input.userId,
      input.sourceWorkId,
      input.sourceBranchId,
    )) {
      const newId = uuidv7();
      const newNodeId = await cloneVersionNode(
        String(row.version_node_id),
        "ledger_version",
        table,
        newId,
      );
      const sourceEvent = optionalId(timelineEventIds, row.source_event_id);
      const sourceChapter = optionalId(new Map(), row.source_chapter_id);
      const canKeepStatus =
        row.status === "planned" || sourceEvent !== null || sourceChapter !== null;
      await insertCopyRow(transaction, table, {
        ...row,
        id: newId,
        status: canKeepStatus ? row.status : "planned",
        source_event_id: sourceEvent,
        source_chapter_id: sourceChapter,
        prerequisite_event_ids: mapJsonIdArray(row.prerequisite_event_ids, timelineEventIds),
        related_character_ids:
          table === "foreshadows"
            ? mapJsonIdArray(row.related_character_ids, entityIdMap)
            : row.related_character_ids,
        related_faction_ids:
          table === "foreshadows"
            ? mapJsonIdArray(row.related_faction_ids, entityIdMap)
            : row.related_faction_ids,
        evidence: mapCopiedJson(row.evidence, {
          entity: entityIdMap,
          mapNode: mapNodeIds,
          timelineEvent: timelineEventIds,
          versionNode: versionNodeMap,
          branchId: input.branchId,
        }),
        history: mapCopiedJson(row.history, {
          entity: entityIdMap,
          mapNode: mapNodeIds,
          timelineEvent: timelineEventIds,
          versionNode: versionNodeMap,
          branchId: input.branchId,
        }),
        character_id:
          table === "character_arcs"
            ? mapId(entityIdMap, row.character_id, "arc character")
            : row.character_id,
        work_id: input.workId,
        branch_id: input.branchId,
        user_id: input.userId,
        version_node_id: newNodeId,
      });
    }
  }
  return {
    mapNode: mapNodeIds,
    timelineEvent: timelineEventIds,
    versionNode: versionNodeMap,
  };
}

function mapJsonIdArray(value: unknown, map: Map<string, string>): unknown {
  if (!Array.isArray(value)) {
    return value;
  }
  return value.map((item) => (typeof item === "string" ? (map.get(item) ?? item) : item));
}

function mapVersionNodeId(value: unknown, map: Map<string, string>): string | null {
  return typeof value === "string" ? (map.get(value) ?? null) : null;
}

interface CopiedJsonMapContext {
  entity: Map<string, string>;
  mapNode: Map<string, string>;
  timelineEvent: Map<string, string>;
  versionNode: Map<string, string>;
  branchId: string;
}

function mapCopiedJson(
  value: unknown,
  context: CopiedJsonMapContext,
  parentKey: string | null = null,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapCopiedJson(item, context, parentKey));
  }
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  const referenceType =
    typeof input.type === "string"
      ? input.type
      : typeof input.sourceType === "string"
        ? input.sourceType
        : typeof input.kind === "string"
          ? input.kind
          : null;
  for (const [key, item] of Object.entries(input)) {
    if (key === "branchId" || key === "povBranchId" || key === "locationBranchId") {
      output[key] = context.branchId;
      continue;
    }
    if (key === "versionNodeId" || key === "povVersionNodeId" || key === "locationVersionNodeId") {
      output[key] = mapVersionNodeId(item, context.versionNode);
      continue;
    }
    if ((key === "id" || key === "sourceId") && referenceType) {
      if (referenceType === "map_node") {
        output[key] = typeof item === "string" ? (context.mapNode.get(item) ?? null) : null;
      } else if (referenceType === "timeline_event" || referenceType === "event") {
        output[key] = typeof item === "string" ? (context.timelineEvent.get(item) ?? null) : null;
      } else if (
        [
          "character",
          "faction",
          "map",
          "power_system",
          "golden_finger",
          "item",
          "world_rule",
        ].includes(referenceType)
      ) {
        output[key] = typeof item === "string" ? (context.entity.get(item) ?? null) : null;
      } else if (
        ["chapter", "chapter_version", "chapter_text", "setting", "fact"].includes(referenceType)
      ) {
        output[key] = null;
      } else {
        output[key] = item;
      }
      continue;
    }
    if (
      key === "chapterId" ||
      key === "sourceChapterId" ||
      key === "chapterVersionId" ||
      key === "sourceVersionId"
    ) {
      output[key] = null;
      continue;
    }
    if (key === "eventId") {
      output[key] = typeof item === "string" ? (context.timelineEvent.get(item) ?? null) : null;
      continue;
    }
    if (key === "id" && parentKey === "chapter") {
      output[key] = null;
      continue;
    }
    output[key] = mapCopiedJson(item, context, key);
  }
  return output;
}

export interface WorksAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type WorkPurgePreview =
  | { status: "not_found" }
  | { status: "version_conflict" }
  | { status: "not_due" }
  | { status: "export_required" }
  | { status: "ready"; workId: string; objectKeys: string[] };

export type WorkTrashRestoreResult = "not_found" | "expired" | WorkRecord;

export interface InitialSettingEntity {
  type: ImportCandidateType;
  name: string;
  summary: string;
  description: string;
  tags: string[];
  attributes: Record<string, unknown>;
  importCandidateId: string;
}

export type WorkUpdateValues = Omit<WorkUpdateRequest, "version">;

@Injectable()
export class WorksRepository implements OnModuleDestroy {
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

  async list(
    userId: string,
    query: WorkListQuery,
  ): Promise<{ works: WorkListRow[]; nextCursor: string | null } | "invalid_cursor"> {
    return this.withTenant(userId, async (transaction) => {
      const mainBranchId = workBranches.id;
      const totalWordCount = sql<number>`coalesce((
        SELECT sum(main_chapter.word_count)::int
          FROM chapters main_chapter
         WHERE main_chapter.work_id = ${works.id}
           AND main_chapter.user_id = ${userId}
           AND main_chapter.branch_id = ${mainBranchId}
      ), 0)`;
      const writtenChapters = sql<number>`coalesce((
        SELECT count(*)::int
          FROM chapters written_chapter
         WHERE written_chapter.work_id = ${works.id}
           AND written_chapter.user_id = ${userId}
           AND written_chapter.branch_id = ${mainBranchId}
           AND written_chapter.word_count > 0
      ), 0)`;
      const plannedChapters = sql<number>`greatest(
        coalesce((
          SELECT count(*)::int
            FROM chapters planned_chapter
           WHERE planned_chapter.work_id = ${works.id}
             AND planned_chapter.user_id = ${userId}
             AND planned_chapter.branch_id = ${mainBranchId}
        ), 0),
        coalesce((
          SELECT count(DISTINCT outline_chapter.chapter_id)::int
            FROM outline_nodes outline_chapter
           WHERE outline_chapter.work_id = ${works.id}
             AND outline_chapter.user_id = ${userId}
             AND outline_chapter.branch_id = ${mainBranchId}
             AND outline_chapter.level = 'chapter'
             AND outline_chapter.chapter_id IS NOT NULL
        ), 0)
      )`;
      const progressPercent = sql<number>`CASE
        WHEN ${plannedChapters} = 0 THEN 0
        ELSE round(100.0 * ${writtenChapters} / ${plannedChapters})::int
      END`;
      const lastEditedAt = sql<Date>`greatest(
        ${works.updatedAt},
        ${workBranches.updatedAt},
        coalesce((
          SELECT max(chapter_edit.updated_at)
            FROM chapters chapter_edit
           WHERE chapter_edit.work_id = ${works.id}
             AND chapter_edit.user_id = ${userId}
             AND chapter_edit.branch_id = ${mainBranchId}
        ), ${works.updatedAt}),
        coalesce((
          SELECT max(outline_edit.updated_at)
            FROM outline_nodes outline_edit
           WHERE outline_edit.work_id = ${works.id}
             AND outline_edit.user_id = ${userId}
             AND outline_edit.branch_id = ${mainBranchId}
        ), ${works.updatedAt}),
        coalesce((
          SELECT max(foreshadow_edit.updated_at)
            FROM foreshadows foreshadow_edit
           WHERE foreshadow_edit.work_id = ${works.id}
             AND foreshadow_edit.user_id = ${userId}
             AND foreshadow_edit.branch_id = ${mainBranchId}
             AND foreshadow_edit.deleted_at IS NULL
        ), ${works.updatedAt}),
        coalesce((
          SELECT max(entity_edit.updated_at)
            FROM entities entity_edit
           WHERE entity_edit.work_id = ${works.id}
             AND entity_edit.user_id = ${userId}
             AND entity_edit.branch_id = ${mainBranchId}
             AND entity_edit.deleted_at IS NULL
        ), ${works.updatedAt}),
        coalesce((
          SELECT max(story_bible_edit.updated_at)
            FROM story_bibles story_bible_edit
           WHERE story_bible_edit.work_id = ${works.id}
             AND story_bible_edit.user_id = ${userId}
             AND story_bible_edit.branch_id = ${mainBranchId}
        ), ${works.updatedAt}),
        coalesce((
          SELECT max(volume_contract_edit.updated_at)
            FROM volume_contracts volume_contract_edit
           WHERE volume_contract_edit.work_id = ${works.id}
             AND volume_contract_edit.user_id = ${userId}
             AND volume_contract_edit.branch_id = ${mainBranchId}
        ), ${works.updatedAt})
      )`;
      const conditions: SQL[] = [
        eq(works.userId, userId),
        query.trash ? isNotNull(works.deletedAt) : isNull(works.deletedAt),
      ];
      if (query.status) {
        conditions.push(
          query.status === "preparing"
            ? inArray(works.status, ["draft", "preparing"])
            : eq(works.status, query.status),
        );
      } else if (!query.trash) {
        conditions.push(ne(works.status, "archived"));
      }
      if (query.genre) {
        conditions.push(eq(works.genre, query.genre));
      }
      if (query.q) {
        const search = `%${query.q}%`;
        conditions.push(or(ilike(works.title, search), ilike(works.penName, search))!);
      }
      if (query.words === "lt1m") {
        conditions.push(sql`${totalWordCount} < 1000000`);
      } else if (query.words === "1m-2m") {
        conditions.push(sql`${totalWordCount} >= 1000000 AND ${totalWordCount} < 2000000`);
      } else if (query.words === "gt2m") {
        conditions.push(sql`${totalWordCount} >= 2000000`);
      }
      if (query.recent) {
        const hours = query.recent === "day" ? 24 : query.recent === "week" ? 168 : 720;
        conditions.push(sql`${lastEditedAt} >= now() - make_interval(hours => ${hours})`);
      }
      if (query.cursor) {
        const [cursor] = await transaction
          .select({ id: works.id })
          .from(works)
          .where(
            and(
              eq(works.userId, userId),
              eq(works.id, query.cursor),
              query.trash ? isNotNull(works.deletedAt) : isNull(works.deletedAt),
            ),
          )
          .limit(1);
        if (!cursor) {
          return "invalid_cursor";
        }
        conditions.push(lt(works.id, query.cursor));
      }

      const records = await transaction
        .select({
          work: works,
          mainBranchId,
          totalWordCount,
          writtenChapters,
          plannedChapters,
          progressPercent,
          lastEditedAt,
        })
        .from(works)
        .leftJoin(
          workBranches,
          and(
            eq(workBranches.workId, works.id),
            eq(workBranches.userId, userId),
            eq(workBranches.name, "main"),
          ),
        )
        .where(and(...conditions))
        .orderBy(desc(works.id))
        .limit(query.limit + 1);
      const hasMore = records.length > query.limit;
      const page = hasMore ? records.slice(0, query.limit) : records;
      const workIds = page.map((row) => row.work.id);
      const branchIds = page.flatMap((row) => (row.mainBranchId ? [row.mainBranchId] : []));
      const qualityByWork = new Map<string, number[]>();
      if (workIds.length > 0 && branchIds.length > 0) {
        const reports = await transaction
          .select({
            workId: qualityReports.workId,
            chapterId: qualityReports.chapterId,
            dimensions: qualityReports.dimensions,
          })
          .from(qualityReports)
          .innerJoin(chapters, eq(chapters.id, qualityReports.chapterId))
          .where(
            and(
              eq(qualityReports.userId, userId),
              inArray(qualityReports.workId, workIds),
              inArray(qualityReports.branchId, branchIds),
              eq(qualityReports.branchId, chapters.branchId),
              eq(qualityReports.chapterVersionId, chapters.currentVersionId),
            ),
          )
          .orderBy(desc(qualityReports.createdAt), desc(qualityReports.id));
        const latestByChapter = new Map<string, (typeof reports)[number]>();
        for (const report of reports) {
          if (!latestByChapter.has(report.chapterId)) {
            latestByChapter.set(report.chapterId, report);
          }
        }
        for (const report of latestByChapter.values()) {
          const scores = report.dimensions.map((dimension) => dimension.score);
          if (scores.length === 0) continue;
          const average = scores.reduce((total, score) => total + score, 0) / scores.length;
          const normalized = Math.round(average * 20);
          qualityByWork.set(report.workId, [
            ...(qualityByWork.get(report.workId) ?? []),
            normalized,
          ]);
        }
      }
      const openForeshadowRows =
        workIds.length > 0 && branchIds.length > 0
          ? await transaction
              .select({
                workId: foreshadows.workId,
                count: sql<number>`count(*)::int`,
              })
              .from(foreshadows)
              .where(
                and(
                  eq(foreshadows.userId, userId),
                  inArray(foreshadows.workId, workIds),
                  inArray(foreshadows.branchId, branchIds),
                  isNull(foreshadows.deletedAt),
                  inArray(foreshadows.status, ["planned", "planted", "progressed", "deferred"]),
                ),
              )
              .groupBy(foreshadows.workId)
          : [];
      const openForeshadowByWork = new Map(
        openForeshadowRows.map((row) => [row.workId, Number(row.count)]),
      );
      const worksWithMetrics: WorkListRow[] = page.map((row) => {
        const scores = qualityByWork.get(row.work.id) ?? [];
        return {
          work: row.work,
          metrics: {
            totalWordCount: Number(row.totalWordCount),
            progress: {
              writtenChapters: Number(row.writtenChapters),
              plannedChapters: Number(row.plannedChapters),
              percent: Number(row.progressPercent),
            },
            qualityScore:
              scores.length > 0
                ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
                : null,
            unrecoveredForeshadowCount: openForeshadowByWork.get(row.work.id) ?? 0,
            lastEditedAt: new Date(row.lastEditedAt),
          },
        };
      });
      return {
        works: worksWithMetrics,
        nextCursor: hasMore ? (page.at(-1)?.work.id ?? null) : null,
      };
    });
  }

  async find(userId: string, workId: string): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select()
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
        .limit(1);
      return work;
    });
  }

  async findTrashed(userId: string, workId: string): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select()
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNotNull(works.deletedAt)))
        .limit(1);
      return work;
    });
  }

  async exportReadyWorkIds(userId: string, workIds: readonly string[]): Promise<Set<string>> {
    if (workIds.length === 0) return new Set();
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ workId: workExportReceipts.workId })
        .from(workExportReceipts)
        .where(
          and(
            eq(workExportReceipts.userId, userId),
            inArray(workExportReceipts.workId, [...workIds]),
            eq(workExportReceipts.status, "completed"),
            gt(workExportReceipts.expiresAt, new Date()),
            isNotNull(workExportReceipts.artifactObjectKey),
          ),
        );
      return new Set(rows.map((row) => row.workId));
    });
  }

  async update(
    userId: string,
    workId: string,
    expectedVersion: number,
    values: WorkUpdateValues,
    audit: WorksAuditContext,
  ): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const updateValues = {
        ...values,
        ...(values.coverImageUrl !== undefined ? { coverObjectKey: null } : {}),
      };
      const [work] = await transaction
        .update(works)
        .set({
          ...updateValues,
          version: sql`${works.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(works.version, expectedVersion),
            isNull(works.deletedAt),
          ),
        )
        .returning();
      if (!work) {
        return undefined;
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "work.updated",
        targetType: "work",
        targetId: workId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return work;
    });
  }

  async getCoverObjectKey(userId: string, workId: string): Promise<string | null | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select({ coverObjectKey: works.coverObjectKey })
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
        .limit(1);
      return work?.coverObjectKey;
    });
  }

  async setCoverObject(
    userId: string,
    workId: string,
    expectedVersion: number,
    objectKey: string,
    audit: WorksAuditContext,
  ): Promise<{ work: WorkRecord; previousObjectKey: string | null } | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(works)
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(works.version, expectedVersion),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        return undefined;
      }
      const [work] = await transaction
        .update(works)
        .set({
          coverImageUrl: null,
          coverObjectKey: objectKey,
          version: sql`${works.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(works.id, workId), eq(works.version, expectedVersion)))
        .returning();
      if (!work) {
        return undefined;
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "work.cover_updated",
        targetType: "work",
        targetId: workId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { work, previousObjectKey: current.coverObjectKey };
    });
  }

  async archive(
    userId: string,
    workId: string,
    expectedVersion: number,
    audit: WorksAuditContext,
  ): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(works)
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(works.version, expectedVersion),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        return undefined;
      }
      if (current.status === "archived") {
        return current;
      }
      const now = new Date();
      const [work] = await transaction
        .update(works)
        .set({
          status: "archived",
          archivedAt: now,
          archivedFromStatus: current.status,
          version: sql`${works.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(works.id, workId), eq(works.version, expectedVersion)))
        .returning();
      if (work) {
        await transaction.insert(auditLogs).values({
          id: uuidv7(),
          actorId: userId,
          action: "work.archived",
          targetType: "work",
          targetId: workId,
          decision: "allowed",
          correlationId: audit.requestId,
          ip: audit.ip,
          userAgent: audit.userAgent,
        });
      }
      return work;
    });
  }

  async restore(
    userId: string,
    workId: string,
    expectedVersion: number,
    audit: WorksAuditContext,
  ): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(works)
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(works.version, expectedVersion),
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        return undefined;
      }
      if (current.status !== "archived") {
        return current;
      }
      const restoredStatus = current.archivedFromStatus ?? "preparing";
      const [work] = await transaction
        .update(works)
        .set({
          status: restoredStatus,
          archivedAt: null,
          archivedFromStatus: null,
          version: sql`${works.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(works.id, workId), eq(works.version, expectedVersion)))
        .returning();
      if (work) {
        await transaction.insert(auditLogs).values({
          id: uuidv7(),
          actorId: userId,
          action: "work.restored",
          targetType: "work",
          targetId: workId,
          decision: "allowed",
          correlationId: audit.requestId,
          ip: audit.ip,
          userAgent: audit.userAgent,
        });
      }
      return work;
    });
  }

  async trash(
    userId: string,
    workId: string,
    expectedVersion: number,
    audit: WorksAuditContext,
  ): Promise<WorkRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const now = new Date();
      const purgeAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000);
      const [work] = await transaction
        .update(works)
        .set({
          deletedAt: now,
          purgeAfter,
          version: sql`${works.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(works.version, expectedVersion),
            isNull(works.deletedAt),
          ),
        )
        .returning();
      if (work) {
        await transaction.insert(auditLogs).values({
          id: uuidv7(),
          actorId: userId,
          action: "work.trashed",
          targetType: "work",
          targetId: workId,
          decision: "allowed",
          correlationId: audit.requestId,
          ip: audit.ip,
          userAgent: audit.userAgent,
        });
      }
      return work;
    });
  }

  async restoreTrashed(
    userId: string,
    workId: string,
    expectedVersion: number,
    audit: WorksAuditContext,
  ): Promise<WorkTrashRestoreResult> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(works)
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(works.version, expectedVersion),
            isNotNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.purgeAfter && current.purgeAfter.getTime() <= Date.now()) {
        return "expired";
      }
      const [work] = await transaction
        .update(works)
        .set({
          deletedAt: null,
          purgeAfter: null,
          version: sql`${works.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(works.id, workId), eq(works.version, expectedVersion)))
        .returning();
      if (!work) {
        return "not_found";
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "work.trash_restored",
        targetType: "work",
        targetId: workId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return work;
    });
  }

  async preparePurge(
    userId: string,
    workId: string,
    expectedVersion: number,
  ): Promise<WorkPurgePreview> {
    return this.withTenant(userId, (transaction) =>
      this.preparePurgeInTransaction(transaction, userId, workId, expectedVersion),
    );
  }

  private async preparePurgeInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
    expectedVersion: number,
  ): Promise<WorkPurgePreview> {
    const [work] = await transaction
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNotNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      return { status: "not_found" };
    }
    if (work.version !== expectedVersion) {
      return { status: "version_conflict" };
    }
    if (!work.purgeAfter || work.purgeAfter.getTime() > Date.now()) {
      return { status: "not_due" };
    }
    const exports = await transaction
      .select({ key: workExportReceipts.artifactObjectKey })
      .from(workExportReceipts)
      .where(
        and(
          eq(workExportReceipts.workId, workId),
          eq(workExportReceipts.userId, userId),
          eq(workExportReceipts.status, "completed"),
          gt(workExportReceipts.expiresAt, new Date()),
          isNotNull(workExportReceipts.artifactObjectKey),
        ),
      );
    if (exports.length === 0) {
      return { status: "export_required" };
    }
    return {
      status: "ready",
      workId,
      objectKeys: [
        ...new Set(exports.flatMap((receipt) => (receipt.key ? [receipt.key] : []))),
        ...(work.coverObjectKey ? [work.coverObjectKey] : []),
      ],
    };
  }

  async purge(
    userId: string,
    workId: string,
    expectedVersion: number,
    audit: WorksAuditContext,
  ): Promise<{ objectKeys: string[] } | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select({ version: works.version })
        .from(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNotNull(works.deletedAt)))
        .limit(1);
      if (!current || current.version !== expectedVersion) {
        return undefined;
      }
      const preview = await this.preparePurgeInTransaction(
        transaction,
        userId,
        workId,
        expectedVersion,
      );
      if (preview.status !== "ready") {
        return undefined;
      }
      const deleted = await transaction
        .delete(works)
        .where(and(eq(works.id, workId), eq(works.userId, userId), isNotNull(works.deletedAt)))
        .returning({ id: works.id });
      if (deleted.length === 0) {
        return undefined;
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "work.purged",
        targetType: "work",
        targetId: workId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { objectKeys: preview.objectKeys };
    });
  }

  async findBranches(userId: string, workId: string): Promise<WorkBranchRecord[]> {
    return this.withTenant(userId, (transaction) =>
      transaction
        .select()
        .from(workBranches)
        .where(and(eq(workBranches.userId, userId), eq(workBranches.workId, workId)))
        .orderBy(desc(workBranches.createdAt)),
    );
  }

  async listBranches(
    userId: string,
    workId: string,
    query: CursorPageQuery,
  ): Promise<CursorPageResult<WorkBranchRecord> | "invalid_cursor"> {
    return this.withTenant(userId, async (transaction) => {
      const scope = and(eq(workBranches.userId, userId), eq(workBranches.workId, workId));
      const cursor = query.cursor
        ? (
            await transaction
              .select({ id: workBranches.id, createdAt: workBranches.createdAt })
              .from(workBranches)
              .where(and(scope, eq(workBranches.id, query.cursor)))
              .limit(1)
          )[0]
        : undefined;
      if (query.cursor && !cursor) {
        return "invalid_cursor";
      }
      const rows = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            scope,
            cursor
              ? or(
                  lt(workBranches.createdAt, cursor.createdAt),
                  and(eq(workBranches.createdAt, cursor.createdAt), lt(workBranches.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(desc(workBranches.createdAt), desc(workBranches.id))
        .limit(query.limit + 1);
      return toCursorPage(rows, query.limit);
    });
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<WorkRecord | undefined> {
    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    return this.withTenant(userId, async (transaction) => {
      const [work] = await transaction
        .select()
        .from(works)
        .where(
          and(
            eq(works.userId, userId),
            eq(works.idempotencyKey, idempotencyKey),
            gt(works.createdAt, cutoff),
          ),
        )
        .limit(1);
      return work;
    });
  }

  async hasModelConfig(userId: string): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [config] = await transaction
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)))
        .limit(1);
      return Boolean(config);
    });
  }

  async isStoryBibleLocked(userId: string, workId: string, branchId: string): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [storyBible] = await transaction
        .select({ id: storyBibles.id })
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.userId, userId),
            eq(storyBibles.workId, workId),
            eq(storyBibles.branchId, branchId),
            eq(storyBibles.status, "locked"),
          ),
        )
        .limit(1);
      return Boolean(storyBible);
    });
  }

  async hasReadyChapterBrief(userId: string, workId: string, branchId: string): Promise<boolean> {
    return this.withTenant(userId, async (transaction) => {
      const [chapter] = await transaction
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, userId),
            eq(chapters.workId, workId),
            eq(chapters.branchId, branchId),
            sql`coalesce(${chapters.brief}->>'goal', '') <> ''`,
            sql`coalesce(${chapters.brief}->>'pov', '') <> ''`,
            sql`coalesce(${chapters.brief}->>'location', '') <> ''`,
            sql`jsonb_typeof(${chapters.brief}->'sceneBeats') = 'array'`,
            sql`jsonb_array_length(${chapters.brief}->'sceneBeats') > 0`,
            sql`jsonb_typeof(${chapters.brief}->'requiredFacts') = 'array'`,
            sql`jsonb_array_length(${chapters.brief}->'requiredFacts') > 0`,
          ),
        )
        .limit(1);
      return Boolean(chapter);
    });
  }

  async findGenrePackByKey(key: string, version = 1): Promise<GenrePackRecord | undefined> {
    const [pack] = await this.db
      .select()
      .from(genrePacks)
      .where(and(eq(genrePacks.key, key), eq(genrePacks.version, version)))
      .limit(1);
    return pack;
  }

  async findLatestGenrePack(key: WorkGenre): Promise<GenrePackRecord | undefined> {
    const [pack] = await this.db
      .select()
      .from(genrePacks)
      .where(eq(genrePacks.key, key))
      .orderBy(desc(genrePacks.version))
      .limit(1);
    return pack;
  }

  async findGenrePackVersion(
    key: WorkGenre,
    version: number,
  ): Promise<GenrePackRecord | undefined> {
    const [pack] = await this.db
      .select()
      .from(genrePacks)
      .where(and(eq(genrePacks.key, key), eq(genrePacks.version, version)))
      .limit(1);
    return pack;
  }

  async listGenrePacks(key?: WorkGenre): Promise<GenrePackRecord[]> {
    return this.db
      .select()
      .from(genrePacks)
      .where(key ? eq(genrePacks.key, key) : undefined)
      .orderBy(asc(genrePacks.key), desc(genrePacks.version));
  }

  async changeGenrePackVersion(input: {
    userId: string;
    workId: string;
    targetVersion: number;
    reason: string;
    idempotencyKey: string;
    audit: WorksAuditContext;
  }): Promise<
    | { work: WorkRecord; branch: WorkBranchRecord; pack: GenrePackRecord }
    | "not_found"
    | "pack_not_found"
    | "idempotency_conflict"
  > {
    return this.withTenant(input.userId, async (transaction) => {
      const scope = `work.genre_pack.version:${input.workId}`;
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ targetVersion: input.targetVersion, reason: input.reason }))
        .digest("hex");
      const [replayed] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.userId, input.userId),
            eq(idempotencyRecords.scope, scope),
            eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (replayed) {
        if (replayed.requestHash && replayed.requestHash !== requestHash) {
          return "idempotency_conflict";
        }
        return this.readGenrePackVersionResult(transaction, input.userId, input.workId);
      }

      const [work] = await transaction
        .select()
        .from(works)
        .where(
          and(eq(works.id, input.workId), eq(works.userId, input.userId), isNull(works.deletedAt)),
        )
        .for("update")
        .limit(1);
      if (!work) {
        return "not_found";
      }
      const [branch] = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            eq(workBranches.workId, work.id),
            eq(workBranches.userId, input.userId),
            eq(workBranches.name, "main"),
            eq(workBranches.status, "active"),
          ),
        )
        .for("update")
        .limit(1);
      if (!branch) {
        return "not_found";
      }
      const [targetPack] = await transaction
        .select()
        .from(genrePacks)
        .where(and(eq(genrePacks.key, work.genre), eq(genrePacks.version, input.targetVersion)))
        .limit(1);
      if (!targetPack) {
        return "pack_not_found";
      }

      if (work.templatePackId !== targetPack.id) {
        const [currentPack] = work.templatePackId
          ? await transaction
              .select()
              .from(genrePacks)
              .where(eq(genrePacks.id, work.templatePackId))
              .limit(1)
          : [undefined];
        const migrationReport = packMigrationReport(currentPack, targetPack);
        const nodeId = uuidv7();
        await transaction.insert(versionNodes).values({
          id: nodeId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          parentNodeId: branch.headNodeId,
          nodeType: "snapshot",
          snapshotId: nodeId,
          objectType: "genre_pack",
          objectId: targetPack.id,
          objectVersion: targetPack.version,
          payload: {
            previousPackId: currentPack?.id ?? null,
            previousVersion: currentPack?.version ?? null,
            targetPackId: targetPack.id,
            targetVersion: targetPack.version,
            reason: input.reason,
            migrationReport,
          },
          actorId: input.userId,
          message:
            targetPack.version > (currentPack?.version ?? 0) ? "升级题材包版本" : "回滚题材包版本",
        });
        await transaction
          .update(workBranches)
          .set({ headNodeId: nodeId, updatedAt: new Date() })
          .where(eq(workBranches.id, branch.id));
        await transaction
          .update(works)
          .set({
            templatePackId: targetPack.id,
            settings: {
              ...work.settings,
              genrePack: {
                key: targetPack.key,
                version: targetPack.version,
                fields: targetPack.fields,
                migrationReport,
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(works.id, work.id));
        await transaction.insert(auditLogs).values({
          id: uuidv7(),
          actorId: input.userId,
          action: "work.genre_pack.changed",
          targetType: "work",
          targetId: work.id,
          decision: "allowed",
          correlationId: input.audit.requestId,
          ip: input.audit.ip,
          userAgent: input.audit.userAgent,
        });
      }

      await transaction
        .insert(idempotencyRecords)
        .values({
          id: uuidv7(),
          userId: input.userId,
          scope,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          resourceType: "work",
          resourceId: work.id,
        })
        .onConflictDoNothing();
      return this.readGenrePackVersionResult(transaction, input.userId, input.workId);
    });
  }

  private async readGenrePackVersionResult(
    transaction: DatabaseTransaction,
    userId: string,
    workId: string,
  ): Promise<{ work: WorkRecord; branch: WorkBranchRecord; pack: GenrePackRecord } | "not_found"> {
    const [work] = await transaction
      .select()
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      return "not_found";
    }
    const [branch] = await transaction
      .select()
      .from(workBranches)
      .where(
        and(
          eq(workBranches.workId, work.id),
          eq(workBranches.userId, userId),
          eq(workBranches.name, "main"),
        ),
      )
      .limit(1);
    const [pack] = work.templatePackId
      ? await transaction
          .select()
          .from(genrePacks)
          .where(eq(genrePacks.id, work.templatePackId))
          .limit(1)
      : [undefined];
    if (!branch || !pack) {
      return "not_found";
    }
    return { work, branch, pack };
  }

  async findGenrePacksByIds(ids: string[]): Promise<GenrePackRecord[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.db.select().from(genrePacks).where(inArray(genrePacks.id, ids));
  }

  async create(input: {
    id: string;
    branchId: string;
    nodeId: string;
    userId: string;
    title: string;
    penName: string;
    genre: string;
    scaleTarget: string;
    chapterLengthTarget: number;
    sourceMode: string;
    idea: string | null;
    templatePackId: string | null;
    settings: Record<string, unknown>;
    initialSettingEntities?: InitialSettingEntity[];
    idempotencyKey: string | null;
    audit: WorksAuditContext;
  }): Promise<{ work: WorkRecord; branch: WorkBranchRecord }> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${input.userId}, true)`);
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      if (input.idempotencyKey) {
        const [existing] = await transaction
          .select()
          .from(works)
          .where(
            and(eq(works.userId, input.userId), eq(works.idempotencyKey, input.idempotencyKey)),
          )
          .limit(1);
        if (existing) {
          if (existing.createdAt.getTime() >= Date.now() - IDEMPOTENCY_TTL_MS) {
            const [branch] = await transaction
              .select()
              .from(workBranches)
              .where(
                and(
                  eq(workBranches.workId, existing.id),
                  eq(workBranches.userId, input.userId),
                  eq(workBranches.name, "main"),
                ),
              )
              .limit(1);
            if (!branch) {
              throw new Error("Existing work is missing its main branch");
            }
            return { work: existing, branch };
          }
          await transaction
            .update(works)
            .set({ idempotencyKey: null })
            .where(eq(works.id, existing.id));
        }
      }

      const [work] = await transaction
        .insert(works)
        .values({
          id: input.id,
          userId: input.userId,
          title: input.title,
          penName: input.penName,
          genre: input.genre,
          status: "draft",
          scaleTarget: input.scaleTarget,
          chapterLengthTarget: input.chapterLengthTarget,
          sourceMode: input.sourceMode,
          idea: input.idea,
          templatePackId: input.templatePackId,
          settings: input.settings,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      if (!work) {
        throw new Error("Failed to create work");
      }

      const [branch] = await transaction
        .insert(workBranches)
        .values({
          id: input.branchId,
          workId: work.id,
          userId: input.userId,
          name: "main",
          status: "active",
        })
        .returning();
      if (!branch) {
        throw new Error("Failed to create main branch");
      }

      await transaction.insert(versionNodes).values({
        id: input.nodeId,
        workId: work.id,
        branchId: branch.id,
        userId: input.userId,
        nodeType: "snapshot",
        objectType: "work",
        objectId: work.id,
        objectVersion: 1,
        snapshotId: input.nodeId,
        payload: { sourceMode: input.sourceMode, genrePackId: input.templatePackId },
        actorId: input.userId,
        message: "创建作品",
      });
      let [branchWithHead] = await transaction
        .update(workBranches)
        .set({ headNodeId: input.nodeId, updatedAt: new Date() })
        .where(eq(workBranches.id, branch.id))
        .returning();
      if (!branchWithHead) {
        throw new Error("Failed to set initial branch head");
      }
      let headNodeId = branchWithHead.headNodeId;
      for (const setting of input.initialSettingEntities ?? []) {
        const now = new Date();
        const entityId = uuidv7();
        const entityVersionId = uuidv7();
        const versionNodeId = uuidv7();
        const [entity] = await transaction
          .insert(entities)
          .values({
            id: entityId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            type: setting.type,
            name: setting.name,
            aliases: [],
            summary: setting.summary,
            description: setting.description,
            attributes: setting.attributes,
            tags: setting.tags,
            status: "locked",
            source: "import",
            version: 1,
            lockedAt: now,
            lockedBy: input.userId,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!entity) {
          throw new Error("Failed to materialize imported setting");
        }
        const snapshot = {
          type: entity.type,
          name: entity.name,
          aliases: entity.aliases,
          summary: entity.summary,
          description: entity.description,
          attributes: entity.attributes,
          tags: entity.tags,
          status: entity.status,
          source: entity.source,
          version: entity.version,
          lockedAt: entity.lockedAt?.toISOString() ?? null,
          lockedBy: entity.lockedBy,
          importCandidateId: setting.importCandidateId,
        };
        await transaction.insert(versionNodes).values({
          id: versionNodeId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          parentNodeId: headNodeId,
          nodeType: "entity_version",
          objectType: "setting",
          objectId: entity.id,
          objectVersion: 1,
          snapshotId: entityVersionId,
          payload: snapshot,
          actorId: input.userId,
          message: "导入设定",
          createdAt: now,
        });
        await transaction.insert(entityVersions).values({
          id: entityVersionId,
          entityId: entity.id,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          version: 1,
          snapshot,
          versionNodeId,
          createdBy: input.userId,
          createdAt: now,
        });
        headNodeId = versionNodeId;
      }
      if (input.initialSettingEntities?.length) {
        const [materializedBranch] = await transaction
          .update(workBranches)
          .set({ headNodeId, updatedAt: new Date() })
          .where(eq(workBranches.id, branch.id))
          .returning();
        if (!materializedBranch) {
          throw new Error("Failed to update branch head after materializing imported settings");
        }
        branchWithHead = materializedBranch;
      }

      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "work.created",
        targetType: "work",
        targetId: work.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });

      return { work, branch: branchWithHead };
    });
  }

  async duplicate(input: {
    userId: string;
    source: WorkRecord;
    title: string;
    copyManuscript: boolean;
    copyHistory: boolean;
    workId: string;
    branchId: string;
    nodeId: string;
    audit: WorksAuditContext;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<
    { status: "ok"; work: WorkRecord; branch: WorkBranchRecord } | { status: "conflict" }
  > {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${input.userId}, true)`);
      const scope = `work.duplicate:${input.source.id}`;
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.userId}:${scope}:${input.idempotencyKey}`}))`,
      );
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000);
      const [existingRecord] = await transaction
        .select()
        .from(idempotencyRecords)
        .where(
          and(
            eq(idempotencyRecords.userId, input.userId),
            eq(idempotencyRecords.scope, scope),
            eq(idempotencyRecords.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existingRecord) {
        if (existingRecord.createdAt < cutoff) {
          await transaction
            .delete(idempotencyRecords)
            .where(eq(idempotencyRecords.id, existingRecord.id));
        } else {
          if (existingRecord.requestHash !== input.requestHash) {
            return { status: "conflict" };
          }
          const [work] = await transaction
            .select()
            .from(works)
            .where(
              and(
                eq(works.id, existingRecord.resourceId),
                eq(works.userId, input.userId),
                isNull(works.deletedAt),
              ),
            )
            .limit(1);
          if (!work) {
            return { status: "conflict" };
          }
          const [branch] = await transaction
            .select()
            .from(workBranches)
            .where(
              and(
                eq(workBranches.workId, work.id),
                eq(workBranches.userId, input.userId),
                eq(workBranches.name, "main"),
              ),
            )
            .limit(1);
          if (!branch) {
            return { status: "conflict" };
          }
          return { status: "ok", work, branch };
        }
      }
      const [sourceBranch] = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            eq(workBranches.workId, input.source.id),
            eq(workBranches.userId, input.userId),
            eq(workBranches.name, "main"),
          ),
        )
        .limit(1);
      if (!sourceBranch) {
        throw new Error("Source work is missing its main branch");
      }

      const [work] = await transaction
        .insert(works)
        .values({
          id: input.workId,
          userId: input.userId,
          title: input.title,
          penName: input.source.penName,
          genre: input.source.genre,
          status:
            input.source.status === "completed" || input.source.status === "archived"
              ? "preparing"
              : input.source.status,
          scaleTarget: input.source.scaleTarget,
          chapterLengthTarget: input.source.chapterLengthTarget,
          sourceMode: input.source.sourceMode,
          idea: input.source.idea,
          templatePackId: input.source.templatePackId,
          settings: input.source.settings,
          coverImageUrl: input.source.coverImageUrl,
          tags: input.source.tags,
        })
        .returning();
      if (!work) {
        throw new Error("Failed to create duplicated work");
      }

      const [branch] = await transaction
        .insert(workBranches)
        .values({
          id: input.branchId,
          workId: work.id,
          userId: input.userId,
          name: "main",
          status: "active",
        })
        .returning();
      if (!branch) {
        throw new Error("Failed to create duplicated main branch");
      }

      await transaction.insert(versionNodes).values({
        id: input.nodeId,
        workId: work.id,
        branchId: branch.id,
        userId: input.userId,
        nodeType: "snapshot",
        objectType: "work",
        objectId: work.id,
        objectVersion: 1,
        snapshotId: input.nodeId,
        payload: { duplicatedFrom: input.source.id },
        actorId: input.userId,
        message: "复制作品",
      });
      let headNodeId = input.nodeId;

      const [sourceBible] = await transaction
        .select()
        .from(storyBibles)
        .where(
          and(
            eq(storyBibles.workId, input.source.id),
            eq(storyBibles.branchId, sourceBranch.id),
            eq(storyBibles.userId, input.userId),
          ),
        )
        .limit(1);
      let copiedStoryBibleId: string | null = null;
      if (sourceBible) {
        copiedStoryBibleId = uuidv7();
        await transaction.insert(storyBibles).values({
          id: copiedStoryBibleId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          version: 1,
          status: "draft",
          cards: sourceBible.cards,
        });
      }

      const sourceEntities = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, input.source.id),
            eq(entities.branchId, sourceBranch.id),
            eq(entities.userId, input.userId),
            isNull(entities.deletedAt),
          ),
        );
      const entityIdMap = new Map<string, string>();
      if (sourceEntities.length > 0) {
        const copiedEntities = sourceEntities.map((entity) => {
          const copiedId = uuidv7();
          entityIdMap.set(entity.id, copiedId);
          return {
            ...entity,
            id: copiedId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
          };
        });
        await transaction.insert(entities).values(copiedEntities);
      }
      const copyMaps = await copyEntityGraph({
        transaction,
        input: {
          userId: input.userId,
          sourceWorkId: input.source.id,
          sourceBranchId: sourceBranch.id,
          workId: work.id,
          branchId: branch.id,
          rootNodeId: input.nodeId,
          copiedStoryBibleId,
        },
        sourceEntities,
        entityIdMap,
      });

      const sourceChapters = input.copyManuscript
        ? await transaction
            .select()
            .from(chapters)
            .where(
              and(
                eq(chapters.workId, input.source.id),
                eq(chapters.branchId, sourceBranch.id),
                eq(chapters.userId, input.userId),
              ),
            )
            .orderBy(chapters.number)
        : [];
      const chapterIdMap = new Map<string, string>();
      for (const chapter of sourceChapters) {
        const [copiedChapter] = await transaction
          .insert(chapters)
          .values({
            id: uuidv7(),
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            number: chapter.number,
            title: chapter.title,
            status: input.copyManuscript ? chapter.status : "planned",
            version: 1,
            wordCount: input.copyManuscript ? chapter.wordCount : 0,
            brief: chapter.brief,
          })
          .returning();
        if (!copiedChapter) {
          throw new Error("Failed to copy chapter structure");
        }
        chapterIdMap.set(chapter.id, copiedChapter.id);

        const versions = await transaction
          .select()
          .from(chapterVersions)
          .where(
            and(
              eq(chapterVersions.chapterId, chapter.id),
              eq(chapterVersions.userId, input.userId),
            ),
          )
          .orderBy(chapterVersions.version);
        const selectedVersions = input.copyHistory
          ? versions
          : versions.filter(
              (version) => version.id === (chapter.currentVersionId ?? versions.at(-1)?.id ?? ""),
            );
        let currentVersionId: string | null = null;
        for (const version of selectedVersions) {
          const versionNodeId = uuidv7();
          const copiedVersionId = uuidv7();
          await transaction.insert(versionNodes).values({
            id: versionNodeId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            parentNodeId: headNodeId,
            nodeType: "chapter_version",
            objectType: "chapter",
            objectId: copiedChapter.id,
            objectVersion: version.version,
            snapshotId: copiedVersionId,
            payload: { copiedFrom: version.id },
            actorId: input.userId,
            message: "复制正文",
          });
          await transaction.insert(chapterVersions).values({
            id: copiedVersionId,
            workId: work.id,
            branchId: branch.id,
            userId: input.userId,
            chapterId: copiedChapter.id,
            version: version.version,
            content: version.content,
            contentHash: version.contentHash,
            versionNodeId,
            source: version.source,
            generationStep: version.generationStep,
          });
          currentVersionId = copiedVersionId;
          headNodeId = versionNodeId;
        }
        if (currentVersionId) {
          await transaction
            .update(chapters)
            .set({ currentVersionId })
            .where(eq(chapters.id, copiedChapter.id));
        }
      }

      const sourceOutline = await transaction
        .select()
        .from(outlineNodes)
        .where(
          and(
            eq(outlineNodes.workId, input.source.id),
            eq(outlineNodes.branchId, sourceBranch.id),
            eq(outlineNodes.userId, input.userId),
          ),
        );
      const levelOrder = new Map([
        ["book", 0],
        ["volume", 1],
        ["act", 2],
        ["chapter", 3],
        ["scene", 4],
      ]);
      sourceOutline.sort(
        (left, right) =>
          (levelOrder.get(left.level) ?? 99) - (levelOrder.get(right.level) ?? 99) ||
          left.sortOrder - right.sortOrder,
      );
      const outlineIdMap = new Map<string, string>();
      const outlineVersionNodeMap = new Map<string, string>();
      const outlineSourceVersionMap = new Map<string, string>();
      for (const node of sourceOutline) {
        const copiedNodeId = uuidv7();
        const versionNodeId = uuidv7();
        const copiedChapterId = node.chapterId ? chapterIdMap.get(node.chapterId) : null;
        await transaction.insert(versionNodes).values({
          id: versionNodeId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          parentNodeId: headNodeId,
          nodeType: "outline_version",
          objectType: "outline_node",
          objectId: copiedNodeId,
          objectVersion: 1,
          snapshotId: versionNodeId,
          payload: { copiedFrom: node.id, level: node.level },
          actorId: input.userId,
          message: "复制大纲",
        });
        await transaction.insert(outlineNodes).values({
          id: copiedNodeId,
          workId: work.id,
          branchId: branch.id,
          userId: input.userId,
          level: node.level,
          parentId: node.parentId ? (outlineIdMap.get(node.parentId) ?? null) : null,
          sortOrder: node.sortOrder,
          title: node.title,
          summary: node.summary,
          status: node.status,
          locked: false,
          version: 1,
          chapterId: copiedChapterId,
          tension: node.tension,
          versionNodeId,
        });
        outlineIdMap.set(node.id, copiedNodeId);
        outlineVersionNodeMap.set(node.id, versionNodeId);
        outlineSourceVersionMap.set(node.versionNodeId, versionNodeId);
        headNodeId = versionNodeId;
      }

      const sourceContracts = await transaction
        .select()
        .from(volumeContracts)
        .where(
          and(
            eq(volumeContracts.workId, input.source.id),
            eq(volumeContracts.branchId, sourceBranch.id),
            eq(volumeContracts.userId, input.userId),
          ),
        );
      if (sourceContracts.length > 0) {
        await transaction.insert(volumeContracts).values(
          sourceContracts.flatMap((contract) => {
            const copiedNodeId = outlineIdMap.get(contract.nodeId);
            if (!copiedNodeId) {
              return [];
            }
            const copiedVersionNodeId = outlineVersionNodeMap.get(contract.nodeId);
            if (!copiedVersionNodeId) {
              return [];
            }
            return [
              {
                id: uuidv7(),
                nodeId: copiedNodeId,
                workId: work.id,
                branchId: branch.id,
                userId: input.userId,
                objective: contract.objective,
                conflict: contract.conflict,
                turningPoints: contract.turningPoints,
                exitConditions: contract.exitConditions,
                plotLines: contract.plotLines,
                version: 1,
                versionNodeId: copiedVersionNodeId,
              },
            ];
          }),
        );
      }

      for (const row of await selectCopyRows(
        transaction,
        "scene_cards",
        input.userId,
        input.source.id,
        sourceBranch.id,
      )) {
        const copiedNodeId = outlineIdMap.get(String(row.node_id));
        if (!copiedNodeId) {
          continue;
        }
        const copiedVersionNodeId = outlineSourceVersionMap.get(String(row.version_node_id));
        if (!copiedVersionNodeId) {
          continue;
        }
        const mapSceneRef = (type: unknown, sourceId: unknown): string | null => {
          if (typeof sourceId !== "string") {
            return null;
          }
          if (type === "map_node") {
            return copyMaps.mapNode.get(sourceId) ?? null;
          }
          return entityIdMap.get(sourceId) ?? null;
        };
        await insertCopyRow(transaction, "scene_cards", {
          ...row,
          id: uuidv7(),
          node_id: copiedNodeId,
          work_id: work.id,
          branch_id: branch.id,
          user_id: input.userId,
          pov_id: mapSceneRef(row.pov_type, row.pov_id),
          pov_branch_id: row.pov_id ? branch.id : null,
          pov_version_node_id: mapVersionNodeId(row.pov_version_node_id, copyMaps.versionNode),
          location_id: mapSceneRef(row.location_type, row.location_id),
          location_branch_id: row.location_id ? branch.id : null,
          location_version_node_id: mapVersionNodeId(
            row.location_version_node_id,
            copyMaps.versionNode,
          ),
          version_node_id: copiedVersionNodeId,
        });
      }

      const [branchWithHead] = await transaction
        .update(workBranches)
        .set({ headNodeId, updatedAt: new Date() })
        .where(eq(workBranches.id, branch.id))
        .returning();
      if (!branchWithHead) {
        throw new Error("Failed to set duplicated branch head");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "work.duplicated",
        targetType: "work",
        targetId: work.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });
      await transaction.insert(idempotencyRecords).values({
        id: uuidv7(),
        userId: input.userId,
        scope,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        resourceType: "work",
        resourceId: work.id,
      });
      return { status: "ok", work, branch: branchWithHead };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}

function packMigrationReport(
  currentPack: GenrePackRecord | undefined,
  targetPack: GenrePackRecord,
) {
  const previousFields = currentPack?.fields ?? {};
  const targetFields = targetPack.fields;
  return {
    fromVersion: currentPack?.version ?? null,
    toVersion: targetPack.version,
    missingFields: Object.keys(targetFields).filter((key) => !(key in previousFields)),
    removedFields: Object.keys(previousFields).filter((key) => !(key in targetFields)),
    conflicts:
      currentPack && currentPack.key !== targetPack.key
        ? [`题材包 key 不一致：${currentPack.key} -> ${targetPack.key}`]
        : [],
  };
}
