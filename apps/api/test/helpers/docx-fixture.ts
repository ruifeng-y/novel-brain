import { strToU8, zipSync } from "fflate";

interface DocxFixtureOptions {
  paragraphs?: string[];
  styledParagraphs?: Array<{ text: string; headingLevel?: number; outlineLevel?: number }>;
  tableRows?: string[][];
  documentXml?: string;
  relationshipsXml?: string;
  extraEntries?: Record<string, Uint8Array>;
  omitContentTypes?: boolean;
  omitPackageRelationships?: boolean;
}

const CONTENT_TYPES = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
  '<Default Extension="xml" ContentType="application/xml"/>',
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
  "</Types>",
].join("");

const PACKAGE_RELATIONSHIPS = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
  "</Relationships>",
].join("");

export function buildDocxFixture(options: DocxFixtureOptions = {}): Buffer {
  const documentXml =
    options.documentXml ??
    [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      "<w:body>",
      ...(options.paragraphs ?? []).map((paragraph) => paragraphXml(paragraph)),
      ...(options.styledParagraphs ?? []).map((paragraph) =>
        paragraphXml(paragraph.text, paragraph.headingLevel, paragraph.outlineLevel),
      ),
      ...(options.tableRows ?? []).map((row) => tableXml(row)),
      "<w:sectPr/>",
      "</w:body>",
      "</w:document>",
    ].join("");

  const entries: Record<string, Uint8Array> = {
    ...(options.omitContentTypes ? {} : { "[Content_Types].xml": strToU8(CONTENT_TYPES) }),
    ...(options.omitPackageRelationships ? {} : { "_rels/.rels": strToU8(PACKAGE_RELATIONSHIPS) }),
    "word/document.xml": strToU8(documentXml),
    ...(options.extraEntries ?? {}),
  };
  if (options.relationshipsXml) {
    entries["word/_rels/document.xml.rels"] = strToU8(options.relationshipsXml);
  }
  return Buffer.from(zipSync(entries, { level: 6, mtime: new Date("2020-01-01T00:00:00Z") }));
}

export function encryptedDocxFixture(): Buffer {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
}

function paragraphXml(text: string, headingLevel?: number, outlineLevel?: number): string {
  const style = headingLevel === undefined ? "" : `<w:pStyle w:val="Heading${headingLevel}"/>`;
  const outline = outlineLevel === undefined ? "" : `<w:outlineLvl w:val="${outlineLevel}"/>`;
  const properties = style || outline ? `<w:pPr>${style}${outline}</w:pPr>` : "";
  return `<w:p>${properties}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function tableXml(row: string[]): string {
  return `<w:tbl><w:tr>${row
    .map(
      (cell) =>
        `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`,
    )
    .join("")}</w:tr></w:tbl>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
