import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ENTITY_TYPE_LABELS,
  ITEM_TECHNIQUE_KIND_LABELS,
  STORY_DURATION_UNIT_LABELS,
  type BreakthroughCheckInput,
  type EndItemOwnershipInput,
  type GoldenFingerInput,
  type GoldenFingerUpdateInput,
  type ItemOwnershipInput,
  type ItemTechniqueProfileInput,
  type PowerSystemProfileInput,
  type StoryAbsoluteDate,
  type StoryDuration,
  type TimelineEraInput,
  type TimelineNodeInput,
} from '@novel/contracts';
import {
  entities,
  goldenFingers,
  itemOwnerships,
  itemTechniqueProfiles,
  powerSystemProfiles,
  timelineEras,
  timelineEventNodes,
  workBranches,
  works,
  type EntityRow,
  type PowerBreakthroughValue,
} from '@novel/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DatabaseService } from '../database/database.service';
import { worldbuildingError } from './worldbuilding.errors';

type PowerSystemProfileResponse = PowerSystemProfileInput & {
  id: string | null;
  workId: string;
  branchId: string;
  entityId: string;
  totalLevels: number;
  totalPaths: number;
  totalBreakthroughs: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type GoldenFingerResponse = {
  id: string;
  workId: string;
  branchId: string;
  ownerEntityId: string;
  ownerEntity: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
  };
  name: string;
  rules: string[];
  costs: string[];
  limits: string[];
  growthCurve: Array<{ stage: string; description: string }>;
  createdAt: string;
  updatedAt: string;
};

type ItemOwnershipResponse = {
  id: string;
  itemEntityId: string;
  ownerEntityId: string;
  ownerEntity: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
  };
  fromTime: string;
  endedAt: string | null;
  source: string;
  current: boolean;
  createdAt: string;
  updatedAt: string;
};

