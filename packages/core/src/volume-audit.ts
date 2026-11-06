import {
  VOLUME_AUDIT_RULE_VERSION,
  type CriticAffectedObject,
  type CriticEvidence,
  type CriticFindingCode,
  type CriticFindingDimension,
  type CriticSeverity,
  type CriticSourceRef,
  type QualityDimension,
  type VolumeAuditFindingCode,
  type VolumeAuditStatus,
  type VolumeAuditSummary,
} from "@novel-brain/contracts";

export { VOLUME_AUDIT_RULE_VERSION };

export interface VolumeAuditUpstreamFinding {
  id: string;
  chapterId: string;
  chapterVersionId: string;
  chapterNumber: number;
  code: CriticFindingCode;
  dimension: CriticFindingDimension;
  qualityDimension: QualityDimension;
  severity: CriticSeverity;
  structural: boolean;
  evidence: CriticEvidence[];
  sourceRefs: CriticSourceRef[];
  affectedObjects: CriticAffectedObject[];
  recommendation: string;
}

export interface VolumeAuditChapterInput {
  id: string;
  versionId: string | null;
  number: number;
  title: string;
  content: string;
  outlineGoal: string;
  outlineLocation: string;
  qualityFindings: VolumeAuditUpstreamFinding[];
}

export interface VolumeAuditLedgerEntryInput {
  id: string;
  kind: "plot_thread" | "foreshadow" | "character_arc";
  title: string;
  summary: string;
  status:
    "planned" | "planted" | "progressed" | "paid_off" | "failed_payoff" | "abandoned" | "deferred";
  importance: "must" | "optional";
  sourceChapterNumber: number | null;
  targetWindow: { fromChapter: number; toChapter: number };
  history: Array<{
    action: string;
    chapterNumber: number | null;
    eventId: string | null;
    reason: string;
    evidence: Array<{ strength: "weak" | "strong" }>;
  }>;
  prerequisiteEvents: Array<{
    eventId: string;
    chapterNumber: number | null;
    validFromChapter: number | null;
    validToChapter: number | null;
  }>;
}

export interface VolumeAuditPowerRealmInput {
  id: string;
  pathId: string;
  name: string;
  rank: number;
}

export interface VolumeAuditTimelineEventInput {
  id: string;
  eventText: string;
  validFromChapter: number;
  storyTimeSortKey: number;
  locator: string;
}

export interface VolumeAuditCharacterInput {
  id: string;
  name: string;
}

export interface VolumeAuditInput {
  volume: {
    title: string;
    chapterFrom: number;
    chapterTo: number;
  };
  chapters: VolumeAuditChapterInput[];
  ledgerEntries: VolumeAuditLedgerEntryInput[];
  powerRealms: VolumeAuditPowerRealmInput[];
  timelineEvents: VolumeAuditTimelineEventInput[];
  protagonist: VolumeAuditCharacterInput | null;
  antagonists: VolumeAuditCharacterInput[];
}

export interface VolumeAuditFindingCandidate {
  code: VolumeAuditFindingCode;
  dimension: CriticFindingDimension;
  qualityDimension: QualityDimension;
  severity: CriticSeverity;
  structural: boolean;
  evidence: CriticEvidence[];
  sourceRefs: CriticSourceRef[];
  affectedObjects: CriticAffectedObject[];
  recommendation: string;
  upstreamFindingId: string | null;
  chapterId: string | null;
  chapterVersionId: string | null;
  chapterNumber: number | null;
  dedupeKey: string;
}

export interface VolumeAuditEvaluation {
  ruleVersion: typeof VOLUME_AUDIT_RULE_VERSION;
  status: VolumeAuditStatus;
  findings: VolumeAuditFindingCandidate[];
  summary: VolumeAuditSummary;
}

interface TextSpan {
  text: string;
  start: number;
  end: number;
}

const TERMINAL_LEDGER_STATUSES = new Set(["paid_off", "failed_payoff", "abandoned"]);
const VOLUME_CRITIC_CODES = new Set<CriticFindingCode>([
  "FACT_CONTRADICTION",
  "TIMELINE_CONFLICT",
  "UNDISCLOSED_KNOWLEDGE",
  "MOTIVATION_BREAK",
  "LOCATION_CONFLICT",
]);

