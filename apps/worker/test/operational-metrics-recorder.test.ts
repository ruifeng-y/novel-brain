import { describe, expect, it, vi } from "vitest";
import { JOB_METRICS_KEY, MODEL_METRICS_KEY, runtimeMetricsBucketKey } from "@novel-brain/core";

import {
  isFinalJobAttempt,
  WorkerOperationalMetricsRecorder,
} from "../src/metrics/operational-metrics-recorder";

describe("worker operational metrics recorder", () => {
  it("records only the final BullMQ attempt", () => {
    expect(isFinalJobAttempt(0, 3)).toBe(false);
    expect(isFinalJobAttempt(1, 3)).toBe(false);
    expect(isFinalJobAttempt(2, 3)).toBe(true);
    expect(isFinalJobAttempt(0, undefined)).toBe(true);
  });

  it("records job outcomes and model usage into expiring Redis hashes", async () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const jobKey = runtimeMetricsBucketKey(JOB_METRICS_KEY, new Date(now));
    const modelKey = runtimeMetricsBucketKey(MODEL_METRICS_KEY, new Date(now));
    const pipeline = {
      hincrby: vi.fn().mockReturnThis(),
      hincrbyfloat: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    const redis = { pipeline: vi.fn(() => pipeline) };
    const recorder = new WorkerOperationalMetricsRecorder(redis as never, () => now);

    await recorder.recordJob("generate_chapter", "succeeded");
    await recorder.recordModelCall({
      event: "worker.model_call.succeeded",
      status: "succeeded",
      latencyMs: 800,
      inputTokens: 1200,
      outputTokens: 600,
      costCny: 0.75,
    });

    expect(redis.pipeline).toHaveBeenCalledTimes(3);
    expect(pipeline.hincrby).toHaveBeenCalledWith(jobKey, "generate_chapter:succeeded", 1);
    expect(pipeline.hincrby).toHaveBeenCalledWith(modelKey, "calls:succeeded", 1);
    expect(pipeline.hincrby).toHaveBeenCalledWith(modelKey, "latency_sum_ms:succeeded", 800);
    expect(pipeline.hincrbyfloat).toHaveBeenCalledWith(modelKey, "cost_cny:succeeded", 0.75);
    expect(pipeline.expire).toHaveBeenCalledWith(modelKey, 90_000);
  });

  it("records actual usage and cost when a model call exceeds its reservation", async () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const modelKey = runtimeMetricsBucketKey(MODEL_METRICS_KEY, new Date(now));
    const pipeline = {
      hincrby: vi.fn().mockReturnThis(),
      hincrbyfloat: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    const recorder = new WorkerOperationalMetricsRecorder(
      { pipeline: vi.fn(() => pipeline) } as never,
      () => now,
    );

    await recorder.recordModelCall({
      event: "worker.model_call.budget_overrun",
      latencyMs: 900,
      inputTokens: 1_400,
      outputTokens: 700,
      costCny: 0.83,
    });

    expect(pipeline.hincrby).toHaveBeenCalledWith(modelKey, "calls:failed", 1);
    expect(pipeline.hincrby).toHaveBeenCalledWith(modelKey, "latency_sum_ms:failed", 900);
    expect(pipeline.hincrby).toHaveBeenCalledWith(modelKey, "input_tokens:failed", 1_400);
    expect(pipeline.hincrby).toHaveBeenCalledWith(modelKey, "output_tokens:failed", 700);
    expect(pipeline.hincrbyfloat).toHaveBeenCalledWith(modelKey, "cost_cny:failed", 0.83);
  });
});
