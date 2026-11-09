import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  type SchemaObject,
} from "@nestjs/swagger";
import {
  characterItineraryCreateRequestSchema,
  characterItineraryResponseSchema,
  factionCreateRequestSchema,
  factionDetailResponseSchema,
  factionListResponseSchema,
  factionProfileUpdateRequestSchema,
  factionRelationshipCreateRequestSchema,
  factionRelationshipResponseSchema,
  mapCreateRequestSchema,
  mapPatchRequestSchema,
  mapDetailResponseSchema,
  mapEdgeCreateRequestSchema,
  mapEdgeResponseSchema,
  mapLayerCreateRequestSchema,
  mapLayerResponseSchema,
  mapListResponseSchema,
  mapMarkerCreateRequestSchema,
  mapMarkerResponseSchema,
  mapNodeCreateRequestSchema,
  mapNodeResponseSchema,
  mapRouteQuerySchema,
  mapRouteResponseSchema,
  territoryCreateRequestSchema,
  territoryResponseSchema,
  timelineEraCreateRequestSchema,
  timelineEraResponseSchema,
  timelineEventCreateRequestSchema,
  timelineEventPatchRequestSchema,
  timelineEventResponseSchema,
  uuidV7Schema,
  worldSnapshotQuerySchema,
  worldSnapshotResponseSchema,
  worldTimelineResponseSchema,
} from "@novel-brain/contracts";
import { createRequestId } from "@novel-brain/core";
import { z } from "zod";

import type { AuthenticatedRequest } from "../auth/auth.types";
import { getClientIp } from "../auth/client-ip";
import { CsrfGuard } from "../auth/csrf.guard";
import { SessionAuthGuard } from "../auth/session.guard";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { WorldService } from "./world.service";

function schemaOf(schema: z.ZodType, io: "input" | "output"): SchemaObject {
  return z.toJSONSchema(schema, { target: "openapi-3.0", io }) as SchemaObject;
}

const factionCreateBodySchema = schemaOf(factionCreateRequestSchema, "input");
const factionProfileBodySchema = schemaOf(factionProfileUpdateRequestSchema, "input");
const factionRelationshipBodySchema = schemaOf(factionRelationshipCreateRequestSchema, "input");
const territoryBodySchema = schemaOf(territoryCreateRequestSchema, "input");
const mapCreateBodySchema = schemaOf(mapCreateRequestSchema, "input");
const mapPatchBodySchema = schemaOf(mapPatchRequestSchema, "input");
const mapLayerBodySchema = schemaOf(mapLayerCreateRequestSchema, "input");
const mapNodeBodySchema = schemaOf(mapNodeCreateRequestSchema, "input");
const mapEdgeBodySchema = schemaOf(mapEdgeCreateRequestSchema, "input");
const mapMarkerBodySchema = schemaOf(mapMarkerCreateRequestSchema, "input");
const timelineEraBodySchema = schemaOf(timelineEraCreateRequestSchema, "input");
const timelineEventBodySchema = schemaOf(timelineEventCreateRequestSchema, "input");
const timelineEventPatchBodySchema = schemaOf(timelineEventPatchRequestSchema, "input");
const itineraryBodySchema = schemaOf(characterItineraryCreateRequestSchema, "input");
const factionDetailSchema = schemaOf(factionDetailResponseSchema, "output");
const factionListSchema = schemaOf(factionListResponseSchema, "output");
const factionRelationshipSchema = schemaOf(factionRelationshipResponseSchema, "output");
const territorySchema = schemaOf(territoryResponseSchema, "output");
const mapDetailSchema = schemaOf(mapDetailResponseSchema, "output");
const mapListSchema = schemaOf(mapListResponseSchema, "output");
const mapLayerSchema = schemaOf(mapLayerResponseSchema, "output");
const mapNodeSchema = schemaOf(mapNodeResponseSchema, "output");
const mapEdgeSchema = schemaOf(mapEdgeResponseSchema, "output");
const mapMarkerSchema = schemaOf(mapMarkerResponseSchema, "output");
const mapRouteSchema = schemaOf(mapRouteResponseSchema, "output");
const timelineEraSchema = schemaOf(timelineEraResponseSchema, "output");
const timelineEventSchema = schemaOf(timelineEventResponseSchema, "output");
const worldTimelineSchema = schemaOf(worldTimelineResponseSchema, "output");
const worldSnapshotSchema = schemaOf(worldSnapshotResponseSchema, "output");

