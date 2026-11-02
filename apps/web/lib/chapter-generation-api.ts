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
  summary: string;
  hook: string;
  content: string;
  outline: ChapterOutline;
  currentVersion: ChapterVersion | null;
  latestDraft: ChapterDraft | null;
  autosave: {
    content: string;
    wordCount: number;
    updatedAt: string;
  } | null;
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
  action: WritingAction;
  outputKind: WritingOutputKind;
  status: 'queued';
};

export type WritingQualityTier = 'fast' | 'standard' | 'premium';
export type WritingAction =
  | 'chapter'
  | 'continue'
  | 'rewrite'
  | 'expand'
  | 'condense'
  | 'change_pov'
  | 'hooks'
  | 'title'
  | 'summary';
export type WritingOutputKind =
  | 'chapter'
  | 'segment'
  | 'hook_options'
  | 'title'
  | 'summary';

export type WritingRequest = {
  instruction?: string;
  qualityTier?: WritingQualityTier;
  modelConfigId?: string;
  targetMinCharacters?: number;
  targetMaxCharacters?: number;
  pov?: string;
  targetPov?: string;
  mustInclude?: string[];
  mustAvoid?: string[];
  referenceChapters?: number[];
  tabooWords?: string[];
  content?: string;
  selection?: string;
  selectionStart?: number;
  selectionEnd?: number;
  cursorOffset?: number;
};

export type GenerationJob = {
  id: string;
  generationRequestId: string | null;
  chapterNumber: number;
  action: WritingAction;
  outputKind: WritingOutputKind;
  settings: Record<string, unknown>;
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

export type FactType = 'event' | 'body_state' | 'character_knowledge';
export type FactProposalStatus = 'proposed' | 'confirmed' | 'rejected';
export type ContinuityIssueStatus = 'open' | 'ignored';

export type FactProposal = {
  id: string;
  chapterNumber: number;
  type: FactType;
  typeLabel: string;
  statement: string;
  sourceSentence: string;
  status: FactProposalStatus;
  createdAt: string;
  updatedAt: string;
};

export type ConfirmFactProposalResult = {
  proposal: FactProposal;
  fact: {
    id: string;
    chapterNumber: number;
    type: FactType;
    typeLabel: string;
    statement: string;
    sourceSentence: string;
    confirmedAt: string;
  };
  canonCommit: {
    id: string;
    snapshotId: string;
    createdAt: string;
  } | null;
};

export type ContinuityIssue = {
  id: string;
  category: string;
  categoryLabel: string;
  severity: string;
  severityLabel: string;
  message: string;
  suggestion: string;
  sourceSentence: string;
  startOffset: number;
  endOffset: number;
  status: ContinuityIssueStatus;
  statusLabel: string;
  ignoredReason: string | null;
  ignoredAt: string | null;
  confirmedFact: {
    id: string;
    statement: string;
    chapterNumber: number;
    typeLabel: string;
  } | null;
  createdAt: string;
};

export type WritingInsights = {
  suggestions: ContinuityIssue[];
  continuity: ContinuityIssue[];
  qualityReport: ChapterQualityReport | null;
  foreshadows: Array<{
    id: string;
    title: string;
    description: string;
    setupChapter: number | null;
    plannedPayoffChapter: number | null;
    importanceLabel: string;
  }>;
  characters: Array<{
    id: string;
    name: string;
    body: string;
    power: string;
    location: string;
    possessions: string;
    disguise: string;
    knowledgeCount: number;
    updatedAt: string;
  }>;
};

export type ChapterQualityDimensionKey =
  | 'hook'
  | 'pacing'
  | 'information_density'
  | 'character_voice'
  | 'prose'
  | 'continuity';

export type ChapterQualityDimension = {
  key: ChapterQualityDimensionKey;
  label: string;
  status: 'good' | 'watch' | 'weak';
  statusLabel: string;
  summary: string;
  suggestion: string;
};

export type ChapterQualityReport = {
  chapterNumber: number;
  generatedAt: string;
  summary: string;
  dimensions: ChapterQualityDimension[];
  issueCounts: Record<string, number>;
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
  return startChapterAction(workId, branchId, chapterNumber, 'chapter', {
    ...(instruction?.trim() ? { instruction: instruction.trim() } : {}),
  });
}

export function startChapterAction(
  workId: string,
  branchId: string,
  chapterNumber: number,
  action: WritingAction,
  input: WritingRequest,
): Promise<GenerationStart> {
  const path = action === 'chapter' ? 'generate' : action.replace('_', '-');
  return apiRequest<GenerationStart>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/${path}`,
    {
      method: 'POST',
      body: JSON.stringify(input),
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

export function saveChapterAutosave(
  workId: string,
  branchId: string,
  chapterNumber: number,
  content: string,
): Promise<{ content: string; wordCount: number; updatedAt: string }> {
  return apiRequest<{ content: string; wordCount: number; updatedAt: string }>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/autosave`,
    {
      method: 'PUT',
      body: JSON.stringify({ content }),
    },
  );
}

