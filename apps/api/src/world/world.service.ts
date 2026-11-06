import { Injectable } from "@nestjs/common";
import type {
  CharacterItinerary,
  CharacterItineraryCreateRequest,
  FactionCreateRequest,
  FactionDetail,
  FactionProfileUpdateRequest,
  FactionRelationship,
  FactionRelationshipCreateRequest,
  MapCreateRequest,
  MapDetail,
  MapEdge,
  MapEdgeCreateRequest,
  MapLayer,
  MapLayerCreateRequest,
  MapMarker,
  MapMarkerCreateRequest,
  MapNode,
  MapNodeCreateRequest,
  MapRoute,
  Territory,
  TerritoryCreateRequest,
  TimelineEra,
  TimelineEraCreateRequest,
  TimelineEventCreateRequest,
  TimelineEventDetail,
  WorldSnapshot,
  WorldSnapshotQuery,
  WorldTimeline,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PowerItemsRepository } from "./power-items.repository";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorldRepository } from "./world.repository";
import type { WorldAuditContext, WorldWorkContext, WorldWriteResult } from "./world.repository";

interface ReadQuery {
  versionNodeId?: string | undefined;
  chapterNumber?: number | undefined;
}

@Injectable()
export class WorldService {
  constructor(
    private readonly repository: WorldRepository,
    private readonly powerItemsRepository: PowerItemsRepository,
  ) {}

  async listFactions(
    userId: string,
    workId: string,
    branchId: string,
    query: ReadQuery,
  ): Promise<FactionDetail[]> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.repository.listFactions(
      userId,
      context,
      await this.readOptions(userId, context, query),
    );
  }

  async getFaction(
    userId: string,
    workId: string,
    branchId: string,
    factionId: string,
    query: ReadQuery,
  ): Promise<FactionDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    const detail = await this.repository.getFaction(
      userId,
      context,
      factionId,
      await this.readOptions(userId, context, query),
    );
    if (!detail) {
      throw tenantError("势力档案不存在或无权访问");
    }
    return detail;
  }

  async createFaction(
    userId: string,
    workId: string,
    branchId: string,
    input: FactionCreateRequest,
    audit: WorldAuditContext,
  ): Promise<FactionDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createFaction(userId, context, input, audit));
  }

  async updateFactionProfile(
    userId: string,
    workId: string,
    branchId: string,
    factionId: string,
    input: FactionProfileUpdateRequest,
    audit: WorldAuditContext,
  ): Promise<FactionDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.updateFactionProfile(
        userId,
        context,
        factionId,
        input.version,
        input.profile,
        audit,
      ),
    );
  }

  async addFactionRelationship(
    userId: string,
    workId: string,
    branchId: string,
    factionId: string,
    input: FactionRelationshipCreateRequest,
    audit: WorldAuditContext,
  ): Promise<FactionRelationship> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.addFactionRelationship(userId, context, factionId, input, audit),
    );
  }

  async addTerritory(
    userId: string,
    workId: string,
    branchId: string,
    factionId: string,
    input: TerritoryCreateRequest,
    audit: WorldAuditContext,
  ): Promise<Territory> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.addTerritory(userId, context, factionId, input, audit));
  }

  async listMaps(
    userId: string,
    workId: string,
    branchId: string,
    query: ReadQuery,
  ): Promise<MapDetail[]> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.repository.listMaps(
      userId,
      context,
      await this.readOptions(userId, context, query),
    );
  }

  async getMap(
    userId: string,
    workId: string,
    branchId: string,
    mapId: string,
    query: ReadQuery,
  ): Promise<MapDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    const detail = await this.repository.getMap(
      userId,
      context,
      mapId,
      await this.readOptions(userId, context, query),
    );
    if (!detail) {
      throw tenantError("地图不存在或无权访问");
    }
    return detail;
  }

  async createMap(
    userId: string,
    workId: string,
    branchId: string,
    input: MapCreateRequest,
    audit: WorldAuditContext,
  ): Promise<MapDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createMap(userId, context, input, audit));
  }

  async addMapLayer(
    userId: string,
    workId: string,
    branchId: string,
    mapId: string,
    input: MapLayerCreateRequest,
    audit: WorldAuditContext,
  ): Promise<MapLayer> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.addMapLayer(userId, context, mapId, input, audit));
  }

  async addMapNode(
    userId: string,
    workId: string,
    branchId: string,
    mapId: string,
    input: MapNodeCreateRequest,
    audit: WorldAuditContext,
  ): Promise<MapNode> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.addMapNode(userId, context, mapId, input, audit));
  }

  async addMapEdge(
    userId: string,
    workId: string,
    branchId: string,
    mapId: string,
    input: MapEdgeCreateRequest,
    audit: WorldAuditContext,
  ): Promise<MapEdge> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.addMapEdge(userId, context, mapId, input, audit));
  }

  async addMapMarker(
    userId: string,
    workId: string,
    branchId: string,
    mapId: string,
    input: MapMarkerCreateRequest,
    audit: WorldAuditContext,
  ): Promise<MapMarker> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.addMapMarker(userId, context, mapId, input, audit));
  }

  async getMapRoute(
    userId: string,
    workId: string,
    branchId: string,
    mapId: string,
    fromNodeId: string,
    toNodeId: string,
    chapterNumber?: number,
  ): Promise<MapRoute> {
    const context = await this.requireContext(userId, workId, branchId);
    const map = await this.repository.getMap(userId, context, mapId, {});
    if (!map) {
      throw tenantError("地图不存在或无权访问");
    }
    const route = await this.repository.getMapRoute(
      userId,
      context,
      mapId,
      fromNodeId,
      toNodeId,
      chapterNumber,
    );
    if (!route) {
      throw new ApiError(404, "MAP_ROUTE_DISCONNECTED", "两个地点之间没有可达路线");
    }
    return route;
  }

  async getTimeline(
    userId: string,
    workId: string,
    branchId: string,
    query: ReadQuery,
  ): Promise<WorldTimeline> {
    const context = await this.requireContext(userId, workId, branchId);
    return this.repository.getTimeline(
      userId,
      context,
      await this.readOptions(userId, context, query),
    );
  }

  async createTimelineEra(
    userId: string,
    workId: string,
    branchId: string,
    input: TimelineEraCreateRequest,
    audit: WorldAuditContext,
  ): Promise<TimelineEra> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createTimelineEra(userId, context, input, audit));
  }

  async createTimelineEvent(
    userId: string,
    workId: string,
    branchId: string,
    input: TimelineEventCreateRequest,
    audit: WorldAuditContext,
  ): Promise<TimelineEventDetail> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createTimelineEvent(userId, context, input, audit));
  }

  async createItinerary(
    userId: string,
    workId: string,
    branchId: string,
    input: CharacterItineraryCreateRequest,
    audit: WorldAuditContext,
  ): Promise<CharacterItinerary> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createItinerary(userId, context, input, audit));
  }

  async getSnapshot(
    userId: string,
    workId: string,
    branchId: string,
    query: WorldSnapshotQuery,
  ): Promise<WorldSnapshot> {
    const context = await this.requireContext(userId, workId, branchId);
    const options = await this.readOptions(userId, context, query);
    const [snapshot, powerSystems, mechanisms, items] = await Promise.all([
      this.repository.getSnapshot(userId, context, options),
      this.powerItemsRepository.listPowerSystems(userId, context, options),
      this.powerItemsRepository.listMechanisms(userId, context, options),
      this.powerItemsRepository.listItems(userId, context, options),
    ]);
    return { ...snapshot, powerSystems, mechanisms, items };
  }

  private async readOptions(
    userId: string,
    context: WorldWorkContext,
    query: ReadQuery,
  ): Promise<{ versionNodeIds?: string[]; chapterNumber?: number }> {
    return {
      ...(query.versionNodeId
        ? {
            versionNodeIds: await this.repository.resolveVersionNodeIds(
              userId,
              context,
              query.versionNodeId,
            ),
          }
        : {}),
      ...(query.chapterNumber !== undefined ? { chapterNumber: query.chapterNumber } : {}),
    };
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<WorldWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw tenantError("作品或创作线不存在，或无权访问");
    }
    return context;
  }
}

