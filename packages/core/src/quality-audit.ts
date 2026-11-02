import { detectBodyStateConflicts } from './continuity';
import { auditUrbanConstraints, type UrbanAuditInput } from './urban-audit';

export type ChapterAuditIssueCategory =
  | 'real_world'
  | 'outline'
  | 'relationship'
  | 'money'
  | 'law'
  | 'confirmed_fact'
  | 'timeline'
  | 'body_state'
  | 'knowledge'
  | 'power'
  | 'location'
  | 'faction'
  | 'item'
  | 'pov'
  | 'repetition'
  | 'ai_tone';

export type ChapterAuditIssue = {
  category: ChapterAuditIssueCategory;
  severity: 'warning';
  message: string;
  suggestion: string;
  sourceSentence: string;
  startOffset: number;
  endOffset: number;
  factId: string | null;
};

export type ChapterQualityDimensionKey =
  'hook' | 'pacing' | 'information_density' | 'character_voice' | 'prose' | 'continuity';

export type ChapterQualityDimension = {
  key: ChapterQualityDimensionKey;
  label: string;
  status: 'good' | 'watch' | 'weak';
  statusLabel: string;
  summary: string;
  suggestion: string;
};

export type ChapterQualityReport = {
  dimensions: ChapterQualityDimension[];
  summary: string;
  issueCounts: Partial<Record<ChapterAuditIssueCategory, number>>;
};

export type ChapterAuditInput = {
  chapterNumber: number;
  content: string;
  genrePack?: string;
  urban?: Omit<UrbanAuditInput, 'content'>;
  outline: {
    chapterGoal: string;
    pov: string;
    sceneBeats: string[];
    chapterEndHook: string;
  };
  confirmedFacts: Array<{
    id: string;
    chapterNumber: number;
    type: 'event' | 'body_state' | 'character_knowledge';
    statement: string;
    sourceSentence: string;
  }>;
  characters: Array<{
    id: string;
    name: string;
    aliases?: string[];
    voice?: string;
    body?: string;
    power?: string;
    location?: string;
    possessions?: string;
    knowledge?: Array<{
      title: string;
      objectiveTruth: string;
      characterBelief: string;
      validFrom: string;
      validTo: string | null;
      source: string;
    }>;
  }>;
  places: Array<{
    id: string;
    name: string;
    aliases?: string[];
  }>;
  factionControls: Array<{
    factionName: string;
    placeName: string;
    validFrom: string | null;
    validTo: string | null;
  }>;
  items: Array<{
    id: string;
    name: string;
    ownerName: string | null;
  }>;
  mapConnections: Array<{
    fromName: string;
    toName: string;
    travelMinutes: number;
  }>;
  powerLevels: string[];
};

type SentenceWithOffset = {
  text: string;
  start: number;
  end: number;
};

const QUALITY_DIMENSION_LABELS: Record<ChapterQualityDimensionKey, string> = {
  hook: '钩子',
  pacing: '节奏',
  information_density: '信息密度',
  character_voice: '人物声纹',
  prose: '文笔',
  continuity: '连续性',
};

const QUALITY_STATUS_LABELS = {
  good: '良好',
  watch: '可提升',
  weak: '需优先处理',
} as const;

const THOUGHT_VERBS = /(知道|得知|明白|意识到|确信|想起|记得|发现|认定)/;
const ITEM_ACTION_PATTERN =
  /(握住|握紧|拿起|取出|祭出|催动|使用|挥动|佩戴|收进|夺过|抢过|托住|按住)/;
const INNER_THOUGHT_PATTERN =
  /(心想|暗想|心里想|心中想|知道|明白|意识到|确信|回忆起|感到|暗自盘算)/;
const DEATH_PATTERN = /(已经死了|已死|身亡|死去|断气|下葬|尸骨无存)/;
const LIVING_ACTION_PATTERN =
  /(推门|走进|走入|站起|站起身|睁开眼|睁开眼睛|呼吸|说道|笑道|伸手|握住|抬头|转身)/;
