export type TargetUnit = "ms" | "hours" | "ratio" | "count" | "bytes" | "label";

export interface ApprovedTarget {
  id: string;
  description: string;
  measurement: ApprovedMeasurementKey;
  target: number;
  unit: TargetUnit;
  direction: "at-most";
}

export type ApprovedMeasurementKey =
  | "interactiveReadP95Ms"
  | "searchP95Ms"
  | "firstTokenMs"
  | "sseDeliveryP95Ms"
  | "measuredRpoHours"
  | "measuredRtoHours";

export interface DecisionRequiredTarget {
  id: string;
  description: string;
  measurement: DecisionMeasurementKey;
}

export type DecisionMeasurementKey =
  | "interactiveReadP99Ms"
  | "apiConcurrency"
  | "apiErrorRate"
  | "storageHeadroomBytes"
  | "backupCapacityIncluded"
  | "restoreDatasetTier"
  | "largeVersionCompareP95Ms"
  | "branchCount";

export interface BenchmarkMeasurements {
  interactiveReadP95Ms?: number | null;
  searchP95Ms?: number | null;
  firstTokenMs?: number | null;
  sseDeliveryP95Ms?: number | null;
  measuredRpoHours?: number | null;
  measuredRtoHours?: number | null;
  interactiveReadP99Ms?: number | null;
  apiConcurrency?: number | null;
  apiErrorRate?: number | null;
  storageHeadroomBytes?: number | null;
  backupCapacityIncluded?: boolean | null;
  restoreDatasetTier?: string | null;
  largeVersionCompareP95Ms?: number | null;
  branchCount?: number | null;
}

export interface TargetResult {
  id: string;
  description: string;
  measured: number | string | boolean | null;
  target: number | null;
  unit: TargetUnit;
  status: "pass" | "fail" | "decision-required";
}

export interface TargetComparison {
  approved: TargetResult[];
  decisionRequired: TargetResult[];
}

export const APPROVED_TARGETS: readonly ApprovedTarget[] = [
  {
    id: "crud-p95",
    description: "Interactive CRUD p95",
    measurement: "interactiveReadP95Ms",
    target: 300,
    unit: "ms",
    direction: "at-most",
  },
  {
    id: "search-p95",
    description: "Search p95",
    measurement: "searchP95Ms",
    target: 1_000,
    unit: "ms",
    direction: "at-most",
  },
  {
    id: "first-token",
    description: "Streaming first token",
    measurement: "firstTokenMs",
    target: 5_000,
    unit: "ms",
    direction: "at-most",
  },
  {
    id: "sse-delivery-p95",
    description: "SSE delivery p95",
    measurement: "sseDeliveryP95Ms",
    target: 1_000,
    unit: "ms",
    direction: "at-most",
  },
  {
    id: "backup-rpo",
    description: "Backup RPO",
    measurement: "measuredRpoHours",
    target: 24,
    unit: "hours",
    direction: "at-most",
  },
  {
    id: "restore-rto",
    description: "Restore RTO",
    measurement: "measuredRtoHours",
    target: 4,
    unit: "hours",
    direction: "at-most",
  },
] as const;

export const DECISION_REQUIRED_TARGETS: readonly DecisionRequiredTarget[] = [
  {
    id: "p99-latency",
    description: "Numeric p99 latency limits",
    measurement: "interactiveReadP99Ms",
  },
  {
    id: "api-concurrency",
    description: "Approved API concurrency and session target",
    measurement: "apiConcurrency",
  },
  {
    id: "error-rate",
    description: "Accepted error and saturation rate",
    measurement: "apiErrorRate",
  },
  {
    id: "storage-headroom",
    description: "Required storage headroom",
    measurement: "storageHeadroomBytes",
  },
  {
    id: "backup-disk-envelope",
    description: "Whether backup capacity is inside the disk envelope",
    measurement: "backupCapacityIncluded",
  },
  {
    id: "restore-dataset-tier",
    description: "Required restore dataset tier",
    measurement: "restoreDatasetTier",
  },
  {
    id: "large-version-compare",
    description: "Large branch/version comparison latency allowance",
    measurement: "largeVersionCompareP95Ms",
  },
  {
    id: "branch-count",
    description: "Approved canonical branch count",
    measurement: "branchCount",
  },
] as const;

export function compareTargets(measurements: BenchmarkMeasurements): TargetComparison {
  return {
    approved: APPROVED_TARGETS.map((target) => {
      const measured = measurements[target.measurement] ?? null;
      return {
        id: target.id,
        description: target.description,
        measured,
        target: target.target,
        unit: target.unit,
        status: measured === null ? "fail" : measured <= target.target ? "pass" : "fail",
      } satisfies TargetResult;
    }),
    decisionRequired: DECISION_REQUIRED_TARGETS.map((target) => ({
      id: target.id,
      description: target.description,
      measured: measurements[target.measurement] ?? null,
      target: null,
      unit: targetUnit(target.measurement),
      status: "decision-required",
    })),
  };
}

function targetUnit(measurement: DecisionMeasurementKey): TargetUnit {
  if (measurement === "interactiveReadP99Ms" || measurement === "largeVersionCompareP95Ms") {
    return "ms";
  }
  if (measurement === "apiConcurrency" || measurement === "branchCount") {
    return "count";
  }
  if (measurement === "apiErrorRate") {
    return "ratio";
  }
  if (measurement === "storageHeadroomBytes") {
    return "bytes";
  }
  return "label";
}
