import { describe, expect, it } from "vitest";

import { PrometheusMetricsService } from "../src/metrics/prometheus-metrics.service";

describe("prometheus metrics service", () => {
  it("renders operational metrics without dynamic or sensitive labels", async () => {
    const metrics = new PrometheusMetricsService();
    metrics.observeHttpRequest("GET", "/api/v1/works/:workId", 200, 0.12);
    metrics.updateSnapshot({
      dependencies: { database: true, queue: true, storage: false },
      queue: {
        counts: { wait: 7, active: 1, delayed: 2, failed: 3, completed: 4, paused: 0 },
        oldestAgeSeconds: { wait: 120, active: 8, delayed: 30 },
      },
      jobs: [
        { jobType: "generate_chapter", status: "failed", count: 2 },
        { jobType: "generate_chapter", status: "completed", count: 18 },
      ],
      modelCalls: [
        {
          status: "succeeded",
          count: 10,
          averageLatencyMs: 850,
          inputTokens: 12_000,
          outputTokens: 8_000,
          costCny: 3.25,
        },
      ],
      storage: { configured: true, available: false },
    });

    const text = await metrics.render();

    expect(text).toContain("novelbrain_api_request_duration_seconds");
    expect(text).toContain('novelbrain_dependency_up{dependency="database"} 1');
    expect(text).toContain('novelbrain_dependency_up{dependency="storage"} 0');
    expect(text).toContain('novelbrain_worker_queue_jobs{state="wait"} 7');
    expect(text).toContain('novelbrain_worker_queue_oldest_job_age_seconds{state="wait"} 120');
    expect(text).toContain('novelbrain_jobs_total{job_type="generate_chapter",status="failed"} 2');
    expect(text).toContain('novelbrain_model_latency_ms{status="succeeded"} 850');
    expect(text).toContain('novelbrain_model_tokens_total{kind="input"} 12000');
    expect(text).toContain('novelbrain_model_cost_cny_total{status="succeeded"} 3.25');
    expect(text).toContain("novelbrain_model_latency_ms_overall 850");
    expect(text).toContain("novelbrain_storage_available 0");
    expect(text).not.toContain("沈砚");
    expect(text).not.toContain("sk-");
  });
});
