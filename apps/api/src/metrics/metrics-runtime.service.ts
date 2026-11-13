import { Inject, Injectable } from "@nestjs/common";
import { JOB_METRICS_KEY, MODEL_METRICS_KEY } from "@novel-brain/contracts";

import type { RuntimeMetricsSource } from "./operational-metrics.collector";

export const METRICS_REDIS = Symbol("METRICS_REDIS");

interface MetricsRedis {
  hgetall(key: string): Promise<Record<string, string>>;
}

const STATUS_ORDER = ["succeeded", "failed", "cancelled", "completed", "unknown"];

@Injectable()
export class MetricsRuntimeService implements RuntimeMetricsSource {
  constructor(@Inject(METRICS_REDIS) private readonly redis: MetricsRedis) {}

  async collect(): Promise<Awaited<ReturnType<RuntimeMetricsSource["collect"]>>> {
    const [jobs, models] = await Promise.all([
      this.redis.hgetall(JOB_METRICS_KEY),
      this.redis.hgetall(MODEL_METRICS_KEY),
    ]);
    const statuses = new Set<string>();
    for (const field of Object.keys(models)) {
      const [kind, status] = field.split(":", 2);
      if (kind === "calls" && status) {
        statuses.add(status);
      }
    }
    const orderedStatuses = [...statuses].sort(
      (left, right) => statusIndex(left) - statusIndex(right) || left.localeCompare(right),
    );

    return {
      jobs: Object.entries(jobs)
        .map(([field, value]) => {
          const separator = field.lastIndexOf(":");
          return {
            jobType: field.slice(0, separator),
            status: field.slice(separator + 1),
            count: integer(value),
          };
        })
        .filter((job) => job.jobType && job.status)
        .sort(
          (left, right) =>
            left.jobType.localeCompare(right.jobType) ||
            statusIndex(left.status) - statusIndex(right.status) ||
            left.status.localeCompare(right.status),
        ),
      modelCalls: orderedStatuses.map((status) => {
        const count = integer(models[`calls:${status}`]);
        const latencySum = integer(models[`latency_sum_ms:${status}`]);
        return {
          status,
          count,
          averageLatencyMs: count > 0 ? latencySum / count : 0,
          inputTokens: integer(models[`input_tokens:${status}`]),
          outputTokens: integer(models[`output_tokens:${status}`]),
          costCny: decimal(models[`cost_cny:${status}`]),
        };
      }),
    };
  }
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function decimal(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function statusIndex(status: string): number {
  const index = STATUS_ORDER.indexOf(status);
  return index === -1 ? STATUS_ORDER.length : index;
}
