import { describe, expect, it } from 'vitest';
import {
  PUBLISH_CHECK_STATUS_LABELS,
  publishCheckRequestSchema,
  publishSuggestionsSchema,
} from './publish';

describe('publish assistance contracts', () => {
  it('accepts complete title, synopsis, tag, and chapter-title suggestions', () => {
    const parsed = publishSuggestionsSchema.parse({
      titles: ['断碑问心', '雨夜残剑'],
      synopsis: '沈砚以记忆为代价追查母亲失踪的真相。',
      tags: ['仙侠', '成长', '悬疑'],
      chapterTitles: [{ chapterNumber: 1, title: '断碑夜雨' }],
    });

    expect(parsed.titles).toEqual(['断碑问心', '雨夜残剑']);
    expect(parsed.tags).toEqual(['仙侠', '成长', '悬疑']);
    expect(parsed.chapterTitles[0].chapterNumber).toBe(1);
  });

  it('rejects suggestions without a synopsis or tags', () => {
    expect(() =>
      publishSuggestionsSchema.parse({
        titles: ['断碑问心'],
        synopsis: '',
        tags: [],
        chapterTitles: [],
      }),
    ).toThrow();
  });

  it('accepts supported export formats and exposes author-facing status labels', () => {
    expect(publishCheckRequestSchema.parse({ format: 'epub' }).format).toBe('epub');
    expect(() => publishCheckRequestSchema.parse({ format: 'pdf' })).toThrow();
    expect(PUBLISH_CHECK_STATUS_LABELS).toEqual({
      pass: '通过',
      review: '需要确认',
      block: '需要修改',
    });
  });
});
