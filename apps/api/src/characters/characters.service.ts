import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ENTITY_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  RELATION_PREDICATE_LABELS,
  type CharacterProfile,
  type CharacterProfileInput,
  type CharacterStateSaveInput,
} from '@novel/contracts';
import {
  characterProfiles,
  characterStates,
  characterStateRevisions,
  entities,
  entityRelations,
  workBranches,
  works,
  type CharacterProfileRow,
  type CharacterStateRow,
  type CharacterStateRevisionRow,
  type CharacterStateValue,
  type EntityRow,
} from '@novel/db';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { charactersError } from './characters.errors';

type CharacterResponse = {
  id: string;
  workId: string;
  branchId: string;
  name: string;
  aliases: string[];
  type: string;
  typeLabel: string;
  summary: string;
  description: string;
  tags: string[];
  scope: string;
  status: string;
  statusLabel: string;
  source: string;
  customFields: EntityRow['customFields'];
  createdAt: string;
  updatedAt: string;
};

type RelationshipResponse = {
  id: string;
  predicate: string;
  predicateLabel: string;
  fromEntity: { id: string; name: string; type: string; typeLabel: string };
  toEntity: { id: string; name: string; type: string; typeLabel: string };
  validFrom: string | null;
  validTo: string | null;
  source: string;
};

type ProfileDetail = CharacterProfile & {
  relationships: RelationshipResponse[];
};

type CharacterStateResponse = CharacterStateValue & {
  version: number;
  updatedAt: string | null;
};

type CharacterStateHistoryResponse = {
  id: string;
  version: number;
  reason: string;
  source: string;
  changedFields: string[];
  beforeState: CharacterStateValue | null;
  afterState: CharacterStateValue;
  createdAt: string;
};

type CharacterDetail = {
  character: CharacterResponse;
  profile: ProfileDetail;
  state: CharacterStateResponse;
  history: CharacterStateHistoryResponse[];
};

const fromEntities = alias(entities, 'character_relation_from_entities');
const toEntities = alias(entities, 'character_relation_to_entities');

@Injectable()
export class CharactersService {
  constructor(private readonly database: DatabaseService) {}

  async getCharacter(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
  ): Promise<CharacterDetail> {
    await this.requireBranch(userId, workId, branchId);
    const character = await this.requireCharacter(workId, branchId, characterId);
    const [profileRows, stateRows, historyRows, relationships] = await Promise.all([
      this.database.db
        .select()
        .from(characterProfiles)
        .where(
          and(
            eq(characterProfiles.workId, workId),
            eq(characterProfiles.branchId, branchId),
            eq(characterProfiles.entityId, characterId),
          ),
        )
        .limit(1),
      this.database.db
        .select()
        .from(characterStates)
        .where(
          and(
            eq(characterStates.workId, workId),
            eq(characterStates.branchId, branchId),
            eq(characterStates.characterId, characterId),
          ),
        )
        .limit(1),
      this.database.db
        .select()
        .from(characterStateRevisions)
        .where(
          and(
            eq(characterStateRevisions.workId, workId),
            eq(characterStateRevisions.branchId, branchId),
            eq(characterStateRevisions.characterId, characterId),
          ),
        )
        .orderBy(desc(characterStateRevisions.version)),
      this.listRelationships(workId, branchId, characterId),
    ]);

    return {
      character: this.toCharacterResponse(character),
      profile: this.toProfileDetail(profileRows[0], relationships),
      state: this.toState(stateRows[0]),
      history: historyRows.map((row) => this.toStateHistory(row)),
    };
  }

  async saveProfile(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterProfileInput,
  ): Promise<CharacterProfile> {
    await this.requireBranch(userId, workId, branchId);
    const character = await this.requireCharacter(workId, branchId, characterId);
    const now = new Date();
    const [saved] = await this.database.db
      .insert(characterProfiles)
      .values({
        workId,
        branchId,
        entityId: character.id,
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: characterProfiles.entityId,
        set: {
          ...input,
          updatedAt: now,
        },
      })
      .returning();
    await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
    return this.toProfile(saved);
  }

  async saveState(
    userId: string,
    workId: string,
    branchId: string,
    characterId: string,
    input: CharacterStateSaveInput,
  ): Promise<CharacterDetail> {
    await this.requireBranch(userId, workId, branchId);
    const character = await this.requireCharacter(workId, branchId, characterId);
    const [existing] = await this.database.db
      .select()
      .from(characterStates)
      .where(
        and(
          eq(characterStates.workId, workId),
          eq(characterStates.branchId, branchId),
          eq(characterStates.characterId, characterId),
        ),
      )
      .limit(1);

    const beforeState = existing ? this.toSnapshot(existing) : null;
    const current = beforeState ?? this.emptyState();
    const afterState: CharacterStateValue = {
      body: input.body ?? current.body,
      power: input.power ?? current.power,
      location: input.location ?? current.location,
      possessions: input.possessions ?? current.possessions,
      disguise: input.disguise ?? current.disguise,
      knowledge: input.knowledge
        ? input.knowledge.map((entry) => ({
            id: entry.id ?? randomUUID(),
            title: entry.title,
            objectiveTruth: entry.objectiveTruth,
            characterBelief: entry.characterBelief,
            validFrom: entry.validFrom,
            validTo: entry.validTo,
            source: entry.source,
          }))
        : current.knowledge,
    };
    const changedFields = this.changedStateFields(beforeState, afterState);
    const version = (existing?.version ?? 0) + 1;
    const now = new Date();

    await this.database.db.transaction(async (tx) => {
      if (existing) {
        await tx
          .update(characterStates)
          .set({
            ...afterState,
            version,
            updatedBy: userId,
            updatedAt: now,
          })
          .where(eq(characterStates.id, existing.id));
      } else {
        await tx.insert(characterStates).values({
          workId,
          branchId,
          characterId: character.id,
          ...afterState,
          version,
          updatedBy: userId,
          createdAt: now,
          updatedAt: now,
        });
      }

      await tx.insert(characterStateRevisions).values({
        workId,
        branchId,
        characterId: character.id,
        userId,
        version,
        reason: input.reason,
        source: input.source,
        changedFields,
        beforeState,
        afterState,
        createdAt: now,
      });
      await tx.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
    });

    return this.getCharacter(userId, workId, branchId, characterId);
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw charactersError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw charactersError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
  }

