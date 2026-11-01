export interface GenerateTextInput {
  prompt: string;
  model?: string;
}

export interface GenerateTextResult {
  text: string;
  model: string;
}

export interface AiGateway {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}

export class FakeAiGateway implements AiGateway {
  constructor(private readonly response = 'fake response') {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    return {
      text: `${this.response}:${input.prompt}`,
      model: input.model ?? 'fake',
    };
  }
}
