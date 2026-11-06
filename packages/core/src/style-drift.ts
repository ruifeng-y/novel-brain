export interface StyleDriftBaselineInput {
  id: string;
  version: number;
  scope: "work" | "character";
  scopeId: string | null;
  dimension: "character_voice" | "prose";
  guides: string[];
  samples: Array<{
    chapterId: string;
    chapterVersionId: string;
    excerpt: string;
    locator: string;
  }>;
}

export interface StyleDriftChapterInput {
  id: string;
  versionId: string;
  number: number;
  title: string;
  content: string;
}

export interface StyleGrowthMarkerInput {
  id: string;
  characterId: string;
  fromChapter: number;
  toChapter: number;
  startState: string;
  endState: string;
  reason: string;
}

export interface StyleDriftModelProvenance {
  provider: string;
  model: string;
  parameters: Record<string, unknown>;
}

export interface StyleDriftPromptProvenance {
  key: string;
  version: number;
}

export interface StyleDriftEvaluationInput {
  scope: "chapter" | "volume" | "cross_volume";
  chapters: StyleDriftChapterInput[];
  baseline: StyleDriftBaselineInput;
  growthMarkers: StyleGrowthMarkerInput[];
  model: StyleDriftModelProvenance;
  prompt: StyleDriftPromptProvenance;
}

export interface StyleDriftFindingCandidate {
  code: "CHARACTER_VOICE_DRIFT" | "WORK_STYLE_DRIFT" | "INTENTIONAL_CHARACTER_DEVELOPMENT";
  classification: "drift" | "intentional_development";
  dimension: "character_voice" | "prose";
  chapterId: string;
  chapterVersionId: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  locator: string;
  explanation: string;
  recommendation: string;
  growthEvidence: {
    markerId: string;
    startState: string;
    endState: string;
    reason: string;
  } | null;
}

export interface StyleDriftTrendPoint {
  chapterId: string;
  chapterVersionId: string;
  chapterNumber: number;
  exclamationRate: number;
  averageSentenceLength: number;
  dialogueRatio: number;
  deviationScore: number;
}

export interface StyleDriftEvaluation {
  classification: "stable" | "drift" | "mixed";
  findings: StyleDriftFindingCandidate[];
  trend: StyleDriftTrendPoint[];
  summary: string;
  baselineVersion: number;
  model: StyleDriftModelProvenance;
  prompt: StyleDriftPromptProvenance;
}

interface TextSpan {
  text: string;
  start: number;
  end: number;
}

interface StyleMetrics {
  exclamationCount: number;
  exclamationRate: number;
  averageSentenceLength: number;
  dialogueRatio: number;
}

type GrowthDirection = "more_intense" | "more_restrained" | "unknown";

