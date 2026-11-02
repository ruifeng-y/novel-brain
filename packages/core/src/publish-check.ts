import {
  DEFAULT_CHAPTER_TARGET_MAX,
  DEFAULT_CHAPTER_TARGET_MIN,
  countCjkCharacters,
  type PublishCheckInput,
  type PublishCheckResult,
} from '@novel/contracts';

export type {
  PublishCheckChapter,
  PublishCheckInput,
  PublishCheckItem,
  PublishCheckResult,
  PublishCheckStatus,
} from '@novel/contracts';

const SENSITIVE_TERMS: Array<{ category: string; terms: string[] }> = [
  {
    category: '违法与危险行为',
    terms: ['毒品', '吸毒', '贩毒', '枪支', '赌博', '诈骗教程'],
  },
  {
    category: '色情与未成年人保护',
    terms: ['未成年', '裸照', '性侵', '色情'],
  },
  {
    category: '暴力与伤害',
    terms: ['自杀', '自残', '虐待', '肢解', '虐杀'],
  },
  {
    category: '仇恨与歧视',
    terms: ['种族灭绝', '仇恨言论', '煽动仇恨'],
  },
];

const COPYRIGHT_MARKERS = ['改编自', '真实事件', '真人真事', '版权所有', '©', '歌词'];

const EXPORT_FORMAT_LABELS: Record<string, string> = {
  txt: 'TXT',
  markdown: 'Markdown',
  docx: 'Word 文档',
  epub: 'EPUB',
};

