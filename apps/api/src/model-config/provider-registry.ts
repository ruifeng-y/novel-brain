import { ApiError } from "../common/api-error";
import type { ModelConfigInput, ModelProviderInfo } from "@novel-brain/contracts";

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
      models: ["deepseek-chat", "deepseek-reasoner"],
    },
  ];
  for (const baseUrl of openAiAllowlist()) {
    providers.push({
      key: "openai-compatible",
      label: `OpenAI 兼容 · ${new URL(baseUrl).host}`,
      defaultBaseUrl: baseUrl,
      models: ["custom"],
    });
  }
  return providers;
}

export function validateProviderConfig(
  input: Pick<ModelConfigInput, "provider" | "baseUrl">,
): void {
  let url: URL;
  try {
    url = new URL(input.baseUrl);
  } catch {
    throw new ApiError(400, "VALIDATION_INVALID", "Base URL 格式无效");
  }
  if (url.protocol !== "https:") {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 必须使用 HTTPS");
  }
  if (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
    /^(fc|fd|fe80:)/i.test(url.hostname)
  ) {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 不得指向本地或私有网络");
  }

  const normalized = input.baseUrl.replace(/\/$/, "");
  if (input.provider === "deepseek" && normalized !== DEEPSEEK_BASE_URL) {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "DeepSeek 必须使用官方 Base URL");
  }
  if (input.provider === "openai-compatible" && !openAiAllowlist().includes(normalized)) {
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "该 Provider 未加入白名单");
  }
}
