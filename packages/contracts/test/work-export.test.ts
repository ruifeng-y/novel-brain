import { describe, expect, it } from "vitest";

import { EXPORT_FORMATS, workExportRequestSchema, workExportScopeSchema } from "../src";

describe("work export contracts", () => {
  it("accepts the four author export formats", () => {
    expect(EXPORT_FORMATS).toEqual(["txt", "markdown", "docx", "epub"]);
  });

  it("accepts chapter, selected chapter, range, volume and book scopes", () => {
    expect(
      [
        { kind: "current_chapter", chapterId: "01910000-0000-7000-8000-000000000001" },
        {
          kind: "selected_chapters",
          chapterIds: [
            "01910000-0000-7000-8000-000000000001",
            "01910000-0000-7000-8000-000000000002",
          ],
        },
        { kind: "chapter_range", fromChapter: 1, toChapter: 3 },
        { kind: "volume", volumeNodeId: "01910000-0000-7000-8000-000000000003" },
        { kind: "book" },
      ].map((scope) => workExportScopeSchema.parse(scope)),
    ).toHaveLength(5);
  });

  it("rejects unsupported formats and ambiguous or duplicate scopes", () => {
    expect(() =>
      workExportRequestSchema.parse({
        format: "pdf",
        scope: { kind: "book" },
      }),
    ).toThrow();
    expect(() =>
      workExportRequestSchema.parse({
        format: "txt",
        scope: {
          kind: "selected_chapters",
          chapterIds: [
            "01910000-0000-7000-8000-000000000001",
            "01910000-0000-7000-8000-000000000001",
          ],
        },
      }),
    ).toThrow(/unique/i);
    expect(() =>
      workExportRequestSchema.parse({
        format: "txt",
        scope: {
          kind: "chapter_range",
          fromChapter: 5,
          toChapter: 2,
        },
      }),
    ).toThrow(/fromChapter/i);
  });
});
