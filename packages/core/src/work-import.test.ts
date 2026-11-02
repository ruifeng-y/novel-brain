import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  ManuscriptImportError,
  parseManuscript,
  qualityScoreFromDimensions,
  splitManuscriptText,
} from './work-import';

describe('manuscript import', () => {
  it('splits Markdown on chapter headings and keeps the original prose', () => {
    const chapters = splitManuscriptText(
      [
        '# 天门旧稿',
        '',
        '# 第一章 断碑',
        '沈砚按住断碑。',
        '',
        '雨还没有停。',
        '',
        '# 第二章 城门',
        '城门下有人等他。',
      ].join('\n'),
      '天门旧稿',
    );

    expect(chapters).toEqual([
      { title: '第一章 断碑', content: '沈砚按住断碑。\n\n雨还没有停。' },
      { title: '第二章 城门', content: '城门下有人等他。' },
    ]);
  });

  it('keeps a manuscript without headings as one chapter', () => {
    expect(splitManuscriptText('只有一段旧稿。', '旧稿')).toEqual([
      { title: '旧稿', content: '只有一段旧稿。' },
    ]);
  });

  it('extracts paragraphs from a Word document', async () => {
    const archive = new JSZip();
    archive.file(
      'word/document.xml',
      '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>第1章 城门</w:t></w:r></w:p><w:p><w:r><w:t>风从城门下吹过。</w:t></w:r></w:p></w:body></w:document>',
    );
    const base64 = (await archive.generateAsync({ type: 'nodebuffer' })).toString('base64');

    await expect(
      parseManuscript({ fileName: '旧稿.docx', contentBase64: base64 }),
    ).resolves.toEqual({
      format: 'docx',
      chapters: [{ title: '第1章 城门', content: '风从城门下吹过。' }],
    });
  });

  it('rejects unsupported and empty manuscripts', async () => {
    await expect(parseManuscript({ fileName: '旧稿.pdf', content: '内容' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_MANUSCRIPT_FORMAT',
    } satisfies Partial<ManuscriptImportError>);
    await expect(parseManuscript({ fileName: '空稿.txt', content: ' \n ' })).rejects.toMatchObject({
      code: 'MANUSCRIPT_EMPTY',
    } satisfies Partial<ManuscriptImportError>);
  });

  it('turns six quality dimensions into a stable author-facing score', () => {
    expect(
      qualityScoreFromDimensions([
        { status: 'good' },
        { status: 'good' },
        { status: 'good' },
        { status: 'watch' },
        { status: 'watch' },
        { status: 'weak' },
      ]),
    ).toBe(80);
    expect(qualityScoreFromDimensions([])).toBeNull();
  });
});
