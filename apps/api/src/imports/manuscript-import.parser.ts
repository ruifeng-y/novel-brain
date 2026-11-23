import type { ManuscriptImportStatus, ManuscriptImportWarning } from "@novel-brain/contracts";

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

export interface ManuscriptSourceRange {
  start: number;
  end: number;
}

export interface ManuscriptParseOptions {
  headingStarts?: readonly number[];
}

interface ChapterHeading {
  start: number;
  title: string;
  warning?: ManuscriptImportWarning;
}

const MARKDOWN_HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/u;
const TEXT_HEADING =
  /^[ \t]*(第[一二三四五六七八九十百千万零〇两\d]+章)(?:[ \t:：、.-]+(.*))?[ \t]*$/u;

export function parseManuscriptText(
  text: string,
  fallbackTitle = "全文",
  options: ManuscriptParseOptions = {},
): ParsedManuscript {
  if (!text.trim()) {
    return { status: "empty", chapters: [], warnings: [] };
  }

  const headings = findChapterHeadings(text, options.headingStarts ?? []);
  if (headings.length === 0) {
    return {
      status: "partial",
      chapters: [
        {
          title: fallbackTitle,
          content: text,
          wordCount: countWords(text),
          sourceRange: { start: 0, end: text.length },
        },
      ],
      warnings: [
        {
          sourceExcerpt: firstNonEmptyLine(text),
          reason: "未识别到章节标题，已将全文保留为一章",
        },
      ],
    };
  }

  const chapters: ParsedManuscriptChapter[] = [];
  const warnings = headings.flatMap((heading) => (heading.warning ? [heading.warning] : []));
  const prefix = text.slice(0, headings[0]?.start ?? 0);
  if (prefix.trim()) {
    chapters.push({
      title: "前言",
      content: prefix,
      wordCount: countWords(prefix),
      sourceRange: { start: 0, end: prefix.length },
    });
  }

  headings.forEach((heading, index) => {
    const nextStart = headings[index + 1]?.start ?? text.length;
    const contentStart = index === 0 && !prefix.trim() ? 0 : heading.start;
    const content = text.slice(contentStart, nextStart);
    chapters.push({
      title: heading.title,
      content,
      wordCount: countWords(content),
      sourceRange: { start: contentStart, end: nextStart },
    });
  });

  return {
    status: warnings.length > 0 ? "partial" : "ready",
    chapters,
    warnings,
  };
}

export function countWords(text: string): number {
  return Array.from(text.replace(/\s/gu, "")).length;
}

function findChapterHeadings(
  text: string,
  styledHeadingStarts: readonly number[],
): ChapterHeading[] {
  const headings: ChapterHeading[] = [];
  const styledStarts = new Set(styledHeadingStarts);
  let offset = 0;
  for (const line of text.split(/\n/)) {
    const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
    const markdownMatch = MARKDOWN_HEADING.exec(normalizedLine);
    const textMatch = TEXT_HEADING.exec(normalizedLine);
    const styledHeading = styledStarts.has(offset) && normalizedLine.trim().length > 0;
    if (markdownMatch || textMatch || styledHeading) {
      const title = (
        markdownMatch?.[2] ??
        textMatch?.[2] ??
        textMatch?.[1] ??
        normalizedLine
      ).trim();
      const warning =
        textMatch && !textMatch[2]?.trim()
          ? {
              sourceExcerpt: normalizedLine.trim(),
              reason: "章节标题为空，已使用章节序号作为标题并保留原文",
            }
          : undefined;
      headings.push({
        start: offset,
        title: normalizeChapterTitle(title) || textMatch?.[1]?.trim() || "未命名章节",
        ...(warning ? { warning } : {}),
      });
    }
    offset += line.length + 1;
  }
  return headings;
}

function normalizeChapterTitle(title: string): string {
  return title.replace(/^第[一二三四五六七八九十百千万零〇两\d]+章[ \t:：、.-]*/u, "").trim();
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim() ?? "空内容"
  );
}
