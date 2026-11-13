import { describe, expect, it } from "vitest";

import { sanitizeJobEventForDelivery } from "../src/logging/safe-job-event";

describe("SSE job event sensitive payload boundary", () => {
  it("keeps event ids and operational fields while dropping sensitive payloads", () => {
    const sanitized = sanitizeJobEventForDelivery({
      eventId: "01a1d573-fc63-7fd2-8e45-7ee8d05f9a3d",
      type: "job.failed",
      occurredAt: "2026-11-13T15:00:00.000Z",
      data: {
        code: "MODEL_FAILED",
        retryable: true,
        apiKey: "sk-sse-canary-133",
        prompt: "PROMPT_SSE_CANARY_133",
        manuscript: "沈砚把断臂藏进衣袍。",
        contextPack: { selected: ["CONTEXT_SSE_CANARY_133"] },
      },
    });
    const serialized = JSON.stringify(sanitized);

    expect(sanitized).toMatchObject({
      eventId: "01a1d573-fc63-7fd2-8e45-7ee8d05f9a3d",
      type: "job.failed",
      data: { code: "MODEL_FAILED", retryable: true },
    });
    expect(serialized).not.toContain("sk-sse-canary-133");
    expect(serialized).not.toContain("PROMPT_SSE_CANARY_133");
    expect(serialized).not.toContain("沈砚");
    expect(serialized).not.toContain("CONTEXT_SSE_CANARY_133");
  });
});
