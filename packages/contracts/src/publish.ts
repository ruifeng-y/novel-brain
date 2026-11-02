import { z } from 'zod';
import { exportFormatSchema } from './export';

export const PUBLISH_CHECK_STATUS_LABELS = {
  pass: '通过',
  review: '需要确认',
  block: '需要修改',
} as const;

export const publishCheckStatusSchema = z.enum(['pass', 'review', 'block']);
export type PublishCheckStatus = z.infer<typeof publishCheckStatusSchema>;

export type PublishCheckChapter = {
  chapterNumber: number;
  title: string;
  content: string;
  hook: string;
  aiGenerated: boolean;
};

export type PublishCheckInput = {
  format: string;
  chapters: PublishCheckChapter[];
};

export type PublishCheckItem = {
  key: string;
  label: string;
  status: PublishCheckStatus;
  statusLabel: string;
  summary: string;
  details: string[];
};

export type PublishCheckResult = {
  checks: PublishCheckItem[];
};

export type PublishCheckResponse = PublishCheckResult & {
  generatedAt: string;
  report: string;
};

export const publishCheckRequestSchema = z.object({
  format: exportFormatSchema,
});
export type PublishCheckRequest = z.infer<typeof publishCheckRequestSchema>;

const publishChapterNumberSchema = z.coerce.number().int().min(1).max(100_000);

export const publishSuggestionsSchema = z.object({
  titles: z.array(z.string().trim().min(1).max(120)).min(1).max(5),
  synopsis: z.string().trim().min(1).max(1_200),
  tags: z.array(z.string().trim().min(1).max(30)).min(1).max(10),
  chapterTitles: z
    .array(
      z.object({
        chapterNumber: publishChapterNumberSchema,
        title: z.string().trim().min(1).max(120),
      }),
    )
    .max(20)
    .default([]),
});
export type PublishSuggestions = z.infer<typeof publishSuggestionsSchema>;

export type PublishReaderChapter = {
  chapterNumber: number;
  title: string;
  content: string;
};

export type PublishReaderPreview = {
  title: string;
  penName: string;
  genreLabel: string;
  synopsis: string;
  tags: string[];
  chapters: PublishReaderChapter[];
  exportOnly: true;
};