export function updateChapterMetadata(
  workId: string,
  branchId: string,
  chapterNumber: number,
  input: { title?: string; summary?: string; hook?: string },
): Promise<{
  chapterNumber: number;
  title: string;
  summary: string;
  hook: string;
  status: ChapterStatus;
  statusLabel: string;
}> {
  return apiRequest(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

export function restoreChapterVersion(
  workId: string,
  branchId: string,
  chapterNumber: number,
  versionId: string,
): Promise<ChapterVersion> {
  return apiRequest<ChapterVersion>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/versions/${versionId}/restore`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export function loadFactProposals(
  workId: string,
  branchId: string,
  chapterNumber: number,
): Promise<{ items: FactProposal[] }> {
  return apiRequest<{ items: FactProposal[] }>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/fact-proposals`,
  );
}

export function updateFactProposal(
  workId: string,
  branchId: string,
  chapterNumber: number,
  proposalId: string,
  statement: string,
): Promise<FactProposal> {
  return apiRequest<FactProposal>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/fact-proposals/${proposalId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ statement }),
    },
  );
}

export function confirmFactProposal(
  workId: string,
  branchId: string,
  chapterNumber: number,
  proposalId: string,
  statement: string,
): Promise<ConfirmFactProposalResult> {
  return apiRequest<ConfirmFactProposalResult>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/fact-proposals/${proposalId}/confirm`,
    {
      method: 'POST',
      body: JSON.stringify({ statement }),
    },
  );
}

export function rejectFactProposal(
  workId: string,
  branchId: string,
  chapterNumber: number,
  proposalId: string,
): Promise<FactProposal> {
  return apiRequest<FactProposal>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/fact-proposals/${proposalId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    },
  );
}

export function loadContinuityIssues(
  workId: string,
  branchId: string,
  chapterNumber: number,
): Promise<{ items: ContinuityIssue[] }> {
  return apiRequest<{ items: ContinuityIssue[] }>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/annotations`,
  );
}

export function loadWritingInsights(
  workId: string,
  branchId: string,
  chapterNumber: number,
): Promise<WritingInsights> {
  return apiRequest<WritingInsights>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/insights`,
  );
}

export function loadChapterQuality(
  workId: string,
  branchId: string,
  chapterNumber: number,
): Promise<ChapterQualityReport | null> {
  return apiRequest<ChapterQualityReport | null>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/quality`,
  );
}

export function ignoreContinuityIssue(
  workId: string,
  branchId: string,
  chapterNumber: number,
  issueId: string,
  reason: string,
): Promise<ContinuityIssue> {
  return apiRequest<ContinuityIssue>(
    `${generationPath(workId, branchId)}/chapters/${chapterNumber}/annotations/${issueId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
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
