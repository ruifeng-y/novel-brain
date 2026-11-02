import { describe, expect, it } from 'vitest';
import { auditChapterQuality, type ChapterAuditInput } from './quality-audit';

function input(overrides: Partial<ChapterAuditInput> = {}): ChapterAuditInput {
  return {
    chapterNumber: 1,
    content: '',
    outline: {
      chapterGoal: '',
      pov: '',
      sceneBeats: [],
      chapterEndHook: '',
    },
    confirmedFacts: [],
    characters: [],
    places: [],
    factionControls: [],
    items: [],
    mapConnections: [],
    powerLevels: [],
    ...overrides,
  };
}

describe('chapter quality audit', () => {
  it('flags a POV character knowing a truth they do not yet believe', () => {
    const result = auditChapterQuality(
      input({
        content: '沈砚知道父母是被仇家所杀的。',
        outline: {
          chapterGoal: '沈砚追查父母旧事。',
          pov: '沈砚',
          sceneBeats: ['沈砚在荒寺回想旧案'],
          chapterEndHook: '门外传来仇家的脚步声。',
        },
        characters: [
          {
            id: 'character-shen',
            name: '沈砚',
            voice: '说话克制，句子很短。',
            location: '荒寺',
            knowledge: [
              {
                title: '父母之死',
                objectiveTruth: '父母是被仇家所杀',
                characterBelief: '父母是自尽',
                validFrom: '第一章',
                validTo: null,
                source: '作者录入',
              },
            ],
          },
        ],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'knowledge',
          sourceSentence: '沈砚知道父母是被仇家所杀的。',
          suggestion: expect.stringContaining('他仍以为父母是自尽'),
        }),
      ]),
    );
    expect(result.report.dimensions.map((dimension) => dimension.key)).toEqual([
      'hook',
      'pacing',
      'information_density',
      'character_voice',
      'prose',
      'continuity',
    ]);
  });

  it('flags a character using an item whose current owner is someone else', () => {
    const result = auditChapterQuality(
      input({
        content: '沈砚握住残剑，催动剑上的寒光。',
        outline: {
          chapterGoal: '沈砚在荒寺避雨。',
          pov: '沈砚',
          sceneBeats: ['沈砚听见门外脚步'],
          chapterEndHook: '门外的人叫出了他的名字。',
        },
        characters: [
          { id: 'character-shen', name: '沈砚', location: '荒寺' },
          { id: 'character-su', name: '苏晚', location: '天门' },
        ],
        items: [
          {
            id: 'item-sword',
            name: '残剑',
            ownerName: '苏晚',
          },
        ],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'item',
          sourceSentence: '沈砚握住残剑，催动剑上的寒光。',
          suggestion: expect.stringContaining('苏晚'),
        }),
      ]),
    );
  });

  it('flags another character having inner thoughts when the chapter has one POV', () => {
    const result = auditChapterQuality(
      input({
        content: '苏晚心想，他绝不会答应。',
        outline: {
          chapterGoal: '沈砚在荒寺避雨。',
          pov: '沈砚',
          sceneBeats: ['沈砚听见门外脚步'],
          chapterEndHook: '门外的人叫出了他的名字。',
        },
        characters: [
          { id: 'character-shen', name: '沈砚', location: '荒寺' },
          { id: 'character-su', name: '苏晚', location: '天门' },
        ],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'pov',
          sourceSentence: '苏晚心想，他绝不会答应。',
          suggestion: expect.stringContaining('动作'),
        }),
      ]),
    );
  });

  it('flags body-state and confirmed-death contradictions', () => {
    const result = auditChapterQuality(
      input({
        content: [
          '沈砚忍着左臂的疼，双手结印压住碑文。',
          '苏晚推门走进来，把伞靠在墙边。',
        ].join('\n'),
        outline: {
          chapterGoal: '沈砚在荒寺避雨。',
          pov: '沈砚',
          sceneBeats: ['沈砚听见门外脚步'],
          chapterEndHook: '门外的人叫出了他的名字。',
        },
        characters: [
          { id: 'character-shen', name: '沈砚', location: '荒寺' },
          { id: 'character-su', name: '苏晚', location: '天门' },
        ],
        confirmedFacts: [
          {
            id: 'fact-arm',
            chapterNumber: 1,
            type: 'body_state',
            statement: '沈砚左臂骨折',
            sourceSentence: '沈砚左臂骨折。',
          },
          {
            id: 'fact-death',
            chapterNumber: 1,
            type: 'event',
            statement: '苏晚已经死了',
            sourceSentence: '苏晚已经死了。',
          },
        ],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'body_state' }),
        expect.objectContaining({
          category: 'confirmed_fact',
          sourceSentence: '苏晚推门走进来，把伞靠在墙边。',
        }),
      ]),
    );
  });

  it('flags outline drift, premature power growth, and faction control conflicts', () => {
    const result = auditChapterQuality(
      input({
        content: [
          '沈砚站在雨里，已经突破筑基，抬手便压下山门的剑光。',
          '无宗占据荒寺，封锁山门。',
        ].join('\n'),
        outline: {
          chapterGoal: '沈砚在断骨崖找到母亲遗骨。',
          pov: '沈砚',
          sceneBeats: ['沈砚在断骨崖发现遗骨'],
          chapterEndHook: '遗骨旁放着苏晚的发簪。',
        },
        characters: [
          {
            id: 'character-shen',
            name: '沈砚',
            power: '炼气三层',
            location: '荒寺',
          },
          { id: 'character-su', name: '苏晚', location: '天门' },
        ],
        places: [
          { id: 'place-temple', name: '荒寺' },
          { id: 'place-cliff', name: '断骨崖' },
          { id: 'place-gate', name: '天门' },
        ],
        powerLevels: ['炼气', '筑基', '金丹'],
        factionControls: [
          {
            factionName: '青云宗',
            placeName: '荒寺',
            validFrom: '第一章',
            validTo: null,
          },
        ],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'outline' }),
        expect.objectContaining({ category: 'power' }),
        expect.objectContaining({
          category: 'faction',
          sourceSentence: '无宗占据荒寺，封锁山门。',
        }),
      ]),
    );
  });

  it('flags future canon, impossible travel, and a character in the wrong place', () => {
    const result = auditChapterQuality(
      input({
        chapterNumber: 1,
        content: [
          '沈砚坐在天门石阶上。',
          '他转眼从荒寺赶到天门，只用了一盏茶。',
          '沈砚在天门拔剑。',
        ].join('\n'),
        outline: {
          chapterGoal: '沈砚在荒寺避雨。',
          pov: '沈砚',
          sceneBeats: ['沈砚听见门外脚步'],
          chapterEndHook: '门外的人叫出了他的名字。',
        },
        characters: [
          { id: 'character-shen', name: '沈砚', location: '荒寺' },
        ],
        places: [
          { id: 'place-temple', name: '荒寺' },
          { id: 'place-gate', name: '天门' },
        ],
        mapConnections: [
          { fromName: '荒寺', toName: '天门', travelMinutes: 600 },
        ],
        confirmedFacts: [
          {
            id: 'fact-future',
            chapterNumber: 5,
            type: 'event',
            statement: '沈砚在天门拔剑',
            sourceSentence: '沈砚在天门拔剑。',
          },
        ],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'timeline',
          message: expect.stringContaining('600'),
        }),
        expect.objectContaining({
          category: 'timeline',
          message: expect.stringContaining('第 5 章'),
        }),
        expect.objectContaining({
          category: 'location',
          sourceSentence: '沈砚坐在天门石阶上。',
        }),
      ]),
    );
  });

  it('flags repeated beats and clustered AI-like stock phrasing', () => {
    const result = auditChapterQuality(
      input({
        content: [
          '他深吸一口气，缓缓抬起头。',
          '他深吸一口气，缓缓抬起头。',
          '他深吸一口气，缓缓抬起头。',
          '眼中闪过一丝寒意，嘴角勾起冷笑，心中不由得一紧。',
        ].join('\n'),
        outline: {
          chapterGoal: '沈砚在荒寺避雨。',
          pov: '沈砚',
          sceneBeats: ['沈砚听见门外脚步'],
          chapterEndHook: '门外的人叫出了他的名字。',
        },
        characters: [{ id: 'character-shen', name: '沈砚' }],
      }),
    );

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'repetition',
          message: expect.stringContaining('3'),
        }),
        expect.objectContaining({
          category: 'ai_tone',
          suggestion: expect.stringContaining('具体'),
        }),
      ]),
    );
  });

  it('builds a six-part report that reacts to hook and prose problems', () => {
    const result = auditChapterQuality(
      input({
        content: [
          '沈砚走进荒寺，雨水顺着屋檐落下。',
          '沈砚走进荒寺，雨水顺着屋檐落下。',
          '沈砚走进荒寺，雨水顺着屋檐落下。',
          '他缓缓抬头，眼中闪过一丝寒意，嘴角勾起冷笑，不由得退后。',
        ].join('\n'),
        outline: {
          chapterGoal: '沈砚在荒寺避雨。',
          pov: '沈砚',
          sceneBeats: ['沈砚听见门外脚步'],
          chapterEndHook: '门外的人叫出了他的名字。',
        },
        characters: [{ id: 'character-shen', name: '沈砚' }],
      }),
    );

    const hook = result.report.dimensions.find((item) => item.key === 'hook');
    const prose = result.report.dimensions.find((item) => item.key === 'prose');
    expect(hook?.status).not.toBe('good');
    expect(prose?.status).not.toBe('good');
    expect(result.report.dimensions).toHaveLength(6);
  });
});
