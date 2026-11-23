import { unzipSync, type UnzipFileInfo } from "fflate";
import { SaxesParser } from "saxes";

export type DocxImportKind = "manuscript" | "settings";
export type DocxImportErrorReason =
  | "embedded"
  | "empty"
  | "encrypted"
  | "external_relation"
  | "invalid"
  | "oversized"
  | "unsafe"
  | "xml_declaration";

export interface DocxReadOptions {
  maxCompressedBytes: number;
  maxUncompressedBytes: number;
  maxTextCharacters: number;
}

export interface DocxTextResult {
  text: string;
  headingStarts: number[];
}

interface ChapterNumbering {
  format: string;
  levelText: string;
  start: number;
}

export class DocxImportError extends Error {
  constructor(readonly reason: DocxImportErrorReason) {
    super(`DOCX import failed: ${reason}`);
    this.name = "DocxImportError";
  }
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] as const;
const MAX_ZIP_ENTRIES = 2_048;
const MAX_XML_DEPTH = 256;
const MAX_XML_NODES = 250_000;
const MAX_DOCUMENT_XML_BYTES = 8 * 1024 * 1024;
const WORD_PROCESSING_NAMESPACES = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);

export function isDocxFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".docx");
}

export function readDocxText(buffer: Buffer, options: DocxReadOptions): DocxTextResult {
  if (buffer.length <= 0) {
    throw new DocxImportError("empty");
  }
  if (buffer.length > options.maxCompressedBytes) {
    throw new DocxImportError("oversized");
  }
  if (hasPrefix(buffer, OLE_MAGIC)) {
    throw new DocxImportError("encrypted");
  }
  if (!isZip(buffer)) {
    throw new DocxImportError("invalid");
  }

  const entries = extractSafeEntries(buffer, options.maxUncompressedBytes);
  const documentXml = entries["word/document.xml"];
  const contentTypesXml = entries["[Content_Types].xml"];
  const packageRelationshipsXml = entries["_rels/.rels"];
  if (!documentXml || !contentTypesXml || !packageRelationshipsXml) {
    throw new DocxImportError("invalid");
  }
  if (documentXml.byteLength > MAX_DOCUMENT_XML_BYTES) {
    throw new DocxImportError("oversized");
  }

  if (
    !hasMainDocumentContentType(decodeXml(contentTypesXml)) ||
    !hasMainDocumentRelationship(decodeXml(packageRelationshipsXml))
  ) {
    throw new DocxImportError("invalid");
  }

  for (const [name, entry] of Object.entries(entries)) {
    if (name.toLowerCase().endsWith(".rels") && hasUnsafeExternalRelationship(decodeXml(entry))) {
      throw new DocxImportError("external_relation");
    }
  }

  const xml = decodeXml(documentXml);
  if (!isWordDocumentXml(xml)) {
    throw new DocxImportError("invalid");
  }

  const numberingXml = entries["word/numbering.xml"];
  const numbering = numberingXml ? parseChapterNumbering(decodeXml(numberingXml)) : new Map();
  const result = extractVisibleText(xml, options.maxTextCharacters, numbering);
  if (!result.text.trim()) {
    throw new DocxImportError("empty");
  }
  return result;
}

export function docxImportErrorMessage(
  kind: DocxImportKind,
  reason: DocxImportErrorReason,
): string {
  const label = kind === "manuscript" ? "旧稿" : "设定";
  switch (reason) {
    case "encrypted":
      return `DOCX ${label}文件已加密，请取消密码保护后重新上传`;
    case "empty":
      return `DOCX ${label}文件中没有可导入的正文`;
    case "oversized":
      return `DOCX ${label}解压后内容过大`;
    case "external_relation":
      return `DOCX ${label}包含不支持的外部关系`;
    case "embedded":
      return `DOCX ${label}包含宏或嵌入对象`;
    case "xml_declaration":
      return `DOCX ${label}包含不支持的 XML 声明`;
    case "unsafe":
      return `DOCX ${label}包含不支持的内容结构`;
    case "invalid":
      return `DOCX ${label}文件损坏或格式不受支持`;
  }
}

