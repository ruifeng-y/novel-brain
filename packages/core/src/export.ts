export type ExportFormat = 'txt' | 'markdown' | 'docx' | 'epub';
export type ExportPreset = 'generic' | 'qidian' | 'fanqie';

export type ExportScope =
  | { type: 'chapter'; chapterNumber: number }
  | { type: 'chapters'; chapterNumbers: number[] }
  | { type: 'range'; startChapter: number; endChapter: number }
  | { type: 'volume'; volumeId: string }
  | { type: 'book' };

export type ExportOutlineNode = {
  id: string;
  parentId: string | null;
  level: 'book' | 'volume' | 'act' | 'chapter' | 'scene';
  chapterNumber: number | null;
  title: string;
};

export type ExportSourceChapter = {
  chapterNumber: number;
  title: string;
  content: string;
};

export type ExportChapter = ExportSourceChapter & {
  volumeId: string | null;
  volumeTitle: string;
};

export type ExportStyle = {
  chapterTitlePattern: string;
  volumeTitlePattern: string;
  paragraphSpacing: 0 | 1 | 2;
  firstLineIndent: boolean;
  encoding: 'utf-8';
};

export type ExportFileInput = {
  title: string;
  chapters: ExportChapter[];
  format: ExportFormat;
  preset: ExportPreset;
  chapterTitlePattern?: string;
  volumeTitlePattern?: string;
  paragraphSpacing?: 0 | 1 | 2;
  firstLineIndent?: boolean;
};

export type RenderedExportFile = {
  data: Buffer;
  extension: string;
  mimeType: string;
};

export class ExportSelectionError extends Error {
  constructor(
    readonly code:
      | 'EXPORT_HAS_NO_CHAPTERS'
      | 'EXPORT_CHAPTER_NOT_FOUND'
      | 'EXPORT_CHAPTER_HAS_NO_CONTENT'
      | 'EXPORT_RANGE_HAS_GAPS'
      | 'EXPORT_VOLUME_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ExportSelectionError';
  }
}

const PRESET_STYLES: Record<ExportPreset, ExportStyle> = {
  generic: {
    chapterTitlePattern: '第 {number} 章 {title}',
    volumeTitlePattern: '{title}',
    paragraphSpacing: 1,
    firstLineIndent: true,
    encoding: 'utf-8',
  },
  qidian: {
    chapterTitlePattern: '第{number}章 {title}',
    volumeTitlePattern: '{title}',
    paragraphSpacing: 0,
    firstLineIndent: false,
    encoding: 'utf-8',
  },
  fanqie: {
    chapterTitlePattern: '第{number}章 {title}',
    volumeTitlePattern: '{title}',
    paragraphSpacing: 1,
    firstLineIndent: false,
    encoding: 'utf-8',
  },
};

