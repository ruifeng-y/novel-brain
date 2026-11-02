import { z } from 'zod';

const labelSchema = z.string().trim().min(1).max(120);
const shortTextSchema = z.string().trim().max(500);
const longTextSchema = z.string().trim().max(5_000);
const stringListSchema = z.array(labelSchema).max(50);

export const powerLevelInputSchema = z.object({
  name: labelSchema,
  order: z.number().int().min(1).max(100_000),
  description: longTextSchema.default(''),
});

export const powerPathInputSchema = z.object({
  name: labelSchema,
  description: longTextSchema.default(''),
  levels: stringListSchema.default([]),
});

export const powerResourceCostSchema = z.object({
  name: labelSchema,
  amount: z.number().int().min(1).max(1_000_000),
});

export const powerBreakthroughInputSchema = z.object({
  fromLevel: labelSchema,
  toLevel: labelSchema,
  conditions: stringListSchema.default([]),
  costs: stringListSchema.default([]),
  bottlenecks: stringListSchema.default([]),
  counters: stringListSchema.default([]),
  resources: z.array(powerResourceCostSchema).max(50).default([]),
});

export const powerSystemProfileInputSchema = z
  .object({
    levels: z.array(powerLevelInputSchema).max(200).default([]),
    paths: z.array(powerPathInputSchema).max(100).default([]),
    breakthroughs: z.array(powerBreakthroughInputSchema).max(500).default([]),
  })
  .superRefine((value, context) => {
    const levelNames = new Set<string>();
    const levelOrders = new Set<number>();
    for (const [index, level] of value.levels.entries()) {
      if (levelNames.has(level.name)) {
        context.addIssue({
          code: 'custom',
          path: ['levels', index, 'name'],
          message: 'Level names must be unique',
        });
      }
      if (levelOrders.has(level.order)) {
        context.addIssue({
          code: 'custom',
          path: ['levels', index, 'order'],
          message: 'Level order values must be unique',
        });
      }
      levelNames.add(level.name);
      levelOrders.add(level.order);
    }

    for (const [pathIndex, path] of value.paths.entries()) {
      for (const [levelIndex, levelName] of path.levels.entries()) {
        if (!levelNames.has(levelName)) {
          context.addIssue({
            code: 'custom',
            path: ['paths', pathIndex, 'levels', levelIndex],
            message: `Unknown power level: ${levelName}`,
          });
        }
      }
      if (new Set(path.levels).size !== path.levels.length) {
        context.addIssue({
          code: 'custom',
          path: ['paths', pathIndex, 'levels'],
          message: 'A path cannot list the same level twice',
        });
      }
    }

    const breakthroughKeys = new Set<string>();
    for (const [index, rule] of value.breakthroughs.entries()) {
      if (!levelNames.has(rule.fromLevel)) {
        context.addIssue({
          code: 'custom',
          path: ['breakthroughs', index, 'fromLevel'],
          message: 'Choose an existing starting level',
        });
      }
      if (!levelNames.has(rule.toLevel)) {
        context.addIssue({
          code: 'custom',
          path: ['breakthroughs', index, 'toLevel'],
          message: 'Choose an existing target level',
        });
      }
      if (rule.fromLevel === rule.toLevel) {
        context.addIssue({
          code: 'custom',
          path: ['breakthroughs', index, 'toLevel'],
          message: 'A breakthrough must reach a different level',
        });
      }
      const fromOrder = value.levels.find((level) => level.name === rule.fromLevel)?.order;
      const toOrder = value.levels.find((level) => level.name === rule.toLevel)?.order;
      if (fromOrder !== undefined && toOrder !== undefined && fromOrder >= toOrder) {
        context.addIssue({
          code: 'custom',
          path: ['breakthroughs', index, 'toLevel'],
          message: 'A breakthrough must move to a later level',
        });
      }
      const key = `${rule.fromLevel}->${rule.toLevel}`;
      if (breakthroughKeys.has(key)) {
        context.addIssue({
          code: 'custom',
          path: ['breakthroughs', index],
          message: 'Each level pair can only have one breakthrough rule',
        });
      }
      breakthroughKeys.add(key);
      if (new Set(rule.resources.map((resource) => resource.name)).size !== rule.resources.length) {
        context.addIssue({
          code: 'custom',
          path: ['breakthroughs', index, 'resources'],
          message: 'Resource names must be unique',
        });
      }
    }

    if (new Set(value.paths.map((path) => path.name)).size !== value.paths.length) {
      context.addIssue({
        code: 'custom',
        path: ['paths'],
        message: 'Path names must be unique',
      });
    }
  });

export type PowerSystemProfileInput = z.infer<typeof powerSystemProfileInputSchema>;
export type PowerLevelInput = z.infer<typeof powerLevelInputSchema>;
export type PowerPathInput = z.infer<typeof powerPathInputSchema>;
export type PowerBreakthroughInput = z.infer<typeof powerBreakthroughInputSchema>;

export const breakthroughCheckSchema = z.object({
  fromLevel: labelSchema,
  toLevel: labelSchema,
  conditionsMet: stringListSchema.default([]),
  resourcesAvailable: z
    .array(
      z.object({
        name: labelSchema,
        amount: z.number().int().min(0).max(1_000_000),
      }),
    )
    .max(50)
    .default([]),
});

export type BreakthroughCheckInput = z.infer<typeof breakthroughCheckSchema>;

export const ITEM_TECHNIQUE_KIND_LABELS = {
  item: '物品',
  technique: '功法',
} as const;

export const itemTechniqueKindSchema = z.enum(['item', 'technique']);

export const itemTechniqueProfileInputSchema = z.object({
  kind: itemTechniqueKindSchema,
  grade: z.string().trim().max(120),
  effects: stringListSchema.default([]),
  costs: stringListSchema.default([]),
  restrictions: stringListSchema.default([]),
});

