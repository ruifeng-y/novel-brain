import type { ChapterAuditInput } from '@novel/core';
import { URBAN_FIELD_KEYS } from '@novel/contracts';
import {
  characterProfiles,
  characterStates,
  entities,
  entityRelations,
  itemOwnerships,
  mapConnections,
  mapNodes,
  powerSystemProfiles,
} from '@novel/db';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DatabaseService } from '../database/database.service';

type AuditOutline = {
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
};

type AuditFact = ChapterAuditInput['confirmedFacts'][number];

export async function loadChapterAuditInput(
  database: DatabaseService,
  workId: string,
  branchId: string,
  chapterNumber: number,
  content: string,
  outline: AuditOutline,
  confirmedFacts: AuditFact[],
  genrePack: string,
): Promise<ChapterAuditInput> {
  const factionEntity = alias(entities, 'audit_faction_entity');
  const placeEntity = alias(entities, 'audit_place_entity');
  const itemEntity = alias(entities, 'audit_item_entity');
  const ownerEntity = alias(entities, 'audit_owner_entity');
  const socialFromEntity = alias(entities, 'audit_social_from_entity');
  const socialToEntity = alias(entities, 'audit_social_to_entity');
  const connectionFromNode = alias(mapNodes, 'audit_connection_from_node');
  const connectionToNode = alias(mapNodes, 'audit_connection_to_node');
  const connectionFromEntity = alias(entities, 'audit_connection_from_entity');
  const connectionToEntity = alias(entities, 'audit_connection_to_entity');

  const [
    characterRows,
    placeRows,
    factionControlRows,
    itemRows,
    connectionRows,
    powerProfileRows,
    urbanSettingRows,
    socialRelationRows,
  ] = await Promise.all([
    database.db
      .select({
        entity: entities,
        state: characterStates,
        profile: characterProfiles,
      })
      .from(entities)
      .leftJoin(
        characterStates,
        and(
          eq(characterStates.characterId, entities.id),
          eq(characterStates.workId, workId),
          eq(characterStates.branchId, branchId),
        ),
      )
      .leftJoin(
        characterProfiles,
        and(
          eq(characterProfiles.entityId, entities.id),
          eq(characterProfiles.workId, workId),
          eq(characterProfiles.branchId, branchId),
        ),
      )
      .where(
        and(
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          eq(entities.type, 'character'),
          isNull(entities.deletedAt),
        ),
      ),
    database.db
      .select({
        id: mapNodes.id,
        name: entities.name,
        aliases: entities.aliases,
      })
      .from(mapNodes)
      .innerJoin(entities, eq(entities.id, mapNodes.entityId))
      .where(and(eq(mapNodes.workId, workId), eq(mapNodes.branchId, branchId))),
    database.db
      .select({
        factionName: factionEntity.name,
        placeName: placeEntity.name,
        validFrom: entityRelations.validFrom,
        validTo: entityRelations.validTo,
      })
      .from(entityRelations)
      .innerJoin(factionEntity, eq(factionEntity.id, entityRelations.fromEntityId))
      .innerJoin(placeEntity, eq(placeEntity.id, entityRelations.toEntityId))
      .where(
        and(
          eq(entityRelations.workId, workId),
          eq(entityRelations.branchId, branchId),
          eq(entityRelations.predicate, 'controls'),
        ),
      ),
    database.db
      .select({
        id: itemOwnerships.itemEntityId,
        name: itemEntity.name,
        ownerName: ownerEntity.name,
      })
      .from(itemOwnerships)
      .innerJoin(itemEntity, eq(itemEntity.id, itemOwnerships.itemEntityId))
      .innerJoin(ownerEntity, eq(ownerEntity.id, itemOwnerships.ownerEntityId))
      .where(
        and(
          eq(itemOwnerships.workId, workId),
          eq(itemOwnerships.branchId, branchId),
          isNull(itemOwnerships.endedAt),
        ),
      ),
    database.db
      .select({
        fromName: connectionFromEntity.name,
        toName: connectionToEntity.name,
        travelMinutes: mapConnections.travelMinutes,
      })
      .from(mapConnections)
      .innerJoin(connectionFromNode, eq(connectionFromNode.id, mapConnections.fromNodeId))
      .innerJoin(connectionToNode, eq(connectionToNode.id, mapConnections.toNodeId))
      .innerJoin(connectionFromEntity, eq(connectionFromEntity.id, connectionFromNode.entityId))
      .innerJoin(connectionToEntity, eq(connectionToEntity.id, connectionToNode.entityId))
      .where(and(eq(mapConnections.workId, workId), eq(mapConnections.branchId, branchId))),
    database.db
      .select({ levels: powerSystemProfiles.levels })
      .from(powerSystemProfiles)
      .where(
        and(eq(powerSystemProfiles.workId, workId), eq(powerSystemProfiles.branchId, branchId)),
      ),
    genrePack === 'urban'
      ? database.db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.workId, workId),
              eq(entities.branchId, branchId),
              ne(entities.subtype, ''),
              isNull(entities.deletedAt),
            ),
          )
      : Promise.resolve([]),
    genrePack === 'urban'
      ? database.db
          .select({
            fromName: socialFromEntity.name,
            toName: socialToEntity.name,
            predicate: entityRelations.predicate,
            validTo: entityRelations.validTo,
          })
          .from(entityRelations)
          .innerJoin(socialFromEntity, eq(socialFromEntity.id, entityRelations.fromEntityId))
          .innerJoin(socialToEntity, eq(socialToEntity.id, entityRelations.toEntityId))
          .where(and(eq(entityRelations.workId, workId), eq(entityRelations.branchId, branchId)))
      : Promise.resolve([]),
  ]);

  const powerLevels = [
    ...new Set(
      powerProfileRows.flatMap((profile) =>
        profile.levels.map((level) => level.name.trim()).filter(Boolean),
      ),
    ),
  ];

  return {
    chapterNumber,
    content,
    genrePack,
    outline,
    confirmedFacts,
    characters: characterRows.map(({ entity, state, profile }) => ({
      id: entity.id,
      name: entity.name,
      aliases: entity.aliases,
      voice: profile?.voice ?? undefined,
      body: state?.body ?? undefined,
      power: state?.power ?? undefined,
      location: state?.location ?? undefined,
      possessions: state?.possessions ?? undefined,
      knowledge: state?.knowledge ?? [],
    })),
    places: placeRows,
    factionControls: factionControlRows,
    items: itemRows,
    mapConnections: connectionRows,
    powerLevels,
    ...(genrePack === 'urban'
      ? {
          urban: {
            relationships: socialRelationRows,
            moneyAccounts: urbanMoneyAccounts(urbanSettingRows),
            laws: urbanLaws(urbanSettingRows),
          },
        }
      : {}),
  };
}

