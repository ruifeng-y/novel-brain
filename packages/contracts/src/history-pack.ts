import { z } from 'zod';

export const HISTORY_PACK_KEY = 'history';
export const HISTORY_MAIN_TEMPLATE = '架空古代';

export const historyVariantSchema = z.enum([
  'alternate_ancient',
  'transmigration_hegemony',
]);

export const HISTORY_VARIANT_LABELS: Record<
  z.infer<typeof historyVariantSchema>,
  string
> = {
  alternate_ancient: '架空古代',
  transmigration_hegemony: '穿越争霸',
};

export const HISTORY_VARIANT_SUMMARIES: Record<
  z.infer<typeof historyVariantSchema>,
  string
> = {
  alternate_ancient: '在架空王朝里写权谋、战争与世家兴衰，不绑定真实史实。',
  transmigration_hegemony: '现代来客进入架空乱世，用见识和选择参与争霸。',
};

export const historySubtypeSchema = z.enum([
  'dynasty',
  'bureaucracy',
  'military',
  'geography',
  'clan',
]);

export const HISTORY_SUBTYPE_LABELS: Record<
  z.infer<typeof historySubtypeSchema>,
  string
> = {
  dynasty: '朝代',
  bureaucracy: '官制',
  military: '军制',
  geography: '地理',
  clan: '世家',
};

export const HISTORY_SUBTYPE_SUMMARIES: Record<
  z.infer<typeof historySubtypeSchema>,
  string
> = {
  dynasty: '年号、都城、正统来源与时代边界。',
  bureaucracy: '官署、品级、上下级与职权范围。',
  military: '军队编制、兵力、行军与随军粮草。',
  geography: '州郡、关隘、道路与势力范围。',
  clan: '世家门第、姻亲、产业与朝堂靠山。',
};

export const HISTORY_SUBTYPE_ENTITY_TYPES: Record<
  z.infer<typeof historySubtypeSchema>,
  'world' | 'faction' | 'map'
> = {
  dynasty: 'world',
  bureaucracy: 'faction',
  military: 'faction',
  geography: 'map',
  clan: 'faction',
};

export type HistoryCustomFieldType =
  | 'text'
  | 'number'
  | 'single_select'
  | 'relation_ref';

export type HistoryCustomFieldDefinition = {
  key: string;
  label: string;
  type: HistoryCustomFieldType;
  options: string[];
  subtypes: Array<z.infer<typeof historySubtypeSchema>>;
};

export const HISTORY_CUSTOM_FIELDS: readonly HistoryCustomFieldDefinition[] = [
  {
    key: 'history_rank',
    label: '官阶',
    type: 'number',
    options: [],
    subtypes: ['bureaucracy'],
  },
  {
    key: 'history_troops',
    label: '兵力',
    type: 'number',
    options: [],
    subtypes: ['military'],
  },
  {
    key: 'history_provisions_shi',
    label: '随军粮草（石）',
    type: 'number',
    options: [],
    subtypes: ['military'],
  },
  {
    key: 'history_terrain',
    label: '地形',
    type: 'single_select',
    options: ['平原', '山地', '水网', '关隘', '荒漠'],
    subtypes: ['geography'],
  },
  {
    key: 'history_influence',
    label: '门第影响力',
    type: 'number',
    options: [],
    subtypes: ['clan'],
  },
];

export const historyArmyMovementInputSchema = z.object({
  armyEntityId: z.string().uuid(),
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  plannedDays: z.number().int().min(1).max(365),
});

export const historyCheckInputSchema = z.object({
  text: z.string().trim().max(100_000).default(''),
  armyMovement: historyArmyMovementInputSchema.optional(),
});

export type HistoryVariant = z.infer<typeof historyVariantSchema>;
export type HistorySubtype = z.infer<typeof historySubtypeSchema>;
export type HistoryArmyMovementInput = z.infer<
  typeof historyArmyMovementInputSchema
>;
export type HistoryCheckInput = z.infer<typeof historyCheckInputSchema>;
