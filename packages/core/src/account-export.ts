import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export type AccountExportAsset = {
  path: string;
  data: Buffer;
  mimeType: string;
};

export type AccountExportArchiveInput = {
  data: {
    exportVersion: number;
    exportedAt: string;
    account: { id: string; email: string; displayName: string };
    modelConfigs: unknown[];
    works: unknown[];
    branches: unknown[];
    settings: Record<string, unknown[]>;
    characters: Record<string, unknown[]>;
    maps: Record<string, unknown[]>;
    text: Record<string, unknown[]>;
    facts: Record<string, unknown[]>;
    changes: Record<string, unknown[]>;
    generation: Record<string, unknown[]>;
    audit: Record<string, unknown[]>;
    exports: Record<string, unknown[]>;
  };
  assets?: AccountExportAsset[];
  generatedAt?: Date;
};

export type AccountExportManifest = {
  exportVersion: number;
  accountId: string;
  generatedAt: string;
  counts: Record<string, number>;
  files: Array<{ path: string; size: number; sha256: string }>;
};

export type AccountExportArchive = {
  data: Buffer;
  manifest: AccountExportManifest;
};

const JSON_FILES = [
  ['account.json', 'account'],
  ['model-configs.json', 'modelConfigs'],
  ['works.json', 'works'],
  ['works/branches.json', 'branches'],
  ['settings.json', 'settings'],
  ['characters.json', 'characters'],
  ['maps.json', 'maps'],
  ['text.json', 'text'],
  ['facts.json', 'facts'],
  ['changes.json', 'changes'],
  ['generation.json', 'generation'],
  ['audit.json', 'audit'],
  ['exports.json', 'exports'],
] as const;

export async function buildAccountExportArchive(
  input: AccountExportArchiveInput,
): Promise<AccountExportArchive> {
  const generatedAt = (input.generatedAt ?? new Date()).toISOString();
  const counts = countSections(input.data);
  const files: Array<{ path: string; data: Uint8Array }> = JSON_FILES.map(([path, key]) => {
    const data = Buffer.from(
      `${JSON.stringify(input.data[key as keyof AccountExportArchiveInput['data']], null, 2)}\n`,
      'utf8',
    );
    return { path, data };
  });
  for (const asset of input.assets ?? []) {
    files.push({ path: asset.path, data: asset.data });
  }

  const manifest: AccountExportManifest = {
    exportVersion: input.data.exportVersion,
    accountId: input.data.account.id,
    generatedAt,
    counts,
    files: files.map((file) => ({
      path: file.path,
      size: file.data.length,
      sha256: createHash('sha256').update(file.data).digest('hex'),
    })),
  };
  const archive = new JSZip();
  archive.file('README.txt', readme(input.data.account.displayName));
  archive.file('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  for (const file of files) {
    archive.file(file.path, file.data);
  }
  return {
    data: await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }),
    manifest,
  };
}

function countSections(data: AccountExportArchiveInput['data']): Record<string, number> {
  return {
    works: data.works.length,
    branches: data.branches.length,
    settings: countRecord(data.settings),
    characters: countRecord(data.characters),
    maps: countRecord(data.maps),
    chapters: data.text.chapters?.length ?? 0,
    facts: countRecord(data.facts),
    changes: data.changes.requests?.length ?? 0,
    generation: countRecord(data.generation),
    auditWork: data.audit.work?.length ?? 0,
    auditAccount: data.audit.account?.length ?? 0,
    modelConfigs: data.modelConfigs.length,
  };
}

function countRecord(value: Record<string, unknown[]>): number {
  return Object.values(value).reduce(
    (total, items) => total + (Array.isArray(items) ? items.length : 0),
    0,
  );
}

function readme(displayName: string): string {
  return [
    `NovelBrain 账号完整导出`,
    ``,
    `作者：${displayName}`,
    ``,
    `本压缩包包含账号资料、作品、设定、人物、地图、正文、事实、修改记录、生成记录和审计记录。`,
    `模型 API Key、密码摘要、会话令牌不会被导出。`,
    `manifest.json 记录了每个文件的 SHA-256 校验值和数据数量。`,
    ``,
  ].join('\n');
}
