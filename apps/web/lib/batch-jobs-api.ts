import { apiRequest } from './auth-api';

export type BatchJobStatus =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'paused';

export type BatchChapterStatus =
  'pending' | 'running' | 'waiting_review' | 'completed' | 'failed' | 'canceled';

export type BatchReviewStatus =
  | 'pending'
  | 'approved'
  | 'sent_to_desk'
  | 'sent_to_parallel'
  | 'rejected'
  | 'ignored';

export type BatchApprovalMode = 'chapter' | 'volume' | 'auto';

export type BatchScope =
  | { type: 'chapter'; chapterNumber: number }
  | { type: 'volume'; volumeId: string }
  | { type: 'range'; startChapter: number; endChapter: number }
  | { type: 'book' };

export type BatchChapterOption = {
  chapterNumber: number;
  title: string;
};

export type BatchJobSummary = {
  id: string;
  status: BatchJobStatus;
  statusLabel: string;
  progress: number;
  scope: BatchScope | null;
  chapterNumbers: number[];
  completedChapterCount: number;
  failedChapterCount: number;
  waitingReviewChapterCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type BatchJobItem = {
  id: string;
  jobId: string;
  chapterNumber: number;
  chapterTitle?: string;
  status: BatchChapterStatus;
  statusLabel: string;
  reviewStatus: BatchReviewStatus;
  reviewStatusLabel: string;
  generationJobId: string | null;
  draftId: string | null;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  error: Record<string, unknown> | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

export type BatchJobDetail = BatchJobSummary & {
  payload: {
    scope?: BatchScope;
    chapterNumbers?: number[];
    settings?: Record<string, unknown>;
  };
  error: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  items: BatchJobItem[];
};

export type ReviewQueueItem = BatchJobItem & {
  jobStatus: BatchJobStatus;
  jobStatusLabel: string;
  volumeTitle: string | null;
  isVolumeEnd: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  riskLabel: string;
  riskReasons: string[];
  draftPreview: string;
  quality: {
    summary: string;
    issueCounts: Record<string, number>;
    watchDimensions: Array<{
      label: string;
      summary: string;
      suggestion: string;
    }>;
  } | null;
  continuityIssues: Array<{
    id: string;
    severity: string;
    category: string;
    message: string;
    suggestion: string;
    status: 'open' | 'ignored';
  }>;
};

export type BatchJobReport = {
  jobId: string;
  generatedAt: string;
  totalChapters: number;
  completedChapterNumbers: number[];
  failedChapters: Array<{ chapterNumber: number; message: string }>;
  canceledChapterNumbers: number[];
  waitingReviewChapterNumbers: number[];
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  continuity: {
    issueCount: number;
    openIssueCount: number;
    ignoredIssueCount: number;
    chaptersWithIssues: number;
    summary: string;
  };
  quality: {
    averageScore: number;
    summary: string;
    dimensions: Array<{
      key: string;
      label: string;
      score: number;
      status: 'good' | 'watch' | 'weak';
    }>;
  };
  foreshadows: {
    totalOpen: number;
    items: Array<{
      title: string;
      importance: 'must' | 'optional';
      plannedPayoffChapter: number | null;
      overdue: boolean;
    }>;
  };
  nextActions: string[];
};

export type CreateBatchJobInput = {
  scope: BatchScope;
  settings: {
    qualityTier: 'fast' | 'standard' | 'premium';
    approvalMode: BatchApprovalMode;
    targetMinCharacters: number;
    targetMaxCharacters: number;
  };
};

export type BatchReviewDecision =
  | { action: 'approve' }
  | { action: 'send_to_desk' }
  | { action: 'send_to_parallel' }
  | { action: 'reject' }
  | { action: 'ignore'; reason: string };

export type BatchJobEstimate = {
  chapterNumbers: number[];
  chapterCount: number;
  estimatedPromptTokens: number;
  estimatedCompletionTokens: number;
  estimatedTotalTokens: number;
  estimatedCost: number;
  estimatedMinutes: number;
};

function jobsPath(workId: string, branchId: string): string {
  return `/api/v1/works/${encodeURIComponent(workId)}/branches/${encodeURIComponent(branchId)}`;
}

export function chapterOptionsFromOutlines(
  outlines: Array<{
    level: string;
    chapterNumber: number | null;
    title: string;
  }>,
): BatchChapterOption[] {
  return outlines
    .filter(
      (outline): outline is { level: string; chapterNumber: number; title: string } =>
        outline.level === 'chapter' &&
        outline.chapterNumber !== null &&
        Number.isInteger(outline.chapterNumber),
    )
    .map((outline) => ({
      chapterNumber: outline.chapterNumber,
      title: outline.title.trim() || `第 ${outline.chapterNumber} 章`,
    }))
    .sort((left, right) => left.chapterNumber - right.chapterNumber);
}

export function loadBatchJobs(
  workId: string,
  branchId: string,
): Promise<{ items: BatchJobSummary[] }> {
  return apiRequest<{ items: BatchJobSummary[] }>(`${jobsPath(workId, branchId)}/jobs`);
}

export function loadBatchJob(
  workId: string,
  branchId: string,
  jobId: string,
): Promise<BatchJobDetail> {
  return apiRequest<BatchJobDetail>(`${jobsPath(workId, branchId)}/jobs/${jobId}`);
}

export function createBatchJob(
  workId: string,
  branchId: string,
  input: CreateBatchJobInput,
): Promise<BatchJobDetail> {
  return apiRequest<BatchJobDetail>(`${jobsPath(workId, branchId)}/jobs`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function estimateBatchJob(
  workId: string,
  branchId: string,
  input: CreateBatchJobInput,
): Promise<BatchJobEstimate> {
  return apiRequest<BatchJobEstimate>(`${jobsPath(workId, branchId)}/jobs/estimate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function controlBatchJob(
  workId: string,
  branchId: string,
  jobId: string,
  action: 'pause' | 'resume' | 'cancel' | 'retry',
): Promise<BatchJobDetail> {
  return apiRequest<BatchJobDetail>(`${jobsPath(workId, branchId)}/jobs/${jobId}/${action}`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function loadReviewQueue(
  workId: string,
  branchId: string,
): Promise<{ items: ReviewQueueItem[] }> {
  return apiRequest<{ items: ReviewQueueItem[] }>(`${jobsPath(workId, branchId)}/review-queue`);
}

export function decideReviewItem(
  workId: string,
  branchId: string,
  jobId: string,
  itemId: string,
  decision: BatchReviewDecision,
): Promise<BatchJobItem> {
  return apiRequest<BatchJobItem>(`${jobsPath(workId, branchId)}/jobs/${jobId}/review/${itemId}`, {
    method: 'POST',
    body: JSON.stringify(decision),
  });
}

export function loadBatchReport(
  workId: string,
  branchId: string,
  jobId: string,
): Promise<BatchJobReport> {
  return apiRequest<BatchJobReport>(`${jobsPath(workId, branchId)}/jobs/${jobId}/report`);
}