function extractSafeEntries(
  buffer: Buffer,
  maxUncompressedBytes: number,
): Record<string, Uint8Array> {
  let entryCount = 0;
  let totalUncompressedBytes = 0;
  const seen = new Set<string>();

  try {
    return unzipSync(new Uint8Array(buffer), {
      filter(file) {
        entryCount += 1;
        if (entryCount > MAX_ZIP_ENTRIES || seen.has(file.name)) {
          throw new DocxImportError("unsafe");
        }
        seen.add(file.name);
        validateEntryName(file);
        totalUncompressedBytes += file.originalSize;
        if (totalUncompressedBytes > maxUncompressedBytes) {
          throw new DocxImportError("oversized");
        }
        return (
          file.name === "[Content_Types].xml" ||
          file.name === "_rels/.rels" ||
          file.name === "word/document.xml" ||
          file.name === "word/numbering.xml" ||
          file.name.toLowerCase().endsWith(".rels")
        );
      },
    });
  } catch (error) {
    if (error instanceof DocxImportError) {
      throw error;
    }
    throw new DocxImportError("invalid");
  }
}

function validateEntryName(file: UnzipFileInfo): void {
  const name = file.name.replaceAll("\\", "/").toLowerCase();
  if (
    name.startsWith("/") ||
    name.split("/").includes("..") ||
    name === "word/vbaproject.bin" ||
    name.startsWith("word/embeddings/") ||
    name.startsWith("word/activex/") ||
    name.includes("/vbadata.xml") ||
    name.endsWith(".mht")
  ) {
    throw new DocxImportError("embedded");
  }
  if (file.originalSize < 0) {
    throw new DocxImportError("invalid");
  }
}

function extractVisibleText(
  xml: string,
  maxTextCharacters: number,
  numbering: Map<number, ChapterNumbering>,
): DocxTextResult {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const blocks: Array<{ text: string; heading: boolean }> = [];
  let depth = 0;
  let nodeCount = 0;
  let paragraph: string[] | null = null;
  let paragraphHeading = false;
  let paragraphNumId: number | undefined;
  let paragraphIlvl = 0;
  let textDepth = 0;
  let tableRowDepth = 0;
  let tableCellDepth = 0;
  let rowCells: string[] = [];
  let cellParagraphs: string[] = [];
  let textLength = 0;
  const numberingCounters = new Map<number, number>();

  parser.on("doctype", () => {
    throw new DocxImportError("xml_declaration");
  });
  parser.on("opentag", (tag) => {
    depth += 1;
    nodeCount += 1;
    if (depth > MAX_XML_DEPTH || nodeCount > MAX_XML_NODES) {
      throw new DocxImportError("unsafe");
    }

    const localName = localTagName(tag.name);
    if (localName === "altchunk") {
      throw new DocxImportError("unsafe");
    }
    if (localName === "p") {
      if (paragraph) {
        throw new DocxImportError("unsafe");
      }
      paragraph = [];
      paragraphHeading = false;
      paragraphNumId = undefined;
      paragraphIlvl = 0;
    } else if (localName === "pstyle") {
      const styleId = attributeValue(tag.attributes, "val");
      paragraphHeading = paragraphHeading || (styleId ? isHeadingStyleId(styleId) : false);
    } else if (localName === "outlinelvl") {
      const outlineLevel = Number(attributeValue(tag.attributes, "val"));
      paragraphHeading =
        paragraphHeading ||
        (Number.isInteger(outlineLevel) && outlineLevel >= 0 && outlineLevel <= 5);
    } else if (localName === "numid") {
      const numId = Number(attributeValue(tag.attributes, "val"));
      paragraphNumId = Number.isInteger(numId) ? numId : undefined;
    } else if (localName === "ilvl") {
      const ilvl = Number(attributeValue(tag.attributes, "val"));
      paragraphIlvl = Number.isInteger(ilvl) ? ilvl : 0;
    } else if (localName === "t") {
      textDepth += 1;
    } else if (localName === "tab") {
      appendToParagraph(paragraph, "\t");
    } else if (localName === "br" || localName === "cr") {
      appendToParagraph(paragraph, "\n");
    } else if (localName === "tr") {
      if (tableRowDepth > 0) {
        throw new DocxImportError("unsafe");
      }
      tableRowDepth += 1;
      rowCells = [];
    } else if (localName === "tc") {
      if (tableRowDepth === 0 || tableCellDepth > 0) {
        throw new DocxImportError("unsafe");
      }
      tableCellDepth += 1;
      cellParagraphs = [];
    }
  });
  parser.on("text", (value) => {
    if (textDepth > 0 && paragraph) {
      textLength += value.length;
      if (textLength > maxTextCharacters) {
        throw new DocxImportError("oversized");
      }
      paragraph.push(value);
    }
  });
  parser.on("closetag", (tag) => {
    const localName = localTagName(tag.name);
    if (localName === "t") {
      textDepth = Math.max(0, textDepth - 1);
    } else if (localName === "p") {
      if (!paragraph) {
        throw new DocxImportError("unsafe");
      }
      const numbered = applyChapterNumbering({
        text: paragraph.join("").replace(/\r\n?/gu, "\n"),
        numId: paragraphNumId,
        level: paragraphIlvl,
        numbering,
        counters: numberingCounters,
      });
      paragraph = null;
      if (tableCellDepth > 0) {
        cellParagraphs.push(numbered.text);
      } else if (tableRowDepth === 0) {
        blocks.push({ text: numbered.text, heading: paragraphHeading || numbered.heading });
      }
      paragraphHeading = false;
      paragraphNumId = undefined;
      paragraphIlvl = 0;
    } else if (localName === "tc") {
      if (tableCellDepth === 0) {
        throw new DocxImportError("unsafe");
      }
      tableCellDepth -= 1;
      rowCells.push(cellParagraphs.join("\n").trim());
      cellParagraphs = [];
    } else if (localName === "tr") {
      if (tableRowDepth === 0 || tableCellDepth !== 0) {
        throw new DocxImportError("unsafe");
      }
      tableRowDepth -= 1;
      const row = formatTableRow(rowCells);
      if (row.trim()) {
        blocks.push({ text: row, heading: false });
      }
      rowCells = [];
    }
    depth -= 1;
  });

  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof DocxImportError) {
      throw error;
    }
    throw new DocxImportError("invalid");
  }

  return blocksToText(blocks);
}