function unwrap<T>(result: WorldWriteResult<T>): T {
  if (result.kind === "ok") {
    return result.value;
  }
  switch (result.kind) {
    case "not_found":
      throw tenantError("世界设定不存在或无权访问");
    case "locked":
      throw new ApiError(409, "SETTING_LOCKED", "设定已锁定，请提交修改请求");
    case "proposal_state":
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定正在提案或已废弃，不能直接编辑");
    case "version_conflict":
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    case "name_conflict":
      throw new ApiError(409, "SETTING_NAME_CONFLICT", "名称已被其他设定使用");
    case "alias_conflict":
      throw new ApiError(409, "SETTING_ALIAS_CONFLICT", "别名与其他设定冲突");
    case "target_not_found":
      throw new ApiError(400, "VALIDATION_INVALID", "引用的世界对象不存在或不属于当前分支");
    case "parent_mismatch":
      throw new ApiError(409, "MAP_NODE_PARENT_MISMATCH", "父节点必须属于同一张地图");
    case "layer_mismatch":
      throw new ApiError(409, "MAP_LAYER_MISMATCH", "图层必须属于当前地图");
    case "route_endpoint_mismatch":
      throw new ApiError(409, "MAP_ROUTE_ENDPOINT_MISMATCH", "路线端点必须属于同一张地图");
    case "route_disconnected":
      throw new ApiError(409, "MAP_ROUTE_DISCONNECTED", "两个地点之间没有可达路线");
    case "route_time_conflict":
      throw new ApiError(409, "MAP_ROUTE_TRAVEL_TIME_CONFLICT", "行程时间不足以走完路线");
    case "control_overlap":
      throw new ApiError(409, "CONTROL_AREA_OVERLAP", "同一地点在重叠章节内已有其他势力控制");
    case "timeline_overlap":
      throw new ApiError(409, "TIMELINE_EVENT_OVERLAP", "同一纪元已有事件占用相同故事时间");
    case "timeline_era_not_found":
      throw new ApiError(400, "TIMELINE_ERA_NOT_FOUND", "故事纪元不存在");
    case "itinerary_time_order":
      throw new ApiError(409, "ITINERARY_TIME_ORDER", "行程到达时间必须晚于出发时间");
    case "itinerary_overlap":
      throw new ApiError(409, "ITINERARY_OVERLAP", "角色行程在故事时间上发生重叠");
  }
}

function tenantError(message: string): ApiError {
  return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", message);
}
