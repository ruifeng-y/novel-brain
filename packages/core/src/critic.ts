import {
  CRITIC_RULE_VERSION,
  QUALITY_DIMENSIONS,
  QUALITY_DIMENSION_LABELS,
  type CriticAffectedObject,
  type CriticEvidence,
  type CriticFindingCode,
  type CriticFindingDimension,
  type CriticSeverity,
  type CriticSourceRef,
  type QualityDimension,
} from "@novel-brain/contracts";

export { CRITIC_RULE_VERSION };

export interface CriticChapterInput {
  id: string;
  versionId: string;
  number: number;
  title: string;
  content: string;
  povCharacterId: string | null;
  povCharacterName: string | null;
  goal: string;
  location: string;
  requiredBeats: string[];
  requiredFacts: string[];
  outlineNodeId: string | null;
}

export interface CriticFactInput {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  sourceChapterNumber: number;
  validFromChapter: number;
  validToChapter: number | null;
  sourceType?: "fact" | "character" | "world_rule" | "golden_finger";
  sourceLabel?: string;
}

export interface CriticTimelineEventInput {
  id: string;
  eventText: string;
  validFromChapter: number;
  validToChapter: number | null;
  locator: string;
}

export interface CriticKnowledgeStateInput {
  id: string;
  characterId: string;
  characterName: string;
  objectiveFactId: string;
  state: "knowledge" | "belief" | "suspicion" | "misbelief" | "unknown";
  claimedContent: string | null;
  validFromChapter: number;
  validToChapter: number | null;
}

export interface CriticLocationInput {
  id: string;
  name: string;
  aliases: string[];
  validFromChapter: number;
  validToChapter: number | null;
}

export interface CriticVoiceInput {
  id: string;
  characterId: string;
  characterName: string;
  voiceGuide: string;
  voiceSample: string;
}

export interface CriticStyleBaselineInput {
  id: string;
  versionNodeId: string;
  excerpts: string[];
}

export interface CriticEvaluationInput {
  chapter: CriticChapterInput;
  facts: CriticFactInput[];
  timelineEvents: CriticTimelineEventInput[];
  knowledgeStates: CriticKnowledgeStateInput[];
  locations: CriticLocationInput[];
  voices: CriticVoiceInput[];
  styleBaseline: CriticStyleBaselineInput | null;
}

export interface CriticFindingCandidate {
  code: CriticFindingCode;
  dimension: CriticFindingDimension;
  qualityDimension: QualityDimension;
  severity: CriticSeverity;
  structural: boolean;
  evidence: CriticEvidence[];
  sourceRefs: CriticSourceRef[];
  affectedObjects: CriticAffectedObject[];
  recommendation: string;
  dedupeKey: string;
}

export interface CriticDimensionCandidate {
  dimension: QualityDimension;
  label: string;
  score: number;
  rationale: string;
  evidence: CriticEvidence[];
}

export interface CriticEvaluation {
  ruleVersion: typeof CRITIC_RULE_VERSION;
  findings: CriticFindingCandidate[];
  dimensions: CriticDimensionCandidate[];
}

interface TextSpan {
  text: string;
  start: number;
  end: number;
}

export function evaluateCritic(input: CriticEvaluationInput): CriticEvaluation {
  const baseFindings = [
    ...evaluateFactContradictions(input),
    ...evaluateTimelineConflicts(input),
    ...evaluateKnowledgeBoundaries(input),
    ...evaluateMotivationBreaks(input),
    ...evaluateLocationConflicts(input),
    ...evaluateStyleDrift(input),
  ];
  const dimensions = evaluateQualityDimensions(input, baseFindings);
  const findings = [...baseFindings, ...evaluateReaderExperience(input, dimensions)].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.dedupeKey.localeCompare(right.dedupeKey),
  );

  return {
    ruleVersion: CRITIC_RULE_VERSION,
    findings,
    dimensions,
  };
}

