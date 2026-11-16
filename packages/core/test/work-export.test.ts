import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { buildWorkExportArtifact } from "../src";

const work = {
  id: "01910000-0000-7000-8000-000000000001",
  title: "山海照夜",
  penName: "墨舟",
  genre: "xianxia" as const,
};
const branch = {
  id: "01910000-0000-7000-8000-000000000002",
  name: "主线",
};
const chapters = [
  {
    chapterId: "01910000-0000-7000-8000-000000000011",
    chapterNumber: 2,
    title: "第二更",
    chapterVersionId: "01910000-0000-7000-8000-000000000021",
    versionNodeId: "01910000-0000-7000-8000-000000000031",
    content: "钟声未响。\n\n她看见 Dragon、龙与 𠮷。",
    volumeNodeId: "01910000-0000-7000-8000-000000000041",
    volumeNumber: 1,
    volumeTitle: "入山",
  },
  {
    chapterId: "01910000-0000-7000-8000-000000000012",
    chapterNumber: 1,
    title: "第一更",
    chapterVersionId: "01910000-0000-7000-8000-000000000022",
    versionNodeId: "01910000-0000-7000-8000-000000000032",
    content: "风停了。",
    volumeNodeId: "01910000-0000-7000-8000-000000000041",
    volumeNumber: 1,
    volumeTitle: "入山",
  },
] as const;

