import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { DeepSeekProvider, M0_COST_PER_TOKEN_CNY, runDeepSeekSmoke } from "../src";

const endpointValidator = vi.fn(async (input: { baseUrl: string }) => ({
  normalizedBaseUrl: input.baseUrl.replace(/\/$/, ""),
  addresses: ["93.184.216.34"],
}));

describe("DeepSeek provider", () => {
  it("requests JSON object mode for structured blueprint output", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        response_format: { type: "json_object" },
      });
      return new Response(
        JSON.stringify({
          model: "deepseek-chat",
          choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = new DeepSeekProvider({
      apiKey: "sk-test-secret",
      fetchImpl,
      endpointValidator,
    });

    await provider.generateText({
      prompt: "输出故事蓝图。",
      operation: "blueprint_story_bible",
      responseFormat: "json",
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

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
      endpointValidator,
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

  it("preserves the requested-model fallback for ordinary provider calls", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "sk-test-secret",
      model: "deepseek-chat",
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "普通生成成功。" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 5, completion_tokens: 3 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
      endpointValidator,
    });

    await expect(provider.generateText({ prompt: "普通生成" })).resolves.toMatchObject({
      model: "deepseek-chat",
    });
  });

  it("uses the validated public address for the production request", async () => {
    const pinnedRequest = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "pinned-response",
            model: "deepseek-chat",
            choices: [{ message: { content: "固定地址成功。" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
    );
    const provider = new DeepSeekProvider({
      apiKey: "sk-pinned-secret",
      endpointValidator: async (input) => ({
        normalizedBaseUrl: input.baseUrl.replace(/\/$/, ""),
        addresses: ["93.184.216.34"],
      }),
      pinnedRequest,
    });

    await provider.generateText({ prompt: "写一段" });

    expect(pinnedRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "93.184.216.34",
        baseUrl: "https://api.deepseek.com",
      }),
    );
  });

  it("skips the live smoke without a credential and never calls the network", async () => {
    const fetchImpl = vi.fn();

    const evidence = await runDeepSeekSmoke({
      env: { DEEPSEEK_SMOKE_ENABLED: "1" },
      fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: "skipped",
      reason: "DEEPSEEK_API_KEY_MISSING",
      provider: "deepseek",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips the live smoke unless explicitly enabled", async () => {
    const fetchImpl = vi.fn();

    const evidence = await runDeepSeekSmoke({
      env: { DEEPSEEK_API_KEY: "sk-live-secret" },
      fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: "skipped",
      reason: "DEEPSEEK_SMOKE_DISABLED",
      provider: "deepseek",
      networkCalls: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a successful generation trace and cost without the credential", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "deepseek-smoke-response",
            model: "deepseek-flash",
            choices: [{ message: { content: "第一章测试通过。" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
      },
      fetchImpl,
      endpointValidator,
      now: () => new Date("2026-11-05T05:00:00.000Z"),
    });

    expect(evidence).toMatchObject({
      status: "succeeded",
      provider: "deepseek",
      requestedModel: "deepseek-chat",
      responseModel: "deepseek-flash",
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
      promptVersion: "m1-writing-prompts-v1",
      configVersion: "deepseek-default-v1",
      attempts: 1,
    });
    expect(JSON.stringify(evidence)).not.toContain("sk-live-secret");
    expect(JSON.stringify(evidence)).not.toContain("写一句包含山门");
  });

  it("blocks before the network when the configured smoke budget is too low", async () => {
    const fetchImpl = vi.fn();

    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0",
      },
      fetchImpl,
    });

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "budget",
      reason: "DEEPSEEK_SMOKE_BUDGET_EXCEEDED",
      networkCalls: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records an actual-cost overrun as a failed smoke outcome", async () => {
    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.001",
      },
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "deepseek-overrun-response",
              model: "deepseek-chat",
              choices: [{ message: { content: "超预算。" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 800, completion_tokens: 400, total_tokens: 1_200 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
      endpointValidator,
    });

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "budget",
      reason: "DEEPSEEK_SMOKE_BUDGET_EXCEEDED",
      networkCalls: 1,
    });
  });

  it("rejects non-official or private smoke endpoints before network access", async () => {
    const fetchImpl = vi.fn();
    for (const baseUrl of ["https://127.0.0.1/v1", "http://api.deepseek.com"]) {
      const evidence = await runDeepSeekSmoke({
        env: {
          DEEPSEEK_SMOKE_ENABLED: "1",
          DEEPSEEK_API_KEY: "sk-live-secret",
          DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
          DEEPSEEK_BASE_URL: baseUrl,
        },
        fetchImpl,
      });
      expect(evidence).toMatchObject({
        status: "failed",
        reason: "DEEPSEEK_BASE_URL_INVALID",
        networkCalls: 0,
      });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries rate limits within the configured hard bound", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "deepseek-retry-response",
            model: "deepseek-chat",
            choices: [{ message: { content: "重试成功。" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
        DEEPSEEK_SMOKE_MAX_ATTEMPTS: "2",
      },
      fetchImpl,
      endpointValidator,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(evidence).toMatchObject({
      status: "succeeded",
      attempts: 2,
      networkCalls: 2,
      providerRequestId: "deepseek-retry-response",
    });
  });

  it("records a sanitized failed outcome instead of throwing a provider error", async () => {
    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
      },
      fetchImpl: vi.fn(async () => new Response("denied", { status: 401 })),
      endpointValidator,
    });

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "policy",
      networkCalls: 1,
      attempts: 1,
    });
    expect(JSON.stringify(evidence)).not.toContain("sk-live-secret");
  });

  it("classifies a bounded timeout without retrying indefinitely", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    });

    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
        DEEPSEEK_SMOKE_MAX_ATTEMPTS: "3",
        DEEPSEEK_SMOKE_TIMEOUT_MS: "1000",
      },
      fetchImpl,
      endpointValidator,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "timeout",
      attempts: 1,
      timeoutMs: 1_000,
    });
  });

  it("does not report truncated provider output as a successful smoke", async () => {
    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
      },
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "deepseek-truncated",
              model: "deepseek-flash",
              choices: [{ message: { content: "未完成" }, finish_reason: "length" }],
              usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
      endpointValidator,
    });

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "provider",
      requestedModel: "deepseek-chat",
      responseModel: "deepseek-flash",
      attempts: 1,
      costCny: Number((14 * M0_COST_PER_TOKEN_CNY).toFixed(8)),
      networkCalls: 1,
    });
  });

  it("does not treat a missing provider response model as the requested identity", async () => {
    const evidence = await runDeepSeekSmoke({
      env: {
        DEEPSEEK_SMOKE_ENABLED: "1",
        DEEPSEEK_API_KEY: "sk-live-secret",
        DEEPSEEK_SMOKE_MAX_BUDGET_CNY: "0.01",
      },
      fetchImpl: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "deepseek-model-missing",
              choices: [{ message: { content: "模型身份缺失。" }, finish_reason: "stop" }],
              usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
      endpointValidator,
    });

    expect(evidence).toMatchObject({
      status: "failed",
      failureClass: "schema",
      requestedModel: "deepseek-chat",
      attempts: 1,
      networkCalls: 1,
    });
    expect(evidence).not.toHaveProperty("responseModel");
  });

  it("rejects a private endpoint before a provider request can carry the credential", async () => {
    const fetchImpl = vi.fn();
    const provider = new DeepSeekProvider({
      apiKey: "sk-private-endpoint-secret",
      baseUrl: "https://127.0.0.1/v1",
      provider: "openai-compatible",
      openAiAllowlist: ["https://127.0.0.1/v1"],
      fetchImpl,
    });

    await expect(provider.generateText({ prompt: "写一段" })).rejects.toMatchObject({
      code: "PRIVATE_NETWORK",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects provider errors without exposing the credential", async () => {
    const provider = new DeepSeekProvider({
      apiKey: "sk-error-secret",
      fetchImpl: vi.fn(async () => new Response("denied", { status: 401 })),
      endpointValidator,
    });

    await expect(provider.generateText({ prompt: "测试失败路径" })).rejects.toThrow(
      "DeepSeek request failed with status 401",
    );
    await expect(provider.generateText({ prompt: "测试失败路径" })).rejects.not.toThrow(
      "sk-error-secret",
    );
  });
});
