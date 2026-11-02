import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  buildHistoricalVersionExport,
  renderOutlineExport,
  type HistoricalVersionExportInput,
  type OutlineExportNode,
} from './outline-export';

const nodes: OutlineExportNode[] = [
  {
    id: 'chapter-2',
    parentId: 'act-1',
    level: 'chapter',
    orderIndex: 1,
    title: '旧城门',
    summary: '城门下出现陌生人。',
    details: '',
    chapterNumber: 2,
    chapterGoal: '让沈砚第一次怀疑旧信。',
    pov: '沈砚',
    sceneBeats: ['陌生人递信', '旧城门失火'],
    chapterEndHook: '信封上写着母亲的名字。',
    locked: false,
    version: 2,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
  },
  {
    id: 'book',
    parentId: null,
    level: 'book',
    orderIndex: 0,
    title: '天门残卷',
    summary: '少年以残剑追查母亲旧事。',
    details: '全书围绕记忆代价推进。',
    chapterNumber: null,
    chapterGoal: '',
    pov: '',
    sceneBeats: [],
    chapterEndHook: '',
    locked: true,
    version: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
  {
    id: 'volume-1',
    parentId: 'book',
    level: 'volume',
    orderIndex: 0,
    title: '第一卷 天门初开',
    summary: '边城断碑。',
    details: '',
    chapterNumber: null,
    chapterGoal: '',
    pov: '',
    sceneBeats: [],
    chapterEndHook: '',
    locked: false,
    version: 1,
    createdAt: '2026-01-01T00:01:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
  },
  {
    id: 'chapter-1',
    parentId: 'act-1',
    level: 'chapter',
    orderIndex: 0,
    title: '断碑',
    summary: '沈砚在荒寺听见剑鸣。',
    details: '雨夜。',
    chapterNumber: 1,
    chapterGoal: '引出残剑。',
    pov: '沈砚',
    sceneBeats: ['荒寺避雨', '断碑剑鸣'],
    chapterEndHook: '残剑认主。',
    locked: false,
    version: 1,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 'act-1',
    parentId: 'volume-1',
    level: 'act',
    orderIndex: 0,
    title: '第一幕 断碑雨夜',
    summary: '雨夜触发断碑。',
    details: '',
    chapterNumber: null,
    chapterGoal: '',
    pov: '',
    sceneBeats: [],
    chapterEndHook: '',
    locked: false,
    version: 1,
    createdAt: '2026-01-01T00:02:00.000Z',
    updatedAt: '2026-01-01T00:02:00.000Z',
  },
];

const outlineInput = {
  work: { id: 'work-1', title: '天门残卷' },
  branch: { id: 'branch-1', name: '主线' },
  exportedAt: new Date('2026-11-03T08:00:00.000Z'),
  nodes,
};

describe('standalone outline export', () => {
  it('renders Markdown in outline order with chapter planning fields', async () => {
    const file = await renderOutlineExport(outlineInput, 'markdown');
    const markdown = file.data.toString('utf8');

    expect(file.extension).toBe('md');
    expect(file.mimeType).toBe('text/markdown; charset=utf-8');
    expect(markdown).toContain('# 天门残卷 · 大纲');
    expect(markdown).toContain('## 第一卷 天门初开');
    expect(markdown).toContain('### 第一幕 断碑雨夜');
    expect(markdown.indexOf('#### 第 1 章 断碑')).toBeLessThan(
      markdown.indexOf('#### 第 2 章 旧城门'),
    );
    expect(markdown).toContain('**章目标**：引出残剑。');
    expect(markdown).toContain('**叙事视角**：沈砚');
    expect(markdown).toContain('- 荒寺避雨');
    expect(markdown).toContain('**章末钩子**：残剑认主。');
    expect(markdown).toContain('已锁定');
  });

  it('renders a nested JSON document that preserves every outline node once', async () => {
    const file = await renderOutlineExport(outlineInput, 'json');
    const document = JSON.parse(file.data.toString('utf8')) as {
      exportVersion: number;
      work: { title: string };
      branch: { name: string };
      counts: Record<string, number>;
      outline: Array<{
        title: string;
        children: Array<{
          title: string;
          children: Array<{
            title: string;
            children: Array<{
              title: string;
              chapterNumber: number;
              sceneBeats: string[];
            }>;
          }>;
        }>;
      }>;
    };

    expect(file.extension).toBe('json');
    expect(file.mimeType).toBe('application/json; charset=utf-8');
    expect(document).toMatchObject({
      exportVersion: 1,
      work: { title: '天门残卷' },
      branch: { name: '主线' },
      counts: { total: 5, book: 1, volume: 1, act: 1, chapter: 2, scene: 0 },
    });
    expect(document.outline).toHaveLength(1);
    expect(document.outline[0].title).toBe('天门残卷');
    expect(document.outline[0].children[0].title).toBe('第一卷 天门初开');
    expect(document.outline[0].children[0].children[0].title).toBe('第一幕 断碑雨夜');
    expect(
      document.outline[0].children[0].children[0].children.map((chapter) => chapter.title),
    ).toEqual(['断碑', '旧城门']);
    expect(document.outline[0].children[0].children[0].children[1].chapterNumber).toBe(2);
    expect(document.outline[0].children[0].children[0].children[0].sceneBeats).toEqual([
      '荒寺避雨',
      '断碑剑鸣',
    ]);
  });
});

describe('historical version export', () => {
  const historical: HistoricalVersionExportInput = {
    work: { id: 'work-1', title: '天门残卷' },
    branch: { id: 'branch-1', name: '主线' },
    generatedAt: new Date('2026-11-03T08:00:00.000Z'),
    version: {
      id: 'commit-2',
      kind: 'chapter_version',
      kindLabel: '正文版本',
      title: '第 1 章 · 断碑 · 版本 1',
      reason: '保存第一版断碑。',
      parentVersionId: 'commit-1',
      createdAt: '2026-11-02T08:00:00.000Z',
    },
    versions: [
      {
        id: 'commit-2',
        kind: 'chapter_version',
        kindLabel: '正文版本',
        title: '第 1 章 · 断碑 · 版本 1',
        reason: '保存第一版断碑。',
        createdAt: '2026-11-02T08:00:00.000Z',
      },
      {
        id: 'commit-1',
        kind: 'edit',
        kindLabel: '内容修改',
        title: '添加设定',
        reason: '补上临渊城。',
        createdAt: '2026-11-01T08:00:00.000Z',
      },
    ],
    outline: nodes,
    chapters: [
      {
        chapterNumber: 1,
        title: '断碑',
        content: '沈砚听见剑鸣。',
        volumeTitle: '第一卷 天门初开',
      },
    ],
    data: {
      'story-bible': { protagonist: '沈砚' },
      entities: [{ name: '临渊城', summary: '东荒边境的小城。' }],
    },
  };

  it('packages the selected version with a checksummed manifest and version list', async () => {
    const archive = await buildHistoricalVersionExport(historical);
    const zip = await JSZip.loadAsync(archive.data);
    const manifest = JSON.parse(
      (await zip.file('manifest.json')?.async('string')) ?? '{}',
    ) as {
      exportVersion: number;
      work: { title: string };
      version: { id: string; title: string };
      counts: Record<string, number>;
      files: Array<{ path: string; size: number; sha256: string }>;
    };

    expect(archive.extension).toBe('zip');
    expect(archive.mimeType).toBe('application/zip');
    expect(manifest).toMatchObject({
      exportVersion: 1,
      work: { title: '天门残卷' },
      version: { id: 'commit-2', title: '第 1 章 · 断碑 · 版本 1' },
      counts: { chapters: 1, outlineNodes: 5, versions: 2 },
    });
    expect(zip.file('outline.json')).not.toBeNull();
    expect(zip.file('outline.md')).not.toBeNull();
    expect(zip.file('manuscript.md')).not.toBeNull();
    expect(zip.file('chapters/chapter-0001.md')).not.toBeNull();
    expect(zip.file('data/story-bible.json')).not.toBeNull();
    expect(zip.file('version-history.json')).not.toBeNull();

    const outlineJson = await zip.file('outline.json')?.async('nodebuffer');
    const outlineEntry = manifest.files.find((file) => file.path === 'outline.json');
    expect(outlineJson).toBeDefined();
    expect(outlineEntry).toMatchObject({
      size: outlineJson?.length,
      sha256: createHash('sha256').update(outlineJson ?? Buffer.alloc(0)).digest('hex'),
    });
    expect(await zip.file('chapters/chapter-0001.md')?.async('string')).toContain(
      '沈砚听见剑鸣。',
    );
  });
});
