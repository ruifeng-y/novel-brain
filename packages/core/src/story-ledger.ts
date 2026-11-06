export const STORY_LEDGER_RULE_VERSION = "story-ledger-checks-v1" as const;

export type StoryLedgerKind = "plot_thread" | "foreshadow" | "character_arc";

export type StoryLedgerStatus =
  "planned" | "planted" | "progressed" | "paid_off" | "failed_payoff" | "abandoned" | "deferred";

export type StoryLedgerLifecycleAction =
  "setup" | "progress" | "payoff" | "fail_payoff" | "abandon" | "defer";

export interface LedgerCheckEvidence {
  strength: "weak" | "strong";
}

export interface LedgerCheckTransition {
  action: StoryLedgerLifecycleAction;
  chapterNumber: number | null;
  eventId: string | null;
  reason: string;
  evidence: LedgerCheckEvidence[];
}

export interface LedgerCheckEvent {
  eventId: string;
  chapterNumber: number | null;
  validFromChapter: number | null;
  validToChapter: number | null;
}

export interface LedgerCheckEntry {
  id: string;
  kind: StoryLedgerKind;
  title: string;
  summary: string;
  status: StoryLedgerStatus;
  sourceChapterNumber: number | null;
  targetWindow: {
    fromChapter: number;
    toChapter: number;
  };
  prerequisiteEvents: LedgerCheckEvent[];
  history: LedgerCheckTransition[];
}

export type StoryLedgerFindingCode =
  | "LEDGER_OVERDUE"
  | "LEDGER_DUPLICATE"
  | "LEDGER_PREMATURE_PAYOFF"
  | "LEDGER_WEAK_PAYOFF"
  | "LEDGER_UNSUPPORTED_PAYOFF"
  | "LEDGER_INVALIDATED_PAYOFF"
  | "LEDGER_NO_CAUSAL_PAYOFF";

export interface StoryLedgerFinding {
  code: StoryLedgerFindingCode;
  severity: "warning" | "blocker";
  entryId: string;
  relatedEntryIds: string[];
  message: string;
  remediation: string;
}

export interface StoryLedgerCheckInput {
  entries: LedgerCheckEntry[];
  writtenThroughChapter: number;
}

const TERMINAL_STATUSES = new Set<StoryLedgerStatus>(["paid_off", "failed_payoff", "abandoned"]);

const TRANSITIONS: Record<
  StoryLedgerStatus,
  Partial<Record<StoryLedgerLifecycleAction, StoryLedgerStatus>>
> = {
  planned: {
    setup: "planted",
    abandon: "abandoned",
    defer: "deferred",
  },
  planted: {
    progress: "progressed",
    payoff: "paid_off",
    fail_payoff: "failed_payoff",
    abandon: "abandoned",
    defer: "deferred",
  },
  progressed: {
    progress: "progressed",
    payoff: "paid_off",
    fail_payoff: "failed_payoff",
    abandon: "abandoned",
    defer: "deferred",
  },
  deferred: {
    setup: "planted",
    progress: "progressed",
    payoff: "paid_off",
    fail_payoff: "failed_payoff",
    abandon: "abandoned",
    defer: "deferred",
  },
  paid_off: {},
  failed_payoff: {},
  abandoned: {},
};

export function nextStoryLedgerStatus(
  current: StoryLedgerStatus,
  action: StoryLedgerLifecycleAction,
): StoryLedgerStatus {
  const next = TRANSITIONS[current][action];
  if (!next) {
    throw new Error(`Ledger transition ${current} -> ${action} is not allowed`);
  }
  return next;
}

export function evaluateStoryLedger(input: StoryLedgerCheckInput): StoryLedgerFinding[] {
  const findings: StoryLedgerFinding[] = [];
  const open = input.entries.filter((entry) => !TERMINAL_STATUSES.has(entry.status));

  for (const entry of open) {
    if (entry.targetWindow.toChapter < input.writtenThroughChapter) {
      findings.push({
        code: "LEDGER_OVERDUE",
        severity: "warning",
        entryId: entry.id,
        relatedEntryIds: [],
        message: `“${entry.title}”计划在第 ${entry.targetWindow.toChapter} 章前回收，但写作进度已经越过目标窗口。`,
        remediation: "安排回收或延期，并补上新的目标章节。",
      });
    }
  }

  const byTitle = new Map<string, LedgerCheckEntry[]>();
  for (const entry of open) {
    const key = `${entry.kind}:${normalizeTitle(entry.title)}`;
    const group = byTitle.get(key) ?? [];
    group.push(entry);
    byTitle.set(key, group);
  }
  for (const group of byTitle.values()) {
    if (group.length < 2) {
      continue;
    }
    for (const entry of group) {
      const related = group.filter((candidate) => candidate.id !== entry.id);
      findings.push({
        code: "LEDGER_DUPLICATE",
        severity: "warning",
        entryId: entry.id,
        relatedEntryIds: related.map((candidate) => candidate.id),
        message: `“${entry.title}”与${related.map((candidate) => `“${candidate.title}”`).join("、")}指向同一条线索。`,
        remediation: "合并重复线索，或改写名称和线索内容以区分。",
      });
    }
  }

  for (const entry of input.entries) {
    if (entry.status !== "paid_off") {
      continue;
    }
    findings.push(...evaluatePayoff(entry));
  }

  return findings.sort(
    (left, right) =>
      left.entryId.localeCompare(right.entryId) || left.code.localeCompare(right.code),
  );
}

