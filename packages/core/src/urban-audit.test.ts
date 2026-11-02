import { describe, expect, it } from 'vitest';
import { auditChapterQuality } from './quality-audit';
import { auditUrbanConstraints } from './urban-audit';

describe('urban constraint audit', () => {
  it('flags a payment that exceeds the recorded available balance', () => {
    const result = auditUrbanConstraints({
      content: '陈默把 50000 元转给供应商，心里松了一口气。',
      relationships: [],
      moneyAccounts: [
        {
          name: '陈默账户',
          holderName: '陈默',
          balanceWan: 3.5,
          currency: '人民币',
        },
      ],
      laws: [],
    });

    expect(result).toEqual([
      expect.objectContaining({
        category: 'money',
        message: expect.stringContaining('50000'),
        sourceSentence: '陈默把 50000 元转给供应商，心里松了一口气。',
      }),
    ]);
  });

  it('flags a cooperative scene between two people recorded as active rivals', () => {
    const result = auditUrbanConstraints({
      content: '陈默和苏晚在会议室握手，决定并肩作战。',
      relationships: [
        {
          fromName: '陈默',
          toName: '苏晚',
          predicate: 'hostile',
          validTo: null,
        },
      ],
      moneyAccounts: [],
      laws: [],
    });

    expect(result).toEqual([
      expect.objectContaining({
        category: 'relationship',
        message: expect.stringContaining('敌对'),
        sourceSentence: '陈默和苏晚在会议室握手，决定并肩作战。',
      }),
    ]);
  });

  it('flags an action that violates a recorded legal prohibition', () => {
    const result = auditUrbanConstraints({
      content: '陈默擅自挪用公司资金，给供应商补上缺口。',
      relationships: [],
      moneyAccounts: [],
      laws: [
        {
          name: '公司法资金边界',
          prohibitedActions: ['挪用公司资金', '伪造合同'],
        },
      ],
    });

    expect(result).toEqual([
      expect.objectContaining({
        category: 'law',
        message: expect.stringContaining('挪用公司资金'),
        sourceSentence: '陈默擅自挪用公司资金，给供应商补上缺口。',
      }),
    ]);
  });

  it('flags an impossible modern commute as a real-world logic issue', () => {
    const result = auditChapterQuality({
      chapterNumber: 1,
      content: '陈默从城东开车到城西只用了五分钟。',
      genrePack: 'urban',
      outline: {
        chapterGoal: '陈默赶去城西处理供应商围堵。',
        pov: '陈默',
        sceneBeats: ['接到电话', '赶去城西'],
        chapterEndHook: '供应商拿出了另一份合同。',
      },
      confirmedFacts: [],
      characters: [],
      places: [
        { id: 'east', name: '城东' },
        { id: 'west', name: '城西' },
      ],
      factionControls: [],
      items: [],
      mapConnections: [
        {
          fromName: '城东',
          toName: '城西',
          travelMinutes: 45,
        },
      ],
      powerLevels: [],
    });

    expect(result.issues).toEqual([
      expect.objectContaining({
        category: 'real_world',
        message: expect.stringContaining('5'),
        sourceSentence: '陈默从城东开车到城西只用了五分钟。',
      }),
    ]);
  });
});
