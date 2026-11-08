import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  characterItineraries,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  factionProfiles,
  factionRelationships,
  mapControl,
  mapEdges,
  mapLayers,
  mapMarkers,
  mapNodes,
  timelineEras,
  timelineEvents,
  versionNodes,
  workBranches,
  works,
  withTenantTransaction,
  type DatabaseClient,
} from "@novel-brain/db";
import {
  findControlAreaConflicts,
  findShortestMapRoute,
  findTimelineOrderConflicts,
  sortTimelineEvents,
  validateItinerarySchedule,
} from "@novel-brain/core";
import {
  factionProfileSchema,
  type CharacterItinerary,
  type CharacterItineraryCreateRequest,
  type DomainRef,
  type FactionCreateRequest,
  type FactionDetail,
  type FactionProfile,
  type FactionProfilePatch,
  type FactionRelationship,
  type FactionRelationshipCreateRequest,
  type MapCreateRequest,
  type MapDetail,
  type MapEdge,
  type MapEdgeCreateRequest,
  type MapLayer,
  type MapLayerCreateRequest,
  type MapMarker,
  type MapMarkerCreateRequest,
  type MapNode,
  type MapNodeCreateRequest,
  type MapRoute,
  type StoryTimePoint,
  type Territory,
  type TerritoryCreateRequest,
  type TimelineEra,
  type TimelineEraCreateRequest,
  type TimelineEventCreateRequest,
  type TimelineEventDetail,
  type ValidityInterval,
  type WorldSnapshot,
  type WorldTimeline,
} from "@novel-brain/contracts";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type EntityRecord = InferSelectModel<typeof entities>;
type FactionProfileRecord = InferSelectModel<typeof factionProfiles>;
type FactionRelationshipRecord = InferSelectModel<typeof factionRelationships>;
type TerritoryRecord = InferSelectModel<typeof mapControl>;
type MapLayerRecord = InferSelectModel<typeof mapLayers>;
type MapNodeRecord = InferSelectModel<typeof mapNodes>;
type MapEdgeRecord = InferSelectModel<typeof mapEdges>;
type MapMarkerRecord = InferSelectModel<typeof mapMarkers>;
type TimelineEraRecord = InferSelectModel<typeof timelineEras>;
type TimelineEventRecord = InferSelectModel<typeof timelineEvents>;
type ItineraryRecord = InferSelectModel<typeof characterItineraries>;

export interface WorldWorkContext {
  workId: string;
  branchId: string;
}

export interface WorldAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type WorldWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "proposal_state" }
  | { kind: "version_conflict" }
  | { kind: "name_conflict" }
  | { kind: "alias_conflict" }
  | { kind: "target_not_found" }
  | { kind: "parent_mismatch" }
  | { kind: "layer_mismatch" }
  | { kind: "route_endpoint_mismatch" }
  | { kind: "route_disconnected" }
  | { kind: "route_time_conflict" }
  | { kind: "control_overlap" }
  | { kind: "timeline_overlap" }
  | { kind: "timeline_era_not_found" }
  | { kind: "itinerary_time_order" }
  | { kind: "itinerary_overlap" };

interface ReadOptions {
  versionNodeIds?: string[];
  chapterNumber?: number;
}

interface ValidityColumns {
  validFromChapter: number;
  validToChapter: number | null;
  fromEra: string | null;
  fromStoryTimeLabel: string | null;
  fromStorySortKey: number | null;
  toEra: string | null;
  toStoryTimeLabel: string | null;
  toStorySortKey: number | null;
}

