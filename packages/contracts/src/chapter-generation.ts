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

export const generateChapterSchema = z
  .object({
    instruction: z.string().trim().max(2_000).optional(),
    targetMinCharacters: z.coerce
      .number()
      .int()
      .min(DEFAULT_CHAPTER_TARGET_MIN)
      .max(DEFAULT_CHAPTER_TARGET_MAX)
      .default(DEFAULT_CHAPTER_TARGET_MIN),
    targetMaxCharacters: z.coerce
      .number()
      .int()
      .min(DEFAULT_CHAPTER_TARGET_MIN)
      .max(DEFAULT_CHAPTER_TARGET_MAX)
      .default(DEFAULT_CHAPTER_TARGET_MAX),
  })
  .refine((value) => value.targetMinCharacters <= value.targetMaxCharacters, {
    message: 'targetMinCharacters must be less than or equal to targetMaxCharacters',
    path: ['targetMaxCharacters'],
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
export type SaveChapterVersionInput = z.infer<typeof saveChapterVersionSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type ChapterGenerationStatus = z.infer<typeof chapterGenerationStatusSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStepStatus = z.infer<typeof jobStepStatusSchema>;
export type DraftStatus = z.infer<typeof draftStatusSchema>;
export type ContinuityIssueStatus = z.infer<typeof continuityIssueStatusSchema>;
export type IgnoreContinuityIssueInput = z.infer<typeof ignoreContinuityIssueSchema>;
