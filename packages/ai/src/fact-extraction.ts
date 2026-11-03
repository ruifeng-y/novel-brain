import {
  chapterFactExtractionResultSchema,
  type ChapterFactExtractionResult,
} from '@novel/contracts';
import { AiGatewayError, type AiGateway } from './gateway';

const CHAPTER_FACTS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      minItems: 3,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'statement', 'sourceSentence'],
        properties: {
          type: {
            type: 'string',
            enum: ['event', 'body_state', 'character_knowledge'],
          },
          statement: { type: 'string', minLength: 1, maxLength: 500 },
          sourceSentence: { type: 'string', minLength: 1, maxLength: 1_000 },
        },
      },
    },
  },
} as const;

export type ChapterFactExtractionInput = {
  chapterNumber: number;
  chapterText: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  storyBible?: {
    protagonist: string;
    worldIronLaw: string;
  };
};

export async function extractChapterFacts(
  gateway: AiGateway,
  input: ChapterFactExtractionInput,
): Promise<ChapterFactExtractionResult> {
  const result = await gateway.generateObject({
    schemaName: 'chapter_facts',
    schemaDescription: 'Facts proposed from one completed chapter',
    jsonSchema: CHAPTER_FACTS_JSON_SCHEMA,
    system: [
      '你是中文长篇小说的连续性编辑。',
      '你的任务是从一章正文中抽取可以作为后续写作依据的事实提案。',
      '只记录正文清楚写出的事实，不猜测、不补充正文没有的信息。',
      '至少各给出一条事件、身体状况和角色认知。',
      '优先记录所有会影响后续章节的具体连续性细节：物品尺寸与归属、人物疤痕与旧伤、食物与药物、信物、地点、时间、承诺、亲缘关系和当前目标。',
      '这些细节可以用事件或身体状况表达；不要只写抽象概括。',
      '尽可能抽取 8 到 20 条，但不得为了数量编造正文没有的内容。',
      '每条 sourceSentence 必须从正文逐字复制一个完整句子，不能改写或拼接。',
    ].join('\n'),
    prompt: [
      `请抽取第 ${input.chapterNumber} 章的事实提案。`,
      input.storyBible
        ? `主角：${input.storyBible.protagonist}\n世界铁律：${input.storyBible.worldIronLaw}`
        : '',
      '返回 JSON：{"facts":[{"type":"event|body_state|character_knowledge","statement":"作者可确认的事实","sourceSentence":"正文原句"}]}',
      '',
      '【章节正文】',
      input.chapterText,
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n'),
    maxTokens: 1_800,
    temperature: 0.1,
    ...(input.model ? { model: input.model } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    parse: (value) => {
      const parsed = chapterFactExtractionResultSchema.safeParse(value);
      if (!parsed.success) {
        throw new AiGatewayError(
          'FACT_EXTRACTION_INVALID',
          'The model returned invalid chapter facts',
        );
      }
      for (const fact of parsed.data.facts) {
        if (!input.chapterText.includes(fact.sourceSentence)) {
          throw new AiGatewayError(
            'FACT_SOURCE_SENTENCE_NOT_FOUND',
            'A fact source sentence was not copied exactly from the chapter',
          );
        }
      }
      return parsed.data;
    },
  });

  return result.object;
}
