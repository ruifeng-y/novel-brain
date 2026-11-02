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

function uniqueEmail(): string {
  return `parallel-versions-${randomUUID()}@example.com`;
}

async function clearAuthRateLimits(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService).client;
  const keys = await redis.keys('auth:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

async function createAuthor(app: INestApplication, passwordHash: string) {
  const email = uniqueEmail();
  const password = 'correct horse battery staple';
  const agent = request.agent(app.getHttpServer());

  await clearAuthRateLimits(app);
  await app
    .get(DatabaseService)
    .db.insert(usersTable)
    .values({
      email,
      passwordHash,
      displayName: email.slice(0, email.indexOf('@')),
    });
  const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);

  return {
    agent,
    userId: login.body.id as string,
  };
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

async function insertChapterVersions(
  app: INestApplication,
  workId: string,
  branchId: string,
  userId: string,
) {
  const database = app.get(DatabaseService);
  const chapter = await database.pool.query<{ id: string }>(
    `insert into chapters
       (work_id, branch_id, chapter_number, title, status, word_count, autosave_content)
     values ($1, $2, 1, '断碑', 'writing', 7, $3)
     returning id`,
    [workId, branchId, '沈砚听见剑鸣。'],
  );
  await database.pool.query(
    `insert into chapter_outlines
       (work_id, branch_id, level, order_index, title, summary, details, chapter_number)
     values ($1, $2, 'chapter', 0, '断碑', '', '', 1)`,
    [workId, branchId],
  );
  const versions = await database.pool.query<{ id: string; version: number }>(
    `insert into chapter_versions
       (chapter_id, version, content, content_hash, word_count, created_by, source)
     values
       ($1, 1, $2, md5($2), 7, $3, 'manual'),
       ($1, 2, $4, md5($4), 10, $3, 'manual')
     returning id, version`,
    [chapter.rows[0].id, '沈砚听见剑鸣。', userId, '沈砚在断碑前听见了母亲的回音。'],
  );
  const current = versions.rows.find((row) => row.version === 2);
  if (!current) {
    throw new Error('Expected the second chapter version');
  }
  await database.pool.query(
    `update chapters
        set current_version_id = $1, word_count = 10, autosave_content = $2
      where id = $3`,
    [current.id, '沈砚在断碑前听见了母亲的回音。', chapter.rows[0].id],
  );

  return {
    chapterId: chapter.rows[0].id,
    firstVersionId: versions.rows.find((row) => row.version === 1)?.id as string,
    secondVersionId: current.id,
  };
}

describe('parallel version API', () => {
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
    await clearAuthRateLimits(app);
  });

  it('creates a parallel version from any saved chapter version with full metadata', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const versions = await insertChapterVersions(app, work.id, work.mainBranchId, author.userId);

    const versionPoints = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/version-points`)
      .expect(200);
    expect(versionPoints.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'current',
          chapterNumber: null,
        }),
        expect.objectContaining({
          id: versions.firstVersionId,
          chapterNumber: 1,
          version: 1,
          label: expect.stringContaining('版本 1'),
        }),
      ]),
    );

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: versions.firstVersionId,
        name: '母亲回音的另一版',
        reason: '想试试让沈砚更早听见母亲的声音。',
        kind: 'alternate_ending',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      workId: work.id,
      name: '母亲回音的另一版',
      reason: '想试试让沈砚更早听见母亲的声音。',
      kind: 'alternate_ending',
      kindLabel: '另一结局',
      isMain: false,
      parentBranchId: work.mainBranchId,
      parentBranchName: 'main',
      status: 'active',
      statusLabel: '进行中',
      forkPoint: {
        kind: 'chapter_version',
        chapterNumber: 1,
        chapterVersionId: versions.firstVersionId,
        label: expect.stringContaining('第 1 章'),
      },
    });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.body.id,
              name: '母亲回音的另一版',
              parentBranchId: work.mainBranchId,
            }),
          ]),
        );
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚在断碑前听见了母亲的回音。');
      });
    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${created.body.id}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚听见剑鸣。');
      });
  });

  it('compares settings, outlines, and prose side by side with conflict markers', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const versions = await insertChapterVersions(app, work.id, work.mainBranchId, author.userId);
    const database = app.get(DatabaseService);
    await database.pool.query(
      `insert into entities
         (work_id, branch_id, name, type, summary, description, tags, scope, status, source)
       values ($1, $2, '临渊城', 'map', '东荒边境的小城。', '', '[]', 'work', 'draft', '作者录入')`,
      [work.id, work.mainBranchId],
    );
    await database.pool.query(
      `insert into chapter_outlines
         (work_id, branch_id, level, order_index, title, summary, details, chapter_number, chapter_goal)
       values ($1, $2, 'chapter', 1, '旧城门', '', '', 2, '主线原本的第二章大纲。')`,
      [work.id, work.mainBranchId],
    );

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: versions.firstVersionId,
        name: '断碑之前',
        reason: '比较另一种写法。',
        kind: 'what_if',
      })
      .expect(201);

    const branchPath = `/api/v1/works/${work.id}/branches/${created.body.id}`;
    const branchEntities = await author.agent.get(`${branchPath}/entities`).expect(200);
    const entity = branchEntities.body.items.find(
      (item: { name: string }) => item.name === '临渊城',
    );
    expect(entity).toBeDefined();
    await author.agent
      .patch(`${branchPath}/entities/${entity.id}`)
      .send({ summary: '断碑以东的小城。' })
      .expect(200);

    const branchOutlines = await author.agent.get(`${branchPath}/outlines`).expect(200);
    const chapterOutline = branchOutlines.body.items.find(
      (item: { level: string }) => item.level === 'chapter',
    );
    await author.agent
      .patch(`${branchPath}/outlines/${chapterOutline.id}`)
      .send({ chapterGoal: '沈砚在断碑前听见母亲的声音。' })
      .expect(200);

    const compared = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(201);

    expect(compared.body).toMatchObject({
      sourceBranch: {
        id: work.mainBranchId,
        name: 'main',
      },
      comparedBranch: {
        id: created.body.id,
        name: '断碑之前',
      },
    });
    expect(compared.body.settings).toEqual([
      expect.objectContaining({
        label: '临渊城',
        status: 'changed',
        conflict: false,
        fields: expect.arrayContaining([
          expect.objectContaining({
            field: 'summary',
            before: '东荒边境的小城。',
            after: '断碑以东的小城。',
          }),
        ]),
      }),
    ]);
    expect(compared.body.outlines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: expect.stringContaining('第 1 章'),
          status: 'changed',
          conflict: false,
          fields: expect.arrayContaining([
            expect.objectContaining({
              field: 'chapterGoal',
              after: '沈砚在断碑前听见母亲的声音。',
            }),
          ]),
        }),
      ]),
    );
    expect(compared.body.chapters).toEqual([
      expect.objectContaining({
        label: expect.stringContaining('第 1 章'),
        status: 'changed',
        conflict: false,
        fields: expect.arrayContaining([
          expect.objectContaining({
            field: 'content',
            before: '沈砚在断碑前听见了母亲的回音。',
            after: '沈砚听见剑鸣。',
          }),
        ]),
      }),
    ]);
    expect(compared.body.summary).toMatchObject({
      settingsChanged: 1,
      outlinesChanged: 1,
      chaptersChanged: 1,
      conflicts: 0,
    });

    const mainEntities = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/entities`)
      .expect(200);
    const mainEntity = mainEntities.body.items.find(
      (item: { name: string }) => item.name === '临渊城',
    );
    await author.agent
      .patch(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/entities/${mainEntity.id}`)
      .send({ summary: '主线也把临渊城挪到了断碑以西。' })
      .expect(200);
    const conflicted = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(201);
    expect(conflicted.body.settings[0]).toMatchObject({
      conflict: true,
      status: 'changed',
    });
    expect(conflicted.body.summary.conflicts).toBe(1);
  });

  it('cherry-picks only the selected chapter, setting, and outline into the main line', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const versions = await insertChapterVersions(app, work.id, work.mainBranchId, author.userId);
    const database = app.get(DatabaseService);
    await database.pool.query(
      `insert into entities
         (work_id, branch_id, name, type, summary, description, tags, scope, status, source)
       values ($1, $2, '临渊城', 'map', '东荒边境的小城。', '', '[]', 'work', 'draft', '作者录入')`,
      [work.id, work.mainBranchId],
    );
    await database.pool.query(
      `insert into chapter_outlines
         (work_id, branch_id, level, order_index, title, summary, details, chapter_number, chapter_goal)
       values ($1, $2, 'chapter', 1, '旧城门', '', '', 2, '主线原本的第二章大纲。')`,
      [work.id, work.mainBranchId],
    );

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: versions.firstVersionId,
        name: '只摘断碑',
        reason: '只取回断碑这一章的写法。',
        kind: 'rewrite',
      })
      .expect(201);

    const branchPath = `/api/v1/works/${work.id}/branches/${created.body.id}`;
    const branchEntities = await author.agent.get(`${branchPath}/entities`).expect(200);
    const branchEntity = branchEntities.body.items.find(
      (item: { name: string }) => item.name === '临渊城',
    );
    await author.agent
      .patch(`${branchPath}/entities/${branchEntity.id}`)
      .send({ summary: '断碑以东的小城。' })
      .expect(200);

    const branchOutlines = await author.agent.get(`${branchPath}/outlines`).expect(200);
    const branchOutline = branchOutlines.body.items.find(
      (item: { chapterNumber: number }) => item.chapterNumber === 1,
    );
    const untouchedBranchOutline = branchOutlines.body.items.find(
      (item: { chapterNumber: number }) => item.chapterNumber === 2,
    );
    await author.agent
      .patch(`${branchPath}/outlines/${branchOutline.id}`)
      .send({ chapterGoal: '从平行版本摘取的大纲。' })
      .expect(200);
    await author.agent
      .patch(`${branchPath}/outlines/${untouchedBranchOutline.id}`)
      .send({ chapterGoal: '这个大纲不应被自动带回主线。' })
      .expect(200);

    const comparison = await author.agent
      .post(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(201);
    const branchChapter = comparison.body.chapters.find((item: { label: string }) =>
      item.label.includes('第 1 章'),
    );

    const pickedResponse = await author.agent.post(`${branchPath}/cherry-pick`).send({
      targetBranchId: work.mainBranchId,
      items: [
        { type: 'chapter', id: branchChapter.comparedId },
        { type: 'setting', id: branchEntity.id },
        { type: 'outline', id: branchOutline.id },
      ],
    });
    expect(pickedResponse.status, JSON.stringify(pickedResponse.body)).toBe(201);
    const picked = pickedResponse;

    expect(picked.body).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          type: 'chapter',
          status: 'applied',
          changeRequestId: expect.any(String),
        }),
        expect.objectContaining({
          type: 'setting',
          status: 'applied',
          changeRequestId: expect.any(String),
        }),
        expect.objectContaining({
          type: 'outline',
          status: 'applied',
          changeRequestId: expect.any(String),
        }),
      ]),
      summary: {
        applied: 3,
        pending: 0,
        skipped: 0,
      },
    });
    expect(branchChapter).toMatchObject({ status: 'changed' });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toBe('沈砚听见剑鸣。');
      });
    const mainEntities = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/entities`)
      .expect(200);
    expect(
      mainEntities.body.items.find((item: { name: string }) => item.name === '临渊城'),
    ).toMatchObject({ summary: '断碑以东的小城。' });
    const mainOutlines = await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/outlines`)
      .expect(200);
    expect(
      mainOutlines.body.items.find((item: { chapterNumber: number }) => item.chapterNumber === 1),
    ).toMatchObject({ chapterGoal: '从平行版本摘取的大纲。' });
    expect(
      mainOutlines.body.items.find((item: { chapterNumber: number }) => item.chapterNumber === 2),
    ).toMatchObject({ chapterGoal: '主线原本的第二章大纲。' });
  });

  it('isolates parallel versions by author and work', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const versions = await insertChapterVersions(app, work.id, work.mainBranchId, author.userId);

    const created = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        sourceBranchId: work.mainBranchId,
        versionPointId: versions.firstVersionId,
        name: '只属于作者',
        reason: '验证作品之间互不影响。',
        kind: 'experiment',
      })
      .expect(201);

    await otherAuthor.agent
      .get(`/api/v1/works/${work.id}/branches`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await author.agent
      .post(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/compare`)
      .send({ withBranchId: created.body.id })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('BRANCH_NOT_FOUND');
      });
    await author.agent
      .post(`/api/v1/works/${work.id}/branches/${created.body.id}/cherry-pick`)
      .send({
        targetBranchId: otherWork.mainBranchId,
        items: [{ type: 'chapter', id: randomUUID() }],
      })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('BRANCH_NOT_FOUND');
      });
  });
});
