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
  return `story-planning-${randomUUID()}@example.com`;
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

function storyBiblePayload(overrides: Record<string, unknown> = {}) {
  return {
    oneSentenceStory: '边城少年以残剑问仙，最终守住人间最后一道天门。',
    protagonist: '沈砚，外冷内热的边城剑客',
    worldIronLaw: '任何人借天门之力，都必须以一段真实记忆作为代价。',
    ...overrides,
  };
}

function completeStoryBibleCards(
  overrides: Record<string, { summary?: string; details?: string }> = {},
) {
  const cards = [
    {
      key: 'oneSentence',
      summary: '守碑少年为找回被天门吞掉的母亲，带着残剑踏遍九州。',
      details: '故事从边城荒寺起笔，以母亲留下的半句剑诀贯穿全书。',
    },
    {
      key: 'sellingPoints',
      summary: '记忆作剑、师门反目、每卷推开一座天门。',
      details: '每卷都要兑现一次记忆代价，并在卷末揭开一层身世真相。',
    },
    {
      key: 'protagonist',
      summary: '沈砚，外冷内热的边城剑客。',
      details: '他嘴上不信任何人，却总会替陌生人挡下最后一剑。',
    },
    {
      key: 'goldenFinger',
      summary: '残剑能借来亡者的最后一剑，但每借一次就会忘掉一个活人的名字。',
      details: '借剑只持续九息；同一个人不能连续借剑两次；忘记的名字无法用纸笔补回。',
    },
    {
      key: 'worldIronLaws',
      summary: '天门只认记忆，不认血脉。',
      details: '任何人想越过天门，都必须留下真实经历，伪造的记忆会被原样反噬。',
    },
    {
      key: 'mainPlot',
      summary: '沈砚沿九座天门追查母亲下落，并阻止仙门献祭人间记忆。',
      details: '主线按九卷推进，每卷解决一座天门，同时付出一个无法挽回的代价。',
    },
    {
      key: 'subplots',
      summary: '守碑人旧案、同门师姐的背叛、边城百姓的存亡。',
      details: '三条支线分别对应真相、情感和家园，必须在天门全开前收束。',
    },
    {
      key: 'ending',
      summary: '沈砚守住最后一道天门，却主动忘记母亲，让边城所有人记住彼此。',
      details: '结局不再以成仙收尾，而是让沈砚选择做一个仍会遗忘、也仍会牵挂的人。',
    },
    {
      key: 'readerPromise',
      summary: '每章有明确推进，每卷有一座天门和一次记忆代价，绝不用失忆拖延感情线。',
      details: '爽点来自破局与兑现承诺，情感克制，不写无意义后宫和重复打脸。',
    },
  ];

  return cards.map((card) => ({
    ...card,
    ...(overrides[card.key] ?? {}),
  }));
}

function chapterOutlinePayload(overrides: Record<string, unknown> = {}) {
  return {
    chapterGoal: '沈砚在断碑前第一次引动残剑。',
    pov: '沈砚',
    sceneBeats: ['沈砚逃入荒寺避雨', '断碑浮现旧日剑痕', '残剑认主并反噬记忆'],
    chapterEndHook: '他想起的母亲，竟从未在自己的记忆里活过。',
    ...overrides,
  };
}

