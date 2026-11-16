import { describe, expect, it } from "vitest";

import {
  decodeRuntimeJobMetricField,
  encodeRuntimeJobMetricField,
  runtimeMetricsBucketDates,
  safeApiRouteTemplate,
  safeRuntimeMetricJobStatus,
} from "../src/runtime-metrics";

describe("runtime metrics helpers", () => {
  it("round-trips registered job metric fields", () => {
    expect(
      decodeRuntimeJobMetricField(encodeRuntimeJobMetricField("generate_chapter", "failed")),
    ).toEqual({
      jobType: "generate_chapter",
      status: "failed",
    });
    expect(decodeRuntimeJobMetricField("not-a-registered:field")).toBeUndefined();
    expect(safeRuntimeMetricJobStatus("private-content")).toBe("unknown");
  });

  it("builds hourly buckets for the rolling 24-hour boundary", () => {
    const buckets = runtimeMetricsBucketDates(Date.UTC(2026, 10, 14, 12, 34));
    expect(buckets).toHaveLength(25);
    expect(buckets[0]?.toISOString()).toBe("2026-11-14T12:00:00.000Z");
    expect(buckets[24]?.toISOString()).toBe("2026-11-13T12:00:00.000Z");
  });

  it("only accepts route templates or registered static routes", () => {
    expect(safeApiRouteTemplate("/api/v1/works/:workId")).toBe("/api/v1/works/:workId");
    expect(safeApiRouteTemplate("/api/v1/health/ready")).toBe("/api/v1/health/ready");
    expect(safeApiRouteTemplate("/api/v1/works/private-slug")).toBe("/unmatched");
  });
});
