import { Inject, Injectable, Optional } from "@nestjs/common";

import type { QueueMetricsSource } from "./operational-metrics.collector";
import type { QueueMetricCounts } from "./prometheus-metrics.service";

export const METRICS_QUEUE_CLIENT = Symbol("METRICS_QUEUE_CLIENT");
export const METRICS_NOW = Symbol("METRICS_NOW");

interface QueueJob {
  timestamp: number;
}

interface QueueClient {
  waitUntilReady(): Promise<unknown>;
  getJobCounts(...states: string[]): Promise<Record<string, number>>;
  getJobs(states: string[], start: number, end: number, asc: boolean): Promise<QueueJob[]>;
}

const QUEUE_STATES = ["wait", "active", "delayed", "failed", "completed", "paused"] as const;
const AGE_STATES = ["wait", "active", "delayed"] as const;

@Injectable()
export class MetricsQueueService implements QueueMetricsSource {
  constructor(
    @Inject(METRICS_QUEUE_CLIENT) private readonly queue: QueueClient,
    @Optional()
    @Inject(METRICS_NOW)
    private readonly now: () => number = Date.now,
  ) {}

  async collect(): Promise<{
    counts: QueueMetricCounts;
    oldestAgeSeconds: Partial<QueueMetricCounts>;
  }> {
    await this.queue.waitUntilReady();
    const rawCounts = await this.queue.getJobCounts(...QUEUE_STATES);
    const counts = Object.fromEntries(
      QUEUE_STATES.map((state) => [state, nonNegativeNumber(rawCounts[state])]),
    ) as unknown as QueueMetricCounts;
    const oldestAgeSeconds: Partial<QueueMetricCounts> = {};

    await Promise.all(
      AGE_STATES.map(async (state) => {
        const [oldest] = await this.queue.getJobs([state], 0, 0, true);
        if (oldest) {
          oldestAgeSeconds[state] = Math.max(
            0,
            Math.floor((this.now() - oldest.timestamp) / 1_000),
          );
        }
      }),
    );

    return { counts, oldestAgeSeconds };
  }
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}
