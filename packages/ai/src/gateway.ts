export type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

export type GenerateTextInput = {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

export type GenerateTextResult = {
  text: string;
  model: string;
  usage?: AiUsage;
};

export type StreamTextChunk = {
  text: string;
  usage?: AiUsage;
};

export interface AiGateway {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  streamText(input: GenerateTextInput): AsyncIterable<StreamTextChunk>;
}

export const AI_GATEWAY = 'AI_GATEWAY';

export class AiGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message);
    this.name = 'AiGatewayError';
  }
}

export type FakeAiGatewayOptions = {
  mode?: 'default' | 'chapter';
  response?: string;
  responseFactory?: (input: GenerateTextInput) => string;
  chunkSize?: number;
  delayMs?: number;
  failAfterChunks?: number;
};

const FAILURE_MARKER = '[[FAIL_AFTER_PARTIAL]]';

export class FakeAiGateway implements AiGateway {
  constructor(private readonly options: FakeAiGatewayOptions = {}) {}

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    let text = '';
    for await (const chunk of this.streamText(input)) {
      text += chunk.text;
    }
    return {
      text,
      model: input.model ?? 'fake',
    };
  }

  async *streamText(input: GenerateTextInput): AsyncIterable<StreamTextChunk> {
    const text = this.resolveText(input);
    const chunkSize = Math.max(1, this.options.chunkSize ?? 120);
    const chunks = Array.from(
      { length: Math.ceil(text.length / chunkSize) },
      (_, index) => text.slice(index * chunkSize, (index + 1) * chunkSize),
    );
    const failAfterChunks = input.prompt.includes(FAILURE_MARKER)
      ? (this.options.failAfterChunks ?? 4)
      : undefined;

    for (let index = 0; index < chunks.length; index += 1) {
      if (failAfterChunks !== undefined && index >= failAfterChunks) {
        throw new AiGatewayError(
          'MODEL_GENERATION_FAILED',
          'The model stopped before the chapter was complete',
        );
      }
      if (this.options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
      }
      yield { text: chunks[index] };
    }
  }

  private resolveText(input: GenerateTextInput): string {
    if (this.options.responseFactory) {
      return this.options.responseFactory(input);
    }
    if (this.options.response !== undefined) {
      return this.options.response;
    }
    if (this.options.mode === 'chapter') {
      return buildDeterministicChineseChapter();
    }
    return `fake response:${input.prompt}`;
  }
}

const CHAPTER_PARAGRAPHS = [
  '夜雨落在荒寺的瓦上，像无数细小的剑锋轻轻相击。沈砚靠在断墙边，左臂的旧伤被潮气一寸寸唤醒，连呼吸都带着铁锈般的疼。他把残剑横在膝上，剑身没有光，只有一道深得看不见底的裂纹。',
  '风从山门灌进来，卷起满地枯叶。沈砚忽然听见碑林深处传来一声极轻的剑鸣，那声音不像从耳朵里进去，倒像有人在记忆最深处敲了一下。他抬头时，断碑上的雨痕正缓慢地改换方向。',
  '他想起师父说过，残剑不认强者，只认愿意拿过去交换的人。那时他以为这不过是吓唬新弟子的旧话。直到第一道剑意沿着掌心钻进识海，一段关于母亲的记忆像被水浸透的纸，无声无息地缺了一角。',
  '沈砚没有松手。他知道自己一旦退开，今夜便再也找不到这块碑。剑身上的裂纹亮起，映出他苍白的脸，也映出一个并不存在于荒寺里的影子。那影子穿着旧青衫，站在他身后，像是等了很久。',
  '“你终于来了。”影子说。',
  '沈砚握住剑柄，掌心被锋刃割开，血没有落地，而是逆着雨丝向碑面流去。断碑上浮现出一行从未见过的字，字迹一笔一划都像从骨头里刻出来。他的太阳穴剧烈跳动，眼前同时闪过边城、雪夜和一道关上的门。',
  '那道门后有人在喊他的名字。声音很远，也很年轻。沈砚下意识向前一步，残剑却猛地一震，将他从记忆边缘拽了回来。他跪在泥水里，吐出一口带着寒意的血，才发现自己已经忘了那声呼唤是男是女。',
  '寺外忽然亮起火光。十余盏灯笼沿着山道逼近，灯影里没有脚步声，只有衣料擦过雨夜的轻响。沈砚把残剑收入袖中，左手却使不上力，只能用右手撑着断碑站起。',
  '为首的人在门外停住，隔着雨幕看了他很久。那人没有拔剑，只问：“碑上写了什么？”沈砚沉默片刻，答道：“什么也没有。”话音刚落，断碑后的黑暗里又响起第二声剑鸣。',
  '这一次，他听清了。那声音是在叫他回家。',
];

export function buildDeterministicChineseChapter(targetLength = 2400): string {
  let text = CHAPTER_PARAGRAPHS.join('\n\n');
  let index = 0;
  while (text.length < targetLength) {
    text += `\n\n${CHAPTER_PARAGRAPHS[index % CHAPTER_PARAGRAPHS.length]}`;
    index += 1;
  }
  return text.slice(0, targetLength);
}

export class DeepSeekAiGateway implements AiGateway {
  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    let text = '';
    let usage: AiUsage | undefined;
    for await (const chunk of this.streamText(input)) {
      text += chunk.text;
      usage = chunk.usage ?? usage;
    }
    return {
      text,
      model: input.model ?? 'deepseek-chat',
      ...(usage ? { usage } : {}),
    };
  }

  async *streamText(input: GenerateTextInput): AsyncIterable<StreamTextChunk> {
    if (!input.apiKey) {
      throw new AiGatewayError('MODEL_CONFIG_REQUIRED', 'A model API key is required');
    }
    if (!input.model) {
      throw new AiGatewayError('MODEL_CONFIG_REQUIRED', 'A model name is required');
    }

    const baseUrl = (input.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            ...(input.system
              ? [
                  {
                    role: 'system',
                    content: input.system,
                  },
                ]
              : []),
            { role: 'user', content: input.prompt },
          ],
          stream: true,
          ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
          ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        }),
        signal: input.signal,
      });
    } catch (error) {
      throw new AiGatewayError(
        'MODEL_NETWORK_ERROR',
        error instanceof Error ? error.message : 'The model provider could not be reached',
      );
    }

    if (!response.ok) {
      const code =
        response.status === 401 || response.status === 403
          ? 'INVALID_MODEL_KEY'
          : 'MODEL_GENERATION_FAILED';
      throw new AiGatewayError(code, `The model provider returned HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new AiGatewayError('MODEL_GENERATION_FAILED', 'The model returned an empty response');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }
          const data = trimmed.slice(5).trim();
          if (!data || data === '[DONE]') {
            continue;
          }
          const payload = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
            };
          };
          const text = payload.choices?.[0]?.delta?.content;
          if (text) {
            yield { text };
          }
          if (payload.usage) {
            yield {
              text: '',
              usage: {
                promptTokens: payload.usage.prompt_tokens,
                completionTokens: payload.usage.completion_tokens,
              },
            };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
