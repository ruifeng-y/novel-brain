import { Inject, Injectable, Optional } from "@nestjs/common";
import {
  decodeRuntimeJobMetricField,
  JOB_METRICS_KEY,
  MODEL_METRICS_KEY,
  runtimeMetricsBucketDates,
  runtimeMetricsBucketKey,
  safeRuntimeMetricModelStatus,
} from "@novel-brain/core";

import type { RuntimeMetricsSource } from "./operational-metrics.collector";

export const METRICS_REDIS = Symbol("METRICS_REDIS");
export const METRICS_RUNTIME_NOW = Symbol("METRICS_RUNTIME_NOW");

interface MetricsRedis {
  hgetall(key: string): Promise<Record<string, string>>;
}

const STATUS_ORDER = ["succeeded", "failed", "cancelled", "completed", "unknown"];

@Injectable()
export class MetricsRuntimeService implements RuntimeMetricsSource {
  constructor(
    @Inject(METRICS_REDIS) private readonly redis: MetricsRedis,
    @Optional()
    @Inject(METRICS_RUNTIME_NOW)
    private readonly now: () => number = Date.now,
  ) {}

  async collect(): Promise<Awaited<ReturnType<RuntimeMetricsSource["collect"]>>> {
    const bucketDates = runtimeMetricsBucketDates(this.now());
    const [jobBuckets, modelBuckets] = await Promise.all([
      Promise.all(
        bucketDates.map((date) =>
          this.redis.hgetall(runtimeMetricsBucketKey(JOB_METRICS_KEY, date)),
        ),
      ),
      Promise.all(
        bucketDates.map((date) =>
          this.redis.hgetall(runtimeMetricsBucketKey(MODEL_METRICS_KEY, date)),
        ),
      ),
    ]);
    const jobs = mergeMetricBuckets(jobBuckets);
    const models = mergeMetricBuckets(modelBuckets);
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
        .flatMap(([field, value]) => {
          const decoded = decodeRuntimeJobMetricField(field);
          if (!decoded) {
            return [];
          }
          return [
            {
              ...decoded,
              count: integer(value),
            },
          ];
        })
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
          status: safeRuntimeMetricModelStatus(status),
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

function mergeMetricBuckets(buckets: Array<Record<string, string>>): Record<string, string> {
  const merged = new Map<string, number>();
  for (const bucket of buckets) {
    for (const [field, value] of Object.entries(bucket)) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        merged.set(field, (merged.get(field) ?? 0) + parsed);
      }
    }
  }
  return Object.fromEntries([...merged].map(([field, value]) => [field, String(value)]));
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
