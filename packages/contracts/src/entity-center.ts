import { z } from 'zod';
import { historySubtypeSchema } from './history-pack';

export const ENTITY_TYPE_LABELS = {
  world: '世界',
  faction: '势力',
  character: '人物',
  map: '地图',
  power_system: '力量体系',
  item_technique: '物品功法',
  timeline: '时间线',
} as const;

export const entityTypeSchema = z.enum([
  'world',
  'faction',
  'character',
  'map',
  'power_system',
  'item_technique',
  'timeline',
]);

export const ENTITY_SCOPE_LABELS = {
  work: '全书',
  volume: '当前卷',
  arc: '当前幕',
  chapter: '当前章',
  scene: '当前场景',
} as const;

export const entityScopeSchema = z.enum(['work', 'volume', 'arc', 'chapter', 'scene']);

export const ENTITY_STATUS_LABELS = {
  draft: '草稿',
  proposal: '提案',
  locked: '锁定',
  archived: '废弃',
} as const;

export const entityStatusSchema = z.enum(['draft', 'proposal', 'locked', 'archived']);

export const CUSTOM_FIELD_TYPE_LABELS = {
  text: '文本',
  number: '数字',
  date: '日期',
  single_select: '单选',
  multi_select: '多选',
  boolean: '布尔',
  relation_ref: '关系引用',
} as const;

export const customFieldTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'single_select',
  'multi_select',
  'boolean',
  'relation_ref',
]);

export const RELATION_PREDICATE_LABELS = {
  subordinate: '隶属',
  located_in: '位于',
  controls: '控制',
  owns: '拥有',
  knows: '知道',
  believes: '相信',
  kin: '亲属',
  hostile: '敌对',
  mentor: '师承',
} as const;

export const relationPredicateSchema = z.enum([
  'subordinate',
  'located_in',
  'controls',
  'owns',
  'knows',
  'believes',
  'kin',
  'hostile',
  'mentor',
]);

export const customFieldValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

export type CustomFieldValue = z.infer<typeof customFieldValueSchema>;

const uniqueOptionsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .refine((options) => new Set(options).size === options.length, {
    message: 'Field options must be unique',
  });

export const customFieldDefinitionInputSchema = z
  .object({
    label: z.string().trim().min(1).max(60),
    type: customFieldTypeSchema,
    options: uniqueOptionsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.type === 'single_select' || value.type === 'multi_select') &&
      (!value.options || value.options.length === 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Select fields need at least one option',
      });
    }
  });

export type CustomFieldDefinitionInput = z.infer<typeof customFieldDefinitionInputSchema>;

const entityFieldsSchema = z.object({
  name: z.string().trim().min(1).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(50),
  type: entityTypeSchema,
  subtype: historySubtypeSchema.nullable(),
  summary: z.string().trim().max(2_000),
  description: z.string().trim().max(30_000),
  tags: z.array(z.string().trim().min(1).max(80)).max(50),
  scope: entityScopeSchema,
  status: entityStatusSchema,
  customFields: z.record(z.string(), customFieldValueSchema),
});

export const entityCreateSchema = entityFieldsSchema
  .extend({
    aliases: entityFieldsSchema.shape.aliases.default([]),
    subtype: entityFieldsSchema.shape.subtype.default(null),
    summary: entityFieldsSchema.shape.summary.default(''),
    description: entityFieldsSchema.shape.description.default(''),
    tags: entityFieldsSchema.shape.tags.default([]),
    scope: entityFieldsSchema.shape.scope.default('work'),
    status: entityFieldsSchema.shape.status.default('draft'),
    customFields: entityFieldsSchema.shape.customFields.default({}),
  })
  .superRefine((value, context) => {
    if (new Set(value.aliases).size !== value.aliases.length) {
      context.addIssue({
        code: 'custom',
        path: ['aliases'],
        message: 'Aliases must be unique',
      });
    }
    if (new Set(value.tags).size !== value.tags.length) {
      context.addIssue({
        code: 'custom',
        path: ['tags'],
        message: 'Tags must be unique',
      });
    }
  });

export const entityUpdateSchema = entityFieldsSchema.partial().superRefine((value, context) => {
  if (value.aliases && new Set(value.aliases).size !== value.aliases.length) {
    context.addIssue({
      code: 'custom',
      path: ['aliases'],
      message: 'Aliases must be unique',
    });
  }
  if (value.tags && new Set(value.tags).size !== value.tags.length) {
    context.addIssue({
      code: 'custom',
      path: ['tags'],
      message: 'Tags must be unique',
    });
  }
});

export type EntityCreateInput = z.infer<typeof entityCreateSchema>;
export type EntityUpdateInput = z.infer<typeof entityUpdateSchema>;

const optionalStoryDateSchema = z.string().trim().max(120).nullable().optional();

export const relationCreateSchema = z.object({
  fromEntityId: z.string().uuid(),
  predicate: relationPredicateSchema,
  toEntityId: z.string().uuid(),
  validFrom: optionalStoryDateSchema,
  validTo: optionalStoryDateSchema,
  source: z.string().trim().max(500).default('作者录入'),
});

export type RelationCreateInput = z.infer<typeof relationCreateSchema>;

export const entitySearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  type: entityTypeSchema.optional(),
  subtype: historySubtypeSchema.optional(),
  tag: z.string().trim().max(80).optional(),
  status: entityStatusSchema.optional(),
});

export type EntitySearchInput = z.infer<typeof entitySearchSchema>;
