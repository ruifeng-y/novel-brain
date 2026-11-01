import { ApiError, apiRequest } from './auth-api';
import type { ChapterOutline, StoryBible } from './story-planning-api';

export type ChapterStatus = 'planned' | 'writing' | 'review' | 'locked' | 'published';

export type ChapterListItem = {
  chapterNumber: number;
  title: string;
  goal: string;
  status: ChapterStatus;
  statusLabel: string;
  wordCount: number;
  hasContent: boolean;
};

export type ChapterVersion = {
  id: string;
  chapterNumber: number;
  version: number;
  content: string;
  contentHash: string;
  wordCount: number;
  source: 'generated' | 'manual' | 'restored';
  modelConfigId: string | null;
  createdAt: string;
};

export type ChapterDraft = {
  id: string;
  jobId: string | null;
  status: 'pending' | 'streaming' | 'ready' | 'failed';
  content: string;
  error: Record<string, unknown> | null;
  updatedAt: string;
};

export type ChapterDetail = {
  chapterNumber: number;
  title: string;
  status: ChapterStatus;
  statusLabel: string;
  wordCount: number;
  content: string;
  outline: ChapterOutline;
  currentVersion: ChapterVersion | null;
  latestDraft: ChapterDraft | null;
  versions: ChapterVersion[];
  context: {
    id: string;
    tokenBudget: number;
    sections: Array<{
      key: string;
      title: string;
      content: Record<string, unknown>;
    }>;
    sourceRefs: string[];
    createdAt: string;
  } | null;
  latestGeneration: {
    id: string;
    jobId: string | null;
    status: 'queued' | 'running' | 'completed' | 'failed';
  } | null;
};

export type GenerationStart = {
  generationRequestId: string;
  jobId: string;
  chapterNumber: number;
  status: 'queued';
};

export type GenerationJob = {
  id: string;
  generationRequestId: string | null;
  chapterNumber: number;
  status:
    | 'queued'
    | 'preparing'
    | 'running'
    | 'waiting_review'
    | 'completed'
    | 'failed'
    | 'canceled'
    | 'paused';
  progress: number;
  modelConfigId: string | null;
  error: Record<string, unknown> | null;
  steps: Array<{
    key: string;
    status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
    error: Record<string, unknown> | null;
  }>;
  draft: {
    id: string;
    status: 'pending' | 'streaming' | 'ready' | 'failed';
    content: string;
    updatedAt: string;
  } | null;
};

export type GenerationEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

function generationPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function loadChapters(
  workId: string,
  branchId: string,
): Promise<{ items: ChapterListItem[] }> {
  return apiRequest<{ items: ChapterListItem[] }>(
    `${generationPath(workId, branchId)}/chapters`,
  );
}

export function loadChapter(
  workId: string,
  branchId: string,
  chapterNumber: number,
): Promise<ChapterDetail> {
  return apiRequest<ChapterDetail>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}`,
  );
}

export function startChapterGeneration(
  workId: string,
  branchId: string,
  chapterNumber: number,
  instruction?: string,
): Promise<GenerationStart> {
  return apiRequest<GenerationStart>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(instruction?.trim() ? { instruction: instruction.trim() } : {}),
      }),
    },
  );
}

export function loadGenerationJob(
  workId: string,
  branchId: string,
  jobId: string,
): Promise<GenerationJob> {
  return apiRequest<GenerationJob>(
    `${generationPath(workId, branchId)}/jobs/${jobId}`,
  );
}

export function generationEventsUrl(
  workId: string,
  branchId: string,
  jobId: string,
): string {
  return `${generationPath(workId, branchId)}/jobs/${jobId}/events`;
}

export function saveChapterVersion(
  workId: string,
  branchId: string,
  chapterNumber: number,
  content: string,
): Promise<ChapterVersion> {
  return apiRequest<ChapterVersion>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/versions`,
    {
      method: 'POST',
      body: JSON.stringify({ content }),
    },
  );
}

export const STORY_BIBLE_SECTION_LABELS: Record<string, string> = {
  oneSentenceStory: '一句话故事',
  protagonist: '主角',
  worldIronLaw: '世界铁律',
};

export function generationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'MODEL_CONFIG_REQUIRED') {
    return '还没有可用的正文模型，请先到模型设置里完成配置。';
  }
  return '这次生成没有完成，写出的内容已经保留。你可以直接修改，或稍后再试。';
}

export function contextSection(
  sectionKey: string,
  outline: ChapterOutline,
  storyBible: StoryBible | null,
): Array<{ label: string; value: string }> {
  if (sectionKey === 'chapterOutline') {
    return [
      { label: '章目标', value: outline.chapterGoal },
      { label: '叙事视角', value: outline.pov },
      { label: '场景节拍', value: outline.sceneBeats.join(' / ') },
      { label: '章末钩子', value: outline.chapterEndHook },
    ];
  }
  if (sectionKey === 'storyBible' && storyBible) {
    return [
      { label: '一句话故事', value: storyBible.oneSentenceStory },
      { label: '主角', value: storyBible.protagonist },
      { label: '世界铁律', value: storyBible.worldIronLaw },
    ];
  }
  return [];
}
