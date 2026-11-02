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
  return `outlines-${randomUUID()}@example.com`;
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

async function createParallelBranch(
  app: INestApplication,
  workId: string,
  userId: string,
  name: string,
): Promise<string> {
  const result = await app.get(DatabaseService).pool.query<{ id: string }>(
    `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, $2, false, 'active', $3)
       returning id`,
    [workId, name, userId],
  );
  return result.rows[0].id;
}

function outlinePath(workId: string, branchId: string, suffix = ''): string {
  return `/api/v1/works/${workId}/branches/${branchId}/outlines${suffix}`;
}

async function createNode(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  body: Record<string, unknown>,
) {
  const response = await agent.post(outlinePath(workId, branchId)).send(body).expect(201);
  return response.body as {
    id: string;
    title: string;
    summary: string;
    level: string;
    parentId: string | null;
    orderIndex: number;
    chapterNumber: number | null;
    chapterGoal: string;
    pov: string;
    sceneBeats: string[];
    chapterEndHook: string;
    details: string;
    locked: boolean;
    version: number;
  };
}

async function createCompleteTree(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
) {
  const book = await createNode(agent, workId, branchId, {
    level: 'book',
    title: '九门总纲',
    summary: '沈砚沿九座天门追查母亲失踪的真相。',
    details: '全书以记忆代价推进，每卷解决一座天门。',
  });
  const volume = await createNode(agent, workId, branchId, {
    level: 'volume',
    parentId: book.id,
    title: '第一卷 天门初开',
    summary: '沈砚从边城进入荒寺，第一次借来亡者之剑。',
    details: '卷末必须揭开母亲记忆被人为改写的线索。',
  });
  const act = await createNode(agent, workId, branchId, {
    level: 'act',
    parentId: volume.id,
    title: '第一幕 断碑雨夜',
    summary: '沈砚在追兵围堵下触发断碑。',
    details: '目标、阻碍、转折和高潮都围绕残剑认主展开。',
  });
  const chapter = await createNode(agent, workId, branchId, {
    level: 'chapter',
    parentId: act.id,
    title: '第一章 断碑',
    summary: '沈砚第一次引动残剑，并付出记忆代价。',
    details: '',
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
  });
  const scene = await createNode(agent, workId, branchId, {
    level: 'scene',
    parentId: chapter.id,
    title: '荒寺避雨',
    summary: '沈砚在断碑前躲避追兵，发现碑面剑痕。',
    details: '场景从雨声切入，以第一次剑鸣收束。',
  });

  return { book, volume, act, chapter, scene };
}

function completeStoryBibleCards() {
  return [
    ['oneSentence', '一句话故事'],
    ['sellingPoints', '核心卖点'],
    ['protagonist', '主角'],
    ['goldenFinger', '金手指'],
    ['worldIronLaws', '世界铁律'],
    ['mainPlot', '主线'],
    ['subplots', '支线'],
    ['ending', '结局方向'],
    ['readerPromise', '读者承诺'],
  ].map(([key, title]) => ({
    key,
    summary: `${title}已经确认。`,
    details: '',
  }));
}

