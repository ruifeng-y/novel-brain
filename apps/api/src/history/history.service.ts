import { HttpStatus, Injectable } from '@nestjs/common';
import {
  HISTORY_MAIN_TEMPLATE,
  HISTORY_VARIANT_LABELS,
  type HistoryCheckInput,
  type HistoryVariant,
} from '@novel/contracts';
import { checkHistoryRules, type HistoryOfficial } from '@novel/core';
import {
  entities,
  entityRelations,
  mapConnections,
  mapNodes,
  workBranches,
  works,
} from '@novel/db';
import { and, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { historyError } from './history.errors';

@Injectable()
export class HistoryService {
  constructor(private readonly database: DatabaseService) {}

  async check(
    userId: string,
    workId: string,
    branchId: string,
    input: HistoryCheckInput,
  ) {
    const work = await this.requireBranch(userId, workId, branchId);
    if (work.genrePack !== 'history') {
      throw historyError(
        HttpStatus.BAD_REQUEST,
        'HISTORY_PACK_REQUIRED',
        'History checks are available only for history works',
      );
    }

    const [settingRows, relationRows, nodeRows, connectionRows] = await Promise.all([
      this.database.db
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.workId, workId),
            eq(entities.branchId, branchId),
            isNull(entities.deletedAt),
          ),
        ),
      this.database.db
        .select()
        .from(entityRelations)
        .where(
          and(
            eq(entityRelations.workId, workId),
            eq(entityRelations.branchId, branchId),
            eq(entityRelations.predicate, 'subordinate'),
          ),
        ),
      this.database.db
        .select({ id: mapNodes.id, name: entities.name })
        .from(mapNodes)
        .innerJoin(entities, eq(entities.id, mapNodes.entityId))
        .where(and(eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId))),
      this.database.db
        .select({
          fromNodeId: mapConnections.fromNodeId,
          toNodeId: mapConnections.toNodeId,
          travelMinutes: mapConnections.travelMinutes,
        })
        .from(mapConnections)
        .where(and(eq(mapConnections.workId, workId), eq(mapConnections.branchId, branchId))),
    ]);

    const superiorByEntityId = new Map(
      relationRows.map((relation) => [relation.fromEntityId, relation.toEntityId]),
    );
    const officials: HistoryOfficial[] = settingRows
      .filter((entity) => entity.subtype === 'bureaucracy')
      .map((entity) => ({
        id: entity.id,
        name: entity.name,
        rank:
          typeof entity.customFields.history_rank === 'number'
            ? entity.customFields.history_rank
            : null,
        superiorId: superiorByEntityId.get(entity.id) ?? null,
      }));

    const armyEntity = input.armyMovement
      ? settingRows.find(
          (entity) =>
            entity.id === input.armyMovement!.armyEntityId &&
            entity.subtype === 'military',
        )
      : undefined;
    const armyMovement = input.armyMovement
      ? {
          army: armyEntity
            ? {
                id: armyEntity.id,
                name: armyEntity.name,
                troops:
                  typeof armyEntity.customFields.history_troops === 'number'
                    ? armyEntity.customFields.history_troops
                    : 0,
                provisionsShi:
                  typeof armyEntity.customFields.history_provisions_shi === 'number'
                    ? armyEntity.customFields.history_provisions_shi
                    : 0,
              }
            : null,
          fromNodeId: input.armyMovement.fromNodeId,
          toNodeId: input.armyMovement.toNodeId,
          plannedDays: input.armyMovement.plannedDays,
        }
      : undefined;

    const result = checkHistoryRules({
      text: input.text,
      officials,
      nodes: nodeRows,
      connections: connectionRows,
      armyMovement,
    });
    const variant = (work.genreVariant ?? 'alternate_ancient') as HistoryVariant;
    return {
      pack: 'history',
      variant,
      variantLabel: HISTORY_VARIANT_LABELS[variant],
      mainTemplate: HISTORY_MAIN_TEMPLATE,
      ...result,
    };
  }

  private async requireBranch(userId: string, workId: string, branchId: string) {
    const [work] = await this.database.db
      .select({
        id: works.id,
        genrePack: works.genrePack,
        genreVariant: works.genreVariant,
      })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw historyError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }
    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw historyError(
        HttpStatus.NOT_FOUND,
        'BRANCH_NOT_FOUND',
        'Story branch not found',
      );
    }
    return work;
  }
}