describe('story planning API', () => {
  let app: INestApplication;
  let passwordHash: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/8';
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
      .get(`/api/v1/works/${workId}/branches/${branchId}/story-bible`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .put(`/api/v1/works/${workId}/branches/${branchId}/chapter-outlines/1`)
      .send(chapterOutlinePayload())
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/works/${workId}/branches/${branchId}/story-bible/lock`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/works/${workId}/branches/${branchId}/story-bible/insights`)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('saves and reloads a story bible by work and branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const firstWork = await createWork(author.agent, '天门残卷');
    const secondWork = await createWork(author.agent, '雾海孤灯');
    const firstParallelBranch = await createParallelBranch(
      app,
      firstWork.id,
      author.userId,
      'another-ending',
    );

    await author.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: null,
          workId: firstWork.id,
          branchId: firstWork.mainBranchId,
          oneSentenceStory: '',
          protagonist: '',
          worldIronLaw: '',
          createdAt: null,
          updatedAt: null,
        });
      });

    const firstBible = storyBiblePayload();
    const parallelBible = storyBiblePayload({
      oneSentenceStory: '沈砚发现守住天门，才是真正打开天门。',
      protagonist: '沈砚，已经失去全部记忆的守门人',
      worldIronLaw: '每守住一次天门，人间就忘记一个名字。',
    });
    const secondWorkBible = storyBiblePayload({
      oneSentenceStory: '盲眼船娘循着灯火，驶向没有归途的雾海。',
      protagonist: '阿灯，能听见海底灯火的船娘',
      worldIronLaw: '雾海里每盏灯都对应一个尚未归来的人。',
    });

    const saved = await author.agent
      .put(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .send(firstBible)
      .expect(200);
    expect(saved.body).toMatchObject({
      workId: firstWork.id,
      branchId: firstWork.mainBranchId,
      ...firstBible,
    });

    await author.agent
      .put(`/api/v1/works/${firstWork.id}/branches/${firstParallelBranch}/story-bible`)
      .send(parallelBible)
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${secondWork.id}/branches/${secondWork.mainBranchId}/story-bible`)
      .send(secondWorkBible)
      .expect(200);

    await author.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(firstBible);
      });
    await author.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstParallelBranch}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(parallelBible);
      });
    await author.agent
      .get(`/api/v1/works/${secondWork.id}/branches/${secondWork.mainBranchId}/story-bible`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(secondWorkBible);
      });

    await otherAuthor.agent
      .get(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
    await otherAuthor.agent
      .put(`/api/v1/works/${firstWork.id}/branches/${firstWork.mainBranchId}/story-bible`)
      .send(storyBiblePayload({ oneSentenceStory: '不该保存' }))
      .expect(404);
  });

  it('reads and edits every story bible card with expanded details', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const biblePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`;

    await author.agent
      .get(biblePath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.cards.map((card: { title: string }) => card.title)).toEqual([
          '一句话故事',
          '核心卖点',
          '主角',
          '金手指',
          '世界铁律',
          '主线',
          '支线',
          '结局方向',
          '读者承诺',
        ]);
        expect(body.cards.every((card: { summary: string }) => card.summary === '')).toBe(true);
        expect(body.locked).toBe(false);
        expect(body.completion).toEqual({
          complete: false,
          filledCards: 0,
          totalCards: 9,
          missingCardTitles: [
            '一句话故事',
            '核心卖点',
            '主角',
            '金手指',
            '世界铁律',
            '主线',
            '支线',
            '结局方向',
            '读者承诺',
          ],
        });
      });

    const cards = completeStoryBibleCards();
    await author.agent.put(biblePath).send({ cards }).expect(200);

    await author.agent
      .get(biblePath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.cards).toEqual(
          expect.arrayContaining(cards.map((card) => expect.objectContaining(card))),
        );
        expect(body.completion).toEqual({
          complete: true,
          filledCards: 9,
          totalCards: 9,
          missingCardTitles: [],
        });
        expect(body).toMatchObject({
          oneSentenceStory: cards[0].summary,
          protagonist: cards[2].summary,
          worldIronLaw: cards[4].summary,
        });
      });
  });

  it('locks a complete story bible and records confirmed changes', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const biblePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`;
    const cards = completeStoryBibleCards();

    await author.agent.put(biblePath).send({ cards }).expect(200);

    await author.agent
      .post(`${biblePath}/lock`)
      .expect(201)
      .expect(({ body }) => {
        expect(body.locked).toBe(true);
        expect(body.lockedAt).toEqual(expect.any(String));
        expect(body.version).toBe(2);
      });

    const lockedEdit = completeStoryBibleCards({
      ending: {
        summary: '沈砚守住最后一道天门，却把成仙的机会留给边城百姓。',
      },
    });

    await author.agent
      .put(biblePath)
      .send({ cards: lockedEdit })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('STORY_BIBLE_LOCKED');
        expect(body.details).toMatchObject({
          requiresConfirmation: true,
          reasonRequired: true,
        });
      });

    await author.agent
      .get(biblePath)
      .expect(200)
      .expect(({ body }) => {
        expect(body.cards.find((card: { key: string }) => card.key === 'ending').summary).toBe(
          cards[7].summary,
        );
      });

    await author.agent
      .put(biblePath)
      .send({ cards: lockedEdit, confirmLockedChange: true })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    const changeReason = '结局与第 12 章已写内容对齐，保留边城百姓记得彼此的落点。';
    await author.agent
      .put(biblePath)
      .send({
        cards: lockedEdit,
        confirmLockedChange: true,
        changeReason,
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.locked).toBe(true);
        expect(body.version).toBe(3);
        expect(body.cards.find((card: { key: string }) => card.key === 'ending').summary).toBe(
          lockedEdit[7].summary,
        );
      });

    await author.agent
      .get(`${biblePath}/insights`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.recentChanges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionLabel: '锁定故事圣经',
              reason: '锁定故事圣经',
            }),
            expect.objectContaining({
              actionLabel: '确认后修改',
              reason: changeReason,
              changedCardTitles: ['结局方向'],
            }),
          ]),
        );
      });
  });

  it('will not lock a story bible until every card has a summary', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const biblePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`;

    await author.agent.put(biblePath).send(storyBiblePayload()).expect(200);

    await author.agent
      .post(`${biblePath}/lock`)
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('STORY_BIBLE_INCOMPLETE');
        expect(body.details.missingCardTitles).toContain('核心卖点');
      });
  });

  it('shows isolated continuity reminders, unresolved foreshadows, and recent changes', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const parallelBranch = await createParallelBranch(app, work.id, author.userId, 'what-if');
    const database = app.get(DatabaseService);
    const biblePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`;

    const chapter = await database.pool.query<{ id: string }>(
      `insert into chapters (work_id, branch_id, chapter_number, title, status)
       values ($1, $2, 2, '断碑', 'review')
       returning id`,
      [work.id, work.mainBranchId],
    );
    await database.pool.query(
      `insert into annotations
         (work_id, branch_id, chapter_id, category, severity, message, suggestion,
          source_sentence, start_offset, end_offset, status)
       values ($1, $2, $3, 'body_state', 'warning', $4, $5, $6, 0, 8, 'open'),
              ($1, $2, $3, 'body_state', 'warning', $7, $5, $6, 0, 8, 'ignored')`,
      [
        work.id,
        work.mainBranchId,
        chapter.rows[0].id,
        '沈砚左臂骨折，却仍双手结印。',
        '改成右手单掌结印，或补写左臂恢复原因。',
        '沈砚左臂骨折，却仍双手结印。',
        '这条提醒已经处理。',
      ],
    );
    await database.pool.query(
      `insert into foreshadows
         (work_id, branch_id, title, description, setup_chapter, planned_payoff_chapter,
          status, importance)
       values ($1, $2, '母亲留下的半句剑诀', '剑诀缺失的后半句指向天门真正代价。',
               2, 18, 'planted', 'must'),
              ($1, $2, '已经兑现的旧信', '这封信已经在第 3 章读完。',
               1, 3, 'paid_off', 'optional'),
              ($1, $3, '另一条创作线里的伏笔', '不应出现在主创作线。',
               1, 4, 'planted', 'must'),
              ($4, $5, '另一部作品的伏笔', '不应出现在这部作品。',
               1, 4, 'planted', 'must')`,
      [work.id, work.mainBranchId, parallelBranch, otherWork.id, otherWork.mainBranchId],
    );

    await author.agent.put(biblePath).send({ cards: completeStoryBibleCards() }).expect(200);

    await author.agent
      .get(`${biblePath}/insights`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.continuityReminders).toEqual([
          expect.objectContaining({
            chapterNumber: 2,
            categoryLabel: '身体状态',
            severityLabel: '需要确认',
            message: '沈砚左臂骨折，却仍双手结印。',
            suggestion: '改成右手单掌结印，或补写左臂恢复原因。',
          }),
        ]);
        expect(body.unresolvedForeshadows).toEqual([
          expect.objectContaining({
            title: '母亲留下的半句剑诀',
            setupChapter: 2,
            plannedPayoffChapter: 18,
            importanceLabel: '必须回收',
          }),
        ]);
        expect(body.recentChanges).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actionLabel: '保存故事圣经',
              changedCardTitles: expect.arrayContaining(['一句话故事', '结局方向']),
            }),
          ]),
        );
      });

    await otherAuthor.agent
      .get(`${biblePath}/insights`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });
  });

  it('saves and reloads a chapter outline by work, branch, and chapter', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const parallelBranch = await createParallelBranch(app, work.id, author.userId, 'what-if');

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: null,
          workId: work.id,
          branchId: work.mainBranchId,
          chapterNumber: 1,
          chapterGoal: '',
          pov: '',
          sceneBeats: [],
          chapterEndHook: '',
          createdAt: null,
          updatedAt: null,
        });
      });

    const outline = chapterOutlinePayload();
    const parallelOutline = chapterOutlinePayload({
      chapterGoal: '沈砚在断碑前拒绝残剑认主。',
      pov: '守碑人',
      sceneBeats: ['守碑人拦住沈砚', '残剑发出第二次剑鸣'],
      chapterEndHook: '断碑背后的门，自己开了一道缝。',
    });
    const secondChapter = chapterOutlinePayload({
      chapterGoal: '沈砚带着残剑回到边城。',
      pov: '沈砚',
      sceneBeats: ['边城戒严', '旧友认不出沈砚'],
      chapterEndHook: '城门口贴着他的通缉令。',
    });

    const saved = await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(outline)
      .expect(200);
    expect(saved.body).toMatchObject({
      workId: work.id,
      branchId: work.mainBranchId,
      chapterNumber: 1,
      ...outline,
    });

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${parallelBranch}/chapter-outlines/1`)
      .send(parallelOutline)
      .expect(200);
    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/2`)
      .send(secondChapter)
      .expect(200);

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(outline);
        expect(body.sceneBeats).toEqual(outline.sceneBeats);
      });
    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranch}/chapter-outlines/1`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(parallelOutline);
      });
    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/2`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(secondChapter);
      });
  });

  it('rejects incomplete planning details', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/story-bible`)
      .send(storyBiblePayload({ oneSentenceStory: '   ' }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${work.mainBranchId}/chapter-outlines/1`)
      .send(chapterOutlinePayload({ sceneBeats: [] }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });
  });
});
