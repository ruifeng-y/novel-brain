import { z } from 'zod';

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
  AI_PROVIDER: z.enum(['deepseek', 'fake']).default('deepseek'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().min(1).default('noreply@novelbrain.local'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
});

export type Env = z.infer<typeof envSchema>;

export const DEFAULT_APP_DATABASE_PASSWORD = 'novel_app';

export function assertSecureEnv(env: Env): Env {
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
    return env;
  }

  const databaseUrl = new URL(env.DATABASE_URL);
  if (databaseUrl.password === DEFAULT_APP_DATABASE_PASSWORD) {
    if (env.ALLOW_DEFAULT_DB_PASSWORD === true) {
      console.warn(
        'WARNING: the default novel_app database password is enabled for this deployment. Rotate it before production use.',
      );
      return env;
    }
    throw new Error(
      'Refusing to start with the default novel_app database password. Rotate the role password, update DATABASE_URL, and remove ALLOW_DEFAULT_DB_PASSWORD.',
    );
  }
  return env;
}
