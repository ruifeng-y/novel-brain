import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

export type ProviderEndpointErrorCode =
  "MALFORMED_URL" | "HTTPS_REQUIRED" | "PROVIDER_NOT_ALLOWED" | "PRIVATE_NETWORK";

export class ProviderEndpointValidationError extends Error {
  constructor(readonly code: ProviderEndpointErrorCode) {
    super(code);
    this.name = "ProviderEndpointValidationError";
  }
}

export async function validateProviderEndpoint(input: {
  provider: "deepseek" | "openai-compatible";
  baseUrl: string;
  openAiAllowlist?: readonly string[];
  lookupHost?: typeof lookup;
}): Promise<{ normalizedBaseUrl: string; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new ProviderEndpointValidationError("MALFORMED_URL");
  }
  if (url.protocol !== "https:") {
    throw new ProviderEndpointValidationError("HTTPS_REQUIRED");
  }

  const normalized = input.baseUrl.replace(/\/$/, "");
  if (input.provider === "deepseek" && normalized !== DEEPSEEK_BASE_URL) {
    throw new ProviderEndpointValidationError("PROVIDER_NOT_ALLOWED");
  }
  if (
    input.provider === "openai-compatible" &&
    !(input.openAiAllowlist ?? []).includes(normalized)
  ) {
    throw new ProviderEndpointValidationError("PROVIDER_NOT_ALLOWED");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost") {
    throw new ProviderEndpointValidationError("PRIVATE_NETWORK");
  }
  const lookupHost = input.lookupHost ?? lookup;
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookupHost(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ProviderEndpointValidationError("PRIVATE_NETWORK");
  }
  return {
    normalizedBaseUrl: normalized,
    addresses: addresses.map(({ address }) => address),
  };
}

export function isPublicProviderAddress(address: string): boolean {
  return isPublicAddress(address);
}

export async function requestPinnedHttps(input: {
  target: URL;
  address: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}): Promise<{ status: number; body: Buffer }> {
  if (!isPublicProviderAddress(input.address)) {
    throw new ProviderEndpointValidationError("PRIVATE_NETWORK");
  }
  const lookupPinnedAddress = ((_hostname, _options, callback) => {
    callback(null, input.address, isIP(input.address) === 6 ? 6 : 4);
  }) as LookupFunction;
  const body = input.body ?? "";
  const headers = {
    ...(input.body === undefined
      ? {}
      : {
          "content-length": String(Buffer.byteLength(body)),
        }),
    ...input.headers,
    host: input.target.host,
  };
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      input.target,
      {
        method: input.method ?? "GET",
        headers,
        lookup: lookupPinnedAddress,
        servername: input.target.hostname,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            status: response.statusCode ?? 500,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    request.setTimeout(input.timeoutMs, () => {
      const error = new Error("Pinned HTTPS request timed out");
      error.name = "TimeoutError";
      request.destroy(error);
    });
    request.on("error", reject);
    request.end(input.body);
  });
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    const first = octets[0] ?? 0;
    const second = octets[1] ?? 0;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      first >= 224
    );
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) {
      return isPublicAddress(normalized.slice(7));
    }
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("fec") ||
      normalized.startsWith("fed") ||
      normalized.startsWith("fee") ||
      normalized.startsWith("fef") ||
      normalized.startsWith("ff")
    );
  }
  return false;
}
