import {
  JOB_METRICS_KEY,
  MODEL_METRICS_KEY,
  RUNTIME_METRICS_TTL_SECONDS,
} from "@novel-brain/contracts";
import type Redis from "ioredis";

interface MetricsRedis {
  pipeline(): {
    hincrby(key: string, field: string, value: number): unknown;
    expire(key: string, seconds: number): unknown;
    exec(): Promise<unknown>;
  };
}

export class WorkerOperationalMetricsRecorder {
  constructor(private readonly redis: MetricsRedis | Redis) {}

  async recordJob(jobType: string, status: string): Promise<void> {
    await this.record(JOB_METRICS_KEY, [[`${safeField(jobType)}:${safeField(status)}`, 1]]);
  }

  async recordModelCall(payload: Record<string, unknown>): Promise<void> {
    const event = typeof payload.event === "string" ? payload.event : "";
    if (event === "worker.model_call.succeeded") {
      await this.record(MODEL_METRICS_KEY, [
        ["calls:succeeded", 1],
        ["latency_sum_ms:succeeded", positiveNumber(payload.latencyMs)],
        ["input_tokens:succeeded", positiveNumber(payload.inputTokens)],
        ["output_tokens:succeeded", positiveNumber(payload.outputTokens)],
        ["cost_cny:succeeded", positiveNumber(payload.costCny)],
      ]);
      return;
    }
    if (event === "worker.model_call.failed") {
      await this.record(MODEL_METRICS_KEY, [
        ["calls:failed", 1],
        ["latency_sum_ms:failed", positiveNumber(payload.latencyMs)],
      ]);
      return;
    }
    if (event === "worker.model_call.budget_overrun") {
      await this.record(MODEL_METRICS_KEY, [
        ["calls:failed", 1],
        ["tokens:overrun", positiveNumber(payload.actualTokens)],
      ]);
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
      await pipeline.exec();
    } catch {
      // Metrics must never fail the durable job path.
    }
  }
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function safeField(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : "unknown";
}
