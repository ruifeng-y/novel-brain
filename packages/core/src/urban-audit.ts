export type UrbanAuditIssueCategory = 'real_world' | 'relationship' | 'money' | 'law';

export type UrbanAuditIssue = {
  category: UrbanAuditIssueCategory;
  severity: 'warning';
  message: string;
  suggestion: string;
  sourceSentence: string;
  startOffset: number;
  endOffset: number;
  factId: null;
};

export type UrbanRelationship = {
  fromName: string;
  toName: string;
  predicate: string;
  validTo: string | null;
};

export type UrbanMoneyAccount = {
  name: string;
  holderName: string;
  balanceWan: number;
  currency: string;
};

export type UrbanLaw = {
  name: string;
  prohibitedActions: string[];
};

export type UrbanAuditInput = {
  content: string;
  relationships: UrbanRelationship[];
  moneyAccounts: UrbanMoneyAccount[];
  laws: UrbanLaw[];
};

type SentenceWithOffset = {
  text: string;
  start: number;
  end: number;
};

const MONEY_ACTION_PATTERN = /(花掉|花了|支付|付款|转账|转给|消费|取出|借出|亏掉|赔了|买单)/;
const MONEY_AMOUNT_PATTERN = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万)?元/g;
const COOPERATION_PATTERN = /(握手|并肩|合作|结盟|和好|信任|一起行动|联手|达成一致)/;
const RELATIONSHIP_LABELS: Record<string, string> = {
  hostile: '敌对',
  kin: '亲属',
  mentor: '师承',
  subordinate: '隶属',
};

export function auditUrbanConstraints(input: UrbanAuditInput): UrbanAuditIssue[] {
  const sentences = splitSentences(input.content);
  return [
    ...detectRelationshipIssues(input, sentences),
    ...detectMoneyIssues(input, sentences),
    ...detectLawIssues(input, sentences),
  ];
}

function detectLawIssues(
  input: UrbanAuditInput,
  sentences: SentenceWithOffset[],
): UrbanAuditIssue[] {
  return input.laws.flatMap((law) =>
    law.prohibitedActions.flatMap((action) => {
      const phrase = action.trim();
      if (phrase.length < 2) {
        return [];
      }
      return sentences.flatMap((sentence) => {
        if (!sentence.text.includes(phrase)) {
          return [];
        }
        return [
          {
            category: 'law' as const,
            severity: 'warning' as const,
            message: `本句出现“${phrase}”，与${law.name}记录的禁止行为冲突。`,
            suggestion: `说明人物正在承担的法律风险、补救动作或授权依据；如果只是误会或设局，请在正文里交代清楚。`,
            sourceSentence: sentence.text,
            startOffset: sentence.start,
            endOffset: sentence.end,
            factId: null,
          },
        ];
      });
    }),
  );
}

function detectRelationshipIssues(
  input: UrbanAuditInput,
  sentences: SentenceWithOffset[],
): UrbanAuditIssue[] {
  return input.relationships.flatMap((relationship) => {
    if (relationship.validTo || relationship.predicate !== 'hostile') {
      return [];
    }
    return sentences.flatMap((sentence) => {
      if (
        !sentence.text.includes(relationship.fromName) ||
        !sentence.text.includes(relationship.toName) ||
        !COOPERATION_PATTERN.test(sentence.text)
      ) {
        return [];
      }
      const relationLabel = RELATIONSHIP_LABELS[relationship.predicate] ?? relationship.predicate;
      return [
        {
          category: 'relationship' as const,
          severity: 'warning' as const,
          message: `${relationship.fromName}和${relationship.toName}仍记录为${relationLabel}关系，本句却写成合作场景。`,
          suggestion: `补写关系缓和的原因和过程，或者把这段改成双方仍在试探、互相提防的互动。`,
          sourceSentence: sentence.text,
          startOffset: sentence.start,
          endOffset: sentence.end,
          factId: null,
        },
      ];
    });
  });
}

function detectMoneyIssues(
  input: UrbanAuditInput,
  sentences: SentenceWithOffset[],
): UrbanAuditIssue[] {
  if (input.moneyAccounts.length === 0) {
    return [];
  }

  return sentences.flatMap((sentence) => {
    if (!MONEY_ACTION_PATTERN.test(sentence.text)) {
      return [];
    }
    const accounts = input.moneyAccounts.filter(
      (account) =>
        sentence.text.includes(account.name) ||
        (account.holderName.length >= 2 && sentence.text.includes(account.holderName)),
    );
    const candidates = accounts.length > 0 ? accounts : input.moneyAccounts;
    const matches = [...sentence.text.matchAll(MONEY_AMOUNT_PATTERN)];

    return matches.flatMap((match) => {
      const rawAmount = Number(match[1].replaceAll(',', ''));
      if (!Number.isFinite(rawAmount)) {
        return [];
      }
      const amountWan = match[2] ? rawAmount : rawAmount / 10_000;
      const exceeding = candidates.find((account) => amountWan > account.balanceWan);
      if (!exceeding) {
        return [];
      }
      return [
        {
          category: 'money' as const,
          severity: 'warning' as const,
          message: `本句的支出 ${match[1]}${match[2] ?? ''} 元超过${exceeding.name}记录的可用余额 ${exceeding.balanceWan} 万元。`,
          suggestion: `补写这笔钱的来源、借款或到账过程，或者把支出降到${exceeding.name}当前能承担的范围内。`,
          sourceSentence: sentence.text,
          startOffset: sentence.start,
          endOffset: sentence.end,
          factId: null,
        },
      ];
    });
  });
}

function splitSentences(text: string): SentenceWithOffset[] {
  const sentences: SentenceWithOffset[] = [];
  const pattern = /[^。！？!?；;\n]+[。！？!?；;]?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const leadingWhitespace = raw.match(/^\s*/)?.[0].length ?? 0;
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const start = match.index + leadingWhitespace;
    sentences.push({
      text: value,
      start,
      end: start + value.length,
    });
  }

  return sentences;
}
