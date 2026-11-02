import { z } from 'zod';

export const storyThreadTypeSchema = z.enum([
  'main',
  'sub',
  'character',
  'faction',
  'mystery',
  'romance',
]);

export type StoryThreadType = z.infer<typeof storyThreadTypeSchema>;

export const STORY_THREAD_TYPE_LABELS: Record<StoryThreadType, string> = {
  main: '主线',
  sub: '支线',
  character: '人物线',
  faction: '势力线',
  mystery: '悬疑线',
  romance: '感情线',
};

export const storyThreadStatusSchema = z.enum(['active', 'resolved', 'abandoned']);

export type StoryThreadStatus = z.infer<typeof storyThreadStatusSchema>;

export const STORY_THREAD_STATUS_LABELS: Record<StoryThreadStatus, string> = {
  active: '推进中',
  resolved: '已收束',
  abandoned: '已搁置',
};

export const storyThreadMilestoneSchema = z.object({
  chapterNumber: z.coerce.number().int().min(1).max(100_000),
  description: z.string().trim().min(1).max(500),
});

export type StoryThreadMilestone = z.infer<typeof storyThreadMilestoneSchema>;

export const storyThreadTensionPointSchema = z.object({
  chapterNumber: z.coerce.number().int().min(1).max(100_000),
  tension: z.coerce.number().int().min(1).max(10),
});

export type StoryThreadTensionPoint = z.infer<typeof storyThreadTensionPointSchema>;

const threadFields = {
  name: z.string().trim().min(1).max(200),
  type: storyThreadTypeSchema,
  summary: z.string().trim().max(2_000),
  stakes: z.string().trim().min(1).max(2_000),
  participantIds: z.array(z.string().uuid()).max(100),
  plannedPayoffChapter: z.coerce.number().int().min(1).max(100_000).nullable(),
  status: storyThreadStatusSchema,
  milestones: z.array(storyThreadMilestoneSchema).max(200),
  tensionCurve: z.array(storyThreadTensionPointSchema).max(200),
};

function addUniqueChapterIssues(
  value: {
    participantIds: string[];
    milestones: StoryThreadMilestone[];
    tensionCurve: StoryThreadTensionPoint[];
  },
  context: z.RefinementCtx,
) {
  if (new Set(value.participantIds).size !== value.participantIds.length) {
    context.addIssue({
      code: 'custom',
      path: ['participantIds'],
      message: 'Each participant can appear only once',
    });
  }

  const milestoneChapters = value.milestones.map((milestone) => milestone.chapterNumber);
  if (new Set(milestoneChapters).size !== milestoneChapters.length) {
    context.addIssue({
      code: 'custom',
      path: ['milestones'],
      message: 'Each milestone chapter can appear only once',
    });
  }

  const tensionChapters = value.tensionCurve.map((point) => point.chapterNumber);
  if (new Set(tensionChapters).size !== tensionChapters.length) {
    context.addIssue({
      code: 'custom',
      path: ['tensionCurve'],
      message: 'Each tension chapter can appear only once',
    });
  }
}

export const createStoryThreadSchema = z
  .object({
    ...threadFields,
    summary: threadFields.summary.default(''),
    participantIds: threadFields.participantIds.default([]),
    plannedPayoffChapter: threadFields.plannedPayoffChapter.optional().default(null),
    status: threadFields.status.default('active'),
    milestones: threadFields.milestones.default([]),
    tensionCurve: threadFields.tensionCurve.default([]),
  })
  .superRefine(addUniqueChapterIssues);

export type CreateStoryThreadInput = z.infer<typeof createStoryThreadSchema>;

export const updateStoryThreadSchema = z
  .object({
    name: threadFields.name.optional(),
    type: threadFields.type.optional(),
    summary: threadFields.summary.optional(),
    stakes: threadFields.stakes.optional(),
    participantIds: threadFields.participantIds.optional(),
    plannedPayoffChapter: threadFields.plannedPayoffChapter.optional(),
    status: threadFields.status.optional(),
    milestones: threadFields.milestones.optional(),
    tensionCurve: threadFields.tensionCurve.optional(),
  })
  .superRefine((value, context) => {
    addUniqueChapterIssues(
      {
        participantIds: value.participantIds ?? [],
        milestones: value.milestones ?? [],
        tensionCurve: value.tensionCurve ?? [],
      },
      context,
    );
  });

