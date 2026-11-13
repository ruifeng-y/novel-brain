import { describe, expect, it } from "vitest";

import {
  LogRedactionError,
  findSensitiveLogValues,
  parseLogCanaryValues,
  resolveTracePolicy,
  sanitizeLogPayload,
  sanitizeLogPayloadStrict,
  sanitizeTelemetryLabels,
} from "../src";

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

  it("redacts manuscript, prompt and imported-source aliases", () => {
    const sanitized = sanitizeLogPayload({
      manuscriptText: "沈砚把断臂藏进衣袍。",
      promptText: "PROMPT_CANARY_133",
      contextSnapshot: { selected: ["CONTEXT_CANARY_133"] },
      importedSource: "IMPORT_CANARY_133",
      chapterBody: "CHAPTER_CANARY_133",
      contentHash: "safe-hash",
    });
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain("沈砚");
    expect(text).not.toContain("PROMPT_CANARY_133");
    expect(text).not.toContain("CONTEXT_CANARY_133");
    expect(text).not.toContain("IMPORT_CANARY_133");
    expect(text).not.toContain("CHAPTER_CANARY_133");
    expect(text).toContain("safe-hash");
  });

  it("fails closed when a declared canary survives sanitization", () => {
    expect(() =>
      sanitizeLogPayloadStrict(
        { message: "ordinary text", metadata: { value: "CANARY_SURVIVES_133" } },
        { canaryValues: ["CANARY_SURVIVES_133"] },
      ),
    ).toThrow(LogRedactionError);
  });

  it("defaults tracing off and requires explicit self-hosted policy", () => {
    expect(resolveTracePolicy({})).toEqual({
      mode: "off",
      retentionDays: null,
      endpoint: null,
    });
    expect(
      resolveTracePolicy({
        TRACE_MODE: "self_hosted",
        TRACE_RETENTION_DAYS: "14",
        TRACE_ENDPOINT: "http://langfuse.internal:3000/api/public/otel",
      }),
    ).toEqual({
      mode: "self_hosted",
      retentionDays: 14,
      endpoint: "http://langfuse.internal:3000/api/public/otel",
    });
    expect(() => resolveTracePolicy({ TRACE_MODE: "self_hosted" })).toThrow("TRACE_RETENTION_DAYS");
    expect(() =>
      resolveTracePolicy({
        TRACE_MODE: "off",
        TRACE_ENDPOINT: "https://third-party.example",
      }),
    ).toThrow("TRACE_MODE");
  });

  it("drops sensitive and high-cardinality telemetry labels", () => {
    expect(
      sanitizeTelemetryLabels({
        route: "/api/v1/works",
        status: "500",
        api_key: "sk-should-not-appear-133",
        request_id: "req_dynamic_133",
        manuscript_text: "沈砚把断臂藏进衣袍。",
        surprise: "dynamic-value",
      }),
    ).toEqual({ route: "/api/v1/works", status: "500" });
  });

  it("parses deployment canaries from JSON or comma-separated configuration", () => {
    expect(parseLogCanaryValues('["KEY_CANARY_133","PROMPT_CANARY_133"]')).toEqual([
      "KEY_CANARY_133",
      "PROMPT_CANARY_133",
    ]);
    expect(parseLogCanaryValues("KEY_CANARY_133,MANUSCRIPT_CANARY_133")).toEqual([
      "KEY_CANARY_133",
      "MANUSCRIPT_CANARY_133",
    ]);
  });
});
