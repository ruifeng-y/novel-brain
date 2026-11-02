import { HttpStatus, Injectable } from '@nestjs/common';
import {
  CHAPTER_STATUS_LABELS,
  CUSTOM_FIELD_TYPE_LABELS,
  ENTITY_SCOPE_LABELS,
  ENTITY_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  RELATION_PREDICATE_LABELS,
  type CustomFieldDefinitionInput,
  type CustomFieldValue,
  type EntityCreateInput,
  type EntitySearchInput,
  type EntityUpdateInput,
  type RelationCreateInput,
} from '@novel/contracts';
import {
  chapterOutlines,
  chapters,
  chapterVersions,
  entities,
  entityCustomFields,
  entityRelations,
  workBranches,
  works,
  type EntityCustomFieldRow,
  type EntityCustomFieldValue,
  type EntityRow,
} from '@novel/db';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { entitiesError } from './entities.errors';

type CustomFieldResponse = {
  id: string;
  key: string;
  label: string;
  type: EntityCustomFieldRow['type'];
  typeLabel: string;
  options: string[];
  createdAt: string;
  updatedAt: string;
};

type EntityResponse = {
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
  scopeLabel: string;
  status: string;
  statusLabel: string;
  source: string;
  customFields: Record<string, EntityCustomFieldValue>;
  createdAt: string;
  updatedAt: string;
};

type RelationResponse = {
  id: string;
  workId: string;
  branchId: string;
  fromEntity: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
  };
  predicate: string;
  predicateLabel: string;
  toEntity: {
    id: string;
    name: string;
    type: string;
    typeLabel: string;
  };
  validFrom: string | null;
  validTo: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

type EntityDetailResponse = EntityResponse & {
  references: {
    chapters: Array<{
      id: string;
      chapterNumber: number;
      title: string;
      status: string;
      statusLabel: string;
    }>;
    outlines: Array<{
      chapterNumber: number;
      chapterGoal: string;
      matchedFields: string[];
    }>;
  };
};

const fromEntities = alias(entities, 'relation_from_entities');
const toEntities = alias(entities, 'relation_to_entities');

@Injectable()
export class EntitiesService {
  constructor(private readonly database: DatabaseService) {}

