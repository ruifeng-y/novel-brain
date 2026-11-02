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
  return `story-ledger-${randomUUID()}@example.com`;
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

async function createCharacter(
  agent: ReturnType<typeof request.agent>,
  workId: string,
  branchId: string,
  name: string,
) {
  const response = await agent
    .post(`/api/v1/works/${workId}/branches/${branchId}/entities`)
    .send({
      name,
      aliases: [],
      type: 'character',
      summary: `${name}的人物摘要`,
      description: '',
      tags: [],
      scope: 'work',
      status: 'draft',
    })
    .expect(201);
  return response.body as { id: string; name: string };
}

describe('story ledger API', () => {
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

  it('saves and reloads a plot line with stakes, participants, milestones, and tension', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const shenYan = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');
    const peiZhao = await createCharacter(author.agent, work.id, work.mainBranchId, '裴照');

    const created = await author.agent
      .post(`${basePath}/threads`)
      .send({
        name: '追查母亲失踪真相',
        type: 'main',
        summary: '沈砚沿着九座天门的线索追查母亲下落。',
        stakes: '每错过一条线索，母亲留在人间的记忆就会少一段。',
        participantIds: [shenYan.id, peiZhao.id],
        plannedPayoffChapter: 18,
        status: 'active',
        milestones: [
          { chapterNumber: 3, description: '残剑在断碑前认主。' },
          { chapterNumber: 12, description: '守碑人交出母亲留下的半句剑诀。' },
        ],
        tensionCurve: [
          { chapterNumber: 1, tension: 3 },
          { chapterNumber: 8, tension: 7 },
          { chapterNumber: 18, tension: 10 },
        ],
      })
      .expect(201);

    expect(created.body).toMatchObject({
      name: '追查母亲失踪真相',
      type: 'main',
      typeLabel: '主线',
      status: 'active',
      statusLabel: '推进中',
      plannedPayoffChapter: 18,
      participants: expect.arrayContaining([
        { id: shenYan.id, name: '沈砚' },
        { id: peiZhao.id, name: '裴照' },
      ]),
      milestones: [
        { chapterNumber: 3, description: '残剑在断碑前认主。' },
        { chapterNumber: 12, description: '守碑人交出母亲留下的半句剑诀。' },
      ],
      tensionCurve: [
        { chapterNumber: 1, tension: 3 },
        { chapterNumber: 8, tension: 7 },
        { chapterNumber: 18, tension: 10 },
      ],
    });

    await author.agent
      .get(`${basePath}/story-ledger`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.threads).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.body.id,
              name: '追查母亲失踪真相',
              stakes: '每错过一条线索，母亲留在人间的记忆就会少一段。',
            }),
          ]),
        );
        expect(body.characters).toEqual(
          expect.arrayContaining([
            { id: shenYan.id, name: '沈砚' },
            { id: peiZhao.id, name: '裴照' },
          ]),
        );
      });
  });

  it('plants a foreshadow and removes it from unresolved reminders after payoff', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;

    const created = await author.agent
      .post(`${basePath}/foreshadows`)
      .send({
        title: '母亲留下的半句剑诀',
        description: '剑诀缺失的后半句指向天门真正代价。',
        plantChapter: 2,
        plannedPayoffChapter: 18,
        importance: 'must',
        status: 'planted',
      })
      .expect(201);

    expect(created.body).toMatchObject({
      title: '母亲留下的半句剑诀',
      description: '剑诀缺失的后半句指向天门真正代价。',
      plantChapter: 2,
      plannedPayoffChapter: 18,
      importance: 'must',
      importanceLabel: '必须回收',
      status: 'planted',
      statusLabel: '已埋设',
    });

    await author.agent
      .get(`${basePath}/story-bible/insights`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.unresolvedForeshadows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.body.id,
              title: '母亲留下的半句剑诀',
              setupChapter: 2,
              plannedPayoffChapter: 18,
              importanceLabel: '必须回收',
            }),
          ]),
        );
      });

    await author.agent
      .patch(`${basePath}/foreshadows/${created.body.id}`)
      .send({ status: 'paid_off' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: created.body.id,
          status: 'paid_off',
          statusLabel: '已回收',
        });
      });

    await author.agent
      .get(`${basePath}/story-bible/insights`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.unresolvedForeshadows).toEqual([]);
      });
  });

  it('saves and reloads a character arc with every planned growth beat', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const shenYan = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');
    const arc = {
      characterId: shenYan.id,
      startState: '只信手中剑，把所有人情都当作债。',
      desire: '找回被天门吞掉的母亲。',
      fear: '发现自己也是天门伪造出来的记忆。',
      lie: '只要足够强，就不必再失去任何人。',
      truth: '真正能留住人的不是力量，而是愿意把真相交给同行者。',
      turn: '在第 12 章主动承认自己一直错怪了守碑人。',
      endState: '愿意带着残缺的记忆继续守护边城。',
      status: 'active',
    };

    const created = await author.agent.post(`${basePath}/character-arcs`).send(arc).expect(201);

    expect(created.body).toMatchObject({
      ...arc,
      character: { id: shenYan.id, name: '沈砚' },
      statusLabel: '成长中',
    });

    await author.agent
      .get(`${basePath}/story-ledger`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.characterArcs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: created.body.id,
              characterId: shenYan.id,
              startState: arc.startState,
              desire: arc.desire,
              fear: arc.fear,
              lie: arc.lie,
              truth: arc.truth,
              turn: arc.turn,
              endState: arc.endState,
            }),
          ]),
        );
      });
  });

  it('flags overdue foreshadows, unclosed plot lines, and motivation breaks', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const shenYan = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');

    await author.agent
      .post(`${basePath}/threads`)
      .send({
        name: '守住边城',
        type: 'main',
        summary: '沈砚必须在仙门献祭前守住边城。',
        stakes: '边城百姓会失去全部记忆。',
        participantIds: [shenYan.id],
        plannedPayoffChapter: 5,
        status: 'active',
        milestones: [],
        tensionCurve: [],
      })
      .expect(201);
    await author.agent
      .post(`${basePath}/foreshadows`)
      .send({
        title: '断碑上的第二道剑痕',
        description: '第二道剑痕会在第 4 章给出守碑人的真实身份。',
        plantChapter: 2,
        plannedPayoffChapter: 4,
        importance: 'must',
        status: 'planted',
      })
      .expect(201);
    await author.agent
      .post(`${basePath}/character-arcs`)
      .send({
        characterId: shenYan.id,
        startState: '只信手中剑。',
        desire: '',
        fear: '再次失去家人。',
        lie: '力量可以解决一切。',
        truth: '',
        turn: '',
        endState: '',
        status: 'active',
      })
      .expect(201);

    await app.get(DatabaseService).pool.query(
      `insert into chapters (work_id, branch_id, chapter_number, title, status, word_count)
       values ($1, $2, 5, '城门将破', 'writing', 800)`,
      [work.id, work.mainBranchId],
    );

    await author.agent
      .get(`${basePath}/story-ledger/checks`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.writtenThroughChapter).toBe(5);
        expect(body.summary).toEqual({
          overdueForeshadows: 1,
          unclosedThreads: 1,
          motivationBreaks: 1,
        });
        expect(body.items).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'overdue_foreshadow',
              kindLabel: '过期伏笔',
              title: '断碑上的第二道剑痕',
              chapterNumber: 4,
            }),
            expect.objectContaining({
              kind: 'unclosed_thread',
              kindLabel: '未收束剧情线',
              title: '守住边城',
              chapterNumber: 5,
            }),
            expect.objectContaining({
              kind: 'motivation_break',
              kindLabel: '动机断点',
              title: '沈砚',
            }),
          ]),
        );
      });
  });

  it('updates a plot line status and removes it when no longer needed', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const created = await author.agent
      .post(`${basePath}/threads`)
      .send({
        name: '守碑人旧案',
        type: 'mystery',
        summary: '守碑人为何隐瞒母亲失踪。',
        stakes: '真相会改变沈砚对父亲的判断。',
        participantIds: [],
        plannedPayoffChapter: 12,
        status: 'active',
        milestones: [],
        tensionCurve: [],
      })
      .expect(201);

    await author.agent
      .patch(`${basePath}/threads/${created.body.id}`)
      .send({
        summary: '守碑人隐瞒的是父亲主动进入天门的真相。',
        status: 'resolved',
        tensionCurve: [
          { chapterNumber: 4, tension: 4 },
          { chapterNumber: 12, tension: 9 },
        ],
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: created.body.id,
          typeLabel: '悬疑线',
          status: 'resolved',
          statusLabel: '已收束',
        });
        expect(body.tensionCurve).toEqual([
          { chapterNumber: 4, tension: 4 },
          { chapterNumber: 12, tension: 9 },
        ]);
      });

    await author.agent.delete(`${basePath}/threads/${created.body.id}`).expect(204);

    await author.agent
      .get(`${basePath}/story-ledger`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.threads).toEqual([]);
      });
  });

  it('isolates the ledger by author, work, and branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const basePath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'what-if-ledger', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const created = await author.agent
      .post(`${basePath}/threads`)
      .send({
        name: '主创作线的真相',
        type: 'mystery',
        summary: '只应出现在主创作线。',
        stakes: '另一条创作线不该看到这条线。',
        participantIds: [],
        plannedPayoffChapter: 9,
        status: 'active',
        milestones: [],
        tensionCurve: [],
      })
      .expect(201);

    await request(app.getHttpServer()).get(`${basePath}/story-ledger`).expect(401);

    await otherAuthor.agent
      .get(`${basePath}/story-ledger`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });

    await otherAuthor.agent
      .post(`${basePath}/threads`)
      .send({
        name: '不该写入',
        type: 'main',
        stakes: '不属于这位作者。',
      })
      .expect(404);

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/story-ledger`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.threads).toEqual([]);
      });

    await author.agent
      .patch(`/api/v1/works/${work.id}/branches/${parallelBranchId}/threads/${created.body.id}`)
      .send({ status: 'resolved' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('THREAD_NOT_FOUND');
      });

    await author.agent
      .get(`/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/story-ledger`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.threads).toEqual([]);
        expect(body.foreshadows).toEqual([]);
        expect(body.characterArcs).toEqual([]);
      });
  });
});