export function evaluateStyleDrift(input: StyleDriftEvaluationInput): StyleDriftEvaluation {
  const baseline = metrics(input.baseline.samples.map((sample) => sample.excerpt).join("\n"));
  const findings: StyleDriftFindingCandidate[] = [];
  const trend: StyleDriftTrendPoint[] = [];

  for (const chapter of input.chapters) {
    const observed = metrics(chapter.content);
    const deviationScore = scoreDeviation(observed, baseline);
    const direction = deviationDirection(observed, baseline);
    trend.push({
      chapterId: chapter.id,
      chapterVersionId: chapter.versionId,
      chapterNumber: chapter.number,
      exclamationRate: round(observed.exclamationRate),
      averageSentenceLength: round(observed.averageSentenceLength),
      dialogueRatio: round(observed.dialogueRatio),
      deviationScore: round(deviationScore),
    });
    if (deviationScore < 2) {
      continue;
    }
    const growth = matchingGrowthMarker(input, chapter.number, direction);
    const paragraph = evidenceParagraph(chapter.content);
    if (growth) {
      findings.push({
        code: "INTENTIONAL_CHARACTER_DEVELOPMENT",
        classification: "intentional_development",
        dimension: input.baseline.dimension,
        chapterId: chapter.id,
        chapterVersionId: chapter.versionId,
        quote: paragraph.text.slice(0, 2_000),
        startOffset: paragraph.start,
        endOffset: paragraph.end,
        locator: locator(chapter.number, paragraph.start, chapter.content),
        explanation: `这条变化落在人物弧“${growth.startState} → ${growth.endState}”的有效窗口内。`,
        recommendation: "保留这次成长变化，并记录触发事件；无需按旧声线改回原样。",
        growthEvidence: {
          markerId: growth.id,
          startState: growth.startState,
          endState: growth.endState,
          reason: growth.reason,
        },
      });
      continue;
    }
    findings.push({
      code:
        input.baseline.dimension === "character_voice"
          ? "CHARACTER_VOICE_DRIFT"
          : "WORK_STYLE_DRIFT",
      classification: "drift",
      dimension: input.baseline.dimension,
      chapterId: chapter.id,
      chapterVersionId: chapter.versionId,
      quote: paragraph.text.slice(0, 2_000),
      startOffset: paragraph.start,
      endOffset: paragraph.end,
      locator: locator(chapter.number, paragraph.start, chapter.content),
      explanation: driftExplanation(input.baseline.dimension, observed, baseline),
      recommendation: "对照已批准样本检查句长、感叹和对话密度，再决定是否需要保留为有意变化。",
      growthEvidence: null,
    });
  }

  const hasDrift = findings.some((finding) => finding.classification === "drift");
  const hasGrowth = findings.some(
    (finding) => finding.classification === "intentional_development",
  );
  return {
    classification:
      hasDrift && hasGrowth ? "mixed" : hasDrift ? "drift" : hasGrowth ? "stable" : "stable",
    findings,
    trend,
    summary: summaryFor(findings, input.scope),
    baselineVersion: input.baseline.version,
    model: input.model,
    prompt: input.prompt,
  };
}

function scoreDeviation(observed: StyleMetrics, baseline: StyleMetrics): number {
  let score = 0;
  if (
    observed.exclamationRate >= Math.max(0.02, baseline.exclamationRate * 2.5) &&
    observed.exclamationCount >= 2
  ) {
    score += 2;
  }
  if (
    baseline.averageSentenceLength >= 6 &&
    observed.averageSentenceLength >= Math.max(24, baseline.averageSentenceLength * 1.7)
  ) {
    score += 1;
  }
  if (
    baseline.dialogueRatio >= 0.12 &&
    observed.dialogueRatio <= Math.max(0.01, baseline.dialogueRatio * 0.35)
  ) {
    score += 1;
  }
  return score;
}

function deviationDirection(observed: StyleMetrics, baseline: StyleMetrics): GrowthDirection {
  if (
    observed.exclamationRate > baseline.exclamationRate * 1.8 ||
    observed.averageSentenceLength > baseline.averageSentenceLength * 1.35
  ) {
    return "more_intense";
  }
  if (
    observed.exclamationRate < baseline.exclamationRate * 0.5 &&
    observed.averageSentenceLength < baseline.averageSentenceLength * 0.8
  ) {
    return "more_restrained";
  }
  return "unknown";
}

function matchingGrowthMarker(
  input: StyleDriftEvaluationInput,
  chapterNumber: number,
  direction: GrowthDirection,
): StyleGrowthMarkerInput | undefined {
  if (direction === "unknown" || input.baseline.scope !== "character" || !input.baseline.scopeId) {
    return undefined;
  }
  return input.growthMarkers.find((marker) => {
    if (
      marker.characterId !== input.baseline.scopeId ||
      chapterNumber < marker.fromChapter ||
      chapterNumber > marker.toChapter
    ) {
      return false;
    }
    return growthDirection(marker.startState, marker.endState) === direction;
  });
}