function evaluateFactContradictions(input: CriticEvaluationInput): CriticFindingCandidate[] {
  const findings: CriticFindingCandidate[] = [];
  for (const fact of input.facts) {
    if (!activeAt(fact.validFromChapter, fact.validToChapter, input.chapter.number)) {
      continue;
    }
    const requiredAction = negatedAction(fact.object);
    if (!requiredAction) {
      continue;
    }
    const sentence = sentenceSpans(input.chapter.content).find(
      (span) =>
        span.text.includes(fact.subject) &&
        span.text.includes(requiredAction) &&
        !/(?:不能|无法|不可|不得)/u.test(span.text),
    );
    if (!sentence) {
      continue;
    }
    const sourceType = fact.sourceType ?? "fact";
    const sourceLabel = fact.sourceLabel ?? `${fact.subject} · ${fact.predicate}`;
    findings.push({
      code: "FACT_CONTRADICTION",
      dimension: "continuity",
      qualityDimension: "continuity",
      severity: "P0",
      structural: true,
      evidence: [
        chapterEvidence(input, sentence, "fact", fact.id, null, "正文动作与已确认事实相反。"),
      ],
      sourceRefs: [
        {
          type: sourceType,
          id: fact.id,
          versionId: null,
          label: sourceLabel,
        },
      ],
      affectedObjects: [
        chapterObject(input),
        versionObject(input),
        {
          type: sourceType,
          id: fact.id,
          label: sourceLabel,
        },
      ],
      recommendation: `正文不应出现“${requiredAction}”，请改成符合“${fact.object}”的动作。`,
      dedupeKey: `FACT_CONTRADICTION:${fact.id}:${sentence.start}`,
    });
  }
  return findings;
}

function evaluateTimelineConflicts(input: CriticEvaluationInput): CriticFindingCandidate[] {
  const findings: CriticFindingCandidate[] = [];
  for (const event of input.timelineEvents) {
    if (event.validFromChapter <= input.chapter.number) {
      continue;
    }
    const sentence = sentenceSpans(input.chapter.content).find((span) =>
      span.text.includes(event.eventText),
    );
    if (!sentence) {
      continue;
    }
    findings.push({
      code: "TIMELINE_CONFLICT",
      dimension: "continuity",
      qualityDimension: "continuity",
      severity: "P0",
      structural: true,
      evidence: [
        chapterEvidence(
          input,
          sentence,
          "timeline",
          event.id,
          null,
          `该事件计划在第 ${event.validFromChapter} 章发生，本章是第 ${input.chapter.number} 章。`,
        ),
      ],
      sourceRefs: [
        {
          type: "timeline_event",
          id: event.id,
          versionId: null,
          label: event.locator,
        },
      ],
      affectedObjects: [
        chapterObject(input),
        versionObject(input),
        { type: "timeline_event", id: event.id, label: event.locator },
      ],
      recommendation: "删去提前发生的事件，或调整本章时间线并重新核对前后因果。",
      dedupeKey: `TIMELINE_CONFLICT:${event.id}:${sentence.start}`,
    });
  }
  return findings;
}

function evaluateKnowledgeBoundaries(input: CriticEvaluationInput): CriticFindingCandidate[] {
  const findings: CriticFindingCandidate[] = [];
  const povId = input.chapter.povCharacterId;
  if (!povId) {
    return findings;
  }
  const factById = new Map(input.facts.map((fact) => [fact.id, fact]));
  for (const state of input.knowledgeStates) {
    if (
      state.characterId !== povId ||
      state.state !== "unknown" ||
      !activeAt(state.validFromChapter, state.validToChapter, input.chapter.number)
    ) {
      continue;
    }
    const secret = state.claimedContent?.trim() || factById.get(state.objectiveFactId)?.object;
    if (!secret) {
      continue;
    }
    const sentence = sentenceSpans(input.chapter.content).find(
      (span) =>
        span.text.includes(secret) &&
        (span.text.includes(state.characterName) || span.text.includes("我")) &&
        /(?:知道|明白|想起|记起|意识到|发现|确信|断定)/u.test(span.text),
    );
    if (!sentence) {
      continue;
    }
    findings.push({
      code: "UNDISCLOSED_KNOWLEDGE",
      dimension: "continuity",
      qualityDimension: "continuity",
      severity: "P0",
      structural: true,
      evidence: [
        chapterEvidence(
          input,
          sentence,
          "knowledge",
          state.id,
          null,
          `${state.characterName}在这一章尚未获得这条信息。`,
        ),
      ],
      sourceRefs: [
        {
          type: "character_knowledge",
          id: state.id,
          versionId: null,
          label: `${state.characterName} · 未知`,
        },
      ],
      affectedObjects: [
        chapterObject(input),
        versionObject(input),
        { type: "character", id: state.characterId, label: state.characterName },
        { type: "character_knowledge", id: state.id, label: "角色认知" },
      ],
      recommendation: "补上信息揭示过程，或改成角色怀疑、误信或不知道。",
      dedupeKey: `UNDISCLOSED_KNOWLEDGE:${state.id}:${sentence.start}`,
    });
  }
  return findings;
}

