import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT_LABELS,
  EXPORT_PRESET_LABELS,
  createHistoricalVersionExportRequestSchema,
  createExportRequestSchema,
  createOutlineExportRequestSchema,
  exportPreviewRequestSchema,
} from './export';

describe('export API contract', () => {
  it('accepts every supported format and preset', () => {
    for (const format of ['txt', 'markdown', 'docx', 'epub'] as const) {
      const parsed = createExportRequestSchema.parse({
        format,
        scope: { type: 'book' },
        options: { preset: 'generic' },
      });
      expect(parsed.format).toBe(format);
    }

    for (const preset of ['generic', 'qidian', 'fanqie'] as const) {
      const parsed = createExportRequestSchema.parse({
        format: 'txt',
        scope: { type: 'book' },
        options: { preset },
      });
      expect(parsed.options.preset).toBe(preset);
    }
  });

  it('accepts current chapter, selected chapters, range, volume, and whole book scopes', () => {
    const scopes = [
      { type: 'chapter', chapterNumber: 3 },
      { type: 'chapters', chapterNumbers: [1, 3, 5] },
      { type: 'range', startChapter: 2, endChapter: 8 },
      { type: 'volume', volumeId: '11111111-1111-4111-8111-111111111111' },
      { type: 'book' },
    ];

    for (const scope of scopes) {
      expect(createExportRequestSchema.parse({ format: 'markdown', scope }).scope).toEqual(scope);
    }
  });

  it('rejects duplicate selections, reversed ranges, and empty selections', () => {
    expect(() =>
      createExportRequestSchema.parse({
        format: 'txt',
        scope: { type: 'chapters', chapterNumbers: [1, 1] },
      }),
    ).toThrow();
    expect(() =>
      createExportRequestSchema.parse({
        format: 'txt',
        scope: { type: 'chapters', chapterNumbers: [] },
      }),
    ).toThrow();
    expect(() =>
      createExportRequestSchema.parse({
        format: 'txt',
        scope: { type: 'range', startChapter: 9, endChapter: 2 },
      }),
    ).toThrow();
  });

  it('defaults previews to three chapters and caps the preview count', () => {
    expect(
      exportPreviewRequestSchema.parse({
        format: 'epub',
        scope: { type: 'book' },
      }).previewChapterCount,
    ).toBe(3);
    expect(() =>
      exportPreviewRequestSchema.parse({
        format: 'epub',
        scope: { type: 'book' },
        previewChapterCount: 6,
      }),
    ).toThrow();
  });

  it('keeps standalone outline and historical-version requests separate from manuscript exports', () => {
    expect(createOutlineExportRequestSchema.parse({ format: 'json' })).toEqual({
      format: 'json',
    });
    expect(createHistoricalVersionExportRequestSchema.parse({
      versionId: '11111111-1111-4111-8111-111111111111',
    })).toEqual({
      versionCommitId: '11111111-1111-4111-8111-111111111111',
    });
    expect(() =>
      createExportRequestSchema.parse({
        format: 'json',
        scope: { type: 'book' },
      }),
    ).toThrow();
  });

  it('uses author-facing Chinese labels without implementation terms', () => {
    expect(EXPORT_FORMAT_LABELS).toEqual({
      txt: 'TXT',
      markdown: 'Markdown',
      docx: 'Word 文档',
      epub: 'EPUB 电子书',
      json: 'JSON 文件',
      zip: 'ZIP 压缩包',
    });
    expect(EXPORT_PRESET_LABELS).toEqual({
      generic: '通用网文',
      qidian: '起点',
      fanqie: '番茄',
    });
  });
});