@Injectable()
export class WorldRepository implements OnModuleDestroy {
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
  ): Promise<WorldWorkContext | undefined> {
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

  async listFactions(
    userId: string,
    context: WorldWorkContext,
    options: ReadOptions,
  ): Promise<FactionDetail[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "faction"),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .orderBy(asc(entities.createdAt));
      const details: FactionDetail[] = [];
      for (const row of rows) {
        const detail = await this.readFactionInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          details.push(detail);
        }
      }
      return details;
    });
  }

  async getFaction(
    userId: string,
    context: WorldWorkContext,
    factionId: string,
    options: ReadOptions,
  ): Promise<FactionDetail | undefined> {
    return this.withTenant(userId, async (transaction) =>
      this.readFactionInTransaction(transaction, userId, context, factionId, options),
    );
  }

  async createFaction(
    userId: string,
    context: WorldWorkContext,
    input: FactionCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<FactionDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findEntityConflict(
        transaction,
        userId,
        context,
        input.name,
        input.aliases,
      );
      if (conflict) {
        return conflict;
      }
      const now = new Date();
      const factionId = uuidv7();
      const [entity] = await transaction
        .insert(entities)
        .values({
          id: factionId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          type: "faction",
          name: input.name,
          aliases: input.aliases,
          summary: input.summary,
          description: input.description,
          attributes: { details: input.profile.overview },
          tags: input.tags,
          status: "draft",
          source: "author",
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!entity) {
        throw new Error("Failed to create faction");
      }
      await transaction.insert(factionProfiles).values({
        entityId: factionId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        ...input.profile,
        createdAt: now,
        updatedAt: now,
      });
      await this.appendEntityVersion(
        transaction,
        userId,
        context,
        entity,
        headNodeId,
        "faction.created",
        "创建势力档案",
        audit,
      );
      const detail = await this.readFactionInTransaction(
        transaction,
        userId,
        context,
        factionId,
        {},
      );
      if (!detail) {
        throw new Error("Created faction is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async updateFactionProfile(
    userId: string,
    context: WorldWorkContext,
    factionId: string,
    expectedVersion: number,
    patch: FactionProfilePatch,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<FactionDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        factionId,
        "faction",
        expectedVersion,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "faction",
        factionId,
        "faction.profile.updated",
        "更新势力档案",
      );
      await transaction
        .insert(factionProfiles)
        .values({
          entityId: factionId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          ...factionProfileSchema.parse({ ...emptyFactionProfile(), ...patch }),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: factionProfiles.entityId,
          set: { ...patch, updatedAt: now },
        });
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      const detail = await this.readFactionInTransaction(
        transaction,
        userId,
        context,
        factionId,
        {},
      );
      if (!detail) {
        throw new Error("Updated faction is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async addFactionRelationship(
    userId: string,
    context: WorldWorkContext,
    factionId: string,
    input: FactionRelationshipCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<FactionRelationship>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        factionId,
        "faction",
        null,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (
        input.target.branchId !== context.branchId ||
        !(await findEntity(transaction, userId, context, input.target.id, "faction"))
      ) {
        return { kind: "target_not_found" };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const id = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "faction_relationship",
        id,
        "faction.relationship.created",
        "新增势力关系",
      );
      const [relationship] = await transaction
        .insert(factionRelationships)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          sourceFactionId: factionId,
          targetType: input.target.type,
          targetId: input.target.id,
          targetLabel: input.target.label,
          relationType: input.relationType,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          sourceChapterId: input.sourceChapterId,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!relationship) {
        throw new Error("Failed to create faction relationship");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toFactionRelationshipContract(relationship) };
    });
  }

  async addTerritory(
    userId: string,
    context: WorldWorkContext,
    factionId: string,
    input: TerritoryCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<Territory>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        factionId,
        "faction",
        null,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (input.node.branchId !== context.branchId) {
        return { kind: "target_not_found" };
      }
      const mapId = await resolveMapId(transaction, userId, context, input.node);
      if (!mapId) {
        return { kind: "target_not_found" };
      }
      const existing = await transaction
        .select({
          id: mapControl.id,
          factionId: mapControl.factionId,
          nodeId: mapControl.nodeId,
          validFromChapter: mapControl.validFromChapter,
          validToChapter: mapControl.validToChapter,
        })
        .from(mapControl)
        .where(
          and(
            eq(mapControl.userId, userId),
            eq(mapControl.workId, context.workId),
            eq(mapControl.branchId, context.branchId),
            eq(mapControl.nodeId, input.node.id),
            sql`(${mapControl.validToChapter} is null or ${mapControl.validToChapter} >= ${input.validity.fromChapter})`,
            input.validity.toChapter === null
              ? sql`true`
              : sql`${mapControl.validFromChapter} <= ${input.validity.toChapter}`,
          ),
        );
      if (
        findControlAreaConflicts(
          existing
            .filter((entry) => entry.factionId !== factionId)
            .concat({
              id: "candidate",
              factionId,
              nodeId: input.node.id,
              validFromChapter: input.validity.fromChapter,
              validToChapter: input.validity.toChapter,
            }),
        ).length > 0
      ) {
        return { kind: "control_overlap" };
      }

      const now = new Date();
      const versionNodeId = uuidv7();
      const id = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "territory",
        id,
        "faction.territory.created",
        "记录势力控制区",
      );
      const [territory] = await transaction
        .insert(mapControl)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          factionId,
          mapId,
          nodeType: input.node.type,
          nodeId: input.node.id,
          nodeLabel: input.node.label,
          controlLevel: input.controlLevel,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          evidence: input.evidence,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!territory) {
        throw new Error("Failed to create territory");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toTerritoryContract(territory) };
    });
  }

  async listMaps(
    userId: string,
    context: WorldWorkContext,
    options: ReadOptions,
  ): Promise<MapDetail[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "map"),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .orderBy(asc(entities.createdAt));
      const details: MapDetail[] = [];
      for (const row of rows) {
        const detail = await this.readMapInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          details.push(detail);
        }
      }
      return details;
    });
  }

  async getMap(
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    options: ReadOptions,
  ): Promise<MapDetail | undefined> {
    return this.withTenant(userId, async (transaction) =>
      this.readMapInTransaction(transaction, userId, context, mapId, options),
    );
  }

  async createMap(
    userId: string,
    context: WorldWorkContext,
    input: MapCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<MapDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findEntityConflict(
        transaction,
        userId,
        context,
        input.name,
        input.aliases,
      );
      if (conflict) {
        return conflict;
      }
      const now = new Date();
      const mapId = uuidv7();
      const [entity] = await transaction
        .insert(entities)
        .values({
          id: mapId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          type: "map",
          name: input.name,
          aliases: input.aliases,
          summary: input.summary,
          description: input.description,
          attributes: { details: input.details },
          tags: input.tags,
          status: "draft",
          source: "author",
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!entity) {
        throw new Error("Failed to create map");
      }
      await this.appendEntityVersion(
        transaction,
        userId,
        context,
        entity,
        headNodeId,
        "map.created",
        "创建地图",
        audit,
      );
      const detail = await this.readMapInTransaction(transaction, userId, context, mapId, {});
      if (!detail) {
        throw new Error("Created map is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async addMapLayer(
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    input: MapLayerCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<MapLayer>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(transaction, userId, context, mapId, "map", null);
      if (current.kind !== "ok") {
        return current;
      }
      if (
        input.parentLayerId &&
        !(await findLayer(transaction, userId, context, mapId, input.parentLayerId))
      ) {
        return { kind: "layer_mismatch" };
      }
      const now = new Date();
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "map_layer",
        id,
        "map.layer.created",
        "新增地图图层",
      );
      const [layer] = await transaction
        .insert(mapLayers)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          mapId,
          name: input.name,
          parentLayerId: input.parentLayerId,
          sortOrder: input.sortOrder,
          minScale: input.minScale,
          maxScale: input.maxScale,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!layer) {
        throw new Error("Failed to create map layer");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toMapLayerContract(layer) };
    });
  }

  async addMapNode(
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    input: MapNodeCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<MapNode>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(transaction, userId, context, mapId, "map", null);
      if (current.kind !== "ok") {
        return current;
      }
      if (input.layerId && !(await findLayer(transaction, userId, context, mapId, input.layerId))) {
        return { kind: "layer_mismatch" };
      }
      if (
        input.parentNodeId &&
        !(await findNode(transaction, userId, context, mapId, input.parentNodeId))
      ) {
        return { kind: "parent_mismatch" };
      }
      const now = new Date();
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "map_node",
        id,
        "map.node.created",
        "新增地图节点",
      );
      const [node] = await transaction
        .insert(mapNodes)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          mapId,
          layerId: input.layerId,
          parentNodeId: input.parentNodeId,
          name: input.name,
          nodeType: input.nodeType,
          summary: input.summary,
          x: input.x,
          y: input.y,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!node) {
        throw new Error("Failed to create map node");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toMapNodeContract(node) };
    });
  }

  async addMapEdge(
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    input: MapEdgeCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<MapEdge>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(transaction, userId, context, mapId, "map", null);
      if (current.kind !== "ok") {
        return current;
      }
      if (input.layerId && !(await findLayer(transaction, userId, context, mapId, input.layerId))) {
        return { kind: "layer_mismatch" };
      }
      if (
        !(await findNode(transaction, userId, context, mapId, input.fromNodeId)) ||
        !(await findNode(transaction, userId, context, mapId, input.toNodeId))
      ) {
        return { kind: "route_endpoint_mismatch" };
      }
      const now = new Date();
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "map_edge",
        id,
        "map.edge.created",
        "新增地图路线",
      );
      const [edge] = await transaction
        .insert(mapEdges)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          mapId,
          layerId: input.layerId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          routeType: input.routeType,
          bidirectional: input.bidirectional,
          travelMinutes: input.travelMinutes,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!edge) {
        throw new Error("Failed to create map edge");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toMapEdgeContract(edge) };
    });
  }

  async addMapMarker(
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    input: MapMarkerCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<MapMarker>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(transaction, userId, context, mapId, "map", null);
      if (current.kind !== "ok") {
        return current;
      }
      if (input.layerId && !(await findLayer(transaction, userId, context, mapId, input.layerId))) {
        return { kind: "layer_mismatch" };
      }
      if (input.nodeId && !(await findNode(transaction, userId, context, mapId, input.nodeId))) {
        return { kind: "target_not_found" };
      }
      const now = new Date();
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "map_marker",
        id,
        "map.marker.created",
        "新增地图标记",
      );
      const [marker] = await transaction
        .insert(mapMarkers)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          mapId,
          layerId: input.layerId,
          nodeId: input.nodeId,
          label: input.label,
          markerType: input.markerType,
          x: input.x,
          y: input.y,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!marker) {
        throw new Error("Failed to create map marker");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toMapMarkerContract(marker) };
    });
  }

  async getMapRoute(
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    fromNodeId: string,
    toNodeId: string,
    chapterNumber?: number,
  ): Promise<MapRoute | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const map = await findEntity(transaction, userId, context, mapId, "map");
      if (!map) {
        return undefined;
      }
      const [nodes, edges] = await Promise.all([
        transaction
          .select()
          .from(mapNodes)
          .where(
            and(
              eq(mapNodes.userId, userId),
              eq(mapNodes.workId, context.workId),
              eq(mapNodes.branchId, context.branchId),
              eq(mapNodes.mapId, mapId),
              chapterNumber === undefined
                ? sql`true`
                : sql`${mapNodes.validFromChapter} <= ${chapterNumber} and (${mapNodes.validToChapter} is null or ${mapNodes.validToChapter} >= ${chapterNumber})`,
            ),
          ),
        transaction
          .select()
          .from(mapEdges)
          .where(
            and(
              eq(mapEdges.userId, userId),
              eq(mapEdges.workId, context.workId),
              eq(mapEdges.branchId, context.branchId),
              eq(mapEdges.mapId, mapId),
              chapterNumber === undefined
                ? sql`true`
                : sql`${mapEdges.validFromChapter} <= ${chapterNumber} and (${mapEdges.validToChapter} is null or ${mapEdges.validToChapter} >= ${chapterNumber})`,
            ),
          ),
      ]);
      const route = findShortestMapRoute(
        nodes.map((node) => ({ id: node.id, mapId: node.mapId })),
        edges.map((edge) => ({
          id: edge.id,
          mapId: edge.mapId,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          bidirectional: edge.bidirectional,
          travelMinutes: edge.travelMinutes,
        })),
        fromNodeId,
        toNodeId,
      );
      return route ? { mapId, fromNodeId, toNodeId, ...route } : undefined;
    });
  }

  async createTimelineEra(
    userId: string,
    context: WorldWorkContext,
    input: TimelineEraCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<TimelineEra>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existing] = await transaction
        .select({ id: timelineEras.id })
        .from(timelineEras)
        .where(
          and(
            eq(timelineEras.userId, userId),
            eq(timelineEras.workId, context.workId),
            eq(timelineEras.branchId, context.branchId),
            eq(timelineEras.name, input.name),
          ),
        )
        .limit(1);
      if (existing) {
        return { kind: "name_conflict" };
      }
      const id = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "timeline_era",
        id,
        "timeline.era.created",
        "新增故事纪元",
      );
      const [era] = await transaction
        .insert(timelineEras)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          name: input.name,
          orderIndex: input.orderIndex,
          startSortKey: input.startSortKey,
          endSortKey: input.endSortKey,
          description: input.description,
          versionNodeId,
          createdBy: userId,
          createdAt: new Date(),
        })
        .returning();
      if (!era) {
        throw new Error("Failed to create timeline era");
      }
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: new Date() })
        .where(eq(workBranches.id, context.branchId));
      await writeAudit(transaction, userId, audit, "timeline.era.created", "timeline_era", id);
      return { kind: "ok", value: toTimelineEraContract(era) };
    });
  }

  async createTimelineEvent(
    userId: string,
    context: WorldWorkContext,
    input: TimelineEventCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<TimelineEventDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const [era] = await transaction
        .select({ id: timelineEras.id })
        .from(timelineEras)
        .where(
          and(
            eq(timelineEras.userId, userId),
            eq(timelineEras.workId, context.workId),
            eq(timelineEras.branchId, context.branchId),
            eq(timelineEras.name, input.era),
          ),
        )
        .limit(1);
      if (!era) {
        return { kind: "timeline_era_not_found" };
      }
      const [conflict] = await transaction
        .select({ id: timelineEvents.id })
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.userId, userId),
            eq(timelineEvents.workId, context.workId),
            eq(timelineEvents.branchId, context.branchId),
            eq(timelineEvents.era, input.era),
            eq(timelineEvents.storyTimeSortKey, input.storyTime.sortKey),
          ),
        )
        .limit(1);
      if (conflict) {
        return { kind: "timeline_overlap" };
      }
      const entityConflict = await findEntityConflict(
        transaction,
        userId,
        context,
        input.name,
        input.aliases,
      );
      if (entityConflict) {
        return entityConflict;
      }
      const id = uuidv7();
      const now = new Date();
      const [entity] = await transaction
        .insert(entities)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          type: "timeline_event",
          name: input.name,
          aliases: input.aliases,
          summary: input.summary,
          description: input.description,
          attributes: {
            era: input.era,
            storyTime: input.storyTime.label,
            storySortKey: input.storyTime.sortKey,
            duration: input.durationLabel,
            event: input.event,
          },
          tags: input.tags,
          status: "draft",
          source: "author",
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!entity) {
        throw new Error("Failed to create timeline event entity");
      }
      await this.appendEntityVersion(
        transaction,
        userId,
        context,
        entity,
        headNodeId,
        "timeline.event.created",
        "新增故事事件",
        audit,
      );
      const [version] = await transaction
        .select({ versionNodeId: entityVersions.versionNodeId })
        .from(entityVersions)
        .where(
          and(
            eq(entityVersions.entityId, id),
            eq(entityVersions.userId, userId),
            eq(entityVersions.workId, context.workId),
            eq(entityVersions.branchId, context.branchId),
          ),
        )
        .orderBy(desc(entityVersions.version))
        .limit(1);
      if (!version) {
        throw new Error("Timeline event version is missing");
      }
      const [event] = await transaction
        .insert(timelineEvents)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          era: input.era,
          storyTimeLabel: input.storyTime.label,
          storyTimeSortKey: input.storyTime.sortKey,
          durationMinutes: input.durationMinutes,
          durationLabel: input.durationLabel,
          eventText: input.event,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          versionNodeId: version.versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!event) {
        throw new Error("Failed to create timeline event");
      }
      return { kind: "ok", value: toTimelineEventContract(event, entity) };
    });
  }

  async getTimeline(
    userId: string,
    context: WorldWorkContext,
    options: ReadOptions,
  ): Promise<WorldTimeline> {
    return this.withTenant(userId, async (transaction) =>
      this.readTimelineInTransaction(transaction, userId, context, options),
    );
  }

  async createItinerary(
    userId: string,
    context: WorldWorkContext,
    input: CharacterItineraryCreateRequest,
    audit: WorldAuditContext,
  ): Promise<WorldWriteResult<CharacterItinerary>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const character = await findWritableEntity(
        transaction,
        userId,
        context,
        input.character.id,
        "character",
        null,
      );
      if (character.kind !== "ok") {
        return character;
      }
      if (
        input.fromNode.branchId !== context.branchId ||
        input.toNode.branchId !== context.branchId
      ) {
        return { kind: "target_not_found" };
      }
      const fromNode = await transaction
        .select()
        .from(mapNodes)
        .where(
          and(
            eq(mapNodes.id, input.fromNode.id),
            eq(mapNodes.userId, userId),
            eq(mapNodes.workId, context.workId),
            eq(mapNodes.branchId, context.branchId),
            sql`${mapNodes.validFromChapter} <= ${input.validity.fromChapter}`,
            sql`(${mapNodes.validToChapter} is null or ${mapNodes.validToChapter} >= ${input.validity.fromChapter})`,
          ),
        )
        .limit(1);
      const toNode = await transaction
        .select()
        .from(mapNodes)
        .where(
          and(
            eq(mapNodes.id, input.toNode.id),
            eq(mapNodes.userId, userId),
            eq(mapNodes.workId, context.workId),
            eq(mapNodes.branchId, context.branchId),
            sql`${mapNodes.validFromChapter} <= ${input.validity.fromChapter}`,
            sql`(${mapNodes.validToChapter} is null or ${mapNodes.validToChapter} >= ${input.validity.fromChapter})`,
          ),
        )
        .limit(1);
      if (!fromNode[0] || !toNode[0] || fromNode[0].mapId !== toNode[0].mapId) {
        return { kind: "route_disconnected" };
      }
      const nodes = await transaction
        .select()
        .from(mapNodes)
        .where(
          and(
            eq(mapNodes.userId, userId),
            eq(mapNodes.workId, context.workId),
            eq(mapNodes.branchId, context.branchId),
            eq(mapNodes.mapId, fromNode[0].mapId),
            sql`${mapNodes.validFromChapter} <= ${input.validity.fromChapter}`,
            sql`(${mapNodes.validToChapter} is null or ${mapNodes.validToChapter} >= ${input.validity.fromChapter})`,
          ),
        );
      const edges = await transaction
        .select()
        .from(mapEdges)
        .where(
          and(
            eq(mapEdges.userId, userId),
            eq(mapEdges.workId, context.workId),
            eq(mapEdges.branchId, context.branchId),
            eq(mapEdges.mapId, fromNode[0].mapId),
            sql`${mapEdges.validFromChapter} <= ${input.validity.fromChapter}`,
            sql`(${mapEdges.validToChapter} is null or ${mapEdges.validToChapter} >= ${input.validity.fromChapter})`,
          ),
        );
      const route = findShortestMapRoute(
        nodes.map((node) => ({ id: node.id, mapId: node.mapId })),
        edges.map((edge) => ({
          id: edge.id,
          mapId: edge.mapId,
          fromNodeId: edge.fromNodeId,
          toNodeId: edge.toNodeId,
          bidirectional: edge.bidirectional,
          travelMinutes: edge.travelMinutes,
        })),
        input.fromNode.id,
        input.toNode.id,
      );
      if (!route) {
        return { kind: "route_disconnected" };
      }
      if (
        input.travelMinutes < route.travelMinutes ||
        input.arrival.sortKey - input.departure.sortKey < input.travelMinutes
      ) {
        return { kind: "route_time_conflict" };
      }
      const existingRows = await transaction
        .select()
        .from(characterItineraries)
        .where(
          and(
            eq(characterItineraries.userId, userId),
            eq(characterItineraries.workId, context.workId),
            eq(characterItineraries.branchId, context.branchId),
            eq(characterItineraries.characterId, input.character.id),
          ),
        );
      const findings = validateItinerarySchedule(
        {
          characterId: input.character.id,
          departureSortKey: input.departure.sortKey,
          arrivalSortKey: input.arrival.sortKey,
          travelMinutes: input.travelMinutes,
        },
        existingRows
          .filter(
            (row) =>
              row.departureEra === input.departure.era && row.arrivalEra === input.arrival.era,
          )
          .map((row) => ({
            id: row.id,
            characterId: row.characterId,
            departureSortKey: row.departureSortKey,
            arrivalSortKey: row.arrivalSortKey,
          })),
      );
      if (findings.some((finding) => finding.code === "ITINERARY_TIME_ORDER")) {
        return { kind: "itinerary_time_order" };
      }
      if (findings.some((finding) => finding.code === "ITINERARY_OVERLAP")) {
        return { kind: "itinerary_overlap" };
      }

      const id = uuidv7();
      const versionNodeId = uuidv7();
      const now = new Date();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "itinerary",
        id,
        "timeline.itinerary.created",
        "记录角色行程",
      );
      const [itinerary] = await transaction
        .insert(characterItineraries)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          characterId: input.character.id,
          fromNodeId: input.fromNode.id,
          toNodeId: input.toNode.id,
          departureEra: input.departure.era,
          departureLabel: input.departure.label,
          departureSortKey: input.departure.sortKey,
          arrivalEra: input.arrival.era,
          arrivalLabel: input.arrival.label,
          arrivalSortKey: input.arrival.sortKey,
          routeTravelMinutes: route.travelMinutes,
          travelMinutes: input.travelMinutes,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          sourceChapterId: input.sourceChapterId,
          evidence: input.evidence,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!itinerary) {
        throw new Error("Failed to create itinerary");
      }
      const updated = await advanceEntityVersion(
        transaction,
        character.value,
        versionNodeId,
        context,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return {
        kind: "ok",
        value: toItineraryContract(itinerary, input.character, input.fromNode, input.toNode),
      };
    });
  }

  async getSnapshot(
    userId: string,
    context: WorldWorkContext,
    options: ReadOptions,
  ): Promise<Omit<WorldSnapshot, "powerSystems" | "mechanisms" | "items">> {
    return this.withTenant(userId, async (transaction) => {
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const factionRows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "faction"),
            sql`${entities.deletedAt} is null`,
          ),
        );
      const mapRows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "map"),
            sql`${entities.deletedAt} is null`,
          ),
        );
      const factions = [];
      for (const row of factionRows) {
        const detail = await this.readFactionInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          factions.push(detail);
        }
      }
      const maps = [];
      for (const row of mapRows) {
        const detail = await this.readMapInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          maps.push(detail);
        }
      }
      return {
        at: {
          versionNodeId: options.versionNodeIds ? (options.versionNodeIds[0] ?? null) : null,
          chapterNumber: options.chapterNumber ?? null,
        },
        factions,
        maps,
        timeline: {
          ...(await this.readTimelineInTransaction(transaction, userId, context, options)),
          latestVersionNodeId: headNodeId,
        },
      };
    });
  }

  async resolveVersionNodeIds(
    userId: string,
    context: WorldWorkContext,
    versionNodeId: string,
  ): Promise<string[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: versionNodes.id, parentNodeId: versionNodes.parentNodeId })
        .from(versionNodes)
        .where(
          and(
            eq(versionNodes.userId, userId),
            eq(versionNodes.workId, context.workId),
            eq(versionNodes.branchId, context.branchId),
          ),
        );
      const byId = new Map(rows.map((row) => [row.id, row.parentNodeId] as const));
      if (!byId.has(versionNodeId)) {
        return [];
      }
      const ancestorIds: string[] = [];
      let cursor: string | null = versionNodeId;
      while (cursor) {
        ancestorIds.push(cursor);
        cursor = byId.get(cursor) ?? null;
      }
      return ancestorIds;
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async readFactionInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: WorldWorkContext,
    factionId: string,
    options: ReadOptions,
  ): Promise<FactionDetail | undefined> {
    const entity = await findEntity(transaction, userId, context, factionId, "faction");
    if (!entity) {
      return undefined;
    }
    const versionFilter =
      options.versionNodeIds === undefined
        ? undefined
        : inArray(factionRelationships.versionNodeId, options.versionNodeIds);
    const [profileRows, relationshipRows, territoryRows, allTerritories, branch] =
      await Promise.all([
        transaction
          .select()
          .from(factionProfiles)
          .where(eq(factionProfiles.entityId, factionId))
          .limit(1),
        transaction
          .select()
          .from(factionRelationships)
          .where(
            and(
              eq(factionRelationships.userId, userId),
              eq(factionRelationships.workId, context.workId),
              eq(factionRelationships.branchId, context.branchId),
              eq(factionRelationships.sourceFactionId, factionId),
              versionFilter,
            ),
          )
          .orderBy(asc(factionRelationships.validFromChapter)),
        transaction
          .select()
          .from(mapControl)
          .where(
            and(
              eq(mapControl.userId, userId),
              eq(mapControl.workId, context.workId),
              eq(mapControl.branchId, context.branchId),
              eq(mapControl.factionId, factionId),
              options.versionNodeIds === undefined
                ? undefined
                : inArray(mapControl.versionNodeId, options.versionNodeIds),
            ),
          )
          .orderBy(asc(mapControl.validFromChapter)),
        transaction
          .select()
          .from(mapControl)
          .where(
            and(
              eq(mapControl.userId, userId),
              eq(mapControl.workId, context.workId),
              eq(mapControl.branchId, context.branchId),
              options.versionNodeIds === undefined
                ? undefined
                : inArray(mapControl.versionNodeId, options.versionNodeIds),
            ),
          ),
        transaction
          .select({ headNodeId: workBranches.headNodeId })
          .from(workBranches)
          .where(eq(workBranches.id, context.branchId))
          .limit(1),
      ]);
    const territories = territoryRows
      .map(toTerritoryContract)
      .filter((territory) => chapterActive(territory.validity, options.chapterNumber));
    const controlConflicts = findControlAreaConflicts(
      allTerritories.map((territory) => ({
        id: territory.id,
        factionId: territory.factionId,
        nodeId: territory.nodeId,
        validFromChapter: territory.validFromChapter,
        validToChapter: territory.validToChapter,
      })),
    ).filter(
      (conflict) =>
        conflict.leftId !== conflict.rightId &&
        (conflict.leftId === factionId ||
          allTerritories.some(
            (item) => item.id === conflict.leftId && item.factionId === factionId,
          )),
    );
    const profile = profileRows[0]
      ? toFactionProfileContract(profileRows[0])
      : syntheticFactionProfile(entity);
    const health = [
      ...(profile.goals.trim()
        ? []
        : [
            {
              code: "FACTION_GOAL_MISSING",
              severity: "warning" as const,
              message: "势力还没有记录当前目标。",
              relatedIds: [],
            },
          ]),
      ...controlConflicts.map((conflict) => ({
        code: conflict.code,
        severity: "blocker" as const,
        message: "同一地点在重叠章节内被多个势力控制。",
        relatedIds: [conflict.leftId, conflict.rightId],
      })),
    ];
    const headNodeId = branch[0]?.headNodeId;
    if (!headNodeId) {
      throw new Error("World branch is missing its version head");
    }
    return {
      faction: entityRef(entity),
      profile,
      relationships: relationshipRows
        .map(toFactionRelationshipContract)
        .filter((relationship) => chapterActive(relationship.validity, options.chapterNumber)),
      territories,
      health,
      version: entity.version,
      latestVersionNodeId: headNodeId,
      status: entity.status as FactionDetail["status"],
      lockedAt: entity.lockedAt?.toISOString() ?? null,
    };
  }

  private async readMapInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: WorldWorkContext,
    mapId: string,
    options: ReadOptions,
  ): Promise<MapDetail | undefined> {
    const entity = await findEntity(transaction, userId, context, mapId, "map");
    if (!entity) {
      return undefined;
    }
    const [layers, nodes, edges, markers, control, branch] = await Promise.all([
      transaction
        .select()
        .from(mapLayers)
        .where(
          and(
            eq(mapLayers.userId, userId),
            eq(mapLayers.workId, context.workId),
            eq(mapLayers.branchId, context.branchId),
            eq(mapLayers.mapId, mapId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(mapLayers.versionNodeId, options.versionNodeIds),
          ),
        )
        .orderBy(asc(mapLayers.sortOrder)),
      transaction
        .select()
        .from(mapNodes)
        .where(
          and(
            eq(mapNodes.userId, userId),
            eq(mapNodes.workId, context.workId),
            eq(mapNodes.branchId, context.branchId),
            eq(mapNodes.mapId, mapId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(mapNodes.versionNodeId, options.versionNodeIds),
          ),
        )
        .orderBy(asc(mapNodes.createdAt)),
      transaction
        .select()
        .from(mapEdges)
        .where(
          and(
            eq(mapEdges.userId, userId),
            eq(mapEdges.workId, context.workId),
            eq(mapEdges.branchId, context.branchId),
            eq(mapEdges.mapId, mapId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(mapEdges.versionNodeId, options.versionNodeIds),
          ),
        ),
      transaction
        .select()
        .from(mapMarkers)
        .where(
          and(
            eq(mapMarkers.userId, userId),
            eq(mapMarkers.workId, context.workId),
            eq(mapMarkers.branchId, context.branchId),
            eq(mapMarkers.mapId, mapId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(mapMarkers.versionNodeId, options.versionNodeIds),
          ),
        ),
      transaction
        .select()
        .from(mapControl)
        .where(
          and(
            eq(mapControl.userId, userId),
            eq(mapControl.workId, context.workId),
            eq(mapControl.branchId, context.branchId),
            eq(mapControl.mapId, mapId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(mapControl.versionNodeId, options.versionNodeIds),
          ),
        ),
      transaction
        .select({ headNodeId: workBranches.headNodeId })
        .from(workBranches)
        .where(eq(workBranches.id, context.branchId))
        .limit(1),
    ]);
    const layerContracts = layers
      .map(toMapLayerContract)
      .filter((layer) => chapterActive(layer.validity, options.chapterNumber));
    const nodeContracts = nodes
      .map(toMapNodeContract)
      .filter((node) => chapterActive(node.validity, options.chapterNumber));
    const edgeContracts = edges
      .map(toMapEdgeContract)
      .filter((edge) => chapterActive(edge.validity, options.chapterNumber));
    const markerContracts = markers
      .map(toMapMarkerContract)
      .filter((marker) => chapterActive(marker.validity, options.chapterNumber));
    const controlContracts = control
      .map(toTerritoryContract)
      .filter((territory) => chapterActive(territory.validity, options.chapterNumber));
    const nodeIds = new Set(nodeContracts.map((node) => node.id));
    const danglingEdges = edgeContracts.filter(
      (edge) => !nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId),
    );
    const headNodeId = branch[0]?.headNodeId;
    if (!headNodeId) {
      throw new Error("World branch is missing its version head");
    }
    return {
      map: entityRef(entity),
      layers: layerContracts,
      nodes: nodeContracts,
      edges: edgeContracts,
      markers: markerContracts,
      controlAreas: controlContracts,
      health: danglingEdges.map((edge) => ({
        code: "MAP_ROUTE_DANGLING",
        severity: "blocker" as const,
        message: "路线引用了当前时间范围之外或不存在的节点。",
        relatedIds: [edge.id],
      })),
      version: entity.version,
      latestVersionNodeId: headNodeId,
      status: entity.status as MapDetail["status"],
      lockedAt: entity.lockedAt?.toISOString() ?? null,
    };
  }

  private async readTimelineInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: WorldWorkContext,
    options: ReadOptions,
  ): Promise<WorldTimeline> {
    const [eras, eventRows, itineraryRows, branch] = await Promise.all([
      transaction
        .select()
        .from(timelineEras)
        .where(
          and(
            eq(timelineEras.userId, userId),
            eq(timelineEras.workId, context.workId),
            eq(timelineEras.branchId, context.branchId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(timelineEras.versionNodeId, options.versionNodeIds),
          ),
        )
        .orderBy(asc(timelineEras.orderIndex)),
      transaction
        .select()
        .from(timelineEvents)
        .where(
          and(
            eq(timelineEvents.userId, userId),
            eq(timelineEvents.workId, context.workId),
            eq(timelineEvents.branchId, context.branchId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(timelineEvents.versionNodeId, options.versionNodeIds),
          ),
        ),
      transaction
        .select()
        .from(characterItineraries)
        .where(
          and(
            eq(characterItineraries.userId, userId),
            eq(characterItineraries.workId, context.workId),
            eq(characterItineraries.branchId, context.branchId),
            options.versionNodeIds === undefined
              ? undefined
              : inArray(characterItineraries.versionNodeId, options.versionNodeIds),
          ),
        )
        .orderBy(asc(characterItineraries.departureSortKey)),
      transaction
        .select({ headNodeId: workBranches.headNodeId })
        .from(workBranches)
        .where(eq(workBranches.id, context.branchId))
        .limit(1),
    ]);
    const [eventEntities, itineraryNodes] = await Promise.all([
      transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            inArray(entities.type, ["timeline_event", "character"]),
            sql`${entities.deletedAt} is null`,
          ),
        ),
      transaction
        .select()
        .from(mapNodes)
        .where(
          and(
            eq(mapNodes.userId, userId),
            eq(mapNodes.workId, context.workId),
            eq(mapNodes.branchId, context.branchId),
          ),
        ),
    ]);
    const entityById = new Map(eventEntities.map((entity) => [entity.id, entity] as const));
    const nodeById = new Map(itineraryNodes.map((node) => [node.id, node] as const));
    const eraContracts = eras.map(toTimelineEraContract);
    const events = eventRows.flatMap((event) => {
      const entity = entityById.get(event.id);
      return entity ? [toTimelineEventContract(event, entity)] : [];
    });
    if (options.versionNodeIds === undefined) {
      const dedicatedIds = new Set(eventRows.map((event) => event.id));
      const headNodeId = branch[0]?.headNodeId;
      if (headNodeId) {
        for (const entity of eventEntities) {
          if (entity.type !== "timeline_event" || dedicatedIds.has(entity.id)) {
            continue;
          }
          const era = stringAttribute(entity.attributes.era) || "未分纪元";
          const storyTimeLabel = stringAttribute(entity.attributes.storyTime) || "未记录";
          const storyTimeSortKey = numberAttribute(entity.attributes.storySortKey) ?? 0;
          events.push({
            event: entityRef(entity),
            era,
            storyTime: { era, label: storyTimeLabel, sortKey: storyTimeSortKey },
            durationMinutes: 0,
            durationLabel: stringAttribute(entity.attributes.duration) || "",
            eventText: stringAttribute(entity.attributes.event) || entity.summary,
            validity: {
              fromChapter: 1,
              toChapter: null,
              fromStoryTime: null,
              toStoryTime: null,
            },
            versionNodeId: headNodeId,
            createdAt: entity.createdAt.toISOString(),
          });
        }
      }
    }
    const orderedEvents = sortTimelineEvents<
      TimelineEventDetail & { id: string; era: string; sortKey: number }
    >(
      eraContracts,
      events.map((event) => ({
        ...event,
        id: event.event.id,
        era: event.storyTime.era,
        sortKey: event.storyTime.sortKey,
      })),
    ).filter((event) => chapterActive(event.validity, options.chapterNumber));
    const itineraries = itineraryRows
      .map((row) => {
        const character = entityById.get(row.characterId);
        const fromNode = nodeById.get(row.fromNodeId);
        const toNode = nodeById.get(row.toNodeId);
        return toItineraryContract(
          row,
          character
            ? entityRef(character)
            : syntheticRef("character", row.characterId, context.branchId),
          fromNode
            ? syntheticRef("map_node", fromNode.id, context.branchId, fromNode.name)
            : syntheticRef("map_node", row.fromNodeId, context.branchId),
          toNode
            ? syntheticRef("map_node", toNode.id, context.branchId, toNode.name)
            : syntheticRef("map_node", row.toNodeId, context.branchId),
        );
      })
      .filter((itinerary) => chapterActive(itinerary.validity, options.chapterNumber));
    const health: WorldTimeline["health"] = [
      ...findTimelineOrderConflicts(
        orderedEvents.map((event) => ({
          id: event.event.id,
          era: event.storyTime.era,
          sortKey: event.storyTime.sortKey,
        })),
      ).map((conflict) => ({
        code: conflict.code,
        severity: "blocker" as const,
        message: "同一纪元已有事件占用相同故事时间。",
        relatedIds: conflict.eventIds,
      })),
    ];
    for (let index = 0; index < itineraries.length; index += 1) {
      const itinerary = itineraries[index]!;
      const previous = itineraries
        .slice(0, index)
        .filter(
          (entry) =>
            entry.departure.era === itinerary.departure.era &&
            entry.arrival.era === itinerary.arrival.era,
        )
        .map((entry) => ({
          id: entry.id,
          characterId: entry.character.id,
          departureSortKey: entry.departure.sortKey,
          arrivalSortKey: entry.arrival.sortKey,
        }));
      const findings = validateItinerarySchedule(
        {
          characterId: itinerary.character.id,
          departureSortKey: itinerary.departure.sortKey,
          arrivalSortKey: itinerary.arrival.sortKey,
          travelMinutes: itinerary.travelMinutes,
        },
        previous,
      );
      for (const finding of findings) {
        health.push({
          code: finding.code,
          severity: "blocker",
          message:
            finding.code === "ITINERARY_OVERLAP"
              ? "角色行程在故事时间上发生重叠。"
              : "角色行程的时间不足以完成路线。",
          relatedIds: finding.relatedId ? [itinerary.id, finding.relatedId] : [itinerary.id],
        });
      }
    }
    const headNodeId = branch[0]?.headNodeId;
    if (!headNodeId) {
      throw new Error("World branch is missing its version head");
    }
    return {
      eras: eraContracts,
      events: orderedEvents,
      itineraries,
      health,
      latestVersionNodeId: headNodeId,
    };
  }

  private async appendEntityVersion(
    transaction: DatabaseTransaction,
    userId: string,
    context: WorldWorkContext,
    entity: EntityRecord,
    parentNodeId: string,
    action: string,
    message: string,
    audit: WorldAuditContext,
  ): Promise<void> {
    const versionNodeId = uuidv7();
    await insertVersionNode(
      transaction,
      userId,
      context,
      parentNodeId,
      versionNodeId,
      entity.type,
      entity.id,
      action,
      message,
    );
    await this.appendSnapshotAtVersion(transaction, userId, context, entity, versionNodeId, audit);
    await transaction
      .update(workBranches)
      .set({ headNodeId: versionNodeId, updatedAt: new Date() })
      .where(eq(workBranches.id, context.branchId));
  }

  private async appendSnapshotAtVersion(
    transaction: DatabaseTransaction,
    userId: string,
    context: WorldWorkContext,
    entity: EntityRecord,
    versionNodeId: string,
    audit: WorldAuditContext,
  ): Promise<void> {
    const entityVersionId = uuidv7();
    const snapshot = entitySnapshot(entity);
    if (entity.type === "faction") {
      const [profile] = await transaction
        .select()
        .from(factionProfiles)
        .where(
          and(
            eq(factionProfiles.entityId, entity.id),
            eq(factionProfiles.userId, userId),
            eq(factionProfiles.workId, context.workId),
            eq(factionProfiles.branchId, context.branchId),
          ),
        )
        .limit(1);
      if (profile) {
        snapshot.domain = {
          profile: toFactionProfileContract(profile),
        };
      }
    }
    await transaction
      .update(versionNodes)
      .set({ snapshotId: entityVersionId, objectVersion: entity.version })
      .where(eq(versionNodes.id, versionNodeId));
    await transaction.insert(entityVersions).values({
      id: entityVersionId,
      entityId: entity.id,
      workId: context.workId,
      branchId: context.branchId,
      userId,
      version: entity.version,
      snapshot,
      versionNodeId,
      createdBy: userId,
      createdAt: new Date(),
    });
    await writeAudit(transaction, userId, audit, "world.versioned", entity.type, entity.id);
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return withTenantTransaction(this.db, userId, operation);
  }
}

async function findEntity(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  entityId: string,
  type: "faction" | "map" | "timeline_event" | "character",
): Promise<EntityRecord | undefined> {
  const [entity] = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, type),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .limit(1);
  return entity;
}

async function findWritableEntity(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  entityId: string,
  type: "faction" | "map" | "timeline_event" | "character",
  expectedVersion: number | null,
): Promise<
  | { kind: "ok"; value: EntityRecord }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "proposal_state" }
  | { kind: "version_conflict" }
