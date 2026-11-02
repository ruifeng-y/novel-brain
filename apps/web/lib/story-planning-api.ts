import { apiRequest } from './auth-api';

export type StoryBibleCard = {
  key: string;
  title: string;
  summary: string;
  details: string;
};

export type StoryBibleCompletion = {
  complete: boolean;
  filledCards: number;
  totalCards: number;
  missingCardTitles: string[];
};

export type StoryBible = {
  id: string | null;
  workId: string;
  branchId: string;
  cards: StoryBibleCard[];
  completion: StoryBibleCompletion;
  locked: boolean;
  lockedAt: string | null;
  version: number;
  oneSentenceStory: string;
  protagonist: string;
  worldIronLaw: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type StoryBibleInsights = {
  continuityReminders: Array<{
    id: string;
    chapterNumber: number;
    categoryLabel: string;
    severityLabel: string;
    message: string;
    suggestion: string;
  }>;
  unresolvedForeshadows: Array<{
    id: string;
    title: string;
    description: string;
    setupChapter: number | null;
    plannedPayoffChapter: number | null;
    importanceLabel: string;
  }>;
  recentChanges: Array<{
    id: string;
    actionLabel: string;
    reason: string;
    changedCardTitles: string[];
    authorName: string;
    createdAt: string;
  }>;
};

export type ChapterOutline = {
  id: string | null;
  workId: string;
  branchId: string;
  chapterNumber: number;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type StoryBibleInput = {
  cards: Pick<StoryBibleCard, 'key' | 'summary' | 'details'>[];
  confirmLockedChange?: boolean;
  changeReason?: string;
};

export type ChapterOutlineInput = Pick<
  ChapterOutline,
  'chapterGoal' | 'pov' | 'sceneBeats' | 'chapterEndHook'
>;

function planningPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function loadStoryBible(workId: string, branchId: string): Promise<StoryBible> {
  return apiRequest<StoryBible>(`${planningPath(workId, branchId)}/story-bible`);
}

export function saveStoryBible(
  workId: string,
  branchId: string,
  input: StoryBibleInput,
): Promise<StoryBible> {
  return apiRequest<StoryBible>(`${planningPath(workId, branchId)}/story-bible`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function lockStoryBible(workId: string, branchId: string): Promise<StoryBible> {
  return apiRequest<StoryBible>(`${planningPath(workId, branchId)}/story-bible/lock`, {
    method: 'POST',
  });
}

export function loadStoryBibleInsights(
  workId: string,
  branchId: string,
): Promise<StoryBibleInsights> {
  return apiRequest<StoryBibleInsights>(`${planningPath(workId, branchId)}/story-bible/insights`);
}

export function loadChapterOutline(
  workId: string,
  branchId: string,
  chapterNumber: number,
): Promise<ChapterOutline> {
  return apiRequest<ChapterOutline>(
    `${planningPath(workId, branchId)}/chapter-outlines/${chapterNumber}`,
  );
}

export function saveChapterOutline(
  workId: string,
  branchId: string,
  chapterNumber: number,
  input: ChapterOutlineInput,
): Promise<ChapterOutline> {
  return apiRequest<ChapterOutline>(
    `${planningPath(workId, branchId)}/chapter-outlines/${chapterNumber}`,
    {
      method: 'PUT',
      body: JSON.stringify(input),
    },
  );
}
