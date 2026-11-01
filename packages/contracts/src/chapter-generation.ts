import { z } from 'zod';

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

export const generateChapterSchema = z.object({
  instruction: z.string().trim().max(2_000).optional(),
  targetMinCharacters: z.coerce.number().int().min(2_000).max(3_000).default(2_000),
  targetMaxCharacters: z.coerce.number().int().min(2_000).max(3_000).default(3_000),
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

export type GenerateChapterInput = z.infer<typeof generateChapterSchema>;
export type SaveChapterVersionInput = z.infer<typeof saveChapterVersionSchema>;
export type ChapterStatus = z.infer<typeof chapterStatusSchema>;
export type ChapterGenerationStatus = z.infer<typeof chapterGenerationStatusSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobStepStatus = z.infer<typeof jobStepStatusSchema>;
export type DraftStatus = z.infer<typeof draftStatusSchema>;