describe("work export artifact", () => {
  it("builds a deterministic manifest and ordered UTF-8 text export", () => {
    const request = {
      format: "txt" as const,
      scope: { kind: "book" as const },
      sourceVersionNodeId: null,
      options: {
        includeStoryBible: false,
        includeSettingsAppendix: false,
        includeOutline: false,
        includeForeshadowLedger: false,
        includeChangeHistory: false,
        preset: "generic" as const,
        chapterTitleFormat: "第{number}章 {title}",
        volumeTitleFormat: "第{number}卷 {title}",
        paragraphBlankLine: true,
        firstLineIndent: false,
        encoding: "utf-8" as const,
      },
    };
    const input = {
      work,
      branch,
      resolvedVersionNodeId: "01910000-0000-7000-8000-000000000099",
      request,
      chapters: [...chapters],
      supplements: [],
    };

    const first = buildWorkExportArtifact(input);
    const second = buildWorkExportArtifact(input);

    expect(first.manifest.manifestHash).toBe(second.manifest.manifestHash);
    expect(first.checksum).toBe(second.checksum);
    expect(first.manifest.chapters.map((chapter) => chapter.chapterNumber)).toEqual([1, 2]);
    expect(first.manifest.characterCount).toBe(
      chapters.reduce((total, chapter) => total + [...chapter.content].length, 0),
    );
    expect(first.contentType).toBe("text/plain; charset=utf-8");

    const text = new TextDecoder().decode(first.bytes);
    expect(text).toContain("《山海照夜》");
    expect(text.indexOf("第1章 第一更")).toBeLessThan(text.indexOf("第2章 第二更"));
    expect(text).toContain("Dragon、龙与 𠮷");
    expect(text).toContain(first.manifest.manifestHash);
    expect(text).toContain("版本清单");
  });

  it("renders Markdown with stable chapter headings and a version manifest appendix", () => {
    const artifact = buildWorkExportArtifact({
      work,
      branch,
      resolvedVersionNodeId: "01910000-0000-7000-8000-000000000099",
      request: {
        format: "markdown",
        scope: { kind: "chapter_range", fromChapter: 1, toChapter: 2 },
        sourceVersionNodeId: "01910000-0000-7000-8000-000000000098",
        options: {
          includeStoryBible: false,
          includeSettingsAppendix: false,
          includeOutline: false,
          includeForeshadowLedger: false,
          includeChangeHistory: false,
          preset: "qidian",
          chapterTitleFormat: "第{number}章 {title}",
          volumeTitleFormat: "第{number}卷 {title}",
          paragraphBlankLine: true,
          firstLineIndent: false,
          encoding: "utf-8",
        },
      },
      chapters: [...chapters],
      supplements: [],
    });

    expect(artifact.contentType).toBe("text/markdown; charset=utf-8");
    const markdown = new TextDecoder().decode(artifact.bytes);
    expect(markdown).toMatch(/^# 山海照夜/m);
    expect(markdown).toContain("## 第1章 第一更");
    expect(markdown).toContain("## 第2章 第二更");
    expect(markdown).toContain("## 版本清单");
    expect(markdown).toContain("01910000-0000-7000-8000-000000000098");
  });

  it("renders deterministic DOCX and EPUB containers with escaped XML and manifests", () => {
    const docxInput = exportInput("docx", "风<雨>&钟声");
    const firstDocx = buildWorkExportArtifact(docxInput);
    const secondDocx = buildWorkExportArtifact(docxInput);
    expect(firstDocx.bytes).toEqual(secondDocx.bytes);

    const docxEntries = readZipEntries(firstDocx.bytes);
    expect(docxEntries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "word/document.xml",
        "customXml/version-manifest.json",
      ]),
    );
    const documentXml = new TextDecoder().decode(
      docxEntries.find((entry) => entry.name === "word/document.xml")?.data,
    );
    expect(documentXml).toContain("风&lt;雨&gt;&amp;钟声");
    expect(documentXml).not.toContain("风<雨>&钟声");

    const epub = buildWorkExportArtifact(exportInput("epub", "第一段。\n\n第二段。"));
    expect(epub.contentType).toBe("application/epub+zip");
    const epubEntries = readZipEntries(epub.bytes);
    expect(epubEntries[0]).toMatchObject({ name: "mimetype", method: 0 });
    expect(new TextDecoder().decode(epubEntries[0]?.data)).toBe("application/epub+zip");
    expect(epubEntries.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([
        "META-INF/container.xml",
        "OEBPS/content.opf",
        "OEBPS/text.xhtml",
        "OEBPS/version-manifest.json",
      ]),
    );
    const xhtml = new TextDecoder().decode(
      epubEntries.find((entry) => entry.name === "OEBPS/text.xhtml")?.data,
    );
    const packageDocument = new TextDecoder().decode(
      epubEntries.find((entry) => entry.name === "OEBPS/content.opf")?.data,
    );
    expect(xhtml).toContain("第一段。");
    expect(xhtml).toContain("第二段。");
    expect(xhtml).toContain(epub.manifest.manifestHash);
    expect(packageDocument).toContain('properties="nav"');
  });

  it("applies volume titles, paragraph spacing and first-line indentation to DOCX and EPUB", () => {
    const options = {
      ...exportInput("docx", "第一段。\n第二段。").request.options,
      volumeTitleFormat: "卷{number}·{title}",
      paragraphBlankLine: false,
      firstLineIndent: true,
    };
    const docx = buildWorkExportArtifact({
      ...exportInput("docx", "第一段。\n第二段。"),
      request: {
        ...exportInput("docx", "第一段。\n第二段。").request,
        options,
      },
    });
    const docxXml = new TextDecoder().decode(
      readZipEntries(docx.bytes).find((entry) => entry.name === "word/document.xml")?.data,
    );
    expect(docxXml).toContain("卷1·入山");
    expect(docxXml).toContain('<w:ind w:firstLine="480"/>');
    expect(docxXml).toContain("第一段。");
    expect(docxXml.indexOf("第一段。")).toBeLessThan(docxXml.indexOf("第二段。"));

    const epub = buildWorkExportArtifact({
      ...exportInput("epub", "第一段。\n第二段。"),
      request: {
        ...exportInput("epub", "第一段。\n第二段。").request,
        options,
      },
    });
    const xhtml = new TextDecoder().decode(
      readZipEntries(epub.bytes).find((entry) => entry.name === "OEBPS/text.xhtml")?.data,
    );
    expect(xhtml).toContain('class="volume">卷1·入山');
    expect(xhtml).toContain('class="paragraph compact indent">第一段。');
  });

  it("handles a large manuscript without changing character accounting", () => {
    const content = "龙".repeat(1_200_000);
    const artifact = buildWorkExportArtifact(exportInput("txt", content));
    expect(artifact.manifest.characterCount).toBe(1_200_000);
    expect(artifact.bytes.byteLength).toBeGreaterThan(1_200_000);
    expect(artifact.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("packages large DOCX and EPUB manuscripts deterministically", () => {
    const content = "龙".repeat(190_000);
    for (const format of ["docx", "epub"] as const) {
      const first = buildWorkExportArtifact(exportInput(format, content));
      const second = buildWorkExportArtifact(exportInput(format, content));
      expect(first.manifest.characterCount).toBe(190_000);
      expect(first.bytes.byteLength).toBeGreaterThan(1_000);
      expect(first.bytes).toEqual(second.bytes);
      expect(first.checksum).toBe(second.checksum);
    }
  });
});

function exportInput(format: "txt" | "markdown" | "docx" | "epub", content: string) {
  return {
    work,
    branch,
    resolvedVersionNodeId: "01910000-0000-7000-8000-000000000099",
    request: {
      format,
      scope: { kind: "book" as const },
      sourceVersionNodeId: null,
      options: {
        includeStoryBible: false,
        includeSettingsAppendix: false,
        includeOutline: false,
        includeForeshadowLedger: false,
        includeChangeHistory: false,
        preset: "generic" as const,
        chapterTitleFormat: "第{number}章 {title}",
        volumeTitleFormat: "第{number}卷 {title}",
        paragraphBlankLine: true,
        firstLineIndent: false,
        encoding: "utf-8" as const,
      },
    },
    chapters: [
      {
        ...chapters[1],
        content,
      },
    ],
    supplements: [],
  };
}

function readZipEntries(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const eocd = findSignatureFromEnd(buffer, 0x06054b50);
  if (eocd < 0) {
    throw new Error("ZIP end-of-central-directory record is missing");
  }
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let centralOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("ZIP central-directory entry is invalid");
    }
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const name = buffer
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.push({
      name,
      method,
      data: method === 0 ? compressed : inflateRawSync(compressed),
    });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findSignatureFromEnd(buffer: Buffer, signature: number): number {
  for (
    let offset = buffer.length - 22;
    offset >= Math.max(0, buffer.length - 65_557);
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  return -1;
}
