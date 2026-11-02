import { z } from 'zod';
import { historyVariantSchema } from './history-pack';

export const GENRE_PACK_LABELS = {
  xianxia: '仙侠',
  history: '历史',
  urban: '都市',
} as const;

export const workGenrePackSchema = z.enum(['xianxia', 'history', 'urban']);
export const workScaleSchema = z.enum(['short', 'medium', 'long', 'epic']);
export const workCreationModeSchema = z.enum(['idea', 'blank']);
export const workStatusSchema = z.enum([
  'preparing',
  'serializing',
  'paused',
  'completed',
  'archived',
]);

export const WORK_CREATION_MODE_LABELS: Record<z.infer<typeof workCreationModeSchema>, string> = {
  idea: '一句话想法',
  blank: '空白作品',
};

export const WORK_UPDATE_CADENCE_OPTIONS = [
  '日更',
  '每周三更',
  '每周两更',
  '周更',
  '不定期更新',
] as const;

const workTagsSchema = z
  .array(z.string().trim().min(1).max(30))
  .max(20)
  .transform((tags) => Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean))));

export function deriveWorkTitleFromIdea(idea: string): string {
  const firstClause = idea
    .trim()
    .split(/[。！？!?\n，,；;]/)[0]
    ?.trim();
  return (firstClause || '未命名作品').slice(0, 24);
}

export const createWorkSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    penName: z.string().trim().min(1).max(60).optional(),
    penNameId: z.string().uuid().optional(),
    genrePack: workGenrePackSchema,
    genreVariant: historyVariantSchema.optional(),
    scale: workScaleSchema,
    targetPlatform: z.string().trim().min(1).max(80),
    creationMode: workCreationModeSchema.optional().default('blank'),
    idea: z.string().trim().max(5_000).optional().default(''),
    targetReader: z.string().trim().max(200).optional().default(''),
    chapterWordCount: z.coerce.number().int().min(500).max(20_000).optional().default(3_000),
    updateCadence: z.string().trim().min(1).max(60).optional().default('日更'),
    styleSamples: z.string().trim().max(20_000).optional().default(''),
    taboos: z.string().trim().max(2_000).optional().default(''),
    synopsis: z.string().trim().max(4_000).optional().default(''),
    tags: workTagsSchema.optional().default([]),
  })
  .superRefine((value, context) => {
    if (value.creationMode === 'idea' && !value.idea) {
      context.addIssue({
        code: 'custom',
        path: ['idea'],
        message: 'Write a one-line story idea',
      });
    }
    if (value.creationMode !== 'idea' && !value.title) {
      context.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'Give the work a title',
      });
    }
    if (!value.penName && !value.penNameId) {
      context.addIssue({
        code: 'custom',
        path: ['penName'],
        message: 'Choose or enter a pen name',
      });
    }
    if (value.genrePack !== 'history' && value.genreVariant !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['genreVariant'],
        message: 'Only history works can choose a history variant',
      });
    }
  });

export const workIdSchema = z.string().uuid();

export const WORK_STATUS_LABELS: Record<z.infer<typeof workStatusSchema>, string> = {
  preparing: '筹备中',
  serializing: '连载中',
  paused: '暂停',
  completed: '已完本',
  archived: '已归档',
};

export const workViewSchema = z.enum(['active', 'archived', 'trash', 'all']);
export const workSortSchema = z.enum([
  'updated_desc',
  'word_count_desc',
  'word_count_asc',
  'progress_desc',
  'quality_desc',
  'updated',
  'word_count',
  'progress',
  'quality',
]);

const queryBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true')
  .optional();

export const workListQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  search: z.string().trim().max(120).optional(),
  view: workViewSchema.optional().default('active'),
  status: workStatusSchema.optional(),
  genrePack: workGenrePackSchema.optional(),
  genre: workGenrePackSchema.optional(),
  includeArchived: queryBooleanSchema,
  trash: queryBooleanSchema,
  sort: workSortSchema.optional().default('updated_desc'),
  minWordCount: z.coerce.number().int().min(0).optional(),
  maxWordCount: z.coerce.number().int().min(0).optional(),
  recentDays: z.coerce.number().int().min(1).max(3650).optional(),
});

export const updateWorkSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    penName: z.string().trim().min(1).max(60).optional(),
    genrePack: workGenrePackSchema.optional(),
    genreVariant: historyVariantSchema.optional().nullable(),
    scale: workScaleSchema.optional(),
    targetPlatform: z.string().trim().min(1).max(80).optional(),
    targetReader: z.string().trim().max(200).optional(),
    chapterWordCount: z.coerce.number().int().min(500).max(20_000).optional(),
    updateCadence: z.string().trim().min(1).max(60).optional(),
    styleSamples: z.string().trim().max(20_000).optional(),
    taboos: z.string().trim().max(2_000).optional(),
    synopsis: z.string().trim().max(4_000).optional(),
    tags: workTagsSchema.optional(),
    status: workStatusSchema.optional(),
    changeReason: z.string().trim().max(500).optional(),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'changeReason'), {
    message: 'Provide at least one work field to update',
  });

export const duplicateWorkSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  penName: z.string().trim().min(1).max(60).optional(),
});

export const workImportSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    content: z.string().max(20_000_000).optional(),
    contentBase64: z.string().max(28_000_000).optional(),
    format: z.enum(['txt', 'markdown', 'docx']).optional(),
  })
  .refine((value) => Boolean(value.content) || Boolean(value.contentBase64), {
    message: 'Choose a manuscript file to import',
    path: ['content'],
  });

export const createWorkFromImportSchema = createWorkSchema.and(workImportSchema);

export const WORK_STATUS_TRANSITIONS: Record<WorkStatus, WorkStatus[]> = {
  preparing: ['serializing', 'paused', 'completed', 'archived'],
  serializing: ['paused', 'completed', 'archived'],
  paused: ['serializing', 'completed', 'archived'],
  completed: ['serializing', 'archived'],
  archived: [],
};

export const IMPORT_FORMAT_LABELS = {
  txt: 'TXT',
  markdown: 'Markdown',
  docx: 'Word',
} as const;

export type CreateWorkInput = z.infer<typeof createWorkSchema>;
export type WorkGenrePack = z.infer<typeof workGenrePackSchema>;
export type WorkScale = z.infer<typeof workScaleSchema>;
export type WorkCreationMode = z.infer<typeof workCreationModeSchema>;
export type WorkStatus = z.infer<typeof workStatusSchema>;
export type WorkView = z.infer<typeof workViewSchema>;
export type WorkSort = z.infer<typeof workSortSchema>;
export type WorkListQuery = z.infer<typeof workListQuerySchema>;
export type UpdateWorkInput = z.infer<typeof updateWorkSchema>;
export type DuplicateWorkInput = z.infer<typeof duplicateWorkSchema>;
export type WorkImportInput = z.infer<typeof workImportSchema>;
export type ImportFormat = NonNullable<WorkImportInput['format']>;
