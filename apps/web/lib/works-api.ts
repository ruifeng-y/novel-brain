import type { GenrePackDefinition, WorkGenrePack } from '@novel/contracts';

export type WorkStatus = 'preparing' | 'serializing' | 'paused' | 'completed' | 'archived';
export type WorkScale = 'short' | 'medium' | 'long' | 'epic';

export type Work = {
  id: string;
  title: string;
  penName: string;
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
  lastEditedAt: string;
  createdAt: string;
  mainBranch: {
    id: string;
    name: string;
    isMain: boolean;
  } | null;
};

export type WorkListResponse = {
  items: Work[];
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

export function formatWorkDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}
