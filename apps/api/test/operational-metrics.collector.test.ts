import { describe, expect, it, vi } from "vitest";

import { OperationalMetricsCollector } from "../src/metrics/operational-metrics.collector";

describe("operational metrics collector", () => {
  it("combines health, durable job, queue and storage snapshots", async () => {
    const collector = new OperationalMetricsCollector(
      {
        getReadiness: vi.fn().mockResolvedValue({
          status: "not_ready",
          service: "api",
          timestamp: "2026-11-14T00:00:00.000Z",
          checks: [
            { name: "database", status: "up", latencyMs: 2 },
            { name: "queue", status: "up", latencyMs: 3 },
            { name: "storage", status: "down", latencyMs: 4 },
          ],
        }),
      },
      {
        collect: vi.fn().mockResolvedValue({
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
        }),
      },
      {
        collect: vi.fn().mockResolvedValue({
          counts: { wait: 1, active: 2, delayed: 0, failed: 0, completed: 4, paused: 0 },
          oldestAgeSeconds: { wait: 15, active: 3 },
        }),
      },
    );

    await expect(collector.collect()).resolves.toEqual({
      dependencies: { database: true, queue: true, storage: false },
      queue: {
        counts: { wait: 1, active: 2, delayed: 0, failed: 0, completed: 4, paused: 0 },
        oldestAgeSeconds: { wait: 15, active: 3 },
      },
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
      storage: { configured: true, available: false },
    });
  });

  it("omits optional storage from dependency metrics when it is not configured", async () => {
    const collector = new OperationalMetricsCollector(
      {
        getReadiness: vi.fn().mockResolvedValue({
          status: "ready",
          service: "api",
          timestamp: "2026-11-14T00:00:00.000Z",
          checks: [
            { name: "database", status: "up", latencyMs: 2 },
            { name: "queue", status: "up", latencyMs: 3 },
          ],
        }),
      },
      { collect: vi.fn().mockResolvedValue({ jobs: [], modelCalls: [] }) },
      {
        collect: vi.fn().mockResolvedValue({
          counts: { wait: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
          oldestAgeSeconds: {},
        }),
      },
    );

    const snapshot = await collector.collect();
    expect(snapshot.dependencies).toEqual({ database: true, queue: true });
    expect(snapshot.storage).toEqual({ configured: false, available: false });
  });
});
