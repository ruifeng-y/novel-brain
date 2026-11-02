import type {
  AccountAuditAction,
  AccountAuditItem,
  AccountExportJob,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

export type AccountAuditQuery = {
  q?: string;
  action?: AccountAuditAction;
  limit?: number;
};

export function loadAccountAudit(
  input: AccountAuditQuery,
): Promise<{ items: AccountAuditItem[] }> {
  const params = new URLSearchParams();
  if (input.q?.trim()) {
    params.set('q', input.q.trim());
  }
  if (input.action) {
    params.set('action', input.action);
  }
  params.set('limit', String(input.limit ?? 50));
  return apiRequest<{ items: AccountAuditItem[] }>(
    `/api/v1/users/me/audit?${params.toString()}`,
  );
}

export function accountAuditExportUrl(input: AccountAuditQuery): string {
  const params = new URLSearchParams();
  if (input.q?.trim()) {
    params.set('q', input.q.trim());
  }
  if (input.action) {
    params.set('action', input.action);
  }
  return `/api/v1/users/me/audit/export?${params.toString()}`;
}

export function startAccountExport(): Promise<AccountExportJob> {
  return apiRequest<AccountExportJob>('/api/v1/users/me/export', {
    method: 'POST',
  });
}

export function loadAccountExports(): Promise<{ items: AccountExportJob[] }> {
  return apiRequest<{ items: AccountExportJob[] }>('/api/v1/users/me/export');
}

export function loadAccountExport(exportId: string): Promise<AccountExportJob> {
  return apiRequest<AccountExportJob>(
    `/api/v1/users/me/export/${encodeURIComponent(exportId)}`,
  );
}
