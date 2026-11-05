import { encryptApiKey } from "@novel-brain/ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ByokAiGatewayFactory,
  resolveWorkerAiProviderMode,
} from "../src/generation/model-provider.factory";

describe("BYOK model provider factory", () => {
  const originalEncryptionKey = process.env.MODEL_CONFIG_ENCRYPTION_KEY;
  const originalAllowLocal = process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY;

  beforeEach(() => {
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = "true";
  });

  afterEach(() => {
    process.env.MODEL_CONFIG_ENCRYPTION_KEY = originalEncryptionKey;
    process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY = originalAllowLocal;
  });

  it("uses the stored provider, model and base URL with the decrypted key", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://models.example.com/v1/chat/completions");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer sk-worker-byok-9876",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "custom-writer-v2",
      });
      return new Response(
        JSON.stringify({
          model: "custom-writer-v2",
          choices: [{ message: { content: "配置已生效。" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const factory = new ByokAiGatewayFactory({ mode: "byok", fetchImpl });
    const gateway = factory.create({
      provider: "openai-compatible",
      baseUrl: "https://models.example.com/v1",
      model: "custom-writer-v2",
      encryptedKey: encryptApiKey("sk-worker-byok-9876"),
    });

    await expect(gateway.generateText({ prompt: "写一章" })).resolves.toMatchObject({
      text: "配置已生效。",
      model: "custom-writer-v2",
      usage: { inputTokens: 12, outputTokens: 4 },
    });
  });

  it("uses deterministic fake mode for compose and tests without decrypting the key", async () => {
    const fetchImpl = vi.fn();
    const factory = new ByokAiGatewayFactory({ mode: "fake", fetchImpl });
    const gateway = factory.create({
      provider: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      encryptedKey: "not-a-real-encrypted-key",
    });

    await expect(
      gateway.generateText({ prompt: "第一章", operation: "draft" }),
    ).resolves.toMatchObject({
      model: "fake-deterministic",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolveWorkerAiProviderMode({ AI_PROVIDER_MODE: "fake" })).toBe("fake");
    expect(resolveWorkerAiProviderMode({ NODE_ENV: "test" })).toBe("fake");
    expect(resolveWorkerAiProviderMode({ NODE_ENV: "production" })).toBe("byok");
  });
});
