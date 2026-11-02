import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

function uniqueEmail(): string {
  return `works-${randomUUID()}@example.com`;
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
    email,
    userId: login.body.id as string,
  };
}

async function createWork(
  agent: ReturnType<typeof request.agent>,
  overrides: Partial<{
    title: string;
    penName: string;
    genrePack: 'xianxia' | 'history' | 'urban';
    scale: 'short' | 'medium' | 'long' | 'epic';
    targetPlatform: string;
  }> = {},
) {
  const response = await agent
    .post('/api/v1/works')
    .send({
      title: `测试作品-${randomUUID()}`,
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'long',
      targetPlatform: '起点中文网',
      ...overrides,
    })
    .expect(201);
  return response.body as {
    id: string;
    title: string;
    status: string;
    mainBranch: { id: string };
  };
}

describe('works API', () => {
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

  it('requires a signed-in author', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/works')
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .post('/api/v1/works')
      .send({
        title: '仙途',
        penName: '青云客',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(401);
  });

  it('creates the work with its main branch and isolates every work by account', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);

    const created = await author.agent
      .post('/api/v1/works')
      .send({
        title: '仙途万里',
        penName: '青云客',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      title: '仙途万里',
      penName: '青云客',
      genrePack: 'xianxia',
      scale: 'long',
      targetPlatform: '起点中文网',
      status: 'preparing',
      statusLabel: '筹备中',
      wordCount: 0,
      progressPercent: 0,
      mainBranch: {
        name: 'main',
        isMain: true,
      },
    });
    expect(created.body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(created.body.lastEditedAt).toBeTruthy();

    const database = app.get(DatabaseService);
    const storedWork = await database.pool.query<{
      user_id: string;
      status: string;
    }>('select user_id, status from works where id = $1', [created.body.id]);
    expect(storedWork.rows).toEqual([{ user_id: author.userId, status: 'preparing' }]);

    const storedBranches = await database.pool.query<{
      name: string;
      is_main: boolean;
      created_by: string;
    }>('select name, is_main, created_by from work_branches where work_id = $1', [created.body.id]);
    expect(storedBranches.rows).toEqual([
      { name: 'main', is_main: true, created_by: author.userId },
    ]);

    await author.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: created.body.id,
          title: '仙途万里',
          status: 'preparing',
          statusLabel: '筹备中',
          wordCount: 0,
          progressPercent: 0,
        });
        expect(body.items[0].lastEditedAt).toBeTruthy();
      });

    await author.agent
      .get(`/api/v1/works/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.mainBranch.id).toBe(created.body.mainBranch.id);
      });

    await otherAuthor.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await otherAuthor.agent
      .get(`/api/v1/works/${created.body.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
  });

  it('creates a history work with the alternate-ancient main template', async () => {
    const author = await createAuthor(app, passwordHash);

    const created = await author.agent
      .post('/api/v1/works')
      .send({
        title: '北境争鼎',
        penName: '朔风客',
        genrePack: 'history',
        genreVariant: 'transmigration_hegemony',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      title: '北境争鼎',
      genrePack: 'history',
      genrePackLabel: '历史',
      genreVariant: 'transmigration_hegemony',
      genreVariantLabel: '穿越争霸',
      mainTemplate: '架空古代',
      status: 'preparing',
      mainBranch: {
        name: 'main',
        isMain: true,
      },
    });

    const stored = await app
      .get(DatabaseService)
      .pool.query<{ genre_pack: string; genre_variant: string }>(
        'select genre_pack, genre_variant from works where id = $1',
        [created.body.id],
      );
    expect(stored.rows).toEqual([
      {
        genre_pack: 'history',
        genre_variant: 'transmigration_hegemony',
      },
    ]);

    await author.agent
      .post('/api/v1/works')
      .send({
        title: '错配题材',
        penName: '朔风客',
        genrePack: 'xianxia',
        genreVariant: 'alternate_ancient',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });
  });

  it('reports word count and completion progress from the main branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const created = await author.agent
      .post('/api/v1/works')
      .send({
        title: '断碑进度',
        penName: '青云客',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201);
    const base = `/api/v1/works/${created.body.id}/branches/${created.body.mainBranch.id}`;

    await author.agent
      .put(`${base}/chapter-outlines/1`)
      .send({
        chapterGoal: '沈砚听见剑鸣。',
        pov: '沈砚',
        sceneBeats: ['断碑'],
        chapterEndHook: '黑暗里有人叫出母亲的名字。',
      })
      .expect(200);
    await author.agent
      .put(`${base}/chapter-outlines/2`)
      .send({
        chapterGoal: '城门下出现陌生人。',
        pov: '沈砚',
        sceneBeats: ['城门'],
        chapterEndHook: '陌生人露出焚毁的家纹。',
      })
      .expect(200);
    await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '沈砚听见剑鸣。' })
      .expect(201);
    await author.agent
      .post(`${base}/chapters/2/versions`)
      .send({ content: '城门下站着一个陌生人。' })
      .expect(201);
    await app
      .get(DatabaseService)
      .pool.query(
        `update chapters set status = 'locked' where work_id = $1 and chapter_number = 1`,
        [created.body.id],
      );

    await author.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items[0]).toMatchObject({
          id: created.body.id,
          wordCount: 16,
          progressPercent: 50,
        });
      });
    await author.agent
      .get(`/api/v1/works/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          wordCount: 16,
          progressPercent: 50,
        });
      });
  });

  it('rejects incomplete work details without creating a branch', async () => {
    const author = await createAuthor(app, passwordHash);

    await author.agent
      .post('/api/v1/works')
      .send({
        title: '',
        penName: '青云客',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    const stored = await app
      .get(DatabaseService)
      .pool.query<{ count: string }>('select count(*) from works where user_id = $1', [
        author.userId,
      ]);
    expect(stored.rows[0].count).toBe('0');
  });

  it('archives, restores, soft-deletes, and recovers works without crossing accounts', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, { title: '可恢复的作品' });

    await author.agent
      .patch(`/api/v1/works/${work.id}`)
      .send({ status: 'serializing' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('serializing');
        expect(body.statusLabel).toBe('连载中');
      });

    await otherAuthor.agent.post(`/api/v1/works/${work.id}/archive`).expect(404);
    await author.agent
      .post(`/api/v1/works/${work.id}/archive`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('archived');
        expect(body.statusLabel).toBe('已归档');
      });

    await author.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
    await author.agent
      .get('/api/v1/works?view=archived')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0].id).toBe(work.id);
      });

    await author.agent
      .post(`/api/v1/works/${work.id}/restore`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('serializing');
        expect(body.archivedAt).toBeNull();
      });

    await author.agent.delete(`/api/v1/works/${work.id}`).expect(204);
    await otherAuthor.agent.post(`/api/v1/works/${work.id}/restore`).expect(404);
    await author.agent
      .get('/api/v1/works')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
    await author.agent
      .get('/api/v1/works?view=trash')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({ id: work.id, deletedAt: expect.any(String) });
      });

    await author.agent
      .post(`/api/v1/works/${work.id}/recover`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.status).toBe('serializing');
        expect(body.deletedAt).toBeNull();
      });

    const audit = await app.get(DatabaseService).pool.query<{ action: string }>(
      `select action from audit_logs
         where work_id = $1
         order by created_at asc`,
      [work.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'work_status_changed',
        'work_archived',
        'work_restored',
        'work_deleted',
      ]),
    );

    await author.agent.delete(`/api/v1/works/${work.id}`).expect(204);
    await app
      .get(DatabaseService)
      .pool.query(`update works set deleted_at = now() - interval '31 days' where id = $1`, [
        work.id,
      ]);
    await author.agent
      .post(`/api/v1/works/${work.id}/recover`)
      .expect(410)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_RESTORE_EXPIRED');
      });
  });

  it('searches and filters the library while reporting quality and unused foreshadow metrics', async () => {
    const author = await createAuthor(app, passwordHash);
    const marked = await createWork(author.agent, {
      title: '断碑纪事',
      genrePack: 'xianxia',
      scale: 'long',
    });
    const quiet = await createWork(author.agent, {
      title: '北境争鼎',
      genrePack: 'history',
      scale: 'epic',
    });
    const base = `/api/v1/works/${marked.id}/branches/${marked.mainBranch.id}`;

    await author.agent
      .put(`${base}/chapter-outlines/1`)
      .send({
        chapterGoal: '沈砚在断碑前找到旧案线索。',
        pov: '沈砚',
        sceneBeats: ['辨认断碑'],
        chapterEndHook: '碑后传来剑鸣。',
      })
      .expect(200);
    const version = await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '沈砚按住断碑，听见雨里的剑鸣。' })
      .expect(201);

    await author.agent
      .patch(`/api/v1/works/${marked.id}`)
      .send({ status: 'serializing' })
      .expect(200);
    await author.agent.patch(`/api/v1/works/${quiet.id}`).send({ status: 'paused' }).expect(200);

    const database = app.get(DatabaseService);
    const chapter = await database.pool.query<{ id: string }>(
      `select id from chapters where work_id = $1 and chapter_number = 1`,
      [marked.id],
    );
    const chapterId = chapter.rows[0].id;
    expect(version.body.chapterNumber).toBe(1);

    await database.pool.query(
      `insert into quality_reports (work_id, branch_id, chapter_id, report)
       values ($1, $2, $3, $4::jsonb)
       on conflict (chapter_id) do update set report = excluded.report`,
      [
        marked.id,
        marked.mainBranch.id,
        chapterId,
        JSON.stringify({
          summary: '整体稳定。',
          dimensions: [
            { key: 'hook', status: 'good' },
            { key: 'pacing', status: 'good' },
            { key: 'information_density', status: 'good' },
            { key: 'character_voice', status: 'watch' },
            { key: 'prose', status: 'watch' },
            { key: 'continuity', status: 'weak' },
          ],
          issueCounts: { ai_tone: 1 },
        }),
      ],
    );
    await database.pool.query(
      `insert into foreshadows
         (work_id, branch_id, title, description, setup_chapter, planned_payoff_chapter, status, importance)
       values
         ($1, $2, '旧家纹', '断碑后的家纹', 1, 4, 'planted', 'must'),
         ($1, $2, '雨夜脚步', '站在雨里的陌生人', 1, 5, 'planted', 'optional'),
         ($1, $2, '母亲的剑', '已经找回的旧剑', 1, 2, 'paid_off', 'must')`,
      [marked.id, marked.mainBranch.id],
    );

    await author.agent
      .get('/api/v1/works?search=断碑')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: marked.id,
          qualityScore: 80,
          unresolvedForeshadowCount: 2,
          readOnly: false,
        });
      });

    await author.agent
      .get('/api/v1/works?genrePack=history&status=paused')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((item: { id: string }) => item.id)).toEqual([quiet.id]);
      });

    await author.agent
      .get('/api/v1/works?sort=word_count_desc&minWordCount=1&recentDays=7')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items.map((item: { id: string }) => item.id)).toEqual([marked.id]);
      });
  });

  it('copies the story bible, settings, and outline without copying prose', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, { title: '同世界观新书' });
    const branchId = work.mainBranch.id;
    const database = app.get(DatabaseService);

    await database.pool.query(
      `insert into story_bibles (work_id, branch_id, one_sentence_story, protagonist, world_iron_law, cards)
       values ($1, $2, '主角追查断碑旧案。', '沈砚', '记忆有代价。', '[]'::jsonb)`,
      [work.id, branchId],
    );
    await database.pool.query(
      `insert into entities
         (work_id, branch_id, name, type, summary, description, scope, status, source)
       values ($1, $2, '沈砚', 'character', '年轻剑客', '左手旧伤', 'work', 'locked', '作者录入')`,
      [work.id, branchId],
    );
    await database.pool.query(
      `insert into chapter_outlines
         (work_id, branch_id, level, title, summary, chapter_number, chapter_goal, pov, scene_beats, chapter_end_hook)
       values ($1, $2, 'chapter', '第一章 断碑', '追查旧案', 1, '追查旧案', '沈砚', '["断碑"]'::jsonb, '剑鸣')`,
      [work.id, branchId],
    );
    await database.pool.query(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, word_count, summary, hook, autosave_content)
       values ($1, $2, 1, '第一章 断碑', 'writing', 8, '', '', '沈砚按住断碑。')`,
      [work.id, branchId],
    );

    await otherAuthor.agent.post(`/api/v1/works/${work.id}/duplicate`).expect(404);
    const copied = await author.agent
      .post(`/api/v1/works/${work.id}/duplicate`)
      .send({ title: '同世界观新书·续篇' })
      .expect(201);

    expect(copied.body).toMatchObject({
      title: '同世界观新书·续篇',
      status: 'preparing',
      wordCount: 0,
      mainBranch: { isMain: true },
    });
    expect(copied.body.id).not.toBe(work.id);
    expect(copied.body.mainBranch.id).not.toBe(branchId);

    const copiedCounts = await database.pool.query<{
      story_bibles: string;
      entities: string;
      outlines: string;
      chapters: string;
    }>(
      `select
         (select count(*) from story_bibles where work_id = $1)::text as story_bibles,
         (select count(*) from entities where work_id = $1)::text as entities,
         (select count(*) from chapter_outlines where work_id = $1)::text as outlines,
         (select count(*) from chapters where work_id = $1)::text as chapters`,
      [copied.body.id],
    );
    expect(copiedCounts.rows[0]).toEqual({
      story_bibles: '1',
      entities: '1',
      outlines: '1',
      chapters: '0',
    });
    const outline = await database.pool.query<{ title: string; work_id: string }>(
      `select title, work_id from chapter_outlines where work_id = $1`,
      [copied.body.id],
    );
    expect(outline.rows).toEqual([{ title: '第一章 断碑', work_id: copied.body.id }]);

    const audit = await database.pool.query<{ action: string }>(
      `select action from audit_logs where work_id = $1`,
      [work.id],
    );
    expect(audit.rows.map((row) => row.action)).toContain('work_duplicated');
  });

  it('imports markdown and Word manuscripts into preserved chapter versions', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, { title: '导入旧稿' });
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    await otherAuthor.agent
      .post(`/api/v1/works/${work.id}/import`)
      .send({
        fileName: '旧稿.md',
        content: '# 第一章 断碑\n沈砚按住断碑。\n\n# 第二章 城门\n城门下有人等他。',
      })
      .expect(404);

    const imported = await author.agent
      .post(`/api/v1/works/${work.id}/import`)
      .send({
        fileName: '旧稿.md',
        content: '# 第一章 断碑\n沈砚按住断碑。\n\n# 第二章 城门\n城门下有人等他。',
      })
      .expect(201);
    expect(imported.body).toMatchObject({
      workId: work.id,
      branchId: work.mainBranch.id,
      format: 'markdown',
      chapterCount: 2,
    });
    expect(imported.body.wordCount).toBeGreaterThan(0);

    await author.agent
      .get(`${base}/chapters`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(2);
        expect(body.items[0].title).toBe('第一章 断碑');
        expect(body.items[1].title).toBe('第二章 城门');
      });
    await author.agent
      .get(`${base}/chapters/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.content).toContain('沈砚按住断碑。');
        expect(body.versions).toHaveLength(1);
      });

    const docxWork = await createWork(author.agent, { title: '导入 Word' });
    const docx = new JSZip();
    docx.file(
      'word/document.xml',
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
        '<w:body>',
        '<w:p><w:r><w:t>第1章 旧城门</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>风从城门下吹过。</w:t></w:r></w:p>',
        '</w:body></w:document>',
      ].join(''),
    );
    const base64 = (await docx.generateAsync({ type: 'nodebuffer' })).toString('base64');
    await author.agent
      .post(`/api/v1/works/${docxWork.id}/import`)
      .send({ fileName: '旧稿.docx', contentBase64: base64 })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ format: 'docx', chapterCount: 1 });
      });

    await author.agent
      .post('/api/v1/works/import')
      .send({
        title: '一步导入旧稿',
        penName: '青云客',
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
        fileName: '一步导入.txt',
        content: '第一章 起风\n风从山门吹进来。',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          chapterCount: 1,
          work: { title: '一步导入旧稿', status: 'serializing' },
        });
        expect(body.workId).toBe(body.work.id);
      });
  });

  it('keeps completed works read-only until reopened or continued in a parallel version', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, { title: '已经完本的书' });
    const base = `/api/v1/works/${work.id}/branches/${work.mainBranch.id}`;

    await author.agent
      .put(`${base}/chapter-outlines/1`)
      .send({
        chapterGoal: '主角收束旧案。',
        pov: '沈砚',
        sceneBeats: ['旧案收束'],
        chapterEndHook: '新书开始。',
      })
      .expect(200);
    await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '旧案终于收束。' })
      .expect(201);
    await author.agent
      .patch(`/api/v1/works/${work.id}`)
      .send({ status: 'completed' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.readOnly).toBe(true);
      });

    await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '试图悄悄修改结尾。' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_COMPLETED_READ_ONLY');
        expect(body.details).toMatchObject({ canReopen: true, canCreateParallel: true });
      });
    await author.agent
      .put(`${base}/chapter-outlines/2`)
      .send({
        chapterGoal: '不该写入。',
        pov: '沈砚',
        sceneBeats: ['不该写入'],
        chapterEndHook: '不该写入。',
      })
      .expect(409);

    const parallel = await author.agent
      .post(`/api/v1/works/${work.id}/branches`)
      .send({
        name: '完本后实验线',
        sourceBranchId: work.mainBranch.id,
        kind: 'experiment',
        reason: '尝试另一个结尾',
      })
      .expect(201);
    await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '主线仍然只读。' })
      .expect(409);
    const parallelBase = `/api/v1/works/${work.id}/branches/${parallel.body.id}`;
    await author.agent
      .post(`${parallelBase}/chapters/1/versions`)
      .send({ content: '在平行版本里尝试另一个结尾。' })
      .expect(201);

    await author.agent
      .patch(`/api/v1/works/${work.id}`)
      .send({ status: 'serializing' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('serializing');
        expect(body.readOnly).toBe(false);
      });
    await author.agent
      .post(`${base}/chapters/1/versions`)
      .send({ content: '重新开启后可以继续修改。' })
      .expect(201);

    await author.agent.patch(`/api/v1/works/${work.id}`).send({ status: 'completed' }).expect(200);
    await author.agent
      .post(`/api/v1/works/${work.id}/import`)
      .send({ fileName: '旧稿.txt', content: '第一章 不该导入' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_COMPLETED_READ_ONLY');
      });

    expect(parallel.body.id).toBeTruthy();
  });
});
