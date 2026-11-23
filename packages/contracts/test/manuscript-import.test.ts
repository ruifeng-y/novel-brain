import { describe, expect, it } from "vitest";

import { manuscriptImportFormatSchema, manuscriptImportResponseSchema } from "../src";

describe("manuscript import contracts", () => {
  it("accepts TXT, Markdown and DOCX previews without changing chapter traceability fields", () => {
    expect(manuscriptImportFormatSchema.options).toEqual(["txt", "markdown", "docx"]);

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
  });

  it("rejects unsupported import formats", () => {
    expect(() => manuscriptImportFormatSchema.parse("pdf")).toThrow();
  });
});
