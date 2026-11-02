import { describe, expect, it } from 'vitest';
import { extractChapterFacts } from './fact-extraction';
import { buildDeterministicUrbanChapter, FakeAiGateway } from './gateway';

describe('chapter fact extraction with the fake provider', () => {
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
