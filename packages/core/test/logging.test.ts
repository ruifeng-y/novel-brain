import { describe, expect, it } from "vitest";

import {
  LogRedactionError,
  emitTraceEnvelope,
  findSensitiveLogValues,
  isSafeTelemetryMetricName,
  parseLogCanaryValues,
  resolveTracePolicy,
  sanitizeLogPayload,
  sanitizeLogPayloadStrict,
  sanitizeStructuredPayload,
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
      model: "deepseek-chat",
      nested: {
        content: "完整正文",
        contextPack: { selected: ["完整上下文"] },
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

  it("removes unknown fields and nested headers by default", () => {
    const sanitized = sanitizeLogPayload({
      event: "provider.request.failed",
      message: "沈砚把断臂藏进衣袍。",
      headers: { "x-api-key": "custom-provider-credential" },
      unknownNumber: 42,
      unknownBoolean: true,
      unknownNull: null,
    });
    const text = JSON.stringify(sanitized);

    expect(text).not.toContain("沈砚");
    expect(text).not.toContain("custom-provider-credential");
    expect(text).not.toContain("unknownNumber");
    expect(text).not.toContain("unknownBoolean");
    expect(text).not.toContain("unknownNull");
    expect(text).toContain("provider.request.failed");
  });

  it("does not treat arbitrary root or wrapper strings as safe log content", () => {
    const sanitized = sanitizeLogPayload({
      event: "provider.request.failed",
      error: "沈砚把断臂藏进衣袍。",
      reason: "This looks like an English manuscript sentence.",
    });

    expect(sanitizeLogPayload("沈砚把断臂藏进衣袍。")).toBe("[REDACTED]");
    expect(sanitizeLogPayload("free form english manuscript")).toBe("[REDACTED]");
    expect(sanitizeLogPayload({ key: "custom-provider-credential" })).toEqual({});
    expect(sanitizeStructuredPayload({ key: "custom-provider-credential" })).toEqual({});
    expect(
      JSON.stringify(
        sanitizeLogPayload({
          provider: "AIzaSyCustomProviderSecret133",
          status: "custom-provider-secret-ABCDEFGH",
        }),
      ),
    ).not.toContain("custom-provider");
    expect(sanitized).toEqual({ event: "provider.request.failed" });
  });

  it("keeps operational client error fields while stripping sensitive values", () => {
    const sanitized = sanitizeStructuredPayload({
      branchId: "01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
      tokenBudget: 200,
      failedDimensions: ["world_rules"],
      message: "沈砚把断臂藏进衣袍。",
      prompt: "PROMPT_STRUCTURED_CANARY_133",
      draftExcerpt: "DRAFT_STRUCTURED_CANARY_133",
      headers: { "x-api-key": "custom-provider-credential" },
      unknownNumber: 42,
      unknownBoolean: true,
      unknownNull: null,
      requiredTokens: 120,
      contextWindowTokens: 64,
      findings: ["RULE_CONFLICT"],
      items: [
        {
          key: "model_config",
          state: "missing",
          title: "DRAFT_STRUCTURED_CANARY_133",
        },
      ],
    });
    expect(sanitized).toMatchObject({
      branchId: "01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
      tokenBudget: 200,
      requiredTokens: 120,
      contextWindowTokens: 64,
      findings: ["RULE_CONFLICT"],
      items: [{ key: "model_config", state: "missing" }],
      failedDimensions: ["world_rules"],
      message: "[REDACTED]",
      prompt: "[REDACTED]",
    });
    expect(JSON.stringify(sanitized)).not.toContain("DRAFT_STRUCTURED_CANARY_133");
    expect(JSON.stringify(sanitized)).not.toContain("custom-provider-credential");
    expect(JSON.stringify(sanitized)).not.toContain("unknownNumber");
    expect(JSON.stringify(sanitized)).not.toContain("unknownBoolean");
    expect(JSON.stringify(sanitized)).not.toContain("unknownNull");
    expect(JSON.stringify(sanitized)).not.toContain("DRAFT_STRUCTURED_CANARY_133");
  });

  it("fails closed when a declared canary survives sanitization", () => {
    expect(() =>
      sanitizeLogPayloadStrict(
        { status: "CANARY_SURVIVES_133" },
        { canaryValues: ["CANARY_SURVIVES_133"] },
      ),
    ).toThrow(LogRedactionError);
    expect(
      sanitizeLogPayloadStrict(
        { MANUSCRIPT_CANARY_133: "safe-looking-value" },
        { canaryValues: ["MANUSCRIPT_CANARY_133"] },
      ),
    ).toEqual({});
    expect(() =>
      sanitizeLogPayloadStrict({ status: "queued" }, { canaryValues: ["status"] }),
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
    expect(() =>
      resolveTracePolicy({
        TRACE_MODE: "self_hosted",
        TRACE_RETENTION_DAYS: "14",
        TRACE_ENDPOINT: "https://third-party.example/otel",
      }),
    ).toThrow("self-hosted");
    expect(
      resolveTracePolicy({
        TRACE_MODE: "self_hosted",
        TRACE_RETENTION_DAYS: "14",
        TRACE_ENDPOINT: "https://[fd00::1]/otel",
      }).mode,
    ).toBe("self_hosted");
    expect(() =>
      resolveTracePolicy({
        TRACE_MODE: "self_hosted",
        TRACE_RETENTION_DAYS: "14",
        TRACE_ENDPOINT: "https://[2001:4860:4860::8888]/otel",
      }),
    ).toThrow("self-hosted");
  });

  it("emits traces only when explicitly self-hosted and never includes sensitive payloads", async () => {
    const calls: Array<{ url: string; body: string; redirect?: string }> = [];
    const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: String(init?.body ?? ""),
        redirect: init?.redirect,
      });
      return new Response("{}", { status: 202 });
    };

    expect(
      await emitTraceEnvelope(
        { mode: "off", retentionDays: null, endpoint: null },
        {
          name: "service.started",
          occurredAt: "2026-11-13T15:00:00.000Z",
          attributes: { service: "api" },
        },
        fetcher,
      ),
    ).toBe(false);

    expect(
      await emitTraceEnvelope(
        {
          mode: "self_hosted",
          retentionDays: 14,
          endpoint: "http://langfuse.internal:3000/api/public/otel",
        },
        {
          name: "service.started",
          occurredAt: "2026-11-13T15:00:00.000Z",
          attributes: {
            service: "api",
            prompt: "PROMPT_TRACE_CANARY_133",
            manuscript: "沈砚把断臂藏进衣袍。",
          },
        },
        fetcher,
      ),
    ).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("langfuse.internal");
    expect(calls[0]?.body).toContain('"retentionDays":14');
    expect(calls[0]?.redirect).toBe("error");
    expect(calls[0]?.body).not.toContain("PROMPT_TRACE_CANARY_133");
    expect(calls[0]?.body).not.toContain("沈砚");
    await expect(
      emitTraceEnvelope(
        {
          mode: "self_hosted",
          retentionDays: 14,
          endpoint: "http://langfuse.internal:3000/api/public/otel",
        },
        {
          name: "service.PROMPT_TRACE_CANARY_133",
          occurredAt: "2026-11-13T15:00:00.000Z",
        },
        fetcher,
      ),
    ).rejects.toThrow("name");
    await expect(
      emitTraceEnvelope(
        {
          mode: "self_hosted",
          retentionDays: 14,
          endpoint: "http://langfuse.internal:3000/api/public/otel",
        },
        {
          name: "service.started",
          occurredAt: "PROMPT_TRACE_CANARY_133",
        },
        fetcher,
      ),
    ).rejects.toThrow("timestamp");
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
        model: "author-private-model-name",
      }),
    ).toEqual({ route: "/api/v1/works", status: "500" });
    expect(
      sanitizeTelemetryLabels({
        route: "/api/v1/works/01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
      }),
    ).toEqual({});
    expect(
      sanitizeTelemetryLabels({
        route: "/api/v1/works/private-slug",
      }),
    ).toEqual({});
    expect(
      sanitizeTelemetryLabels({
        outcome: "private-model-name-133",
        provider: "AIzaSyCustomProviderSecret133",
      }),
    ).toEqual({});
    expect(isSafeTelemetryMetricName("worker.job.started")).toBe(true);
    expect(isSafeTelemetryMetricName("sk-live-secret-133")).toBe(false);
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