export function selectExportChapters(
  scope: ExportScope,
  outlines: ExportOutlineNode[],
  sourceChapters: ExportSourceChapter[],
): ExportChapter[] {
  const outlineById = new Map(outlines.map((outline) => [outline.id, outline]));
  const chapterOutlineByNumber = new Map(
    outlines
      .filter(
        (outline): outline is ExportOutlineNode & { chapterNumber: number } =>
          outline.level === 'chapter' && outline.chapterNumber !== null,
      )
      .map((outline) => [outline.chapterNumber, outline]),
  );
  const written = new Map(
    sourceChapters
      .filter((chapter) => chapter.content.trim().length > 0)
      .map((chapter) => [chapter.chapterNumber, chapter]),
  );

  let chapterNumbers: number[];
  if (scope.type === 'chapter') {
    chapterNumbers = [requireWrittenNumber(scope.chapterNumber, written)];
  } else if (scope.type === 'chapters') {
    chapterNumbers = [...new Set(scope.chapterNumbers)].map((chapterNumber) =>
      requireWrittenNumber(chapterNumber, written),
    );
  } else if (scope.type === 'range') {
    if (scope.startChapter > scope.endChapter) {
      throw new ExportSelectionError(
        'EXPORT_RANGE_HAS_GAPS',
        'The end chapter must not come before the start chapter',
      );
    }
    chapterNumbers = [];
    for (
      let chapterNumber = scope.startChapter;
      chapterNumber <= scope.endChapter;
      chapterNumber += 1
    ) {
      chapterNumbers.push(requireWrittenNumber(chapterNumber, written));
    }
  } else if (scope.type === 'volume') {
    const volume = outlineById.get(scope.volumeId);
    if (!volume || volume.level !== 'volume') {
      throw new ExportSelectionError(
        'EXPORT_VOLUME_NOT_FOUND',
        'The selected volume was not found',
      );
    }
    chapterNumbers = sourceChapters
      .filter((chapter) => written.has(chapter.chapterNumber))
      .filter((chapter) => {
        const chapterOutline = chapterOutlineByNumber.get(chapter.chapterNumber);
        return chapterOutline ? isDescendantOf(chapterOutline, volume.id, outlineById) : false;
      })
      .map((chapter) => chapter.chapterNumber);
  } else {
    chapterNumbers = sourceChapters
      .filter((chapter) => written.has(chapter.chapterNumber))
      .map((chapter) => chapter.chapterNumber);
  }

  const selected = [...new Set(chapterNumbers)]
    .sort((left, right) => left - right)
    .map((chapterNumber) => {
      const chapter = written.get(chapterNumber);
      if (!chapter) {
        throw new ExportSelectionError(
          'EXPORT_CHAPTER_NOT_FOUND',
          `Chapter ${chapterNumber} was not found`,
        );
      }
      const chapterOutline = chapterOutlineByNumber.get(chapterNumber);
      const volume = chapterOutline
        ? findAncestorByLevel(chapterOutline, 'volume', outlineById)
        : null;
      return {
        ...chapter,
        volumeId: volume?.id ?? null,
        volumeTitle: volume?.title ?? '',
      };
    });

  if (selected.length === 0) {
    throw new ExportSelectionError(
      'EXPORT_HAS_NO_CHAPTERS',
      'There are no written chapters in this export range',
    );
  }
  return selected;
}

export async function renderExportFile(input: ExportFileInput): Promise<RenderedExportFile> {
  const style = resolveExportStyle(input);
  if (input.format === 'txt') {
    return {
      data: Buffer.from(renderPlainText(input.title, input.chapters, style), 'utf8'),
      extension: 'txt',
      mimeType: 'text/plain; charset=utf-8',
    };
  }
  if (input.format === 'markdown') {
    return {
      data: Buffer.from(renderMarkdown(input.title, input.chapters, style), 'utf8'),
      extension: 'md',
      mimeType: 'text/markdown; charset=utf-8',
    };
  }
  if (input.format === 'docx') {
    return {
      data: await renderDocx(input.title, input.chapters, style),
      extension: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }
  if (input.format === 'epub') {
    return {
      data: await renderEpub(input.title, input.chapters, style),
      extension: 'epub',
      mimeType: 'application/epub+zip',
    };
  }
  throw new Error(`Unsupported export format: ${input.format}`);
}

export function buildExportFileName(title: string, extension: string): string {
  const safeTitle =
    title
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'NovelBrain';
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `${safeTitle}-${stamp}.${extension}`;
}

export function resolveExportStyle(input: {
  preset: ExportPreset;
  chapterTitlePattern?: string;
  volumeTitlePattern?: string;
  paragraphSpacing?: 0 | 1 | 2;
  firstLineIndent?: boolean;
}): ExportStyle {
  const preset = PRESET_STYLES[input.preset];
  return {
    chapterTitlePattern: input.chapterTitlePattern ?? preset.chapterTitlePattern,
    volumeTitlePattern: input.volumeTitlePattern ?? preset.volumeTitlePattern,
    paragraphSpacing: input.paragraphSpacing ?? preset.paragraphSpacing,
    firstLineIndent: input.firstLineIndent ?? preset.firstLineIndent,
    encoding: 'utf-8',
  };
}

function requireWrittenNumber(
  chapterNumber: number,
  written: Map<number, ExportSourceChapter>,
): number {
  const chapter = written.get(chapterNumber);
  if (!chapter) {
    throw new ExportSelectionError(
      chapterNumber > 0 ? 'EXPORT_CHAPTER_HAS_NO_CONTENT' : 'EXPORT_CHAPTER_NOT_FOUND',
      `第 ${chapterNumber} 章还没有可导出的正文`,
    );
  }
  return chapter.chapterNumber;
}

function isDescendantOf(
  outline: ExportOutlineNode,
  ancestorId: string,
  outlineById: Map<string, ExportOutlineNode>,
): boolean {
  let parentId = outline.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) {
      return true;
    }
    seen.add(parentId);
    parentId = outlineById.get(parentId)?.parentId ?? null;
  }
  return false;
}

