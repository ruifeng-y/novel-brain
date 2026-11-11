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
        message: "API Key sk-invalid-key-4321 was rejected",
      },
      `Error: ${arbitraryStackKey} was rejected\n    at testConnection (apps/api/src/model-config/connection-tester.ts:42:9)`,
    );

    const output = writes.join("");
    expect(output).toContain("model-config.connection.failed");
    expect(output).toContain("connection-tester.ts:42:9");
    expect(output).not.toContain("sk-invalid-key-4321");
    expect(output).not.toContain(arbitraryStackKey);
  });
});