const POWER_CHANGE_PATTERN = /(突破|晋升|达到|已是|踏入|修成|修为)/;
const CONTROL_VERBS = ['控制', '占据', '掌管', '掌握', '封锁', '治理', '统辖'];
const PRESENCE_ACTION_PATTERN = /(坐在|站在|来到|抵达|出现在|走进|走入|回到|赶到|跨到|赶到|守在)/;
const DURATION_PATTERNS: Array<{ pattern: RegExp; minutes: number }> = [
  { pattern: /一盏茶/, minutes: 10 },
  { pattern: /一炷香/, minutes: 30 },
  { pattern: /半个时辰/, minutes: 60 },
  { pattern: /一个时辰/, minutes: 120 },
  { pattern: /片刻/, minutes: 15 },
  { pattern: /(转眼|瞬间|立刻|眨眼|一息|一步跨)/, minutes: 1 },
];
const AI_TONE_PHRASES = [
  '深吸一口气',
  '缓缓',
  '眼中闪过',
  '嘴角勾起',
  '不由得',
  '心中一紧',
  '心中不由',
  '空气仿佛凝固',
  '与此同时',
  '淡淡地',
  '无声地',
  '一抹',
  '仿佛',
];

export function auditChapterQuality(input: ChapterAuditInput): {
  issues: ChapterAuditIssue[];
  report: ChapterQualityReport;
} {
  const sentences = splitSentences(input.content);
  const issues = [
    ...detectOutlineIssues(input, sentences),
    ...detectBodyStateIssues(input),
    ...detectConfirmedFactIssues(input, sentences),
    ...detectKnowledgeBoundaryIssues(input, sentences),
    ...detectPowerIssues(input, sentences),
    ...detectFactionIssues(input, sentences),
    ...detectItemOwnershipIssues(input, sentences),
    ...detectTimelineIssues(
      input,
      sentences,
      input.genrePack === 'urban' ? 'real_world' : 'timeline',
    ),
    ...detectLocationIssues(input, sentences),
    ...detectPovIssues(input, sentences),
    ...detectRepetitionIssues(sentences),
    ...detectAiToneIssues(sentences),
    ...(input.urban
      ? auditUrbanConstraints({
          ...input.urban,
          content: input.content,
        })
      : []),
  ];

  return {
    issues,
    report: buildQualityReport(input, issues),
  };
}

function detectRepetitionIssues(sentences: SentenceWithOffset[]): ChapterAuditIssue[] {
  const groups = new Map<string, Array<{ sentence: SentenceWithOffset; index: number }>>();
  for (const [index, sentence] of sentences.entries()) {
    const normalized = sentence.text.replace(/[，。！？!?；;：:\s]/g, '');
    if (normalized.length < 8) {
      continue;
    }
    groups.set(normalized, [...(groups.get(normalized) ?? []), { sentence, index }]);
  }

  return [...groups.values()].flatMap((group) => {
    const nearby = group.filter(
      (entry, index) => index > 0 && entry.index - (group[index - 1]?.index ?? -10) === 1,
    );
    if (nearby.length === 0) {
      return [];
    }
    const repeated = nearby[0].sentence;
    return [
      {
        category: 'repetition' as const,
        severity: 'warning' as const,
        message: `同一句动作或情绪描写在相近段落里重复出现 ${group.length} 次，读起来会显得停滞。`,
        suggestion:
          '保留最能推动情节的一次，其余改成不同动作、感官细节或直接推进下一拍，避免重复同一个节拍。',
        sourceSentence: repeated.text,
        startOffset: repeated.start,
        endOffset: repeated.end,
        factId: null,
      },
    ];
  });
}

function detectAiToneIssues(sentences: SentenceWithOffset[]): ChapterAuditIssue[] {
  const counts = AI_TONE_PHRASES.map((phrase) => ({
    phrase,
    count: sentences.reduce(
      (total, sentence) => total + countOccurrences(sentence.text, phrase),
      0,
    ),
  })).filter((entry) => entry.count > 0);
  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  if (counts.length < 3 && total < 4) {
    return [];
  }

  const firstPhrase = counts[0]?.phrase;
  const sentence =
    sentences.find((candidate) => candidate.text.includes(firstPhrase ?? '')) ?? sentences[0];
  if (!sentence) {
    return [];
  }
  return [
    {
      category: 'ai_tone',
      severity: 'warning',
      message: `“${counts
        .slice(0, 4)
        .map((entry) => entry.phrase)
        .join('、')}”等套式表达出现得比较集中，人物反应容易显得相似。`,
      suggestion:
        '把套式反应换成这一场景里具体的身体感觉、动作选择或带人物性格的对话，让情绪从细节里自然出来。',
      sourceSentence: sentence.text,
      startOffset: sentence.start,
      endOffset: sentence.end,
      factId: null,
    },
  ];
}