function evaluateMotivationBreaks(input: CriticEvaluationInput): CriticFindingCandidate[] {
  if (!/(?:找到|保护|护住|阻止|救|追查|夺|守住|进入|揭开|守住)/u.test(input.chapter.goal)) {
    return [];
  }
  const sentence = sentenceSpans(input.chapter.content).find((span) =>
    /(?:转身离开|不再战斗|不再追查|放弃|就此罢手|抛下)/u.test(span.text),
  );
  if (!sentence || !input.chapter.outlineNodeId) {
    return [];
  }
  return [
    {
      code: "MOTIVATION_BREAK",
      dimension: "reader_experience",
      qualityDimension: "character_voice",
      severity: "P1",
      structural: false,
      evidence: [
        chapterEvidence(
          input,
          sentence,
          "outline",
          input.chapter.outlineNodeId,
          null,
          `章目标是“${input.chapter.goal}”，正文动作没有给出转向理由。`,
        ),
      ],
      sourceRefs: [
        {
          type: "outline_node",
          id: input.chapter.outlineNodeId,
          versionId: null,
          label: `第 ${input.chapter.number} 章章纲`,
        },
      ],
      affectedObjects: [
        chapterObject(input),
        versionObject(input),
        {
          type: "outline_node",
          id: input.chapter.outlineNodeId,
          label: `第 ${input.chapter.number} 章章纲`,
        },
      ],
      recommendation: "补上人物改变决定的触发事件，或让动作继续服务本章目标。",
      dedupeKey: `MOTIVATION_BREAK:${sentence.start}`,
    },
  ];
}

function evaluateLocationConflicts(input: CriticEvaluationInput): CriticFindingCandidate[] {
  const findings: CriticFindingCandidate[] = [];
  const expected = normalize(input.chapter.location);
  for (const location of input.locations) {
    if (
      !activeAt(location.validFromChapter, location.validToChapter, input.chapter.number) ||
      normalize(location.name) === expected
    ) {
      continue;
    }
    const names = [location.name, ...location.aliases].filter(Boolean);
    const sentence = sentenceSpans(input.chapter.content).find(
      (span) =>
        names.some((name) => span.text.includes(name)) &&
        /(?:走进|抵达|来到|进入|身在|站在|回到)/u.test(span.text),
    );
    if (!sentence) {
      continue;
    }
    findings.push({
      code: "LOCATION_CONFLICT",
      dimension: "continuity",
      qualityDimension: "continuity",
      severity: "P1",
      structural: true,
      evidence: [
        chapterEvidence(
          input,
          sentence,
          "location",
          location.id,
          null,
          `本章章纲地点是“${input.chapter.location}”，正文却出现另一地点。`,
        ),
      ],
      sourceRefs: [
        {
          type: "map_node",
          id: location.id,
          versionId: null,
          label: location.name,
        },
      ],
      affectedObjects: [
        chapterObject(input),
        versionObject(input),
        { type: "map_node", id: location.id, label: location.name },
      ],
      recommendation: "确认人物是否已经移动；若没有移动过程，改回本章章纲地点。",
      dedupeKey: `LOCATION_CONFLICT:${location.id}:${sentence.start}`,
    });
  }
  return findings;
}

