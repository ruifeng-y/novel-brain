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
  const dataKey = randomBytes(32);
  const encryptedKey = encryptWithKey(apiKey, dataKey);
  const wrappedDataKey = encryptWithKey(dataKey.toString("base64"), encryptionKey());
  return JSON.stringify({ version: 1, wrappedDataKey, encryptedKey });
}

export function decryptApiKey(encrypted: string): string {
  let envelope: { version?: number; wrappedDataKey?: string; encryptedKey?: string };
  try {
    envelope = JSON.parse(encrypted) as typeof envelope;
  } catch {
    throw new Error("Invalid encrypted model key");
  }
  if (envelope.version !== 1 || !envelope.wrappedDataKey || !envelope.encryptedKey) {
    throw new Error("Invalid encrypted model key");
  }
  const dataKey = Buffer.from(decryptWithKey(envelope.wrappedDataKey, encryptionKey()), "base64");
  return decryptWithKey(envelope.encryptedKey, dataKey);
}

function encryptWithKey(value: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptWithKey(encrypted: string, key: Buffer): string {
  const [ivValue, tagValue, ciphertextValue] = encrypted.split(".");
  if (!ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Invalid encrypted model key");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskApiKey(apiKey: string): string {
  return apiKey.length >= 8 ? `****${apiKey.slice(-4)}` : "****";
}
