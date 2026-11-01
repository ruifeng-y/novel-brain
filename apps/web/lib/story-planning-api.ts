import { apiRequest } from './auth-api';

export type StoryBible = {
  id: string | null;
  workId: string;
  branchId: string;
  oneSentenceStory: string;
  protagonist: string;
  worldIronLaw: string;
  createdAt: string | null;
  updatedAt: string | null;
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

export type StoryBibleInput = Pick<StoryBible, 'oneSentenceStory' | 'protagonist' | 'worldIronLaw'>;

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
