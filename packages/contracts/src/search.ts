import { z } from 'zod';

export const workSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type WorkSearchInput = z.infer<typeof workSearchQuerySchema>;

export const WORK_SEARCH_TYPE_LABELS = {
  setting: '设定',
  outline: '大纲',
  chapter: '正文',
} as const;

export type WorkSearchType = keyof typeof WORK_SEARCH_TYPE_LABELS;

export type WorkSearchItem = {
  type: WorkSearchType;
  typeLabel: string;
  id: string;
  title: string;
  snippet: string;
  chapterNumber: number | null;
  updatedAt: string;
};

export type WorkSearchResult = {
  query: string;
  items: WorkSearchItem[];
};
