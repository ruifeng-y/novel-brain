import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type RandomUuid = () => string;

export function createRequestId(generateUuid: RandomUuid = randomUUID): string {
  return `req_${generateUuid()}`;
}

export function elapsedMilliseconds(startedAt: bigint): number {
  const elapsedNanoseconds = process.hrtime.bigint() - startedAt;
  return Math.round(Number(elapsedNanoseconds) / 100_000) / 10;
}

export function signClientIp(ip: string, secret: string): string {
  const encodedIp = Buffer.from(ip, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedIp).digest("base64url");
  return `${encodedIp}.${signature}`;
}

export function verifyClientIp(value: string | undefined, secret: string): string | null {
  if (!value) {
    return null;
  }
  const separator = value.lastIndexOf(".");
  if (separator <= 0) {
    return null;
  }
  const encodedIp = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(encodedIp).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  return Buffer.from(encodedIp, "base64url").toString("utf8");
}

export function resolveProxyIpSecret(
  secret: string | undefined,
  allowInsecureLocal: string | undefined,
): string {
  const localSecret = "local-development-proxy-ip-secret";
  const insecureSecrets = new Set([localSecret, "change-me-in-production"]);
  if (secret && (!insecureSecrets.has(secret) || allowInsecureLocal === "true")) {
    return secret;
  }
  if (allowInsecureLocal === "true") {
    return localSecret;
  }
  throw new Error("PROXY_IP_SECRET must be configured with a non-default secret");
}
