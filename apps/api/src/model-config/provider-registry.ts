import { ProviderEndpointValidationError, validateProviderEndpoint } from "@novel-brain/ai";
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
  try {
    const result = await validateProviderEndpoint({
      provider: input.provider,
      baseUrl: input.baseUrl,
      openAiAllowlist: openAiAllowlist(),
    });
    return result.addresses;
  } catch (error) {
    if (!(error instanceof ProviderEndpointValidationError)) {
      throw error;
    }
    if (error.code === "MALFORMED_URL") {
      throw new ApiError(400, "VALIDATION_INVALID", "Base URL 格式无效");
    }
    if (error.code === "HTTPS_REQUIRED") {
      throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 必须使用 HTTPS");
    }
    if (error.code === "PROVIDER_NOT_ALLOWED") {
      throw new ApiError(
        400,
        "MODEL_CONNECTION_FAILED",
        input.provider === "deepseek" ? "DeepSeek 必须使用官方 Base URL" : "该服务商未加入白名单",
      );
    }
    throw new ApiError(400, "MODEL_CONNECTION_FAILED", "Base URL 不得指向本地或私有网络");
  }
}
