import { describe, expect, it, vi } from "vitest";
import {
  JOB_METRICS_KEY,
  MODEL_METRICS_KEY,
  runtimeMetricsBucketKey,
} from "@novel-brain/contracts";

import { WorkerOperationalMetricsRecorder } from "../src/metrics/operational-metrics-recorder";

describe("worker operational metrics recorder", () => {
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
});