function evaluateStyleDrift(input: CriticEvaluationInput): CriticFindingCandidate[] {
  const styleFindings: CriticFindingCandidate[] = [];
  const punctuationCount = countMatches(input.chapter.content, /[！!]/gu);
  const paragraph = paragraphSpans(input.chapter.content)
    .filter((span) => countMatches(span.text, /[！!]/gu) > 0)
    .sort((left, right) => right.text.length - left.text.length)[0];
  const voice = input.voices.find((entry) => entry.characterId === input.chapter.povCharacterId);
  const voiceRequiresRestraint = voice
    ? /(?:少用感叹|克制|不要感叹|避免感叹)/u.test(voice.voiceGuide)
    : false;
  const baselineText = input.styleBaseline?.excerpts.join("\n") ?? "";
  const baselineExclamations = countMatches(baselineText, /[！!]/gu);
  const baselineLength = Math.max(1, baselineText.length);
  const baselineRate = baselineExclamations / baselineLength;
  const draftRate = punctuationCount / Math.max(1, input.chapter.content.length);
  const baselineAverage = averageSentenceLength(baselineText);
  const draftAverage = averageSentenceLength(input.chapter.content);
  const baselineShift =
    baselineAverage >= 10 && draftAverage >= 25 && draftAverage >= baselineAverage * 1.8;
  const punctuationShift = punctuationCount >= 3 && draftRate >= Math.max(0.04, baselineRate * 3);
  const voiceShift = voiceRequiresRestraint && punctuationCount >= 3;
  if (!paragraph || (!voiceShift && !baselineShift && !punctuationShift)) {
    return styleFindings;
  }
  const sourceId = voice?.id ?? input.styleBaseline?.id;
  if (!sourceId) {
    return styleFindings;
  }
  const sourceRef: CriticSourceRef = voice
    ? {
        type: "character",
        id: voice.characterId,
        versionId: null,
        label: `${voice.characterName} · 声线`,
      }
    : {
        type: "style_baseline",
        id: sourceId,
        versionId: input.styleBaseline?.versionNodeId ?? null,
        label: "已批准风格基线",
      };
  styleFindings.push({
    code: "STYLE_DRIFT",
    dimension: "style",
    qualityDimension: voice ? "character_voice" : "prose",
    severity: "P2",
    structural: false,
    evidence: [
      chapterEvidence(
        input,
        paragraph,
        "voice",
        sourceId,
        null,
        voiceRequiresRestraint
          ? `人物声线要求“${voice?.voiceGuide}”，本章连续使用高强度感叹。`
          : "本章句式强度与已批准风格基线偏离较大。",
      ),
    ],
    sourceRefs: [sourceRef],
    affectedObjects: [
      chapterObject(input),
      versionObject(input),
      voice
        ? { type: "character", id: voice.characterId, label: voice.characterName }
        : {
            type: "style_baseline",
            id: sourceId,
            label: "已批准风格基线",
          },
    ],
    recommendation: "对比已批准样本，收紧感叹和句长；如果是有意变化，请记录理由。",
    dedupeKey: `STYLE_DRIFT:${sourceId}:${paragraph.start}`,
  });
  return styleFindings;
}

