import { describe, expect, it } from "vitest";

import {
  IMPORT_FILE_LIMITS,
  chunkedImportProgressResponseSchema,
  chunkedManuscriptImportConfirmRequestSchema,
  manuscriptImportFormatSchema,
  manuscriptImportResponseSchema,
} from "../src";

describe("manuscript import contracts", () => {
  it("accepts TXT, Markdown and DOCX previews without changing chapter traceability fields", () => {
    expect(manuscriptImportFormatSchema.options).toEqual(["txt", "markdown", "docx"]);
    expect(IMPORT_FILE_LIMITS.manuscript.maxFileBytes).toBe(1024 * 1024);
    expect(IMPORT_FILE_LIMITS.settings.maxFileBytes).toBe(256 * 1024);

    const parsed = manuscriptImportResponseSchema.parse({
      data: {
        id: "01910000-0000-7000-8000-000000000001",
        status: "ready",
        sourceName: "旧稿.docx",
        format: "docx",
        chapters: [
          {
            order: 1,
            title: "第一章 断碑夜雨",
            content: "第一章 断碑夜雨\n雨落在断碑上。",
            wordCount: 14,
            sourceRange: { start: 0, end: 15 },
          },
        ],
        warnings: [],
        canConfirm: true,
        confirmedWorkId: null,
        createdAt: "2026-11-23T00:00:00.000Z",
      },
      requestId: "req_contract_docx",
      meta: {},
    });

    expect(parsed.data.format).toBe("docx");
    expect(parsed.data.chapters[0]?.content).toContain("雨落在断碑上。");
    expect(parsed.data.chapters[0]?.sourceRange).toEqual({ start: 0, end: 15 });
  });

  it("rejects unsupported import formats", () => {
    expect(() => manuscriptImportFormatSchema.parse("pdf")).toThrow();
  });

  it("accepts chunked progress and range-based confirmation without source text", () => {
    const progress = chunkedImportProgressResponseSchema.parse({
      data: {
        importId: "01910000-0000-7000-8000-000000000002",
        status: "processing",
        chunkCount: 40,
        uploadedChunks: 40,
        processedChunks: 12,
        canConfirm: false,
      },
      requestId: "req_chunked_progress",
      meta: {},
    });
    expect(progress.data.uploadedChunks).toBe(40);

    const request = chunkedManuscriptImportConfirmRequestSchema.parse({
      title: "分块旧稿",
      chapters: [
        { title: "第一章", sourceRange: { start: 0, end: 10_000 } },
        { title: "第二章", sourceRange: { start: 10_000, end: 20_000 } },
      ],
    });
    expect(request.chapters.map((chapter) => chapter.sourceRange.end)).toEqual([10_000, 20_000]);
  });

  it("accepts the frozen 4000-chapter V1 baseline and rejects one chapter beyond it", () => {
    const chapters = Array.from({ length: 4_000 }, (_, index) => ({
      title: `第${index + 1}章`,
      sourceRange: { start: index * 2_500, end: (index + 1) * 2_500 },
    }));

    expect(() =>
      chunkedManuscriptImportConfirmRequestSchema.parse({
        title: "千万字旧稿",
        chapters,
      }),
    ).not.toThrow();
    expect(() =>
      chunkedManuscriptImportConfirmRequestSchema.parse({
        title: "超出基线",
        chapters: [
          ...chapters,
          { title: "第4001章", sourceRange: { start: 10_000_000, end: 10_002_500 } },
        ],
      }),
    ).toThrow();
  });
});
