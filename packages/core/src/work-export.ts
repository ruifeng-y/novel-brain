import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import {
  workExportManifestSchema,
  type WorkExportManifest,
  type WorkExportManifestBase,
  type WorkExportOptions,
  type WorkExportRequest,
} from "@novel-brain/contracts";

export interface WorkExportChapterSource {
  chapterId: string;
  chapterNumber: number;
  title: string;
  chapterVersionId: string;
  versionNodeId: string;
  content: string;
  volumeNodeId: string | null;
  volumeNumber: number | null;
  volumeTitle: string | null;
}

export interface WorkExportSupplementSource {
  kind: "story_bible" | "settings" | "outline" | "foreshadows" | "change_history";
  id: string;
  versionNodeId: string | null;
  title: string;
  content: string;
}

export interface WorkExportInput {
  work: {
    id: string;
    title: string;
    penName: string;
    genre: "xianxia" | "history" | "urban";
    aiDisclosureRequired?: boolean;
  };
  branch: {
    id: string;
    name: string;
  };
  resolvedVersionNodeId: string;
  request: WorkExportRequest;
  chapters: WorkExportChapterSource[];
  supplements: WorkExportSupplementSource[];
}

export interface WorkExportArtifact {
  manifest: WorkExportManifest;
  bytes: Uint8Array;
  checksum: string;
  contentType: string;
  fileName: string;
}

const FORMAT_DETAILS = {
  txt: {
    contentType: "text/plain; charset=utf-8",
    extension: "txt",
  },
  markdown: {
    contentType: "text/markdown; charset=utf-8",
    extension: "md",
  },
  docx: {
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    extension: "docx",
  },
  epub: {
    contentType: "application/epub+zip",
    extension: "epub",
  },
} as const;

export function buildWorkExportArtifact(input: WorkExportInput): WorkExportArtifact {
  const chapters = normalizeChapters(input.request, input.chapters);
  const base = buildManifestBase(input, chapters);
  const manifestHash = sha256(stableStringify(base));
  const manifest = workExportManifestSchema.parse({
    ...base,
    manifestHash,
  });
  const bytes = renderDocument(manifest, chapters, input.supplements);
  const format = FORMAT_DETAILS[manifest.format];
  return {
    manifest,
    bytes,
    checksum: sha256(bytes),
    contentType: format.contentType,
    fileName: `${safeFileStem(manifest.work.title)}-${manifestHash.slice(0, 12)}.${format.extension}`,
  };
}

export function hasCurrentAiDisclosureMetadata(
  manifest: WorkExportManifest,
): manifest is WorkExportManifest & {
  schemaVersion: 2;
  aiDisclosureMetadata: NonNullable<WorkExportManifest["aiDisclosureMetadata"]>;
} {
  return manifest.schemaVersion === 2 && Boolean(manifest.aiDisclosureMetadata);
}

function buildManifestBase(
  input: WorkExportInput,
  chapters: WorkExportChapterSource[],
): WorkExportManifestBase {
  return {
    schemaVersion: 2,
    work: {
      id: input.work.id,
      title: input.work.title,
      penName: input.work.penName,
      genre: input.work.genre,
    },
    branch: {
      id: input.branch.id,
      name: input.branch.name,
      requestedVersionNodeId: input.request.sourceVersionNodeId,
      resolvedVersionNodeId: input.resolvedVersionNodeId,
    },
    scope: input.request.scope,
    format: input.request.format,
    options: input.request.options,
    chapters: chapters.map((chapter) => ({
      chapterId: chapter.chapterId,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      chapterVersionId: chapter.chapterVersionId,
      versionNodeId: chapter.versionNodeId,
      contentSha256: sha256(chapter.content),
      characterCount: [...chapter.content].length,
      volumeNodeId: chapter.volumeNodeId,
      volumeNumber: chapter.volumeNumber,
      volumeTitle: chapter.volumeTitle,
    })),
    supplements: input.supplements
      .map((supplement) => ({
        kind: supplement.kind,
        id: supplement.id,
        versionNodeId: supplement.versionNodeId,
        contentSha256: sha256(supplement.content),
      }))
      .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)),
    characterCount: chapters.reduce((total, chapter) => total + [...chapter.content].length, 0),
    aiDisclosureMetadata: {
      required: input.work.aiDisclosureRequired ?? true,
      label: "含 AI 辅助生成内容",
      policyVersion: "ai-disclosure-v1",
    },
  };
}

