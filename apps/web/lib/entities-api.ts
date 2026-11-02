import {
  ENTITY_SCOPE_LABELS,
  ENTITY_STATUS_LABELS,
  ENTITY_TYPE_LABELS,
  RELATION_PREDICATE_LABELS,
  type CustomFieldValue,
  type HistorySubtype,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

export type EntityType = keyof typeof ENTITY_TYPE_LABELS;
export type EntityScope = keyof typeof ENTITY_SCOPE_LABELS;
export type EntityStatus = keyof typeof ENTITY_STATUS_LABELS;
export type RelationPredicate = keyof typeof RELATION_PREDICATE_LABELS;
export type CustomFieldType =
  'text' | 'number' | 'date' | 'single_select' | 'multi_select' | 'boolean' | 'relation_ref';

export type CustomFieldDefinition = {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  typeLabel: string;
  options: string[];
  createdAt: string;
  updatedAt: string;
};

export type Entity = {
  id: string;
  workId: string;
  branchId: string;
  name: string;
  aliases: string[];
  type: EntityType;
  typeLabel: string;
  subtype: HistorySubtype | null;
  subtypeLabel: string | null;
  summary: string;
  description: string;
  tags: string[];
  scope: EntityScope;
  scopeLabel: string;
  status: EntityStatus;
  statusLabel: string;
  source: string;
  customFields: Record<string, CustomFieldValue>;
  createdAt: string;
  updatedAt: string;
};

export type EntityReferences = {
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

export type EntityDetail = Entity & {
  references: EntityReferences;
};

export type Relation = {
  id: string;
  workId: string;
  branchId: string;
  fromEntity: {
    id: string;
    name: string;
    type: EntityType;
    typeLabel: string;
  };
  predicate: RelationPredicate;
  predicateLabel: string;
  toEntity: {
    id: string;
    name: string;
    type: EntityType;
    typeLabel: string;
  };
  validFrom: string | null;
  validTo: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export type EntityInput = {
  name: string;
  aliases: string[];
  type: EntityType;
  subtype: HistorySubtype | null;
  summary: string;
  description: string;
  tags: string[];
  scope: EntityScope;
  status: EntityStatus;
  customFields: Record<string, CustomFieldValue>;
};

export type EntitySearchFilters = {
  q?: string;
  type?: EntityType;
  subtype?: HistorySubtype;
  tag?: string;
  status?: EntityStatus;
};

export type RelationInput = {
  fromEntityId: string;
  predicate: RelationPredicate;
  toEntityId: string;
  validFrom?: string | null;
  validTo?: string | null;
  source: string;
};

function entityCenterPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function loadEntityCenter(
  workId: string,
  branchId: string,
): Promise<{
  entities: Entity[];
  customFields: CustomFieldDefinition[];
  relations: Relation[];
}> {
  const path = entityCenterPath(workId, branchId);
  return Promise.all([
    apiRequest<{ items: Entity[] }>(`${path}/entities`),
    apiRequest<{ items: CustomFieldDefinition[] }>(`${path}/custom-fields`),
    apiRequest<{ items: Relation[] }>(`${path}/relations`),
  ]).then(([entities, customFields, relations]) => ({
    entities: entities.items,
    customFields: customFields.items,
    relations: relations.items,
  }));
}

export function searchEntities(
  workId: string,
  branchId: string,
  filters: EntitySearchFilters,
): Promise<{ items: Entity[] }> {
  const query = new URLSearchParams();
  if (filters.q) {
    query.set('q', filters.q);
  }
  if (filters.type) {
    query.set('type', filters.type);
  }
  if (filters.subtype) {
    query.set('subtype', filters.subtype);
  }
  if (filters.tag) {
    query.set('tag', filters.tag);
  }
  if (filters.status) {
    query.set('status', filters.status);
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  return apiRequest<{ items: Entity[] }>(`${entityCenterPath(workId, branchId)}/entities${suffix}`);
}

export function loadEntity(
  workId: string,
  branchId: string,
  entityId: string,
): Promise<EntityDetail> {
  return apiRequest<EntityDetail>(
    `${entityCenterPath(workId, branchId)}/entities/${encodeURIComponent(entityId)}`,
  );
}

export function createEntity(
  workId: string,
  branchId: string,
  input: EntityInput,
): Promise<Entity> {
  return apiRequest<Entity>(`${entityCenterPath(workId, branchId)}/entities`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateEntity(
  workId: string,
  branchId: string,
  entityId: string,
  input: EntityInput,
): Promise<Entity> {
  return apiRequest<Entity>(
    `${entityCenterPath(workId, branchId)}/entities/${encodeURIComponent(entityId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function createCustomField(
  workId: string,
  branchId: string,
  input: { label: string; type: CustomFieldType; options?: string[] },
): Promise<CustomFieldDefinition> {
  return apiRequest<CustomFieldDefinition>(`${entityCenterPath(workId, branchId)}/custom-fields`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createRelation(
  workId: string,
  branchId: string,
  input: RelationInput,
): Promise<Relation> {
  return apiRequest<Relation>(`${entityCenterPath(workId, branchId)}/relations`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
