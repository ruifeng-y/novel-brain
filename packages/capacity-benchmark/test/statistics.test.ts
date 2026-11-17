import { describe, expect, it } from "vitest";

import { summarizeSamples } from "../src/statistics";

describe("benchmark statistics", () => {
  it("reports nearest-rank percentiles, throughput, and errors from raw samples", () => {
    const summary = summarizeSamples(
      [
        { durationMs: 1, ok: true },
        { durationMs: 2, ok: true },
        { durationMs: 3, ok: false },
        { durationMs: 4, ok: true },
      ],
      2_000,
    );

    expect(summary).toEqual({
      count: 4,
      okCount: 3,
      errorCount: 1,
      errorRate: 0.25,
      errorsPerSecond: 0.5,
      throughputPerSecond: 2,
      p50Ms: 2,
      p95Ms: 4,
      p99Ms: 4,
    });
  });

  it("returns null percentiles when no samples were collected", () => {
    expect(summarizeSamples([], 1_000)).toEqual({
      count: 0,
      okCount: 0,
      errorCount: 0,
      errorRate: null,
      errorsPerSecond: 0,
      throughputPerSecond: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
    });
  });
});
