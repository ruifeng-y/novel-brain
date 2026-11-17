export const REQUIRED_WORKLOAD_OPERATIONS = [
  "overview-read",
  "chapter-read",
  "chapter-history",
  "story-bible-read",
  "entity-detail",
  "timeline-read",
  "branch-head-read",
  "chapter-save",
  "settings-update",
  "canon-submit",
  "title-search",
  "body-search",
  "alias-search",
  "context-compile",
  "index-rebuild",
  "sse-events",
  "export",
  "batch-jobs",
] as const;

export type WorkloadOperationId = (typeof REQUIRED_WORKLOAD_OPERATIONS)[number];

export interface WorkloadOperation {
  id: WorkloadOperationId;
  kind: "read" | "write" | "background" | "stream";
  weight: number;
  description: string;
}

export interface WorkloadProfileInput {
  apiConcurrency: number;
  durationSeconds: number;
  rampSeconds: number;
  workerConcurrency: {
    global: number;
    perWork: number;
    perUser: number;
  };
}

export interface WorkloadProfile {
  version: "capacity-workload-v1";
  apiConcurrency: number;
  durationSeconds: number;
  rampSeconds: number;
  workerConcurrency: {
    global: number;
    perWork: number;
    perUser: number;
  };
  operations: readonly WorkloadOperation[];
  decisionRequired: readonly string[];
}

export function createWorkloadProfile(input: WorkloadProfileInput): WorkloadProfile {
  if (!Number.isSafeInteger(input.apiConcurrency) || input.apiConcurrency <= 0) {
    throw new Error("API_CONCURRENCY_INVALID");
  }
  if (!Number.isSafeInteger(input.durationSeconds) || input.durationSeconds <= 0) {
    throw new Error("DURATION_INVALID");
  }
  if (
    !Number.isSafeInteger(input.rampSeconds) ||
    input.rampSeconds < 0 ||
    input.rampSeconds > input.durationSeconds
  ) {
    throw new Error("RAMP_INVALID");
  }
  validateWorkerConcurrency(input.workerConcurrency);

  return {
    version: "capacity-workload-v1",
    apiConcurrency: input.apiConcurrency,
    durationSeconds: input.durationSeconds,
    rampSeconds: input.rampSeconds,
    workerConcurrency: { ...input.workerConcurrency },
    operations: OPERATIONS,
    decisionRequired: [
      "apiConcurrency",
      "loadDuration",
      "requestErrorRate",
      "saturationThreshold",
      "p99Targets",
      "storageHeadroom",
    ],
  };
}

const OPERATIONS: readonly WorkloadOperation[] = [
  { id: "overview-read", kind: "read", weight: 10, description: "Open work overview" },
  { id: "chapter-read", kind: "read", weight: 20, description: "Open an existing chapter" },
  { id: "chapter-history", kind: "read", weight: 6, description: "Read chapter version history" },
  { id: "story-bible-read", kind: "read", weight: 5, description: "Read the story bible" },
  { id: "entity-detail", kind: "read", weight: 8, description: "Read a setting entity" },
  { id: "timeline-read", kind: "read", weight: 4, description: "Read timeline events" },
  { id: "branch-head-read", kind: "read", weight: 5, description: "Read a parallel branch head" },
  { id: "chapter-save", kind: "write", weight: 8, description: "Save a manuscript revision" },
  { id: "settings-update", kind: "write", weight: 3, description: "Update a structured setting" },
  { id: "canon-submit", kind: "write", weight: 1, description: "Submit a gated canon transition" },
  { id: "title-search", kind: "read", weight: 4, description: "Search chapter titles" },
  { id: "body-search", kind: "read", weight: 6, description: "Search Chinese manuscript text" },
  { id: "alias-search", kind: "read", weight: 3, description: "Search entity aliases" },
  { id: "context-compile", kind: "read", weight: 3, description: "Compile a chapter ContextPack" },
  { id: "index-rebuild", kind: "background", weight: 1, description: "Rebuild search documents" },
  { id: "sse-events", kind: "stream", weight: 1, description: "Consume job SSE events" },
  { id: "export", kind: "background", weight: 1, description: "Create an asynchronous export" },
  { id: "batch-jobs", kind: "background", weight: 1, description: "Run concurrent batch jobs" },
] as const;

function validateWorkerConcurrency(input: WorkloadProfileInput["workerConcurrency"]): void {
  for (const [name, value] of Object.entries(input)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`WORKER_CONCURRENCY_INVALID:${name}`);
    }
  }
  if (input.perWork > input.global || input.perUser > input.global) {
    throw new Error("WORKER_CONCURRENCY_HIERARCHY_INVALID");
  }
}
