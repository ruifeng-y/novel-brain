import { apiRequest } from './auth-api';

export type StoryThreadType = 'main' | 'sub' | 'character' | 'faction' | 'mystery' | 'romance';

export type StoryThreadStatus = 'active' | 'resolved' | 'abandoned';
export type StoryForeshadowStatus = 'planted' | 'paid_off' | 'abandoned';
export type StoryForeshadowImportance = 'must' | 'optional';
export type StoryArcStatus = 'active' | 'completed' | 'abandoned';

export type StoryThreadMilestone = {
  chapterNumber: number;
  description: string;
};

export type StoryThreadTensionPoint = {
  chapterNumber: number;
  tension: number;
};

export type StoryThread = {
  id: string;
  workId: string;
  branchId: string;
  name: string;
  type: StoryThreadType;
  typeLabel: string;
  summary: string;
  stakes: string;
  participantIds: string[];
  participants: Array<{ id: string; name: string }>;
  plannedPayoffChapter: number | null;
  status: StoryThreadStatus;
  statusLabel: string;
  milestones: StoryThreadMilestone[];
  tensionCurve: StoryThreadTensionPoint[];
  createdAt: string;
  updatedAt: string;
};

export type Foreshadow = {
  id: string;
  workId: string;
  branchId: string;
  title: string;
  description: string;
  plantChapter: number | null;
  plannedPayoffChapter: number | null;
  importance: StoryForeshadowImportance;
  importanceLabel: string;
  status: StoryForeshadowStatus;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type CharacterArc = {
  id: string;
  workId: string;
  branchId: string;
  characterId: string;
  character: { id: string; name: string };
  startState: string;
  desire: string;
  fear: string;
  lie: string;
  truth: string;
  turn: string;
  endState: string;
  status: StoryArcStatus;
  statusLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type StoryLedgerCheck = {
  id: string;
  kind: 'overdue_foreshadow' | 'unclosed_thread' | 'motivation_break';
  kindLabel: string;
  severity: 'warning';
  severityLabel: string;
  title: string;
  detail: string;
  targetType: 'foreshadow' | 'thread' | 'character';
  targetId: string;
  chapterNumber: number | null;
};

export type StoryLedgerChecks = {
  writtenThroughChapter: number | null;
  items: StoryLedgerCheck[];
  summary: {
    overdueForeshadows: number;
    unclosedThreads: number;
    motivationBreaks: number;
  };
};

export type StoryLedger = {
  threads: StoryThread[];
  foreshadows: Foreshadow[];
  characterArcs: CharacterArc[];
  characters: Array<{ id: string; name: string }>;
  checks: StoryLedgerChecks;
};

export type StoryThreadInput = {
  name: string;
  type: StoryThreadType;
  summary: string;
  stakes: string;
  participantIds: string[];
  plannedPayoffChapter: number | null;
  status: StoryThreadStatus;
  milestones: StoryThreadMilestone[];
  tensionCurve: StoryThreadTensionPoint[];
};

export type ForeshadowInput = {
  title: string;
  description: string;
  plantChapter: number | null;
  plannedPayoffChapter: number | null;
  importance: StoryForeshadowImportance;
  status: StoryForeshadowStatus;
};

export type CharacterArcInput = {
  characterId: string;
  startState: string;
  desire: string;
  fear: string;
  lie: string;
  truth: string;
  turn: string;
  endState: string;
  status: StoryArcStatus;
};

function ledgerPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function loadStoryLedger(workId: string, branchId: string): Promise<StoryLedger> {
  return apiRequest<StoryLedger>(`${ledgerPath(workId, branchId)}/story-ledger`);
}

export function createStoryThread(
  workId: string,
  branchId: string,
  input: StoryThreadInput,
): Promise<StoryThread> {
  return apiRequest<StoryThread>(`${ledgerPath(workId, branchId)}/threads`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateStoryThread(
  workId: string,
  branchId: string,
  threadId: string,
  input: Partial<StoryThreadInput>,
): Promise<StoryThread> {
  return apiRequest<StoryThread>(`${ledgerPath(workId, branchId)}/threads/${threadId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteStoryThread(
  workId: string,
  branchId: string,
  threadId: string,
): Promise<void> {
  return apiRequest<void>(`${ledgerPath(workId, branchId)}/threads/${threadId}`, {
    method: 'DELETE',
  });
}

export function createForeshadow(
  workId: string,
  branchId: string,
  input: ForeshadowInput,
): Promise<Foreshadow> {
  return apiRequest<Foreshadow>(`${ledgerPath(workId, branchId)}/foreshadows`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateForeshadow(
  workId: string,
  branchId: string,
  foreshadowId: string,
  input: Partial<ForeshadowInput>,
): Promise<Foreshadow> {
  return apiRequest<Foreshadow>(`${ledgerPath(workId, branchId)}/foreshadows/${foreshadowId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function saveCharacterArc(
  workId: string,
  branchId: string,
  input: CharacterArcInput,
): Promise<CharacterArc> {
  return apiRequest<CharacterArc>(`${ledgerPath(workId, branchId)}/character-arcs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCharacterArc(
  workId: string,
  branchId: string,
  arcId: string,
  input: Partial<CharacterArcInput>,
): Promise<CharacterArc> {
  return apiRequest<CharacterArc>(`${ledgerPath(workId, branchId)}/character-arcs/${arcId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
