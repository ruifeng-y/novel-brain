import { describe, expect, it } from 'vitest';
import { analyzeChangeImpact, type ChangeImpactInput } from './change-impact';

function input(overrides: Partial<ChangeImpactInput> = {}): ChangeImpactInput {
  return {
    change: {
      title: '补充边城旧名',
      reason: '让地理称呼与前文一致。',
      targetType: 'entity',
      targetId: 'entity-city',
      targetLabel: '临渊城',
      targetStatus: 'draft',
      targetLocked: false,
      before: { aliases: [] },
      after: { aliases: ['旧称：落霞城'] },
      source: 'author',
      risk: 'low',
    },
    snapshot: {
      bible: {
        locked: false,
        worldIronLaws: [],
      },
      entities: [],
      facts: [],
      chapters: [],
      outlines: [],
      plotLines: [],
      knowledge: [],
      mapNodes: [],
      relations: [],
      powerItems: [],
      timeline: [],
    },
    ...overrides,
  };
}

describe('change impact analysis', () => {
  it('records all six checks and ten empty impact buckets for a safe change', () => {
    const result = analyzeChangeImpact(input());

    expect(result.classification).toBe('safe');
    expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    expect(result.checks.map((check) => check.step)).toEqual([
      'structure',
      'hard_rules',
      'fact_diff',
      'knowledge_pov',
      'narrative',
      'downstream',
    ]);
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(result.affected).toEqual({
      entities: [],
      facts: [],
      chapters: [],
      outlines: [],
      plotLines: [],
      knowledge: [],
      maps: [],
      factions: [],
      powerItems: [],
      timeline: [],
    });
  });

  it('lists every affected story area and marks a repairable change', () => {
    const result = analyzeChangeImpact(
      input({
        change: {
          ...input().change,
          title: '把沈砚的左臂伤势写入设定',
          targetLabel: '沈砚',
          before: { body: '左臂完好' },
          after: { body: '左臂骨折' },
        },
        snapshot: {
          ...input().snapshot,
          entities: [
            {
              id: 'entity-sword',
              name: '残剑',
              type: 'item_technique',
              status: 'locked',
              summary: '沈砚在断碑前得到的残剑。',
              aliases: [],
            },
          ],
          facts: [
            {
              id: 'fact-arm',
              statement: '沈砚左臂骨折',
              type: 'body_state',
              chapterNumber: 3,
            },
          ],
          chapters: [
            {
              id: 'chapter-3',
              title: '断碑',
              chapterNumber: 3,
              status: 'review',
              content: '沈砚忍着左臂的疼，单手结印。',
            },
          ],
          outlines: [
            {
              id: 'outline-4',
              title: '第 4 章',
              chapterNumber: 4,
              chapterGoal: '沈砚带伤回到边城。',
              sceneBeats: ['沈砚避开巡城修士'],
              chapterEndHook: '通缉令上写着他的名字。',
              locked: false,
            },
          ],
          plotLines: [
            {
              id: 'thread-main',
              name: '找回母亲记忆',
              type: 'main',
              status: 'active',
              summary: '沈砚追查母亲下落。',
            },
          ],
          knowledge: [
            {
              id: 'knowledge-arm',
              characterId: 'entity-shen',
              characterName: '沈砚',
              title: '左臂伤势',
              objectiveTruth: '左臂完好',
              characterBelief: '左臂只是扭伤',
            },
          ],
          mapNodes: [
            {
              id: 'map-shen-cave',
              entityId: 'entity-shen-cave',
              name: '沈砚的洞府',
              level: 'location',
            },
          ],
          relations: [
            {
              id: 'relation-faction',
              fromEntityId: 'entity-faction',
              fromName: '沈砚旧部',
              predicate: 'controls',
              toEntityId: 'entity-city',
              toName: '临渊城',
            },
          ],
          powerItems: [
            {
              id: 'entity-sword',
              name: '沈砚残剑',
              type: 'item_technique',
              summary: '借亡者最后一剑。',
            },
          ],
          timeline: [
            {
              id: 'timeline-arm',
              title: '沈砚断臂',
              summary: '沈砚在断碑前受伤。',
              dateLabel: '玄元十二年',
            },
          ],
        },
      }),
    );

    expect(result.classification).toBe('repairable');
    expect(Object.values(result.affected).every((items) => items.length === 1)).toBe(true);
    expect(result.affected.facts[0]).toMatchObject({ id: 'fact-arm' });
    expect(result.affected.chapters[0]).toMatchObject({
      id: 'chapter-3',
      chapterNumber: 3,
    });
    expect(result.checks.find((item) => item.step === 'fact_diff')?.status).toBe('warning');
    expect(result.checks.find((item) => item.step === 'knowledge_pov')?.status).toBe('warning');
    expect(result.checks.find((item) => item.step === 'downstream')?.status).toBe('warning');
    expect(result.summary).toContain('需要同步');
  });

  it('classifies touching a published chapter as a structural change', () => {
    const result = analyzeChangeImpact(
      input({
        change: {
          ...input().change,
          targetType: 'chapter',
          targetId: 'chapter-3',
          targetLabel: '第 3 章 · 断碑',
          targetStatus: 'published',
          targetLocked: true,
          before: { summary: '沈砚第一次听见残剑回响。' },
          after: { summary: '沈砚第一次借用残剑，忘掉了母亲的名字。' },
        },
        snapshot: {
          ...input().snapshot,
          chapters: [
            {
              id: 'chapter-3',
              title: '断碑',
              chapterNumber: 3,
              status: 'published',
              content: '沈砚第一次听见残剑回响。',
            },
          ],
        },
      }),
    );

    expect(result.classification).toBe('structural');
    expect(result.checks.find((item) => item.step === 'downstream')).toMatchObject({
      status: 'conflict',
      suggestion: expect.stringContaining('平行版本'),
    });
    expect(result.summary).toContain('平行版本');
  });

  it('blocks a change that removes the cost required by a world iron law', () => {
    const result = analyzeChangeImpact(
      input({
        change: {
          ...input().change,
          targetType: 'story_bible',
          targetId: null,
          targetLabel: '故事圣经 · 金手指',
          targetLocked: true,
          before: { goldenFinger: '借剑必须忘掉一个活人的名字。' },
          after: { goldenFinger: '借剑无需付出任何代价。' },
        },
        snapshot: {
          ...input().snapshot,
          bible: {
            locked: true,
            worldIronLaws: ['借天门之力，必须以一段真实记忆作为代价。'],
          },
        },
      }),
    );

    expect(result.classification).toBe('structural');
    expect(result.checks.find((item) => item.step === 'hard_rules')).toMatchObject({
      status: 'conflict',
      summary: expect.stringContaining('代价'),
    });
    expect(result.suggestions).toEqual(expect.arrayContaining([expect.stringContaining('硬规则')]));
  });

  it('rejects a target that cannot be identified in the current story line', () => {
    const result = analyzeChangeImpact(
      input({
        change: {
          ...input().change,
          targetId: null,
        },
      }),
    );

    expect(result.classification).toBe('structural');
    expect(result.checks.find((item) => item.step === 'structure')).toMatchObject({
      status: 'conflict',
      summary: expect.stringContaining('找不到'),
    });
  });
});
