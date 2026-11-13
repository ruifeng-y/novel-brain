import { Inject, Injectable } from "@nestjs/common";

import { HealthService } from "../health/health.service";
import type { OperationalMetricsSnapshot, QueueMetricCounts } from "./prometheus-metrics.service";

export const METRICS_DATABASE = Symbol("METRICS_DATABASE");
export const METRICS_QUEUE = Symbol("METRICS_QUEUE");

export interface DurableMetricsSource {
  collect(): Promise<Pick<OperationalMetricsSnapshot, "jobs" | "modelCalls">>;
}

export interface QueueMetricsSource {
  collect(): Promise<OperationalMetricsSnapshot["queue"]>;
}

@Injectable()
export class OperationalMetricsCollector {
  constructor(
    @Inject(HealthService)
    private readonly health: Pick<HealthService, "getReadiness">,
    @Inject(METRICS_DATABASE) private readonly database: DurableMetricsSource,
    @Inject(METRICS_QUEUE) private readonly queue: QueueMetricsSource,
  ) {}

  async collect(): Promise<OperationalMetricsSnapshot> {
    const [readinessResult, durableResult, queueResult] = await Promise.allSettled([
      this.health.getReadiness(),
      this.database.collect(),
      this.queue.collect(),
    ]);

    const readiness =
      readinessResult.status === "fulfilled"
        ? readinessResult.value
        : { checks: [] as Array<{ name: string; status: string }> };
    const durable =
      durableResult.status === "fulfilled" ? durableResult.value : { jobs: [], modelCalls: [] };
    const queue = queueResult.status === "fulfilled" ? queueResult.value : emptyQueueMetrics();
    const dependency = (name: "database" | "queue" | "storage"): boolean =>
      readiness.checks.some((check) => check.name === name && check.status === "up");
    const storageConfigured = readiness.checks.some((check) => check.name === "storage");

    return {
      dependencies: {
        database: dependency("database"),
        queue: dependency("queue"),
        storage: dependency("storage"),
      },
      queue,
      jobs: durable.jobs,
      modelCalls: durable.modelCalls,
      storage: {
        configured: storageConfigured,
        available: dependency("storage"),
        objectCount: 0,
        bytes: 0,
      },
    };
  }
}

function emptyQueueMetrics(): OperationalMetricsSnapshot["queue"] {
  const counts: QueueMetricCounts = {
    wait: 0,
    active: 0,
    delayed: 0,
    failed: 0,
    completed: 0,
    paused: 0,
  };
  return { counts, oldestAgeSeconds: {} };
}
