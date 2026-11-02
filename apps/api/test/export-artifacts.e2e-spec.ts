import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function clearRateLimits(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService).client;
  const keys = [...(await redis.keys('auth:*')), ...(await redis.keys('rate:*'))];
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

async function createAuthor(app: INestApplication, passwordHash: string) {
  const email = uniqueEmail('export-artifacts');
  const password = 'correct horse battery staple';
  const agent = request.agent(app.getHttpServer());

  await clearRateLimits(app);
  await app
    .get(DatabaseService)
    .db.insert(usersTable)
    .values({
      email,
      passwordHash,
      displayName: email.slice(0, email.indexOf('@')),
    });
  const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
  return { agent, userId: login.body.id as string };
}

async function createWork(agent: ReturnType<typeof request.agent>, title: string) {
  const response = await agent
    .post('/api/v1/works')
    .send({
      title,
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'long',
      targetPlatform: '起点中文网',
    })
    .expect(201);
  return {
    id: response.body.id as string,
    mainBranchId: response.body.mainBranch.id as string,
  };
}

async function createOutlineTree(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
) {
  const base = `/api/v1/works/${workId}/branches/${branchId}/outlines`;
  const create = async (body: Record<string, unknown>) => {
    const response = await agent.post(base).send(body).expect(201);
    return response.body as { id: string; title: string };
  };
  const book = await create({
    level: 'book',
    title: '九门总纲',
    summary: '沈砚沿九座天门追查母亲失踪的真相。',
    details: '全书以记忆代价推进。',
  });
  const volume = await create({
    level: 'volume',
    parentId: book.id,
    title: '第一卷 天门初开',
    summary: '边城断碑。',
    details: '',
  });
  const act = await create({
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '剑鸣初响。',
    details: '',
  });
  const chapter = await create({
    level: 'chapter',
    parentId: act.id,
    title: '第一章 断碑',
    summary: '沈砚在荒寺听见剑鸣。',
    details: '',
    chapterNumber: 1,
    chapterGoal: '让沈砚第一次听见剑鸣。',
    pov: '沈砚',
    sceneBeats: ['荒寺避雨', '断碑剑鸣'],
    chapterEndHook: '断碑深处传来母亲的声音。',
  });
  return { book, volume, act, chapter };
}

async function saveChapterVersion(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  content: string,
) {
  const response = await agent
    .post(`/api/v1/works/${workId}/branches/${branchId}/chapters/1/versions`)
    .send({ content })
    .expect(201);
  return response.body as { id: string; version: number };
}

async function graph(agent: ReturnType<typeof request.agent>, workId: string, branchId: string) {
  const response = await agent
    .get(`/api/v1/works/${workId}/branches/${branchId}/versions`)
    .expect(200);
  return response.body as {
    nodes: Array<{
      id: string;
      type: string;
      chapterVersionId: string | null;
      title: string;
    }>;
  };
}

