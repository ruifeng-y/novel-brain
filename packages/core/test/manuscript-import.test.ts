import { describe, expect, it } from "vitest";

import {
  createManuscriptScanState,
  isWellFormedUtf16,
  manuscriptChaptersFromScan,
  scanManuscriptChunk,
} from "../src/manuscript-import";

describe("incremental manuscript scanning", () => {
  it("preserves headings and source ranges across chunk boundaries", () => {
    const first = "前言\n第1章 开";
    const second = "端\n正文\n第2章 终局\n结束";
    const text = `${first}${second}`;
    const secondHeadingStart = text.indexOf("第2章");

    let state = createManuscriptScanState();
    state = scanManuscriptChunk(state, first, false);
    state = scanManuscriptChunk(state, second, true);

    const chapters = manuscriptChaptersFromScan(state, text.length, "全文");
    expect(chapters.chapters).toEqual([
      { title: "前言", sourceRange: { start: 0, end: 3 } },
      { title: "开端", sourceRange: { start: 3, end: secondHeadingStart } },
      { title: "终局", sourceRange: { start: secondHeadingStart, end: text.length } },
    ]);
    expect(chapters.warnings).toEqual([]);
  });

  it("falls back to one source-traceable chapter when no heading exists", () => {
    let state = createManuscriptScanState();
    state = scanManuscriptChunk(state, "只有正文，没有标题。", true);

    expect(manuscriptChaptersFromScan(state, state.offset, "旧稿")).toMatchObject({
      status: "partial",
      chapters: [
        {
          title: "旧稿",
          sourceRange: { start: 0, end: "只有正文，没有标题。".length },
        },
      ],
    });
  });

  it("bounds carried parser state for an adversarial line without newlines", () => {
    let state = createManuscriptScanState();
    state = scanManuscriptChunk(state, "x".repeat(500_000), false);

    expect(state.offset).toBe(500_000);
    expect(state.pendingLine).toBe("");
    expect(state.lineOverflow).toBe(true);
  });

  it("rejects unpaired UTF-16 before source storage", () => {
    expect(isWellFormedUtf16("\ud800")).toBe(false);
    expect(isWellFormedUtf16("旧稿😀")).toBe(true);
  });

  it("keeps a whitespace-only prefix in the first chapter instead of creating a preface", () => {
    let state = createManuscriptScanState();
    state = scanManuscriptChunk(state, "  \n第1章 开端\n正文", true);

    const chapters = manuscriptChaptersFromScan(state, state.offset, "全文");
    expect(chapters.chapters).toEqual([
      { title: "开端", sourceRange: { start: 0, end: state.offset } },
    ]);
  });
});
