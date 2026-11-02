import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createDatabase } from '@novel/db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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

function uniqueEmail(prefix = 'account'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

async function clearMailpit(): Promise<void> {
  const response = await fetch(`${MAILPIT_API_URL}/api/v1/messages`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error(`Mailpit cleanup failed with HTTP ${response.status}`);
  }
}

async function readMessage(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${MAILPIT_API_URL}/api/v1/messages`);
    const payload = (await response.json()) as { messages: MailpitMessage[] };
    const message = payload.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address === email),
    );

    if (message) {
      const detailResponse = await fetch(`${MAILPIT_API_URL}/api/v1/message/${message.ID}`);
      const detail = (await detailResponse.json()) as MailpitMessageDetail;
      return [detail.Text, detail.HTML, detail.Snippet].join('\n');
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`No mail arrived for ${email}`);
}

async function readVerificationCode(email: string): Promise<string> {
  const body = await readMessage(email);
  const code = body.match(/(?<!\d)\d{6}(?!\d)/)?.[0];
  if (!code) {
    throw new Error(`No verification code found in mail for ${email}`);
  }
  return code;
}

describe('account lifecycle API', () => {
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
    process.env.WEB_URL = 'http://127.0.0.1:3000';

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

  async function registerAuthor(email: string, password: string): Promise<void> {
    await request(app.getHttpServer()).post('/api/v1/auth/send-code').send({ email }).expect(202);
    const code = await readVerificationCode(email);
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, code, password })
      .expect(201);
  }

  async function clearAuthRateLimits(): Promise<void> {
    const redis = app.get(RedisService).client;
    const keys = await redis.keys('auth:*');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }

  it('changes a password with current-password verification and revokes every session', async () => {
    await clearMailpit();
    const email = uniqueEmail('password-change');
    const oldPassword = 'correct horse battery staple';
    const newPassword = 'a different long password';
    await registerAuthor(email, oldPassword);

    const first = request.agent(app.getHttpServer());
    const second = request.agent(app.getHttpServer());
    await first.post('/api/v1/auth/login').send({ email, password: oldPassword }).expect(200);
    await second.post('/api/v1/auth/login').send({ email, password: oldPassword }).expect(200);

    await second
      .patch('/api/v1/auth/password')
      .send({ currentPassword: 'wrong password', newPassword })
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_CURRENT_PASSWORD');
      });

    await second
      .patch('/api/v1/auth/password')
      .send({ currentPassword: oldPassword, newPassword })
      .expect(204);

    await first.get('/api/v1/auth/me').expect(401);
    await second.get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    const userId = await app
      .get(DatabaseService)
      .pool.query<{ id: string }>('select id from users where email = $1', [email]);
    const audit = await app
      .get(DatabaseService)
      .pool.query<{ action: string; target_type: string }>(
        `select action, target_type from audit_logs
         where user_id = $1 and action = 'account_password_changed'`,
        [userId.rows[0].id],
      );
    expect(audit.rows).toEqual([
      { action: 'account_password_changed', target_type: 'account' },
    ]);
  });

  it('resets a forgotten password from a one-time email link', async () => {
    await clearMailpit();
    const email = uniqueEmail('password-reset');
    const oldPassword = 'correct horse battery staple';
    const newPassword = 'another long password';
    await registerAuthor(email, oldPassword);

    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password: oldPassword }).expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email })
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email: uniqueEmail('unknown') })
      .expect(202);

    const mail = await readMessage(email);
    const token = mail.match(/reset-password\?token=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token, newPassword: 'yet another password' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_RESET_TOKEN');
      });

    await agent.get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: oldPassword })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    const audit = await app
      .get(DatabaseService)
      .pool.query<{ action: string }>(
        `select action from audit_logs
         where user_id = (select id from users where email = $1)
           and action = 'account_password_reset'`,
        [email],
      );
    expect(audit.rows).toEqual([{ action: 'account_password_reset' }]);
  });

  it('changes an email only after verifying the new address and revokes every session', async () => {
    await clearMailpit();
    const email = uniqueEmail('email-change');
    const newEmail = uniqueEmail('email-changed');
    const password = 'correct horse battery staple';
    await registerAuthor(email, password);

    const first = request.agent(app.getHttpServer());
    const second = request.agent(app.getHttpServer());
    await first.post('/api/v1/auth/login').send({ email, password }).expect(200);
    await second.post('/api/v1/auth/login').send({ email, password }).expect(200);

    await second
      .post('/api/v1/users/me/email/change')
      .send({ newEmail, currentPassword: 'wrong password' })
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_CURRENT_PASSWORD');
      });

    await second
      .post('/api/v1/users/me/email/change')
      .send({ newEmail, currentPassword: password })
      .expect(202);
    const code = await readVerificationCode(newEmail);
    const wrongCode = code === '000000' ? '111111' : '000000';

    await second
      .post('/api/v1/users/me/email/verify')
      .send({ newEmail, code: wrongCode })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_CODE');
      });

    await second
      .post('/api/v1/users/me/email/verify')
      .send({ newEmail, code })
      .expect(204);

    await first.get('/api/v1/auth/me').expect(401);
    await second.get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: newEmail, password })
      .expect(200);

    const audit = await app
      .get(DatabaseService)
      .pool.query<{ action: string }>(
        `select action from audit_logs
         where user_id = (select id from users where email = $1)
           and action = 'account_email_changed'`,
        [newEmail],
      );
    expect(audit.rows).toEqual([{ action: 'account_email_changed' }]);
  });

  it('updates the display profile and returns it from the session identity', async () => {
    await clearMailpit();
    const email = uniqueEmail('profile');
    const password = 'correct horse battery staple';
    await registerAuthor(email, password);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);

    await agent
      .get('/api/v1/users/me')
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(email);
        expect(body.displayName).toBe(email.slice(0, email.indexOf('@')));
        expect(body.bio).toBe('');
        expect(body.avatarUrl).toBeNull();
      });

    await agent
      .patch('/api/v1/users/me')
      .send({
        displayName: '  青云客  ',
        bio: '  写仙侠，也写旧城故事。  ',
        avatarUrl: 'https://example.com/avatar.png',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body.displayName).toBe('青云客');
        expect(body.bio).toBe('写仙侠，也写旧城故事。');
        expect(body.avatarUrl).toBe('https://example.com/avatar.png');
      });

    await agent
      .get('/api/v1/auth/me')
      .expect(200)
      .expect(({ body }) => {
        expect(body.displayName).toBe('青云客');
        expect(body.bio).toBe('写仙侠，也写旧城故事。');
      });

    const audit = await app
      .get(DatabaseService)
      .pool.query<{ action: string; metadata: Record<string, unknown> }>(
        `select action, metadata from audit_logs
         where user_id = (select id from users where email = $1)
           and action = 'account_profile_updated'`,
        [email],
      );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].metadata).toEqual({
      fields: ['displayName', 'bio', 'avatarUrl'],
    });
  });

  it('manages multiple pen names with one default and hides another author pen names', async () => {
    await clearMailpit();
    const email = uniqueEmail('pen-names');
    const password = 'correct horse battery staple';
    await registerAuthor(email, password);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);

    const initial = await agent.get('/api/v1/users/me/pen-names').expect(200);
    expect(initial.body.items).toHaveLength(1);
    expect(initial.body.items[0]).toMatchObject({
      name: email.slice(0, email.indexOf('@')),
      bio: '',
      isDefault: true,
    });

    const created = await agent
      .post('/api/v1/users/me/pen-names')
      .send({ name: '青衫客', bio: '写江湖，也写人心。' })
      .expect(201);
    expect(created.body).toMatchObject({ name: '青衫客', isDefault: false });

    await agent
      .patch(`/api/v1/users/me/pen-names/${created.body.id}`)
      .send({ name: '青衫旧客', isDefault: true })
      .expect(200)
      .expect(({ body }) => {
        expect(body.name).toBe('青衫旧客');
        expect(body.isDefault).toBe(true);
      });

    const listed = await agent.get('/api/v1/users/me/pen-names').expect(200);
    expect(
      listed.body.items.map((item: { id: string; isDefault: boolean }) => ({
        id: item.id,
        isDefault: item.isDefault,
      })),
    ).toEqual([
      { id: created.body.id, isDefault: true },
      { id: initial.body.items[0].id, isDefault: false },
    ]);

    await agent
      .post('/api/v1/works')
      .send({
        title: '青衫旧事',
        penNameId: created.body.id,
        genrePack: 'xianxia',
        scale: 'long',
        targetPlatform: '起点中文网',
      })
      .expect(201)
      .expect(({ body }) => {
        expect(body.penName).toBe('青衫旧客');
        expect(body.penNameId).toBe(created.body.id);
      });

    await agent
      .delete(`/api/v1/users/me/pen-names/${created.body.id}`)
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('DEFAULT_PEN_NAME_REQUIRED');
      });
    await agent
      .patch(`/api/v1/users/me/pen-names/${initial.body.items[0].id}`)
      .send({ isDefault: true })
      .expect(200);
    await agent.delete(`/api/v1/users/me/pen-names/${created.body.id}`).expect(204);

    const otherEmail = uniqueEmail('pen-names-other');
    await clearAuthRateLimits();
    await registerAuthor(otherEmail, password);
    const other = request.agent(app.getHttpServer());
    await other.post('/api/v1/auth/login').send({ email: otherEmail, password }).expect(200);
    await other
      .patch(`/api/v1/users/me/pen-names/${initial.body.items[0].id}`)
      .send({ name: '越权笔名' })
      .expect(404);
    await other
      .delete(`/api/v1/users/me/pen-names/${initial.body.items[0].id}`)
      .expect(404);

    const audit = await app
      .get(DatabaseService)
      .pool.query<{ action: string }>(
        `select action from audit_logs
         where user_id = (select id from users where email = $1)
           and action like 'account_pen_name_%'
         order by created_at`,
        [email],
      );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'account_pen_name_created',
      'account_pen_name_updated',
      'account_pen_name_updated',
      'account_pen_name_deleted',
    ]);
  });

  it('requires an export and confirmation before a recoverable 30-day deletion', async () => {
    await clearMailpit();
    const email = uniqueEmail('deletion');
    const password = 'correct horse battery staple';
    const recoveryPassword = 'a recovered long password';
    await registerAuthor(email, password);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ email, password }).expect(200);

    await agent
      .post('/api/v1/users/me/delete')
      .send({ password, confirmation: '注销账号' })
      .expect(409)
      .expect(({ body }) => {
        expect(body.code).toBe('EXPORT_REQUIRED');
      });

    await agent.get('/api/v1/users/me/export').expect(200);

    await agent
      .post('/api/v1/users/me/delete')
      .send({ password: 'wrong password', confirmation: '注销账号' })
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe('INVALID_CURRENT_PASSWORD');
      });
    await agent
      .post('/api/v1/users/me/delete')
      .send({ password, confirmation: '删除' })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
      });

    const requested = await agent
      .post('/api/v1/users/me/delete')
      .send({ password, confirmation: '注销账号' })
      .expect(202);
    const scheduledFor = new Date(requested.body.deletionScheduledFor).getTime();
    expect(scheduledFor - Date.now()).toBeGreaterThan(29.9 * 24 * 60 * 60 * 1000);
    expect(scheduledFor - Date.now()).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);

    await agent.get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(403)
      .expect(({ body }) => {
        expect(body.code).toBe('ACCOUNT_PENDING_DELETION');
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/password/forgot')
      .send({ email })
      .expect(202);
    const recoveryToken = await (async () => {
      const mail = await readMessage(email);
      const match = mail.match(/reset-password\?token=([A-Za-z0-9_-]+)/);
      if (!match) {
        throw new Error('No recovery reset token found');
      }
      return match[1];
    })();
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/reset')
      .send({ token: recoveryToken, newPassword: recoveryPassword })
      .expect(204);

    const stored = await app
      .get(DatabaseService)
      .pool.query<{
        status: string;
        deletion_requested_at: Date | null;
        deletion_scheduled_for: Date | null;
        deleted_at: Date | null;
      }>(
        `select status, deletion_requested_at, deletion_scheduled_for, deleted_at
         from users where email = $1`,
        [email],
      );
    expect(stored.rows[0].status).toBe('pending_deletion');
    expect(stored.rows[0].deletion_requested_at).not.toBeNull();
    expect(stored.rows[0].deletion_scheduled_for).not.toBeNull();
    expect(stored.rows[0].deleted_at).toBeNull();

    await request(app.getHttpServer())
      .post('/api/v1/auth/recover')
      .send({ email, password: 'wrong password' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/recover')
      .send({ email, password: recoveryPassword })
      .expect(204);

    const recoveredAgent = request.agent(app.getHttpServer());
    await recoveredAgent
      .post('/api/v1/auth/login')
      .send({ email, password: recoveryPassword })
      .expect(200);
    await recoveredAgent
      .get('/api/v1/users/me')
      .expect(200)
      .expect(({ body }) => {
        expect(body.status).toBe('active');
        expect(body.deletionScheduledFor).toBeNull();
      });

    const audit = await app
      .get(DatabaseService)
      .pool.query<{ action: string }>(
        `select action from audit_logs
         where user_id = (select id from users where email = $1)
           and action in ('account_deletion_requested', 'account_recovered')
         order by created_at`,
        [email],
      );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'account_deletion_requested',
      'account_recovered',
    ]);
  });
});
