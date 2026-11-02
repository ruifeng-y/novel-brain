import { describe, expect, it } from 'vitest';
import { chapterOptionsFromOutlines } from './batch-jobs-api';

describe('batch chapter options', () => {
  it('lists chapter outlines even when no chapter has been generated yet', () => {
    expect(
      chapterOptionsFromOutlines([
        { level: 'book', chapterNumber: null, title: '全书' },
        { level: 'chapter', chapterNumber: 2, title: '第二章 天门' },
        { level: 'scene', chapterNumber: null, title: '场景' },
        { level: 'chapter', chapterNumber: 1, title: '第一章 断碑' },
      ]),
    ).toEqual([
      { chapterNumber: 1, title: '第一章 断碑' },
      { chapterNumber: 2, title: '第二章 天门' },
    ]);
  });
});
