import { describe, expect, it } from 'vitest';
import { checkHistoryRules, type HistoryRuleInput } from './history-rules';

function baseInput(overrides: Partial<HistoryRuleInput> = {}): HistoryRuleInput {
  return {
    text: '',
    officials: [],
    nodes: [
      { id: 'capital', name: '京城' },
      { id: 'pass', name: '雁门关' },
      { id: 'frontier', name: '朔州' },
    ],
    connections: [
      { fromNodeId: 'capital', toNodeId: 'pass', travelMinutes: 1_440 },
      { fromNodeId: 'pass', toNodeId: 'frontier', travelMinutes: 1_440 },
    ],
    ...overrides,
  };
}

describe('history rule checks', () => {
  it('flags modern objects and institutions as anachronisms', () => {
    const result = checkHistoryRules(
      baseInput({
        text: '他掏出手机，给京城的公司打了一个电话。',
      }),
    );

    const check = result.checks.find((item) => item.key === 'anachronism');
    expect(check).toMatchObject({ status: 'needs_attention', issueCount: 3 });
    expect(result.issues.map((issue) => issue.category)).toEqual([
      'anachronism',
      'anachronism',
      'anachronism',
    ]);
    expect(result.issues.map((issue) => issue.sourceText)).toEqual([
      '手机',
      '公司',
      '电话',
    ]);
  });

  it('accepts an official hierarchy only when a superior has a higher rank', () => {
    const valid = checkHistoryRules(
      baseInput({
        officials: [
          { id: 'minister', name: '尚书令', rank: 2, superiorId: null },
          { id: 'vice', name: '侍郎', rank: 4, superiorId: 'minister' },
        ],
      }),
    );
    expect(
      valid.checks.find((item) => item.key === 'official_hierarchy')?.status,
    ).toBe('passed');

    const invalid = checkHistoryRules(
      baseInput({
        officials: [
          { id: 'minister', name: '尚书令', rank: 2, superiorId: null },
          { id: 'vice', name: '侍郎', rank: 1, superiorId: 'minister' },
        ],
      }),
    );
    expect(
      invalid.checks.find((item) => item.key === 'official_hierarchy')?.status,
    ).toBe('needs_attention');
    expect(invalid.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'official_hierarchy',
          entityIds: expect.arrayContaining(['vice', 'minister']),
        }),
      ]),
    );
  });

  it('checks army travel against the map distance', () => {
    const result = checkHistoryRules(
      baseInput({
        armyMovement: {
          army: {
            id: 'army',
            name: '朔州军',
            troops: 3_000,
            provisionsShi: 2_000,
          },
          fromNodeId: 'capital',
          toNodeId: 'frontier',
          plannedDays: 1,
        },
      }),
    );

    expect(
      result.checks.find((item) => item.key === 'geographic_distance'),
    ).toMatchObject({
      status: 'needs_attention',
      issueCount: 1,
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'geographic_distance',
          message: expect.stringContaining('至少需要 2 天'),
        }),
      ]),
    );
  });

  it('reports insufficient provisions from troops, days, and carried grain', () => {
    const result = checkHistoryRules(
      baseInput({
        armyMovement: {
          army: {
            id: 'army',
            name: '朔州军',
            troops: 3_000,
            provisionsShi: 500,
          },
          fromNodeId: 'capital',
          toNodeId: 'frontier',
          plannedDays: 20,
        },
      }),
    );

    expect(result.checks.find((item) => item.key === 'provisions')).toMatchObject({
      status: 'needs_attention',
      issueCount: 1,
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'provisions',
          message: expect.stringContaining('1,200 石'),
        }),
      ]),
    );
  });

  it('reports an unreachable army route instead of treating it as a short trip', () => {
    const result = checkHistoryRules(
      baseInput({
        connections: [],
        armyMovement: {
          army: {
            id: 'army',
            name: '朔州军',
            troops: 1_000,
            provisionsShi: 2_000,
          },
          fromNodeId: 'capital',
          toNodeId: 'frontier',
          plannedDays: 10,
        },
      }),
    );

    expect(result.checks.find((item) => item.key === 'army_movement')).toMatchObject({
      status: 'needs_attention',
      issueCount: 1,
    });
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'army_movement',
          message: expect.stringContaining('没有可用的行军路线'),
        }),
      ]),
    );
  });
});
