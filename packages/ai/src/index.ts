export interface GenerationRequest {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
}

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
  async generateText(input: GenerationRequest): Promise<GenerationResult> {
    const model = input.model ?? "fake-deterministic";
    const fingerprint = stableHash(`${input.system ?? ""}\n${input.prompt}`);
    const text = `fake:${fingerprint}:${input.prompt}`;

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