function findAncestorByLevel(
  outline: ExportOutlineNode,
  level: ExportOutlineNode['level'],
  outlineById: Map<string, ExportOutlineNode>,
): ExportOutlineNode | null {
  let parentId = outline.parentId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = outlineById.get(parentId);
    if (!parent) {
      return null;
    }
    if (parent.level === level) {
      return parent;
    }
    parentId = parent.parentId;
  }
  return null;
}

function renderPlainText(title: string, chapters: ExportChapter[], style: ExportStyle): string {
  const groups = groupByVolume(chapters);
  const lines: string[] = [title, '', '目录'];
  for (const group of groups) {
    if (group.title) {
      lines.push(renderVolumeTitle(group.title, group.number, style));
    }
    for (const chapter of group.chapters) {
      lines.push(renderChapterTitle(chapter, style));
    }
  }
  lines.push('');

  for (const group of groups) {
    if (group.title) {
      lines.push(renderVolumeTitle(group.title, group.number, style), '');
    }
    for (const chapter of group.chapters) {
      lines.push(renderChapterTitle(chapter, style), '');
      lines.push(formatProse(chapter.content, style), '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderMarkdown(title: string, chapters: ExportChapter[], style: ExportStyle): string {
  const groups = groupByVolume(chapters);
  const sections: string[] = [`# ${title}`, '## 目录'];
  for (const group of groups) {
    if (group.title) {
      sections.push(`- ${renderVolumeTitle(group.title, group.number, style)}`);
    }
    for (const chapter of group.chapters) {
      sections.push(`  - ${renderChapterTitle(chapter, style)}`);
    }
  }

  for (const group of groups) {
    if (group.title) {
      sections.push(`## ${renderVolumeTitle(group.title, group.number, style)}`);
    }
    for (const chapter of group.chapters) {
      sections.push(
        `### ${renderChapterTitle(chapter, style)}`,
        formatProse(chapter.content, style),
      );
    }
  }
  return `${sections.join('\n\n').trim()}\n`;
}

function groupByVolume(chapters: ExportChapter[]) {
  const groups: Array<{
    key: string;
    title: string;
    number: number;
    chapters: ExportChapter[];
  }> = [];
  for (const chapter of chapters) {
    const key = `${chapter.volumeId ?? ''}:${chapter.volumeTitle}`;
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      group = {
        key,
        title: chapter.volumeTitle,
        number: groups.length + 1,
        chapters: [],
      };
      groups.push(group);
    }
    group.chapters.push(chapter);
  }
  return groups;
}

function renderChapterTitle(chapter: ExportChapter, style: ExportStyle): string {
  return applyTitlePattern(style.chapterTitlePattern, {
    number: chapter.chapterNumber,
    title: chapter.title,
    volumeTitle: chapter.volumeTitle,
    volumeNumber: '',
  });
}

function renderVolumeTitle(title: string, volumeNumber: number, style: ExportStyle): string {
  return applyTitlePattern(style.volumeTitlePattern, {
    number: '',
    title,
    volumeTitle: title,
    volumeNumber,
  });
}

function applyTitlePattern(
  pattern: string,
  values: {
    number: number | '';
    title: string;
    volumeTitle: string;
    volumeNumber: number | '';
  },
): string {
  return pattern
    .replaceAll('{number}', String(values.number))
    .replaceAll('{title}', values.title)
    .replaceAll('{volumeTitle}', values.volumeTitle)
    .replaceAll('{volumeNumber}', String(values.volumeNumber))
    .trim();
}

function formatProse(content: string, style: ExportStyle): string {
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => (style.firstLineIndent ? `\u3000\u3000${paragraph}` : paragraph));
  return paragraphs.join('\n'.repeat(style.paragraphSpacing + 1));
}
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

async function renderDocx(
  title: string,
  chapters: ExportChapter[],
  style: ExportStyle,
): Promise<Buffer> {
  const archive = new JSZip();
  archive.file(
    '[Content_Types].xml',
    xmlDeclaration(
      [
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        '</Types>',
      ].join(''),
    ),
  );
  archive.file(
    '_rels/.rels',
    xmlDeclaration(
      [
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
        '</Relationships>',
      ].join(''),
    ),
  );
  archive.file(
    'word/_rels/document.xml.rels',
    xmlDeclaration(
      [
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '</Relationships>',
      ].join(''),
    ),
  );
  archive.file('word/styles.xml', xmlDeclaration(docxStyles()));

  const groups = groupByVolume(chapters);
  const body: string[] = [docxParagraph(title, 'Title'), docxParagraph('目录', 'Heading1')];
  for (const group of groups) {
    if (group.title) {
      body.push(docxParagraph(renderVolumeTitle(group.title, group.number, style), 'Heading1'));
    }
    for (const chapter of group.chapters) {
      body.push(docxParagraph(renderChapterTitle(chapter, style), 'Heading2'));
    }
  }
  for (const group of groups) {
    if (group.title) {
      body.push(
        docxParagraph(renderVolumeTitle(group.title, group.number, style), 'Heading1', true),
      );
    }
    for (const chapter of group.chapters) {
      body.push(docxParagraph(renderChapterTitle(chapter, style), 'Heading2', true));
      for (const paragraph of proseParagraphs(chapter.content)) {
        body.push(docxParagraph(paragraph, null, false, style.firstLineIndent));
      }
    }
  }
  archive.file(
    'word/document.xml',
    xmlDeclaration(
      [
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body>',
        ...body,
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
        '</w:body>',
        '</w:document>',
      ].join(''),
    ),
  );
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function docxStyles(): string {
  return [
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:eastAsia="宋体" w:hAnsi="Georgia"/><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="180" w:line="360" w:lineRule="auto"/></w:pPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="480"/></w:pPr><w:rPr><w:b/><w:sz w:val="48"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="360" w:after="180"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>',
    '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="300" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>',
    '</w:styles>',
  ].join('');
}

function docxParagraph(
  text: string,
  style: 'Title' | 'Heading1' | 'Heading2' | null,
  pageBreakBefore = false,
  firstLineIndent = false,
): string {
  const properties = [
    pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    firstLineIndent ? '<w:ind w:firstLineChars="200"/>' : '',
    style ? `<w:pStyle w:val="${style}"/>` : '',
  ].join('');
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

async function renderEpub(
  title: string,
  chapters: ExportChapter[],
  style: ExportStyle,
): Promise<Buffer> {
  const archive = new JSZip();
  archive.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  archive.file(
    'META-INF/container.xml',
    xmlDeclaration(
      [
        '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
        '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
        '</container>',
      ].join(''),
    ),
  );
  archive.file('OEBPS/styles.css', epubStyles());

  const groups = groupByVolume(chapters);
  const navigationItems: string[] = [];
  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  const chapterFiles = chapters.map((chapter, index) => ({
    chapter,
    fileName: `chapter-${index + 1}.xhtml`,
  }));
  const chapterIndexByNumber = new Map(
    chapterFiles.map((entry, index) => [entry.chapter.chapterNumber, index]),
  );

  let chapterIndex = 0;
  for (const group of groups) {
    const links: string[] = [];
    for (const chapter of group.chapters) {
      const entry = chapterFiles[chapterIndexByNumber.get(chapter.chapterNumber) ?? chapterIndex];
      if (!entry) {
        continue;
      }
      links.push(
        `<li><a href="${entry.fileName}">${escapeXml(renderChapterTitle(chapter, style))}</a></li>`,
      );
      chapterIndex += 1;
    }
    navigationItems.push(
      group.title
        ? `<li><span>${escapeXml(renderVolumeTitle(group.title, group.number, style))}</span><ol>${links.join('')}</ol></li>`
        : links.join(''),
    );
  }

  for (const [index, entry] of chapterFiles.entries()) {
    manifestItems.push(
      `<item id="chapter-${index + 1}" href="${entry.fileName}" media-type="application/xhtml+xml"/>`,
    );
    spineItems.push(`<itemref idref="chapter-${index + 1}"/>`);
    const volumeHeading = entry.chapter.volumeTitle
      ? `<p class="volume">${escapeXml(
          renderVolumeTitle(
            entry.chapter.volumeTitle,
            groups.find((group) => group.title === entry.chapter.volumeTitle)?.number ?? 1,
            style,
          ),
        )}</p>`
      : '';
    archive.file(
      `OEBPS/${entry.fileName}`,
      xhtmlDocument(
        renderChapterTitle(entry.chapter, style),
        `${volumeHeading}<h1>${escapeXml(renderChapterTitle(entry.chapter, style))}</h1>${proseParagraphs(
          entry.chapter.content,
        )
          .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
          .join('')}`,
      ),
    );
  }

  archive.file(
    'OEBPS/nav.xhtml',
    xhtmlDocument(
      '目录',
      `<nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navigationItems.join('')}</ol></nav>`,
    ),
  );
  archive.file(
    'OEBPS/toc.ncx',
    xmlDeclaration(
      [
        '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">',
        `<head><meta name="dtb:uid" content="${epubIdentifier(title)}"/></head>`,
        `<docTitle><text>${escapeXml(title)}</text></docTitle>`,
        '<navMap>',
        ...chapterFiles.map(
          (entry, index) =>
            `<navPoint id="nav-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(
              renderChapterTitle(entry.chapter, style),
            )}</text></navLabel><content src="${entry.fileName}"/></navPoint>`,
        ),
        '</navMap>',
        '</ncx>',
      ].join(''),
    ),
  );
  archive.file(
    'OEBPS/content.opf',
    xmlDeclaration(
      [
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">',
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
        `<dc:identifier id="book-id">${epubIdentifier(title)}</dc:identifier>`,
        `<dc:title>${escapeXml(title)}</dc:title>`,
        '<dc:language>zh-CN</dc:language>',
        '<meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>',
        '</metadata>',
        '<manifest>',
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
        '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        '<item id="styles" href="styles.css" media-type="text/css"/>',
        ...manifestItems,
        '</manifest>',
        '<spine toc="ncx">',
        ...spineItems,
        '</spine>',
        '</package>',
      ].join(''),
    ),
  );
  return archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function epubStyles(): string {
  return [
    'body{font-family:serif;line-height:1.9;margin:0 auto;max-width:42em;padding:1.5em;color:#1f2320;}',
    'h1{font-size:1.45em;margin:1.4em 0 .8em;line-height:1.4;}',
    '.volume{color:#7a4a3a;font-size:.82em;margin:1.2em 0 0;letter-spacing:0;}',
    'p{margin:0 0 .85em;text-indent:2em;}',
    'nav ol{line-height:1.8;}',
  ].join('');
}

function xhtmlDocument(title: string, body: string): string {
  return xmlDeclaration(
    [
      '<!DOCTYPE html>',
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN" lang="zh-CN">',
      `<head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>`,
      `<body>${body}</body>`,
      '</html>',
    ].join(''),
  );
}

function proseParagraphs(content: string): string[] {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function epubIdentifier(title: string): string {
  const hash = createHash('sha1').update(title).digest('hex');
  return `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function xmlDeclaration(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>${content}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