function countOccurrences(text: string, phrase: string): number {
  if (!phrase) {
    return 0;
  }
  return text.split(phrase).length - 1;
}

function detectTimelineIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
  category: 'timeline' | 'real_world',
): ChapterAuditIssue[] {
  const issues: ChapterAuditIssue[] = [];

  for (const fact of input.confirmedFacts) {
    if (fact.chapterNumber <= input.chapterNumber) {
      continue;
    }
    const phrase = fact.statement.trim();
    if (phrase.length < 4) {
      continue;
    }
    for (const sentence of sentences) {
      if (!sentence.text.includes(phrase)) {
        continue;
      }
      issues.push({
        category,
        severity: 'warning',
        message: `“${phrase}”是第 ${fact.chapterNumber} 章才确认发生的事，本章已经提前写到。`,
        suggestion: `删掉这段提前发生的情节，或把它改成传闻、预兆或尚未实现的猜测，等到第 ${fact.chapterNumber} 章再正式发生。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
        factId: fact.id,
      });
    }
  }

  for (const connection of input.mapConnections) {
    for (const sentence of sentences) {
      if (
        !sentence.text.includes(connection.fromName) ||
        !sentence.text.includes(connection.toName)
      ) {
        continue;
      }
      const statedMinutes = statedTravelMinutes(sentence.text);
      if (statedMinutes === null || statedMinutes >= connection.travelMinutes) {
        continue;
      }
      issues.push({
        category,
        severity: 'warning',
        message: `正文写${connection.fromName}到${connection.toName}只用了${statedMinutes}分钟，但地图记录至少需要 ${connection.travelMinutes} 分钟。`,
        suggestion: `补足赶路时间，或把“${connection.fromName}”和“${connection.toName}”之间的路程改成更近的地点。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
        factId: null,
      });
    }
  }

  return uniqueIssues(issues);
}

function detectLocationIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const issues: ChapterAuditIssue[] = [];

  for (const character of input.characters) {
    const currentLocation = character.location?.trim();
    if (!currentLocation) {
      continue;
    }
    for (const sentence of sentences) {
      if (
        !sentence.text.includes(character.name) ||
        !PRESENCE_ACTION_PATTERN.test(sentence.text) ||
        sentence.text.includes(currentLocation)
      ) {
        continue;
      }
      const otherPlace = input.places.find(
        (place) => place.name !== currentLocation && sentence.text.includes(place.name),
      );
      if (!otherPlace) {
        continue;
      }
      issues.push({
        category: 'location',
        severity: 'warning',
        message: `人物状态记录${character.name}在${currentLocation}，正文却直接出现在${otherPlace.name}。`,
        suggestion: `补写从${currentLocation}到${otherPlace.name}的移动、耗时和途中变化，或先把人物状态更新到${otherPlace.name}。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
        factId: null,
      });
    }
  }

  return uniqueIssues(issues);
}

function statedTravelMinutes(sentence: string): number | null {
  const modern = sentence.match(/([0-9一二三四五六七八九十两]+)\s*个?\s*(半小时|分钟|小时)/);
  if (modern) {
    const amount = parseChineseNumber(modern[1]);
    if (amount !== null && amount > 0) {
      if (modern[2] === '小时') {
        return amount * 60;
      }
      if (modern[2] === '半小时') {
        return amount * 30;
      }
      return amount;
    }
  }
  if (/半小时/.test(sentence)) {
    return 30;
  }
  for (const duration of DURATION_PATTERNS) {
    if (duration.pattern.test(sentence)) {
      return duration.minutes;
    }
  }
  return null;
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) {
    return Number(value);
  }
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === '十') {
    return 10;
  }
  const tenIndex = value.indexOf('十');
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : digits[value.slice(0, tenIndex)];
    const ones = tenIndex === value.length - 1 ? 0 : digits[value.slice(tenIndex + 1)];
    return tens === undefined || ones === undefined ? null : tens * 10 + ones;
  }
  return digits[value] ?? null;
}

function detectOutlineIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const firstSentence = sentences[0];
  if (!firstSentence || !input.outline.chapterGoal.trim()) {
    return [];
  }

  const outlineText = [input.outline.chapterGoal, ...input.outline.sceneBeats].join(' ');
  const anchors = [
    ...input.characters.flatMap((character) => [character.name, ...(character.aliases ?? [])]),
    ...input.places.flatMap((place) => [place.name, ...(place.aliases ?? [])]),
    ...input.items.map((item) => item.name),
  ]
    .map((anchor) => anchor.trim())
    .filter((anchor) => anchor.length >= 2 && outlineText.includes(anchor));
  const missing = [...new Set(anchors)].filter((anchor) => !input.content.includes(anchor));
  if (missing.length === 0) {
    return [];
  }

  return [
    {
      category: 'outline',
      severity: 'warning',
      message: `本章章纲围绕“${missing.slice(0, 3).join('、')}”展开，正文还没有写到这些关键内容。`,
      suggestion: `补一段真正推进章纲目标的场景，至少让“${missing[0]}”在正文里出现并影响人物选择。`,
      sourceSentence: firstSentence.text,
      startOffset: firstSentence.start,
      endOffset: firstSentence.end,
      factId: null,
    },
  ];
}

function detectPowerIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  if (input.powerLevels.length < 2) {
    return [];
  }

  const issues: ChapterAuditIssue[] = [];
  for (const character of input.characters) {
    const currentPower = character.power?.trim();
    if (!currentPower) {
      continue;
    }
    const currentIndex = highestLevelIndex(currentPower, input.powerLevels);
    if (currentIndex < 0) {
      continue;
    }

    for (const sentence of sentences) {
      if (!sentence.text.includes(character.name) || !POWER_CHANGE_PATTERN.test(sentence.text)) {
        continue;
      }
      const mentionedIndex = highestLevelIndex(sentence.text, input.powerLevels);
      if (mentionedIndex <= currentIndex) {
        continue;
      }
      const mentionedLevel = input.powerLevels[mentionedIndex];
      issues.push({
        category: 'power',
        severity: 'warning',
        message: `人物状态记录${character.name}仍为“${currentPower}”，正文却已经写到“${mentionedLevel}”。`,
        suggestion: `先补写从“${currentPower}”到“${mentionedLevel}”的突破条件、代价和瓶颈，或把这段改成当前层级能完成的动作。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
        factId: null,
      });
    }
  }

  return uniqueIssues(issues);
}

function detectFactionIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const issues: ChapterAuditIssue[] = [];

  for (const control of input.factionControls) {
    if (control.validTo) {
      continue;
    }
    for (const sentence of sentences) {
      if (!sentence.text.includes(control.placeName)) {
        continue;
      }
      for (const verb of CONTROL_VERBS) {
        const match = sentence.text.match(
          new RegExp(`([^，。！？；\\s]{1,16})${verb}${escapeRegExp(control.placeName)}`),
        );
        const claimedFaction = match?.[1]?.replace(/^(而|但|却|原来|如今)/, '').trim();
        if (!claimedFaction || claimedFaction === control.factionName) {
          continue;
        }
        issues.push({
          category: 'faction',
          severity: 'warning',
          message: `已确认${control.placeName}当前由${control.factionName}控制，正文却写成由${claimedFaction}${verb}。`,
          suggestion: `确认${control.placeName}的控制权是否已经易手。若没有，改成${control.factionName}${verb}；若已经易手，先补写势力更替的经过。`,
          sourceSentence: sentence.text,
          startOffset: sentence.start,
          endOffset: sentence.end,
          factId: null,
        });
      }
    }
  }

  return uniqueIssues(issues);
}