> {
  const [entity] = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, type),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .for("update")
    .limit(1);
  if (!entity) {
    return { kind: "not_found" };
  }
  if (entity.status === "locked") {
    return { kind: "locked" };
  }
  if (entity.status === "proposed" || entity.status === "discarded") {
    return { kind: "proposal_state" };
  }
  if (expectedVersion !== null && entity.version !== expectedVersion) {
    return { kind: "version_conflict" };
  }
  return { kind: "ok", value: entity };
}

async function findLayer(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  mapId: string,
  layerId: string,
): Promise<boolean> {
  const [layer] = await transaction
    .select({ id: mapLayers.id })
    .from(mapLayers)
    .where(
      and(
        eq(mapLayers.id, layerId),
        eq(mapLayers.userId, userId),
        eq(mapLayers.workId, context.workId),
        eq(mapLayers.branchId, context.branchId),
        eq(mapLayers.mapId, mapId),
      ),
    )
    .limit(1);
  return Boolean(layer);
}

async function findNode(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  mapId: string,
  nodeId: string,
): Promise<boolean> {
  const [node] = await transaction
    .select({ id: mapNodes.id })
    .from(mapNodes)
    .where(
      and(
        eq(mapNodes.id, nodeId),
        eq(mapNodes.userId, userId),
        eq(mapNodes.workId, context.workId),
        eq(mapNodes.branchId, context.branchId),
        eq(mapNodes.mapId, mapId),
      ),
    )
    .limit(1);
  return Boolean(node);
}