function evaluatePayoff(entry: LedgerCheckEntry): StoryLedgerFinding[] {
  const findings: StoryLedgerFinding[] = [];
  const payoff = [...entry.history].reverse().find((item) => item.action === "payoff");
  if (!payoff) {
    return [
      {
        code: "LEDGER_UNSUPPORTED_PAYOFF",
        severity: "blocker",
        entryId: entry.id,
        relatedEntryIds: [],
        message: `“${entry.title}”显示已回收，但没有留下回收记录。`,
        remediation: "补记回收章节、原因和证据。",
      },
    ];
  }

  const setupIndex = entry.history.findLastIndex((item) => item.action === "setup");
  const payoffIndex = entry.history.findLastIndex((item) => item.action === "payoff");
  if (setupIndex < 0 || setupIndex > payoffIndex) {
    findings.push({
      code: "LEDGER_NO_CAUSAL_PAYOFF",
      severity: "blocker",
      entryId: entry.id,
      relatedEntryIds: [],
      message: `“${entry.title}”没有可追溯的埋设记录，回收缺少因果依据。`,
      remediation: "补记埋设章节或事件，或把这条记录改为新的埋设。",
    });
  }

  const hasSource = payoff.chapterNumber !== null || payoff.eventId !== null;
  if (!hasSource || payoff.evidence.length === 0) {
    findings.push({
      code: "LEDGER_UNSUPPORTED_PAYOFF",
      severity: "blocker",
      entryId: entry.id,
      relatedEntryIds: [],
      message: `“${entry.title}”的回收缺少来源或证据。`,
      remediation: "补上回收所在章节或事件，并记录能证明兑现的证据。",
    });
  }

  if (payoff.evidence.length > 0 && !payoff.evidence.some((item) => item.strength === "strong")) {
    findings.push({
      code: "LEDGER_WEAK_PAYOFF",
      severity: "warning",
      entryId: entry.id,
      relatedEntryIds: [],
      message: `“${entry.title}”的回收证据偏弱，读者可能感受不到兑现。`,
      remediation: "让回收改变人物选择、关系或世界认知，并补充对应证据。",
    });
  }

  if (payoff.chapterNumber !== null) {
    const tooEarly =
      (entry.sourceChapterNumber !== null && payoff.chapterNumber < entry.sourceChapterNumber) ||
      payoff.chapterNumber < entry.targetWindow.fromChapter;
    if (tooEarly) {
      findings.push({
        code: "LEDGER_PREMATURE_PAYOFF",
        severity: "blocker",
        entryId: entry.id,
        relatedEntryIds: [],
        message: `“${entry.title}”在第 ${payoff.chapterNumber} 章回收，早于埋设或目标窗口。`,
        remediation: "把回收移到埋设之后，或调整目标窗口并重排相关章节。",
      });
    }
  }

  const invalidated = entry.prerequisiteEvents.some((event) => {
    if (payoff.chapterNumber === null) {
      return event.chapterNumber !== null || event.validFromChapter !== null;
    }
    if (event.chapterNumber !== null && payoff.chapterNumber < event.chapterNumber) {
      return true;
    }
    if (event.validFromChapter !== null && payoff.chapterNumber < event.validFromChapter) {
      return true;
    }
    return event.validToChapter !== null && payoff.chapterNumber > event.validToChapter;
  });
  if (invalidated) {
    findings.push({
      code: "LEDGER_INVALIDATED_PAYOFF",
      severity: "blocker",
      entryId: entry.id,
      relatedEntryIds: [],
      message: `“${entry.title}”回收时，前置事件还没有发生或已经失效。`,
      remediation: "调整回收章节，或更换仍然有效的前置事件。",
    });
  }

  return findings;
}

function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, "");
}