describe('full outline API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.AI_PROVIDER = 'fake';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/12';
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
    const workId = randomUUID();
    const branchId = randomUUID();

    await request(app.getHttpServer())
      .get(outlinePath(workId, branchId))
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
    await request(app.getHttpServer())
      .get(`/api/v1/works/${workId}/branches/${branchId}/outline/readiness`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('creates, edits, reorders, and deletes volume, chapter, and scene nodes', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const tree = await createCompleteTree(author.agent, work.id, work.mainBranchId);

    const secondVolume = await createNode(author.agent, work.id, work.mainBranchId, {
      level: 'volume',
      parentId: tree.book.id,
      title: '第二卷 雪海旧名',
      summary: '沈砚在雪海寻找第二座天门。',
      details: '',
    });
    const secondChapter = await createNode(author.agent, work.id, work.mainBranchId, {
      level: 'chapter',
      parentId: tree.act.id,
      title: '第二章 归城',
      summary: '沈砚带着残剑回到边城。',
      details: '',
      chapterGoal: '沈砚发现边城已经无人记得母亲。',
      pov: '沈砚',
      sceneBeats: ['城门戒严', '旧友认不出沈砚', '通缉令贴满城墙'],
      chapterEndHook: '通缉令上的画像，画的是三年后的他。',
    });
    const removableScene = await createNode(author.agent, work.id, work.mainBranchId, {
      level: 'scene',
      parentId: tree.chapter.id,
      title: '暂删场景',
      summary: '这个场景用于验证删除。',
      details: '',
    });

    expect(tree.book).toMatchObject({
      level: 'book',
      parentId: null,
      orderIndex: 0,
      chapterNumber: null,
    });
    expect(tree.volume).toMatchObject({
      level: 'volume',
      parentId: tree.book.id,
      orderIndex: 0,
    });
    expect(tree.act).toMatchObject({ level: 'act', parentId: tree.volume.id, orderIndex: 0 });
    expect(tree.chapter).toMatchObject({
      level: 'chapter',
      parentId: tree.act.id,
      orderIndex: 0,
      chapterNumber: 1,
    });
    expect(tree.scene).toMatchObject({ level: 'scene', parentId: tree.chapter.id, orderIndex: 0 });
    expect(secondChapter.chapterNumber).toBe(2);

    await author.agent
      .patch(outlinePath(work.id, work.mainBranchId, `/${tree.volume.id}`))
      .send({
        title: '第一卷 天门初醒',
        summary: '沈砚第一次借来亡者之剑，并忘记母亲的名字。',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          title: '第一卷 天门初醒',
          summary: '沈砚第一次借来亡者之剑，并忘记母亲的名字。',
        });
      });
    await author.agent
      .patch(outlinePath(work.id, work.mainBranchId, `/${tree.chapter.id}`))
      .send({
        summary: '沈砚在断碑前做出不可逆的选择。',
        chapterGoal: '沈砚第一次引动残剑，并确认记忆会被真实抹去。',
        sceneBeats: ['荒寺避雨', '断碑剑鸣', '残剑认主'],
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          summary: '沈砚在断碑前做出不可逆的选择。',
          chapterGoal: '沈砚第一次引动残剑，并确认记忆会被真实抹去。',
          sceneBeats: ['荒寺避雨', '断碑剑鸣', '残剑认主'],
        });
      });
    await author.agent
      .patch(outlinePath(work.id, work.mainBranchId, `/${tree.scene.id}`))
      .send({
        title: '荒寺听雨',
        details: '雨声压住追兵脚步，断碑在闪电里显出旧剑痕。',
      })
      .expect(200);

    await author.agent
      .post(outlinePath(work.id, work.mainBranchId, '/reorder'))
      .send({
        parentId: tree.book.id,
        orderedIds: [secondVolume.id, tree.volume.id],
      })
      .expect(201);

    await author.agent
      .get(outlinePath(work.id, work.mainBranchId))
      .expect(200)
      .expect(({ body }) => {
        const volumes = body.items.filter((node: { level: string }) => node.level === 'volume');
        expect(volumes.map((node: { id: string }) => node.id)).toEqual([
          secondVolume.id,
          tree.volume.id,
        ]);
        expect(volumes.map((node: { orderIndex: number }) => node.orderIndex)).toEqual([0, 1]);
        expect(body.items.every((node: { levelLabel: string }) => node.levelLabel)).toBe(true);
      });

    await author.agent
      .delete(outlinePath(work.id, work.mainBranchId, `/${removableScene.id}`))
      .expect(204);
    await author.agent
      .delete(outlinePath(work.id, work.mainBranchId, `/${secondChapter.id}`))
      .expect(204);
    await author.agent
      .delete(outlinePath(work.id, work.mainBranchId, `/${secondVolume.id}`))
      .expect(204);

    await author.agent
      .get(outlinePath(work.id, work.mainBranchId, `/${removableScene.id}`))
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('OUTLINE_NOT_FOUND');
      });
  });

  it('isolates outline nodes by author, work, and branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const parallelBranch = await createParallelBranch(
      app,
      work.id,
      author.userId,
      'another-ending',
    );
    const tree = await createCompleteTree(author.agent, work.id, work.mainBranchId);

    await otherAuthor.agent
      .get(outlinePath(work.id, work.mainBranchId))
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await author.agent
      .get(outlinePath(otherWork.id, otherWork.mainBranchId, `/${tree.chapter.id}`))
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('OUTLINE_NOT_FOUND');
      });
    await author.agent
      .get(outlinePath(work.id, parallelBranch, `/${tree.chapter.id}`))
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('OUTLINE_NOT_FOUND');
      });

    await author.agent
      .get(outlinePath(work.id, parallelBranch))
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
  });

  it('locks and unlocks nodes and requires confirmation before locked edits', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const tree = await createCompleteTree(author.agent, work.id, work.mainBranchId);
    const chapterPath = outlinePath(work.id, work.mainBranchId, `/${tree.chapter.id}`);

    await author.agent
      .post(`${chapterPath}/lock`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.locked).toBe(true);
        expect(body.lockedAt).toEqual(expect.any(String));
      });

    await author.agent
      .patch(chapterPath)
      .send({ title: '第一章 改过的断碑' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('OUTLINE_LOCKED');
        expect(body.details).toMatchObject({
          requiresConfirmation: true,
          reasonRequired: true,
        });
      });
    await author.agent
      .get(chapterPath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe('第一章 断碑');
      });

    await author.agent
      .patch(chapterPath)
      .send({ title: '第一章 改过的断碑', confirmLockedChange: true })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    const changeReason = '已写正文把断碑改成了木牌，章纲需要与正文一致。';
    await author.agent
      .patch(chapterPath)
      .send({
        title: '第一章 改过的断碑',
        confirmLockedChange: true,
        changeReason,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.title).toBe('第一章 改过的断碑');
        expect(body.locked).toBe(true);
      });

    await author.agent
      .post(`${chapterPath}/unlock`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.locked).toBe(false);
        expect(body.lockedAt).toBeNull();
      });
    await author.agent.patch(chapterPath).send({ title: '第一章 断碑再开' }).expect(200);

    await author.agent.post(`${chapterPath}/lock`).expect(201);
    await author.agent.delete(chapterPath).expect(409);
    await author.agent
      .delete(chapterPath)
      .send({
        confirmLockedChange: true,
        changeReason: '这一章并入下一章，章纲不再单独保留。',
      })
      .expect(204);
  });

  it('regenerates only the selected node and preserves every other node', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const tree = await createCompleteTree(author.agent, work.id, work.mainBranchId);

    await author.agent
      .post('/api/v1/model-configs')
      .send({
        name: '规划模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-reasoner',
        apiKey: 'planning-key',
        purpose: 'planning',
      })
      .expect(201);

    const before = await author.agent.get(outlinePath(work.id, work.mainBranchId)).expect(200);
    const siblings = before.body.items.filter(
      (node: { id: string }) => node.id !== tree.chapter.id,
    );

    await author.agent
      .post(outlinePath(work.id, work.mainBranchId, `/${tree.chapter.id}/regenerate`))
      .send({ instruction: '让断碑后的选择更残酷，但保留原有章末钩子。' })
      .expect(201)
      .expect(({ body }) => {
        expect(body.id).toBe(tree.chapter.id);
        expect(body.summary).not.toBe(tree.summary);
        expect(body.summary).toContain('重生成');
        expect(body.version).toBeGreaterThan(tree.chapter.version);
      });

    await author.agent
      .get(outlinePath(work.id, work.mainBranchId))
      .expect(200)
      .expect(({ body }) => {
        const untouched = body.items.filter((node: { id: string }) => node.id !== tree.chapter.id);
        expect(untouched).toEqual(siblings);
      });
  });

  it('reports outline, settings, confirmed facts, and model key readiness', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const readinessPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/outline/readiness`;

    await author.agent
      .get(`${readinessPath}?chapterNumber=1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          ready: false,
          checks: {
            outline: { ready: false },
            settings: { ready: false },
            confirmedFacts: { ready: true },
            modelKey: { ready: false },
          },
        });
        expect(body.checks.outline.missing).toContain('全书总纲');
        expect(body.checks.settings.missing).toEqual(
          expect.arrayContaining(['故事圣经', '设定条目']),
        );
        expect(body.checks.modelKey.missing).toContain('模型配置');
      });

    await createCompleteTree(author.agent, work.id, work.mainBranchId);
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`)
      .send({ cards: completeStoryBibleCards() })
      .expect(200);
    await app.get(DatabaseService).pool.query(
      `insert into entities (work_id, branch_id, name, type, summary, status)
       values ($1, $2, '沈砚', 'character', '边城剑客', 'canon')`,
      [work.id, work.mainBranchId],
    );
    await author.agent
      .post('/api/v1/model-configs')
      .send({
        name: '规划模型',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-reasoner',
        apiKey: 'planning-key',
        purpose: 'planning',
      })
      .expect(201);

    await author.agent
      .get(`${readinessPath}?chapterNumber=1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.ready).toBe(true);
        expect(body.checks.outline).toMatchObject({
          ready: true,
          detail: '全书、卷、幕和章均已就绪。',
        });
        expect(body.checks.settings).toMatchObject({
          ready: true,
          detail: '故事圣经完整，已有 1 个设定条目。',
        });
        expect(body.checks.confirmedFacts).toMatchObject({
          ready: true,
          detail: '已有 0 条已确认设定，首次生成前无需前序事实。',
        });
        expect(body.checks.modelKey).toMatchObject({
          ready: true,
          detail: '规划模型“规划模型”已配置。',
        });
      });

    const chapter = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into chapters
         (work_id, branch_id, chapter_number, title, status, current_version_id)
       values ($1, $2, 1, '第一章 断碑', 'writing', $3)
       returning id`,
      [work.id, work.mainBranchId, randomUUID()],
    );
    await author.agent
      .get(`${readinessPath}?chapterNumber=1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.ready).toBe(false);
        expect(body.checks.confirmedFacts).toMatchObject({
          ready: false,
          missing: ['已确认设定'],
        });
      });

    const proposal = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into fact_proposals
         (work_id, branch_id, chapter_id, type, statement, source_sentence, status)
       values ($1, $2, $3, 'event', '沈砚触发断碑。', '沈砚以血触发断碑。', 'confirmed')
       returning id`,
      [work.id, work.mainBranchId, chapter.rows[0].id],
    );
    await app.get(DatabaseService).pool.query(
      `insert into facts
         (work_id, branch_id, chapter_id, source_proposal_id, type, statement, source_sentence)
       values ($1, $2, $3, $4, 'event', '沈砚触发断碑。', '沈砚以血触发断碑。')`,
      [work.id, work.mainBranchId, chapter.rows[0].id, proposal.rows[0].id],
    );

    await author.agent
      .get(`${readinessPath}?chapterNumber=1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.ready).toBe(true);
        expect(body.checks.confirmedFacts).toMatchObject({
          ready: true,
          detail: '已有 1 条已确认设定。',
        });
      });
  });
});
