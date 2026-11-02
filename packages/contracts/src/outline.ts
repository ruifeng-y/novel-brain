import { z } from 'zod';

export const outlineLevelSchema = z.enum(['book', 'volume', 'act', 'chapter', 'scene']);

export type OutlineLevel = z.infer<typeof outlineLevelSchema>;

export const OUTLINE_LEVEL_LABELS: Record<OutlineLevel, string> = {
  book: '全书',
  volume: '卷',
  act: '幕',
  chapter: '章',
  scene: '场景',
};

export const OUTLINE_CHILD_LEVEL: Partial<Record<OutlineLevel, OutlineLevel>> = {
  book: 'volume',
  volume: 'act',
  act: 'chapter',
  chapter: 'scene',
};

export const OUTLINE_PARENT_LEVEL: Partial<Record<OutlineLevel, OutlineLevel>> = {
  volume: 'book',
  act: 'volume',
  chapter: 'act',
  scene: 'chapter',
};

export const outlineIdSchema = z.string().uuid();

const lockedChangeSchema = {
  confirmLockedChange: z.boolean().optional(),
  changeReason: z.string().trim().min(1).max(500).optional(),
};

export const createOutlineNodeSchema = z
  .object({
    level: outlineLevelSchema,
    parentId: outlineIdSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(2_000).default(''),
    details: z.string().trim().max(12_000).default(''),
    chapterNumber: z.coerce.number().int().min(1).max(100_000).optional(),
    chapterGoal: z.string().trim().max(1_000).default(''),
    pov: z.string().trim().max(120).default(''),
    sceneBeats: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    chapterEndHook: z.string().trim().max(500).default(''),
  })
  .superRefine((value, context) => {
    if (value.level === 'book' && value.parentId) {
      context.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'The whole-book outline cannot have a parent',
      });
    }
    if (value.level !== 'book' && !value.parentId) {
      context.addIssue({
        code: 'custom',
        path: ['parentId'],
        message: 'Choose a parent outline node',
      });
    }
  });

export type CreateOutlineNodeInput = z.infer<typeof createOutlineNodeSchema>;

export const updateOutlineNodeSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    summary: z.string().trim().max(2_000).optional(),
    details: z.string().trim().max(12_000).optional(),
    parentId: outlineIdSchema.nullable().optional(),
    chapterNumber: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
    chapterGoal: z.string().trim().max(1_000).optional(),
    pov: z.string().trim().max(120).optional(),
    sceneBeats: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
    chapterEndHook: z.string().trim().max(500).optional(),
    ...lockedChangeSchema,
  })
  .superRefine((value, context) => {
    if (value.confirmLockedChange && !value.changeReason) {
      context.addIssue({
        code: 'custom',
        path: ['changeReason'],
        message: 'Explain why the locked outline node needs to change',
      });
    }
  });

export type UpdateOutlineNodeInput = z.infer<typeof updateOutlineNodeSchema>;

export const deleteOutlineNodeSchema = z
  .object(lockedChangeSchema)
  .superRefine((value, context) => {
    if (value.confirmLockedChange && !value.changeReason) {
      context.addIssue({
        code: 'custom',
        path: ['changeReason'],
        message: 'Explain why the locked outline node needs to change',
      });
    }
  });

export type DeleteOutlineNodeInput = z.infer<typeof deleteOutlineNodeSchema>;

export const reorderOutlineNodesSchema = z
  .object({
    parentId: outlineIdSchema.nullable(),
    orderedIds: z.array(outlineIdSchema).min(1).max(100),
    ...lockedChangeSchema,
  })
  .superRefine((value, context) => {
    if (new Set(value.orderedIds).size !== value.orderedIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['orderedIds'],
        message: 'Each outline node can appear only once',
      });
    }
    if (value.confirmLockedChange && !value.changeReason) {
      context.addIssue({
        code: 'custom',
        path: ['changeReason'],
        message: 'Explain why the locked outline node needs to change',
      });
    }
  });

export type ReorderOutlineNodesInput = z.infer<typeof reorderOutlineNodesSchema>;

export const regenerateOutlineNodeSchema = z.object({
  instruction: z.string().trim().max(2_000).optional(),
  ...lockedChangeSchema,
});

export type RegenerateOutlineNodeInput = z.infer<typeof regenerateOutlineNodeSchema>;

export const outlineReadinessQuerySchema = z.object({
  chapterNumber: z.coerce.number().int().min(1).max(100_000).optional(),
});

export type OutlineReadinessQuery = z.infer<typeof outlineReadinessQuerySchema>;

export const outlineRegenerationSchema = z.object({
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(2_000),
  details: z.string().trim().max(12_000),
  chapterGoal: z.string().trim().max(1_000).optional(),
  pov: z.string().trim().max(120).optional(),
  sceneBeats: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  chapterEndHook: z.string().trim().max(500).optional(),
});

export type OutlineRegeneration = z.infer<typeof outlineRegenerationSchema>;
