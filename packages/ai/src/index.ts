import { createHash } from "node:crypto";

export interface GenerationRequest {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  operation?: GenerationOperation;
}

export type GenerationOperation = "draft" | "verify" | "revise";

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerationResult {
  text: string;
  model: string;
  finishReason: "stop";
  usage: GenerationUsage;
}

export interface GenerationChunk {
  text: string;
  done: boolean;
}

export interface AiGateway {
  generateText(input: GenerationRequest): Promise<GenerationResult>;
  streamText(input: GenerationRequest): AsyncIterable<GenerationChunk>;
}

export class AiProviderError extends Error {
  readonly code = "MODEL_PROVIDER_ERROR";

  constructor(message = "AI provider failed") {
    super(message);
    this.name = "AiProviderError";
  }
}

export const M0_COST_PER_TOKEN_CNY = 0.000002;

interface DeepSeekProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface DeepSeekResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export class DeepSeekProvider implements AiGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private lastResponseId: string | undefined;

  constructor(options: DeepSeekProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.defaultModel = options.model ?? "deepseek-chat";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    const model = input.model ?? this.defaultModel;
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          { role: "user", content: input.prompt },
        ],
        max_tokens: input.maxTokens ?? 2_000,
        stream: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const payload = (await response.json().catch(() => ({}))) as DeepSeekResponse;
    if (!response.ok) {
      throw new AiProviderError(`DeepSeek request failed with status ${response.status}`);
    }
    const text = payload.choices?.[0]?.message?.content;
    const inputTokens = payload.usage?.prompt_tokens;
    const outputTokens = payload.usage?.completion_tokens;
    if (
      typeof text !== "string" ||
      typeof inputTokens !== "number" ||
      typeof outputTokens !== "number"
    ) {
      throw new AiProviderError("DeepSeek returned an incomplete generation response");
    }
    this.lastResponseId = payload.id;
    return {
      text,
      model: payload.model ?? model,
      finishReason: "stop",
      usage: { inputTokens, outputTokens },
    };
  }

  async *streamText(input: GenerationRequest): AsyncIterable<GenerationChunk> {
    const result = await this.generateText(input);
    const middle = Math.ceil(result.text.length / 2);
    yield { text: result.text.slice(0, middle), done: false };
    yield { text: result.text.slice(middle), done: true };
  }

  getLastResponseId(): string | undefined {
    return this.lastResponseId;
  }
}

interface DeepSeekSmokeOptions {
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export type DeepSeekSmokeEvidence =
  | {
      status: "skipped";
      reason: "DEEPSEEK_API_KEY_MISSING";
      provider: "deepseek";
      checkedAt: string;
      networkCalls: 0;
    }
  | {
      status: "succeeded";
      provider: "deepseek";
      model: string;
      startedAt: string;
      finishedAt: string;
      latencyMs: number;
      generation: {
        textHash: string;
        textLength: number;
        finishReason: "stop";
      };
      usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
      };
      cost: {
        estimatedCny: number;
        pricingBasis: "m0-usage-baseline";
      };
      providerResponseId?: string;
      networkCalls: 1;
    };

export async function runDeepSeekSmoke(
  options: DeepSeekSmokeOptions,
): Promise<DeepSeekSmokeEvidence> {
  const now = options.now ?? (() => new Date());
  const apiKey = options.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) {
    return {
      status: "skipped",
      reason: "DEEPSEEK_API_KEY_MISSING",
      provider: "deepseek",
      checkedAt: now().toISOString(),
      networkCalls: 0,
    };
  }

  const startedAt = now();
  const provider = new DeepSeekProvider({
    apiKey,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  const result = await provider.generateText({
    system: "你是 NovelBrain M0 验收助手。只输出一句不超过三十字的仙侠正文。",
    prompt: "写一句包含山门、雨和一个人物的测试正文。",
    maxTokens: 64,
    operation: "draft",
  });
  const finishedAt = now();
  const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
  const providerResponseId = provider.getLastResponseId();

  return {
    status: "succeeded",
    provider: "deepseek",
    model: result.model,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    latencyMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    generation: {
      textHash: createHash("sha256").update(result.text).digest("hex"),
      textLength: Array.from(result.text).length,
      finishReason: result.finishReason,
    },
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens,
    },
    cost: {
      estimatedCny: Number((totalTokens * M0_COST_PER_TOKEN_CNY).toFixed(8)),
      pricingBasis: "m0-usage-baseline",
    },
    ...(providerResponseId ? { providerResponseId } : {}),
    networkCalls: 1,
  };
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export class FakeAiProvider implements AiGateway {
  constructor(private readonly options: { failOperations?: GenerationOperation[] } = {}) {}

  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    if (input.operation && this.options.failOperations?.includes(input.operation)) {
      throw new AiProviderError(`Fake provider failed during ${input.operation}`);
    }
    const model = input.model ?? "fake-deterministic";
    const fingerprint = stableHash(`${input.system ?? ""}\n${input.prompt}`);
    const text = input.operation
      ? operationText(input.operation, fingerprint)
      : `fake:${fingerprint}:${input.prompt}`;

    return {
      text,
      model,
      finishReason: "stop",
      usage: {
        inputTokens: estimateTokens(`${input.system ?? ""}${input.prompt}`),
        outputTokens: estimateTokens(text),
      },
    };
  }

  async *streamText(input: GenerationRequest): AsyncIterable<GenerationChunk> {
    const result = await this.generateText(input);
    const middle = Math.ceil(result.text.length / 2);

    yield { text: result.text.slice(0, middle), done: false };
    yield { text: result.text.slice(middle), done: true };
  }
}

function operationText(operation: GenerationOperation, fingerprint: string): string {
  if (operation === "verify") {
    return `审校通过：章纲、已确认设定和必用事实一致。指纹 ${fingerprint}`;
  }
  if (operation === "revise") {
    return [
      `修订稿 ${fingerprint}`,
      "血从袖口滴下来，落在荒寺外的青石板上。沈砚把断臂藏进衣袍，只用右手结印。",
      "顾青看见书页一角，却没有点破，只把追兵引向山道另一侧。",
      "风穿过残钟，沈砚记住这次代价，也记住了顾青没有说出口的疑问。",
    ].join("\n\n");
  }
  return [
    `生成草稿 ${fingerprint}`,
    "血从袖口滴下来，落在荒寺外的青石板上。沈砚把断臂藏进衣袍，只用右手结印。",
    "追兵逼近时，忘川书在暮色里短暂显形。顾青看见书页一角，却没有点破。",
    "风穿过残钟，沈砚记住了这一夜的代价。",
  ].join("\n\n");
}