function blocksToText(blocks: Array<{ text: string; heading: boolean }>): DocxTextResult {
  const first = blocks.findIndex((block) => block.text.trim().length > 0);
  if (first < 0) {
    return { text: "", headingStarts: [] };
  }
  let last = blocks.length - 1;
  while (last > first && !blocks[last]?.text.trim()) {
    last -= 1;
  }

  const selected = blocks.slice(first, last + 1);
  let offset = 0;
  const headingStarts: number[] = [];
  for (const [index, block] of selected.entries()) {
    if (block.heading && block.text.trim()) {
      headingStarts.push(offset);
    }
    offset += block.text.length + (index === selected.length - 1 ? 0 : 1);
  }
  return {
    text: selected.map((block) => block.text).join("\n"),
    headingStarts,
  };
}

function parseChapterNumbering(xml: string): Map<number, ChapterNumbering> {
  const parser = new SaxesParser({ xmlns: false, position: false });
  const abstractNumbers = new Map<
    number,
    { format: string; levelText: string; start: number } | undefined
  >();
  const result = new Map<number, ChapterNumbering>();
  let abstractNumId: number | undefined;
  let level = 0;
  let format = "decimal";
  let levelText = "";
  let start = 1;
  let numId: number | undefined;
  let mappedAbstractNumId: number | undefined;

  parser.on("doctype", () => {
    throw new DocxImportError("xml_declaration");
  });
  parser.on("opentag", (tag) => {
    const localName = localTagName(tag.name);
    if (localName === "abstractnum") {
      abstractNumId = numericAttribute(tag.attributes, "abstractnumid");
    } else if (localName === "lvl") {
      level = numericAttribute(tag.attributes, "ilvl") ?? 0;
      format = "decimal";
      levelText = "";
      start = 1;
    } else if (localName === "numfmt") {
      format = attributeValue(tag.attributes, "val") ?? "decimal";
    } else if (localName === "lvltext") {
      levelText = attributeValue(tag.attributes, "val") ?? "";
    } else if (localName === "start") {
      start = numericAttribute(tag.attributes, "val") ?? 1;
    } else if (localName === "num") {
      numId = numericAttribute(tag.attributes, "numid");
    } else if (localName === "abstractnumid") {
      mappedAbstractNumId = numericAttribute(tag.attributes, "val");
    }
  });
  parser.on("closetag", (tag) => {
    const localName = localTagName(tag.name);
    if (
      localName === "lvl" &&
      level === 0 &&
      abstractNumId !== undefined &&
      levelText.includes("%1")
    ) {
      abstractNumbers.set(abstractNumId, { format, levelText, start });
    } else if (localName === "abstractnum") {
      abstractNumId = undefined;
    } else if (localName === "num") {
      if (numId !== undefined && mappedAbstractNumId !== undefined) {
        const numbering = abstractNumbers.get(mappedAbstractNumId);
        if (numbering && numbering.levelText.includes("第") && numbering.levelText.includes("章")) {
          result.set(numId, numbering);
        }
      }
      numId = undefined;
      mappedAbstractNumId = undefined;
    }
  });
  parseRelationshipLikeXml(parser, xml);
  return result;
}

