import type { VersionKind } from '@novel/contracts';
import { apiRequest } from './auth-api';

export type VersionBranch = {
  id: string;
  name: string;
  isMain: boolean;
  parentBranchId: string | null;
  parentBranchName: string | null;
  kindLabel: string;
  reason: string;
  statusLabel: string;
  forkPointLabel: string;
  createdAt: string;
};

export type GraphNode = {
  id: string;
  type: 'branch' | 'version';
  kind: VersionKind | 'branch';
  kindLabel: string;
  branchId: string;
  branchName: string;
  title: string;
  reason: string;
  parentId: string | null;
  chapterVersionId: string | null;
  chapterNumber: number | null;
  chapterVersion: number | null;
  changeRequestId: string | null;
  targetVersionId: string | null;
  sourceBranchId: string | null;
  createdAt: string;
  isCurrent: boolean;
};

export type VersionGraph = {
  workId: string;
  branchId: string;
  branches: VersionBranch[];
  nodes: GraphNode[];
  edges: Array<{
    id: string;
    from: string;
    to: string;
    kind: 'sequence' | 'fork' | 'rollback' | 'merge';
  }>;
  summary: {
    branchCount: number;
    versionCount: number;
    mergeCount: number;
  };
};

export type AuditItem = {
  id: string;
  action: string;
  actionLabel: string;
  targetType: string;
  targetId: string | null;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  actorName: string;
  createdAt: string;
};

function basePath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function loadVersionGraph(workId: string, branchId: string): Promise<VersionGraph> {
  return apiRequest<VersionGraph>(`${basePath(workId, branchId)}/versions`);
}

export function rollbackVersion(
  workId: string,
  branchId: string,
  targetVersionId: string,
  reason: string,
): Promise<{ version: GraphNode; graph: VersionGraph }> {
  return apiRequest<{ version: GraphNode; graph: VersionGraph }>(
    `${basePath(workId, branchId)}/rollback`,
    {
      method: 'POST',
      body: JSON.stringify({ targetVersionId, reason }),
    },
  );
}

export function searchAudit(
  workId: string,
  branchId: string,
  query: string,
): Promise<{ items: AuditItem[] }> {
  const params = new URLSearchParams({ q: query, limit: '50' });
  return apiRequest<{ items: AuditItem[] }>(
    `${basePath(workId, branchId)}/audit?${params.toString()}`,
  );
}

export async function exportAudit(workId: string, branchId: string, query: string): Promise<void> {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`${basePath(workId, branchId)}/audit/export?${params.toString()}`, {
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error('导出记录失败，请稍后再试。');
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'novel-brain-history.csv';
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
