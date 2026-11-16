import { Inject, Injectable } from "@nestjs/common";

import { HealthService } from "../health/health.service";
import type { OperationalMetricsSnapshot, QueueMetricCounts } from "./prometheus-metrics.service";

export const METRICS_RUNTIME = Symbol("METRICS_RUNTIME");
export const METRICS_QUEUE = Symbol("METRICS_QUEUE");

export interface RuntimeMetricsSource {
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
    @Inject(METRICS_RUNTIME) private readonly runtime: RuntimeMetricsSource,
    @Inject(METRICS_QUEUE) private readonly queue: QueueMetricsSource,
  ) {}

  async collect(): Promise<OperationalMetricsSnapshot> {
    const [readinessResult, runtimeResult, queueResult] = await Promise.allSettled([
      this.health.getReadiness(),
      this.runtime.collect(),
      this.queue.collect(),
    ]);

    const readiness =
      readinessResult.status === "fulfilled"
        ? readinessResult.value
        : { checks: [] as Array<{ name: string; status: string }> };
    const runtime =
      runtimeResult.status === "fulfilled" ? runtimeResult.value : { jobs: [], modelCalls: [] };
    const queue = queueResult.status === "fulfilled" ? queueResult.value : emptyQueueMetrics();
    const dependency = (name: "database" | "queue" | "storage"): boolean =>
      readiness.checks.some((check) => check.name === name && check.status === "up");
    const storageConfigured = readiness.checks.some((check) => check.name === "storage");

    return {
      dependencies: {
        database: dependency("database"),
        queue: dependency("queue"),
        ...(storageConfigured ? { storage: dependency("storage") } : {}),
      },
      queue,
      jobs: runtime.jobs,
      modelCalls: runtime.modelCalls,
      storage: {
        configured: storageConfigured,
        available: dependency("storage"),
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
