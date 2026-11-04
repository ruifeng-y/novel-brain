import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { ModelConfigInput, ModelProviderInfo } from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

function openAiAllowlist(): string[] {
  return (process.env.MODEL_PROVIDER_ALLOWLIST ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function listProviders(): ModelProviderInfo[] {
  const providers: ModelProviderInfo[] = [
    {
      key: "deepseek",
      label: "DeepSeek 官方 API",
      defaultBaseUrl: DEEPSEEK_BASE_URL,
      baseUrls: [DEEPSEEK_BASE_URL],
      models: ["deepseek-chat", "deepseek-reasoner"],
    },
  ];
  const allowlist = openAiAllowlist();
  if (allowlist.length > 0) {
    providers.push({
      key: "openai-compatible",
      label: "OpenAI 兼容白名单",
      defaultBaseUrl: allowlist[0] ?? "",
      baseUrls: allowlist,
      models: ["custom"],
    });
  }
  return providers;
}

export async function validateProviderConfig(
  input: Pick<ModelConfigInput, "provider" | "baseUrl">,
): Promise<string[]> {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new ApiError(400, "VALIDATION_INVALID", "Base URL 格式无效");
  }
  if (url.protocol !== "https:") {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 必须使用 HTTPS");
  }

  const normalized = input.baseUrl.replace(/\/$/, "");
  if (input.provider === "deepseek" && normalized !== DEEPSEEK_BASE_URL) {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "DeepSeek 必须使用官方 Base URL");
  }
  if (input.provider === "openai-compatible" && !openAiAllowlist().includes(normalized)) {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "该服务商未加入白名单");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost") {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 不得指向本地网络");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 不得指向本地或私有网络");
  }
  return addresses.map(({ address }) => address);
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
