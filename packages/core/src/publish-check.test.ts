import { describe, expect, it } from 'vitest';
import { evaluatePublishCheck, renderPublishCheckReport } from './publish-check';

const chapters = [
  {
    chapterNumber: 1,
    title: '断碑',
    content: '沈砚听见剑鸣。',
    hook: '黑暗里有人叫出了母亲的名字。',
    aiGenerated: false,
  },
  {
    chapterNumber: 2,
    title: '旧城门',
    content: '城门下站着一个陌生人。',
    hook: '',
    aiGenerated: false,
  },
  {
    chapterNumber: 3,
    title: '剑鸣',
    content: '残剑在雨里醒来。',
    hook: '陌生人袖口露出焚毁的家纹。',
    aiGenerated: false,
  },
];

describe('publish checks', () => {
  it('flags a missing hook in the first three chapters', () => {
    const result = evaluatePublishCheck({ format: 'txt', chapters });
    const check = result.checks.find((item) => item.key === 'first_three_hooks');

    expect(check).toMatchObject({
      status: 'review',
      label: '前三章钩子',
      summary: '第 2 章还缺章末钩子。',
    });
  });

  it('does not pass the hook check before three chapters have prose', () => {
    const result = evaluatePublishCheck({
      format: 'txt',
      chapters: chapters.slice(0, 2),
    });
    const check = result.checks.find((item) => item.key === 'first_three_hooks');

    expect(check).toMatchObject({
      status: 'review',
      summary: '只找到 2 章正文，第 3 章还没有正文。',
    });
  });

  it('reports chapter lengths outside the publishing range', () => {
    const result = evaluatePublishCheck({ format: 'txt', chapters });
    const check = result.checks.find((item) => item.key === 'chapter_word_counts');

    expect(check).toMatchObject({
      status: 'review',
      label: '章节字数',
    });
    expect(check?.summary).toContain('第 1 章 6 字');
    expect(check?.summary).toContain('2,000–3,000 字');
  });

  it('does not count planned chapters that do not have prose yet', () => {
    const result = evaluatePublishCheck({
      format: 'txt',
      chapters: [
        chapters[0],
        {
          chapterNumber: 2,
          title: '旧城门',
          content: '',
          hook: '陌生人袖口露出焚毁的家纹。',
          aiGenerated: false,
        },
        chapters[2],
      ],
    });
    const check = result.checks.find((item) => item.key === 'chapter_word_counts');

    expect(check?.summary).not.toContain('第 2 章 0 字');
  });

  it('points sensitive wording back to its chapter without treating it as a verdict', () => {
    const result = evaluatePublishCheck({
      format: 'txt',
      chapters: [
        {
          chapterNumber: 1,
          title: '暗巷',
          content: '他把毒品藏进袖中。',
          hook: '巷口传来脚步声。',
          aiGenerated: false,
        },
      ],
    });
    const check = result.checks.find((item) => item.key === 'sensitive_content');

    expect(check).toMatchObject({
      status: 'review',
      label: '敏感内容',
    });
    expect(check?.summary).toContain('第 1 章');
    expect(check?.summary).toContain('违法与危险行为');
  });

  it('requires a visible AI-content label when generated prose is present', () => {
    const result = evaluatePublishCheck({
      format: 'txt',
      chapters: [
        {
          chapterNumber: 1,
          title: '断碑',
          content: '沈砚听见剑鸣。',
          hook: '黑暗里有人叫出了母亲的名字。',
          aiGenerated: true,
        },
      ],
    });
    const check = result.checks.find((item) => item.key === 'ai_content_label');

    expect(check).toMatchObject({
      status: 'review',
      label: 'AI 内容标识',
    });
    expect(check?.summary).toContain('本文使用 AI 辅助生成');
  });

  it('reminds the author to verify copyright when real-world source markers appear', () => {
    const result = evaluatePublishCheck({
      format: 'txt',
      chapters: [
        {
          chapterNumber: 1,
          title: '旧城往事',
          content: '本故事改编自真实事件，并引用了一首旧歌词。',
          hook: '旧唱片在半夜自己转了起来。',
          aiGenerated: false,
        },
      ],
    });
    const check = result.checks.find((item) => item.key === 'copyright');

    expect(check).toMatchObject({
      status: 'review',
      label: '版权与原创性',
    });
    expect(check?.summary).toContain('改编自');
    expect(check?.summary).toContain('歌词');
  });

  it('confirms the supported export format and keeps V1 export-only', () => {
    const result = evaluatePublishCheck({ format: 'epub', chapters });
    const check = result.checks.find((item) => item.key === 'export_format');

    expect(check).toMatchObject({
      status: 'pass',
      label: '导出格式',
    });
    expect(check?.summary).toContain('EPUB');
    expect(check?.summary).toContain('V1 只导出文件，不会连接或上传到发布平台');
  });

  it('renders a report the author can copy or download', () => {
    const result = evaluatePublishCheck({ format: 'txt', chapters });
    const report = renderPublishCheckReport({
      title: '天门残卷',
      generatedAt: '2026-11-02T12:00:00.000Z',
      result,
    });

    expect(report).toContain('# 天门残卷 · 发布检查');
    expect(report).toContain('- [ ] 前三章钩子：需要确认');
    expect(report).toContain('> V1 只导出文件，不会连接或上传到发布平台。');
  });
});
