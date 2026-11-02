import type {
  ExportHistoryItem,
  ExportOptions,
  ExportPreview,
  ExportScope,
  CreateExportRequest,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

function exportsPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(
    branchId,
  )}/exports`;
}

export function loadExports(
  workId: string,
  branchId: string,
): Promise<{ items: ExportHistoryItem[] }> {
  return apiRequest<{ items: ExportHistoryItem[] }>(exportsPath(workId, branchId));
}

export function previewExport(
  workId: string,
  branchId: string,
  input: {
    format: CreateExportRequest['format'];
    scope: ExportScope;
    options: ExportOptions;
    previewChapterCount?: number;
  },
): Promise<ExportPreview> {
  return apiRequest<ExportPreview>(`${exportsPath(workId, branchId)}/preview`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function createExport(
  workId: string,
  branchId: string,
  input: {
    format: CreateExportRequest['format'];
    scope: ExportScope;
    options: ExportOptions;
  },
): Promise<ExportHistoryItem> {
  return apiRequest<ExportHistoryItem>(exportsPath(workId, branchId), {
    method: 'POST',
    body: JSON.stringify(input satisfies CreateExportRequest),
  });
}

export function loadExport(
  workId: string,
  branchId: string,
  exportId: string,
): Promise<ExportHistoryItem> {
  return apiRequest<ExportHistoryItem>(
    `${exportsPath(workId, branchId)}/${encodeURIComponent(exportId)}`,
  );
}
