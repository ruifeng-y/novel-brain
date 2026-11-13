import { describe, expect, it, vi } from "vitest";

import { WorkerOperationalMetricsRecorder } from "../src/metrics/operational-metrics-recorder";

describe("worker operational metrics recorder", () => {
  it("records job outcomes and model usage into expiring Redis hashes", async () => {
    const pipeline = {
      hincrby: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    const redis = { pipeline: vi.fn(() => pipeline) };
    const recorder = new WorkerOperationalMetricsRecorder(redis as never);

    await recorder.recordJob("generate_chapter", "succeeded");
    await recorder.recordModelCall({
      event: "worker.model_call.succeeded",
      status: "succeeded",
      latencyMs: 800,
      inputTokens: 1200,
      outputTokens: 600,
      costCny: 0.75,
    });

    expect(redis.pipeline).toHaveBeenCalledTimes(2);
    expect(pipeline.hincrby).toHaveBeenCalledWith(
      "novelbrain:metrics:jobs",
      "generate_chapter:succeeded",
      1,
    );
    expect(pipeline.hincrby).toHaveBeenCalledWith(
      "novelbrain:metrics:models",
      "calls:succeeded",
      1,
    );
    expect(pipeline.hincrby).toHaveBeenCalledWith(
      "novelbrain:metrics:models",
      "latency_sum_ms:succeeded",
      800,
    );
    expect(pipeline.expire).toHaveBeenCalledWith("novelbrain:metrics:models", 90_000);
  });
});