async function resolveMapId(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  ref: DomainRef,
): Promise<string | undefined> {
  if (ref.type === "map") {
    return (await findEntity(transaction, userId, context, ref.id, "map"))?.id;
  }
  if (ref.type !== "map_node") {
    return undefined;
  }
  const [node] = await transaction
    .select({ mapId: mapNodes.mapId })
    .from(mapNodes)
    .where(
      and(
        eq(mapNodes.id, ref.id),
        eq(mapNodes.userId, userId),
        eq(mapNodes.workId, context.workId),
        eq(mapNodes.branchId, context.branchId),
      ),
    )
    .limit(1);
  return node?.mapId;
}

async function findEntityConflict(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  name: string,
  aliases: string[],
): Promise<{ kind: "name_conflict" } | { kind: "alias_conflict" } | undefined> {
  const normalizedName = normalizeIdentifier(name);
  const normalizedAliases = aliases.map(normalizeIdentifier);
  if (
    new Set(normalizedAliases).size !== normalizedAliases.length ||
    normalizedAliases.includes(normalizedName)
  ) {
    return { kind: "alias_conflict" };
  }
  const rows = await transaction
    .select({ name: entities.name, aliases: entities.aliases })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        sql`${entities.deletedAt} is null`,
      ),
    );
  for (const row of rows) {
    if (normalizeIdentifier(row.name) === normalizedName) {
      return { kind: "name_conflict" };
    }
    const identifiers = [row.name, ...row.aliases].map(normalizeIdentifier);
    if (normalizedAliases.some((alias) => identifiers.includes(alias))) {
      return { kind: "alias_conflict" };
    }
  }
  return undefined;
}

