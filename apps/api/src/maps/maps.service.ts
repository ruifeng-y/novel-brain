import { HttpStatus, Injectable } from '@nestjs/common';
import {
  MAP_LEVEL_LABELS,
  MAP_LEVEL_ORDER,
  type CharacterPresenceCreateInput,
  type MapConnectionCreateInput,
  type MapNodeCreateInput,
} from '@novel/contracts';
import {
  characterPresences,
  entities,
  entityRelations,
  mapConnections,
  mapImages,
  mapMarkers,
  mapNodes,
  workBranches,
  works,
  type MapNodeRow,
} from '@novel/db';
import { and, asc, desc, eq, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DatabaseService } from '../database/database.service';
import { ObjectStorageService } from '../storage/object-storage.service';
import { mapsError } from './maps.errors';

type MapNodeResponse = {
  id: string;
  workId: string;
  branchId: string;
  entityId: string;
  name: string;
  summary: string;
  level: string;
  levelLabel: string;
  parentNodeId: string | null;
  createdAt: string;
  updatedAt: string;
};

const fromNodes = alias(mapNodes, 'connection_from_nodes');
const toNodes = alias(mapNodes, 'connection_to_nodes');
const fromEntities = alias(entities, 'connection_from_entities');
const toEntities = alias(entities, 'connection_to_entities');
const controlFactions = alias(entities, 'map_control_factions');
const controlPlaces = alias(entities, 'map_control_places');
const imagePlaces = alias(entities, 'map_image_places');
const markerPlaces = alias(entities, 'map_marker_places');
const presenceCharacters = alias(entities, 'map_presence_characters');
const presencePlaces = alias(entities, 'map_presence_places');

type UploadedMapImage = {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname?: string;
};