const binaryParser = (
  response: NodeJS.ReadableStream,
  callback: (error: Error | null, body?: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('outline and historical-version export API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/13';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-16-characters';
    process.env.MODEL_KEY_ENCRYPTION_KEY =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    passwordHash = await hash('correct horse battery staple', {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    const connection = createDatabase(process.env.DATABASE_URL);
    await migrate(connection.db, {
      migrationsFolder: path.resolve(process.cwd(), 'packages/db/migrations'),
    });
    await connection.pool.end();

    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    const redis = app.get(RedisService).client;
    if (redis.status !== 'ready') {
      await new Promise<void>((resolve) => redis.once('ready', resolve));
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await clearRateLimits(app);
  });

  it('downloads a branch outline as Markdown or JSON without leaking another branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const workTitle = `大纲导出${Date.now()}`;
    const work = await createWork(author.agent, workTitle);
    const tree = await createOutlineTree(author.agent, work.id, work.mainBranchId);
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    const markdown = await author.agent
      .post(`${base}/exports/outline`)
      .send({ format: 'markdown' })
      .expect(202);
    expect(markdown.body).toMatchObject({
      kind: 'outline',
      kindLabel: '大纲',
      format: 'markdown',
      status: 'completed',
      scopeLabel: '全文大纲',
    });
    const markdownFile = await author.agent
      .get(`${base}/exports/${markdown.body.id}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const markdownText = markdownFile.body.toString('utf8');
    expect(markdownFile.headers['content-type']).toContain('text/markdown');
    expect(markdownText).toContain(`# ${workTitle} · 大纲`);
    expect(markdownText).toContain('**全书总纲：九门总纲**');
    expect(markdownText).toContain('## 第一卷 天门初开');
    expect(markdownText).toContain('#### 第 1 章 第一章 断碑');
    expect(markdownText).toContain('**章目标**：让沈砚第一次听见剑鸣。');

    const json = await author.agent
      .post(`${base}/exports/outline`)
      .send({ format: 'json' })
      .expect(202);
    const jsonFile = await author.agent
      .get(`${base}/exports/${json.body.id}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const document = JSON.parse(jsonFile.body.toString('utf8')) as {
      counts: { total: number; chapter: number };
      outline: Array<{ title: string; children: Array<{ title: string }> }>;
    };
    expect(document.counts).toMatchObject({ total: 4, chapter: 1 });
    expect(document.outline[0]).toMatchObject({ title: '九门总纲' });
    expect(document.outline[0].children[0].title).toBe('第一卷 天门初开');

    const forked = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: 'current',
        name: '别的大纲',
        reason: '检查分支隔离。',
        kind: 'experiment',
      })
      .expect(201);
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${forked.body.id}/outlines/${tree.chapter.id}`,
      )
      .send({ title: '平行版本专属章名' })
      .expect(200);
    const mainJson = await author.agent
      .post(`${base}/exports/outline`)
      .send({ format: 'json' })
      .expect(202);
    const mainFile = await author.agent
      .get(`${base}/exports/${mainJson.body.id}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(mainFile.body.toString('utf8')).not.toContain('平行版本专属章名');

    const otherWork = await createWork(author.agent, `另一本书${Date.now()}`);
    const otherWorkBase = `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}`;
    const otherWorkExport = await author.agent
      .post(`${otherWorkBase}/exports/outline`)
      .send({ format: 'json' })
      .expect(202);
    const otherWorkFile = await author.agent
      .get(`${otherWorkBase}/exports/${otherWorkExport.body.id}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const otherWorkDocument = JSON.parse(otherWorkFile.body.toString('utf8')) as {
      counts: { total: number };
      outline: unknown[];
    };
    expect(otherWorkDocument.counts.total).toBe(0);
    expect(otherWorkDocument.outline).toEqual([]);

    await otherAuthor.agent
      .post(`${base}/exports/outline`)
      .send({ format: 'json' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
  });

  it('exports the exact historical snapshot with a manifest and version list', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, `历史版本导出${Date.now()}`);
    const tree = await createOutlineTree(author.agent, work.id, work.mainBranchId);
    const firstVersion = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    await author.agent
      .patch(
        `/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines/${tree.chapter.id}`,
      )
      .send({
        title: '第一章 改过的断碑',
        chapterGoal: '改过的章目标。',
      })
      .expect(200);
    await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚在断碑前听见了母亲的回音。',
    );

    const versions = await graph(author.agent, work.id, work.mainBranchId);
    const firstCommit = versions.nodes.find(
      (node) => node.type === 'version' && node.chapterVersionId === firstVersion.id,
    );
    expect(firstCommit).toBeTruthy();
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    const created = await author.agent
      .post(`${base}/exports/version`)
      .send({ versionCommitId: firstCommit?.id })
      .expect(202);
    expect(created.body).toMatchObject({
      kind: 'version',
      kindLabel: '历史版本',
      format: 'zip',
      status: 'completed',
      scopeLabel: '历史版本',
      version: { id: firstCommit?.id },
    });
    const file = await author.agent
      .get(`${base}/exports/${created.body.id}/download`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const zip = await JSZip.loadAsync(file.body);
    const manifest = JSON.parse(
      (await zip.file('manifest.json')?.async('string')) ?? '{}',
    ) as {
      version: { id: string; title: string };
      counts: { chapters: number; outlineNodes: number; versions: number };
      files: Array<{ path: string; sha256: string; size: number }>;
    };
    expect(manifest.version.id).toBe(firstCommit?.id);
    expect(manifest.counts).toMatchObject({
      chapters: 1,
      outlineNodes: 4,
    });
    expect(manifest.counts.versions).toBeGreaterThanOrEqual(4);
    expect(zip.file('outline.json')).not.toBeNull();
    expect(zip.file('version-history.json')).not.toBeNull();
    expect(await zip.file('manuscript.md')?.async('string')).toContain('沈砚听见剑鸣。');
    expect(await zip.file('manuscript.md')?.async('string')).not.toContain('母亲的回音');
    expect(await zip.file('outline.json')?.async('string')).toContain('第一章 断碑');
    expect(await zip.file('outline.json')?.async('string')).not.toContain('改过的断碑');
    expect(manifest.files.find((entry) => entry.path === 'outline.json')).toBeTruthy();

    const forked = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: 'current',
        name: '另一条线',
        reason: '检查历史版本隔离。',
        kind: 'experiment',
      })
      .expect(201);
    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${forked.body.id}/exports/version`)
      .send({ versionCommitId: firstCommit?.id })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('VERSION_NOT_FOUND');
      });

    const otherWork = await createWork(author.agent, `另一本书${Date.now()}`);
    await author.agent
      .post(
        `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/exports/version`,
      )
      .send({ versionCommitId: firstCommit?.id })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('VERSION_NOT_FOUND');
      });

    await otherAuthor.agent
      .post(`${base}/exports/version`)
      .send({ versionCommitId: firstCommit?.id })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
  });
});