async function insertVersionNode(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
  parentNodeId: string,
  versionNodeId: string,
  objectType: string,
  objectId: string,
  action: string,
  message: string,
): Promise<void> {
  await transaction.insert(versionNodes).values({
    id: versionNodeId,
    workId: context.workId,
    branchId: context.branchId,
    userId,
    parentNodeId,
    nodeType: "entity_version",
    objectType,
    objectId,
    objectVersion: 1,
    snapshotId: null,
    payload: { action },
    actorId: userId,
    message,
    createdAt: new Date(),
  });
}

async function advanceEntityVersion(
  transaction: DatabaseTransaction,
  entity: EntityRecord,
  versionNodeId: string,
  context: WorldWorkContext,
  now: Date,
): Promise<EntityRecord> {
  const [updated] = await transaction
    .update(entities)
    .set({ version: entity.version + 1, updatedAt: now })
    .where(and(eq(entities.id, entity.id), eq(entities.version, entity.version)))
    .returning();
  if (!updated) {
    throw new Error("World entity changed while applying a versioned write");
  }
  await transaction
    .update(versionNodes)
    .set({ objectVersion: updated.version })
    .where(eq(versionNodes.id, versionNodeId));
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
  return updated;
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: WorldWorkContext,
): Promise<string> {
  const [branch] = await transaction
    .select({ headNodeId: workBranches.headNodeId })
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("World branch is missing its version head");
  }
  return branch.headNodeId;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: WorldAuditContext,
  action: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType,
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

