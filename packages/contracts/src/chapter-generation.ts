import { z } from 'zod';

export const DEFAULT_CHAPTER_TARGET_MIN = 2_000;
export const DEFAULT_CHAPTER_TARGET_MAX = 3_000;

const CJK_IDEOGRAPH_PATTERN =
  /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]/gu;

export function isCjkIdeograph(character: string): boolean {
  return /^[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{323AF}]$/u.test(
    character,
  );
}

export function countCjkCharacters(text: string): number {
  return text.match(CJK_IDEOGRAPH_PATTERN)?.length ?? 0;
}

export const chapterStatusSchema = z.enum([
  'planned',
  'writing',
  'review',
  'locked',
  'published',
]);

export const CHAPTER_STATUS_LABELS: Record<
  z.infer<typeof chapterStatusSchema>,
  string
> = {
  planned: '已规划',
  writing: '写作中',
  review: '待审',
  locked: '已锁定',
  published: '已发布',
};

export const writingQualityTierSchema = z.enum(['fast', 'standard', 'premium']);

export const QUALITY_TIER_LABELS: Record<
  z.infer<typeof writingQualityTierSchema>,
  string
> = {
  fast: '快速',
  standard: '标准',
  premium: '精品',
};

export const chapterGenerationActionSchema = z.enum([
  'chapter',
  'continue',
  'rewrite',
  'expand',
  'condense',
  'change_pov',
  'hooks',
  'title',
  'summary',
]);

export const chapterGenerationOutputKindSchema = z.enum([
  'chapter',
  'segment',
  'hook_options',
  'title',
  'summary',
]);

export const CHAPTER_ACTION_OUTPUT_KIND: Record<
  z.infer<typeof chapterGenerationActionSchema>,
  z.infer<typeof chapterGenerationOutputKindSchema>
> = {
  chapter: 'chapter',
  continue: 'segment',
  rewrite: 'segment',
  expand: 'segment',
  condense: 'segment',
  change_pov: 'segment',
  hooks: 'hook_options',
  title: 'title',
  summary: 'summary',
};

const writingListSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(40)
  .default([]);

export const generateChapterSchema = z
  .object({
    instruction: z.string().trim().max(2_000).optional(),
    qualityTier: writingQualityTierSchema.default('standard'),
    modelConfigId: z.string().uuid().optional(),
    targetMinCharacters: z.coerce
      .number()
      .int()
      .min(1)
      .max(20_000)
      .default(DEFAULT_CHAPTER_TARGET_MIN),
    targetMaxCharacters: z.coerce
      .number()
      .int()
      .min(1)
      .max(20_000)
      .default(DEFAULT_CHAPTER_TARGET_MAX),
    pov: z.string().trim().max(120).optional(),
    targetPov: z.string().trim().max(120).optional(),
    mustInclude: writingListSchema,
    mustAvoid: writingListSchema,
    referenceChapters: z
      .array(z.coerce.number().int().min(1).max(10_000))
      .max(20)
      .default([]),
    tabooWords: writingListSchema,
    content: z.string().max(200_000).optional(),
    selection: z.string().max(50_000).optional(),
    selectionStart: z.coerce.number().int().min(0).optional(),
    selectionEnd: z.coerce.number().int().min(0).optional(),
    cursorOffset: z.coerce.number().int().min(0).max(200_000).optional(),
  })
  .refine((value) => value.targetMinCharacters <= value.targetMaxCharacters, {
    message: 'targetMinCharacters must be less than or equal to targetMaxCharacters',
    path: ['targetMaxCharacters'],
  })
  .refine(
    (value) =>
      value.selectionStart === undefined ||
      value.selectionEnd === undefined ||
      value.selectionStart <= value.selectionEnd,
    {
      message: 'selectionStart must be less than or equal to selectionEnd',
      path: ['selectionEnd'],
    },
  );

export const saveChapterAutosaveSchema = z.object({
  content: z.string().max(200_000),
});

export const updateChapterMetadataSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    summary: z.string().trim().max(4_000).optional(),
    hook: z.string().trim().max(4_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one chapter field to update',
  });

export const saveChapterVersionSchema = z.object({
  content: z.string().min(1).max(200_000),
  title: z.string().trim().min(1).max(120).optional(),
});

export const chapterGenerationStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
]);

export const jobStatusSchema = z.enum([
  'queued',
  'preparing',
  'running',
  'waiting_review',
  'completed',
  'failed',
  'canceled',
  'paused',
]);

export const jobStepStatusSchema = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);

export const draftStatusSchema = z.enum(['pending', 'streaming', 'ready', 'failed']);

export const continuityIssueStatusSchema = z.enum(['open', 'ignored']);

export const CONTINUITY_CATEGORY_LABELS: Record<string, string> = {
  body_state: '身体状态',
  taboo: '禁忌词',
  intent: '写作要求',
  voice: '人物声纹',
  rhythm: '节奏',
  repetition: '重复',
  logic: '逻辑',
  style: '文风',
};

export const CONTINUITY_SEVERITY_LABELS: Record<string, string> = {
  warning: '需要确认',
};

export const CONTINUITY_STATUS_LABELS: Record<
  z.infer<typeof continuityIssueStatusSchema>,
  string
> = {
  open: '待处理',
  ignored: '已忽略',
};

export const ignoreContinuityIssueSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export type GenerateChapterInput = z.infer<typeof generateChapterSchema>;
export type WritingQualityTier = z.infer<typeof writingQualityTierSchema>;
export type ChapterGenerationAction = z.infer<typeof chapterGenerationActionSchema>;
export type ChapterGenerationOutputKind = z.infer<
  typeof chapterGenerationOutputKindSchema
>;
export type SaveChapterAutosaveInput = z.infer<typeof saveChapterAutosaveSchema>;
export type UpdateChapterMetadataInput = z.infer<typeof updateChapterMetadataSchema>;
export type SaveChapterVersionInput = z.infer<typeof saveChapterVersionSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type ChapterGenerationStatus = z.infer<typeof chapterGenerationStatusSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStepStatus = z.infer<typeof jobStepStatusSchema>;
export type DraftStatus = z.infer<typeof draftStatusSchema>;
export type ContinuityIssueStatus = z.infer<typeof continuityIssueStatusSchema>;
export type IgnoreContinuityIssueInput = z.infer<typeof ignoreContinuityIssueSchema>;
