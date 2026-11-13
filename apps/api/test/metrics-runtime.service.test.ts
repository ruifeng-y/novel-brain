import { describe, expect, it, vi } from "vitest";
import {
  JOB_METRICS_KEY,
  MODEL_METRICS_KEY,
  runtimeMetricsBucketKey,
} from "@novel-brain/contracts";

import { MetricsRuntimeService } from "../src/metrics/metrics-runtime.service";

describe("metrics runtime service", () => {
  it("maps worker Redis counters into job and model aggregates", async () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const jobKey = runtimeMetricsBucketKey(JOB_METRICS_KEY, new Date(now));
    const modelKey = runtimeMetricsBucketKey(MODEL_METRICS_KEY, new Date(now));
    const redis = {
      hgetall: vi.fn(async (key: string) => {
        if (key === jobKey) {
          return {
            "generate_chapter:succeeded": "18",
            "generate_chapter:failed": "2",
          };
        }
        if (key === modelKey) {
          return {
            "calls:succeeded": "10",
            "latency_sum_ms:succeeded": "8000",
            "input_tokens:succeeded": "1200",
            "output_tokens:succeeded": "600",
            "cost_cny:succeeded": "0.75",
            "calls:failed": "2",
            "latency_sum_ms:failed": "2000",
          };
        }
        return {};
      }),
    };
    const service = new MetricsRuntimeService(redis as never, () => now);

    await expect(service.collect()).resolves.toEqual({
      jobs: [
        { jobType: "generate_chapter", status: "succeeded", count: 18 },
        { jobType: "generate_chapter", status: "failed", count: 2 },
      ],
      modelCalls: [
        {
          status: "succeeded",
          count: 10,
          averageLatencyMs: 800,
          inputTokens: 1200,
          outputTokens: 600,
          costCny: 0.75,
        },
        {
          status: "failed",
          count: 2,
          averageLatencyMs: 1000,
          inputTokens: 0,
          outputTokens: 0,
          costCny: 0,
        },
      ],
    });
  });
});