@ApiTags("world")
@Controller("works/:workId/branches/:branchId/world")
@UseGuards(SessionAuthGuard, CsrfGuard)
export class WorldController {
  constructor(private readonly service: WorldService) {}

  @Get("factions")
  @ApiOkResponse({ description: "Faction domain details", schema: factionListSchema })
  async listFactions(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return factionListResponseSchema.parse({
      data: await this.service.listFactions(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("factions")
  @HttpCode(201)
  @ApiBody({ schema: factionCreateBodySchema })
  @ApiCreatedResponse({ description: "Created faction", schema: factionDetailSchema })
  async createFaction(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return factionDetailResponseSchema.parse({
      data: await this.service.createFaction(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        factionCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("factions/:factionId")
  @ApiOkResponse({ description: "Faction detail", schema: factionDetailSchema })
  async getFaction(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("factionId") factionId: string,
    @Query() query: unknown,
  ) {
    return factionDetailResponseSchema.parse({
      data: await this.service.getFaction(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(factionId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Patch("factions/:factionId")
  @ApiBody({ schema: factionProfileBodySchema })
  @ApiOkResponse({ description: "Updated faction profile", schema: factionDetailSchema })
  async updateFaction(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("factionId") factionId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return factionDetailResponseSchema.parse({
      data: await this.service.updateFactionProfile(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(factionId),
        factionProfileUpdateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("factions/:factionId/relationships")
  @HttpCode(201)
  @ApiBody({ schema: factionRelationshipBodySchema })
  @ApiCreatedResponse({
    description: "Created faction relationship",
    schema: factionRelationshipSchema,
  })
  async addFactionRelationship(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("factionId") factionId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return factionRelationshipResponseSchema.parse({
      data: await this.service.addFactionRelationship(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(factionId),
        factionRelationshipCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("factions/:factionId/territories")
  @HttpCode(201)
  @ApiBody({ schema: territoryBodySchema })
  @ApiCreatedResponse({ description: "Created territory", schema: territorySchema })
  async addTerritory(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("factionId") factionId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return territoryResponseSchema.parse({
      data: await this.service.addTerritory(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(factionId),
        territoryCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("maps")
  @ApiOkResponse({ description: "Map domain details", schema: mapListSchema })
  async listMaps(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return mapListResponseSchema.parse({
      data: await this.service.listMaps(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("maps")
  @HttpCode(201)
  @ApiBody({ schema: mapCreateBodySchema })
  @ApiCreatedResponse({ description: "Created map", schema: mapDetailSchema })
  async createMap(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return mapDetailResponseSchema.parse({
      data: await this.service.createMap(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        mapCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("maps/:mapId")
  @ApiOkResponse({ description: "Map detail", schema: mapDetailSchema })
  async getMap(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Query() query: unknown,
  ) {
    return mapDetailResponseSchema.parse({
      data: await this.service.getMap(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Patch("maps/:mapId")
  @ApiBody({ schema: mapPatchBodySchema })
  @ApiOkResponse({ description: "Updated map", schema: mapDetailSchema })
  async updateMap(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return mapDetailResponseSchema.parse({
      data: await this.service.updateMap(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        mapPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("maps/:mapId/layers")
  @HttpCode(201)
  @ApiBody({ schema: mapLayerBodySchema })
  @ApiCreatedResponse({ description: "Created map layer", schema: mapLayerSchema })
  async addMapLayer(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return mapLayerResponseSchema.parse({
      data: await this.service.addMapLayer(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        mapLayerCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("maps/:mapId/nodes")
  @HttpCode(201)
  @ApiBody({ schema: mapNodeBodySchema })
  @ApiCreatedResponse({ description: "Created map node", schema: mapNodeSchema })
  async addMapNode(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return mapNodeResponseSchema.parse({
      data: await this.service.addMapNode(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        mapNodeCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("maps/:mapId/edges")
  @HttpCode(201)
  @ApiBody({ schema: mapEdgeBodySchema })
  @ApiCreatedResponse({ description: "Created map edge", schema: mapEdgeSchema })
  async addMapEdge(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return mapEdgeResponseSchema.parse({
      data: await this.service.addMapEdge(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        mapEdgeCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("maps/:mapId/markers")
  @HttpCode(201)
  @ApiBody({ schema: mapMarkerBodySchema })
  @ApiCreatedResponse({ description: "Created map marker", schema: mapMarkerSchema })
  async addMapMarker(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return mapMarkerResponseSchema.parse({
      data: await this.service.addMapMarker(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        mapMarkerCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("maps/:mapId/routes")
  @ApiOkResponse({ description: "Shortest map route", schema: mapRouteSchema })
  async getMapRoute(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("mapId") mapId: string,
    @Query() query: unknown,
  ) {
    const input = mapRouteQuerySchema.parse(query);
    return mapRouteResponseSchema.parse({
      data: await this.service.getMapRoute(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(mapId),
        input.fromNodeId,
        input.toNodeId,
        input.chapterNumber,
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Get("timeline")
  @ApiOkResponse({ description: "Story timeline", schema: worldTimelineSchema })
  async getTimeline(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return worldTimelineResponseSchema.parse({
      data: await this.service.getTimeline(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  @Post("timeline/eras")
  @HttpCode(201)
  @ApiBody({ schema: timelineEraBodySchema })
  @ApiCreatedResponse({ description: "Created timeline era", schema: timelineEraSchema })
  async createTimelineEra(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return timelineEraResponseSchema.parse({
      data: await this.service.createTimelineEra(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        timelineEraCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("timeline/events")
  @HttpCode(201)
  @ApiBody({ schema: timelineEventBodySchema })
  @ApiCreatedResponse({ description: "Created timeline event", schema: timelineEventSchema })
  async createTimelineEvent(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return timelineEventResponseSchema.parse({
      data: await this.service.createTimelineEvent(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        timelineEventCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Patch("timeline/events/:eventId")
  @ApiBody({ schema: timelineEventPatchBodySchema })
  @ApiOkResponse({ description: "Updated timeline event", schema: timelineEventSchema })
  async updateTimelineEvent(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Param("eventId") eventId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return timelineEventResponseSchema.parse({
      data: await this.service.updateTimelineEvent(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        uuidV7Schema.parse(eventId),
        timelineEventPatchRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Post("timeline/itineraries")
  @HttpCode(201)
  @ApiBody({ schema: itineraryBodySchema })
  @ApiCreatedResponse({
    description: "Created character itinerary",
    schema: schemaOf(characterItineraryResponseSchema, "output"),
  })
  async createItinerary(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Body() body: unknown,
  ) {
    const requestId = createRequestId();
    return characterItineraryResponseSchema.parse({
      data: await this.service.createItinerary(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        characterItineraryCreateRequestSchema.parse(body),
        this.auditContext(request, requestId),
      ),
      requestId,
      meta: {},
    });
  }

  @Get("snapshot")
  @ApiOkResponse({
    description: "World state at a branch/version point",
    schema: worldSnapshotSchema,
  })
  async getSnapshot(
    @Req() request: AuthenticatedRequest,
    @Param("workId") workId: string,
    @Param("branchId") branchId: string,
    @Query() query: unknown,
  ) {
    return worldSnapshotResponseSchema.parse({
      data: await this.service.getSnapshot(
        this.userId(request),
        uuidV7Schema.parse(workId),
        uuidV7Schema.parse(branchId),
        worldSnapshotQuerySchema.parse(query),
      ),
      requestId: createRequestId(),
      meta: {},
    });
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.auth) {
      throw new Error("Authenticated request is missing auth context");
    }
    return request.auth.user.id;
  }

  private auditContext(request: AuthenticatedRequest, requestId: string) {
    const userAgent = String(request.headers["user-agent"] ?? "").trim();
    return {
      requestId,
      ip: getClientIp(request) || "unknown",
      userAgent: userAgent || "unknown",
    };
  }
}
