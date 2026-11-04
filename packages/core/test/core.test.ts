import { describe, expect, it } from "vitest";

import {
  createRequestId,
  elapsedMilliseconds,
  resolveProxyIpSecret,
  signClientIp,
  verifyClientIp,
} from "../src";

describe("core request helpers", () => {
  it("creates protocol-compatible request identifiers", () => {
    expect(createRequestId(() => "fixed-id")).toBe("req_fixed-id");
  });

  it("reports non-negative elapsed milliseconds", () => {
    expect(elapsedMilliseconds(process.hrtime.bigint())).toBeGreaterThanOrEqual(0);
  });

  it("signs and verifies client IP values", () => {
    const signed = signClientIp("203.0.113.8", "secret");
    expect(verifyClientIp(signed, "secret")).toBe("203.0.113.8");
    expect(verifyClientIp(`${signed}x`, "secret")).toBeNull();
    expect(verifyClientIp(signed, "wrong-secret")).toBeNull();
  });

  it("fails closed for a default proxy IP secret", () => {
    expect(resolveProxyIpSecret("production-secret", undefined)).toBe("production-secret");
    expect(() => resolveProxyIpSecret(undefined, undefined)).toThrow();
    expect(() => resolveProxyIpSecret("change-me-in-production", undefined)).toThrow();
    expect(resolveProxyIpSecret("local-development-proxy-ip-secret", "true")).toBe(
      "local-development-proxy-ip-secret",
    );
  });
});
