import { readFileSync } from "node:fs";

const ALERTS = [
  "ApiReadinessDown",
  "ApiLatencyHigh",
  "WorkerQueueBacklog",
  "WorkerQueueOldestJobAge",
  "JobFailureRateHigh",
  "ModelLatencyHigh",
  "ModelCostDailyHigh",
  "StorageUsageHigh",
  "StorageUnavailable",
];

export function evaluateAlertFixture(fixture, thresholds) {
  const firing = [];
  if (fixture.apiReady < thresholds.apiReadyMinimum) {
    firing.push("ApiReadinessDown");
  }
  if (fixture.apiP95LatencySeconds > thresholds.apiP95LatencySeconds) {
    firing.push("ApiLatencyHigh");
  }
  if (fixture.queueBacklogJobs > thresholds.queueBacklogJobs) {
    firing.push("WorkerQueueBacklog");
  }
  if (fixture.queueOldestJobAgeSeconds > thresholds.queueOldestJobAgeSeconds) {
    firing.push("WorkerQueueOldestJobAge");
  }
  if (fixture.jobFailureRate > thresholds.jobFailureRate) {
    firing.push("JobFailureRateHigh");
  }
  if (fixture.modelAverageLatencyMs > thresholds.modelAverageLatencyMs) {
    firing.push("ModelLatencyHigh");
  }
  if (fixture.modelDailyCostCny > thresholds.modelDailyCostCny) {
    firing.push("ModelCostDailyHigh");
  }
  if (fixture.storageFreeRatio < thresholds.storageFreeRatioMinimum) {
    firing.push("StorageUsageHigh");
  }
  if (fixture.storageAvailable < thresholds.storageAvailableMinimum) {
    firing.push("StorageUnavailable");
  }
  return firing;
}

export function validateAlertAssets() {
  const errors = [];
  const rules = readFileSync("infra/observability/alerts.yml", "utf8");
  const runbook = readFileSync("docs/operations/alerting.md", "utf8");
  const thresholds = JSON.parse(readFileSync("infra/observability/alert-thresholds.json", "utf8"));
  const thresholdKeys = [
    "apiReadyMinimum",
    "apiP95LatencySeconds",
    "queueBacklogJobs",
    "queueOldestJobAgeSeconds",
    "jobFailureRate",
    "modelAverageLatencyMs",
    "modelDailyCostCny",
    "storageFreeRatioMinimum",
    "storageAvailableMinimum",
  ];

  for (const key of thresholdKeys) {
    if (typeof thresholds[key] !== "number" || thresholds[key] <= 0) {
      errors.push(`threshold ${key} must be a positive number`);
    }
  }
  for (const alert of ALERTS) {
    if (!rules.includes(`alert: ${alert}`)) {
      errors.push(`missing alert rule: ${alert}`);
    }
    if (!runbook.includes(`## ${alert}`)) {
      errors.push(`missing runbook heading: ${alert}`);
    }
  }
  return errors;
}
