import {
  CHANGE_CLASSIFICATION_LABELS,
  CHANGE_REQUEST_STATUS_LABELS,
  CHANGE_RISK_LABELS,
  CHANGE_SOURCE_LABELS,
  CHANGE_TARGET_TYPE_LABELS,
  type ChangeClassification,
  type ChangeRequestStatus,
  type ChangeRisk,
  type ChangeSource,
  type ChangeTargetType,
} from '@novel/contracts';
import { apiRequest } from './auth-api';

export type ChangeAffectedItem = {
  id: string;
  title: string;
  detail: string;
  status?: string;
  chapterNumber?: number | null;
};

export type ChangeAffected = {
  entities: ChangeAffectedItem[];
  facts: ChangeAffectedItem[];
  chapters: ChangeAffectedItem[];
  outlines: ChangeAffectedItem[];
  plotLines: ChangeAffectedItem[];
  knowledge: ChangeAffectedItem[];
  maps: ChangeAffectedItem[];
  factions: ChangeAffectedItem[];
  powerItems: ChangeAffectedItem[];
  timeline: ChangeAffectedItem[];
};

export type ChangeCheck = {
  id: string;
  step: 'structure' | 'hard_rules' | 'fact_diff' | 'knowledge_pov' | 'narrative' | 'downstream';
  label: string;
  status: 'passed' | 'warning' | 'conflict';
  statusLabel: string;
  summary: string;
  suggestion: string;
  confidence: number;
  ignored: boolean;
  ignoredReason: string | null;
};

export type ChangeImpact = {
  id: string;
  classification: ChangeClassification;
  classificationLabel: string;
  confidence: number;
  summary: string;
  suggestions: string[];
  affected: ChangeAffected;
  checks: ChangeCheck[];
};

export type ChangeRequest = {
  id: string;
  workId: string;
  branchId: string;
  targetType: ChangeTargetType;
  targetTypeLabel: string;
  targetId: string | null;
  targetLabel: string;
  title: string;
  reason: string;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  diff: Array<{ field: string; before: unknown; after: unknown }>;
  source: ChangeSource;
  sourceLabel: string;
  risk: ChangeRisk;
  riskLabel: string;
  status: ChangeRequestStatus;
  statusLabel: string;
  branchedBranchId: string | null;
  decisionReason: string | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
  impact: ChangeImpact | null;
};

export type ChangeTarget = {
  type: ChangeTargetType;
  typeLabel: string;
  id: string | null;
  label: string;
  detail: string;
  status: string;
};

export type CreateChangeInput = {
  title: string;
  reason: string;
  targetType: ChangeTargetType;
  targetId: string | null;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  source: ChangeSource;
  risk: ChangeRisk;
};

function changesPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}/changes`;
}

export function loadChangeTargets(
  workId: string,
  branchId: string,
): Promise<{ items: ChangeTarget[] }> {
  return apiRequest<{ items: ChangeTarget[] }>(`${changesPath(workId, branchId)}/targets`);
}

export function loadChanges(workId: string, branchId: string): Promise<{ items: ChangeRequest[] }> {
  return apiRequest<{ items: ChangeRequest[] }>(changesPath(workId, branchId));
}

export function loadChange(
  workId: string,
  branchId: string,
  changeId: string,
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(
    `${changesPath(workId, branchId)}/${encodeURIComponent(changeId)}`,
  );
}

export function createChange(
  workId: string,
  branchId: string,
  input: CreateChangeInput,
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(changesPath(workId, branchId), {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function analyzeChange(
  workId: string,
  branchId: string,
  changeId: string,
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(
    `${changesPath(workId, branchId)}/${encodeURIComponent(changeId)}/analyze`,
    { method: 'POST' },
  );
}

export function applyChange(
  workId: string,
  branchId: string,
  changeId: string,
  input: { mode: 'apply' | 'repair'; repairNotes?: string },
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(
    `${changesPath(workId, branchId)}/${encodeURIComponent(changeId)}/apply`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function branchChange(
  workId: string,
  branchId: string,
  changeId: string,
  name: string,
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(
    `${changesPath(workId, branchId)}/${encodeURIComponent(changeId)}/branch`,
    {
      method: 'POST',
      body: JSON.stringify({ name }),
    },
  );
}

export function cancelChange(
  workId: string,
  branchId: string,
  changeId: string,
  reason?: string,
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(
    `${changesPath(workId, branchId)}/${encodeURIComponent(changeId)}/cancel`,
    {
      method: 'POST',
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );
}

export function ignoreFalsePositive(
  workId: string,
  branchId: string,
  changeId: string,
  validationId: string,
  reason: string,
): Promise<ChangeRequest> {
  return apiRequest<ChangeRequest>(
    `${changesPath(workId, branchId)}/${encodeURIComponent(changeId)}/false-positive`,
    {
      method: 'POST',
      body: JSON.stringify({ validationId, reason }),
    },
  );
}

export const CHANGE_TARGET_LABELS = CHANGE_TARGET_TYPE_LABELS;
export const CHANGE_SOURCE_OPTIONS = Object.entries(CHANGE_SOURCE_LABELS) as Array<
  [ChangeSource, string]
>;
export const CHANGE_RISK_OPTIONS = Object.entries(CHANGE_RISK_LABELS) as Array<
  [ChangeRisk, string]
>;
export const CHANGE_STATUS_LABELS = CHANGE_REQUEST_STATUS_LABELS;
export const CHANGE_CLASSIFICATION_LABELS_EXPORT = CHANGE_CLASSIFICATION_LABELS;
