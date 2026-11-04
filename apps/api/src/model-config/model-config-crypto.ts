import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const configured = process.env.MODEL_CONFIG_ENCRYPTION_KEY;
  const local = "0123456789abcdef0123456789abcdef";
  const allowLocal = process.env.ALLOW_INSECURE_LOCAL_MODEL_KEY === "true";
  const value = configured && (configured !== local || allowLocal) ? configured : local;
  if (!configured && !allowLocal) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY is required");
  }
  if (!allowLocal && configured === local) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY must not use the local default");
  }
  const key = Buffer.from(value, "utf8");
  if (key.length !== 32) {
    throw new Error("MODEL_CONFIG_ENCRYPTION_KEY must be 32 bytes");
  }
  return key;
}

export function encryptApiKey(apiKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptApiKey(encrypted: string): string {
  const [ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Invalid encrypted model key");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskApiKey(apiKey: string): string {
  return apiKey.length >= 8 ? `****${apiKey.slice(-4)}` : "****";
}
