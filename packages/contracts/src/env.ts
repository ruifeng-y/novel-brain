import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_INTERNAL_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().min(1).optional(),
  ALLOW_DEFAULT_DB_PASSWORD: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  MINIO_ENDPOINT: z.string().url().default('http://localhost:9000'),
  MINIO_ACCESS_KEY: z.string().default('minio'),
  MINIO_SECRET_KEY: z.string().default('minio123'),
  MINIO_BUCKET: z.string().default('novel-brain'),
  SESSION_SECRET: z.string().min(16),
  MODEL_KEY_ENCRYPTION_KEY: z.string().min(1),
  DOWNLOAD_SIGNING_SECRET: z.string().optional(),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
  AI_PROVIDER: z.enum(['deepseek', 'fake']).default('deepseek'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  GENERATION_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  GENERATION_USER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  GENERATION_WORK_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  GENERATION_DEFER_MS: z.coerce.number().int().min(50).max(30_000).default(250),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1).default('noreply@novelbrain.local'),
  SMTP_SECURE: booleanString,
  SMTP_REQUIRE_TLS: booleanString,
  SMTP_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  SMTP_TLS_MIN_VERSION: z.enum(['TLSv1.2', 'TLSv1.3']).default('TLSv1.2'),
  COOKIE_SECURE: booleanString,
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
  LOG_FORMAT: z.enum(['json', 'text']).default('text'),
  LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  ENCRYPTION_AT_REST_CONFIRMED: booleanString,
  OFFSITE_BACKUP_CONFIRMED: booleanString,
});

export type Env = z.infer<typeof envSchema>;

export const DEFAULT_APP_DATABASE_PASSWORD = 'novel_app';
export const DEFAULT_DATABASE_OWNER_PASSWORD = 'novel';
export const DEFAULT_MINIO_ACCESS_KEY = 'minio';
export const DEFAULT_MINIO_SECRET_KEY = 'minio123';
export const DEVELOPMENT_SESSION_SECRET = 'development-session-secret';
export const DEVELOPMENT_MODEL_KEY = 'ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3iJmqu8zd7v8=';
const DEVELOPMENT_MODEL_KEY_HEX =
  '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

function isThirtyTwoByteKey(value: string): boolean {
  const trimmed = value.trim();
  try {
    const decoded = /^[0-9a-f]{64}$/i.test(trimmed)
      ? Buffer.from(trimmed, 'hex')
      : Buffer.from(trimmed, 'base64');
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function assertSecureEnv(env: Env): Env {
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    return env;
  }

  const webUrl = new URL(env.WEB_URL);
  if (webUrl.protocol !== 'https:') {
    throw new Error('WEB_URL must use https in production');
  }
  if (env.COOKIE_SECURE !== true) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  if (
    env.SESSION_SECRET.length < 32 ||
    env.SESSION_SECRET === DEVELOPMENT_SESSION_SECRET ||
    env.SESSION_SECRET.startsWith('test-')
  ) {
    throw new Error('SESSION_SECRET must be at least 32 characters and not a development value');
  }
  if (
    !isThirtyTwoByteKey(env.MODEL_KEY_ENCRYPTION_KEY) ||
    env.MODEL_KEY_ENCRYPTION_KEY === DEVELOPMENT_MODEL_KEY ||
    env.MODEL_KEY_ENCRYPTION_KEY.toLowerCase() === DEVELOPMENT_MODEL_KEY_HEX
  ) {
    throw new Error(
      'MODEL_KEY_ENCRYPTION_KEY must be replaced with a 32-byte production encryption key',
    );
  }
  if (!env.DOWNLOAD_SIGNING_SECRET || env.DOWNLOAD_SIGNING_SECRET.length < 32) {
    throw new Error('DOWNLOAD_SIGNING_SECRET must be at least 32 characters in production');
  }
  if (env.DOWNLOAD_SIGNING_SECRET === env.SESSION_SECRET) {
    throw new Error('DOWNLOAD_SIGNING_SECRET must be different from SESSION_SECRET');
  }
  if (env.LOG_FORMAT !== 'json') {
    throw new Error('LOG_FORMAT must be json in production');
  }
  if (env.LOG_RETENTION_DAYS < 30) {
    throw new Error('LOG_RETENTION_DAYS must be at least 30 in production');
  }
  if (!env.ENCRYPTION_AT_REST_CONFIRMED) {
    throw new Error(
      'ENCRYPTION_AT_REST_CONFIRMED must be true after database, object, and backup storage encryption is verified',
    );
  }
  if (!env.OFFSITE_BACKUP_CONFIRMED) {
    throw new Error(
      'OFFSITE_BACKUP_CONFIRMED must be true after an offsite backup and restore check succeeds',
    );
  }
  if (!env.SMTP_HOST || ['localhost', '127.0.0.1', 'mailpit'].includes(env.SMTP_HOST)) {
    throw new Error('SMTP_HOST must be a production relay');
  }
  if (!env.SMTP_FROM.includes('@') || env.SMTP_FROM.endsWith('.local')) {
    throw new Error('SMTP_FROM must use a public domain');
  }
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) {
    throw new Error('SMTP_USER and SMTP_PASSWORD are required in production');
  }
  if (!env.SMTP_SECURE && !env.SMTP_REQUIRE_TLS) {
    throw new Error('SMTP must use TLS (SMTP_SECURE or SMTP_REQUIRE_TLS)');
  }
  if (!env.SMTP_REJECT_UNAUTHORIZED) {
    throw new Error('SMTP_REJECT_UNAUTHORIZED must be true in production');
  }

  const databaseUrl = new URL(env.DATABASE_URL);
  if (!databaseUrl.password || databaseUrl.password === DEFAULT_APP_DATABASE_PASSWORD) {
    throw new Error(
      'Refusing to start with the default novel_app database password. Rotate the role password, update DATABASE_URL, and remove ALLOW_DEFAULT_DB_PASSWORD.',
    );
  }
  if (env.DATABASE_ADMIN_URL) {
    const adminUrl = new URL(env.DATABASE_ADMIN_URL);
    if (!adminUrl.password || adminUrl.password === DEFAULT_DATABASE_OWNER_PASSWORD) {
      throw new Error(
        'Refusing to start with the default database owner password. Rotate DATABASE_ADMIN_URL before production use.',
      );
    }
  }
  if (env.MINIO_ACCESS_KEY === DEFAULT_MINIO_ACCESS_KEY) {
    throw new Error('MINIO_ACCESS_KEY must be replaced in production');
  }
  if (env.MINIO_SECRET_KEY === DEFAULT_MINIO_SECRET_KEY) {
    throw new Error('MINIO_SECRET_KEY must be replaced in production');
  }
  return env;
}
