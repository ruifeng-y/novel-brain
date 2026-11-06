import { describe, expect, it, vi } from "vitest";

import { AiProviderError, DeepSeekProvider, classifyAiFailure } from "../src";

function providerWith(fetchImpl: typeof fetch) {
  return new DeepSeekProvider({
    apiKey: "sk-failure-class-1234",
    fetchImpl,
    timeoutMs: 50,
  });
}

describe("AI failure classification", () => {
  it("classifies provider timeouts and network errors", async () => {
    const timeout = providerWith(
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }) as unknown as typeof fetch,
    );
    await expect(timeout.generateText({ prompt: "写一段" })).rejects.toSatisfy(
      (error: unknown) => classifyAiFailure(error) === "timeout",
    );
  });

  it("classifies rate limits, policy failures, malformed responses and server errors", async () => {
    const rateLimited = providerWith(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "slow down" }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(rateLimited.generateText({ prompt: "写一段" })).rejects.toSatisfy(
      (error: unknown) => classifyAiFailure(error) === "rate_limit",
    );

    const policy = providerWith(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "invalid key" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(policy.generateText({ prompt: "写一段" })).rejects.toSatisfy(
      (error: unknown) => classifyAiFailure(error) === "policy",
    );

    const malformed = providerWith(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ choices: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(malformed.generateText({ prompt: "写一段" })).rejects.toSatisfy(
      (error: unknown) => classifyAiFailure(error) === "schema",
    );

    const server = providerWith(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "upstream" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ) as unknown as typeof fetch,
    );
    await expect(server.generateText({ prompt: "写一段" })).rejects.toSatisfy(
      (error: unknown) => classifyAiFailure(error) === "provider",
    );
  });

  it("preserves an explicit failure class", () => {
    const error = new AiProviderError("budget hard stop", { failureClass: "budget" });
    expect(classifyAiFailure(error)).toBe("budget");
    expect(classifyAiFailure(new Error("unknown"))).toBe("unknown");
  });
});
