import type {
  ExportHistoryItem,
  ExportOptions,
  ExportPreview,
  CreateExportRequest,
  ManuscriptExportFormat,
  ManuscriptExportScope,
  OutlineExportFormat,
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
    format: ManuscriptExportFormat;
    scope: ManuscriptExportScope;
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
    format: ManuscriptExportFormat;
    scope: ManuscriptExportScope;
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

export function exportOutline(
  workId: string,
  branchId: string,
  format: OutlineExportFormat,
): Promise<ExportHistoryItem> {
  return apiRequest<ExportHistoryItem>(`${exportsPath(workId, branchId)}/outline`, {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
}

export function exportHistoricalVersion(
  workId: string,
  branchId: string,
  versionCommitId: string,
): Promise<ExportHistoryItem> {
  return apiRequest<ExportHistoryItem>(`${exportsPath(workId, branchId)}/version`, {
    method: 'POST',
    body: JSON.stringify({ versionCommitId }),
  });
}
