import { describe, expect, it } from 'vitest';
import { assertSecureEnv, envSchema } from './env';

const BASE_ENV = {
  DATABASE_URL: 'postgres://novel_app:novel_app@localhost:5432/novel',
  SESSION_SECRET: 'test-session-secret-at-least-16-characters',
  MODEL_KEY_ENCRYPTION_KEY: '00112233445566778899aabbccddeeff',
};

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  WEB_URL: 'https://novel.example.com',
  DATABASE_URL: 'postgres://novel_app:rotated-strong-password@db:5432/novel',
  DATABASE_ADMIN_URL: 'postgres://novel:rotated-owner-password@db:5432/novel',
  MINIO_ACCESS_KEY: 'production-access-key',
  MINIO_SECRET_KEY: 'production-secret-key',
  SESSION_SECRET: 'production-session-secret-at-least-32-characters',
  MODEL_KEY_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  DOWNLOAD_SIGNING_SECRET: 'production-download-secret-at-least-32-characters',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'smtp-user',
  SMTP_PASSWORD: 'smtp-password',
  SMTP_FROM: 'noreply@novel.example.com',
  SMTP_REQUIRE_TLS: 'true',
  COOKIE_SECURE: 'true',
  LOG_FORMAT: 'json',
  LOG_RETENTION_DAYS: '30',
  ENCRYPTION_AT_REST_CONFIRMED: 'true',
  OFFSITE_BACKUP_CONFIRMED: 'true',
};

function productionEnv(overrides: Record<string, string> = {}) {
  return envSchema.parse({ ...PRODUCTION_ENV, ...overrides });
}

describe('deployment environment safety', () => {
  it('keeps local development usable with the development defaults', () => {
    const env = envSchema.parse({ ...BASE_ENV, NODE_ENV: 'development' });

    expect(() => assertSecureEnv(env)).not.toThrow();
  });

  it('accepts a fully hardened production configuration', () => {
    expect(() => assertSecureEnv(productionEnv())).not.toThrow();
  });

  it('fails a production start that still uses the default novel_app password', () => {
    const env = productionEnv({
      DATABASE_URL: 'postgres://novel_app:novel_app@db:5432/novel',
      ALLOW_DEFAULT_DB_PASSWORD: 'true',
    });

    expect(() => assertSecureEnv(env)).toThrow(
      'Refusing to start with the default novel_app database password',
    );
  });

  it('requires HTTPS, Secure cookies, and non-development secrets in production', () => {
    expect(() => assertSecureEnv(productionEnv({ WEB_URL: 'http://novel.example.com' }))).toThrow(
      'WEB_URL must use https',
    );
    expect(() => assertSecureEnv(productionEnv({ COOKIE_SECURE: 'false' }))).toThrow(
      'COOKIE_SECURE must be true',
    );
    expect(() =>
      assertSecureEnv(productionEnv({ SESSION_SECRET: 'development-session-secret' })),
    ).toThrow('SESSION_SECRET must be at least 32 characters');
    expect(() =>
      assertSecureEnv(
        productionEnv({ MODEL_KEY_ENCRYPTION_KEY: 'ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3iJmqu8zd7v8=' }),
      ),
    ).toThrow('MODEL_KEY_ENCRYPTION_KEY must be replaced');
  });

  it('requires production SMTP authentication over TLS', () => {
    expect(() => assertSecureEnv(productionEnv({ SMTP_HOST: 'mailpit' }))).toThrow(
      'SMTP_HOST must be a production relay',
    );
    expect(() => assertSecureEnv(productionEnv({ SMTP_FROM: 'noreply@novelbrain.local' }))).toThrow(
      'SMTP_FROM must use a public domain',
    );
    expect(() => assertSecureEnv(productionEnv({ SMTP_USER: '', SMTP_PASSWORD: '' }))).toThrow(
      'SMTP_USER and SMTP_PASSWORD are required',
    );
    expect(() =>
      assertSecureEnv(productionEnv({ SMTP_REQUIRE_TLS: 'false', SMTP_SECURE: 'false' })),
    ).toThrow('SMTP must use TLS');
  });

  it('requires signed downloads, retained JSON logs, and operator encryption attestations', () => {
    expect(() => assertSecureEnv(productionEnv({ DOWNLOAD_SIGNING_SECRET: '' }))).toThrow(
      'DOWNLOAD_SIGNING_SECRET must be at least 32 characters',
    );
    expect(() => productionEnv({ DOWNLOAD_URL_TTL_SECONDS: '3600' })).toThrow(
      'DOWNLOAD_URL_TTL_SECONDS',
    );
    expect(() => assertSecureEnv(productionEnv({ LOG_FORMAT: 'text' }))).toThrow(
      'LOG_FORMAT must be json',
    );
    expect(() => assertSecureEnv(productionEnv({ LOG_RETENTION_DAYS: '7' }))).toThrow(
      'LOG_RETENTION_DAYS must be at least 30',
    );
    expect(() => assertSecureEnv(productionEnv({ ENCRYPTION_AT_REST_CONFIRMED: 'false' }))).toThrow(
      'ENCRYPTION_AT_REST_CONFIRMED must be true',
    );
    expect(() => assertSecureEnv(productionEnv({ OFFSITE_BACKUP_CONFIRMED: 'false' }))).toThrow(
      'OFFSITE_BACKUP_CONFIRMED must be true',
    );
  });
});
