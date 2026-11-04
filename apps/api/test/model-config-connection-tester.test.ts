import type { ModelConfig } from "@novel-brain/contracts";
import { describe, expect, it, vi } from "vitest";

import { HttpModelConnectionTester } from "../src/model-config/connection-tester";

const config: ModelConfig = {
  id: "01a1a6f9-9d9b-71e1-98ed-ae21fe958ef4",
  provider: "deepseek",
  label: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  purposes: ["writing"],
  keyMasked: "****1234",
  isDefault: true,
  version: 1,
  lastTestStatus: null,
  lastTestedAt: null,
  createdAt: "2026-11-04T08:00:00.000Z",
  updatedAt: "2026-11-04T08:00:00.000Z",
};

const validatedAddresses = async () => ["93.184.216.34"];

describe("HTTP model connection tester", () => {
  it.each([
    [401, "key_invalid"],
    [429, "rate_limited"],
    [302, "provider_error"],
    [500, "provider_error"],
    [200, "success"],
  ] as const)("maps provider status %i to %s", async (status, expected) => {
    const tester = new HttpModelConnectionTester(validatedAddresses, async () => ({
      status,
      statusCode: status,
    }));

    await expect(tester.test({ config, apiKey: "sk-test-1234" })).resolves.toMatchObject({
      status: expected,
    });
  });

  it("maps provider timeouts and connection failures separately", async () => {
    const timeout = new HttpModelConnectionTester(validatedAddresses, async () => {
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    const providerFailure = new HttpModelConnectionTester(validatedAddresses, async () => {
      throw new Error("connection reset");
    });
    const validationFailure = new HttpModelConnectionTester(async () => {
      throw new Error("dns failure");
    });

    await expect(timeout.test({ config, apiKey: "sk-test-1234" })).resolves.toMatchObject({
      status: "timeout",
    });
    await expect(providerFailure.test({ config, apiKey: "sk-test-1234" })).resolves.toMatchObject({
      status: "provider_error",
    });
    await expect(validationFailure.test({ config, apiKey: "sk-test-1234" })).resolves.toMatchObject(
      { status: "error" },
    );
  });

  it("pins the validated address for the HTTPS request", async () => {
    const request = vi.fn(async () => ({ status: 200, statusCode: 200 }));
    const tester = new HttpModelConnectionTester(validatedAddresses, request);

    await tester.test({ config, apiKey: "sk-test-1234" });

    expect(request).toHaveBeenCalledWith(
      new URL("https://api.deepseek.com/chat/completions"),
      "93.184.216.34",
      "deepseek-chat",
      "sk-test-1234",
    );
  });
});