export function evaluateVolumeAudit(input: VolumeAuditInput): VolumeAuditEvaluation {
  const chapters = [...input.chapters].sort((left, right) => left.number - right.number);
  const findings = [
    ...evaluateUnauditedChapters(chapters),
    ...evaluateUpstreamFindings(chapters),
    ...evaluateUnresolvedLedger(input, chapters),
    ...evaluateAntagonistUnderestimation(input, chapters),
    ...evaluatePowerInflation(input, chapters),
    ...evaluateStoryTimeOrder(input, chapters),
  ].sort(
    (left, right) =>
      severityRank(left.severity) - severityRank(right.severity) ||
      (left.chapterNumber ?? 0) - (right.chapterNumber ?? 0) ||
      left.code.localeCompare(right.code) ||
      left.dedupeKey.localeCompare(right.dedupeKey),
  );

  const summary = summarize(findings);
  return {
    ruleVersion: VOLUME_AUDIT_RULE_VERSION,
    status: summary.blockers > 0 ? "blocked" : summary.total > 0 ? "warnings" : "passed",
    findings,
    summary,
  };
}

function evaluateUnauditedChapters(
  chapters: VolumeAuditChapterInput[],
): VolumeAuditFindingCandidate[] {
  return chapters
    .filter((chapter) => !chapter.versionId || chapter.content.trim().length === 0)
    .map((chapter) => {
      const quote = chapter.title.trim() || `第 ${chapter.number} 章`;
      return {
        code: "VOLUME_CHAPTER_UNAUDITED" as const,
        dimension: "continuity" as const,
        qualityDimension: "continuity" as const,
        severity: "P1" as const,
        structural: true,
        evidence: [
          {
            kind: "text" as const,
            sourceId: chapter.id,
            sourceVersionId: chapter.versionId,
            chapterId: chapter.id,
            chapterVersionId: chapter.versionId,
            quote,
            startOffset: 0,
            endOffset: Math.max(1, quote.length),
            locator: `第 ${chapter.number} 章 · 未保存正文`,
            explanation: "卷末审计需要已保存的章节正文，当前章没有可审计版本。",
          },
        ],
        sourceRefs: [
          {
            type: "chapter" as const,
            id: chapter.id,
            versionId: chapter.versionId,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
        ],
        affectedObjects: [
          {
            type: "chapter" as const,
            id: chapter.id,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
        ],
        recommendation: "先保存本章正文，再重新运行卷末审计。",
        upstreamFindingId: null,
        chapterId: chapter.id,
        chapterVersionId: chapter.versionId,
        chapterNumber: chapter.number,
        dedupeKey: `VOLUME_CHAPTER_UNAUDITED:${chapter.id}`,
      };
    });
}

function evaluateUpstreamFindings(
  chapters: VolumeAuditChapterInput[],
): VolumeAuditFindingCandidate[] {
  return chapters.flatMap((chapter) =>
    chapter.qualityFindings
      .filter((finding) => VOLUME_CRITIC_CODES.has(finding.code))
      .map((finding) => ({
        code: finding.code,
        dimension: finding.dimension,
        qualityDimension: finding.qualityDimension,
        severity: finding.severity,
        structural: finding.structural,
        evidence: finding.evidence,
        sourceRefs: finding.sourceRefs,
        affectedObjects: finding.affectedObjects,
        recommendation: finding.recommendation,
        upstreamFindingId: finding.id,
        chapterId: chapter.id,
        chapterVersionId: chapter.versionId,
        chapterNumber: chapter.number,
        dedupeKey: `UPSTREAM:${finding.id}`,
      })),
  );
}

function evaluateUnresolvedLedger(
  input: VolumeAuditInput,
  chapters: VolumeAuditChapterInput[],
): VolumeAuditFindingCandidate[] {
  return input.ledgerEntries
    .filter(
      (entry) =>
        !TERMINAL_LEDGER_STATUSES.has(entry.status) &&
        entry.targetWindow.toChapter >= input.volume.chapterFrom &&
        entry.targetWindow.toChapter <= input.volume.chapterTo,
    )
    .map((entry) => {
      const chapter = evidenceChapterForLedger(entry, chapters);
      const quote = evidenceQuoteForLedger(entry, chapter);
      const evidence = chapterEvidence(chapter, quote, `“${entry.title}”在本卷结束时仍未收束。`);
      const mustPayoff = entry.importance === "must";
      return {
        code: "UNRESOLVED_LEDGER_ENTRY" as const,
        dimension: "continuity" as const,
        qualityDimension: "continuity" as const,
        severity: mustPayoff ? ("P0" as const) : ("P1" as const),
        structural: true,
        evidence: [evidence],
        sourceRefs: [
          {
            type: "story_ledger_entry" as const,
            id: entry.id,
            versionId: null,
            label: entry.title,
          },
          {
            type: "chapter" as const,
            id: chapter.id,
            versionId: chapter.versionId,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
        ],
        affectedObjects: [
          {
            type: "story_ledger_entry" as const,
            id: entry.id,
            label: entry.title,
          },
          {
            type: "chapter" as const,
            id: chapter.id,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
        ],
        recommendation: mustPayoff
          ? "在卷末前安排回收，或由作者记录延期/放弃理由并调整目标窗口。"
          : "确认是否在本卷回收；若继续保留，请更新目标章节和读者承诺。",
        upstreamFindingId: null,
        chapterId: chapter.id,
        chapterVersionId: chapter.versionId,
        chapterNumber: chapter.number,
        dedupeKey: `UNRESOLVED_LEDGER_ENTRY:${entry.id}`,
      };
    });
}

function evaluateAntagonistUnderestimation(
  input: VolumeAuditInput,
  chapters: VolumeAuditChapterInput[],
): VolumeAuditFindingCandidate[] {
  const protagonist = input.protagonist;
  if (!protagonist || input.antagonists.length === 0) {
    return [];
  }
  const findings: VolumeAuditFindingCandidate[] = [];
  for (const chapter of chapters) {
    const spans = sentenceSpans(chapter.content);
    const reversal = spans.find(
      (span) =>
        span.text.includes(protagonist.name) &&
        /(?:反杀|逃走|脱身|得手|赢了|活了下来|活命|夺回)/u.test(span.text),
    );
    if (!reversal) {
      continue;
    }
    for (const antagonist of input.antagonists) {
      const weakness = spans.find(
        (span) =>
          span.text.includes(antagonist.name) &&
          /(?:胜券在握|稳操胜券|只派|只带|放走|留他一命|不补刀|懒得|低估|没把|不屑)/u.test(
            span.text,
          ),
      );
      if (!weakness) {
        continue;
      }
      const evidence = [
        chapterEvidence(
          chapter,
          weakness.text,
          `${antagonist.name}已经占据优势，却主动削弱追击或放弃补刀。`,
        ),
        chapterEvidence(
          chapter,
          reversal.text,
          `${protagonist.name}在同一章完成反制，正文没有给出反派失误的额外因果。`,
        ),
      ];
      findings.push({
        code: "ANTAGONIST_UNDERESTIMATION",
        dimension: "reader_experience",
        qualityDimension: "character_voice",
        severity: "P1",
        structural: false,
        evidence,
        sourceRefs: [
          {
            type: "character",
            id: antagonist.id,
            versionId: null,
            label: antagonist.name,
          },
          {
            type: "chapter",
            id: chapter.id,
            versionId: chapter.versionId,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
        ],
        affectedObjects: [
          {
            type: "character",
            id: antagonist.id,
            label: antagonist.name,
          },
          {
            type: "chapter",
            id: chapter.id,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
        ],
        recommendation: "补足反派误判、资源耗尽或主角付出的代价；避免只靠反派降智推进。",
        upstreamFindingId: null,
        chapterId: chapter.id,
        chapterVersionId: chapter.versionId,
        chapterNumber: chapter.number,
        dedupeKey: `ANTAGONIST_UNDERESTIMATION:${antagonist.id}:${weakness.start}`,
      });
    }
  }
  return findings;
}

function evaluatePowerInflation(
  input: VolumeAuditInput,
  chapters: VolumeAuditChapterInput[],
): VolumeAuditFindingCandidate[] {
  if (input.powerRealms.length < 2) {
    return [];
  }
  const findings: VolumeAuditFindingCandidate[] = [];
  const progress: Array<{
    chapter: VolumeAuditChapterInput;
    realm: VolumeAuditPowerRealmInput;
    span: TextSpan;
  }> = [];
  for (const chapter of chapters) {
    const spans = sentenceSpans(chapter.content);
    const matched = new Map<string, { realm: VolumeAuditPowerRealmInput; span: TextSpan }>();
    for (const realm of input.powerRealms) {
      const pattern = new RegExp(
        `(?:突破|踏入|晋升|迈入|结成|凝成)[^。！？\\n]{0,16}${escapeRegExp(realm.name)}`,
        "u",
      );
      const span = spans.find((candidate) => pattern.test(candidate.text));
      if (span) {
        matched.set(realm.id, { realm, span });
      }
    }
    const entries = [...matched.values()].sort(
      (left, right) => left.realm.rank - right.realm.rank || left.span.start - right.span.start,
    );
    for (const entry of entries) {
      progress.push({ chapter, realm: entry.realm, span: entry.span });
    }
    if (entries.length < 2) {
      continue;
    }
    findings.push({
      code: "POWER_INFLATION",
      dimension: "reader_experience",
      qualityDimension: "continuity",
      severity: "P1",
      structural: false,
      evidence: entries
        .slice(0, 2)
        .map((entry) =>
          chapterEvidence(
            chapter,
            entry.span.text,
            `同一章出现“${entry.realm.name}”的境界跃升，缺少独立突破过程或代价。`,
          ),
        ),
      sourceRefs: [
        {
          type: "chapter",
          id: chapter.id,
          versionId: chapter.versionId,
          label: `第 ${chapter.number} 章 ${chapter.title}`,
        },
      ],
      affectedObjects: [
        {
          type: "chapter",
          id: chapter.id,
          label: `第 ${chapter.number} 章 ${chapter.title}`,
        },
      ],
      recommendation: "拆开连续突破，补上瓶颈、代价和冷却，或说明金手指为何能缩短过程。",
      upstreamFindingId: null,
      chapterId: chapter.id,
      chapterVersionId: chapter.versionId,
      chapterNumber: chapter.number,
      dedupeKey: `POWER_INFLATION:${chapter.id}:${entries.map((entry) => entry.realm.id).join(",")}`,
    });
  }

  const ordered = [...progress].sort(
    (left, right) =>
      left.chapter.number - right.chapter.number || left.realm.rank - right.realm.rank,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (
      current.chapter.id !== previous.chapter.id &&
      current.chapter.number - previous.chapter.number <= 3 &&
      current.realm.rank - previous.realm.rank >= 2
    ) {
      findings.push({
        code: "POWER_INFLATION",
        dimension: "reader_experience",
        qualityDimension: "continuity",
        severity: "P1",
        structural: false,
        evidence: [
          chapterEvidence(
            previous.chapter,
            previous.span.text,
            `第 ${previous.chapter.number} 章仍在“${previous.realm.name}”。`,
          ),
          chapterEvidence(
            current.chapter,
            current.span.text,
            `仅隔 ${current.chapter.number - previous.chapter.number} 章便跃至“${current.realm.name}”。`,
          ),
        ],
        sourceRefs: [
          {
            type: "chapter",
            id: current.chapter.id,
            versionId: current.chapter.versionId,
            label: `第 ${current.chapter.number} 章 ${current.chapter.title}`,
          },
        ],
        affectedObjects: [
          {
            type: "chapter",
            id: current.chapter.id,
            label: `第 ${current.chapter.number} 章 ${current.chapter.title}`,
          },
        ],
        recommendation: "拉开突破间隔，或补足越级所需的长期准备、资源与不可逆代价。",
        upstreamFindingId: null,
        chapterId: current.chapter.id,
        chapterVersionId: current.chapter.versionId,
        chapterNumber: current.chapter.number,
        dedupeKey: `POWER_INFLATION_RAPID:${previous.realm.id}:${current.realm.id}:${current.chapter.id}`,
      });
    }
  }
  return findings;
}

function evaluateStoryTimeOrder(
  input: VolumeAuditInput,
  chapters: VolumeAuditChapterInput[],
): VolumeAuditFindingCandidate[] {
  const events = [...input.timelineEvents].sort(
    (left, right) =>
      left.validFromChapter - right.validFromChapter ||
      left.storyTimeSortKey - right.storyTimeSortKey,
  );
  const findings: VolumeAuditFindingCandidate[] = [];
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (
      current.validFromChapter > previous.validFromChapter &&
      current.storyTimeSortKey < previous.storyTimeSortKey
    ) {
      const chapter =
        chapters.find((candidate) => candidate.number === current.validFromChapter) ?? chapters[0];
      if (!chapter) {
        continue;
      }
      const span = sentenceSpans(chapter.content).find((candidate) =>
        candidate.text.includes(current.eventText),
      );
      const chapterOpening = chapter.content.trim().slice(0, 80);
      const quote = span?.text ?? (chapterOpening || chapter.title);
      findings.push({
        code: "TIMELINE_CONFLICT",
        dimension: "continuity",
        qualityDimension: "continuity",
        severity: "P1",
        structural: true,
        evidence: [
          chapterEvidence(
            chapter,
            quote,
            `章节顺序在后，但故事时间“${current.locator}”早于前一事件“${previous.locator}”。`,
          ),
        ],
        sourceRefs: [
          {
            type: "timeline_event",
            id: current.id,
            versionId: null,
            label: current.locator,
          },
          {
            type: "timeline_event",
            id: previous.id,
            versionId: null,
            label: previous.locator,
          },
        ],
        affectedObjects: [
          {
            type: "chapter",
            id: chapter.id,
            label: `第 ${chapter.number} 章 ${chapter.title}`,
          },
          {
            type: "timeline_event",
            id: current.id,
            label: current.locator,
          },
        ],
        recommendation: "统一章节顺序与故事时间；若是有意倒叙，请标明回忆或视角时间。",
        upstreamFindingId: null,
        chapterId: chapter.id,
        chapterVersionId: chapter.versionId,
        chapterNumber: chapter.number,
        dedupeKey: `STORY_TIME_ORDER:${previous.id}:${current.id}`,
      });
    }
  }
  return findings;
}

function summarize(findings: VolumeAuditFindingCandidate[]): VolumeAuditSummary {
  return {
    total: findings.length,
    blockers: findings.filter((finding) => finding.severity === "P0" || finding.severity === "P1")
      .length,
    warnings: findings.filter((finding) => finding.severity === "P2" || finding.severity === "P3")
      .length,
    unresolvedLedger: findings.filter((finding) => finding.code === "UNRESOLVED_LEDGER_ENTRY")
      .length,
    motivation: findings.filter((finding) => finding.code === "MOTIVATION_BREAK").length,
    antagonist: findings.filter((finding) => finding.code === "ANTAGONIST_UNDERESTIMATION").length,
    powerInflation: findings.filter((finding) => finding.code === "POWER_INFLATION").length,
    mapTime: findings.filter(
      (finding) => finding.code === "TIMELINE_CONFLICT" || finding.code === "LOCATION_CONFLICT",
    ).length,
    knowledgeLeak: findings.filter((finding) => finding.code === "UNDISCLOSED_KNOWLEDGE").length,
    other: findings.filter(
      (finding) =>
        ![
          "UNRESOLVED_LEDGER_ENTRY",
          "MOTIVATION_BREAK",
          "ANTAGONIST_UNDERESTIMATION",
          "POWER_INFLATION",
          "TIMELINE_CONFLICT",
          "LOCATION_CONFLICT",
          "UNDISCLOSED_KNOWLEDGE",
        ].includes(finding.code),
    ).length,
  };
}

function evidenceChapterForLedger(
  entry: VolumeAuditLedgerEntryInput,
  chapters: VolumeAuditChapterInput[],
): VolumeAuditChapterInput {
  return (
    chapters.find(
      (chapter) =>
        chapter.content.includes(entry.title) ||
        (entry.summary.length > 0 && chapter.content.includes(entry.summary.slice(0, 8))),
    ) ??
    chapters.find((chapter) => chapter.number === entry.sourceChapterNumber) ??
    chapters[0]!
  );
}

function evidenceQuoteForLedger(
  entry: VolumeAuditLedgerEntryInput,
  chapter: VolumeAuditChapterInput,
): string {
  const span = sentenceSpans(chapter.content).find(
    (candidate) =>
      candidate.text.includes(entry.title) ||
      (entry.summary.length > 0 && candidate.text.includes(entry.summary.slice(0, 8))),
  );
  if (span) {
    return span.text;
  }
  const first = chapter.content.trim().split("\n")[0]?.trim();
  return first && first.length > 0
    ? first.slice(0, 200)
    : `第 ${chapter.number} 章 ${chapter.title}`;
}

function chapterEvidence(
  chapter: VolumeAuditChapterInput,
  quote: string,
  explanation: string,
): CriticEvidence {
  const content = chapter.content;
  const start = content.indexOf(quote);
  const startOffset = start >= 0 ? start : 0;
  const endOffset = start >= 0 ? start + quote.length : Math.max(1, quote.length);
  return {
    kind: "text",
    sourceId: chapter.id,
    sourceVersionId: chapter.versionId,
    chapterId: chapter.id,
    chapterVersionId: chapter.versionId,
    quote: quote.slice(0, 2_000),
    startOffset,
    endOffset,
    locator: locator(chapter, startOffset),
    explanation,
  };
}

function locator(chapter: VolumeAuditChapterInput, start: number): string {
  const paragraph = countMatches(chapter.content.slice(0, start), /\n\s*\n/gu) + 1;
  return `第 ${chapter.number} 章 · 第 ${paragraph} 段`;
}

function sentenceSpans(content: string): TextSpan[] {
  return Array.from(content.matchAll(/[^。！？!?；;\n]+[。！？!?；;]?/gu)).map((match) => ({
    text: match[0],
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function severityRank(severity: CriticSeverity): number {
  return Number(severity.slice(1));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}
