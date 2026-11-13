import { afterEach, describe, expect, it, vi } from "vitest";

import { AppLogger } from "../src/logging/app-logger";

describe("API logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts model key material from ordinary API error logs", () => {
    const writes: string[] = [];
    const arbitraryStackKey = "custom-provider-key-ABCDEFGH";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    new AppLogger().error(
      {
        event: "model-config.connection.failed",
        apiKey: "sk-invalid-key-4321",
        authorization: "Bearer sk-invalid-key-4321",
        manuscript: "沈砚把断臂藏进衣袍。",
        prompt: "PROMPT_API_CANARY_133",
        contextPack: { selected: ["CONTEXT_API_CANARY_133"] },
        message: "API Key sk-invalid-key-4321 was rejected",
      },
      `Error: ${arbitraryStackKey} was rejected\n    at testConnection (apps/api/src/model-config/connection-tester.ts:42:9)`,
    );

    const output = writes.join("");
    expect(output).toContain("model-config.connection.failed");
    expect(output).toContain("connection-tester.ts:42:9");
    expect(output).not.toContain("sk-invalid-key-4321");
    expect(output).not.toContain("沈砚");
    expect(output).not.toContain("PROMPT_API_CANARY_133");
    expect(output).not.toContain("CONTEXT_API_CANARY_133");
    expect(output).not.toContain(arbitraryStackKey);
  });

  it("drops the entire payload when declared canaries survive sanitization", () => {
    const writes: string[] = [];
    const canary = "API_LOG_CANARY_133";
    process.env.LOG_CANARY_VALUES = JSON.stringify([canary]);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      new AppLogger().log({
        event: "logging.canary",
        status: canary,
      });
    } finally {
      delete process.env.LOG_CANARY_VALUES;
    }

    const output = writes.join("");
    expect(output).toContain("logging.redaction_failed");
    expect(output).not.toContain(canary);
  });

  it("fails closed when sensitive logger context survives sanitization", () => {
    const writes: string[] = [];
    const canary = "CONTEXT_CANARY_133";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    new AppLogger({ canaryValues: [canary] }).log("safe message", canary);

    const output = writes.join("");
    expect(output).not.toContain(canary);
    expect(output).toContain("logging.redaction_failed");
  });
});
