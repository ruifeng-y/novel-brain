import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { decryptApiKey, encryptApiKey, maskApiKey } from "../src";

describe("model config key encryption", () => {
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

  it("round-trips a BYOK key without exposing plaintext in the envelope", () => {
    const encrypted = encryptApiKey("sk-byok-secret-1234");

    expect(encrypted).not.toContain("sk-byok-secret-1234");
    expect(decryptApiKey(encrypted)).toBe("sk-byok-secret-1234");
    expect(maskApiKey("sk-byok-secret-1234")).toBe("****1234");
  });
});
