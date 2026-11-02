import { countCjkCharacters, isCjkIdeograph, type ExtractedFact } from '@novel/contracts';

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

export type GenerateObjectInput<T> = GenerateTextInput & {
  schemaName: string;
  schemaDescription: string;
  jsonSchema: Record<string, unknown>;
  parse: (value: unknown) => T;
};

export type GenerateObjectResult<T> = {
  object: T;
  model: string;
  usage?: AiUsage;
};

export interface AiGateway {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  streamText(input: GenerateTextInput): AsyncIterable<StreamTextChunk>;
  generateObject<T>(input: GenerateObjectInput<T>): Promise<GenerateObjectResult<T>>;
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
  objectFactory?: (input: GenerateObjectInput<unknown>) => unknown;
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
    const chunks = Array.from({ length: Math.ceil(text.length / chunkSize) }, (_, index) =>
      text.slice(index * chunkSize, (index + 1) * chunkSize),
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
      if (index === chunks.length - 1) {
        yield {
          text: '',
          usage: {
            promptTokens: Math.max(1, Math.ceil(`${input.system ?? ''}${input.prompt}`.length / 2)),
            completionTokens: Math.max(1, Math.ceil(text.length / 2)),
          },
        };
      }
    }
  }

  async generateObject<T>(input: GenerateObjectInput<T>): Promise<GenerateObjectResult<T>> {
    const value = this.options.objectFactory
      ? this.options.objectFactory(input)
      : this.defaultObject(input);
    return {
      object: input.parse(value),
      model: input.model ?? 'fake',
    };
  }

  private resolveText(input: GenerateTextInput): string {
    if (this.options.responseFactory) {
      return this.options.responseFactory(input);
    }
    if (this.options.response !== undefined) {
      return this.options.response;
    }
    if (input.prompt.includes('【标题要求】')) {
      return '断碑问心';
    }
    if (input.prompt.includes('【摘要要求】')) {
      return '沈砚在荒寺断碑前引动残剑，以一段记忆为代价窥见母亲失踪的线索，也在追兵逼近时发现碑文正在回应他的名字。';
    }
    if (input.prompt.includes('【钩子要求】')) {
      return [
        '1. 断碑后的黑暗里，有人用他母亲的声音叫了他的名字。',
        '2. 山门外亮起火光，来人的袖口绣着早已焚毁的家纹。',
        '3. 他低头时，发现碑上多了一行自己刚刚才写下的字。',
      ].join('\n');
    }
    if (input.prompt.includes('【都市题材创作要求】')) {
      const match = input.prompt.match(/目标汉字数：(\d+)\s*到\s*(\d+)/);
      const target = match
        ? Number(match[1]) + Math.floor((Number(match[2]) - Number(match[1])) / 2)
        : 2_500;
      return buildDeterministicUrbanChapter(target, {
        includeConflicts: input.prompt.includes('[[URBAN_CONFLICTS]]'),
      });
    }
    if (
      input.prompt.includes('【续写要求】') ||
      input.prompt.includes('【改写要求】') ||
      input.prompt.includes('【扩写要求】') ||
      input.prompt.includes('【缩写要求】') ||
      input.prompt.includes('【改视角要求】')
    ) {
      const match = input.prompt.match(/目标汉字数：(\d+)\s*到\s*(\d+)/);
      const target = match
        ? Number(match[1]) + Math.floor((Number(match[2]) - Number(match[1])) / 2)
        : 240;
      return buildDeterministicChineseChapter(Math.max(1, target));
    }
    if (this.options.mode === 'chapter') {
      const match = input.prompt.match(/目标汉字数：(\d+)\s*到\s*(\d+)/);
      const target = match
        ? Number(match[1]) + Math.floor((Number(match[2]) - Number(match[1])) / 2)
        : 2_500;
      return buildDeterministicChineseChapter(target, {
        includeLeftArmConflict: input.prompt.includes('[[LEFT_ARM_CONFLICT]]'),
      });
    }
    return `fake response:${input.prompt}`;
  }

  private defaultObject(input: GenerateObjectInput<unknown>): unknown {
    if (input.schemaName === 'outline_node') {
      const currentTitle = input.prompt.match(/当前标题：(.+)/)?.[1]?.trim() ?? '大纲节点';
      const level = input.prompt.match(/节点层级：(.+)/)?.[1]?.trim() ?? '章';
      return {
        title: `重生成 · ${currentTitle}`,
        summary: `重生成后的${level}安排：冲突更集中，节点结束时留有新的悬念。`,
        details: '本节点只更新自身内容，保留同层顺序和其他大纲节点。',
        chapterGoal: '让本章冲突更集中，并在结尾留下新的选择。',
        pov: '沈砚',
        sceneBeats: ['旧线索被推翻', '主角做出更残酷的选择', '新的疑问浮出水面'],
        chapterEndHook: '他以为自己赢了，却听见门外有人叫出了他被遗忘的名字。',
      };
    }

    if (input.schemaName !== 'chapter_facts') {
      return {};
    }

    const chapterText = input.prompt.split('【章节正文】\n')[1] ?? '';
    const candidates: ExtractedFact[] = chapterText.includes('陈默从城东开车到城西')
      ? [
          {
            type: 'event',
            statement: '陈默把五万元转给供应商。',
            sourceSentence: '陈默把 50000 元转给供应商，心里松了一口气。',
          },
          {
            type: 'body_state',
            statement: '陈默的太阳穴隐隐作痛。',
            sourceSentence: '陈默的太阳穴还在隐隐作痛。',
          },
          {
            type: 'character_knowledge',
            statement: '陈默知道这笔钱转出后必须留下完整凭证。',
            sourceSentence: '陈默知道这笔钱一旦转出，就必须留下完整凭证。',
          },
        ]
      : [
          {
            type: 'event',
            statement: '沈砚以血触发断碑，碑面浮现陌生文字。',
            sourceSentence: '沈砚握住剑柄，掌心被锋刃割开，血没有落地，而是逆着雨丝向碑面流去。',
          },
          {
            type: 'body_state',
            statement: '沈砚的太阳穴剧痛，并吐出一口带着寒意的血。',
            sourceSentence: '他的太阳穴剧烈跳动，眼前同时闪过边城、雪夜和一道关上的门。',
          },
          {
            type: 'character_knowledge',
            statement: '沈砚知道自己一旦退开，今夜就再也找不到这块碑。',
            sourceSentence: '沈砚没有松手。他知道自己一旦退开，今夜便再也找不到这块碑。',
          },
        ];

    return {
      facts: candidates.filter((fact) => chapterText.includes(fact.sourceSentence)),
    };
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

const URBAN_PARAGRAPHS = [
  '南城的早高峰像一条缓慢移动的河。陈默站在写字楼三十七层的窗边，看见高架上的车灯一盏接一盏亮起来，手机里供应商的未接来电已经排到屏幕最下方。',
  '远山资本的会议室里还留着昨夜会议的咖啡味。财务总监把现金流表推到他面前，提醒他本周必须付清第一笔货款，否则旧城仓库的货就会被对方扣下。',
  '陈默没有立刻回答。他翻开项目合同，逐页核对授权签字和付款节点。桌上的座机响了两次，都是前台在问楼下的人有没有预约。',
  '苏晚来得很准时。她把风衣搭在椅背上，先看了一眼墙上的城市地图，又看向陈默手边的文件。两个人之间隔着一张长桌，也隔着董事会还没有解决的控制权争议。',
  '窗外的云压得很低，中央空调把会议室吹得有些冷。陈默把供应商名单折好，提醒自己先处理眼前能核实的账目，再决定要不要去见旧城商会的人。',
  '楼下的便利店刚开始换午间盒饭。前台发来消息，说周警官在会客区等十分钟，只谈公开案件流程，不接受任何没有凭据的请求。',
  '陈默下楼时经过法务部。门半开着，里面的人正在讨论一份需要股东会决议的大额转账，桌上摊着双人复核单和授权委托书。',
  '他忽然意识到，今天真正难的不是凑钱，而是每一步都要留下能解释的来源。旧城仓库、公司账户和个人余额之间，只要有一条线说不清，明天就会有人拿着合同找上门。',
  '回到会议室时，苏晚已经把那页股权结构翻到最后一页。她没有催促，只把笔帽扣上，像是在等他先说出一个能让双方都承担后果的方案。',
  '南城的午间新闻开始播报跨江高架拥堵。陈默把手机调成静音，重新坐回桌边，决定先让财务打印全部流水，再约供应商当面核对。',
];

export function buildDeterministicChineseChapter(
  targetCharacters = 2_500,
  options: { includeLeftArmConflict?: boolean } = {},
): string {
  const target = Math.max(1, targetCharacters);
  const conflictParagraph = options.includeLeftArmConflict
    ? '沈砚忍着左臂的疼，缓缓抬起手。他双手结印，借残剑之力压住翻涌的碑文。\n\n'
    : '';
  let text = `${conflictParagraph}${CHAPTER_PARAGRAPHS.join('\n\n')}`;
  let index = 0;
  while (countCjkCharacters(text) < target) {
    text += `\n\n${CHAPTER_PARAGRAPHS[index % CHAPTER_PARAGRAPHS.length]}`;
    index += 1;
  }

  let count = 0;
  const characters = Array.from(text);
  let end = 0;
  for (; end < characters.length; end += 1) {
    if (isCjkIdeograph(characters[end])) {
      count += 1;
      if (count === target) {
        end += 1;
        break;
      }
    }
  }
  return characters.slice(0, end).join('');
}

export function buildDeterministicUrbanChapter(
  targetCharacters = 2_500,
  options: { includeConflicts?: boolean } = {},
): string {
  const target = Math.max(1, targetCharacters);
  const conflictParagraphs = options.includeConflicts
    ? [
        '陈默从城东开车到城西只用了五分钟。',
        '陈默和苏晚在会议室握手，决定并肩作战。',
        '陈默把 50000 元转给供应商，心里松了一口气。',
        '陈默的太阳穴还在隐隐作痛。',
        '陈默知道这笔钱一旦转出，就必须留下完整凭证。',
        '陈默擅自挪用公司资金，给供应商补上缺口。',
      ].join('\n\n')
    : '';
  let text = [conflictParagraphs, URBAN_PARAGRAPHS.join('\n\n')].filter(Boolean).join('\n\n');
  let index = 0;
  while (countCjkCharacters(text) < target) {
    text += `\n\n${URBAN_PARAGRAPHS[index % URBAN_PARAGRAPHS.length]}`;
    index += 1;
  }

  let count = 0;
  const characters = Array.from(text);
  let end = 0;
  for (; end < characters.length; end += 1) {
    if (isCjkIdeograph(characters[end])) {
      count += 1;
      if (count === target) {
        end += 1;
        break;
      }
    }
  }
  return characters.slice(0, end).join('');
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

  async generateObject<T>(input: GenerateObjectInput<T>): Promise<GenerateObjectResult<T>> {
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
        },
        body: JSON.stringify({
          model: input.model,
          messages: [
            {
              role: 'system',
              content: [
                input.system ?? '',
                '只输出一个 JSON 对象，不要 Markdown 代码块或解释。',
                `JSON Schema: ${JSON.stringify(input.jsonSchema)}`,
              ]
                .filter(Boolean)
                .join('\n'),
            },
            { role: 'user', content: input.prompt },
          ],
          response_format: { type: 'json_object' },
          stream: false,
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

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new AiGatewayError(
        'MODEL_GENERATION_FAILED',
        'The model returned an empty structured response',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new AiGatewayError('MODEL_GENERATION_FAILED', 'The model returned invalid JSON');
    }

    return {
      object: input.parse(parsed),
      model: input.model,
      ...(payload.usage
        ? {
            usage: {
              promptTokens: payload.usage.prompt_tokens,
              completionTokens: payload.usage.completion_tokens,
            },
          }
        : {}),
    };
  }
}
