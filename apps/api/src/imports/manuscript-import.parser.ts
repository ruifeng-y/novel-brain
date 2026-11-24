import type {
  ManuscriptImportStatus,
  ManuscriptImportWarning,
  ManuscriptSourceRange,
} from "@novel-brain/contracts";
import {
  createManuscriptScanState,
  manuscriptChaptersFromScan,
  scanManuscriptChunk,
} from "@novel-brain/core";

export interface ParsedManuscriptChapter {
  title: string;
  content: string;
  wordCount: number;
  sourceRange: ManuscriptSourceRange;
}

export interface ParsedManuscript {
  status: ManuscriptImportStatus;
  chapters: ParsedManuscriptChapter[];
  warnings: ManuscriptImportWarning[];
}

export interface ManuscriptParseOptions {
  headingStarts?: readonly number[];
}

export function parseManuscriptText(
  text: string,
  fallbackTitle = "全文",
  options: ManuscriptParseOptions = {},
): ParsedManuscript {
  const scanned = manuscriptChaptersFromScan(
    scanManuscriptChunk(createManuscriptScanState(), text, true, {
      headingStarts: options.headingStarts ?? [],
    }),
    text.length,
    fallbackTitle,
  );
  const warnings = scanned.warnings.map((warning) =>
    warning.reason === "未识别到章节标题，已将全文保留为一章"
      ? { ...warning, sourceExcerpt: firstNonEmptyLine(text) }
      : warning,
  );
  return {
    status: scanned.status,
    chapters: scanned.chapters.map((chapter) => {
      const content = text.slice(chapter.sourceRange.start, chapter.sourceRange.end);
      return {
        title: chapter.title,
        content,
        wordCount: countWords(content),
        sourceRange: chapter.sourceRange,
      };
    }),
    warnings,
  };
}

export function countWords(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "空内容"
  );
}
