import { describe, expect, it } from 'vitest';
import { selectContextFacts, type ContextFactCandidate } from './context-fact-selection';

function fact(chapterNumber: number, statement: string): ContextFactCandidate {
  return {
    id: `fact-${chapterNumber}-${statement}`,
    chapterNumber,
    type: 'event',
    typeLabel: '事件',
    statement,
    sourceSentence: statement,
  };
}

describe('selectContextFacts', () => {
  it('keeps recent canon and the facts relevant to the next chapter inside a fixed budget', () => {
    const candidates = Array.from({ length: 500 }, (_, index) =>
      fact(index + 1, `第 ${index + 1} 章发生了一段普通赶路和休息的日常。`),
    );
    candidates.push(fact(120, '沈砚在荒寺断碑前发现母亲留下的旧剑痕。'));

    const selected = selectContextFacts(
      candidates,
      {
        chapterNumber: 501,
        chapterGoal: '沈砚回到荒寺断碑前，确认母亲留下的剑痕。',
        pov: '沈砚',
        sceneBeats: ['辨认断碑', '回忆母亲'],
        chapterEndHook: '断碑下还有第二个人的名字。',
      },
      { mustInclude: [], mustAvoid: [] },
      { maxFacts: 24, maxCharacters: 2_400, recentChapters: 6 },
    );

    expect(selected.length).toBeLessThanOrEqual(24);
    expect(selected.map((item) => item.chapterNumber)).toEqual(
      expect.arrayContaining([120, 496, 497, 498, 499, 500]),
    );
    const totalCharacters = selected.reduce(
      (total, item) => total + item.statement.length + item.sourceSentence.length,
      0,
    );
    expect(totalCharacters).toBeLessThanOrEqual(2_400);
  });
});
