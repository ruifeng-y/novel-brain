import { describe, expect, it, vi } from "vitest";

import { MetricsQueueService } from "../src/metrics/metrics-queue.service";

describe("metrics queue service", () => {
  it("reports queue depth and oldest waiting job age", async () => {
    const queue = {
      waitUntilReady: vi.fn().mockResolvedValue(undefined),
      getJobCounts: vi.fn().mockResolvedValue({
        wait: 7,
        active: 2,
        delayed: 1,
        failed: 3,
        completed: 10,
        paused: 0,
      }),
      getJobs: vi.fn(async (states: string[]) =>
        states[0] === "wait" ? [{ timestamp: 880_000 }] : [],
      ),
    };
    const service = new MetricsQueueService(queue as never, () => 1_000_000);

    await expect(service.collect()).resolves.toEqual({
      counts: { wait: 7, active: 2, delayed: 1, failed: 3, completed: 10, paused: 0 },
      oldestAgeSeconds: { wait: 120 },
    });
    expect(queue.getJobs).toHaveBeenCalledWith(["wait"], 0, 0, true);
  });
});