function evaluateQualityDimensions(
  input: CriticEvaluationInput,
  findings: CriticFindingCandidate[],
): CriticDimensionCandidate[] {
  const content = input.chapter.content;
  const paragraphs = paragraphSpans(content);
  const sentences = sentenceSpans(content);
  const lastParagraph = paragraphs.at(-1) ?? spanAt(content, 0);
  const firstParagraph = paragraphs[0] ?? spanAt(content, 0);
  const continuityFindings = findings.filter(
    (finding) => finding.qualityDimension === "continuity",
  );
  const continuityPenalty = continuityFindings.reduce(
    (total, finding) => total + severityPenalty(finding.severity),
    0,
  );
  const dialogue = sentences.find((span) => /[“”「」]/u.test(span.text)) ?? firstParagraph;
  const voice = input.voices.find((entry) => entry.characterId === input.chapter.povCharacterId);
  const cliche = sentences.find((span) =>
    /(?:不禁|仿佛|似乎|与此同时|空气仿佛凝固|嘴角勾起|心中一震)/u.test(span.text),
  );
  const hookScore = scoreHook(lastParagraph.text);
  const pacingScore = scorePacing(sentences, paragraphs);
  const densityScore = scoreDensity(content);
  const voiceScore = voice
    ? findings.some((finding) => finding.qualityDimension === "character_voice")
      ? 2
      : dialogue
        ? 4
        : 3
    : 3;
  const proseScore = cliche ? 2 : content.length >= 120 ? 4 : 3;
  const continuityScore = Math.max(1, Math.floor(5 - continuityPenalty));
  const scores: Record<QualityDimension, number> = {
    hook: hookScore,
    pacing: pacingScore,
    information_density: densityScore,
    character_voice: voiceScore,
    prose: proseScore,
    continuity: continuityScore,
  };
  const rationales: Record<QualityDimension, string> = {
    hook: hookScore >= 4 ? "章末有明确的追读信号。" : "章末追读信号偏弱。",
    pacing: pacingScore >= 4 ? "句长和段落推进处于可读区间。" : "句式或段落长度波动较大。",
    information_density:
      densityScore >= 4 ? "本章信息量稳定，没有明显重复填充。" : "本章存在重复或信息偏薄。",
    character_voice:
      voiceScore >= 4 ? "对话和叙述保持了人物声线。" : "人物声线证据不足或出现偏离。",
    prose: proseScore >= 4 ? "文笔未出现高频套路化表达。" : "检测到套路化或空泛表达。",
    continuity:
      continuityScore >= 4 ? "未发现阻断性连续性问题。" : "存在需要处理的结构化连续性问题。",
  };
  const evidenceByDimension: Record<QualityDimension, CriticEvidence> = {
    hook: textEvidence(input, lastParagraph, "章末段落"),
    pacing: textEvidence(input, firstParagraph, "开头段落"),
    information_density: textEvidence(input, longestParagraph(paragraphs), "信息最密段落"),
    character_voice: voice
      ? {
          ...textEvidence(input, dialogue, "人物对话"),
          kind: "voice",
          sourceId: voice.id,
          explanation: `对照${voice.characterName}的已批准声线样本。`,
        }
      : textEvidence(input, dialogue, "人物对话"),
    prose: textEvidence(input, cliche ?? firstParagraph, cliche ? "套路化表达" : "代表性段落"),
    continuity: continuityFindings[0]?.evidence[0]
      ? { ...continuityFindings[0].evidence[0] }
      : textEvidence(input, firstParagraph, "本章开头"),
  };
  return QUALITY_DIMENSIONS.map((dimension) => ({
    dimension,
    label: QUALITY_DIMENSION_LABELS[dimension],
    score: scores[dimension],
    rationale: rationales[dimension],
    evidence: [evidenceByDimension[dimension]],
  }));
}

function evaluateReaderExperience(
  input: CriticEvaluationInput,
  dimensions: CriticDimensionCandidate[],
): CriticFindingCandidate[] {
  const hook = dimensions.find((dimension) => dimension.dimension === "hook");
  if (!hook || hook.score >= 4) {
    return [];
  }
  const evidence = hook.evidence[0];
  if (!evidence) {
    return [];
  }
  return [
    {
      code: "WEAK_CHAPTER_END_HOOK",
      dimension: "reader_experience",
      qualityDimension: "hook",
      severity: hook.score <= 2 ? "P1" : "P2",
      structural: false,
      evidence: [
        {
          ...evidence,
          explanation: "章末没有形成足够明确的追读问题、反转或情绪落点。",
        },
      ],
      sourceRefs: [
        {
          type: "chapter",
          id: input.chapter.id,
          versionId: input.chapter.versionId,
          label: `第 ${input.chapter.number} 章`,
        },
      ],
      affectedObjects: [chapterObject(input), versionObject(input)],
      recommendation: "在章末补一个具体悬念、反转或未完成动作，避免用总结句收尾。",
      dedupeKey: `WEAK_CHAPTER_END_HOOK:${evidence.startOffset}`,
    },
  ];
}

function chapterEvidence(
  input: CriticEvaluationInput,
  span: TextSpan,
  kind: CriticEvidence["kind"],
  sourceId: string | null,
  sourceVersionId: string | null,
  explanation: string,
): CriticEvidence {
  return {
    kind,
    sourceId,
    sourceVersionId,
    chapterId: input.chapter.id,
    chapterVersionId: input.chapter.versionId,
    quote: span.text.trim().slice(0, 2_000),
    startOffset: span.start,
    endOffset: span.end,
    locator: locator(input.chapter, span.start),
    explanation,
  };
}