function detectBodyStateIssues(input: ChapterAuditInput): ChapterAuditIssue[] {
  const confirmedBodyStates = input.confirmedFacts
    .filter((fact) => fact.type === 'body_state' && fact.chapterNumber <= input.chapterNumber)
    .map((fact) => ({
      id: fact.id,
      statement: fact.statement,
      sourceSentence: fact.sourceSentence,
      chapterNumber: fact.chapterNumber,
    }));
  const characterBodyStates = input.characters
    .filter((character) => character.body?.trim())
    .map((character) => ({
      id: `character:${character.id}`,
      statement: character.body?.includes(character.name)
        ? (character.body ?? '')
        : `${character.name}${character.body ?? ''}`,
      sourceSentence: '',
      chapterNumber: input.chapterNumber - 1,
    }));
  return detectBodyStateConflicts(input.content, [
    ...confirmedBodyStates,
    ...characterBodyStates,
  ]).map((issue) => ({
    category: 'body_state',
    severity: 'warning',
    message: issue.message,
    suggestion: issue.suggestion,
    sourceSentence: issue.sourceSentence,
    startOffset: issue.startOffset,
    endOffset: issue.endOffset,
    factId: issue.factId.startsWith('character:') ? null : issue.factId,
  }));
}

function highestLevelIndex(text: string, levels: string[]): number {
  return levels.reduce(
    (highest, level, index) => (level.trim() && text.includes(level.trim()) ? index : highest),
    -1,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectConfirmedFactIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const characterNames = input.characters.map((character) => character.name.trim()).filter(Boolean);
  const issues: ChapterAuditIssue[] = [];

  for (const fact of input.confirmedFacts) {
    if (
      fact.type !== 'event' ||
      fact.chapterNumber > input.chapterNumber ||
      !DEATH_PATTERN.test(fact.statement)
    ) {
      continue;
    }
    const subject = characterNames.find((name) => fact.statement.includes(name));
    if (!subject) {
      continue;
    }

    for (const sentence of sentences) {
      if (!sentence.text.includes(subject) || !LIVING_ACTION_PATTERN.test(sentence.text)) {
        continue;
      }
      issues.push({
        category: 'confirmed_fact',
        severity: 'warning',
        message: `已确认“${fact.statement}”，正文却让${subject}继续行动。`,
        suggestion: `确认${subject}是否真的已经死亡。如果正文是回忆、幻象或冒充，请明确写出；否则改掉这段行动，或先补写改变死亡结果的情节。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
        factId: fact.id,
      });
    }
  }

  return uniqueIssues(issues);
}

function detectPovIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const pov = input.outline.pov.trim();
  if (!pov) {
    return [];
  }

  return uniqueIssues(
    input.characters
      .filter((character) => character.name.trim() !== pov)
      .flatMap((character) =>
        sentences.flatMap((sentence) => {
          if (
            !sentenceMentionsName(sentence.text, character.name) ||
            !INNER_THOUGHT_PATTERN.test(sentence.text)
          ) {
            return [];
          }
          return [
            {
              category: 'pov' as const,
              severity: 'warning' as const,
              message: `本章以${pov}为叙事视角，但正文直接写了${character.name}的内心活动。`,
              suggestion: `把${character.name}的内心改成${pov}能看到的动作、表情或语气，或者明确切换场景并交代视角变化。`,
              sourceSentence: sentence.text,
              startOffset: sentence.start,
              endOffset: sentence.end,
              factId: null,
            },
          ];
        }),
      ),
  );
}

function detectItemOwnershipIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const issues: ChapterAuditIssue[] = [];
  const characterNames = input.characters.map((character) => character.name.trim()).filter(Boolean);

  for (const item of input.items) {
    const ownerName = item.ownerName?.trim();
    if (!ownerName) {
      continue;
    }

    for (const sentence of sentences) {
      if (
        !sentence.text.includes(item.name) ||
        !ITEM_ACTION_PATTERN.test(sentence.text) ||
        sentence.text.includes(ownerName)
      ) {
        continue;
      }
      const actor = characterNames.find(
        (name) => name !== ownerName && sentence.text.includes(name),
      );
      if (!actor) {
        continue;
      }

      issues.push({
        category: 'item',
        severity: 'warning',
        message: `“${item.name}”当前记在${ownerName}名下，正文却让${actor}直接使用。`,
        suggestion: `补写${actor}从${ownerName}处借来、取得或夺走“${item.name}”的过程，或改成${ownerName}亲自使用。`,
        sourceSentence: sentence.text,
        startOffset: sentence.start,
        endOffset: sentence.end,
        factId: null,
      });
    }
  }

  return uniqueIssues(issues);
}

function detectKnowledgeBoundaryIssues(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): ChapterAuditIssue[] {
  const issues: ChapterAuditIssue[] = [];

  for (const character of input.characters) {
    for (const knowledge of character.knowledge ?? []) {
      if (
        !knowledge.objectiveTruth.trim() ||
        knowledge.objectiveTruth.trim() === knowledge.characterBelief.trim()
      ) {
        continue;
      }

      for (const sentence of sentences) {
        if (
          !sentenceMentionsName(sentence.text, character.name) ||
          !THOUGHT_VERBS.test(sentence.text) ||
          !sentence.text.includes(knowledge.objectiveTruth.trim())
        ) {
          continue;
        }

        issues.push({
          category: 'knowledge',
          severity: 'warning',
          message: `${character.name}目前仍认为“${knowledge.characterBelief}”，正文却写成已经知道“${knowledge.objectiveTruth}”。`,
          suggestion: `改成“他仍以为${knowledge.characterBelief}”这类符合当前认知的表达，或先写一段让他得知真相、并且改变认知的场景。`,
          sourceSentence: sentence.text,
          startOffset: sentence.start,
          endOffset: sentence.end,
          factId: null,
        });
      }
    }
  }

  return uniqueIssues(issues);
}

function buildQualityReport(
  input: ChapterAuditInput,
  issues: ChapterAuditIssue[],
): ChapterQualityReport {
  const issueCounts = issues.reduce<Partial<Record<ChapterAuditIssueCategory, number>>>(
    (counts, issue) => ({
      ...counts,
      [issue.category]: (counts[issue.category] ?? 0) + 1,
    }),
    {},
  );
  const sentences = splitSentences(input.content);
  const averageSentenceLength =
    sentences.length > 0
      ? Math.round(
          sentences.reduce((sum, sentence) => sum + Array.from(sentence.text).length, 0) /
            sentences.length,
        )
      : 0;
  const dialogueRatio =
    input.content.length > 0
      ? (input.content.match(/[“"「][^”"」]+[”"」]/g)?.join('').length ?? 0) / input.content.length
      : 0;
  const hook = hookStatus(input, sentences);
  const pacingStatus =
    (issueCounts.repetition ?? 0) > 0 || averageSentenceLength > 80 ? '可提升' : '良好';
  const densityStatus = informationDensityStatus(input.content);
  const voiceStatus = input.characters.some((character) => character.voice?.trim())
    ? dialogueRatio >= 0.05
      ? '良好'
      : '可提升'
    : '可提升';
  const toneIssueCount = (issueCounts.ai_tone ?? 0) + (issueCounts.repetition ?? 0);
  const proseStatus = toneIssueCount >= 2 ? '需优先处理' : toneIssueCount === 1 ? '可提升' : '良好';
  const continuityStatus =
    issues.length === 0 ? '良好' : issues.length < 3 ? '可提升' : '需优先处理';
  const dimensions: ChapterQualityDimension[] = [
    dimension('hook', hook.status, hook.summary, hook.suggestion),
    dimension(
      'pacing',
      pacingStatus,
      pacingStatus === '良好'
        ? '段落推进清楚，阅读节奏稳定。'
        : '句子或动作节拍偏重复，读者容易感到停滞。',
      '用新的动作、冲突或对话推进下一拍，减少重复的情绪停顿。',
    ),
    dimension(
      'information_density',
      densityStatus,
      densityStatus === '良好'
        ? '本章信息量适中，没有明显堆砌。'
        : '有效新信息偏少，部分句子在原地打转。',
      '保留与当前冲突直接相关的新信息，删去重复说明。',
    ),
    dimension(
      'character_voice',
      voiceStatus,
      voiceStatus === '良好' ? '人物表达有可辨认的语气。' : '人物声纹资料或对话样本还不够具体。',
      '给主要人物补一两句说话习惯，并让冲突通过对话或选择体现。',
    ),
    dimension(
      'prose',
      proseStatus,
      proseStatus === '良好'
        ? '句子长短有变化，表达较自然。'
        : '套式表达或重复动作偏多，行文显得不够具体。',
      '朗读一遍，把套式情绪换成这个场景独有的动作、感官和反应。',
    ),
    dimension(
      'continuity',
      continuityStatus,
      issues.length === 0
        ? '没有发现前后设定冲突。'
        : `发现 ${issues.length} 处需要确认的前后冲突。`,
      issues.length === 0 ? '保持当前设定一致。' : '先处理连续性提示，再继续往下写。',
    ),
  ];

  return {
    dimensions,
    summary:
      issues.length === 0
        ? '本章整体稳定，可以继续打磨语言和节奏。'
        : `本章有 ${issues.length} 处前后冲突，建议先处理标为“连续性”的问题。`,
    issueCounts,
  };
}

function hookStatus(
  input: ChapterAuditInput,
  sentences: SentenceWithOffset[],
): {
  status: (typeof QUALITY_STATUS_LABELS)[keyof typeof QUALITY_STATUS_LABELS];
  summary: string;
  suggestion: string;
} {
  const hook = input.outline.chapterEndHook.trim();
  if (!hook) {
    return {
      status: '可提升',
      summary: '章纲还没有明确的章末钩子。',
      suggestion: '补一个具体悬念，让读者想知道下一章会发生什么。',
    };
  }
  const tailStart = Math.max(0, Math.floor(input.content.length * 0.75));
  const tail = input.content.slice(tailStart);
  const hookAnchors = [
    ...input.characters.map((character) => character.name),
    ...input.places.map((place) => place.name),
    ...input.items.map((item) => item.name),
  ].filter((anchor) => anchor.trim().length >= 2 && hook.includes(anchor));
  const mentionsHook =
    tail.includes(hook) ||
    hookAnchors.some((anchor) => tail.includes(anchor)) ||
    /[？?！!]|(竟|却|突然|原来|发现|门外|身后|声音)/.test(sentences.at(-1)?.text ?? '');
  return mentionsHook
    ? {
        status: '良好',
        summary: '章末留下了继续阅读的牵引。',
        suggestion: '保持结尾的具体悬念，不要用解释冲淡它。',
      }
    : {
        status: '可提升',
        summary: '章末没有明显接到计划中的钩子。',
        suggestion: `把结尾往“${hook}”上收，用动作、发现或一句未说完的话留下悬念。`,
      };
}

function informationDensityStatus(
  content: string,
): (typeof QUALITY_STATUS_LABELS)[keyof typeof QUALITY_STATUS_LABELS] {
  const characters = Array.from(content.replace(/[^\u3400-\u9fff]/g, ''));
  if (characters.length < 20) {
    return '可提升';
  }
  const bigrams = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    bigrams.add(`${characters[index]}${characters[index + 1]}`);
  }
  const ratio = bigrams.size / Math.max(1, characters.length - 1);
  return ratio < 0.55 ? '可提升' : '良好';
}

function dimension(
  key: ChapterQualityDimensionKey,
  statusLabel: (typeof QUALITY_STATUS_LABELS)[keyof typeof QUALITY_STATUS_LABELS],
  summary: string,
  suggestion: string,
): ChapterQualityDimension {
  const status =
    statusLabel === QUALITY_STATUS_LABELS.weak
      ? 'weak'
      : statusLabel === QUALITY_STATUS_LABELS.watch
        ? 'watch'
        : 'good';
  return {
    key,
    label: QUALITY_DIMENSION_LABELS[key],
    status,
    statusLabel,
    summary,
    suggestion,
  };
}

function sentenceMentionsName(sentence: string, name: string): boolean {
  return Boolean(name.trim()) && sentence.includes(name.trim());
}

function uniqueIssues(issues: ChapterAuditIssue[]): ChapterAuditIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.category}\u0000${issue.startOffset}\u0000${issue.endOffset}\u0000${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
