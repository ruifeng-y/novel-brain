import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDatabase } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseService } from '../src/database/database.service';
import { RedisService } from '../src/redis/redis.service';

const MAILPIT_API_URL = 'http://127.0.0.1:8025';

type MailpitMessage = {
  ID: string;
  To: Array<{ Address: string }>;
};

type MailpitMessageDetail = {
  Text: string;
  HTML: string;
  Snippet: string;
};

function uniqueEmail(): string {
  return `author-${randomUUID()}@example.com`;
}

async function clearMailpit(): Promise<void> {
  const response = await fetch(`${MAILPIT_API_URL}/api/v1/messages`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Mailpit cleanup failed with HTTP ${response.status}`);
  }
}

async function readVerificationCode(email: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${MAILPIT_API_URL}/api/v1/messages`);
    const payload = (await response.json()) as { messages: MailpitMessage[] };
    const message = payload.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address === email),
    );

    if (message) {
      const detailResponse = await fetch(`${MAILPIT_API_URL}/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as MailpitMessageDetail;
      const code = [detail.Text, detail.HTML, detail.Snippet]
        .join('\n')
        .match(/(?<!\d)\d{6}(?!\d)/)?.[0];
      if (code) {
        return code;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`No verification code message arrived for ${email}`);
}

describe('email authentication API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://novel:novel@127.0.0.1:5432/novel';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/15';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '6379';
    process.env.SESSION_SECRET = 'test-session-secret-at-least-16-characters';
    process.env.MODEL_KEY_ENCRYPTION_KEY =
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1025';
    process.env.SMTP_FROM = 'noreply@novelbrain.local';

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
    const redis = app.get(RedisService).client;
    const keys = await redis.keys('auth:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  });

  it('sends a six-digit registration code and stores only its hash', async () => {
    await clearMailpit();
    const email = uniqueEmail();

    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);

    const code = await readVerificationCode(email);
    expect(code).toMatch(/^\d{6}$/);

    const stored = await app
      .get(DatabaseService)
      .pool.query<{ code_hash: string }>(
        'select code_hash from email_codes where email = $1 order by created_at desc limit 1',
        [email],
      );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].code_hash).not.toBe(code);
    expect(stored.rows[0].code_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rate limits verification code sends per email', async () => {
    await clearMailpit();
    const email = uniqueEmail();

    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/auth/send-code')
      .send({ email })
      .expect(429)
      .expect(({ body }) => {
        expect(body.code).toBe('RATE_LIMITED');
      });
  });

  it('rate limits verification code sends per IP address', async () => {
    await clearMailpit();

    await request(app.getHttpServer())
      .post('/api/v1/auth/send-code')
      .send({ email: uniqueEmail() })
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/auth/send-code')
      .send({ email: uniqueEmail() })
      .expect(429)
      .expect(({ body }) => {
        expect(body.code).toBe('RATE_LIMITED');
      });
  });

  it('rejects an expired registration code', async () => {
    await clearMailpit();
    const email = uniqueEmail();

    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);
    const code = await readVerificationCode(email);
    await app
      .get(DatabaseService)
      .pool.query(
        `update email_codes set expires_at = now() - interval '1 minute' where email = $1`,
        [email],
      );

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, code, password: 'correct horse battery staple' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_CODE');
      });
  });

  it('locks a code after repeated incorrect attempts', async () => {
    await clearMailpit();
    const email = uniqueEmail();

    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);
    const code = await readVerificationCode(email);
    const wrongCode = code === '000000' ? '111111' : '000000';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, code: wrongCode, password: 'correct horse battery staple' })
        .expect(400);
    }

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, code, password: 'correct horse battery staple' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_CODE');
      });
  });

  it('rate limits repeated failed sign-in attempts', async () => {
    await clearMailpit();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';

    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);
    const code = await readVerificationCode(email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, code, password })
      .expect(201);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong password' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(429)
      .expect(({ body }) => {
        expect(body.code).toBe('RATE_LIMITED');
      });
  });

  it('registers with the emailed code, logs in, and invalidates the session on logout', async () => {
    await clearMailpit();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';
    const agent = request.agent(app.getHttpServer());

    await agent.post('/api/v1/auth/send-code').send({ email }).expect(202);
    const code = await readVerificationCode(email);

    await agent
      .post('/api/v1/auth/register')
      .send({ email, code, password })
      .expect(201)
      .expect(({ body }) => {
        expect(body.email).toBe(email);
      });

    const stored = await app.get(DatabaseService).pool.query<{
      user_id: string;
      password_hash: string;
      consumed_at: Date | null;
    }>(
      `select users.id as user_id, users.password_hash, email_codes.consumed_at
       from users
       join email_codes on email_codes.email = users.email
       where users.email = $1
       order by email_codes.created_at desc
       limit 1`,
      [email],
    );
    expect(stored.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(stored.rows[0].consumed_at).not.toBeNull();

    const login = await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    expect(login.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(login.headers['set-cookie'][0]).toContain('SameSite=Lax');

    const sessionCookie = login.headers['set-cookie'][0]
      .split(';')[0]
      .split('=')
      .slice(1)
      .join('=');
    const storedSession = await app.get(DatabaseService).pool.query<{
      token_hash: string;
      revoked_at: Date | null;
    }>('select token_hash, revoked_at from sessions where user_id = $1', [stored.rows[0].user_id]);
    expect(storedSession.rows[0].token_hash).not.toBe(sessionCookie);
    expect(storedSession.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedSession.rows[0].revoked_at).toBeNull();

    await agent
      .get('/api/v1/auth/me')
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(email);
      });

    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('revokes every session when the user logs out of all devices', async () => {
    await clearMailpit();
    const email = uniqueEmail();
    const password = 'correct horse battery staple';
    const firstAgent = request.agent(app.getHttpServer());
    const secondAgent = request.agent(app.getHttpServer());

    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);
    const code = await readVerificationCode(email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, code, password })
      .expect(201);

    await firstAgent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    await secondAgent.post('/api/v1/auth/login').send({ email, password }).expect(200);
    await firstAgent.get('/api/v1/auth/me').expect(200);
    await secondAgent.get('/api/v1/auth/me').expect(200);

    await firstAgent.post('/api/v1/auth/logout-all').expect(204);

    await firstAgent.get('/api/v1/auth/me').expect(401);
    await secondAgent.get('/api/v1/auth/me').expect(401);
  });
});
