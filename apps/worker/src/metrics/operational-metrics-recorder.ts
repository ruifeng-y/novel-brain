import {
  JOB_METRICS_KEY,
  MODEL_METRICS_KEY,
  RUNTIME_METRICS_TTL_SECONDS,
  runtimeMetricsBucketKey,
} from "@novel-brain/core";
import type { WorkerJob } from "@novel-brain/contracts";
import type Redis from "ioredis";

type WorkerJobType = WorkerJob["jobType"];
type WorkerJobOutcome = "succeeded" | "failed" | "cancelled";

interface MetricsRedis {
  pipeline(): {
    hincrby(key: string, field: string, value: number): unknown;
    hincrbyfloat(key: string, field: string, value: number): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<Array<[Error | null, unknown]> | null>;
  };
}

export class WorkerOperationalMetricsRecorder {
  constructor(
    private readonly redis: MetricsRedis | Redis,
    private readonly now: () => number = Date.now,
  ) {}

  async recordJob(jobType: WorkerJobType, status: WorkerJobOutcome): Promise<void> {
    await this.record(runtimeMetricsBucketKey(JOB_METRICS_KEY, new Date(this.now())), [
      [`${safeField(jobType)}:${safeField(status)}`, 1],
    ]);
  }

  async recordModelCall(payload: Record<string, unknown>): Promise<void> {
    const event = typeof payload.event === "string" ? payload.event : "";
    if (event === "worker.model_call.succeeded") {
      await this.recordModelAggregate({
        status: "succeeded",
        latencyMs: positiveNumber(payload.latencyMs),
        inputTokens: positiveNumber(payload.inputTokens),
        outputTokens: positiveNumber(payload.outputTokens),
        costCny: positiveNumber(payload.costCny),
      });
      return;
    }
    if (event === "worker.model_call.failed") {
      await this.recordModelAggregate({
        status: "failed",
        latencyMs: positiveNumber(payload.latencyMs),
        inputTokens: 0,
        outputTokens: 0,
        costCny: 0,
      });
      return;
    }
    if (event === "worker.model_call.budget_overrun") {
      await this.recordModelAggregate({
        status: "failed",
        latencyMs: positiveNumber(payload.latencyMs),
        inputTokens: positiveNumber(payload.inputTokens),
        outputTokens: positiveNumber(payload.outputTokens),
        costCny: positiveNumber(payload.costCny),
      });
    }
  }

  async recordModelAggregate(input: {
    status: "succeeded" | "failed";
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costCny: number;
  }): Promise<void> {
    await this.record(runtimeMetricsBucketKey(MODEL_METRICS_KEY, new Date(this.now())), [
      [`calls:${input.status}`, 1],
      [`latency_sum_ms:${input.status}`, input.latencyMs],
      [`input_tokens:${input.status}`, input.inputTokens],
      [`output_tokens:${input.status}`, input.outputTokens],
    ]);
    if (input.costCny > 0) {
      await this.recordFloat(`cost_cny:${input.status}`, input.costCny);
    }
  }

  private async record(
    key: string,
    increments: Array<[field: string, value: number]>,
  ): Promise<void> {
    if (increments.every(([, value]) => value <= 0)) {
      return;
    }
    try {
      const pipeline = this.redis.pipeline();
      for (const [field, value] of increments) {
        if (value > 0) {
          pipeline.hincrby(key, field, value);
        }
      }
      pipeline.expire(key, RUNTIME_METRICS_TTL_SECONDS);
      ensurePipelineSucceeded(await pipeline.exec());
    } catch {
      // Metrics must never fail the durable job path.
    }
  }

  private async recordFloat(field: string, value: number): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      const key = runtimeMetricsBucketKey(MODEL_METRICS_KEY, new Date(this.now()));
      pipeline.hincrbyfloat(key, field, value);
      pipeline.expire(key, RUNTIME_METRICS_TTL_SECONDS);
      ensurePipelineSucceeded(await pipeline.exec());
    } catch {
      // Metrics must never fail the durable job path.
    }
  }
}

function ensurePipelineSucceeded(result: Array<[Error | null, unknown]> | null): void {
  if (!result || result.some(([error]) => error)) {
    throw new Error("Redis metrics pipeline failed");
  }
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeField(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "unknown";
}
