import { apiRequest } from './auth-api';

export type HistoryCheckKey =
  | 'anachronism'
  | 'official_hierarchy'
  | 'army_movement'
  | 'provisions'
  | 'geographic_distance';

export type HistoryCheckStatus = 'passed' | 'needs_attention' | 'not_applicable';

export type HistoryCheckSummary = {
  key: HistoryCheckKey;
  label: string;
  status: HistoryCheckStatus;
  issueCount: number;
  summary: string;
};

export type HistoryCheckIssue = {
  category: HistoryCheckKey;
  severity: 'warning';
  message: string;
  suggestion: string;
  sourceText: string;
  entityIds: string[];
};

export type HistoryCheckResult = {
  pack: 'history';
  variant: string;
  variantLabel: string;
  mainTemplate: string;
  checks: HistoryCheckSummary[];
  issues: HistoryCheckIssue[];
};

export function runHistoryChecks(
  workId: string,
  branchId: string,
  input: {
    text: string;
    armyMovement?: {
      armyEntityId: string;
      fromNodeId: string;
      toNodeId: string;
      plannedDays: number;
    };
  },
): Promise<HistoryCheckResult> {
  return apiRequest<HistoryCheckResult>(
    `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}/history/checks`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}
