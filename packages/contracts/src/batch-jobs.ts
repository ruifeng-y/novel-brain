import { z } from 'zod';
import {
  DEFAULT_CHAPTER_TARGET_MAX,
  DEFAULT_CHAPTER_TARGET_MIN,
  writingQualityTierSchema,
  type JobStatus,
} from './chapter-generation';

export const batchJobScopeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('chapter'),
    chapterNumber: z.coerce.number().int().min(1).max(100_000),
  }),
  z.object({
    type: z.literal('volume'),
    volumeId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('range'),
    startChapter: z.coerce.number().int().min(1).max(100_000),
    endChapter: z.coerce.number().int().min(1).max(100_000),
  }),
  z.object({
    type: z.literal('book'),
  }),
]);

export const batchWritingSettingsSchema = z.object({
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
  mustInclude: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  mustAvoid: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
  referenceChapters: z.array(z.coerce.number().int().min(1).max(10_000)).max(20).default([]),
  tabooWords: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
});

export const createBatchJobSchema = z
  .object({
    scope: batchJobScopeSchema,
    settings: batchWritingSettingsSchema.default(batchWritingSettingsSchema.parse({})),
  })
  .superRefine((value, context) => {
    if (value.settings.targetMinCharacters > value.settings.targetMaxCharacters) {
      context.addIssue({
        code: 'custom',
        path: ['settings', 'targetMaxCharacters'],
        message: 'targetMinCharacters must be less than or equal to targetMaxCharacters',
      });
    }
    if (value.scope.type === 'range' && value.scope.startChapter > value.scope.endChapter) {
      context.addIssue({
        code: 'custom',
        path: ['scope', 'endChapter'],
        message: 'endChapter must be greater than or equal to startChapter',
      });
    }
  });

export const batchChapterStatusSchema = z.enum([
  'pending',
  'running',
  'waiting_review',
  'completed',
  'failed',
  'canceled',
]);

export const batchReviewStatusSchema = z.enum([
  'pending',
  'approved',
  'sent_to_desk',
  'rejected',
  'ignored',
]);

export const batchReviewDecisionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('send_to_desk') }),
  z.object({ action: z.literal('reject') }),
  z.object({
    action: z.literal('ignore'),
    reason: z.string().trim().min(1).max(500),
  }),
]);

export const BATCH_JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: '排队中',
  preparing: '准备中',
  running: '运行中',
  waiting_review: '待审核',
  completed: '已完成',
  failed: '已失败',
  canceled: '已取消',
  paused: '已暂停',
};

export const BATCH_CHAPTER_STATUS_LABELS: Record<
  z.infer<typeof batchChapterStatusSchema>,
  string
> = {
  pending: '待生成',
  running: '生成中',
  waiting_review: '待审核',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
};

export const BATCH_REVIEW_STATUS_LABELS: Record<z.infer<typeof batchReviewStatusSchema>, string> = {
  pending: '待处理',
  approved: '已批准',
  sent_to_desk: '已送写作台',
  rejected: '已驳回',
  ignored: '已忽略',
};

export type BatchJobScope = z.infer<typeof batchJobScopeSchema>;
export type BatchWritingSettings = z.infer<typeof batchWritingSettingsSchema>;
export type CreateBatchJobInput = z.infer<typeof createBatchJobSchema>;
export type BatchChapterStatus = z.infer<typeof batchChapterStatusSchema>;
export type BatchReviewStatus = z.infer<typeof batchReviewStatusSchema>;
export type BatchReviewDecision = z.infer<typeof batchReviewDecisionSchema>;

export type BatchJobReport = {
  jobId: string;
  generatedAt: string;
  totalChapters: number;
  completedChapterNumbers: number[];
  failedChapters: Array<{ chapterNumber: number; message: string }>;
  canceledChapterNumbers: number[];
  waitingReviewChapterNumbers: number[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  continuity: {
    issueCount: number;
    openIssueCount: number;
    ignoredIssueCount: number;
    chaptersWithIssues: number;
    summary: string;
  };
};
