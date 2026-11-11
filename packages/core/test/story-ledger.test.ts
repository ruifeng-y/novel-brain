import { describe, expect, it } from "vitest";

import {
  evaluateStoryLedger,
  nextStoryLedgerStatus,
  STORY_LEDGER_RULE_VERSION,
  type LedgerCheckEntry,
} from "../src";

function entry(overrides: Partial<LedgerCheckEntry> = {}): LedgerCheckEntry {
  return {
    id: "entry-1",
    kind: "foreshadow",
    title: "父母之死",
    summary: "沈砚以为父母是自杀。",
    status: "planted",
    sourceChapterNumber: 16,
    targetWindow: { fromChapter: 100, toChapter: 120 },
    prerequisiteEvents: [],
    history: [
      {
        action: "setup",
        chapterNumber: 16,
        eventId: null,
        reason: "在旧宅埋下。",
        evidence: [{ strength: "strong" }],
      },
    ],
    ...overrides,
  };
}

describe("story ledger checks", () => {
  it("flags an open entry whose target window has passed", () => {
    expect(
      evaluateStoryLedger({
        entries: [entry()],
        writtenThroughChapter: 120,
      }),
    ).toEqual([]);

    const findings = evaluateStoryLedger({
      entries: [entry()],
      writtenThroughChapter: 121,
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "LEDGER_OVERDUE",
        entryId: "entry-1",
        severity: "warning",
      }),
    ]);
  });

  it("flags a payoff that has no setup history", () => {
    const findings = evaluateStoryLedger({
      entries: [
        entry({
          status: "paid_off",
          history: [
            {
              action: "payoff",
              chapterNumber: 110,
              eventId: null,
              reason: "直接揭晓。",
              evidence: [{ strength: "strong" }],
            },
          ],
        }),
      ],
      writtenThroughChapter: 120,
    });

    expect(findings).toEqual([
      expect.objectContaining({
        code: "LEDGER_NO_CAUSAL_PAYOFF",
        entryId: "entry-1",
        severity: "blocker",
      }),
    ]);
  });

  it("flags duplicate open clues with the same normalized title", () => {
    const findings = evaluateStoryLedger({
      entries: [
        entry({ id: "entry-1", title: "父母 之死" }),
        entry({ id: "entry-2", title: "父母之死" }),
      ],
      writtenThroughChapter: 20,
    });

    expect(findings.filter((finding) => finding.code === "LEDGER_DUPLICATE")).toEqual([
      expect.objectContaining({ entryId: "entry-1", relatedEntryIds: ["entry-2"] }),
      expect.objectContaining({ entryId: "entry-2", relatedEntryIds: ["entry-1"] }),
    ]);
  });

  it("does not treat different ledger kinds with the same title as duplicates", () => {
    const findings = evaluateStoryLedger({
      entries: [
        entry({ id: "foreshadow", title: "天门将开", kind: "foreshadow" }),
        entry({ id: "thread", title: "天门将开", kind: "plot_thread" }),
      ],
      writtenThroughChapter: 20,
    });

    expect(findings.filter((finding) => finding.code === "LEDGER_DUPLICATE")).toEqual([]);
  });

  it("flags a payoff that lands before its setup or target window", () => {
    const findings = evaluateStoryLedger({
      entries: [
        entry({
          status: "paid_off",
          sourceChapterNumber: 30,
          history: [
            {
              action: "setup",
              chapterNumber: 16,
              eventId: null,
              reason: "在旧宅埋下。",
              evidence: [{ strength: "strong" }],
            },
            {
              action: "payoff",
              chapterNumber: 20,
              eventId: null,
              reason: "提前揭示。",
              evidence: [{ strength: "strong" }],
            },
          ],
        }),
      ],
      writtenThroughChapter: 40,
    });

    expect(findings).toEqual([
      expect.objectContaining({ code: "LEDGER_PREMATURE_PAYOFF", entryId: "entry-1" }),
    ]);
  });

  it("flags weak, unsupported and invalidated payoffs", () => {
    const findings = evaluateStoryLedger({
      entries: [
        entry({
          id: "weak",
          status: "paid_off",
          history: [
            {
              action: "setup",
              chapterNumber: 16,
              eventId: null,
              reason: "在旧宅埋下。",
              evidence: [{ strength: "strong" }],
            },
            {
              action: "payoff",
              chapterNumber: 110,
              eventId: null,
              reason: "一句话带过。",
              evidence: [{ strength: "weak" }],
            },
          ],
        }),
        entry({
          id: "unsupported",
          status: "paid_off",
          history: [
            {
              action: "setup",
              chapterNumber: 16,
              eventId: null,
              reason: "在旧宅埋下。",
              evidence: [{ strength: "strong" }],
            },
            {
              action: "payoff",
              chapterNumber: 110,
              eventId: null,
              reason: "没有留下证据。",
              evidence: [],
            },
          ],
        }),
        entry({
          id: "invalidated",
          status: "paid_off",
          targetWindow: { fromChapter: 10, toChapter: 40 },
          prerequisiteEvents: [
            {
              eventId: "event-1",
              chapterNumber: 30,
              validFromChapter: 30,
              validToChapter: 50,
            },
          ],
          history: [
            {
              action: "setup",
              chapterNumber: 10,
              eventId: null,
              reason: "先埋下。",
              evidence: [{ strength: "strong" }],
            },
            {
              action: "payoff",
              chapterNumber: 20,
              eventId: null,
              reason: "前置事件还没发生就回收。",
              evidence: [{ strength: "strong" }],
            },
          ],
        }),
      ],
      writtenThroughChapter: 130,
    });

    expect(findings.map((finding) => `${finding.entryId}:${finding.code}`).sort()).toEqual([
      "invalidated:LEDGER_INVALIDATED_PAYOFF",
      "unsupported:LEDGER_UNSUPPORTED_PAYOFF",
      "weak:LEDGER_WEAK_PAYOFF",
    ]);
  });

  it("returns no findings for a supported payoff with valid prerequisites", () => {
    const findings = evaluateStoryLedger({
      entries: [
        entry({
          status: "paid_off",
          targetWindow: { fromChapter: 100, toChapter: 120 },
          prerequisiteEvents: [
            {
              eventId: "event-1",
              chapterNumber: 90,
              validFromChapter: 90,
              validToChapter: 130,
            },
          ],
          history: [
            {
              action: "setup",
              chapterNumber: 16,
              eventId: null,
              reason: "埋下。",
              evidence: [{ strength: "strong" }],
            },
            {
              action: "payoff",
              chapterNumber: 112,
              eventId: "event-1",
              reason: "在宗门大殿揭晓。",
              evidence: [{ strength: "strong" }],
            },
          ],
        }),
      ],
      writtenThroughChapter: 130,
    });

    expect(findings).toEqual([]);
    expect(STORY_LEDGER_RULE_VERSION).toBe("story-ledger-checks-v1");
  });

  it.each([
    ["planned", "setup", "planted"],
    ["planned", "abandon", "abandoned"],
    ["planted", "progress", "progressed"],
    ["progressed", "progress", "progressed"],
    ["deferred", "progress", "progressed"],
    ["planted", "payoff", "paid_off"],
    ["progressed", "fail_payoff", "failed_payoff"],
    ["planned", "defer", "deferred"],
  ] as const)("maps %s + %s to %s", (current, action, expected) => {
    expect(nextStoryLedgerStatus(current, action)).toBe(expected);
  });

  it.each([
    ["planned", "progress"],
    ["planned", "payoff"],
    ["paid_off", "defer"],
    ["failed_payoff", "setup"],
    ["abandoned", "progress"],
  ] as const)("rejects %s + %s", (current, action) => {
    expect(() => nextStoryLedgerStatus(current, action)).toThrow();
  });
});
