import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
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
  const email = uniqueEmail('version-graph');
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

async function saveStoryBible(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  protagonist: string,
) {
  return agent
    .put(`/api/v1/works/${workId}/branches/${branchId}/story-bible`)
    .send({
      oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
      protagonist,
      worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
    })
    .expect(200);
}

async function saveChapterOutline(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  chapterGoal: string,
) {
  return agent
    .put(`/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/1`)
    .send({
      chapterGoal,
      pov: '沈砚',
      sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕'],
      chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
    })
    .expect(200);
}

async function createOutlineTree(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
) {
  const basePath = `/api/v1/works/${workId}/branches/${branchId}/outlines`;
  const create = async (body: Record<string, unknown>) => {
    const response = await agent.post(basePath).send(body).expect(201);
    return response.body as { id: string };
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
    summary: '沈砚从边城进入荒寺。',
    details: '',
  });
  const act = await create({
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '沈砚在追兵围堵下触发断碑。',
    details: '',
  });
  return create({
    level: 'chapter',
    parentId: act.id,
    title: '第一章 断碑',
    summary: '沈砚第一次听见剑鸣。',
    details: '',
    chapterGoal: '沈砚第一次听见剑鸣。',
    pov: '沈砚',
    sceneBeats: ['沈砚逃入荒寺避雨'],
    chapterEndHook: '断碑深处传来母亲的声音。',
  });
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

async function createEntity(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  name: string,
  summary: string,
) {
  const response = await agent
    .post(`/api/v1/works/${workId}/branches/${branchId}/entities`)
    .send({
      name,
      aliases: [],
      type: 'map',
      summary,
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
    })
    .expect(201);
  return response.body as { id: string; name: string; summary: string };
}

async function graph(agent: ReturnType<typeof request.agent>, workId: string, branchId: string) {
  const response = await agent
    .get(`/api/v1/works/${workId}/branches/${branchId}/versions`)
    .expect(200);
  return response.body as {
    branches: Array<{ id: string; name: string; isMain: boolean }>;
    nodes: Array<{
      id: string;
      type: 'branch' | 'version';
      kind: string;
      kindLabel: string;
      branchId: string;
      title: string;
      chapterVersionId: string | null;
      changeRequestId: string | null;
      createdAt: string;
    }>;
    edges: Array<{ id: string; from: string; to: string; kind: string }>;
    summary: { branchCount: number; versionCount: number; mergeCount: number };
  };
}

async function seedConfirmedFact(
  app: INestApplication,
  workId: string,
  branchId: string,
  chapterId: string,
  statement: string,
) {
  const database = app.get(DatabaseService);
  const proposal = await database.pool.query<{ id: string }>(
    `insert into fact_proposals
       (work_id, branch_id, chapter_id, type, statement, source_sentence, status)
     values ($1, $2, $3, 'event', $4, $4, 'proposed')
     returning id`,
    [workId, branchId, chapterId, statement],
  );
  return proposal.rows[0].id;
}