type ItemTechniqueProfileResponse = ItemTechniqueProfileInput & {
  id: string | null;
  workId: string;
  branchId: string;
  entityId: string;
  kindLabel: string;
  ownerships: ItemOwnershipResponse[];
  currentOwner: {
    ownershipId: string;
    ownerEntityId: string;
    ownerName: string;
    fromTime: string;
  } | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type TimelineEraResponse = TimelineEraInput & {
  id: string;
  workId: string;
  branchId: string;
  timelineEntityId: string;
  startDateLabel: string;
  endDateLabel: string;
  createdAt: string;
  updatedAt: string;
};

type TimelineNodeResponse = TimelineNodeInput & {
  id: string;
  workId: string;
  branchId: string;
  timelineEntityId: string;
  era: { id: string; name: string } | null;
  relativeToNode: { id: string; title: string } | null;
  absoluteDateLabel: string;
  durationLabel: string;
  createdAt: string;
  updatedAt: string;
};

type TimelineResponse = {
  workId: string;
  branchId: string;
  entityId: string;
  eras: TimelineEraResponse[];
  nodes: TimelineNodeResponse[];
};

const relativeTimelineNodes = alias(timelineEventNodes, 'relative_timeline_nodes');

@Injectable()
export class WorldbuildingService {
  constructor(private readonly database: DatabaseService) {}

  async getPowerSystemProfile(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<PowerSystemProfileResponse> {
    await this.requireEntity(userId, workId, branchId, entityId, 'power_system');
    const [profile] = await this.database.db
      .select()
      .from(powerSystemProfiles)
      .where(
        and(
          eq(powerSystemProfiles.workId, workId),
          eq(powerSystemProfiles.branchId, branchId),
          eq(powerSystemProfiles.entityId, entityId),
        ),
      )
      .limit(1);

    if (!profile) {
      return {
        id: null,
        workId,
        branchId,
        entityId,
        levels: [],
        paths: [],
        breakthroughs: [],
        totalLevels: 0,
        totalPaths: 0,
        totalBreakthroughs: 0,
        createdAt: null,
        updatedAt: null,
      };
    }

    return {
      id: profile.id,
      workId,
      branchId,
      entityId,
      levels: profile.levels,
      paths: profile.paths,
      breakthroughs: profile.breakthroughs,
      totalLevels: profile.levels.length,
      totalPaths: profile.paths.length,
      totalBreakthroughs: profile.breakthroughs.length,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async savePowerSystemProfile(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: PowerSystemProfileInput,
  ): Promise<PowerSystemProfileResponse> {
    await this.requireEntity(userId, workId, branchId, entityId, 'power_system');
    const now = new Date();
    const [profile] = await this.database.db
      .insert(powerSystemProfiles)
      .values({
        workId,
        branchId,
        entityId,
        levels: input.levels,
        paths: input.paths,
        breakthroughs: input.breakthroughs,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: powerSystemProfiles.entityId,
        set: {
          levels: input.levels,
          paths: input.paths,
          breakthroughs: input.breakthroughs,
          updatedAt: now,
        },
      })
      .returning();
    await this.touchWork(workId, now);

    return {
      id: profile.id,
      workId,
      branchId,
      entityId,
      levels: profile.levels,
      paths: profile.paths,
      breakthroughs: profile.breakthroughs,
      totalLevels: profile.levels.length,
      totalPaths: profile.paths.length,
      totalBreakthroughs: profile.breakthroughs.length,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  async checkBreakthrough(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: BreakthroughCheckInput,
  ) {
    const profile = await this.getPowerSystemProfile(userId, workId, branchId, entityId);
    const rule = profile.breakthroughs.find(
      (candidate) => candidate.fromLevel === input.fromLevel && candidate.toLevel === input.toLevel,
    );
    if (!rule) {
      throw worldbuildingError(
        HttpStatus.BAD_REQUEST,
        'BREAKTHROUGH_RULE_NOT_FOUND',
        'No breakthrough rule exists for these levels',
      );
    }

    return this.evaluateBreakthrough(rule, input);
  }

  async listGoldenFingers(
    userId: string,
    workId: string,
    branchId: string,
    ownerEntityId?: string,
  ): Promise<{ items: GoldenFingerResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    if (ownerEntityId) {
      await this.requireEntity(userId, workId, branchId, ownerEntityId, [
        'character',
        'power_system',
      ]);
    }

    const conditions = [eq(goldenFingers.workId, workId), eq(goldenFingers.branchId, branchId)];
    if (ownerEntityId) {
      conditions.push(eq(goldenFingers.ownerEntityId, ownerEntityId));
    }

    const rows = await this.database.db
      .select({
        goldenFinger: goldenFingers,
        ownerName: entities.name,
        ownerType: entities.type,
      })
      .from(goldenFingers)
      .innerJoin(entities, eq(entities.id, goldenFingers.ownerEntityId))
      .where(and(...conditions))
      .orderBy(goldenFingers.name);

    return {
      items: rows.map((row) =>
        this.toGoldenFingerResponse(row.goldenFinger, row.ownerName, row.ownerType),
      ),
    };
  }

  async createGoldenFinger(
    userId: string,
    workId: string,
    branchId: string,
    input: GoldenFingerInput,
  ): Promise<GoldenFingerResponse> {
    const owner = await this.requireEntity(userId, workId, branchId, input.ownerEntityId, [
      'character',
      'power_system',
    ]);
    const now = new Date();
    try {
      const [created] = await this.database.db
        .insert(goldenFingers)
        .values({
          workId,
          branchId,
          ownerEntityId: owner.id,
          name: input.name,
          rules: input.rules,
          costs: input.costs,
          limits: input.limits,
          growthCurve: input.growthCurve,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.touchWork(workId, now);
      return this.toGoldenFingerResponse(created, owner.name, owner.type);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw worldbuildingError(
          HttpStatus.CONFLICT,
          'GOLDEN_FINGER_NAME_CONFLICT',
          'This setting already has a golden finger with that name',
        );
      }
      throw error;
    }
  }

  async updateGoldenFinger(
    userId: string,
    workId: string,
    branchId: string,
    goldenFingerId: string,
    input: GoldenFingerUpdateInput,
  ): Promise<GoldenFingerResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [existing] = await this.database.db
      .select()
      .from(goldenFingers)
      .where(
        and(
          eq(goldenFingers.id, goldenFingerId),
          eq(goldenFingers.workId, workId),
          eq(goldenFingers.branchId, branchId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw worldbuildingError(
        HttpStatus.NOT_FOUND,
        'GOLDEN_FINGER_NOT_FOUND',
        'Golden finger not found',
      );
    }
    const owner =
      input.ownerEntityId && input.ownerEntityId !== existing.ownerEntityId
        ? await this.requireEntity(userId, workId, branchId, input.ownerEntityId, [
            'character',
            'power_system',
          ])
        : await this.requireEntity(userId, workId, branchId, existing.ownerEntityId, [
            'character',
            'power_system',
          ]);
    const now = new Date();

    try {
      const [updated] = await this.database.db
        .update(goldenFingers)
        .set({
          ...(input.ownerEntityId === undefined ? {} : { ownerEntityId: owner.id }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.rules === undefined ? {} : { rules: input.rules }),
          ...(input.costs === undefined ? {} : { costs: input.costs }),
          ...(input.limits === undefined ? {} : { limits: input.limits }),
          ...(input.growthCurve === undefined ? {} : { growthCurve: input.growthCurve }),
          updatedAt: now,
        })
        .where(eq(goldenFingers.id, existing.id))
        .returning();
      await this.touchWork(workId, now);
      return this.toGoldenFingerResponse(updated, owner.name, owner.type);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw worldbuildingError(
          HttpStatus.CONFLICT,
          'GOLDEN_FINGER_NAME_CONFLICT',
          'This setting already has a golden finger with that name',
        );
      }
      throw error;
    }
  }

  async getItemTechniqueProfile(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<ItemTechniqueProfileResponse> {
    await this.requireEntity(userId, workId, branchId, entityId, 'item_technique');
    const [profile] = await this.database.db
      .select()
      .from(itemTechniqueProfiles)
      .where(
        and(
          eq(itemTechniqueProfiles.workId, workId),
          eq(itemTechniqueProfiles.branchId, branchId),
          eq(itemTechniqueProfiles.entityId, entityId),
        ),
      )
      .limit(1);
    const ownerships = await this.listItemOwnerships(workId, branchId, entityId);
    const currentOwner = ownerships.find((ownership) => ownership.current);

    return {
      id: profile?.id ?? null,
      workId,
      branchId,
      entityId,
      kind: profile?.kind ?? 'item',
      kindLabel: ITEM_TECHNIQUE_KIND_LABELS[profile?.kind ?? 'item'],
      grade: profile?.grade ?? '',
      effects: profile?.effects ?? [],
      costs: profile?.costs ?? [],
      restrictions: profile?.restrictions ?? [],
      ownerships,
      currentOwner: currentOwner
        ? {
            ownershipId: currentOwner.id,
            ownerEntityId: currentOwner.ownerEntityId,
            ownerName: currentOwner.ownerEntity.name,
            fromTime: currentOwner.fromTime,
          }
        : null,
      createdAt: profile?.createdAt.toISOString() ?? null,
      updatedAt: profile?.updatedAt.toISOString() ?? null,
    };
  }

  async saveItemTechniqueProfile(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: ItemTechniqueProfileInput,
  ): Promise<ItemTechniqueProfileResponse> {
    await this.requireEntity(userId, workId, branchId, entityId, 'item_technique');
    const now = new Date();
    await this.database.db
      .insert(itemTechniqueProfiles)
      .values({
        workId,
        branchId,
        entityId,
        kind: input.kind,
        grade: input.grade,
        effects: input.effects,
        costs: input.costs,
        restrictions: input.restrictions,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: itemTechniqueProfiles.entityId,
        set: {
          kind: input.kind,
          grade: input.grade,
          effects: input.effects,
          costs: input.costs,
          restrictions: input.restrictions,
          updatedAt: now,
        },
      });
    await this.touchWork(workId, now);
    return this.getItemTechniqueProfile(userId, workId, branchId, entityId);
  }

  async createItemOwnership(
    userId: string,
    workId: string,
    branchId: string,
    itemEntityId: string,
    input: ItemOwnershipInput,
  ): Promise<ItemOwnershipResponse> {
    await this.requireEntity(userId, workId, branchId, itemEntityId, 'item_technique');
    const owner = await this.requireEntity(userId, workId, branchId, input.ownerEntityId, [
      'character',
      'faction',
    ]);
    const currentOwner = await this.findCurrentItemOwner(workId, branchId, itemEntityId);
    if (currentOwner) {
      throw this.itemOwnershipConflict(currentOwner);
    }

    const now = new Date();
    try {
      const [created] = await this.database.db
        .insert(itemOwnerships)
        .values({
          workId,
          branchId,
          itemEntityId,
          ownerEntityId: owner.id,
          fromTime: input.fromTime,
          source: input.source,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.touchWork(workId, now);
      return this.toItemOwnershipResponse(created, owner.name, owner.type);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const racedOwner = await this.findCurrentItemOwner(workId, branchId, itemEntityId);
        if (racedOwner) {
          throw this.itemOwnershipConflict(racedOwner);
        }
      }
      throw error;
    }
  }

  async endItemOwnership(
    userId: string,
    workId: string,
    branchId: string,
    itemEntityId: string,
    ownershipId: string,
    input: EndItemOwnershipInput,
  ): Promise<ItemOwnershipResponse> {
    await this.requireEntity(userId, workId, branchId, itemEntityId, 'item_technique');
    const [existing] = await this.database.db
      .select({
        ownership: itemOwnerships,
        ownerName: entities.name,
        ownerType: entities.type,
      })
      .from(itemOwnerships)
      .innerJoin(entities, eq(entities.id, itemOwnerships.ownerEntityId))
      .where(
        and(
          eq(itemOwnerships.id, ownershipId),
          eq(itemOwnerships.workId, workId),
          eq(itemOwnerships.branchId, branchId),
          eq(itemOwnerships.itemEntityId, itemEntityId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw worldbuildingError(
        HttpStatus.NOT_FOUND,
        'ITEM_OWNERSHIP_NOT_FOUND',
        'Item ownership record not found',
      );
    }

    const now = new Date();
    const [updated] = await this.database.db
      .update(itemOwnerships)
      .set({ endedAt: input.endedAt, updatedAt: now })
      .where(eq(itemOwnerships.id, existing.ownership.id))
      .returning();
    await this.touchWork(workId, now);
    return this.toItemOwnershipResponse(updated, existing.ownerName, existing.ownerType);
  }

  async getTimeline(
    userId: string,
    workId: string,
    branchId: string,
    timelineEntityId: string,
  ): Promise<TimelineResponse> {
    await this.requireEntity(userId, workId, branchId, timelineEntityId, 'timeline');
    const [eras, nodes] = await Promise.all([
      this.database.db
        .select()
        .from(timelineEras)
        .where(eq(timelineEras.timelineEntityId, timelineEntityId))
        .orderBy(timelineEras.createdAt),
      this.database.db
        .select({
          node: timelineEventNodes,
          eraName: timelineEras.name,
          relativeTitle: relativeTimelineNodes.title,
        })
        .from(timelineEventNodes)
        .leftJoin(timelineEras, eq(timelineEras.id, timelineEventNodes.eraId))
        .leftJoin(
          relativeTimelineNodes,
          eq(relativeTimelineNodes.id, timelineEventNodes.relativeToNodeId),
        )
        .where(eq(timelineEventNodes.timelineEntityId, timelineEntityId))
        .orderBy(timelineEventNodes.orderIndex, timelineEventNodes.createdAt),
    ]);
    return {
      workId,
      branchId,
      entityId: timelineEntityId,
      eras: eras.map((era) => this.toTimelineEraResponse(era)),
      nodes: nodes.map((row) =>
        this.toTimelineNodeResponse(row.node, row.eraName, row.relativeTitle),
      ),
    };
  }

  async createTimelineEra(
    userId: string,
    workId: string,
    branchId: string,
    timelineEntityId: string,
    input: TimelineEraInput,
  ): Promise<TimelineEraResponse> {
    await this.requireEntity(userId, workId, branchId, timelineEntityId, 'timeline');
    const now = new Date();
    try {
      const [created] = await this.database.db
        .insert(timelineEras)
        .values({
          workId,
          branchId,
          timelineEntityId,
          name: input.name,
          summary: input.summary,
          startDate: input.startDate,
          endDate: input.endDate,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.touchWork(workId, now);
      return this.toTimelineEraResponse(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw worldbuildingError(
          HttpStatus.CONFLICT,
          'TIMELINE_ERA_NAME_CONFLICT',
          'This timeline already has an era with that name',
        );
      }
      throw error;
    }
  }

  async updateTimelineEra(
    userId: string,
    workId: string,
    branchId: string,
    timelineEntityId: string,
    eraId: string,
    input: Partial<TimelineEraInput>,
  ): Promise<TimelineEraResponse> {
    await this.requireEntity(userId, workId, branchId, timelineEntityId, 'timeline');
    const [existing] = await this.database.db
      .select()
      .from(timelineEras)
      .where(
        and(
          eq(timelineEras.id, eraId),
          eq(timelineEras.workId, workId),
          eq(timelineEras.branchId, branchId),
          eq(timelineEras.timelineEntityId, timelineEntityId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw worldbuildingError(
        HttpStatus.NOT_FOUND,
        'TIMELINE_ERA_NOT_FOUND',
        'Timeline era not found',
      );
    }
    const now = new Date();
    try {
      const [updated] = await this.database.db
        .update(timelineEras)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
          ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
          updatedAt: now,
        })
        .where(eq(timelineEras.id, existing.id))
        .returning();
      await this.touchWork(workId, now);
      return this.toTimelineEraResponse(updated);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw worldbuildingError(
          HttpStatus.CONFLICT,
          'TIMELINE_ERA_NAME_CONFLICT',
          'This timeline already has an era with that name',
        );
      }
      throw error;
    }
  }

  async createTimelineNode(
    userId: string,
    workId: string,
    branchId: string,
    timelineEntityId: string,
    input: TimelineNodeInput,
  ): Promise<TimelineNodeResponse> {
    await this.requireEntity(userId, workId, branchId, timelineEntityId, 'timeline');
    await this.validateTimelineLinks(workId, branchId, timelineEntityId, input);
    const now = new Date();
    const [created] = await this.database.db
      .insert(timelineEventNodes)
      .values({
        workId,
        branchId,
        timelineEntityId,
        eraId: input.eraId,
        title: input.title,
        summary: input.summary,
        absoluteDate: input.absoluteDate,
        relativeTime: input.relativeTime,
        relativeToNodeId: input.relativeToNodeId,
        duration: input.duration,
        orderIndex: input.orderIndex,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.touchWork(workId, now);
    return this.findTimelineNode(timelineEntityId, created.id);
  }

  async updateTimelineNode(
    userId: string,
    workId: string,
    branchId: string,
    timelineEntityId: string,
    nodeId: string,
    input: Partial<TimelineNodeInput>,
  ): Promise<TimelineNodeResponse> {
    await this.requireEntity(userId, workId, branchId, timelineEntityId, 'timeline');
    const existing = await this.requireTimelineNode(workId, branchId, timelineEntityId, nodeId);
    await this.validateTimelineLinks(workId, branchId, timelineEntityId, {
      eraId: input.eraId === undefined ? existing.eraId : input.eraId,
      relativeToNodeId:
        input.relativeToNodeId === undefined ? existing.relativeToNodeId : input.relativeToNodeId,
      title: input.title ?? existing.title,
    });
    const now = new Date();
    await this.database.db
      .update(timelineEventNodes)
      .set({
        ...(input.eraId === undefined ? {} : { eraId: input.eraId }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        ...(input.absoluteDate === undefined ? {} : { absoluteDate: input.absoluteDate }),
        ...(input.relativeTime === undefined ? {} : { relativeTime: input.relativeTime }),
        ...(input.relativeToNodeId === undefined
          ? {}
          : { relativeToNodeId: input.relativeToNodeId }),
        ...(input.duration === undefined ? {} : { duration: input.duration }),
        ...(input.orderIndex === undefined ? {} : { orderIndex: input.orderIndex }),
        updatedAt: now,
      })
      .where(eq(timelineEventNodes.id, existing.id));
    await this.touchWork(workId, now);
    return this.findTimelineNode(timelineEntityId, existing.id);
  }

  private evaluateBreakthrough(rule: PowerBreakthroughValue, input: BreakthroughCheckInput) {
    const metConditions = new Set(input.conditionsMet);
    const missingConditions = rule.conditions.filter((condition) => !metConditions.has(condition));
    const availableByName = new Map(
      input.resourcesAvailable.map((resource) => [resource.name, resource.amount]),
    );
    const missingResources = rule.resources
      .map((resource) => {
        const available = availableByName.get(resource.name) ?? 0;
        return {
          name: resource.name,
          required: resource.amount,
          available,
        };
      })
      .filter((resource) => resource.available < resource.required);

    return {
      allowed: missingConditions.length === 0 && missingResources.length === 0,
      rule,
      missingConditions,
      missingResources,
    };
  }

  private async requireEntity(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    expectedTypes: string | string[],
  ): Promise<EntityRow> {
    await this.requireBranch(userId, workId, branchId);
    const types = Array.isArray(expectedTypes) ? expectedTypes : [expectedTypes];

    const [entity] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          inArray(entities.type, types),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!entity) {
      throw worldbuildingError(HttpStatus.NOT_FOUND, 'SETTING_NOT_FOUND', 'Setting not found');
    }
    return entity;
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw worldbuildingError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw worldbuildingError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
  }

  private async touchWork(workId: string, now: Date): Promise<void> {
    await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private async listItemOwnerships(
    workId: string,
    branchId: string,
    itemEntityId: string,
  ): Promise<ItemOwnershipResponse[]> {
    const rows = await this.database.db
      .select({
        ownership: itemOwnerships,
        ownerName: entities.name,
        ownerType: entities.type,
      })
      .from(itemOwnerships)
      .innerJoin(entities, eq(entities.id, itemOwnerships.ownerEntityId))
      .where(
        and(
          eq(itemOwnerships.workId, workId),
          eq(itemOwnerships.branchId, branchId),
          eq(itemOwnerships.itemEntityId, itemEntityId),
        ),
      )
      .orderBy(itemOwnerships.createdAt);
    return rows.map((row) =>
      this.toItemOwnershipResponse(row.ownership, row.ownerName, row.ownerType),
    );
  }

  private async findCurrentItemOwner(
    workId: string,
    branchId: string,
    itemEntityId: string,
  ): Promise<ItemOwnershipResponse | undefined> {
    const rows = await this.database.db
      .select({
        ownership: itemOwnerships,
        ownerName: entities.name,
        ownerType: entities.type,
      })
      .from(itemOwnerships)
      .innerJoin(entities, eq(entities.id, itemOwnerships.ownerEntityId))
      .where(
        and(
          eq(itemOwnerships.workId, workId),
          eq(itemOwnerships.branchId, branchId),
          eq(itemOwnerships.itemEntityId, itemEntityId),
          isNull(itemOwnerships.endedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row
      ? this.toItemOwnershipResponse(row.ownership, row.ownerName, row.ownerType)
      : undefined;
  }

  private itemOwnershipConflict(currentOwner: ItemOwnershipResponse) {
    return worldbuildingError(
      HttpStatus.CONFLICT,
      'ITEM_OWNERSHIP_CONFLICT',
      'This item already has a current owner',
      {
        currentOwner: {
          ownershipId: currentOwner.id,
          ownerEntityId: currentOwner.ownerEntityId,
          ownerName: currentOwner.ownerEntity.name,
          fromTime: currentOwner.fromTime,
        },
      },
    );
  }

  private async validateTimelineLinks(
    workId: string,
    branchId: string,
    timelineEntityId: string,
    input: { eraId: string | null; relativeToNodeId: string | null; title: string },
  ): Promise<void> {
    if (input.eraId) {
      const [era] = await this.database.db
        .select({ id: timelineEras.id })
        .from(timelineEras)
        .where(
          and(
            eq(timelineEras.id, input.eraId),
            eq(timelineEras.workId, workId),
            eq(timelineEras.branchId, branchId),
            eq(timelineEras.timelineEntityId, timelineEntityId),
          ),
        )
        .limit(1);
      if (!era) {
        throw worldbuildingError(
          HttpStatus.BAD_REQUEST,
          'TIMELINE_ERA_INVALID',
          'Choose an era from this timeline',
        );
      }
    }

    if (input.relativeToNodeId) {
      const [node] = await this.database.db
        .select({ id: timelineEventNodes.id })
        .from(timelineEventNodes)
        .where(
          and(
            eq(timelineEventNodes.id, input.relativeToNodeId),
            eq(timelineEventNodes.workId, workId),
            eq(timelineEventNodes.branchId, branchId),
            eq(timelineEventNodes.timelineEntityId, timelineEntityId),
          ),
        )
        .limit(1);
      if (!node) {
        throw worldbuildingError(
          HttpStatus.BAD_REQUEST,
          'TIMELINE_NODE_INVALID',
          'Choose a preceding event from this timeline',
        );
      }
    }
  }

  private async requireTimelineNode(
    workId: string,
    branchId: string,
    timelineEntityId: string,
    nodeId: string,
  ): Promise<typeof timelineEventNodes.$inferSelect> {
    const [node] = await this.database.db
      .select()
      .from(timelineEventNodes)
      .where(
        and(
          eq(timelineEventNodes.id, nodeId),
          eq(timelineEventNodes.workId, workId),
          eq(timelineEventNodes.branchId, branchId),
          eq(timelineEventNodes.timelineEntityId, timelineEntityId),
        ),
      )
      .limit(1);
    if (!node) {
      throw worldbuildingError(
        HttpStatus.NOT_FOUND,
        'TIMELINE_NODE_NOT_FOUND',
        'Timeline event not found',
      );
    }
    return node;
  }

  private async findTimelineNode(
    timelineEntityId: string,
    nodeId: string,
  ): Promise<TimelineNodeResponse> {
    const [row] = await this.database.db
      .select({
        node: timelineEventNodes,
        eraName: timelineEras.name,
        relativeTitle: relativeTimelineNodes.title,
      })
      .from(timelineEventNodes)
      .leftJoin(timelineEras, eq(timelineEras.id, timelineEventNodes.eraId))
      .leftJoin(
        relativeTimelineNodes,
        eq(relativeTimelineNodes.id, timelineEventNodes.relativeToNodeId),
      )
      .where(
        and(
          eq(timelineEventNodes.id, nodeId),
          eq(timelineEventNodes.timelineEntityId, timelineEntityId),
        ),
      )
      .limit(1);
    if (!row) {
      throw worldbuildingError(
        HttpStatus.NOT_FOUND,
        'TIMELINE_NODE_NOT_FOUND',
        'Timeline event not found',
      );
    }
    return this.toTimelineNodeResponse(row.node, row.eraName, row.relativeTitle);
  }

  private formatAbsoluteDate(value: StoryAbsoluteDate | null): string {
    if (!value) {
      return '';
    }
    const date = [
      `${value.year}年`,
      value.month === undefined ? '' : `${value.month}月`,
      value.day === undefined ? '' : `${value.day}日`,
    ].join('');
    return value.note ? `${date}（${value.note}）` : date;
  }

  private formatDuration(value: StoryDuration | null): string {
    return value ? `${value.amount}${STORY_DURATION_UNIT_LABELS[value.unit]}` : '';
  }

  private toGoldenFingerResponse(
    row: typeof goldenFingers.$inferSelect,
    ownerName: string,
    ownerType: string,
  ): GoldenFingerResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      ownerEntityId: row.ownerEntityId,
      ownerEntity: {
        id: row.ownerEntityId,
        name: ownerName,
        type: ownerType,
        typeLabel: ENTITY_TYPE_LABELS[ownerType as keyof typeof ENTITY_TYPE_LABELS] ?? ownerType,
      },
      name: row.name,
      rules: row.rules,
      costs: row.costs,
      limits: row.limits,
      growthCurve: row.growthCurve,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toItemOwnershipResponse(
    row: typeof itemOwnerships.$inferSelect,
    ownerName: string,
    ownerType: string,
  ): ItemOwnershipResponse {
    return {
      id: row.id,
      itemEntityId: row.itemEntityId,
      ownerEntityId: row.ownerEntityId,
      ownerEntity: {
        id: row.ownerEntityId,
        name: ownerName,
        type: ownerType,
        typeLabel: ENTITY_TYPE_LABELS[ownerType as keyof typeof ENTITY_TYPE_LABELS] ?? ownerType,
      },
      fromTime: row.fromTime,
      endedAt: row.endedAt,
      source: row.source,
      current: row.endedAt === null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toTimelineEraResponse(row: typeof timelineEras.$inferSelect): TimelineEraResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      timelineEntityId: row.timelineEntityId,
      name: row.name,
      summary: row.summary,
      startDate: row.startDate,
      endDate: row.endDate,
      startDateLabel: this.formatAbsoluteDate(row.startDate),
      endDateLabel: this.formatAbsoluteDate(row.endDate),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toTimelineNodeResponse(
    row: typeof timelineEventNodes.$inferSelect,
    eraName: string | null,
    relativeTitle: string | null,
  ): TimelineNodeResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      timelineEntityId: row.timelineEntityId,
      title: row.title,
      summary: row.summary,
      eraId: row.eraId,
      era: row.eraId && eraName ? { id: row.eraId, name: eraName } : null,
      absoluteDate: row.absoluteDate,
      absoluteDateLabel: this.formatAbsoluteDate(row.absoluteDate),
      relativeTime: row.relativeTime,
      relativeToNodeId: row.relativeToNodeId,
      relativeToNode:
        row.relativeToNodeId && relativeTitle
          ? { id: row.relativeToNodeId, title: relativeTitle }
          : null,
      duration: row.duration,
      durationLabel: this.formatDuration(row.duration),
      orderIndex: row.orderIndex,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