  async listCustomFields(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<{ items: CustomFieldResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    const rows = await this.database.db
      .select()
      .from(entityCustomFields)
      .where(and(eq(entityCustomFields.workId, workId), eq(entityCustomFields.branchId, branchId)))
      .orderBy(entityCustomFields.createdAt);

    return { items: rows.map((row) => this.toCustomFieldResponse(row)) };
  }

  async createCustomField(
    userId: string,
    workId: string,
    branchId: string,
    input: CustomFieldDefinitionInput,
  ): Promise<CustomFieldResponse> {
    await this.requireBranch(userId, workId, branchId);
    const now = new Date();
    const [created] = await this.database.db
      .insert(entityCustomFields)
      .values({
        workId,
        branchId,
        key: `field_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        label: input.label,
        type: input.type,
        options: input.options ?? [],
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await this.touchWork(workId, now);
    return this.toCustomFieldResponse(created);
  }

  async listEntities(
    userId: string,
    workId: string,
    branchId: string,
    input: EntitySearchInput,
  ): Promise<{ items: EntityResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    const conditions = [
      eq(entities.workId, workId),
      eq(entities.branchId, branchId),
      isNull(entities.deletedAt),
    ];

    if (input.type) {
      conditions.push(eq(entities.type, input.type));
    }
    if (input.status) {
      conditions.push(eq(entities.status, input.status));
    }
    if (input.tag) {
      conditions.push(sql`${entities.tags} @> ${JSON.stringify([input.tag])}::jsonb`);
    }
    if (input.q) {
      const pattern = `%${input.q}%`;
      const searchCondition = or(
        ilike(entities.name, pattern),
        ilike(entities.summary, pattern),
        ilike(entities.description, pattern),
        sql`${entities.aliases}::text ilike ${pattern}`,
        sql`${entities.tags}::text ilike ${pattern}`,
        sql`${entities.customFields}::text ilike ${pattern}`,
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    const rows = await this.database.db
      .select()
      .from(entities)
      .where(and(...conditions))
      .orderBy(desc(entities.updatedAt), entities.name);

    return { items: rows.map((row) => this.toEntityResponse(row)) };
  }

  async getEntity(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<EntityDetailResponse> {
    await this.requireBranch(userId, workId, branchId);
    const row = await this.requireEntity(workId, branchId, entityId);
    return {
      ...this.toEntityResponse(row),
      references: await this.findReferences(row),
    };
  }

  async createEntity(
    userId: string,
    workId: string,
    branchId: string,
    input: EntityCreateInput,
  ): Promise<EntityResponse> {
    await this.requireBranch(userId, workId, branchId);
    const customFields = await this.validateCustomFields(workId, branchId, input.customFields);
    const now = new Date();

    try {
      const [created] = await this.database.db
        .insert(entities)
        .values({
          workId,
          branchId,
          name: input.name,
          aliases: input.aliases,
          type: input.type,
          summary: input.summary,
          description: input.description,
          tags: input.tags,
          scope: input.scope,
          status: input.status,
          customFields,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await this.touchWork(workId, now);
      return this.toEntityResponse(created);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw entitiesError(
          HttpStatus.CONFLICT,
          'ENTITY_NAME_CONFLICT',
          'A setting with this name already exists in this category',
        );
      }
      throw error;
    }
  }

  async updateEntity(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: EntityUpdateInput,
  ): Promise<EntityResponse> {
    await this.requireBranch(userId, workId, branchId);
    const existing = await this.requireEntity(workId, branchId, entityId);
    const customFields = await this.validateCustomFields(workId, branchId, {
      ...existing.customFields,
      ...(input.customFields ?? {}),
    });
    const now = new Date();

    try {
      const [updated] = await this.database.db
        .update(entities)
        .set({
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.tags === undefined ? {} : { tags: input.tags }),
          ...(input.scope === undefined ? {} : { scope: input.scope }),
          ...(input.status === undefined ? {} : { status: input.status }),
          customFields,
          updatedAt: now,
        })
        .where(eq(entities.id, existing.id))
        .returning();
      await this.touchWork(workId, now);
      return this.toEntityResponse(updated);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw entitiesError(
          HttpStatus.CONFLICT,
          'ENTITY_NAME_CONFLICT',
          'A setting with this name already exists in this category',
        );
      }
      throw error;
    }
  }

  async deleteEntity(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<{ deleted: true }> {
    await this.requireBranch(userId, workId, branchId);
    const existing = await this.requireEntity(workId, branchId, entityId);
    const now = new Date();
    await this.database.db
      .update(entities)
      .set({ deletedAt: now, status: 'archived', updatedAt: now })
      .where(eq(entities.id, existing.id));
    await this.touchWork(workId, now);
    return { deleted: true };
  }

  async listRelations(
    userId: string,
    workId: string,
    branchId: string,
    entityId?: string,
  ): Promise<{ items: RelationResponse[] }> {
    await this.requireBranch(userId, workId, branchId);
    const conditions = [eq(entityRelations.workId, workId), eq(entityRelations.branchId, branchId)];
    if (entityId) {
      const matchingEntity = or(
        eq(entityRelations.fromEntityId, entityId),
        eq(entityRelations.toEntityId, entityId),
      );
      if (matchingEntity) {
        conditions.push(matchingEntity);
      }
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
      .where(and(...conditions))
      .orderBy(entityRelations.createdAt);

    return { items: rows.map((row) => this.toRelationResponse(row)) };
  }

  async createRelation(
    userId: string,
    workId: string,
    branchId: string,
    input: RelationCreateInput,
  ): Promise<RelationResponse> {
    await this.requireBranch(userId, workId, branchId);
    const [fromEntity, toEntity] = await Promise.all([
      this.findEntity(workId, branchId, input.fromEntityId),
      this.findEntity(workId, branchId, input.toEntityId),
    ]);
    if (!fromEntity || !toEntity) {
      throw entitiesError(
        HttpStatus.BAD_REQUEST,
        'RELATION_ENTITY_INVALID',
        'Choose two settings from this work and creation line',
      );
    }

    const now = new Date();
    const [created] = await this.database.db
      .insert(entityRelations)
      .values({
        workId,
        branchId,
        fromEntityId: fromEntity.id,
        predicate: input.predicate,
        toEntityId: toEntity.id,
        validFrom: input.validFrom || null,
        validTo: input.validTo || null,
        source: input.source,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await this.touchWork(workId, now);

    return this.toRelationResponse({
      relation: created,
      fromName: fromEntity.name,
      fromType: fromEntity.type,
      toName: toEntity.name,
      toType: toEntity.type,
    });
  }

  private async requireBranch(userId: string, workId: string, branchId: string): Promise<void> {
    const [work] = await this.database.db
      .select({ id: works.id })
      .from(works)
      .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
      .limit(1);
    if (!work) {
      throw entitiesError(HttpStatus.NOT_FOUND, 'WORK_NOT_FOUND', 'Work not found');
    }

    const [branch] = await this.database.db
      .select({ id: workBranches.id })
      .from(workBranches)
      .where(and(eq(workBranches.id, branchId), eq(workBranches.workId, workId)))
      .limit(1);
    if (!branch) {
      throw entitiesError(HttpStatus.NOT_FOUND, 'BRANCH_NOT_FOUND', 'Story branch not found');
    }
  }

  private async requireEntity(
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<EntityRow> {
    const [entity] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    if (!entity) {
      throw entitiesError(HttpStatus.NOT_FOUND, 'ENTITY_NOT_FOUND', 'Setting not found');
    }
    return entity;
  }

  private async findEntity(
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<EntityRow | undefined> {
    const [entity] = await this.database.db
      .select()
      .from(entities)
      .where(
        and(
          eq(entities.id, entityId),
          eq(entities.workId, workId),
          eq(entities.branchId, branchId),
          isNull(entities.deletedAt),
        ),
      )
      .limit(1);
    return entity;
  }

  private async validateCustomFields(
    workId: string,
    branchId: string,
    values: Record<string, CustomFieldValue>,
  ): Promise<Record<string, EntityCustomFieldValue>> {
    const definitions = await this.database.db
      .select()
      .from(entityCustomFields)
      .where(and(eq(entityCustomFields.workId, workId), eq(entityCustomFields.branchId, branchId)));
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const errors: Array<{ field: string; message: string }> = [];

    for (const [key, rawValue] of Object.entries(values)) {
      const definition = byKey.get(key);
      if (!definition) {
        errors.push({ field: key, message: 'Unknown custom field' });
        continue;
      }
      if (rawValue === null) {
        continue;
      }

      if (definition.type === 'text' && typeof rawValue !== 'string') {
        errors.push({ field: definition.label, message: 'Enter text' });
      } else if (
        definition.type === 'number' &&
        (typeof rawValue !== 'number' || !Number.isFinite(rawValue))
      ) {
        errors.push({ field: definition.label, message: 'Enter a number' });
      } else if (
        definition.type === 'date' &&
        (typeof rawValue !== 'string' || !this.isIsoDate(rawValue))
      ) {
        errors.push({ field: definition.label, message: 'Enter a valid date' });
      } else if (
        definition.type === 'single_select' &&
        (typeof rawValue !== 'string' || !definition.options.includes(rawValue))
      ) {
        errors.push({ field: definition.label, message: 'Choose one of the field options' });
      } else if (definition.type === 'multi_select') {
        if (
          !Array.isArray(rawValue) ||
          rawValue.some((option) => typeof option !== 'string') ||
          rawValue.some((option) => !definition.options.includes(option))
        ) {
          errors.push({ field: definition.label, message: 'Choose from the field options' });
        }
      } else if (definition.type === 'boolean' && typeof rawValue !== 'boolean') {
        errors.push({ field: definition.label, message: 'Choose true or false' });
      } else if (definition.type === 'relation_ref') {
        if (typeof rawValue !== 'string') {
          errors.push({ field: definition.label, message: 'Choose a setting' });
        } else {
          const [referenced] = await this.database.db
            .select({ id: entities.id })
            .from(entities)
            .where(
              and(
                eq(entities.id, rawValue),
                eq(entities.workId, workId),
                eq(entities.branchId, branchId),
                isNull(entities.deletedAt),
              ),
            )
            .limit(1);
          if (!referenced) {
            errors.push({
              field: definition.label,
              message: 'Choose a setting from this work and creation line',
            });
          }
        }
      }
    }

    if (errors.length > 0) {
      throw entitiesError(
        HttpStatus.BAD_REQUEST,
        'CUSTOM_FIELD_INVALID',
        'Check the custom field values',
        { fields: errors },
      );
    }

    return values as Record<string, EntityCustomFieldValue>;
  }

  private async findReferences(entity: EntityRow): Promise<EntityDetailResponse['references']> {
    const identifiers = [entity.name, ...entity.aliases].filter(
      (value, index, all) => value.length > 0 && all.indexOf(value) === index,
    );
    if (identifiers.length === 0) {
      return { chapters: [], outlines: [] };
    }

    const chapterConditions = identifiers.flatMap((identifier) => {
      const pattern = `%${identifier}%`;
      return [ilike(chapters.title, pattern), ilike(chapterVersions.content, pattern)];
    });
    const outlineConditions = identifiers.flatMap((identifier) => {
      const pattern = `%${identifier}%`;
      return [
        ilike(chapterOutlines.chapterGoal, pattern),
        ilike(chapterOutlines.pov, pattern),
        sql`${chapterOutlines.sceneBeats}::text ilike ${pattern}`,
        ilike(chapterOutlines.chapterEndHook, pattern),
      ];
    });

    const [chapterRows, outlineRows] = await Promise.all([
      this.database.db
        .select({ chapter: chapters })
        .from(chapters)
        .leftJoin(chapterVersions, eq(chapterVersions.id, chapters.currentVersionId))
        .where(
          and(
            eq(chapters.workId, entity.workId),
            eq(chapters.branchId, entity.branchId),
            or(...chapterConditions),
          ),
        )
        .orderBy(chapters.chapterNumber),
      this.database.db
        .select()
        .from(chapterOutlines)
        .where(
          and(
            eq(chapterOutlines.workId, entity.workId),
            eq(chapterOutlines.branchId, entity.branchId),
            or(...outlineConditions),
          ),
        )
        .orderBy(chapterOutlines.chapterNumber),
    ]);

    return {
      chapters: chapterRows.map(({ chapter }) => ({
        id: chapter.id,
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        status: chapter.status,
        statusLabel: CHAPTER_STATUS_LABELS[chapter.status],
      })),
      outlines: outlineRows.map((outline) => {
        const matchedFields: string[] = [];
        if (this.matchesIdentifiers(outline.chapterGoal, identifiers)) {
          matchedFields.push('章目标');
        }
        if (this.matchesIdentifiers(outline.pov, identifiers)) {
          matchedFields.push('叙事视角');
        }
        if (this.matchesIdentifiers(outline.sceneBeats.join(' '), identifiers)) {
          matchedFields.push('场景节拍');
        }
        if (this.matchesIdentifiers(outline.chapterEndHook, identifiers)) {
          matchedFields.push('章末钩子');
        }
        return {
          chapterNumber: outline.chapterNumber,
          chapterGoal: outline.chapterGoal,
          matchedFields,
        };
      }),
    };
  }

  private matchesIdentifiers(text: string, identifiers: string[]): boolean {
    const normalized = text.toLocaleLowerCase('zh-CN');
    return identifiers.some((identifier) =>
      normalized.includes(identifier.toLocaleLowerCase('zh-CN')),
    );
  }

  private isIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
  }

  private async touchWork(workId: string, now: Date): Promise<void> {
    await this.database.db.update(works).set({ updatedAt: now }).where(eq(works.id, workId));
  }

  private toCustomFieldResponse(row: EntityCustomFieldRow): CustomFieldResponse {
    return {
      id: row.id,
      key: row.key,
      label: row.label,
      type: row.type,
      typeLabel:
        CUSTOM_FIELD_TYPE_LABELS[row.type as keyof typeof CUSTOM_FIELD_TYPE_LABELS] ?? row.type,
      options: row.options,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toEntityResponse(row: EntityRow): EntityResponse {
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
      scopeLabel: ENTITY_SCOPE_LABELS[row.scope as keyof typeof ENTITY_SCOPE_LABELS] ?? row.scope,
      status: row.status,
      statusLabel:
        ENTITY_STATUS_LABELS[row.status as keyof typeof ENTITY_STATUS_LABELS] ?? row.status,
      source: row.source,
      customFields: row.customFields,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRelationResponse(row: {
    relation: typeof entityRelations.$inferSelect;
    fromName: string;
    fromType: string;
    toName: string;
    toType: string;
  }): RelationResponse {
    const { relation } = row;
    return {
      id: relation.id,
      workId: relation.workId,
      branchId: relation.branchId,
      fromEntity: {
        id: relation.fromEntityId,
        name: row.fromName,
        type: row.fromType,
        typeLabel:
          ENTITY_TYPE_LABELS[row.fromType as keyof typeof ENTITY_TYPE_LABELS] ?? row.fromType,
      },
      predicate: relation.predicate,
      predicateLabel:
        RELATION_PREDICATE_LABELS[relation.predicate as keyof typeof RELATION_PREDICATE_LABELS] ??
        relation.predicate,
      toEntity: {
        id: relation.toEntityId,
        name: row.toName,
        type: row.toType,
        typeLabel: ENTITY_TYPE_LABELS[row.toType as keyof typeof ENTITY_TYPE_LABELS] ?? row.toType,
      },
      validFrom: relation.validFrom,
      validTo: relation.validTo,
      source: relation.source,
      createdAt: relation.createdAt.toISOString(),
      updatedAt: relation.updatedAt.toISOString(),
    };
  }
}
