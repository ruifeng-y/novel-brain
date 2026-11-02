import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { OutlineLevel } from '@novel/contracts';

export type OutlineExportNode = {
  id: string;
  parentId: string | null;
  level: OutlineLevel;
  orderIndex: number;
  title: string;
  summary: string;
  details: string;
  chapterNumber: number | null;
  chapterGoal: string;
  pov: string;
  sceneBeats: string[];
  chapterEndHook: string;
  locked: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type OutlineExportInput = {
  work: { id: string; title: string };
  branch: { id: string; name: string };
  nodes: OutlineExportNode[];
  exportedAt?: Date;
};

export type OutlineExportTree = Omit<OutlineExportNode, 'parentId'> & {
  parentId: string | null;
  children: OutlineExportTree[];
};

export type OutlineExportDocument = {
  exportVersion: 1;
  exportedAt: string;
  work: { id: string; title: string };
  branch: { id: string; name: string };
  counts: Record<'total' | OutlineLevel, number>;
  outline: OutlineExportTree[];
};

export type HistoricalVersionExportInput = {
  work: { id: string; title: string };
  branch: { id: string; name: string };
  version: {
    id: string;
    kind: string;
    kindLabel: string;
    title: string;
    reason: string;
    parentVersionId?: string | null;
    createdAt: string;
  };
  versions: Array<{
    id: string;
    kind: string;
    kindLabel: string;
    title: string;
    reason: string;
    createdAt: string;
  }>;
  outline: OutlineExportNode[];
  chapters: Array<{
    chapterNumber: number;
    title: string;
    content: string;
    volumeTitle: string;
  }>;
  data?: Record<string, unknown>;
  generatedAt?: Date;
};

export type RenderedOutlineExport = {
  data: Buffer;
  extension: 'md' | 'json';
  mimeType: string;
};

export type HistoricalVersionExportFile = {
  data: Buffer;
  extension: 'zip';
  mimeType: 'application/zip';
};

const LEVEL_HEADING: Record<Exclude<OutlineLevel, 'book'>, string> = {
  volume: '##',
  act: '###',
  chapter: '####',
  scene: '#####',
};

const LEVEL_LABEL: Record<OutlineLevel, string> = {
  book: '全书',
  volume: '卷',
  act: '幕',
  chapter: '章',
  scene: '场景',
};

export async function renderOutlineExport(
  input: OutlineExportInput,
  format: 'markdown' | 'json',
): Promise<RenderedOutlineExport> {
  const document = buildOutlineExportDocument(input);
  if (format === 'json') {
    return {
      data: Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8'),
      extension: 'json',
      mimeType: 'application/json; charset=utf-8',
    };
  }
  return {
    data: Buffer.from(renderOutlineMarkdown(document), 'utf8'),
    extension: 'md',
    mimeType: 'text/markdown; charset=utf-8',
  };
}

export function buildOutlineExportDocument(input: OutlineExportInput): OutlineExportDocument {
  const exportedAt = (input.exportedAt ?? new Date()).toISOString();
  const counts: Record<'total' | OutlineLevel, number> = {
    total: input.nodes.length,
    book: 0,
    volume: 0,
    act: 0,
    chapter: 0,
    scene: 0,
  };
  for (const node of input.nodes) {
    counts[node.level] += 1;
  }
  return {
    exportVersion: 1,
    exportedAt,
    work: input.work,
    branch: input.branch,
    counts,
    outline: buildOutlineTrees(input.nodes),
  };
}

export async function buildHistoricalVersionExport(
  input: HistoricalVersionExportInput,
): Promise<HistoricalVersionExportFile> {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const outlineDocument = buildOutlineExportDocument({
    work: input.work,
    branch: input.branch,
    nodes: input.outline,
    exportedAt: new Date(generatedAt),
  });
  const archive = new JSZip();
  const files: Array<{ path: string; contents: Buffer }> = [];
  const addText = (path: string, contents: string) => {
    const data = Buffer.from(contents, 'utf8');
    archive.file(path, data);
    files.push({ path, contents: data });
  };
  const addJson = (path: string, value: unknown) => {
    addText(path, `${JSON.stringify(value, null, 2)}\n`);
  };

  addText('README.txt', historicalReadme(input));
  addJson('outline.json', outlineDocument);
  addText('outline.md', renderOutlineMarkdown(outlineDocument));
  addText('manuscript.md', renderHistoricalManuscript(input));
  addJson('version-history.json', input.versions);
  for (const chapter of [...input.chapters].sort(
    (left, right) => left.chapterNumber - right.chapterNumber,
  )) {
    addText(
      `chapters/chapter-${String(chapter.chapterNumber).padStart(4, '0')}.md`,
      renderChapterMarkdown(chapter),
    );
  }
  for (const [key, value] of Object.entries(input.data ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    addJson(`data/${safeSegment(key)}.json`, value);
  }

  const manifest = {
    exportVersion: 1,
    generatedAt,
    work: input.work,
    branch: input.branch,
    version: input.version,
    counts: {
      chapters: input.chapters.length,
      outlineNodes: input.outline.length,
      versions: input.versions.length,
      dataSections: Object.keys(input.data ?? {}).length,
    },
    files: files
      .map((file) => ({
        path: file.path,
        size: file.contents.length,
        sha256: createHash('sha256').update(file.contents).digest('hex'),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  archive.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    data: await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    extension: 'zip',
    mimeType: 'application/zip',
  };
}

function buildOutlineTrees(nodes: OutlineExportNode[]): OutlineExportTree[] {
  const sorted = [...nodes].sort(compareNodes);
  const byId = new Map(
    sorted.map((node) => [
      node.id,
      {
        ...node,
        children: [] as OutlineExportTree[],
      },
    ]),
  );
  const childrenByParent = new Map<string, OutlineExportTree[]>();
  for (const node of sorted) {
    const child = byId.get(node.id);
    if (!child) {
      continue;
    }
    const key = node.parentId ?? '';
    const siblings = childrenByParent.get(key) ?? [];
    siblings.push(child);
    childrenByParent.set(key, siblings);
  }

  const visited = new Set<string>();
  const build = (node: OutlineExportTree): OutlineExportTree => {
    if (visited.has(node.id)) {
      return { ...node, children: [] };
    }
    visited.add(node.id);
    return {
      ...node,
      children: (childrenByParent.get(node.id) ?? []).map(build),
    };
  };

  const roots = sorted
    .filter((node) => !node.parentId || !byId.has(node.parentId))
    .map((node) => byId.get(node.id))
    .filter((node): node is OutlineExportTree => Boolean(node))
    .map(build);

  for (const node of sorted) {
    const tree = byId.get(node.id);
    if (tree && !visited.has(node.id)) {
      roots.push(build(tree));
    }
  }
  return roots;
}

function compareNodes(left: OutlineExportNode, right: OutlineExportNode): number {
  const order = left.orderIndex - right.orderIndex;
  if (order !== 0) {
    return order;
  }
  const created = left.createdAt.localeCompare(right.createdAt);
  if (created !== 0) {
    return created;
  }
  return left.title.localeCompare(right.title, 'zh-CN');
}

function renderOutlineMarkdown(document: OutlineExportDocument): string {
  const lines = [
    `# ${escapeInline(document.work.title)} · 大纲`,
    '',
    `> 创作线：${escapeInline(document.branch.name)}`,
    `> 导出时间：${document.exportedAt}`,
    `> 节点数：${document.counts.total}`,
    '',
  ];
  if (document.outline.length === 0) {
    lines.push('暂无大纲节点。', '');
  }
  for (const root of document.outline) {
    renderMarkdownNode(root, lines);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderMarkdownNode(node: OutlineExportTree, lines: string[]): void {
  if (node.level === 'book') {
    lines.push(
      `**全书总纲：${escapeInline(node.title)}**${node.locked ? ' · 已锁定' : ''}`,
      '',
    );
  } else {
    lines.push(
      `${LEVEL_HEADING[node.level]} ${outlineHeading(node)}${node.locked ? ' · 已锁定' : ''}`,
      '',
    );
  }
  if (node.summary) {
    lines.push(`**摘要**：${node.summary}`, '');
  }
  if (node.details) {
    lines.push(node.details, '');
  }
  if (node.chapterGoal) {
    lines.push(`**章目标**：${node.chapterGoal}`, '');
  }
  if (node.pov) {
    lines.push(`**叙事视角**：${node.pov}`, '');
  }
  if (node.sceneBeats.length > 0) {
    lines.push('**场景节拍**：', ...node.sceneBeats.map((beat) => `- ${beat}`), '');
  }
  if (node.chapterEndHook) {
    lines.push(`**章末钩子**：${node.chapterEndHook}`, '');
  }
  for (const child of node.children) {
    renderMarkdownNode(child, lines);
  }
}

function outlineHeading(node: OutlineExportTree): string {
  if (node.level === 'chapter' && node.chapterNumber !== null) {
    return `第 ${node.chapterNumber} 章 ${escapeInline(node.title)}`;
  }
  if (node.level === 'scene') {
    return `${LEVEL_LABEL.scene} · ${escapeInline(node.title)}`;
  }
  return escapeInline(node.title);
}

function renderHistoricalManuscript(input: HistoricalVersionExportInput): string {
  const lines = [
    `# ${escapeInline(input.work.title)}`,
    '',
    `> 创作线：${escapeInline(input.branch.name)}`,
    `> 历史版本：${escapeInline(input.version.title)}`,
    `> 保存时间：${input.version.createdAt}`,
    '',
  ];
  if (input.chapters.length === 0) {
    lines.push('这个版本还没有正文。', '');
    return `${lines.join('\n').trimEnd()}\n`;
  }
  for (const chapter of [...input.chapters].sort(
    (left, right) => left.chapterNumber - right.chapterNumber,
  )) {
    if (chapter.volumeTitle) {
      lines.push(`## ${escapeInline(chapter.volumeTitle)}`, '');
    }
    lines.push(
      `### 第 ${chapter.chapterNumber} 章 ${escapeInline(chapter.title)}`,
      '',
      chapter.content.trim(),
      '',
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function renderChapterMarkdown(chapter: HistoricalVersionExportInput['chapters'][number]): string {
  return [
    `# 第 ${chapter.chapterNumber} 章 ${escapeInline(chapter.title)}`,
    '',
    chapter.volumeTitle ? `> ${escapeInline(chapter.volumeTitle)}` : '',
    '',
    chapter.content.trim(),
    '',
  ].join('\n');
}

function historicalReadme(input: HistoricalVersionExportInput): string {
  return [
    'NovelBrain 历史版本导出',
    '',
    `作品：${input.work.title}`,
    `创作线：${input.branch.name}`,
    `版本：${input.version.title}`,
    `保存时间：${input.version.createdAt}`,
    '',
    'manifest.json 记录版本、作品、创作线、数据数量和每个文件的 SHA-256 校验值。',
    'outline.md 与 outline.json 是这一版的大纲，manuscript.md 是这一版的正文合集。',
    'version-history.json 是这一条创作线的版本清单。',
    '',
  ].join('\n');
}

function safeSegment(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'data';
}

function escapeInline(value: string): string {
  return value.replace(/([\\`*_[\]<>#])/g, '\\$1').replace(/\r?\n/g, ' ');
}
