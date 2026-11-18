import {
  decryptApiKey,
  DeepSeekProvider,
  FakeAiProvider,
  WRITING_ACTION_OPERATIONS,
  type AiGateway,
  type GenerationOperation,
} from "@novel-brain/ai";
import type { validateProviderEndpoint as ValidateProviderEndpoint } from "@novel-brain/ai";

export interface StoredModelConfig {
  provider: string;
  baseUrl: string;
  model: string;
  encryptedKey: string;
}

export type WorkerAiProviderMode = "fake" | "byok";

interface ByokAiGatewayFactoryOptions {
  mode: WorkerAiProviderMode;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  failOperations?: GenerationOperation[];
  endpointValidator?: typeof ValidateProviderEndpoint;
}

export class ByokAiGatewayFactory {
  constructor(private readonly options: ByokAiGatewayFactoryOptions) {}

  create(config: StoredModelConfig, runtime: { timeoutMs?: number } = {}): AiGateway {
    if (this.options.mode === "fake") {
      return new FakeAiProvider({
        ...(this.options.failOperations ? { failOperations: this.options.failOperations } : {}),
      });
    }
    if (config.provider !== "deepseek" && config.provider !== "openai-compatible") {
      throw new Error("Unsupported model provider");
    }
    const timeoutMs = runtime.timeoutMs ?? this.options.timeoutMs;
    return new DeepSeekProvider({
      apiKey: decryptApiKey(config.encryptedKey),
      baseUrl: config.baseUrl,
      model: config.model,
      provider: config.provider,
      openAiAllowlist: (process.env.MODEL_PROVIDER_ALLOWLIST ?? "")
        .split(",")
        .map((value) => value.trim().replace(/\/$/, ""))
        .filter(Boolean),
      ...(this.options.endpointValidator
        ? { endpointValidator: this.options.endpointValidator }
        : {}),
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
  }
}

export function resolveWorkerAiProviderMode(
  env: Record<string, string | undefined>,
): WorkerAiProviderMode {
  if (env.AI_PROVIDER_MODE === "fake") {
    return "fake";
  }
  if (env.AI_PROVIDER_MODE === "byok") {
    return "byok";
  }
  return env.NODE_ENV === "test" ? "fake" : "byok";
}

export function isFakeGenerationOperation(value: string): value is GenerationOperation {
  return ["draft", "verify", "revise", ...WRITING_ACTION_OPERATIONS].includes(
    value as GenerationOperation,
  );
}
