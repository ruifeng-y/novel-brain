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

export type OutlineLevel = 'book' | 'volume' | 'act' | 'chapter' | 'scene';

export type OutlineNode = {
  id: string;
  workId: string;
  branchId: string;
  level: OutlineLevel;
  levelLabel: string;
  parentId: string | null;
  orderIndex: number;
  title: string;
  summary: string;
  details: string;
  chapterNumber: number | null;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  locked: boolean;
  lockedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OutlineNodeInput = {
  level: OutlineLevel;
  parentId?: string | null;
  title: string;
  summary: string;
  details: string;
  chapterGoal?: string;
  pov?: string;
  sceneBeats?: string[];
  chapterEndHook?: string;
};

export type OutlineNodeUpdate = Partial<Omit<OutlineNodeInput, 'level'>> & {
  confirmLockedChange?: boolean;
  changeReason?: string;
};

export type OutlineReadinessCheck = {
  ready: boolean;
  label: string;
  detail: string;
  missing: string[];
};

export type OutlineReadiness = {
  ready: boolean;
  checks: {
    outline: OutlineReadinessCheck;
    settings: OutlineReadinessCheck;
    confirmedFacts: OutlineReadinessCheck;
    modelKey: OutlineReadinessCheck;
  };
};

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

export function loadOutlineNodes(
  workId: string,
  branchId: string,
): Promise<{ items: OutlineNode[] }> {
  return apiRequest<{ items: OutlineNode[] }>(`${planningPath(workId, branchId)}/outlines`);
}

export function createOutlineNode(
  workId: string,
  branchId: string,
  input: OutlineNodeInput,
): Promise<OutlineNode> {
  return apiRequest<OutlineNode>(`${planningPath(workId, branchId)}/outlines`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateOutlineNode(
  workId: string,
  branchId: string,
  outlineId: string,
  input: OutlineNodeUpdate,
): Promise<OutlineNode> {
  return apiRequest<OutlineNode>(`${planningPath(workId, branchId)}/outlines/${outlineId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteOutlineNode(
  workId: string,
  branchId: string,
  outlineId: string,
  input?: { confirmLockedChange?: boolean; changeReason?: string },
): Promise<void> {
  return apiRequest<void>(`${planningPath(workId, branchId)}/outlines/${outlineId}`, {
    method: 'DELETE',
    ...(input ? { body: JSON.stringify(input) } : {}),
  });
}

export function lockOutlineNode(
  workId: string,
  branchId: string,
  outlineId: string,
): Promise<OutlineNode> {
  return apiRequest<OutlineNode>(`${planningPath(workId, branchId)}/outlines/${outlineId}/lock`, {
    method: 'POST',
  });
}

export function unlockOutlineNode(
  workId: string,
  branchId: string,
  outlineId: string,
): Promise<OutlineNode> {
  return apiRequest<OutlineNode>(`${planningPath(workId, branchId)}/outlines/${outlineId}/unlock`, {
    method: 'POST',
  });
}

export function reorderOutlineNodes(
  workId: string,
  branchId: string,
  parentId: string | null,
  orderedIds: string[],
  input?: { confirmLockedChange?: boolean; changeReason?: string },
): Promise<{ items: OutlineNode[] }> {
  return apiRequest<{ items: OutlineNode[] }>(
    `${planningPath(workId, branchId)}/outlines/reorder`,
    {
      method: 'POST',
      body: JSON.stringify({ parentId, orderedIds, ...(input ?? {}) }),
    },
  );
}

export function regenerateOutlineNode(
  workId: string,
  branchId: string,
  outlineId: string,
  input: { instruction?: string; confirmLockedChange?: boolean; changeReason?: string },
): Promise<OutlineNode> {
  return apiRequest<OutlineNode>(
    `${planningPath(workId, branchId)}/outlines/${outlineId}/regenerate`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function loadOutlineReadiness(
  workId: string,
  branchId: string,
  chapterNumber?: number,
): Promise<OutlineReadiness> {
  const query = chapterNumber === undefined ? '' : `?chapterNumber=${chapterNumber}`;
  return apiRequest<OutlineReadiness>(
    `${planningPath(workId, branchId)}/outline/readiness${query}`,
  );
}
