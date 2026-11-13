import { describe, expect, it, vi } from "vitest";

import { MetricsMiddleware } from "../src/metrics/metrics.middleware";
import { PrometheusMetricsService } from "../src/metrics/prometheus-metrics.service";

describe("metrics middleware", () => {
  it("uses a normalized route label and excludes the scrape endpoint", async () => {
    const metrics = new PrometheusMetricsService();
    const middleware = new MetricsMiddleware(metrics);
    const next = vi.fn();
    const response = {
      statusCode: 200,
      on: vi.fn((_event: string, callback: () => void) => callback()),
    };

    middleware.use(
      {
        method: "GET",
        path: "/api/v1/works/01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
        route: { path: "/api/v1/works/:workId" },
      } as never,
      response as never,
      next,
    );

    const text = await metrics.render();
    expect(next).toHaveBeenCalledOnce();
    expect(text).toContain(
      'novelbrain_api_request_duration_seconds_count{method="GET",route="/api/v1/works/:workId",status="200"} 1',
    );
    expect(text).not.toContain("01a1d573-7f8c");

    middleware.use(
      { method: "GET", path: "/api/v1/metrics", route: { path: "/api/v1/metrics" } } as never,
      response as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(2);
  });
});
