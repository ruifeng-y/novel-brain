import type {
  ExportFormat,
  PublishCheckResponse,
  PublishReaderPreview,
  PublishSuggestions,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

function publishPath(workId: string, branchId: string, suffix: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(
    branchId,
  )}/publish/${suffix}`;
}

export function generatePublishSuggestions(
  workId: string,
  branchId: string,
): Promise<PublishSuggestions> {
  return apiRequest<PublishSuggestions>(publishPath(workId, branchId, 'suggestions'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function loadPublishPreview(
  workId: string,
  branchId: string,
): Promise<PublishReaderPreview> {
  return apiRequest<PublishReaderPreview>(publishPath(workId, branchId, 'preview'));
}

export function runPublishCheck(
  workId: string,
  branchId: string,
  format: ExportFormat,
): Promise<PublishCheckResponse> {
  return apiRequest<PublishCheckResponse>(publishPath(workId, branchId, 'check'), {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
}