function normalizeChapters(
  request: WorkExportRequest,
  chapters: WorkExportChapterSource[],
): WorkExportChapterSource[] {
  if (chapters.length === 0) {
    throw new Error("Export source must contain at least one chapter");
  }
  const sorted = [...chapters].sort((left, right) => left.chapterNumber - right.chapterNumber);
  if (
    new Set(sorted.map((chapter) => chapter.chapterId)).size !== sorted.length ||
    new Set(sorted.map((chapter) => chapter.chapterNumber)).size !== sorted.length
  ) {
    throw new Error("Export source contains duplicate chapters");
  }
  if (request.scope.kind === "current_chapter") {
    if (sorted.length !== 1 || sorted[0]?.chapterId !== request.scope.chapterId) {
      throw new Error("Current chapter export must resolve to exactly one matching chapter");
    }
  }
  if (request.scope.kind === "selected_chapters") {
    const expected = new Set(request.scope.chapterIds);
    if (
      sorted.length !== expected.size ||
      sorted.some((chapter) => !expected.has(chapter.chapterId))
    ) {
      throw new Error("Selected chapter export does not match its source chapters");
    }
  }
  if (request.scope.kind === "chapter_range") {
    const { fromChapter, toChapter } = request.scope;
    if (
      sorted.some(
        (chapter) => chapter.chapterNumber < fromChapter || chapter.chapterNumber > toChapter,
      )
    ) {
      throw new Error("Chapter range export contains a chapter outside the requested range");
    }
  }
  return sorted;
}

function renderDocument(
  manifest: WorkExportManifest,
  chapters: WorkExportChapterSource[],
  supplements: WorkExportSupplementSource[],
): Uint8Array {
  if (manifest.format === "txt") {
    return new TextEncoder().encode(renderText(manifest, chapters, supplements));
  }
  if (manifest.format === "markdown") {
    return new TextEncoder().encode(renderMarkdown(manifest, chapters, supplements));
  }
  if (manifest.format === "docx") {
    return renderDocx(manifest, chapters, supplements);
  }
  return renderEpub(manifest, chapters, supplements);
}

function renderText(
  manifest: WorkExportManifest,
  chapters: WorkExportChapterSource[],
  supplements: WorkExportSupplementSource[],
): string {
  const lines = [
    `《${manifest.work.title}》`,
    `作者：${manifest.work.penName}`,
    `分支：${manifest.branch.name}`,
    ...(manifest.aiDisclosureMetadata?.required
      ? [`内容说明：${manifest.aiDisclosureMetadata.label}`]
      : []),
    `格式：TXT · UTF-8`,
    `版本清单哈希：${manifest.manifestHash}`,
    "",
  ];
  let currentVolume: string | null = null;
  for (const chapter of chapters) {
    const volume = chapter.volumeNumber
      ? formatTitle(manifest.options.volumeTitleFormat, {
          number: chapter.volumeNumber,
          title: chapter.volumeTitle ?? "",
        })
      : null;
    if (volume && volume !== currentVolume) {
      lines.push(volume, "");
      currentVolume = volume;
    }
    lines.push(
      formatTitle(manifest.options.chapterTitleFormat, {
        number: chapter.chapterNumber,
        title: chapter.title,
      }),
      "",
      formatTextParagraphs(chapter.content, manifest.options),
      "",
    );
  }
  for (const supplement of supplements) {
    lines.push(supplement.title, "", supplement.content.trim(), "");
  }
  lines.push("版本清单", stableStringify(manifest), "");
  return lines.join("\n");
}

function renderMarkdown(
  manifest: WorkExportManifest,
  chapters: WorkExportChapterSource[],
  supplements: WorkExportSupplementSource[],
): string {
  const lines = [
    `# ${manifest.work.title}`,
    "",
    `- 作者：${manifest.work.penName}`,
    `- 分支：${manifest.branch.name}`,
    ...(manifest.aiDisclosureMetadata?.required
      ? [`- 内容说明：${manifest.aiDisclosureMetadata.label}`]
      : []),
    `- 格式：Markdown · UTF-8`,
    `- 版本清单哈希：\`${manifest.manifestHash}\``,
    "",
  ];
  let currentVolume: string | null = null;
  for (const chapter of chapters) {
    const volume = chapter.volumeNumber
      ? formatTitle(manifest.options.volumeTitleFormat, {
          number: chapter.volumeNumber,
          title: chapter.volumeTitle ?? "",
        })
      : null;
    if (volume && volume !== currentVolume) {
      lines.push(`## ${volume}`, "");
      currentVolume = volume;
    }
    lines.push(
      `### ${formatTitle(manifest.options.chapterTitleFormat, {
        number: chapter.chapterNumber,
        title: chapter.title,
      })}`,
      "",
      formatTextParagraphs(chapter.content, manifest.options),
      "",
    );
  }
  for (const supplement of supplements) {
    lines.push(`## ${supplement.title}`, "", supplement.content.trim(), "");
  }
  lines.push("## 版本清单", "", "```json", stableStringify(manifest), "```", "");
  return lines.join("\n");
}