function storyTimeColumns(validity: ValidityInterval) {
  return {
    fromEra: validity.fromStoryTime?.era ?? null,
    fromStoryTimeLabel: validity.fromStoryTime?.label ?? null,
    fromStorySortKey: validity.fromStoryTime?.sortKey ?? null,
    toEra: validity.toStoryTime?.era ?? null,
    toStoryTimeLabel: validity.toStoryTime?.label ?? null,
    toStorySortKey: validity.toStoryTime?.sortKey ?? null,
  };
}

function validityFromRow(row: ValidityColumns): ValidityInterval {
  return {
    fromChapter: row.validFromChapter,
    toChapter: row.validToChapter,
    fromStoryTime: storyTimeFromColumns(row.fromEra, row.fromStoryTimeLabel, row.fromStorySortKey),
    toStoryTime: storyTimeFromColumns(row.toEra, row.toStoryTimeLabel, row.toStorySortKey),
  };
}

function storyTimeFromColumns(
  era: string | null,
  label: string | null,
  sortKey: number | null,
): StoryTimePoint | null {
  if (era === null || label === null || sortKey === null) {
    return null;
  }
  return { era, label, sortKey };
}

function chapterActive(validity: ValidityInterval, chapterNumber?: number): boolean {
  return (
    chapterNumber === undefined ||
    (validity.fromChapter <= chapterNumber &&
      (validity.toChapter === null || validity.toChapter >= chapterNumber))
  );
}

