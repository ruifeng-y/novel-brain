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

const MODEL_CONNECTION_TESTER = 'MODEL_CONNECTION_TESTER';
const MASKED_API_KEY = '••••••••';

const fakeTester = {
  async test(input: { baseUrl: string; apiKey: string; model: string }) {
    if (input.apiKey === 'network-key') {
      throw new Error('ECONNREFUSED');
    }
    if (input.apiKey === 'invalid-key') {
      return {
        status: 'invalid_key',
        message: 'API key is invalid',
      };
    }
    if (input.apiKey === 'valid-key') {
      return {
        status: 'success',
        message: 'Connection successful',
        latencyMs: 12,
      };
    }
    return {
      status: 'invalid_key',
      message: 'API key is invalid',
    };
  },
};

function uniqueEmail(): string {
  return `model-configs-${randomUUID()}@example.com`;
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

function configPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'DeepSeek 正文',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    apiKey: 'valid-key',
    purpose: 'prose',
    ...overrides,
  };
}

describe('model configuration API', () => {
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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODEL_CONNECTION_TESTER)
      .useValue(fakeTester)
      .compile();
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
      .get('/api/v1/model-configs')
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('UNAUTHENTICATED');
      });
  });

  it('creates, reads, updates, and deletes a configuration without exposing its key', async () => {
    const author = await createAuthor(app, passwordHash);
    const apiKey = 'secret-prose-key';

    const created = await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ apiKey }))
      .expect(201);

    expect(created.body).toMatchObject({
      name: 'DeepSeek 正文',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      purpose: 'prose',
      isDefault: true,
      apiKeyMasked: MASKED_API_KEY,
    });
    expect(created.body).not.toHaveProperty('apiKey');
    expect(created.body).not.toHaveProperty('encryptedApiKey');
    expect(JSON.stringify(created.body)).not.toContain(apiKey);

    const database = app.get(DatabaseService);
    const stored = await database.pool.query<{
      provider: string;
      purpose: string;
      is_default: boolean;
      encrypted_api_key: string;
    }>(
      'select provider, purpose, is_default, encrypted_api_key from model_configs where id = $1 and user_id = $2',
      [created.body.id, author.userId],
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({
      provider: 'deepseek',
      purpose: 'prose',
      is_default: true,
    });
    expect(stored.rows[0].encrypted_api_key).not.toContain(apiKey);
    expect(stored.rows[0].encrypted_api_key).toMatch(/^v1\./);

    await author.agent
      .get('/api/v1/model-configs')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toHaveLength(1);
        expect(body.items[0]).toMatchObject({
          id: created.body.id,
          apiKeyMasked: MASKED_API_KEY,
        });
        expect(JSON.stringify(body)).not.toContain(apiKey);
      });

    await author.agent
      .get(`/api/v1/model-configs/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: created.body.id,
          name: 'DeepSeek 正文',
          apiKeyMasked: MASKED_API_KEY,
        });
        expect(JSON.stringify(body)).not.toContain(apiKey);
      });

    const updated = await author.agent
      .patch(`/api/v1/model-configs/${created.body.id}`)
      .send({
        name: 'DeepSeek 校验',
        model: 'deepseek-reasoner',
        purpose: 'check',
        apiKey: 'updated-key',
      })
      .expect(200);

    expect(updated.body).toMatchObject({
      id: created.body.id,
      name: 'DeepSeek 校验',
      model: 'deepseek-reasoner',
      purpose: 'check',
      apiKeyMasked: MASKED_API_KEY,
    });
    expect(JSON.stringify(updated.body)).not.toContain('updated-key');

    const storedAfterUpdate = await database.pool.query<{ encrypted_api_key: string }>(
      'select encrypted_api_key from model_configs where id = $1 and user_id = $2',
      [created.body.id, author.userId],
    );
    expect(storedAfterUpdate.rows[0].encrypted_api_key).not.toBe(
      stored.rows[0].encrypted_api_key,
    );
    expect(storedAfterUpdate.rows[0].encrypted_api_key).not.toContain('updated-key');

    await author.agent.delete(`/api/v1/model-configs/${created.body.id}`).expect(204);
    await author.agent.get(`/api/v1/model-configs/${created.body.id}`).expect(404);
    await author.agent
      .get('/api/v1/model-configs')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });
  });

  it('keeps exactly one default and resolves missing purposes through prose then default', async () => {
    const author = await createAuthor(app, passwordHash);

    const prose = await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ name: '正文模型' }))
      .expect(201);
    expect(prose.body.isDefault).toBe(true);

    const check = await author.agent
      .post('/api/v1/model-configs')
      .send(
        configPayload({
          name: '校验模型',
          model: 'deepseek-reasoner',
          purpose: 'check',
          isDefault: true,
        }),
      )
      .expect(201);
    expect(check.body.isDefault).toBe(true);

    const planning = await author.agent
      .post('/api/v1/model-configs')
      .send(
        configPayload({
          name: '规划模型',
          model: 'deepseek-reasoner',
          purpose: 'planning',
        }),
      )
      .expect(201);
    expect(planning.body.isDefault).toBe(false);

    const database = app.get(DatabaseService);
    const defaults = await database.pool.query<{ count: string }>(
      'select count(*) from model_configs where user_id = $1 and is_default = true',
      [author.userId],
    );
    expect(defaults.rows[0].count).toBe('1');

    await author.agent
      .get('/api/v1/model-configs')
      .expect(200)
      .expect(({ body }) => {
        expect(body.effectivePurposes).toMatchObject({
          planning: {
            configId: planning.body.id,
            source: 'purpose',
          },
          prose: {
            configId: prose.body.id,
            source: 'purpose',
          },
          check: {
            configId: check.body.id,
            source: 'purpose',
          },
        });
      });

    await author.agent.delete(`/api/v1/model-configs/${check.body.id}`).expect(204);
    await author.agent
      .get('/api/v1/model-configs')
      .expect(200)
      .expect(({ body }) => {
        expect(body.effectivePurposes.check).toMatchObject({
          configId: prose.body.id,
          source: 'prose_fallback',
        });
      });

    await author.agent.delete(`/api/v1/model-configs/${prose.body.id}`).expect(204);
    await author.agent
      .get('/api/v1/model-configs')
      .expect(200)
      .expect(({ body }) => {
        expect(body.effectivePurposes.prose).toMatchObject({
          configId: planning.body.id,
          source: 'default_fallback',
        });
        expect(body.effectivePurposes.check).toMatchObject({
          configId: planning.body.id,
          source: 'default_fallback',
        });
      });

    const defaultsAfterDelete = await database.pool.query<{ count: string }>(
      'select count(*) from model_configs where user_id = $1 and is_default = true',
      [author.userId],
    );
    expect(defaultsAfterDelete.rows[0].count).toBe('1');
  });

  it('isolates every configuration operation by account', async () => {
    const author = await createAuthor(app, passwordHash);
    const otherAuthor = await createAuthor(app, passwordHash);

    const created = await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload())
      .expect(201);

    await otherAuthor.agent
      .get('/api/v1/model-configs')
      .expect(200)
      .expect(({ body }) => {
        expect(body.items).toEqual([]);
      });

    await otherAuthor.agent
      .get(`/api/v1/model-configs/${created.body.id}`)
      .expect(404)
      .expect(({ body }) => {
        expect(body.code).toBe('MODEL_CONFIG_NOT_FOUND');
      });

    await otherAuthor.agent
      .patch(`/api/v1/model-configs/${created.body.id}`)
      .send({ name: '不该成功' })
      .expect(404);

    await otherAuthor.agent.post(`/api/v1/model-configs/${created.body.id}/test`).expect(404);
    await otherAuthor.agent.delete(`/api/v1/model-configs/${created.body.id}`).expect(404);

    await author.agent
      .get(`/api/v1/model-configs/${created.body.id}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('DeepSeek 正文');
      });
  });

  it('reports successful, invalid-key, and network connection tests through the fake tester', async () => {
    const author = await createAuthor(app, passwordHash);

    const success = await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ apiKey: 'valid-key' }))
      .expect(201);
    await author.agent
      .post(`/api/v1/model-configs/${success.body.id}/test`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          status: 'success',
          latencyMs: 12,
        });
        expect(JSON.stringify(body)).not.toContain('valid-key');
      });

    const invalid = await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ name: '无效 Key', purpose: 'check', apiKey: 'invalid-key' }))
      .expect(201);
    await author.agent
      .post(`/api/v1/model-configs/${invalid.body.id}/test`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('invalid_key');
        expect(JSON.stringify(body)).not.toContain('invalid-key');
      });

    const network = await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ name: '网络错误', purpose: 'planning', apiKey: 'network-key' }))
      .expect(201);
    await author.agent
      .post(`/api/v1/model-configs/${network.body.id}/test`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('network_error');
        expect(JSON.stringify(body)).not.toContain('network-key');
        expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
      });
  });

  it('rejects unsupported providers and incomplete configuration details', async () => {
    const author = await createAuthor(app, passwordHash);

    await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ provider: 'openai' }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    await author.agent
      .post('/api/v1/model-configs')
      .send(configPayload({ apiKey: '' }))
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });
  });
});
