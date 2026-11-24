import { MAX_MANUSCRIPT_CHAPTERS } from "@novel-brain/contracts";
import type {
  ManuscriptImportStatus,
  ManuscriptImportWarning,
  ManuscriptScanHeading,
  ManuscriptScanState,
  ManuscriptSourceRange,
} from "@novel-brain/contracts";

export interface ManuscriptScanOptions {
  headingStarts?: readonly number[];
}

export interface ScannedManuscriptChapter {
  title: string;
  sourceRange: ManuscriptSourceRange;
}

export interface ScannedManuscript {
  status: ManuscriptImportStatus;
  chapters: ScannedManuscriptChapter[];
  warnings: ManuscriptImportWarning[];
}

const MAX_HEADING_LINE_CHARACTERS = 4_096;
const MAX_SCAN_HEADINGS = MAX_MANUSCRIPT_CHAPTERS + 1;
export const IMPORT_RECOVERY_SYSTEM_ROLE = "import_recovery";
const MARKDOWN_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;
const TEXT_HEADING =
  /^[ \t]*(第[一二三四五六七八九十百千万零〇两\d]+章)(?:[ \t:：、.-]+(.*))?[ \t]*$/u;

export class ManuscriptHeadingLimitError extends Error {
  constructor() {
    super(`旧稿章节数量超过 V1 导入上限（${MAX_MANUSCRIPT_CHAPTERS} 章）`);
    this.name = "ManuscriptHeadingLimitError";
  }
}

export function createManuscriptScanState(): ManuscriptScanState {
  return {
    schemaVersion: 1,
    offset: 0,
    lineStart: 0,
    pendingLine: "",
    lineOverflow: false,
    prefixHasText: false,
    headings: [],
    hasText: false,
  };
}

export function isWellFormedUtf16(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const current = value.charCodeAt(index);
    if (current >= 0xd800 && current <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (current >= 0xdc00 && current <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export function scanManuscriptChunk(
  state: ManuscriptScanState,
  chunk: string,
  final: boolean,
  options: ManuscriptScanOptions = {},
): ManuscriptScanState {
  const styledStarts = new Set(options.headingStarts ?? []);
  const headings = [...state.headings];
  let lineSample = state.pendingLine;
  let lineOverflow = state.lineOverflow;
  let lineStart = state.lineStart;
  let position = state.offset;
  let prefixHasText = state.prefixHasText;

  for (let index = 0; index < chunk.length; index += 1) {
    const character = chunk[index]!;
    if (character === "\n") {
      const headingCountBefore = headings.length;
      consumeLine(lineSample, lineOverflow, lineStart, styledStarts, headings);
      if (
        headingCountBefore === 0 &&
        headings.length === 0 &&
        (lineOverflow || lineSample.trim().length > 0)
      ) {
        prefixHasText = true;
      }
      lineSample = "";
      lineOverflow = false;
      position += 1;
      lineStart = position;
      continue;
    }
    if (!lineOverflow) {
      if (lineSample.length < MAX_HEADING_LINE_CHARACTERS) {
        lineSample += character;
      } else {
        lineSample = "";
        lineOverflow = true;
      }
    }
    position += 1;
  }

  if (final) {
    consumeLine(lineSample, lineOverflow, lineStart, styledStarts, headings);
    lineSample = "";
    lineOverflow = false;
    lineStart = position;
  }

  return {
    schemaVersion: 1,
    offset: position,
    lineStart,
    pendingLine: lineSample,
    lineOverflow,
    prefixHasText,
    headings,
    hasText: state.hasText || /\S/u.test(chunk),
  };
}

export function manuscriptChaptersFromScan(
  state: ManuscriptScanState,
  totalCharacters: number,
  fallbackTitle = "全文",
): ScannedManuscript {
  if (!state.hasText) {
    return { status: "empty", chapters: [], warnings: [] };
  }

  const headings = [...state.headings].sort((left, right) => left.start - right.start);
  if (headings.length === 0) {
    return {
      status: "partial",
      chapters: [
        {
          title: fallbackTitle,
          sourceRange: { start: 0, end: totalCharacters },
        },
      ],
      warnings: [
        {
          sourceExcerpt: "未识别到章节标题",
          reason: "未识别到章节标题，已将全文保留为一章",
        },
      ],
    };
  }

  const chapters: ScannedManuscriptChapter[] = [];
  const warnings = headings.flatMap((heading) => (heading.warning ? [heading.warning] : []));
  const firstHeadingStart = headings[0]?.start ?? 0;
  const includePrefix = firstHeadingStart > 0 && state.prefixHasText;
  if (includePrefix) {
    chapters.push({
      title: "前言",
      sourceRange: { start: 0, end: firstHeadingStart },
    });
  }

  for (const [index, heading] of headings.entries()) {
    const nextStart = headings[index + 1]?.start ?? totalCharacters;
    chapters.push({
      title: heading.title,
      sourceRange: {
        start: index === 0 && !includePrefix ? 0 : heading.start,
        end: nextStart,
      },
    });
  }

  return {
    status: warnings.length > 0 ? "partial" : "ready",
    chapters,
    warnings,
  };
}

function consumeLine(
  rawLine: string,
  lineOverflow: boolean,
  lineStart: number,
  styledStarts: Set<number>,
  headings: ManuscriptScanHeading[],
): void {
  if (lineOverflow) {
    return;
  }
  const normalizedLine = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  const markdownMatch = MARKDOWN_HEADING.exec(normalizedLine);
  const textMatch = TEXT_HEADING.exec(normalizedLine);
  const styledHeading = styledStarts.has(lineStart) && normalizedLine.trim().length > 0;
  if (!markdownMatch && !textMatch && !styledHeading) {
    return;
  }
  if (headings.length >= MAX_SCAN_HEADINGS) {
    throw new ManuscriptHeadingLimitError();
  }
  const title = (markdownMatch?.[2] ?? textMatch?.[2] ?? textMatch?.[1] ?? normalizedLine).trim();
  headings.push({
    start: lineStart,
    title: (normalizeChapterTitle(title) || textMatch?.[1]?.trim() || "未命名章节").slice(0, 200),
    ...(textMatch && !textMatch[2]?.trim()
      ? {
          warning: {
            sourceExcerpt: normalizedLine.trim(),
            reason: "章节标题为空，已使用章节序号作为标题并保留原文",
          },
        }
      : {}),
  });
}

function normalizeChapterTitle(title: string): string {
  return title.replace(/^第[一二三四五六七八九十百千万零〇两\d]+章[ \t:：、.-]*/u, "").trim();
}
