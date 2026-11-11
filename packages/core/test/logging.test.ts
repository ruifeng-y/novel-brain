import { describe, expect, it } from "vitest";

import { findSensitiveLogValues, sanitizeLogPayload } from "../src";

describe("sensitive log sanitization", () => {
  it("redacts API keys, prompts, manuscript and full context before logging", () => {
    const key = "sk-live-this-must-never-appear-1234";
    const sanitized = sanitizeLogPayload({
      event: "generation.model_call.succeeded",
      jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1f01",
      apiKey: key,
      authorization: `Bearer ${key}`,
      prompt: "完整提示词与上下文",
      system: "系统提示",
      manuscript: "沈砚把断臂藏进衣袍。",
      nested: {
        content: "完整正文",
        contextPack: { selected: ["完整上下文"] },
        safeModel: "deepseek-chat",
      },
    });

    const text = JSON.stringify(sanitized);
    expect(text).not.toContain(key);
    expect(text).not.toContain("完整提示词");
    expect(text).not.toContain("沈砚");
    expect(text).not.toContain("完整正文");
    expect(text).not.toContain("完整上下文");
    expect(text).toContain("deepseek-chat");
    expect(findSensitiveLogValues(sanitized)).toEqual([]);
  });

  it("detects embedded keys and bearer credentials inside strings", () => {
    const payload = {
      message: "provider failed with key sk-embedded-secret-9999",
      header: "Bearer abcdefghijklmnop",
    };
    const sanitized = sanitizeLogPayload(payload);
    expect(findSensitiveLogValues(sanitized)).toEqual([]);
    expect(JSON.stringify(sanitized)).not.toContain("sk-embedded-secret-9999");

    expect(
      findSensitiveLogValues({
        message: "key sk-embedded-secret-9999",
      }),
    ).not.toEqual([]);
  });
});