function urbanMoneyAccounts(
  settings: Array<{
    name: string;
    subtype: string;
    customFields: Record<string, unknown>;
  }>,
) {
  return settings.flatMap((setting) => {
    if (setting.subtype === 'money') {
      const balance = numericField(setting.customFields, URBAN_FIELD_KEYS.money.balance);
      if (balance === undefined) {
        return [];
      }
      return [
        {
          name: setting.name,
          holderName:
            stringField(setting.customFields, URBAN_FIELD_KEYS.money.holder) || setting.name,
          balanceWan: balance,
          currency: stringField(setting.customFields, URBAN_FIELD_KEYS.money.currency) || '人民币',
        },
      ];
    }
    if (setting.subtype === 'company') {
      const balance = numericField(setting.customFields, URBAN_FIELD_KEYS.company.cashBalance);
      if (balance === undefined) {
        return [];
      }
      return [
        {
          name: setting.name,
          holderName:
            stringField(setting.customFields, URBAN_FIELD_KEYS.company.legalRepresentative) ||
            setting.name,
          balanceWan: balance,
          currency: '人民币',
        },
      ];
    }
    return [];
  });
}

function urbanLaws(
  settings: Array<{
    name: string;
    subtype: string;
    customFields: Record<string, unknown>;
  }>,
) {
  return settings
    .filter((setting) => setting.subtype === 'law')
    .map((setting) => ({
      name: setting.name,
      prohibitedActions: stringArrayField(
        setting.customFields,
        URBAN_FIELD_KEYS.law.prohibitedActions,
      ),
    }))
    .filter((law) => law.prohibitedActions.length > 0);
}

function stringField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numericField(fields: Record<string, unknown>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringArrayField(fields: Record<string, unknown>, key: string): string[] {
  const value = fields[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
