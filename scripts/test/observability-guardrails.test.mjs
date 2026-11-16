import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";

import { evaluateAlertFixture, validateAlertAssets } from "../observability-guardrails.mjs";

test("evaluates the high-backlog fixture against documented thresholds", () => {
  const fixture = JSON.parse(
    readFileSync("infra/observability/fixtures/high-backlog.json", "utf8"),
  );
  const thresholds = JSON.parse(readFileSync("infra/observability/alert-thresholds.json", "utf8"));

  assert.deepEqual(evaluateAlertFixture(fixture, thresholds), [
    "WorkerQueueBacklog",
    "WorkerQueueOldestJobAge",
  ]);
});

test("evaluates the all-alerts fixture against documented thresholds", () => {
  const fixture = JSON.parse(readFileSync("infra/observability/fixtures/all-alerts.json", "utf8"));
  const thresholds = JSON.parse(readFileSync("infra/observability/alert-thresholds.json", "utf8"));

  assert.deepEqual(evaluateAlertFixture(fixture, thresholds), [
    "ApiReadinessDown",
    "ApiLatencyHigh",
    "WorkerQueueBacklog",
    "WorkerQueueOldestJobAge",
    "JobFailureRateHigh",
    "ModelLatencyHigh",
    "ModelCostWindowHigh",
    "StorageUsageHigh",
    "StorageUnavailable",
  ]);
});

test("keeps alert rules, thresholds and runbook headings aligned", () => {
  assert.deepEqual(validateAlertAssets(), []);
});