export function evaluatePublishCheck(input: PublishCheckInput): PublishCheckResult {
  const firstThree = input.chapters.slice(0, 3);
  const missingHooks = firstThree.filter((chapter) => !chapter.hook.trim());
  const hookNeedsReview = firstThree.length < 3 || missingHooks.length > 0;
  const lengthWarnings = input.chapters
    .filter((chapter) => chapter.content.trim().length > 0)
    .map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      wordCount: countCjkCharacters(chapter.content),
    }))
    .filter(
      (chapter) =>
        chapter.wordCount < DEFAULT_CHAPTER_TARGET_MIN ||
        chapter.wordCount > DEFAULT_CHAPTER_TARGET_MAX,
    );
  const sensitiveHits: Array<{
    chapterNumber: number;
    category: string;
    terms: string[];
  }> = [];
  for (const chapter of input.chapters) {
    for (const category of SENSITIVE_TERMS) {
      const matches = category.terms.filter((term) => chapter.content.includes(term));
      if (matches.length > 0) {
        sensitiveHits.push({
          chapterNumber: chapter.chapterNumber,
          category: category.category,
          terms: matches,
        });
      }
    }
  }
  const aiChapters = input.chapters.filter((chapter) => chapter.aiGenerated);
  const copyrightHits: Array<{ chapterNumber: number; markers: string[] }> = [];
  for (const chapter of input.chapters) {
    const markers = COPYRIGHT_MARKERS.filter(
      (marker) => chapter.content.includes(marker) || chapter.title.includes(marker),
    );
    if (markers.length > 0) {
      copyrightHits.push({ chapterNumber: chapter.chapterNumber, markers });
    }
  }
  const formatLabel = EXPORT_FORMAT_LABELS[input.format];
  return {
    checks: [
      {
        key: 'first_three_hooks',
        label: '前三章钩子',
        status: hookNeedsReview ? 'review' : 'pass',
        statusLabel: hookNeedsReview ? '需要确认' : '通过',
        summary:
          firstThree.length < 3
            ? firstThree.length === 0
              ? '前三章还没有正文。'
              : `只找到 ${firstThree.length} 章正文，第 ${firstThree.length + 1} 章还没有正文。`
            : missingHooks.length === 0
              ? '前三章都有章末钩子。'
              : `${missingHooks.map((chapter) => `第 ${chapter.chapterNumber} 章`).join('、')}还缺章末钩子。`,
        details: [],
      },
      {
        key: 'chapter_word_counts',
        label: '章节字数',
        status: lengthWarnings.length === 0 ? 'pass' : 'review',
        statusLabel: lengthWarnings.length === 0 ? '通过' : '需要确认',
        summary:
          lengthWarnings.length === 0
            ? `所有章节都在 ${DEFAULT_CHAPTER_TARGET_MIN.toLocaleString('zh-CN')}–${DEFAULT_CHAPTER_TARGET_MAX.toLocaleString('zh-CN')} 字的建议范围内。`
            : `${lengthWarnings
                .map((chapter) => `第 ${chapter.chapterNumber} 章 ${chapter.wordCount} 字`)
                .join(
                  '、',
                )}，建议控制在 ${DEFAULT_CHAPTER_TARGET_MIN.toLocaleString('zh-CN')}–${DEFAULT_CHAPTER_TARGET_MAX.toLocaleString('zh-CN')} 字。`,
        details: [],
      },
      {
        key: 'sensitive_content',
        label: '敏感内容',
        status: sensitiveHits.length === 0 ? 'pass' : 'review',
        statusLabel: sensitiveHits.length === 0 ? '通过' : '需要确认',
        summary:
          sensitiveHits.length === 0
            ? '未发现预设敏感词，仍需结合上下文人工确认。'
            : `${sensitiveHits
                .map(
                  (hit) =>
                    `第 ${hit.chapterNumber} 章涉及“${hit.category}”相关词（${hit.terms.join('、')}）`,
                )
                .join('；')}，需要结合上下文人工确认。`,
        details: ['自动检查只做提醒，不能代替对虚构语境、人物行为和平台规则的人工判断。'],
      },
      {
        key: 'ai_content_label',
        label: 'AI 内容标识',
        status: aiChapters.length === 0 ? 'pass' : 'review',
        statusLabel: aiChapters.length === 0 ? '通过' : '需要确认',
        summary:
          aiChapters.length === 0
            ? '当前正文未记录 AI 生成来源；如果使用过 AI 辅助，仍请按平台要求标注。'
            : `发现${aiChapters.map((chapter) => `第 ${chapter.chapterNumber} 章`).join('、')}使用了 AI 辅助生成。请在作品简介、作者的话或章节开头等可读位置标明：“本文使用 AI 辅助生成，经作者编辑、校对并承担内容责任。”`,
        details: ['标识需要读者和发布平台都能直接看到，只有隐藏属性或平台内部字段不算完成。'],
      },
      {
        key: 'copyright',
        label: '版权与原创性',
        status: copyrightHits.length === 0 ? 'pass' : 'review',
        statusLabel: copyrightHits.length === 0 ? '通过' : '需要确认',
        summary:
          copyrightHits.length === 0
            ? '未发现显式的真人真事、改编或歌词标记，仍请确认人物、地名、商标和情节没有未经授权地挪用。'
            : `${copyrightHits
                .map(
                  (hit) =>
                    `第 ${hit.chapterNumber} 章出现“${hit.markers.join('”“')}”等现实来源提示`,
                )
                .join('；')}，请确认授权范围和改编边界。`,
        details: ['使用真实人物、商标、歌词、影视角色或新闻事件时，需要自行确认授权与原创性。'],
      },
      {
        key: 'export_format',
        label: '导出格式',
        status: formatLabel ? 'pass' : 'block',
        statusLabel: formatLabel ? '通过' : '需要修改',
        summary: formatLabel
          ? `${formatLabel}，UTF-8 编码；V1 只导出文件，不会连接或上传到发布平台。`
          : '当前格式不在 V1 支持范围内，请改用 TXT、Markdown、Word 文档或 EPUB。',
        details: ['导出后请在发布平台再检查一次章节目录、段落间距和特殊符号。'],
      },
    ],
  };
}

export function renderPublishCheckReport(input: {
  title: string;
  generatedAt: string;
  result: PublishCheckResult;
}): string {
  const lines = [
    `# ${input.title} · 发布检查`,
    '',
    `生成时间：${input.generatedAt}`,
    '',
    '## 检查结果',
  ];
  for (const check of input.result.checks) {
    lines.push(
      `- [${check.status === 'pass' ? 'x' : ' '}] ${check.label}：${check.statusLabel}`,
      `  ${check.summary}`,
    );
    for (const detail of check.details) {
      lines.push(`  - ${detail}`);
    }
  }
  lines.push(
    '',
    '## 发布方式',
    '> V1 只导出文件，不会连接或上传到发布平台。',
    '> 导出后请自行检查目录、章节标题、段落间距和平台附加要求。',
    '',
  );
  return lines.join('\n');
}