function entityRef(entity: EntityRecord): DomainRef {
  return syntheticRef(entity.type as DomainRef["type"], entity.id, entity.branchId, entity.name);
}

function syntheticRef(
  type: DomainRef["type"],
  id: string,
  branchId: string,
  label: string | null = null,
): DomainRef {
  return { type, id, branchId, label, version: null };
}

function entitySnapshot(entity: EntityRecord): Record<string, unknown> {
  return {
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
  };
}

function emptyFactionProfile(): FactionProfile {
  return { overview: "", goals: "", resources: "", doctrine: "" };
}

function syntheticFactionProfile(entity: EntityRecord): FactionProfile {
  const details = typeof entity.attributes.details === "string" ? entity.attributes.details : "";
  return { ...emptyFactionProfile(), overview: details };
}

function toFactionProfileContract(row: FactionProfileRecord): FactionProfile {
  return {
    overview: row.overview,
    goals: row.goals,
    resources: row.resources,
    doctrine: row.doctrine,
  };
}

function toFactionRelationshipContract(row: FactionRelationshipRecord): FactionRelationship {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    sourceFactionId: row.sourceFactionId,
    target: syntheticRef(
      row.targetType as DomainRef["type"],
      row.targetId,
      row.branchId,
      row.targetLabel,
    ),
    relationType: row.relationType as FactionRelationship["relationType"],
    validity: validityFromRow(row),
    sourceChapterId: row.sourceChapterId,
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTerritoryContract(row: TerritoryRecord): Territory {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    factionId: row.factionId,
    node: syntheticRef(row.nodeType as DomainRef["type"], row.nodeId, row.branchId, row.nodeLabel),
    controlLevel: row.controlLevel as Territory["controlLevel"],
    validity: validityFromRow(row),
    evidence: row.evidence as Territory["evidence"],
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMapLayerContract(row: MapLayerRecord): MapLayer {
  return {
    id: row.id,
    mapId: row.mapId,
    workId: row.workId,
    branchId: row.branchId,
    name: row.name,
    parentLayerId: row.parentLayerId,
    sortOrder: row.sortOrder,
    minScale: row.minScale,
    maxScale: row.maxScale,
    validity: validityFromRow(row),
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMapNodeContract(row: MapNodeRecord): MapNode {
  return {
    id: row.id,
    mapId: row.mapId,
    workId: row.workId,
    branchId: row.branchId,
    layerId: row.layerId,
    parentNodeId: row.parentNodeId,
    name: row.name,
    nodeType: row.nodeType as MapNode["nodeType"],
    summary: row.summary,
    x: row.x,
    y: row.y,
    validity: validityFromRow(row),
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMapEdgeContract(row: MapEdgeRecord): MapEdge {
  return {
    id: row.id,
    mapId: row.mapId,
    workId: row.workId,
    branchId: row.branchId,
    layerId: row.layerId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    routeType: row.routeType as MapEdge["routeType"],
    bidirectional: row.bidirectional,
    travelMinutes: row.travelMinutes,
    validity: validityFromRow(row),
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toMapMarkerContract(row: MapMarkerRecord): MapMarker {
  return {
    id: row.id,
    mapId: row.mapId,
    workId: row.workId,
    branchId: row.branchId,
    layerId: row.layerId,
    nodeId: row.nodeId,
    label: row.label,
    markerType: row.markerType as MapMarker["markerType"],
    x: row.x,
    y: row.y,
    validity: validityFromRow(row),
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTimelineEraContract(row: TimelineEraRecord): TimelineEra {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    name: row.name,
    orderIndex: row.orderIndex,
    startSortKey: row.startSortKey,
    endSortKey: row.endSortKey,
    description: row.description,
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTimelineEventContract(
  row: TimelineEventRecord,
  entity: EntityRecord,
): TimelineEventDetail {
  return {
    event: entityRef(entity),
    era: row.era,
    storyTime: { era: row.era, label: row.storyTimeLabel, sortKey: row.storyTimeSortKey },
    durationMinutes: row.durationMinutes,
    durationLabel: row.durationLabel,
    eventText: row.eventText,
    validity: validityFromRow(row),
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItineraryContract(
  row: ItineraryRecord,
  character: DomainRef,
  fromNode: DomainRef,
  toNode: DomainRef,
): CharacterItinerary {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    character,
    fromNode,
    toNode,
    departure: {
      era: row.departureEra,
      label: row.departureLabel,
      sortKey: row.departureSortKey,
    },
    arrival: {
      era: row.arrivalEra,
      label: row.arrivalLabel,
      sortKey: row.arrivalSortKey,
    },
    routeTravelMinutes: row.routeTravelMinutes,
    travelMinutes: row.travelMinutes,
    validity: validityFromRow(row),
    sourceChapterId: row.sourceChapterId,
    evidence: row.evidence as CharacterItinerary["evidence"],
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberAttribute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
