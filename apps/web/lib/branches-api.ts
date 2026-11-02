import {
  PARALLEL_VERSION_KIND_LABELS,
  PARALLEL_VERSION_STATUS_LABELS,
  type ParallelVersionKind,
  type ParallelVersionStatus,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

export type ParallelVersion = {
  id: string;
  workId: string;
  name: string;
  isMain: boolean;
  parentBranchId: string | null;
  parentBranchName: string | null;
  kind: ParallelVersionKind;
  kindLabel: string;
  reason: string;
  status: ParallelVersionStatus;
  statusLabel: string;
  forkPoint: {
    kind: 'current' | 'chapter_version';
    chapterNumber: number | null;
    chapterVersionId: string | null;
    chapterTitle: string;
    label: string;
  };
  createdAt: string;
};

export type VersionPoint = {
  id: string;
  kind: 'current' | 'chapter_version';
  chapterId: string | null;
  chapterNumber: number | null;
  chapterTitle: string;
  chapterVersionId: string | null;
  version: number | null;
  sourceLabel: string;
  label: string;
};

export type CompareField = {
  field: string;
  label: string;
  before: unknown;
  after: unknown;
};

export type CompareItem = {
  id: string;
  comparedId: string | null;
  label: string;
  status: 'changed' | 'only_source' | 'only_compared' | 'same';
  conflict: boolean;
  fields: CompareField[];
};

export type CompareResult = {
  sourceBranch: { id: string; name: string };
  comparedBranch: { id: string; name: string };
  settings: CompareItem[];
  outlines: CompareItem[];
  chapters: CompareItem[];
  summary: {
    settingsChanged: number;
    outlinesChanged: number;
    chaptersChanged: number;
    conflicts: number;
  };
};

export type CherryPickResult = {
  items: Array<{
    type: 'chapter' | 'setting' | 'outline';
    id: string;
    targetId: string | null;
    label: string;
    status: 'applied' | 'pending' | 'skipped';
    message: string;
    changeRequestId: string | null;
  }>;
  summary: {
    applied: number;
    pending: number;
    skipped: number;
  };
};

function branchesPath(workId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches`;
}

export function loadBranches(workId: string): Promise<{ items: ParallelVersion[] }> {
  return apiRequest<{ items: ParallelVersion[] }>(branchesPath(workId));
}

export function loadVersionPoints(
  workId: string,
  branchId: string,
): Promise<{ items: VersionPoint[] }> {
  return apiRequest<{ items: VersionPoint[] }>(
    `${branchesPath(workId)}/${encodeURIComponent(branchId)}/version-points`,
  );
}

export function createParallelVersion(
  workId: string,
  input: {
    sourceBranchId: string;
    versionPointId: string;
    name: string;
    reason: string;
    kind: ParallelVersionKind;
  },
): Promise<ParallelVersion> {
  return apiRequest<ParallelVersion>(branchesPath(workId), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function compareParallelVersion(
  workId: string,
  branchId: string,
  withBranchId: string,
): Promise<CompareResult> {
  return apiRequest<CompareResult>(
    `${branchesPath(workId)}/${encodeURIComponent(branchId)}/compare`,
    {
      method: 'POST',
      body: JSON.stringify({ withBranchId }),
    },
  );
}

export function cherryPickParallelVersion(
  workId: string,
  branchId: string,
  targetBranchId: string,
  items: Array<{ type: 'chapter' | 'setting' | 'outline'; id: string }>,
): Promise<CherryPickResult> {
  return apiRequest<CherryPickResult>(
    `${branchesPath(workId)}/${encodeURIComponent(branchId)}/cherry-pick`,
    {
      method: 'POST',
      body: JSON.stringify({ targetBranchId, items }),
    },
  );
}

export { PARALLEL_VERSION_KIND_LABELS, PARALLEL_VERSION_STATUS_LABELS };
