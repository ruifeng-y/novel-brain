import { describe, expect, it, vi } from "vitest";

import { MetricsDatabaseService } from "../src/metrics/metrics-database.service";

describe("metrics database service", () => {
  it("maps durable job and model usage aggregates", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ type: "generate_chapter", status: "failed", count: 2 }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            status: "succeeded",
            count: 3,
            average_latency_ms: 800,
            input_tokens: 1200,
            output_tokens: 600,
            cost_cny: 0.75,
          },
        ],
      });
    const service = new MetricsDatabaseService({ query } as never);

    await expect(service.collect()).resolves.toEqual({
      jobs: [{ jobType: "generate_chapter", status: "failed", count: 2 }],
      modelCalls: [
        {
          status: "succeeded",
          count: 3,
          averageLatencyMs: 800,
          inputTokens: 1200,
          outputTokens: 600,
          costCny: 0.75,
        },
      ],
    });
    expect(String(query.mock.calls[0]?.[0])).toContain("FROM jobs");
    expect(String(query.mock.calls[1]?.[0])).toContain("FROM model_calls");
  });
});