export type ItemTechniqueProfileInput = z.infer<typeof itemTechniqueProfileInputSchema>;

export const itemOwnershipInputSchema = z.object({
  ownerEntityId: z.string().uuid(),
  fromTime: z.string().trim().max(120).default(''),
  source: shortTextSchema.default('作者录入'),
});

export type ItemOwnershipInput = z.infer<typeof itemOwnershipInputSchema>;

export const endItemOwnershipSchema = z.object({
  endedAt: z.string().trim().min(1).max(120),
});

export type EndItemOwnershipInput = z.infer<typeof endItemOwnershipSchema>;

const goldenFingerFieldsSchema = z.object({
  ownerEntityId: z.string().uuid(),
  name: labelSchema,
  rules: stringListSchema,
  costs: stringListSchema,
  limits: stringListSchema,
  growthCurve: z
    .array(
      z.object({
        stage: labelSchema,
        description: longTextSchema,
      }),
    )
    .max(100),
});

export const goldenFingerInputSchema = goldenFingerFieldsSchema.extend({
  rules: goldenFingerFieldsSchema.shape.rules.default([]),
  costs: goldenFingerFieldsSchema.shape.costs.default([]),
  limits: goldenFingerFieldsSchema.shape.limits.default([]),
  growthCurve: goldenFingerFieldsSchema.shape.growthCurve.default([]),
});

export const goldenFingerUpdateSchema = goldenFingerFieldsSchema
  .partial()
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Change at least one golden finger detail',
      });
    }
    if (value.growthCurve) {
      const stages = value.growthCurve.map((point) => point.stage);
      if (new Set(stages).size !== stages.length) {
        context.addIssue({
          code: 'custom',
          path: ['growthCurve'],
          message: 'Growth stages must be unique',
        });
      }
    }
  });

export type GoldenFingerInput = z.infer<typeof goldenFingerInputSchema>;
export type GoldenFingerUpdateInput = z.infer<typeof goldenFingerUpdateSchema>;

export const STORY_DURATION_UNIT_LABELS = {
  minute: '分钟',
  hour: '小时',
  day: '天',
  month: '月',
  year: '年',
} as const;

export const storyDurationUnitSchema = z.enum(['minute', 'hour', 'day', 'month', 'year']);

export const storyAbsoluteDateSchema = z
  .object({
    year: z.number().int().min(1).max(1_000_000),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    note: shortTextSchema.default(''),
  })
  .superRefine((value, context) => {
    if (value.day !== undefined && value.month === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['month'],
        message: 'Choose a month when a day is set',
      });
    }
    if (value.month !== undefined && value.day !== undefined) {
      const daysInMonth = new Date(Date.UTC(2000, value.month, 0)).getUTCDate();
      if (value.day > daysInMonth) {
        context.addIssue({
          code: 'custom',
          path: ['day'],
          message: 'Choose a valid day for this month',
        });
      }
    }
  });

export const storyDurationSchema = z.object({
  amount: z.number().int().min(1).max(1_000_000),
  unit: storyDurationUnitSchema,
});

export type StoryAbsoluteDate = z.infer<typeof storyAbsoluteDateSchema>;
export type StoryDuration = z.infer<typeof storyDurationSchema>;

const timelineEraFieldsSchema = z.object({
  name: labelSchema,
  summary: longTextSchema,
  startDate: storyAbsoluteDateSchema.nullable(),
  endDate: storyAbsoluteDateSchema.nullable(),
});

export const timelineEraInputSchema = timelineEraFieldsSchema
  .extend({
    summary: timelineEraFieldsSchema.shape.summary.default(''),
    startDate: timelineEraFieldsSchema.shape.startDate.default(null),
    endDate: timelineEraFieldsSchema.shape.endDate.default(null),
  })
  .superRefine((value, context) => {
    if (value.startDate && value.endDate) {
      const start = absoluteDateValue(value.startDate);
      const end = absoluteDateValue(value.endDate);
      if (start > end) {
        context.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'Era end must not be before its start',
        });
      }
    }
  });

const timelineNodeFieldsSchema = z.object({
  title: labelSchema,
  summary: longTextSchema,
  eraId: z.string().uuid().nullable(),
  absoluteDate: storyAbsoluteDateSchema.nullable(),
  relativeTime: z.string().trim().max(500),
  relativeToNodeId: z.string().uuid().nullable(),
  duration: storyDurationSchema.nullable(),
  orderIndex: z.number().int().min(0).max(1_000_000),
});

export const timelineNodeInputSchema = timelineNodeFieldsSchema.extend({
  summary: timelineNodeFieldsSchema.shape.summary.default(''),
  eraId: timelineNodeFieldsSchema.shape.eraId.default(null),
  absoluteDate: timelineNodeFieldsSchema.shape.absoluteDate.default(null),
  relativeTime: timelineNodeFieldsSchema.shape.relativeTime.default(''),
  relativeToNodeId: timelineNodeFieldsSchema.shape.relativeToNodeId.default(null),
  duration: timelineNodeFieldsSchema.shape.duration.default(null),
  orderIndex: timelineNodeFieldsSchema.shape.orderIndex.default(0),
});

export const timelineEraUpdateSchema = timelineEraFieldsSchema.partial();
export const timelineNodeUpdateSchema = timelineNodeFieldsSchema.partial();

export type TimelineEraInput = z.infer<typeof timelineEraInputSchema>;
export type TimelineNodeInput = z.infer<typeof timelineNodeInputSchema>;

function absoluteDateValue(value: StoryAbsoluteDate): number {
  return value.year * 10_000 + (value.month ?? 0) * 100 + (value.day ?? 0);
}