function growthDirection(startState: string, endState: string): GrowthDirection {
  if (/(?:热烈|激昂|外放|爆发|不再克制|锋芒|强硬)/u.test(endState)) {
    return "more_intense";
  }
  if (/(?:克制|冷静|内敛|沉稳|沉默|收敛)/u.test(endState)) {
    return "more_restrained";
  }
  if (/(?:热烈|激昂|外放|爆发|不再克制|锋芒|强硬)/u.test(startState)) {
    return "more_restrained";
  }
  return "unknown";
}

export function measureStyleText(content: string): {
  averageSentenceLength: number;
  exclamationRate: number;
  dialogueRatio: number;
} {
  const measured = metrics(content);
  return {
    averageSentenceLength: round(measured.averageSentenceLength),
    exclamationRate: round(measured.exclamationRate),
    dialogueRatio: round(measured.dialogueRatio),
  };
}

function metrics(content: string): StyleMetrics {
  const sentences = sentenceSpans(content);
  const dialogueCharacters = Array.from(content.matchAll(/[“”「」]/gu)).length;
  const exclamationCount = countMatches(content, /[！!]/gu);
  return {
    exclamationCount,
    exclamationRate: exclamationCount / Math.max(1, content.replace(/\s+/gu, "").length),
    averageSentenceLength:
      sentences.length === 0
        ? content.length
        : sentences.reduce((total, sentence) => total + sentence.text.length, 0) / sentences.length,
    dialogueRatio: dialogueCharacters / Math.max(1, content.replace(/\s+/gu, "").length),
  };
}

function evidenceParagraph(content: string): TextSpan {
  const paragraphs = Array.from(content.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/gu));
  const spans = paragraphs.map((match) => {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const text = raw.trim();
    return {
      text,
      start: (match.index ?? 0) + leading,
      end: (match.index ?? 0) + leading + text.length,
    };
  });
  return (
    spans
      .filter((span) => /[！!]/u.test(span.text))
      .sort((left, right) => right.text.length - left.text.length)[0] ??
    spans.sort((left, right) => right.text.length - left.text.length)[0] ?? {
      text: content,
      start: 0,
      end: Math.max(1, content.length),
    }
  );
}

function sentenceSpans(content: string): TextSpan[] {
  return Array.from(content.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/gu)).map((match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function locator(chapterNumber: number, start: number, content: string): string {
  const paragraph = countMatches(content.slice(0, start), /\n\s*\n/gu) + 1;
  return `第 ${chapterNumber} 章 · 第 ${paragraph} 段`;
}

function driftExplanation(
  dimension: StyleDriftBaselineInput["dimension"],
  observed: StyleMetrics,
  baseline: StyleMetrics,
): string {
  const subject = dimension === "character_voice" ? "人物声线" : "作品文风";
  if (observed.exclamationRate > baseline.exclamationRate * 1.8) {
    return `${subject}的感叹强度明显高于已批准样本。`;
  }
  if (observed.averageSentenceLength > baseline.averageSentenceLength * 1.35) {
    return `${subject}的句长明显长于已批准样本。`;
  }
  return `${subject}的对话密度明显低于已批准样本。`;
}

function summaryFor(findings: StyleDriftFindingCandidate[], scope: string): string {
  const drift = findings.filter((finding) => finding.classification === "drift").length;
  const growth = findings.length - drift;
  const scopeLabel = scope === "chapter" ? "本章" : scope === "volume" ? "本卷" : "跨卷区间";
  if (findings.length === 0) {
    return `${scopeLabel}与已批准基线一致，未发现声线或文风漂移。`;
  }
  if (drift === 0) {
    return `${scopeLabel}有 ${growth} 处有意成长变化，均有角色弧证据，不计为漂移。`;
  }
  return `${scopeLabel}发现 ${drift} 处漂移${growth > 0 ? `、${growth} 处有证据的成长变化` : ""}。`;
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
