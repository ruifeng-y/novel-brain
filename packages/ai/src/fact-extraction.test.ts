import { describe, expect, it } from 'vitest';
import { extractChapterFacts } from './fact-extraction';
import { buildDeterministicUrbanChapter, FakeAiGateway } from './gateway';

describe('chapter fact extraction with the fake provider', () => {
  it('passes the resolved model credentials to the gateway', async () => {
    const chapterText = buildDeterministicUrbanChapter(1_200);
    let captured: Record<string, unknown> | undefined;
    const gateway = new FakeAiGateway({
      objectFactory: (input) => {
        captured = input as unknown as Record<string, unknown>;
        return {
          facts: [
            {
              type: 'event',
              statement: '陈默决定先核实账目。',
              sourceSentence:
                '陈默把供应商名单折好，提醒自己先处理眼前能核实的账目，再决定要不要去见旧城商会的人。',
            },
            {
              type: 'body_state',
              statement: '陈默的太阳穴隐隐发胀。',
              sourceSentence: '陈默的太阳穴隐隐发胀。',
            },
            {
              type: 'character_knowledge',
              statement: '陈默知道付款必须留下凭证。',
              sourceSentence:
                '他知道每一笔付款都必须留下完整凭证，于是把合同、授权单和银行流水并排放在桌上。',
            },
          ],
        };
      },
    });

    await extractChapterFacts(gateway, {
      chapterNumber: 1,
      chapterText,
      model: 'deepseek-chat',
      apiKey: 'sk-test-real-config',
      baseUrl: 'https://api.deepseek.com',
    });

    expect(captured).toMatchObject({
      model: 'deepseek-chat',
      apiKey: 'sk-test-real-config',
      baseUrl: 'https://api.deepseek.com',
    });
  });

  it('extracts all required fact types from a normal urban chapter', async () => {
    const chapterText = buildDeterministicUrbanChapter(1_200);

    const result = await extractChapterFacts(new FakeAiGateway(), {
      chapterNumber: 1,
      chapterText,
      storyBible: {
        protagonist: '陈默',
        worldIronLaw: '每一笔资金和法律程序都必须留下真实可追溯的依据。',
      },
    });

    expect(result.facts.map((fact) => fact.type)).toEqual([
      'event',
      'body_state',
      'character_knowledge',
    ]);
    expect(result.facts.every((fact) => chapterText.includes(fact.sourceSentence))).toBe(true);
  });
});