function applyChapterNumbering(input: {
  text: string;
  numId: number | undefined;
  level: number;
  numbering: Map<number, ChapterNumbering>;
  counters: Map<number, number>;
}): { text: string; heading: boolean } {
  if (input.numId === undefined || input.level !== 0) {
    return { text: input.text, heading: false };
  }
  const numbering = input.numbering.get(input.numId);
  if (!numbering) {
    return { text: input.text, heading: false };
  }
  const next = (input.counters.get(input.numId) ?? numbering.start - 1) + 1;
  input.counters.set(input.numId, next);
  const rendered = numbering.levelText.replace("%1", formatNumberingValue(next, numbering.format));
  if (input.text.trimStart().startsWith(rendered)) {
    return { text: input.text, heading: true };
  }
  return {
    text: `${rendered}${input.text.startsWith(" ") ? "" : " "}${input.text}`,
    heading: true,
  };
}

function formatNumberingValue(value: number, format: string): string {
  if (format === "ideographLegalTraditional") {
    return formatChineseNumber(value, true);
  }
  if (
    format === "chineseCounting" ||
    format === "chineseCountingThousand" ||
    format === "ideographTraditional" ||
    format === "taiwaneseCounting"
  ) {
    return formatChineseNumber(value, false);
  }
  return String(value);
}

function formatChineseNumber(value: number, legal: boolean): string {
  const digits = legal
    ? ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"]
    : ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  const units = legal ? ["", "拾", "佰", "仟"] : ["", "十", "百", "千"];
  if (value <= 0 || value >= 10_000) {
    return String(value);
  }
  if (!legal && value < 20) {
    return value < 10
      ? (digits[value] ?? String(value))
      : `十${value === 10 ? "" : digits[value - 10]}`;
  }

  const chars = String(value);
  let result = "";
  let pendingZero = false;
  for (const [index, char] of [...chars].entries()) {
    const digit = Number(char);
    const place = chars.length - index - 1;
    if (digit === 0) {
      if (result && place > 0) {
        pendingZero = true;
      }
      continue;
    }
    if (pendingZero) {
      result += "零";
      pendingZero = false;
    }
    if (!(!legal && digit === 1 && place === 1 && !result)) {
      result += digits[digit];
    }
    result += units[place];
  }
  return result || "零";
}

function hasMainDocumentContentType(xml: string): boolean {
  const parser = new SaxesParser({ xmlns: false, position: false });
  let found = false;
  parser.on("doctype", () => {
    throw new DocxImportError("xml_declaration");
  });
  parser.on("opentag", (tag) => {
    if (localTagName(tag.name) !== "override") {
      return;
    }
    const partName = attributeValue(tag.attributes, "partname");
    const contentType = attributeValue(tag.attributes, "contenttype");
    found =
      found ||
      (partName === "/word/document.xml" &&
        contentType ===
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
  });
  parseRelationshipLikeXml(parser, xml);
  return found;
}

function hasMainDocumentRelationship(xml: string): boolean {
  const parser = new SaxesParser({ xmlns: false, position: false });
  let found = false;
  parser.on("doctype", () => {
    throw new DocxImportError("xml_declaration");
  });
  parser.on("opentag", (tag) => {
    if (localTagName(tag.name) !== "relationship") {
      return;
    }
    const type = attributeValue(tag.attributes, "type");
    const target = attributeValue(tag.attributes, "target")?.replace(/^\/+/u, "");
    found = found || (type?.endsWith("/officeDocument") === true && target === "word/document.xml");
  });
  parseRelationshipLikeXml(parser, xml);
  return found;
}

function hasUnsafeExternalRelationship(xml: string): boolean {
  const parser = new SaxesParser({ xmlns: false, position: false });
  let unsafe = false;
  parser.on("doctype", () => {
    throw new DocxImportError("xml_declaration");
  });
  parser.on("opentag", (tag) => {
    if (localTagName(tag.name) !== "relationship") {
      return;
    }
    const targetMode = attributeValue(tag.attributes, "targetmode");
    const type = attributeValue(tag.attributes, "type");
    if (targetMode?.toLowerCase() === "external" && !type?.toLowerCase().endsWith("/hyperlink")) {
      unsafe = true;
    }
  });
  parseRelationshipLikeXml(parser, xml);
  return unsafe;
}

function isWordDocumentXml(xml: string): boolean {
  const parser = new SaxesParser({ xmlns: true, position: false });
  let depth = 0;
  let rootValid = false;
  let hasBody = false;
  parser.on("doctype", () => {
    throw new DocxImportError("xml_declaration");
  });
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth === 1) {
      rootValid = tag.local === "document" && WORD_PROCESSING_NAMESPACES.has(tag.uri);
    } else if (depth === 2 && tag.local === "body" && WORD_PROCESSING_NAMESPACES.has(tag.uri)) {
      hasBody = true;
    }
  });
  parser.on("closetag", () => {
    depth -= 1;
  });
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof DocxImportError) {
      throw error;
    }
    throw new DocxImportError("invalid");
  }
  return rootValid && hasBody;
}