describe('version graph, undo, rollback, and audit API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/14';
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

  it('records each modification as an immutable version and renders forks', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    await saveStoryBible(author.agent, work.id, work.mainBranchId, '沈砚');
    await createOutlineTree(author.agent, work.id, work.mainBranchId);
    const first = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    const second = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚在断碑前听见了母亲的回音。',
    );
    await createEntity(author.agent, work.id, work.mainBranchId, '临渊城', '东荒边境的小城。');

    const beforeFork = await graph(author.agent, work.id, work.mainBranchId);
    expect(beforeFork.branches).toEqual([
      expect.objectContaining({ id: work.mainBranchId, isMain: true }),
    ]);
    expect(beforeFork.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'version',
          kind: 'chapter_version',
          kindLabel: '正文版本',
          chapterVersionId: first.id,
        }),
        expect.objectContaining({
          type: 'version',
          kind: 'chapter_version',
          chapterVersionId: second.id,
        }),
        expect.objectContaining({
          type: 'version',
          kind: 'edit',
          kindLabel: '内容修改',
        }),
      ]),
    );
    expect(beforeFork.edges.some((edge) => edge.kind === 'sequence')).toBe(true);

    const fork = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: first.id,
        name: '母亲回音的另一版',
        reason: '回到第一次断碑时的完整故事状态。',
        kind: 'alternate_ending',
      })
      .expect(201);
    const forked = await graph(author.agent, work.id, work.mainBranchId);
    expect(forked.summary.branchCount).toBe(2);
    expect(forked.edges.some((edge) => edge.kind === 'fork')).toBe(true);
    const comparison = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/compare`)
      .send({ withBranchId: fork.body.id })
      .expect(201);
    const chapterToPick = comparison.body.chapters.find((item: { label: string }) =>
      item.label.includes('第 1 章'),
    );
    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${fork.body.id}/cherry-pick`)
      .send({
        targetBranchId: work.mainBranchId,
        items: [{ type: 'chapter', id: chapterToPick.comparedId }],
      })
      .expect(201);
    const merged = await graph(author.agent, work.id, work.mainBranchId);
    expect(merged.summary.mergeCount).toBe(1);
    expect(merged.nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'merge', kindLabel: '合并点' })]),
    );

    const database = app.get(DatabaseService);
    const commit = await database.pool.query<{ id: string }>(
      `select id from branch_commits
       where work_id = $1 and source_branch_id = $2
       order by created_at asc limit 1`,
      [work.id, work.mainBranchId],
    );
    await expect(
      database.pool.query('delete from branch_commits where id = $1', [commit.rows[0].id]),
    ).rejects.toThrow(/immutable/i);
    await expect(
      database.pool.query(`update branch_commits set message = '改写历史' where id = $1`, [
        commit.rows[0].id,
      ]),
    ).rejects.toThrow(/immutable/i);

    await author.agent
      .get(`${base}/versions`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nodes).toEqual(
          expect.arrayContaining([expect.objectContaining({ kind: 'edit', title: '添加设定' })]),
        );
      });
  });

  it('undoes one applied change as a new version without deleting the original', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const entity = await createEntity(
      author.agent,
      work.id,
      work.mainBranchId,
      '临渊城',
      '东荒边境的小城。',
    );

    const created = await author.agent
      .post(`${base}/changes`)
      .send({
        title: '补充临渊城的旧称',
        reason: '旧称在前文里出现过，需要写进设定。',
        targetType: 'map',
        targetId: entity.id,
        oldValue: { summary: '东荒边境的小城。' },
        newValue: { summary: '东荒边境的小城，旧称落霞城。' },
        source: 'author',
        risk: 'low',
      })
      .expect(201);
    const applied = await author.agent
      .post(`${base}/changes/${created.body.id}/apply`)
      .send({ mode: 'apply' })
      .expect(201);
    expect(applied.body.status).toBe('applied');

    const afterApply = await graph(author.agent, work.id, work.mainBranchId);
    expect(afterApply.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'change',
          changeRequestId: created.body.id,
        }),
      ]),
    );

    const undone = await author.agent
      .post(`${base}/changes/${created.body.id}/undo`)
      .send({ reason: '先保留初版写法。' })
      .expect(201);
    expect(undone.body).toMatchObject({
      status: 'undone',
      statusLabel: '已撤销',
      decisionReason: '先保留初版写法。',
    });
    await author.agent
      .get(`${base}/entities/${entity.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.summary).toBe('东荒边境的小城。');
      });

    const afterUndo = await graph(author.agent, work.id, work.mainBranchId);
    expect(afterUndo.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'change', changeRequestId: created.body.id }),
        expect.objectContaining({ kind: 'undo', changeRequestId: created.body.id }),
      ]),
    );
    expect(afterUndo.nodes.filter((node) => node.kind === 'change')).toHaveLength(1);

    await author.agent
      .post(`${base}/changes/${created.body.id}/undo`)
      .send({ reason: '重复撤销。' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('CHANGE_ALREADY_SETTLED');
      });

    const search = await author.agent.get(`${base}/audit`).query({ q: '撤销' }).expect(200);
    expect(search.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'change_undone',
          actionLabel: '撤销修改',
          title: expect.stringContaining('撤销'),
        }),
      ]),
    );

    const exported = await author.agent
      .get(`${base}/audit/export`)
      .query({ q: '撤销' })
      .expect(200);
    expect(exported.headers['content-disposition']).toContain('attachment');
    expect(exported.headers['content-type']).toContain('text/csv');
    expect(exported.text).toContain('撤销修改');
    expect(exported.text).toContain('先保留初版写法。');
  });

  it('rolls back settings, outlines, prose, and confirmed facts as a new version', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    await saveStoryBible(author.agent, work.id, work.mainBranchId, '沈砚');
    await createOutlineTree(author.agent, work.id, work.mainBranchId);
    const chapter = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into chapters
           (work_id, branch_id, chapter_number, title, status, word_count)
         values ($1, $2, 1, '断碑', 'planned', 0)
         returning id`,
      [work.id, work.mainBranchId],
    );
    const firstProposal = await seedConfirmedFact(
      app,
      work.id,
      work.mainBranchId,
      chapter.rows[0].id,
      '沈砚在断碑前听见剑鸣。',
    );
    await author.agent
      .post(`${base}/chapters/1/fact-proposals/${firstProposal}/confirm`)
      .send({})
      .expect(201);
    const target = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );

    await saveStoryBible(author.agent, work.id, work.mainBranchId, '沈砚（记忆受损）');
    await saveChapterOutline(author.agent, work.id, work.mainBranchId, '沈砚追查母亲旧事。');
    await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚在断碑前听见了母亲的回音。',
    );
    const secondProposal = await seedConfirmedFact(
      app,
      work.id,
      work.mainBranchId,
      chapter.rows[0].id,
      '沈砚忘记了母亲的名字。',
    );
    await author.agent
      .post(`${base}/chapters/1/fact-proposals/${secondProposal}/confirm`)
      .send({})
      .expect(201);

    const before = await graph(author.agent, work.id, work.mainBranchId);
    const targetCommit = before.nodes.find((node) => node.chapterVersionId === target.id);
    expect(targetCommit).toBeTruthy();

    const rollback = await author.agent
      .post(`${base}/rollback`)
      .send({
        targetVersionId: targetCommit?.id,
        reason: '回到第一次断碑时的完整故事状态。',
      })
      .expect(201);
    expect(rollback.body.version).toMatchObject({
      kind: 'rollback',
      kindLabel: '回滚',
      title: expect.stringContaining('回滚'),
    });

    await author.agent
      .get(`${base}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.protagonist).toBe('沈砚');
      });
    await author.agent
      .get(`${base}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.chapterGoal).toBe('沈砚第一次听见剑鸣。');
      });
    await author.agent
      .get(`${base}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚听见剑鸣。');
      });
    await author.agent
      .get(`${base}/facts`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((item: { statement: string }) => item.statement)).toEqual([
          '沈砚在断碑前听见剑鸣。',
        ]);
      });

    const after = await graph(author.agent, work.id, work.mainBranchId);
    expect(after.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: targetCommit?.id, kind: 'chapter_version' }),
        expect.objectContaining({
          kind: 'rollback',
          branchId: work.mainBranchId,
        }),
      ]),
    );
    expect(after.nodes.length).toBe(before.nodes.length + 1);
    const afterCommit = after.nodes.find((node) => node.id === rollback.body.version.id);
    expect(after.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: targetCommit?.id,
          to: afterCommit?.id,
          kind: 'rollback',
        }),
      ]),
    );

    const continued = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚醒来后，发现残剑缺了一角。',
    );
    expect(continued.version).toBe(2);
    await author.agent
      .get(`${base}/version-points`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: target.id }),
            expect.objectContaining({ id: continued.id }),
          ]),
        );
      });
    await author.agent
      .get(`${base}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚醒来后，发现残剑缺了一角。');
      });
  });

  it('isolates graph, rollback, and audit data by author and work', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    await saveStoryBible(author.agent, work.id, work.mainBranchId, '沈砚');
    await createOutlineTree(author.agent, work.id, work.mainBranchId);
    const version = await saveChapterVersion(
      author.agent,
      work.id,
      work.mainBranchId,
      '沈砚听见剑鸣。',
    );
    const currentGraph = await graph(author.agent, work.id, work.mainBranchId);
    const target = currentGraph.nodes.find((node) => node.chapterVersionId === version.id);

    await otherAuthor.agent
      .get(`${base}/versions`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent.get(`${base}/audit`).expect(404);
    await otherAuthor.agent
      .post(`${base}/rollback`)
      .send({ targetVersionId: target?.id, reason: '不应成功。' })
      .expect(404);

    await author.agent
      .get(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/versions`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: `branch:${otherWork.mainBranchId}`,
              type: 'branch',
            }),
          ]),
        );
      });
    await author.agent
      .post(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/rollback`)
      .send({ targetVersionId: target?.id, reason: '不应跨作品回滚。' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('VERSION_NOT_FOUND');
      });
  });
});
