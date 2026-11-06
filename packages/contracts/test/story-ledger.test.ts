import { describe, expect, it } from "vitest";

import {
  storyLedgerEntryCreateRequestSchema,
  storyLedgerFindingSchema,
  storyLedgerLifecycleRequestSchema,
  storyLedgerWorkspaceSchema,
} from "../src";

const window = { fromChapter: 100, toChapter: 120 };

describe("story ledger contracts", () => {
  it("accepts typed plot threads, foreshadows and character arcs", () => {
    expect(
      storyLedgerEntryCreateRequestSchema.parse({
        kind: "plot_thread",
        title: "天门将开",
        summary: "天门开启与主角身世互相牵引。",
        responsibleRole: "protagonist",
        targetWindow: window,
        threadType: "main",
        stakes: "错过天门开启，南境将失去庇护。",
        tension: 80,
      }),
    ).toMatchObject({ kind: "plot_thread", status: "planned" });

    expect(
      storyLedgerEntryCreateRequestSchema.parse({
        kind: "foreshadow",
        title: "父母之死",
        summary: "沈砚以为父母是自杀。",
        responsibleRole: "protagonist",
        targetWindow: window,
        importance: "must",
        readerPromise: "身世谜团",
      }),
    ).toMatchObject({ kind: "foreshadow", importance: "must" });

    expect(
      storyLedgerEntryCreateRequestSchema.parse({
        kind: "character_arc",
        title: "沈砚从证明自己到守护他人",
        summary: "弧光跨越前三卷。",
        responsibleRole: "protagonist",
        targetWindow: window,
        characterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1fff",
        startState: "只想证明自己不是废物。",
        desire: "被宗门认可。",
        fear: "再次被抛弃。",
        lie: "只有变强才值得被留下。",
        truth: "守护他人才能得到真正的归属。",
        endState: "主动承担代价。",
      }),
    ).toMatchObject({ kind: "character_arc" });
  });

  it("rejects an inverted target window and untyped extra fields", () => {
    expect(() =>
      storyLedgerEntryCreateRequestSchema.parse({
        kind: "foreshadow",
        title: "错误窗口",
        summary: "目标窗口倒置。",
        responsibleRole: "author",
        targetWindow: { fromChapter: 120, toChapter: 100 },
        importance: "optional",
        readerPromise: "长线伏笔",
      }),
    ).toThrow();
    expect(() =>
      storyLedgerEntryCreateRequestSchema.parse({
        kind: "foreshadow",
        title: "多余字段",
        summary: "不应通过。",
        responsibleRole: "author",
        targetWindow: window,
        importance: "optional",
        readerPromise: "长线伏笔",
        unknownField: true,
      }),
    ).toThrow();
  });

  it("requires source, reason and evidence for payoff and abandonment transitions", () => {
    expect(() =>
      storyLedgerLifecycleRequestSchema.parse({
        version: 1,
        action: "payoff",
        reason: "揭晓真相。",
        evidence: [],
      }),
    ).toThrow();
    expect(() =>
      storyLedgerLifecycleRequestSchema.parse({
        version: 1,
        action: "abandon",
        reason: "",
        chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1fff",
      }),
    ).toThrow();
    expect(
      storyLedgerLifecycleRequestSchema.parse({
        version: 1,
        action: "payoff",
        chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1fff",
        reason: "揭晓真相。",
        evidence: [
          {
            kind: "chapter",
            label: "第 112 章",
            quote: "沈砚终于知道父母死于仇杀。",
            strength: "strong",
          },
        ],
      }),
    ).toMatchObject({ action: "payoff" });
  });

  it("requires a new target window when deferring an entry", () => {
    expect(() =>
      storyLedgerLifecycleRequestSchema.parse({
        version: 1,
        action: "defer",
        reason: "本卷节奏太紧。",
      }),
    ).toThrow();
    expect(
      storyLedgerLifecycleRequestSchema.parse({
        version: 1,
        action: "defer",
        reason: "本卷节奏太紧。",
        targetWindow: { fromChapter: 130, toChapter: 150 },
      }),
    ).toMatchObject({
      action: "defer",
      targetWindow: { fromChapter: 130, toChapter: 150 },
    });
  });

  it("accepts the no-causal-payoff finding", () => {
    expect(
      storyLedgerFindingSchema.parse({
        code: "LEDGER_NO_CAUSAL_PAYOFF",
        severity: "blocker",
        entryId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1fff",
        relatedEntryIds: [],
        message: "回收没有埋设依据。",
        remediation: "补上埋设与因果链。",
      }),
    ).toMatchObject({ code: "LEDGER_NO_CAUSAL_PAYOFF" });
  });

  it("parses a workspace with entries and findings", () => {
    expect(
      storyLedgerWorkspaceSchema.parse({
        ruleVersion: "story-ledger-checks-v1",
        workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1fff",
        branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ffe",
        writtenThroughChapter: 48,
        entries: [],
        findings: [],
        summary: {
          total: 0,
          open: 0,
          overdue: 0,
          mustPayoff: 0,
          paidOff: 0,
          abandoned: 0,
          weakPayoff: 0,
        },
      }),
    ).toMatchObject({ writtenThroughChapter: 48, entries: [] });
  });
});
