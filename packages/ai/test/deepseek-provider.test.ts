import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DeepSeekProvider, M0_COST_PER_TOKEN_CNY, runDeepSeekSmoke } from "../src";

describe("DeepSeek provider", () => {
  it("parses a real-provider generation response and usage", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk-test-secret",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "你是测试助手。" },
          { role: "user", content: "写一句测试正文。" },
        ],
        stream: false,
      });
      expect(init?.redirect).toBe("error");
      return new Response(
        JSON.stringify({
          id: "deepseek-response-1",
          model: "deepseek-chat",
          choices: [{ message: { content: "山门外的雨停了。" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = new DeepSeekProvider({
      apiKey: "sk-test-secret",
      fetchImpl,
    });

    const result = await provider.generateText({
      prompt: "写一句测试正文。",
      system: "你是测试助手。",
      operation: "draft",
    });

    expect(result).toEqual({
      text: "山门外的雨停了。",
      model: "deepseek-chat",
      finishReason: "stop",
      usage: { inputTokens: 21, outputTokens: 8 },
      providerRequestId: "deepseek-response-1",
    });
  });

  it("skips the live smoke without a credential and never calls the network", async () => {
    const fetchImpl = vi.fn();

    const evidence = await runDeepSeekSmoke({
      env: {},
      fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: "skipped",
      reason: "DEEPSEEK_API_KEY_MISSING",
      provider: "deepseek",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a successful generation trace and cost without the credential", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "deepseek-smoke-response",
            model: "deepseek-chat",
            choices: [{ message: { content: "第一章测试通过。" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const evidence = await runDeepSeekSmoke({
      env: { DEEPSEEK_API_KEY: "sk-live-secret" },
      fetchImpl,
      now: () => new Date("2026-11-05T05:00:00.000Z"),
    });

    expect(evidence).toMatchObject({
      status: "succeeded",
      provider: "deepseek",
      model: "deepseek-chat",
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      cost: {
        estimatedCny: Number((40 * M0_COST_PER_TOKEN_CNY).toFixed(8)),
        pricingBasis: "m0-usage-baseline",
      },
      generation: {
        textHash: createHash("sha256").update("第一章测试通过。").digest("hex"),
        textLength: 8,
        finishReason: "stop",
      },
      providerResponseId: "deepseek-smoke-response",
    });
    expect(JSON.stringify(evidence)).not.toContain("sk-live-secret");
  });

  it("rejects provider errors without exposing the credential", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "sk-error-secret",
      fetchImpl: vi.fn(async () => new Response("denied", { status: 401 })),
    });

    await expect(provider.generateText({ prompt: "测试失败路径" })).rejects.toThrow(
      "DeepSeek request failed with status 401",
    );
    await expect(provider.generateText({ prompt: "测试失败路径" })).rejects.not.toThrow(
      "sk-error-secret",
    );
  });
});