export type UpdateStoryThreadInput = z.infer<typeof updateStoryThreadSchema>;

export const storyForeshadowStatusSchema = z.enum(['planted', 'paid_off', 'abandoned']);

export type StoryForeshadowStatus = z.infer<typeof storyForeshadowStatusSchema>;

export const STORY_FORESHADOW_STATUS_LABELS: Record<StoryForeshadowStatus, string> = {
  planted: '已埋设',
  paid_off: '已回收',
  abandoned: '已放弃',
};

export const storyForeshadowImportanceSchema = z.enum(['must', 'optional']);

export type StoryForeshadowImportance = z.infer<typeof storyForeshadowImportanceSchema>;

export const STORY_FORESHADOW_IMPORTANCE_LABELS: Record<StoryForeshadowImportance, string> = {
  must: '必须回收',
  optional: '可选回收',
};

const foreshadowFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2_000),
  plantChapter: z.coerce.number().int().min(1).max(100_000).nullable(),
  plannedPayoffChapter: z.coerce.number().int().min(1).max(100_000).nullable(),
  importance: storyForeshadowImportanceSchema,
  status: storyForeshadowStatusSchema,
};

export const createForeshadowSchema = z.object({
  ...foreshadowFields,
  plantChapter: foreshadowFields.plantChapter.optional().default(null),
  plannedPayoffChapter: foreshadowFields.plannedPayoffChapter.optional().default(null),
  importance: foreshadowFields.importance.default('optional'),
  status: foreshadowFields.status.default('planted'),
});

export type CreateForeshadowInput = z.infer<typeof createForeshadowSchema>;

export const updateForeshadowSchema = z.object({
  title: foreshadowFields.title.optional(),
  description: foreshadowFields.description.optional(),
  plantChapter: foreshadowFields.plantChapter.optional(),
  plannedPayoffChapter: foreshadowFields.plannedPayoffChapter.optional(),
  importance: foreshadowFields.importance.optional(),
  status: foreshadowFields.status.optional(),
});

export type UpdateForeshadowInput = z.infer<typeof updateForeshadowSchema>;

export const storyArcStatusSchema = z.enum(['active', 'completed', 'abandoned']);

export type StoryArcStatus = z.infer<typeof storyArcStatusSchema>;

export const STORY_ARC_STATUS_LABELS: Record<StoryArcStatus, string> = {
  active: '成长中',
  completed: '已完成',
  abandoned: '已放弃',
};

const characterArcFields = {
  characterId: z.string().uuid(),
  startState: z.string().trim().max(2_000),
  desire: z.string().trim().max(2_000),
  fear: z.string().trim().max(2_000),
  lie: z.string().trim().max(2_000),
  truth: z.string().trim().max(2_000),
  turn: z.string().trim().max(2_000),
  endState: z.string().trim().max(2_000),
  status: storyArcStatusSchema,
};

export const createCharacterArcSchema = z.object({
  ...characterArcFields,
  startState: characterArcFields.startState.default(''),
  desire: characterArcFields.desire.default(''),
  fear: characterArcFields.fear.default(''),
  lie: characterArcFields.lie.default(''),
  truth: characterArcFields.truth.default(''),
  turn: characterArcFields.turn.default(''),
  endState: characterArcFields.endState.default(''),
  status: characterArcFields.status.default('active'),
});

export type CreateCharacterArcInput = z.infer<typeof createCharacterArcSchema>;

export const updateCharacterArcSchema = z.object({
  characterId: characterArcFields.characterId.optional(),
  startState: characterArcFields.startState.optional(),
  desire: characterArcFields.desire.optional(),
  fear: characterArcFields.fear.optional(),
  lie: characterArcFields.lie.optional(),
  truth: characterArcFields.truth.optional(),
  turn: characterArcFields.turn.optional(),
  endState: characterArcFields.endState.optional(),
  status: characterArcFields.status.optional(),
});

export type UpdateCharacterArcInput = z.infer<typeof updateCharacterArcSchema>;
