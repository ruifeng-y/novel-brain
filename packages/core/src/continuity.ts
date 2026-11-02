export type ConfirmedBodyStateFact = {
  id: string;
  statement: string;
  sourceSentence: string;
  chapterNumber: number;
};

export type BodyStateConflict = {
  factId: string;
  category: 'body_state';
  severity: 'warning';
  message: string;
  suggestion: string;
  sourceSentence: string;
  startOffset: number;
  endOffset: number;
};

const BODY_PART_PATTERN = /(左臂|右臂|左胳膊|右胳膊|左手|右手|左腿|右腿)/;
const INJURY_PATTERN =
  /(骨折|骨裂|断裂|断了|重伤|无法|不能|使不上力|抬不起|失去知觉|筋脉尽断|动弹不得)/;
const RECOVERED_PATTERN = /(已恢复|痊愈|康复|愈合|接好|完好)/;
const TWO_HAND_PATTERN = /(双手|两只手|双臂|两臂)/;
const TWO_HAND_ACTION_PATTERN =
  /(结印|合掌|抱拳|掐诀|施法|托住|捧起|握住|握紧|鼓掌|按在|按住|撑住|推开)/;

type SentenceWithOffset = {
  text: string;
  start: number;
  end: number;
};

export function detectBodyStateConflicts(
  chapterText: string,
  confirmedBodyStates: ConfirmedBodyStateFact[],
): BodyStateConflict[] {
  const sentences = splitSentences(chapterText);
  const conflicts: BodyStateConflict[] = [];

  for (const fact of confirmedBodyStates) {
    const bodyState = parseBodyState(fact.statement);
    if (!bodyState) {
      continue;
    }

    for (const [index, sentence] of sentences.entries()) {
      if (
        bodyState.characterName &&
        !sentenceMentionsCharacter(sentences, index, bodyState.characterName)
      ) {
        continue;
      }
      if (
        !TWO_HAND_PATTERN.test(sentence.text) ||
        !TWO_HAND_ACTION_PATTERN.test(sentence.text)
      ) {
        continue;
      }

      const action = extractTwoHandAction(sentence.text);
      const sideLabel = bodyState.side === 'left' ? '左臂' : '右臂';
      const usableSideLabel = bodyState.side === 'left' ? '右手' : '左手';
      conflicts.push({
        factId: fact.id,
        category: 'body_state',
        severity: 'warning',
        message: `已确认“${fact.statement}”，但正文写“${sentence.text}”。“${action}”需要双手同时发力，和${sideLabel}受伤的状态冲突。`,
        suggestion: `把“${action}”改成${usableSideLabel}可以完成的动作，例如“${usableSideLabel}单掌结印”；如果${sideLabel}已经恢复，请补写恢复原因。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
      });
    }
  }

  return conflicts;
}

function sentenceMentionsCharacter(
  sentences: SentenceWithOffset[],
  index: number,
  characterName: string,
): boolean {
  const sentence = sentences[index];
  if (sentence.text.includes(characterName)) {
    return true;
  }
  if (!/^(?:他|她|其)/.test(sentence.text)) {
    return false;
  }
  return sentences[index - 1]?.text.includes(characterName) ?? false;
}

function parseBodyState(
  statement: string,
): { characterName: string | null; side: 'left' | 'right' } | null {
  if (RECOVERED_PATTERN.test(statement) || !INJURY_PATTERN.test(statement)) {
    return null;
  }

  const bodyPart = BODY_PART_PATTERN.exec(statement);
  if (!bodyPart) {
    return null;
  }

  const rawPrefix = statement.slice(0, bodyPart.index).replace(/[，。；：\s]/g, '');
  const characterName = rawPrefix.replace(/的$/, '');
  return {
    characterName: characterName || null,
    side: bodyPart[1].startsWith('左') ? 'left' : 'right',
  };
}

function extractTwoHandAction(sentence: string): string {
  const action = sentence.match(
    /(?:双手|两只手|双臂|两臂)[^，。！？；\n]{0,8}/,
  )?.[0];
  return action?.trim() || '双手动作';
}

function splitSentences(chapterText: string): SentenceWithOffset[] {
  const sentences: SentenceWithOffset[] = [];
  const pattern = /[^。！？!?；;\n]+[。！？!?；;]?/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(chapterText)) !== null) {
    const raw = match[0];
    const leadingWhitespace = raw.match(/^\s*/)?.[0].length ?? 0;
    const text = raw.trim();
    if (!text) {
      continue;
    }
    const start = match.index + leadingWhitespace;
    sentences.push({
      text,
      start,
      end: start + text.length,
    });
  }

  return sentences;
}