function textEvidence(input: CriticEvaluationInput, span: TextSpan, label: string): CriticEvidence {
  return {
    ...chapterEvidence(input, span, "text", null, null, label),
    locator: `${locator(input.chapter, span.start)} · ${label}`,
  };
}

function chapterObject(input: CriticEvaluationInput): CriticAffectedObject {
  return {
    type: "chapter",
    id: input.chapter.id,
    label: `第 ${input.chapter.number} 章 ${input.chapter.title}`,
  };
}

function versionObject(input: CriticEvaluationInput): CriticAffectedObject {
  return {
    type: "chapter_version",
    id: input.chapter.versionId,
    label: `第 ${input.chapter.number} 章正文`,
  };
}

function sentenceSpans(content: string): TextSpan[] {
  return Array.from(content.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/gu)).map((match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function paragraphSpans(content: string): TextSpan[] {
  const spans: TextSpan[] = [];
  const pattern = /[^\n]+/gu;
  for (const match of content.matchAll(pattern)) {
    const text = match[0].trim();
    if (!text) {
      continue;
    }
    const leading = match[0].length - match[0].trimStart().length;
    const start = (match.index ?? 0) + leading;
    spans.push({ text, start, end: start + text.length });
  }
  return spans;
}

function longestParagraph(paragraphs: TextSpan[]): TextSpan {
  return (
    [...paragraphs].sort((left, right) => right.text.length - left.text.length)[0] ?? spanAt("", 0)
  );
}

function spanAt(text: string, start: number): TextSpan {
  return { text, start, end: start + Math.max(1, text.length) };
}

function locator(chapter: CriticChapterInput, start: number): string {
  const paragraph = countMatches(chapter.content.slice(0, start), /\n\s*\n/gu) + 1;
  return `第 ${chapter.number} 章 · 第 ${paragraph} 段`;
}

function negatedAction(value: string): string | null {
  const match = /(?:不能|无法|不可|不得)([^，。；！？\n]{2,})/u.exec(value);
  return match?.[1]?.trim() ?? null;
}

function activeAt(from: number, to: number | null, chapterNumber: number): boolean {
  return from <= chapterNumber && (to === null || to >= chapterNumber);
}

function normalize(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

function severityRank(severity: CriticSeverity): number {
  return Number(severity.slice(1));
}

function severityPenalty(severity: CriticSeverity): number {
  switch (severity) {
    case "P0":
      return 3;
    case "P1":
      return 1.5;
    case "P2":
      return 0.5;
    case "P3":
      return 0.25;
  }
}

function scoreHook(text: string): number {
  let score = 3;
  if (/[?？…]$/u.test(text.trim())) {
    score += 1;
  }
  if (/(?:却|竟|忽然|原来|没想到|就在这时|门外|身后|终于)/u.test(text)) {
    score += 1;
  }
  if (text.trim().length < 4) {
    score -= 1;
  }
  return clampScore(score);
}

function scorePacing(sentences: TextSpan[], paragraphs: TextSpan[]): number {
  const average = averageSentenceLength(sentences.map((span) => span.text).join(""));
  let score = average >= 8 && average <= 42 ? 4 : average > 58 || average < 5 ? 2 : 3;
  if (paragraphs.length >= 3) {
    score += 1;
  }
  if (paragraphs.length === 1 && sentences.length > 12) {
    score -= 1;
  }
  return clampScore(score);
}

function scoreDensity(content: string): number {
  if (content.trim().length < 80) {
    return 3;
  }
  const repeated = /([\p{Script=Han}]{2,8})\1{2,}/u.test(content);
  return repeated ? 2 : 4;
}

function averageSentenceLength(content: string): number {
  const sentences = sentenceSpans(content);
  if (sentences.length === 0) {
    return content.length;
  }
  return sentences.reduce((total, span) => total + span.text.length, 0) / sentences.length;
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function clampScore(score: number): number {
  return Math.max(1, Math.min(5, Math.round(score)));
}