@Injectable()
export class MapsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly storage: ObjectStorageService,
  ) {}

  async listNodes(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        node: mapNodes,
        name: entities.name,
        summary: entities.summary,
      })
      .from(mapNodes)
      .innerJoin(entities, eq(entities.id, mapNodes.entityId))
      .where(and(eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId)))
      .orderBy(asc(mapNodes.createdAt), asc(entities.name));
    return { items: rows.map((row) => this.toNodeResponse(row)) };
  }

  async createNode(
    userId: string,
    workId: string,
    branchId: string,
    input: MapNodeCreateInput,
  ): Promise<MapNodeResponse> {
    await this.requireBranch(userId, workId, branchId);
    let parent: MapNodeRow | undefined;

    if (input.level === 'world') {
      if (input.parentNodeId) {
        throw mapsError(
          HttpStatus.BAD_REQUEST,
          'MAP_PARENT_INVALID',
          'The world level cannot have a parent',
        );
      }
      const [existingWorld] = await this.database.db
        .select({ id: mapNodes.id })
        .from(mapNodes)
        .where(
          and(
            eq(mapNodes.workId, workId),
            eq(mapNodes.branchId, branchId),
            eq(mapNodes.level, 'world'),
          ),
        )
        .limit(1);
      if (existingWorld) {
        throw mapsError(
          HttpStatus.CONFLICT,
          'MAP_WORLD_EXISTS',
          'This creation line already has a world map',
        );
      }
    } else {
      if (!input.parentNodeId) {
        throw mapsError(
          HttpStatus.BAD_REQUEST,
          'MAP_PARENT_REQUIRED',
          'Choose a parent place for this level',
        );
      }
      parent = await this.findNode(workId, branchId, input.parentNodeId);
      if (
        !parent ||
        MAP_LEVEL_ORDER.indexOf(parent.level) >= MAP_LEVEL_ORDER.indexOf(input.level)
      ) {
        throw mapsError(
          HttpStatus.BAD_REQUEST,
          'MAP_PARENT_INVALID',
          'Choose a broader parent place',
        );
      }
    }

    const now = new Date();
    try {
      const created = await this.database.db.transaction(async (tx) => {
        const [entity] = await tx
          .insert(entities)
          .values({
            workId,
            branchId,
            name: input.name,
            aliases: [],
            type: 'map',
            summary: input.summary,
            description: input.description,
            tags: ['地图'],
            scope: 'work',
            status: 'draft',
            customFields: {},
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        const [node] = await tx
          .insert(mapNodes)
          .values({
            workId,
            branchId,
            entityId: entity.id,
            parentNodeId: parent?.id ?? null,
            level: input.level,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return { node, entity };
      });
      await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));

      return this.toNodeResponse({
        node: created.node,
        name: created.entity.name,
        summary: created.entity.summary,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw mapsError(
          HttpStatus.CONFLICT,
          'MAP_NAME_CONFLICT',
          'A place with this name already exists',
        );
      }
      throw error;
    }
  }

  async listConnections(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        connection: mapConnections,
        fromNodeId: fromNodes.id,
        fromNodeLevel: fromNodes.level,
        fromName: fromEntities.name,
        toNodeId: toNodes.id,
        toNodeLevel: toNodes.level,
        toName: toEntities.name,
      })
      .from(mapConnections)
      .innerJoin(fromNodes, eq(fromNodes.id, mapConnections.fromNodeId))
      .innerJoin(fromEntities, eq(fromEntities.id, fromNodes.entityId))
      .innerJoin(toNodes, eq(toNodes.id, mapConnections.toNodeId))
      .innerJoin(toEntities, eq(toEntities.id, toNodes.entityId))
      .where(and(eq(mapConnections.workId, workId), eq(mapConnections.branchId, branchId)))
      .orderBy(asc(mapConnections.createdAt));

    return { items: rows.map((row) => this.toConnectionResponse(row)) };
  }

  async createConnection(
    userId: string,
    workId: string,
    branchId: string,
    input: MapConnectionCreateInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const [fromNode, toNode] = await Promise.all([
      this.findNodeWithEntity(workId, branchId, input.fromNodeId),
      this.findNodeWithEntity(workId, branchId, input.toNodeId),
    ]);
    if (!fromNode || !toNode || fromNode.node.id === toNode.node.id) {
      throw mapsError(
        HttpStatus.BAD_REQUEST,
        'MAP_CONNECTION_INVALID',
        'Choose two different places from this creation line',
      );
    }

    const [existing] = await this.database.db
      .select({ id: mapConnections.id })
      .from(mapConnections)
      .where(
        and(
          eq(mapConnections.workId, workId),
          eq(mapConnections.branchId, branchId),
          or(
            and(
              eq(mapConnections.fromNodeId, fromNode.node.id),
              eq(mapConnections.toNodeId, toNode.node.id),
            ),
            and(
              eq(mapConnections.fromNodeId, toNode.node.id),
              eq(mapConnections.toNodeId, fromNode.node.id),
            ),
          ),
        ),
      )
      .limit(1);
    if (existing) {
      throw mapsError(
        HttpStatus.CONFLICT,
        'MAP_CONNECTION_EXISTS',
        'These places are already connected',
      );
    }

    const now = new Date();
    try {
      const [created] = await this.database.db
        .insert(mapConnections)
        .values({
          workId,
          branchId,
          fromNodeId: fromNode.node.id,
          toNodeId: toNode.node.id,
          travelMinutes: input.travelMinutes,
          label: input.label,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));

      return this.toConnectionResponse({
        connection: created,
        fromNodeId: fromNode.node.id,
        fromNodeLevel: fromNode.node.level,
        fromName: fromNode.entity.name,
        toNodeId: toNode.node.id,
        toNodeLevel: toNode.node.level,
        toName: toNode.entity.name,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw mapsError(
          HttpStatus.CONFLICT,
          'MAP_CONNECTION_EXISTS',
          'These places are already connected',
        );
      }
      throw error;
    }
  }

  async overview(userId: string, workId: string, branchId: string) {
    const [nodes, connections, factionControls, images, presences, conflicts] = await Promise.all([
      this.listNodes(userId, workId, branchId),
      this.listConnections(userId, workId, branchId),
      this.listFactionControls(userId, workId, branchId),
      this.listImages(userId, workId, branchId),
      this.listPresences(userId, workId, branchId),
      this.listConflicts(userId, workId, branchId),
    ]);
    return {
      nodes: nodes.items,
      connections: connections.items,
      factionControls: factionControls.items,
      images: images.items,
      presences: presences.items,
      conflicts: conflicts.items,
    };
  }

  async listFactionControls(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select({
        relation: entityRelations,
        factionName: controlFactions.name,
        placeNode: mapNodes,
        placeName: controlPlaces.name,
      })
      .from(entityRelations)
      .innerJoin(controlFactions, eq(controlFactions.id, entityRelations.fromEntityId))
      .innerJoin(
        mapNodes,
        and(
          eq(mapNodes.entityId, entityRelations.toEntityId),
          eq(mapNodes.workId, workId),
          eq(mapNodes.branchId, branchId),
        ),
      )
      .innerJoin(controlPlaces, eq(controlPlaces.id, mapNodes.entityId))
      .where(
        and(
          eq(entityRelations.workId, workId),
          eq(entityRelations.branchId, branchId),
          eq(entityRelations.predicate, 'controls'),
        ),
      )
      .orderBy(asc(entityRelations.createdAt));

    return {
      items: rows.map((row) => ({
        id: row.relation.id,
        faction: {
          id: row.relation.fromEntityId,
          name: row.factionName,
        },
        place: {
          id: row.placeNode.id,
          name: row.placeName,
          level: row.placeNode.level,
          levelLabel: MAP_LEVEL_LABELS[row.placeNode.level],
        },
        validFrom: row.relation.validFrom,
        validTo: row.relation.validTo,
        source: row.relation.source,
        createdAt: row.relation.createdAt.toISOString(),
        updatedAt: row.relation.updatedAt.toISOString(),
      })),
    };
  }

  async listImages(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const [imageRows, markerRows] = await Promise.all([
      this.database.db
        .select({
          image: mapImages,
          placeName: imagePlaces.name,
        })
        .from(mapImages)
        .innerJoin(mapNodes, eq(mapNodes.id, mapImages.nodeId))
        .innerJoin(imagePlaces, eq(imagePlaces.id, mapNodes.entityId))
        .where(and(eq(mapImages.workId, workId), eq(mapImages.branchId, branchId)))
        .orderBy(desc(mapImages.updatedAt)),
      this.database.db
        .select({
          marker: mapMarkers,
          placeName: markerPlaces.name,
          placeLevel: mapNodes.level,
        })
        .from(mapMarkers)
        .innerJoin(mapNodes, eq(mapNodes.id, mapMarkers.nodeId))
        .innerJoin(markerPlaces, eq(markerPlaces.id, mapNodes.entityId))
        .where(and(eq(mapMarkers.workId, workId), eq(mapMarkers.branchId, branchId)))
        .orderBy(asc(mapMarkers.createdAt)),
    ]);

    return {
      items: imageRows.map(({ image, placeName }) =>
        this.toImageResponse(
          image,
          placeName,
          markerRows
            .filter(({ marker }) => marker.imageId === image.id)
            .map(({ marker, placeName: markerName, placeLevel }) =>
              this.toMarkerResponse(marker, markerName, placeLevel),
            ),
        ),
      ),
    };
  }

  async uploadImage(
    userId: string,
    workId: string,
    branchId: string,
    nodeId: string,
    file: UploadedMapImage | undefined,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const node = await this.findNodeWithEntity(workId, branchId, nodeId);
    if (!node) {
      throw mapsError(HttpStatus.NOT_FOUND, 'MAP_NODE_NOT_FOUND', 'Place not found');
    }
    if (!file?.buffer || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw mapsError(
        HttpStatus.BAD_REQUEST,
        'MAP_IMAGE_INVALID',
        'Choose a PNG, JPEG, or WebP image',
      );
    }

    let optimized: Buffer;
    let width: number;
    let height: number;
    try {
      const source = sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 });
      const metadata = await source.metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
        throw new Error('Unsupported image format');
      }
      optimized = await sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: 4_096,
          height: 4_096,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 85, effort: 4 })
        .toBuffer();
      const outputMetadata = await sharp(optimized).metadata();
      width = outputMetadata.width ?? 0;
      height = outputMetadata.height ?? 0;
    } catch {
      throw mapsError(
        HttpStatus.BAD_REQUEST,
        'MAP_IMAGE_INVALID',
        'The image could not be read or is too large',
      );
    }

    const [existing] = await this.database.db
      .select()
      .from(mapImages)
      .where(
        and(
          eq(mapImages.workId, workId),
          eq(mapImages.branchId, branchId),
          eq(mapImages.nodeId, nodeId),
        ),
      )
      .limit(1);
    const storageKey = `${userId}/${workId}/${branchId}/maps/${randomUUID()}.webp`;
    await this.storage.putObject(storageKey, optimized, 'image/webp');
    const now = new Date();

    let saved;
    if (existing) {
      [saved] = await this.database.db
        .update(mapImages)
        .set({
          storageKey,
          mimeType: 'image/webp',
          width,
          height,
          size: optimized.length,
          updatedAt: now,
        })
        .where(eq(mapImages.id, existing.id))
        .returning();
      await this.storage.removeObject(existing.storageKey).catch(() => undefined);
    } else {
      [saved] = await this.database.db
        .insert(mapImages)
        .values({
          workId,
          branchId,
          nodeId,
          storageKey,
          mimeType: 'image/webp',
          width,
          height,
          size: optimized.length,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
    }

    const markerRows = await this.database.db
      .select({
        marker: mapMarkers,
        placeName: markerPlaces.name,
        placeLevel: mapNodes.level,
      })
      .from(mapMarkers)
      .innerJoin(mapNodes, eq(mapNodes.id, mapMarkers.nodeId))
      .innerJoin(markerPlaces, eq(markerPlaces.id, mapNodes.entityId))
      .where(eq(mapMarkers.imageId, saved.id));

    return this.toImageResponse(
      saved,
      node.entity.name,
      markerRows.map(({ marker, placeName, placeLevel }) =>
        this.toMarkerResponse(marker, placeName, placeLevel),
      ),
    );
  }

  async createMarker(
    userId: string,
    workId: string,
    branchId: string,
    imageId: string,
    input: { nodeId: string; xPercent: number; yPercent: number },
  ) {
    await this.requireBranch(userId, workId, branchId);
    const [image, place] = await Promise.all([
      this.findImage(workId, branchId, imageId),
      this.findNodeWithEntity(workId, branchId, input.nodeId),
    ]);
    if (!image || !place) {
      throw mapsError(
        HttpStatus.BAD_REQUEST,
        'MAP_MARKER_INVALID',
        'Choose a place and map image from this creation line',
      );
    }

    const now = new Date();
    const [saved] = await this.database.db
      .insert(mapMarkers)
      .values({
        workId,
        branchId,
        imageId: image.id,
        nodeId: place.node.id,
        xPercent: input.xPercent,
        yPercent: input.yPercent,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [mapMarkers.imageId, mapMarkers.nodeId],
        set: {
          xPercent: input.xPercent,
          yPercent: input.yPercent,
          updatedAt: now,
        },
      })
      .returning();

    return this.toMarkerResponse(saved, place.entity.name, place.node.level);
  }

  async getImageContent(userId: string, workId: string, branchId: string, imageId: string) {
    await this.requireBranch(userId, workId, branchId);
    const image = await this.findImage(workId, branchId, imageId);
    if (!image) {
      throw mapsError(HttpStatus.NOT_FOUND, 'MAP_IMAGE_NOT_FOUND', 'Map image not found');
    }
    return {
      buffer: await this.storage.getObject(image.storageKey),
      mimeType: image.mimeType,
    };
  }

  async listPresences(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    return {
      items: await this.loadPresenceRows(workId, branchId),
    };
  }

  async createPresence(
    userId: string,
    workId: string,
    branchId: string,
    input: CharacterPresenceCreateInput,
  ) {
    await this.requireBranch(userId, workId, branchId);
    const [character, place] = await Promise.all([
      this.database.db
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(
          and(
            eq(entities.id, input.characterEntityId),
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            eq(entities.type, 'character'),
            isNull(entities.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      this.findNodeWithEntity(workId, branchId, input.locationNodeId),
    ]);
    if (!character || !place) {
      throw mapsError(
        HttpStatus.BAD_REQUEST,
        'MAP_PRESENCE_INVALID',
        'Choose a character and place from this creation line',
      );
    }

    const now = new Date();
    try {
      const [created] = await this.database.db
        .insert(characterPresences)
        .values({
          workId,
          branchId,
          characterEntityId: character.id,
          locationNodeId: place.node.id,
          storyTime: input.storyTime,
          source: input.source,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return this.toPresenceResponse({
        presence: created,
        characterName: character.name,
        placeName: place.entity.name,
        placeLevel: place.node.level,
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw mapsError(
          HttpStatus.CONFLICT,
          'MAP_PRESENCE_EXISTS',
          'This place already has a location record for that story time',
        );
      }
      throw error;
    }
  }

  async deletePresence(userId: string, workId: string, branchId: string, presenceId: string) {
    await this.requireBranch(userId, workId, branchId);
    const [deleted] = await this.database.db
      .delete(characterPresences)
      .where(
        and(
          eq(characterPresences.id, presenceId),
          eq(characterPresences.workId, workId),
          eq(characterPresences.branchId, branchId),
        ),
      )
      .returning({ id: characterPresences.id });
    if (!deleted) {
      throw mapsError(HttpStatus.NOT_FOUND, 'MAP_PRESENCE_NOT_FOUND', 'Location record not found');
    }
    return { deleted: true };
  }

  async listConflicts(userId: string, workId: string, branchId: string) {
    await this.requireBranch(userId, workId, branchId);
    const presences = await this.loadPresenceRows(workId, branchId);
    const groups = new Map<
      string,
      {
        character: { id: string; name: string };
        storyTime: string;
        locations: Array<{ id: string; name: string; level: string; levelLabel: string }>;
        presenceIds: string[];
      }
    >();

    for (const presence of presences) {
      const key = `${presence.character.id}\u0000${presence.storyTime}`;
      const group = groups.get(key) ?? {
        character: presence.character,
        storyTime: presence.storyTime,
        locations: [],
        presenceIds: [],
      };
      if (!group.locations.some((location) => location.id === presence.location.id)) {
        group.locations.push(presence.location);
      }
      group.presenceIds.push(presence.id);
      groups.set(key, group);
    }

    return {
      items: Array.from(groups.values()).filter((group) => group.locations.length > 1),
    };
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw mapsError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw mapsError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
  }

  private async findNode(
    workId: string,
    branchId: string,
    nodeId: string,
  ): Promise<MapNodeRow | undefined> {
    const [node] = await this.database.db
      .select()
      .from(mapNodes)
      .where(
        and(eq(mapNodes.id, nodeId), eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId)),
      )
      .limit(1);
    return node;
  }

  private async findNodeWithEntity(workId: string, branchId: string, nodeId: string) {
    const [row] = await this.database.db
      .select({ node: mapNodes, entity: entities })
      .from(mapNodes)
      .innerJoin(entities, eq(entities.id, mapNodes.entityId))
      .where(
        and(eq(mapNodes.id, nodeId), eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId)),
      )
      .limit(1);
    return row;
  }

  private async findImage(workId: string, branchId: string, imageId: string) {
    const [image] = await this.database.db
      .select()
      .from(mapImages)
      .where(
        and(
          eq(mapImages.id, imageId),
          eq(mapImages.workId, workId),
          eq(mapImages.branchId, branchId),
        ),
      )
      .limit(1);
    return image;
  }

  private async loadPresenceRows(workId: string, branchId: string) {
    const rows = await this.database.db
      .select({
        presence: characterPresences,
        characterName: presenceCharacters.name,
        placeName: presencePlaces.name,
        placeLevel: mapNodes.level,
      })
      .from(characterPresences)
      .innerJoin(
        presenceCharacters,
        eq(presenceCharacters.id, characterPresences.characterEntityId),
      )
      .innerJoin(mapNodes, eq(mapNodes.id, characterPresences.locationNodeId))
      .innerJoin(presencePlaces, eq(presencePlaces.id, mapNodes.entityId))
      .where(and(eq(characterPresences.workId, workId), eq(characterPresences.branchId, branchId)))
      .orderBy(asc(characterPresences.storyTime), asc(characterPresences.createdAt));

    return rows.map((row) =>
      this.toPresenceResponse({
        presence: row.presence,
        characterName: row.characterName,
        placeName: row.placeName,
        placeLevel: row.placeLevel,
      }),
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private toNodeResponse(row: {
    node: MapNodeRow;
    name: string;
    summary: string;
  }): MapNodeResponse {
    return {
      id: row.node.id,
      workId: row.node.workId,
      branchId: row.node.branchId,
      entityId: row.node.entityId,
      name: row.name,
      summary: row.summary,
      level: row.node.level,
      levelLabel: MAP_LEVEL_LABELS[row.node.level],
      parentNodeId: row.node.parentNodeId,
      createdAt: row.node.createdAt.toISOString(),
      updatedAt: row.node.updatedAt.toISOString(),
    };
  }

  private toConnectionResponse(row: {
    connection: typeof mapConnections.$inferSelect;
    fromNodeId: string;
    fromNodeLevel: string;
    fromName: string;
    toNodeId: string;
    toNodeLevel: string;
    toName: string;
  }) {
    return {
      id: row.connection.id,
      workId: row.connection.workId,
      branchId: row.connection.branchId,
      fromNode: {
        id: row.fromNodeId,
        name: row.fromName,
        level: row.fromNodeLevel,
        levelLabel:
          MAP_LEVEL_LABELS[row.fromNodeLevel as keyof typeof MAP_LEVEL_LABELS] ?? row.fromNodeLevel,
      },
      toNode: {
        id: row.toNodeId,
        name: row.toName,
        level: row.toNodeLevel,
        levelLabel:
          MAP_LEVEL_LABELS[row.toNodeLevel as keyof typeof MAP_LEVEL_LABELS] ?? row.toNodeLevel,
      },
      travelMinutes: row.connection.travelMinutes,
      label: row.connection.label,
      createdAt: row.connection.createdAt.toISOString(),
      updatedAt: row.connection.updatedAt.toISOString(),
    };
  }

  private toImageResponse(
    image: typeof mapImages.$inferSelect,
    placeName: string,
    markers: Array<{
      id: string;
      imageId: string;
      node: { id: string; name: string; level: string; levelLabel: string };
      xPercent: number;
      yPercent: number;
    }>,
  ) {
    return {
      id: image.id,
      workId: image.workId,
      branchId: image.branchId,
      nodeId: image.nodeId,
      placeName,
      mimeType: image.mimeType,
      width: image.width,
      height: image.height,
      size: image.size,
      contentUrl: `/api/v1/works/${image.workId}/branches/${image.branchId}/maps/images/${image.id}/content`,
      markers,
      createdAt: image.createdAt.toISOString(),
      updatedAt: image.updatedAt.toISOString(),
    };
  }

  private toMarkerResponse(
    marker: typeof mapMarkers.$inferSelect,
    placeName: string,
    placeLevel: string,
  ) {
    return {
      id: marker.id,
      imageId: marker.imageId,
      node: {
        id: marker.nodeId,
        name: placeName,
        level: placeLevel,
        levelLabel: MAP_LEVEL_LABELS[placeLevel as keyof typeof MAP_LEVEL_LABELS] ?? placeLevel,
      },
      xPercent: marker.xPercent,
      yPercent: marker.yPercent,
      createdAt: marker.createdAt.toISOString(),
      updatedAt: marker.updatedAt.toISOString(),
    };
  }

  private toPresenceResponse(row: {
    presence: typeof characterPresences.$inferSelect;
    characterName: string;
    placeName: string;
    placeLevel: string;
  }) {
    return {
      id: row.presence.id,
      character: {
        id: row.presence.characterEntityId,
        name: row.characterName,
      },
      location: {
        id: row.presence.locationNodeId,
        name: row.placeName,
        level: row.placeLevel,
        levelLabel:
          MAP_LEVEL_LABELS[row.placeLevel as keyof typeof MAP_LEVEL_LABELS] ?? row.placeLevel,
      },
      storyTime: row.presence.storyTime,
      source: row.presence.source,
      createdAt: row.presence.createdAt.toISOString(),
      updatedAt: row.presence.updatedAt.toISOString(),
    };
  }
}