function renderDocx(
  manifest: WorkExportManifest,
  chapters: WorkExportChapterSource[],
  supplements: WorkExportSupplementSource[],
): Uint8Array {
  const paragraphs: DocxParagraph[] = [
    { text: manifest.work.title },
    { text: `作者：${manifest.work.penName}` },
    { text: `分支：${manifest.branch.name}` },
    ...(manifest.aiDisclosureMetadata?.required
      ? [{ text: `内容说明：${manifest.aiDisclosureMetadata.label}` }]
      : []),
  ];
  let currentVolume: string | null = null;
  for (const chapter of chapters) {
    const volume = chapter.volumeNumber
      ? formatTitle(manifest.options.volumeTitleFormat, {
          number: chapter.volumeNumber,
          title: chapter.volumeTitle ?? "",
        })
      : null;
    if (volume && volume !== currentVolume) {
      paragraphs.push({ text: volume });
      currentVolume = volume;
    }
    paragraphs.push(
      {
        text: formatTitle(manifest.options.chapterTitleFormat, {
          number: chapter.chapterNumber,
          title: chapter.title,
        }),
      },
      ...docxContentParagraphs(chapter.content, manifest.options),
    );
  }
  for (const supplement of supplements) {
    paragraphs.push({ text: supplement.title }, { text: supplement.content.trim() });
  }
  paragraphs.push({ text: "版本清单" }, { text: stableStringify(manifest) });

  const documentXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    ...paragraphs.map((paragraph) => {
      if (paragraph.spacer) {
        return "<w:p/>";
      }
      const properties = paragraph.firstLineIndent
        ? '<w:pPr><w:ind w:firstLine="480"/></w:pPr>'
        : "";
      return `<w:p>${properties}<w:r><w:t xml:space="preserve">${xmlEscape(paragraph.text)}</w:t></w:r></w:p>`;
    }),
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
    "</w:body>",
    "</w:document>",
  ].join("");
  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="json" ContentType="application/json"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    "</Types>",
  ].join("");
  const rootRelationships = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    "</Relationships>",
  ].join("");
  const documentRelationships = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    "</Relationships>",
  ].join("");
  const stylesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
    "</w:styles>",
  ].join("");
  const coreXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:title>${xmlEscape(manifest.work.title)}</dc:title>`,
    `<dc:creator>${xmlEscape(manifest.work.penName)}</dc:creator>`,
    `<dc:identifier>${manifest.manifestHash}</dc:identifier>`,
    "</cp:coreProperties>",
  ].join("");
  const appXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
    "<Application>NovelBrain</Application>",
    "</Properties>",
  ].join("");

  return createZip([
    { name: "[Content_Types].xml", data: utf8(contentTypes) },
    { name: "_rels/.rels", data: utf8(rootRelationships) },
    { name: "docProps/core.xml", data: utf8(coreXml) },
    { name: "docProps/app.xml", data: utf8(appXml) },
    { name: "word/document.xml", data: utf8(documentXml) },
    { name: "word/styles.xml", data: utf8(stylesXml) },
    { name: "word/_rels/document.xml.rels", data: utf8(documentRelationships) },
    {
      name: "customXml/version-manifest.json",
      data: utf8(`${stableStringify(manifest)}\n`),
    },
  ]);
}

function renderEpub(
  manifest: WorkExportManifest,
  chapters: WorkExportChapterSource[],
  supplements: WorkExportSupplementSource[],
): Uint8Array {
  let currentVolume: string | null = null;
  const chapterSections = chapters
    .map((chapter) => {
      const volume = chapter.volumeNumber
        ? formatTitle(manifest.options.volumeTitleFormat, {
            number: chapter.volumeNumber,
            title: chapter.volumeTitle ?? "",
          })
        : null;
      const volumeHeading =
        volume && volume !== currentVolume ? `<h2 class="volume">${xmlEscape(volume)}</h2>` : "";
      currentVolume = volume ?? currentVolume;
      return `${volumeHeading}<section id="chapter-${chapter.chapterNumber}"><h2>${xmlEscape(
        formatTitle(manifest.options.chapterTitleFormat, {
          number: chapter.chapterNumber,
          title: chapter.title,
        }),
      )}</h2>${epubContentParagraphs(chapter.content, manifest.options)}</section>`;
    })
    .join("");
  const supplementSections = supplements
    .map(
      (supplement) =>
        `<section><h2>${xmlEscape(supplement.title)}</h2><pre>${xmlEscape(
          supplement.content,
        )}</pre></section>`,
    )
    .join("");
  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE html>",
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">',
    `<head><title>${xmlEscape(manifest.work.title)}</title><style>.volume{margin-top:1.5em}.paragraph{margin:0}.spaced{margin-bottom:1em}.compact{margin-bottom:0}.indent{text-indent:2em}</style></head>`,
    `<body><h1>${xmlEscape(manifest.work.title)}</h1><p>作者：${xmlEscape(
      manifest.work.penName,
    )}</p>${
      manifest.aiDisclosureMetadata?.required
        ? `<p>${xmlEscape(manifest.aiDisclosureMetadata.label)}</p>`
        : ""
    }${chapterSections}${supplementSections}<section><h2>版本清单</h2><pre>${xmlEscape(
      manifest.manifestHash,
    )}</pre></section></body>`,
    "</html>",
  ].join("");
  const container = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>',
    "</container>",
  ].join("");
  const contentOpf = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">',
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    `<dc:identifier id="book-id">${manifest.work.id}</dc:identifier>`,
    `<dc:title>${xmlEscape(manifest.work.title)}</dc:title>`,
    `<dc:creator>${xmlEscape(manifest.work.penName)}</dc:creator>`,
    ...(manifest.aiDisclosureMetadata?.required
      ? [
          `<meta property="nb:ai-disclosure">${xmlEscape(manifest.aiDisclosureMetadata.label)}</meta>`,
        ]
      : []),
    "<dc:language>zh-CN</dc:language>",
    '<meta property="dcterms:modified">1970-01-01T00:00:00Z</meta>',
    "</metadata>",
    '<manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/><item id="toc" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="manifest" href="version-manifest.json" media-type="application/json"/></manifest>',
    '<spine><itemref idref="text"/><itemref idref="toc"/></spine>',
    "</package>",
  ].join("");
  const toc = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE html>",
    '<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">',
    '<head><title>目录</title></head><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>目录</h1><ol>',
    ...chapters.map(
      (chapter) =>
        `<li><a href="text.xhtml#chapter-${chapter.chapterNumber}">${xmlEscape(
          formatTitle(manifest.options.chapterTitleFormat, {
            number: chapter.chapterNumber,
            title: chapter.title,
          }),
        )}</a></li>`,
    ),
    "</ol></nav></body></html>",
  ].join("");

  return createZip([
    { name: "mimetype", data: utf8("application/epub+zip"), store: true },
    { name: "META-INF/container.xml", data: utf8(container) },
    { name: "OEBPS/content.opf", data: utf8(contentOpf) },
    { name: "OEBPS/toc.xhtml", data: utf8(toc) },
    { name: "OEBPS/text.xhtml", data: utf8(text) },
    {
      name: "OEBPS/version-manifest.json",
      data: utf8(`${stableStringify(manifest)}\n`),
    },
  ]);
}

function formatTextParagraphs(content: string, options: WorkExportOptions): string {
  const paragraphs = content
    .normalize("NFC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (options.firstLineIndent ? `\u3000\u3000${line}` : line));
  return paragraphs.join(options.paragraphBlankLine ? "\n\n" : "\n");
}

interface DocxParagraph {
  text: string;
  firstLineIndent?: boolean;
  spacer?: boolean;
}

function docxContentParagraphs(content: string, options: WorkExportOptions): DocxParagraph[] {
  const lines = content
    .normalize("NFC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.flatMap((line, index) => [
    { text: line, firstLineIndent: options.firstLineIndent },
    ...(options.paragraphBlankLine && index < lines.length - 1 ? [{ text: "", spacer: true }] : []),
  ]);
}

function epubContentParagraphs(content: string, options: WorkExportOptions): string {
  const classes = [
    "paragraph",
    options.paragraphBlankLine ? "spaced" : "compact",
    ...(options.firstLineIndent ? ["indent"] : []),
  ].join(" ");
  return content
    .normalize("NFC")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p class="${classes}">${xmlEscape(line)}</p>`)
    .join("");
}

function formatTitle(format: string, values: { number: number; title: string }): string {
  return format.replaceAll("{number}", String(values.number)).replaceAll("{title}", values.title);
}

function safeFileStem(title: string): string {
  return title.replaceAll(/[\\/:*?"<>|]/gu, "_").trim() || "novel";
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

interface ZipEntry {
  name: string;
  data: Uint8Array;
  store?: boolean;
}

function createZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const plain = Buffer.from(entry.data);
    const compressed = entry.store ? plain : deflateRaw(plain);
    const method = entry.store ? 0 : 8;
    const crc = crc32(plain);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(plain.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function deflateRaw(value: Buffer): Buffer {
  return deflateRawSync(value);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(value: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
}
