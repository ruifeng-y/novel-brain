import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  API_INTERNAL_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  MINIO_ENDPOINT: z.string().url().default('http://localhost:9000'),
  MINIO_ACCESS_KEY: z.string().default('minio'),
  MINIO_SECRET_KEY: z.string().default('minio123'),
  MINIO_BUCKET: z.string().default('novel-brain'),
  SESSION_SECRET: z.string().min(16),
});

export type Env = z.infer<typeof envSchema>;
