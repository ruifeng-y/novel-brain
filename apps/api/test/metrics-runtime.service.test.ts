import { describe, expect, it, vi } from "vitest";

import { MetricsRuntimeService } from "../src/metrics/metrics-runtime.service";

describe("metrics runtime service", () => {
  it("maps worker Redis counters into job and model aggregates", async () => {
    const redis = {
      hgetall: vi
        .fn()
        .mockResolvedValueOnce({
          "generate_chapter:succeeded": "18",
          "generate_chapter:failed": "2",
        })
        .mockResolvedValueOnce({
          "calls:succeeded": "10",
          "latency_sum_ms:succeeded": "8000",
          "input_tokens:succeeded": "1200",
          "output_tokens:succeeded": "600",
          "cost_cny:succeeded": "0.75",
          "calls:failed": "2",
          "latency_sum_ms:failed": "2000",
        }),
    };
    const service = new MetricsRuntimeService(redis as never);

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