function parseRelationshipLikeXml(parser: SaxesParser, xml: string): void {
  try {
    parser.write(xml).close();
  } catch (error) {
    if (error instanceof DocxImportError) {
      throw error;
    }
    throw new DocxImportError("invalid");
  }
}

function formatTableRow(cells: string[]): string {
  const nonEmpty = cells.filter((cell) => cell.trim().length > 0);
  if (nonEmpty.length <= 1) {
    return nonEmpty[0] ?? "";
  }
  return `${nonEmpty[0]}：${nonEmpty.slice(1).join("，")}`;
}

function appendToParagraph(paragraph: string[] | null, value: string): void {
  if (paragraph) {
    paragraph.push(value);
  }
}

function isHeadingStyleId(styleId: string): boolean {
  const normalized = styleId.trim().toLowerCase().replace(/\s+/gu, "");
  return /^(?:heading|标题)[1-6]$/u.test(normalized) || /^[1-6]$/u.test(normalized);
}

function attributeValue(
  attributes: Record<string, string> | Record<string, { value: string }>,
  localName: string,
): string | undefined {
  for (const [name, value] of Object.entries(attributes)) {
    if (localTagName(name) !== localName.toLowerCase()) {
      continue;
    }
    return typeof value === "string" ? value : value.value;
  }
  return undefined;
}

function numericAttribute(
  attributes: Record<string, string> | Record<string, { value: string }>,
  localName: string,
): number | undefined {
  const value = Number(attributeValue(attributes, localName));
  return Number.isInteger(value) ? value : undefined;
}

function localTagName(name: string): string {
  const separator = name.lastIndexOf(":");
  return (separator >= 0 ? name.slice(separator + 1) : name).toLowerCase();
}

function decodeXml(value: Uint8Array): string {
  const encoding = xmlEncoding(value);
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(value);
  } catch {
    throw new DocxImportError("invalid");
  }
}

function xmlEncoding(value: Uint8Array): "utf-8" | "utf-16le" | "utf-16be" {
  if (value[0] === 0xff && value[1] === 0xfe) {
    return "utf-16le";
  }
  if (value[0] === 0xfe && value[1] === 0xff) {
    return "utf-16be";
  }
  if (value[0] === 0x3c && value[1] === 0x00) {
    return "utf-16le";
  }
  if (value[0] === 0x00 && value[1] === 0x3c) {
    return "utf-16be";
  }
  const head = new TextDecoder("utf-8").decode(value.subarray(0, 256));
  const declared = /^<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/iu.exec(head)?.[1]?.toLowerCase();
  if (declared === "utf-16" || declared === "utf-16le") {
    return "utf-16le";
  }
  if (declared === "utf-16be") {
    return "utf-16be";
  }
  return "utf-8";
}

function isZip(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
      (buffer[2] === 0x05 && buffer[3] === 0x06) ||
      (buffer[2] === 0x07 && buffer[3] === 0x08))
  );
}

function hasPrefix(buffer: Buffer, prefix: readonly number[]): boolean {
  return buffer.length >= prefix.length && prefix.every((value, index) => buffer[index] === value);
}
