import { describe, expect, it } from "vitest";

import {
  ProviderEndpointValidationError,
  requestPinnedHttps,
  validateProviderEndpoint,
} from "../src/provider-endpoint";

describe("provider endpoint validation", () => {
  it("allows only the official DeepSeek endpoint", async () => {
    await expect(
      validateProviderEndpoint({
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
        lookupHost: async () => [{ address: "8.8.8.8", family: 4 }],
      }),
    ).resolves.toMatchObject({
      normalizedBaseUrl: "https://api.deepseek.com",
      addresses: ["8.8.8.8"],
    });
    await expect(
      validateProviderEndpoint({
        provider: "deepseek",
        baseUrl: "https://internal.example.com",
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_ALLOWED" });
  });

  it("rejects private DNS targets and non-allowlisted compatible providers", async () => {
    await expect(
      validateProviderEndpoint({
        provider: "openai-compatible",
        baseUrl: "https://models.example.com/v1",
        openAiAllowlist: ["https://models.example.com/v1"],
        lookupHost: async () => [{ address: "10.0.0.8", family: 4 }],
      }),
    ).rejects.toBeInstanceOf(ProviderEndpointValidationError);
    await expect(
      validateProviderEndpoint({
        provider: "openai-compatible",
        baseUrl: "https://models.example.com/v1",
        openAiAllowlist: [],
        lookupHost: async () => [{ address: "8.8.8.8", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_ALLOWED" });
  });

  it("refuses to connect the pinned transport to a private address", async () => {
    await expect(
      requestPinnedHttps({
        target: new URL("https://models.example.com/v1/chat/completions"),
        address: "10.0.0.8",
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "PRIVATE_NETWORK" });
  });
});
