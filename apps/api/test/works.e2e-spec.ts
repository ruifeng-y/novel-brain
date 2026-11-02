import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Algorithm, hash } from '@node-rs/argon2';
import { createDatabase, users as usersTable } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
});
