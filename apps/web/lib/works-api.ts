import type { GenrePackDefinition, WorkGenrePack } from '@novel/contracts';

export type WorkStatus = 'preparing' | 'serializing' | 'paused' | 'completed' | 'archived';
export type WorkScale = 'short' | 'medium' | 'long' | 'epic';

export type Work = {
  id: string;
  title: string;
  penName: string;
  penNameId: string | null;
  genrePack: WorkGenrePack;
  genrePackLabel: string;
  genreTemplate:
    | (GenrePackDefinition['template'] & {
        subtypes: GenrePackDefinition['subtypes'];
      })
    | null;
  genreVariant: string | null;
  genreVariantLabel: string | null;
  mainTemplate: string | null;
  scale: WorkScale;
  targetPlatform: string;
  status: WorkStatus;
  statusLabel: string;
  wordCount: number;
  progressPercent: number;
  totalChapters: number;
  completedChapters: number;
  qualityScore: number | null;
  unresolvedForeshadowCount: number;
  lastEditedAt: string;
  createdAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  readOnly: boolean;
  mainBranch: {
    id: string;
    name: string;
    isMain: boolean;
  } | null;
};

export type WorkListResponse = {
  items: Work[];
};

export type WorkListFilters = {
  search?: string;
  view?: 'active' | 'archived' | 'trash' | 'all';
  status?: WorkStatus;
  genrePack?: WorkGenrePack;
  sort?: 'updated_desc' | 'word_count_desc' | 'word_count_asc' | 'progress_desc' | 'quality_desc';
  minWordCount?: number;
  maxWordCount?: number;
  recentDays?: number;
};

export const GENRE_LABELS: Record<string, string> = {
  xianxia: '仙侠',
  history: '历史',
  urban: '都市',
};

export const SCALE_LABELS: Record<WorkScale, string> = {
  short: '短篇（10 万字内）',
  medium: '中篇（10–30 万字）',
  long: '长篇（30–100 万字）',
  epic: '超长篇（100 万字以上）',
};

export const TARGET_PLATFORMS = ['起点中文网', '番茄小说', '七猫中文网', '其他平台'];

export function buildWorksQuery(filters: WorkListFilters): string {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set('q', filters.search.trim());
  }
  if (filters.view) {
    params.set('view', filters.view);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  if (filters.genrePack) {
    params.set('genrePack', filters.genrePack);
  }
  if (filters.sort) {
    params.set('sort', filters.sort);
  }
  if (filters.minWordCount !== undefined) {
    params.set('minWordCount', String(filters.minWordCount));
  }
  if (filters.maxWordCount !== undefined) {
    params.set('maxWordCount', String(filters.maxWordCount));
  }
  if (filters.recentDays !== undefined) {
    params.set('recentDays', String(filters.recentDays));
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function formatWorkDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
