import { describe, expect, it } from "vitest";
import type { JobEvent } from "@novel-brain/contracts";

import { sanitizeJobEventForDelivery } from "../src/logging/safe-job-event";

describe("SSE job event sensitive payload boundary", () => {
  it("redacts each sensitive field while preserving operational event data", () => {
    const sanitized = sanitizeJobEventForDelivery(
      {
        eventId: "01a1d573-fc63-7fd2-8e45-7ee8d05f9a3d",
        type: "job.failed",
        occurredAt: "2026-11-13T15:00:00.000Z",
        data: {
          code: "MODEL_FAILED",
          status: "failed",
          apiKey: "sk-sse-independent-133",
          prompt: "PROMPT_SSE_INDEPENDENT_133",
          manuscript: "沈砚把断臂藏进衣袍。",
          message: "MESSAGE_SSE_CANARY_133",
          cost: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costCny: 0.01 },
          unknownNumber: 42,
          unknownBoolean: true,
          unknownNull: null,
        },
      },
      [],
    );

    expect(sanitized.data).toMatchObject({
      code: "MODEL_FAILED",
      status: "failed",
      apiKey: "[REDACTED]",
      prompt: "[REDACTED]",
      manuscript: "[REDACTED]",
      message: "[REDACTED]",
      cost: { inputTokens: 10, outputTokens: 20, totalTokens: 30, costCny: 0.01 },
    });
    expect(sanitized.data).not.toHaveProperty("unknownNumber");
    expect(sanitized.data).not.toHaveProperty("unknownBoolean");
    expect(sanitized.data).not.toHaveProperty("unknownNull");
  });

  it("keeps event ids and operational fields while dropping sensitive payloads", () => {
    const promptCanary = "PROMPT_SSE_CANARY_133";
    process.env.LOG_CANARY_VALUES = JSON.stringify([promptCanary]);
    let sanitized: JobEvent;
    try {
      sanitized = sanitizeJobEventForDelivery({
        eventId: "01a1d573-fc63-7fd2-8e45-7ee8d05f9a3d",
        type: "job.failed",
        occurredAt: "2026-11-13T15:00:00.000Z",
        data: {
          code: "MODEL_FAILED",
          retryable: true,
          apiKey: "sk-sse-canary-133",
          prompt: promptCanary,
          manuscript: "沈砚把断臂藏进衣袍。",
          contextPack: { selected: ["CONTEXT_SSE_CANARY_133"] },
          status: promptCanary,
        },
      });
    } finally {
      delete process.env.LOG_CANARY_VALUES;
    }
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toMatchObject({
      eventId: "01a1d573-fc63-7fd2-8e45-7ee8d05f9a3d",
      type: "job.failed",
      data: { code: "SENSITIVE_PAYLOAD_REDACTED" },
    });
    expect(serialized).not.toContain("sk-sse-canary-133");
    expect(serialized).not.toContain("PROMPT_SSE_CANARY_133");
    expect(serialized).not.toContain("沈砚");
    expect(serialized).not.toContain("CONTEXT_SSE_CANARY_133");
  });
});
