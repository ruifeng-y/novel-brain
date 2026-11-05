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