  private async requireCharacter(
    workId: string,
    branchId: string,
    characterId: string,
  ): Promise<EntityRow> {
    const [character] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, characterId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          eq(entities.type, 'character'),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!character) {
      throw charactersError(HttpStatus.NOT_FOUND, 'CHARACTER_NOT_FOUND', 'Character not found');
    }
    return character;
  }

  private async listRelationships(
    workId: string,
    branchId: string,
    characterId: string,
  ): Promise<RelationshipResponse[]> {
    const matchingCharacter = or(
      eq(entityRelations.fromEntityId, characterId),
      eq(entityRelations.toEntityId, characterId),
    );
    if (!matchingCharacter) {
      return [];
    }

    const rows = await this.database.db
      .select({
        relation: entityRelations,
        fromName: fromEntities.name,
        fromType: fromEntities.type,
        toName: toEntities.name,
        toType: toEntities.type,
      })
      .from(entityRelations)
      .innerJoin(fromEntities, eq(fromEntities.id, entityRelations.fromEntityId))
      .innerJoin(toEntities, eq(toEntities.id, entityRelations.toEntityId))
      .where(
        and(
          eq(entityRelations.workId, workId),
          eq(entityRelations.branchId, branchId),
          matchingCharacter,
        ),
      )
      .orderBy(entityRelations.createdAt);

    return rows.map(({ relation, fromName, fromType, toName, toType }) => ({
      id: relation.id,
      predicate: relation.predicate,
      predicateLabel:
        RELATION_PREDICATE_LABELS[relation.predicate as keyof typeof RELATION_PREDICATE_LABELS] ??
        relation.predicate,
      fromEntity: {
        id: relation.fromEntityId,
        name: fromName,
        type: fromType,
        typeLabel: ENTITY_TYPE_LABELS[fromType as keyof typeof ENTITY_TYPE_LABELS] ?? fromType,
      },
      toEntity: {
        id: relation.toEntityId,
        name: toName,
        type: toType,
        typeLabel: ENTITY_TYPE_LABELS[toType as keyof typeof ENTITY_TYPE_LABELS] ?? toType,
      },
      validFrom: relation.validFrom,
      validTo: relation.validTo,
      source: relation.source,
    }));
  }

  private toProfile(row: CharacterProfileRow | undefined): CharacterProfile {
    return {
      desire: row?.desire ?? '',
      fear: row?.fear ?? '',
      secret: row?.secret ?? '',
      voice: row?.voice ?? '',
      arc: row?.arc ?? '',
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  private toProfileDetail(
    row: CharacterProfileRow | undefined,
    relationships: RelationshipResponse[],
  ): ProfileDetail {
    return {
      ...this.toProfile(row),
      relationships,
    };
  }

  private emptyState(): CharacterStateValue {
    return {
      body: '',
      power: '',
      location: '',
      possessions: '',
      disguise: '',
      knowledge: [],
    };
  }

  private toSnapshot(row: CharacterStateRow): CharacterStateValue {
    return {
      body: row.body,
      power: row.power,
      location: row.location,
      possessions: row.possessions,
      disguise: row.disguise,
      knowledge: row.knowledge,
    };
  }

  private toState(row: CharacterStateRow | undefined): CharacterStateResponse {
    return {
      ...(row ? this.toSnapshot(row) : this.emptyState()),
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }

  private toStateHistory(row: CharacterStateRevisionRow): CharacterStateHistoryResponse {
    return {
      id: row.id,
      version: row.version,
      reason: row.reason,
      source: row.source,
      changedFields: row.changedFields,
      beforeState: row.beforeState ?? null,
      afterState: row.afterState,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private changedStateFields(
    before: CharacterStateValue | null,
    after: CharacterStateValue,
  ): string[] {
    const fields: Array<keyof CharacterStateValue> = [
      'body',
      'power',
      'location',
      'possessions',
      'disguise',
      'knowledge',
    ];
    if (!before) {
      return fields;
    }
    return fields.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  }

  private toCharacterResponse(row: EntityRow): CharacterResponse {
    return {
      id: row.id,
      workId: row.workId,
      branchId: row.branchId,
      name: row.name,
      aliases: row.aliases,
      type: row.type,
      typeLabel: ENTITY_TYPE_LABELS[row.type as keyof typeof ENTITY_TYPE_LABELS] ?? row.type,
      summary: row.summary,
      description: row.description,
      tags: row.tags,
      scope: row.scope,
      status: row.status,
      statusLabel:
        ENTITY_STATUS_LABELS[row.status as keyof typeof ENTITY_STATUS_LABELS] ?? row.status,
      source: row.source,
      customFields: row.customFields,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
