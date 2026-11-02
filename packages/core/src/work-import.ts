import JSZip from 'jszip';

export type ManuscriptFormat = 'txt' | 'markdown' | 'docx';

export type ManuscriptChapter = {
  title: string;
  content: string;
};

export type ParsedManuscript = {
  format: ManuscriptFormat;
  chapters: ManuscriptChapter[];
};

export type ManuscriptSource = {
  fileName: string;
  format?: ManuscriptFormat;
  content?: string;
  contentBase64?: string;
};

export class ManuscriptImportError extends Error {
  constructor(
    readonly code:
      | 'UNSUPPORTED_MANUSCRIPT_FORMAT'
      | 'MANUSCRIPT_CONTENT_REQUIRED'
      | 'MANUSCRIPT_EMPTY'
      | 'DOCX_CONTENT_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'ManuscriptImportError';
  }
}

const CHAPTER_HEADING_PATTERN =
  /^(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回卷]|楔子|序章|序言|前言|尾声|后记|番外(?:[零〇一二三四五六七八九十百千万两\d]+)?|Chapter\s+\d+)/i;
const MARKDOWN_HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function detectManuscriptFormat(
  fileName: string,
  explicitFormat?: ManuscriptFormat,
): ManuscriptFormat {
  if (explicitFormat) {
    return explicitFormat;
  }
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  if (extension === 'md' || extension === 'markdown') {
    return 'markdown';
  }
  if (extension === 'txt') {
    return 'txt';
  }
  if (extension === 'docx') {
    return 'docx';
  }
  throw new ManuscriptImportError(
    'UNSUPPORTED_MANUSCRIPT_FORMAT',
    'Only TXT, Markdown, and DOCX manuscripts can be imported',
  );
}

export async function parseManuscript(source: ManuscriptSource): Promise<ParsedManuscript> {
  const format = detectManuscriptFormat(source.fileName, source.format);
  const fallbackTitle = source.fileName.replace(/\.[^.]+$/, '').trim() || '导入旧稿';
  let text: string;

  if (format === 'docx') {
    if (!source.contentBase64) {
      throw new ManuscriptImportError(
        'MANUSCRIPT_CONTENT_REQUIRED',
        'Provide the DOCX manuscript content',
      );
    }
    text = await extractDocxText(source.contentBase64);
  } else {
    text =
      source.content ??
      (source.contentBase64
        ? Buffer.from(source.contentBase64, 'base64').toString('utf8')
        : undefined) ??
      '';
  }

  const chapters = splitManuscriptText(text, fallbackTitle);
  if (chapters.length === 0) {
    throw new ManuscriptImportError('MANUSCRIPT_EMPTY', 'The manuscript has no readable text');
  }
  return { format, chapters };
}

export function splitManuscriptText(text: string, fallbackTitle = '导入章节'): ManuscriptChapter[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chunks: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;
  let titleFallback = fallbackTitle;

  for (const line of lines) {
    const markdownHeading = line.match(MARKDOWN_HEADING_PATTERN);
    const headingText = markdownHeading?.[2]?.trim() ?? line.trim();
    const headingLevel = markdownHeading?.[1].length ?? 0;
    const isChapterHeading =
      CHAPTER_HEADING_PATTERN.test(headingText) || (markdownHeading !== null && headingLevel >= 2);

    if (isChapterHeading) {
      if (current && hasMeaningfulContent(current.lines)) {
        chunks.push(current);
      }
      current = {
        title: cleanChapterTitle(headingText),
        lines: [],
      };
      continue;
    }

    if (markdownHeading && headingLevel === 1 && chunks.length === 0 && !current) {
      titleFallback = headingText || titleFallback;
      continue;
    }

    if (!current) {
      current = {
        title: chunks.length === 0 ? titleFallback : `续篇 ${chunks.length + 1}`,
        lines: [],
      };
    }
    current.lines.push(line);
  }

  if (current && hasMeaningfulContent(current.lines)) {
    chunks.push(current);
  }

  return chunks
    .map((chunk, index) => ({
      title: cleanChapterTitle(chunk.title) || `第 ${index + 1} 章`,
      content: trimOuterBlankLines(chunk.lines.join('\n')),
    }))
    .filter((chapter) => chapter.content.trim().length > 0);
}

export async function extractDocxText(contentBase64: string): Promise<string> {
  try {
    const archive = await JSZip.loadAsync(Buffer.from(contentBase64, 'base64'));
    const documentFile =
      archive.file('word/document.xml') ?? archive.file('word/document2.xml') ?? null;
    if (!documentFile) {
      throw new Error('Missing word/document.xml');
    }
    const xml = await documentFile.async('string');
    return extractDocxTextFromXml(xml);
  } catch (error) {
    if (error instanceof ManuscriptImportError) {
      throw error;
    }
    throw new ManuscriptImportError(
      'DOCX_CONTENT_INVALID',
      'The DOCX manuscript could not be read',
    );
  }
}

export function extractDocxTextFromXml(xml: string): string {
  const paragraphs = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs
    .map((paragraph) => {
      const headingMatch =
        paragraph.match(/<w:pStyle[^>]*w:val="(?:Heading|heading|标题)\s*([1-6])"/) ??
        paragraph.match(/<w:pStyle[^>]*w:val="([1-6])"/);
      const headingLevel = headingMatch ? Number(headingMatch[1]) : 0;
      const text = paragraph
        .replace(/<w:tab\s*\/>/g, '\t')
        .replace(/<w:(?:br|cr)\s*\/>/g, '\n')
        .replace(/<[^>]+>/g, '');
      const decoded = decodeXmlEntities(text).trim();
      return headingLevel > 0 && decoded ? `${'#'.repeat(headingLevel)} ${decoded}` : decoded;
    })
    .join('\n')
    .trim();
}

export function qualityScoreFromDimensions(
  dimensions: Array<{ status?: string }> | null | undefined,
): number | null {
  if (!dimensions || dimensions.length === 0) {
    return null;
  }
  const scoreByStatus: Record<string, number> = {
    good: 100,
    watch: 70,
    weak: 40,
  };
  const weighted = dimensions
    .map((dimension) => scoreByStatus[dimension.status ?? ''])
    .filter((score): score is number => score !== undefined);
  if (weighted.length === 0) {
    return null;
  }
  return Math.round(weighted.reduce((total, score) => total + score, 0) / weighted.length);
}

function hasMeaningfulContent(lines: string[]): boolean {
  return lines.some((line) => line.trim().length > 0);
}

function cleanChapterTitle(title: string): string {
  return title.replace(/^#+\s*/, '').trim();
}

function trimOuterBlankLines(value: string): string {
  return value.replace(/^(?:[ \t]*\n)+/, '').replace(/\n+$/, '');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}
