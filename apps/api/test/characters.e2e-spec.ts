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
  return `character-state-${randomUUID()}@example.com`;
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

describe('character profile and state API', () => {
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
    await clearAuthRateLimits(app);
  });

  it('saves every profile field and reuses typed relationships', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const shenYan = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');
    const peiZhao = await createCharacter(author.agent, work.id, work.mainBranchId, '裴照');

    const profile = {
      desire: '找回被天门吞掉的母亲。',
      fear: '发现自己也是天门留下的记忆。',
      secret: '他曾在断碑前主动交出过一段童年。',
      voice: '句子短，少用反问；提到母亲时会停顿。',
      arc: '从只信手中剑，到愿意把真相交给同行者。',
    };

    await author.agent
      .patch(`${centerPath}/characters/${shenYan.id}/profile`)
      .send(profile)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject(profile);
      });

    await author.agent
      .post(`${centerPath}/relations`)
      .send({
        fromEntityId: shenYan.id,
        predicate: 'kin',
        toEntityId: peiZhao.id,
        validFrom: '第一卷',
        validTo: null,
        source: '作者录入',
      })
      .expect(201);

    await author.agent
      .get(`${centerPath}/characters/${shenYan.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.character).toMatchObject({ id: shenYan.id, name: '沈砚', type: 'character' });
        expect(body.profile).toMatchObject(profile);
        expect(body.profile.relationships).toEqual([
          expect.objectContaining({
            predicate: 'kin',
            predicateLabel: '亲属',
            fromEntity: expect.objectContaining({ id: shenYan.id }),
            toEntity: expect.objectContaining({ id: peiZhao.id }),
            validFrom: '第一卷',
          }),
        ]);
      });
  });

  it('keeps the broken arm as current state and records the change history', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const shenYan = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');

    await author.agent
      .put(`${centerPath}/characters/${shenYan.id}/state`)
      .send({
        body: '左臂完好，能双手持剑。',
        power: '筑基初期，残剑认主后可短暂借剑意。',
        location: '边城荒寺',
        possessions: '残剑、母亲留下的半枚铜钱。',
        disguise: '披旧斗篷，不显露左手剑茧。',
        knowledge: [],
        reason: '录入初始状态',
        source: '第一章设定稿',
      })
      .expect(200);

    await author.agent
      .put(`${centerPath}/characters/${shenYan.id}/state`)
      .send({
        body: '左臂骨折，吊在胸前，暂时无法双手结印。',
        reason: '断碑机关发动，左臂被石门压断',
        source: '第 3 章手稿',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.state).toMatchObject({
          body: '左臂骨折，吊在胸前，暂时无法双手结印。',
          power: '筑基初期，残剑认主后可短暂借剑意。',
          location: '边城荒寺',
          possessions: '残剑、母亲留下的半枚铜钱。',
          disguise: '披旧斗篷，不显露左手剑茧。',
          version: 2,
        });
      });

    await author.agent
      .get(`${centerPath}/characters/${shenYan.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.state.body).toBe('左臂骨折，吊在胸前，暂时无法双手结印。');
        expect(body.history).toHaveLength(2);
        expect(body.history[0]).toMatchObject({
          version: 2,
          reason: '断碑机关发动，左臂被石门压断',
          source: '第 3 章手稿',
          changedFields: ['body'],
          beforeState: expect.objectContaining({ body: '左臂完好，能双手持剑。' }),
          afterState: expect.objectContaining({
            body: '左臂骨折，吊在胸前，暂时无法双手结印。',
          }),
        });
        expect(body.history[1]).toMatchObject({
          version: 1,
          reason: '录入初始状态',
          changedFields: ['body', 'power', 'location', 'possessions', 'disguise', 'knowledge'],
          beforeState: null,
        });
      });
  });

  it('separates what really happened from what the character believes, with validity', async () => {
    const author = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const centerPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}`;
    const shenYan = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');
    const knowledge = {
      title: '父母之死',
      objectiveTruth: '父母被仇家灭口，现场被伪造成双双自尽。',
      characterBelief: '父母因欠债羞愧而自杀。',
      validFrom: '第 1 章',
      validTo: '第 119 章',
      source: '第 1 章手稿',
    };

    await author.agent
      .put(`${centerPath}/characters/${shenYan.id}/state`)
      .send({
        knowledge: [knowledge],
        reason: '录入主角对父母之死的错误认知',
        source: '第 1 章手稿',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.state.knowledge).toEqual([
          expect.objectContaining({
            ...knowledge,
            id: expect.any(String),
          }),
        ]);
        expect(body.state.knowledge[0].objectiveTruth).not.toBe(
          body.state.knowledge[0].characterBelief,
        );
      });

    await author.agent
      .get(`${centerPath}/characters/${shenYan.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.state.knowledge[0]).toMatchObject(knowledge);
        expect(body.history[0].changedFields).toContain('knowledge');
        expect(body.history[0].afterState.knowledge[0]).toMatchObject(knowledge);
      });

    await author.agent
      .put(`${centerPath}/characters/${shenYan.id}/state`)
      .send({
        knowledge: [
          {
            ...knowledge,
            characterBelief: '父母不是自杀，而是被人杀害。',
            validFrom: '第 120 章',
            validTo: null,
            source: '第 120 章真相揭晓',
          },
        ],
        reason: '主角得知父母之死的真相',
        source: '第 120 章手稿',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.state.knowledge[0]).toMatchObject({
          objectiveTruth: '父母被仇家灭口，现场被伪造成双双自尽。',
          characterBelief: '父母不是自杀，而是被人杀害。',
          validFrom: '第 120 章',
          validTo: null,
        });
        expect(body.history[0]).toMatchObject({
          reason: '主角得知父母之死的真相',
          changedFields: ['knowledge'],
        });
        expect(body.history[0].beforeState.knowledge[0].characterBelief).toBe(
          '父母因欠债羞愧而自杀。',
        );
      });
  });

  it('isolates character profiles and state by author, work, and branch', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);
    const work = await createWork(author.agent, '天门残卷');
    const otherWork = await createWork(author.agent, '雾海孤灯');
    const character = await createCharacter(author.agent, work.id, work.mainBranchId, '沈砚');
    const parallelBranch = await app.get(DatabaseService).pool.query<{ id: string }>(
      `insert into work_branches (work_id, name, is_main, status, created_by)
       values ($1, 'parallel-character', false, 'active', $2)
       returning id`,
      [work.id, author.userId],
    );
    const parallelBranchId = parallelBranch.rows[0].id;
    const characterPath = `/api/v1/works/${work.id}/branches/${work.mainBranchId}/characters/${character.id}`;

    await request(app.getHttpServer()).get(characterPath).expect(401);

    await otherAuthor.agent
      .get(characterPath)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('WORK_NOT_FOUND');
      });

    await author.agent
      .get(
        `/api/v1/works/${otherWork.id}/branches/${otherWork.mainBranchId}/characters/${character.id}`,
      )
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('CHARACTER_NOT_FOUND');
      });

    await author.agent
      .get(`/api/v1/works/${work.id}/branches/${parallelBranchId}/characters/${character.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('CHARACTER_NOT_FOUND');
      });

    await author.agent
      .put(`/api/v1/works/${work.id}/branches/${parallelBranchId}/characters/${character.id}/state`)
      .send({ body: '另一条创作线里不该看到这条状态。', reason: '隔离校验' })
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('CHARACTER_NOT_FOUND');
      });
  });
});
