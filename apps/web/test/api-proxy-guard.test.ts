import { describe, expect, it } from "vitest";

import { isBlockedApiProxyPath } from "../lib/api-proxy-guard";

describe("API proxy path guard", () => {
  it("blocks metrics before and after URL normalization", () => {
    expect(isBlockedApiProxyPath(["metrics"], "/api/v1/metrics")).toBe(true);
    expect(isBlockedApiProxyPath(["METRICS"], "/api/v1/METRICS")).toBe(true);
    expect(isBlockedApiProxyPath(["foo", "..", "metrics"], "/api/v1/metrics")).toBe(true);
  });

  it("blocks path segments that can escape the API proxy route", () => {
    expect(isBlockedApiProxyPath(["..", "admin"], "/api/v1/admin")).toBe(true);
    expect(isBlockedApiProxyPath(["foo/bar"], "/api/v1/foo/bar")).toBe(true);
    expect(isBlockedApiProxyPath(["%2e%2e%2fmetrics"], "/api/v1/%2e%2e%2fmetrics")).toBe(true);
    expect(isBlockedApiProxyPath(["works", "id"], "/api/v1/works/id")).toBe(false);
  });
});
