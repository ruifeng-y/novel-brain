import type { WorkSearchResult } from '@novel/contracts';
import { apiRequest } from './auth-api';

export function searchWork(
  workId: string,
  branchId: string,
  query: string,
  limit = 20,
): Promise<WorkSearchResult> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  return apiRequest<WorkSearchResult>(
    `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(
      branchId,
    )}/search?${params.toString()}`,
  );
}
