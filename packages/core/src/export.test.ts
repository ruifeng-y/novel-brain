import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  ExportSelectionError,
  renderExportFile,
  selectExportChapters,
  type ExportOutlineNode,
  type ExportSourceChapter,
} from './export';

const outlines: ExportOutlineNode[] = [
  { id: 'book', parentId: null, level: 'book', chapterNumber: null, title: '天门残卷' },
  {
    id: 'volume-1',
    parentId: 'book',
    level: 'volume',
    chapterNumber: null,
    title: '第一卷 天门初开',
  },
  {
    id: 'act-1',
    parentId: 'volume-1',
    level: 'act',
    chapterNumber: null,
    title: '第一幕 断碑雨夜',
  },
  { id: 'chapter-1', parentId: 'act-1', level: 'chapter', chapterNumber: 1, title: '断碑' },
  { id: 'chapter-2', parentId: 'act-1', level: 'chapter', chapterNumber: 2, title: '旧城门' },
  { id: 'chapter-3', parentId: 'act-1', level: 'chapter', chapterNumber: 3, title: '剑鸣' },
  {
    id: 'volume-2',
    parentId: 'book',
    level: 'volume',
    chapterNumber: null,
    title: '第二卷 山海来客',
  },
  { id: 'act-2', parentId: 'volume-2', level: 'act', chapterNumber: null, title: '第二幕 远客' },
  { id: 'chapter-4', parentId: 'act-2', level: 'chapter', chapterNumber: 4, title: '来客' },
];

const chapters: ExportSourceChapter[] = [
  { chapterNumber: 1, title: '断碑', content: '沈砚听见剑鸣。' },
  { chapterNumber: 2, title: '旧城门', content: '城门下站着一个陌生人。' },
  { chapterNumber: 3, title: '剑鸣', content: '残剑在雨里醒来。' },
  { chapterNumber: 4, title: '来客', content: '陌生人递来一封旧信。' },
];

describe('export chapter ranges', () => {
  it('exports only the current chapter', () => {
    const selected = selectExportChapters(
      { type: 'chapter', chapterNumber: 2 },
      outlines,
      chapters,
    );

    expect(selected.map((chapter) => chapter.chapterNumber)).toEqual([2]);
    expect(selected[0].volumeTitle).toBe('第一卷 天门初开');
  });

  it('exports selected chapters in reading order', () => {
    const selected = selectExportChapters(
      { type: 'chapters', chapterNumbers: [4, 1, 3] },
      outlines,
      chapters,
    );

    expect(selected.map((chapter) => chapter.chapterNumber)).toEqual([1, 3, 4]);
  });

  it('exports an inclusive custom range and rejects gaps', () => {
    const selected = selectExportChapters(
      { type: 'range', startChapter: 1, endChapter: 2 },
      outlines,
      chapters,
    );

    expect(selected.map((chapter) => chapter.chapterNumber)).toEqual([1, 2]);
    expect(() =>
      selectExportChapters(
        { type: 'range', startChapter: 1, endChapter: 4 },
        outlines,
        chapters.filter((chapter) => chapter.chapterNumber !== 2),
      ),
    ).toThrowError(ExportSelectionError);
  });

  it('exports every written chapter under the requested volume', () => {
    const selected = selectExportChapters(
      { type: 'volume', volumeId: 'volume-1' },
      outlines,
      chapters,
    );

    expect(selected.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3]);
    expect(new Set(selected.map((chapter) => chapter.volumeTitle))).toEqual(
      new Set(['第一卷 天门初开']),
    );
  });

  it('exports the whole book across volumes', () => {
    const selected = selectExportChapters({ type: 'book' }, outlines, chapters);

    expect(selected.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3, 4]);
    expect(selected[3].volumeTitle).toBe('第二卷 山海来客');
  });
});

describe('text export formats', () => {
  const selected = selectExportChapters({ type: 'book' }, outlines, chapters);

  it('renders UTF-8 text with volume and chapter headings', async () => {
    const file = await renderExportFile({
      title: '天门残卷',
      chapters: selected,
      format: 'txt',
      preset: 'generic',
    });

    expect(file.extension).toBe('txt');
    expect(file.mimeType).toBe('text/plain; charset=utf-8');
    expect(file.data.toString('utf8')).toContain('天门残卷');
    expect(file.data.toString('utf8')).toContain('第一卷 天门初开');
    expect(file.data.toString('utf8')).toContain('第 1 章 断碑');
    expect(file.data.toString('utf8')).toContain('沈砚听见剑鸣。');
  });

  it('renders Markdown headings and applies the Qidian preset', async () => {
    const file = await renderExportFile({
      title: '天门残卷',
      chapters: selected.slice(0, 2),
      format: 'markdown',
      preset: 'qidian',
    });
    const markdown = file.data.toString('utf8');

    expect(file.extension).toBe('md');
    expect(markdown).toContain('# 天门残卷');
    expect(markdown).toContain('## 第一卷 天门初开');
    expect(markdown).toContain('### 第1章 断碑');
    expect(markdown).toContain('### 第2章 旧城门');
  });

  it('applies the Fanqie preset and explicit title overrides', async () => {
    const fanqie = await renderExportFile({
      title: '天门残卷',
      chapters: selected.slice(0, 1),
      format: 'txt',
      preset: 'fanqie',
    });
    const overridden = await renderExportFile({
      title: '天门残卷',
      chapters: selected.slice(0, 1),
      format: 'txt',
      preset: 'generic',
      chapterTitlePattern: '正文 {number}｜{title}',
    });

    expect(fanqie.data.toString('utf8')).toContain('第1章 断碑');
    expect(overridden.data.toString('utf8')).toContain('正文 1｜断碑');
  });
});

describe('packaged export formats', () => {
  const selected = selectExportChapters({ type: 'book' }, outlines, chapters).slice(0, 2);

  it('renders a DOCX package with document headings and prose', async () => {
    const file = await renderExportFile({
      title: '天门残卷',
      chapters: selected,
      format: 'docx',
      preset: 'generic',
    });
    const archive = await JSZip.loadAsync(file.data);
    const documentXml = await archive.file('word/document.xml')?.async('string');

    expect(file.extension).toBe('docx');
    expect(file.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(archive.file('[Content_Types].xml')).not.toBeNull();
    expect(archive.file('_rels/.rels')).not.toBeNull();
    expect(documentXml).toContain('天门残卷');
    expect(documentXml).toContain('第 1 章 断碑');
    expect(documentXml).toContain('沈砚听见剑鸣。');
  });

  it('renders a valid EPUB package with navigation and chapter documents', async () => {
    const file = await renderExportFile({
      title: '天门残卷',
      chapters: selected,
      format: 'epub',
      preset: 'fanqie',
    });
    const archive = await JSZip.loadAsync(file.data);
    const mimetype = await archive.file('mimetype')?.async('string');
    const packageXml = await archive.file('OEBPS/content.opf')?.async('string');
    const navigation = await archive.file('OEBPS/nav.xhtml')?.async('string');
    const firstChapter = await archive.file('OEBPS/chapter-1.xhtml')?.async('string');

    expect(file.extension).toBe('epub');
    expect(file.mimeType).toBe('application/epub+zip');
    expect(mimetype).toBe('application/epub+zip');
    expect(archive.file('META-INF/container.xml')).not.toBeNull();
    expect(packageXml).toContain('天门残卷');
    expect(packageXml).toContain('chapter-1.xhtml');
    expect(navigation).toContain('第1章 断碑');
    expect(firstChapter).toContain('沈砚听见剑鸣。');
  });
});
