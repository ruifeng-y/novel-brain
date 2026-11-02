import { describe, expect, it } from 'vitest';
import { assertSecureEnv, envSchema } from './env';

const BASE_ENV = {
  DATABASE_URL: 'postgres://novel_app:novel_app@localhost:5432/novel',
  SESSION_SECRET: 'test-session-secret-at-least-16-characters',
  MODEL_KEY_ENCRYPTION_KEY: '00112233445566778899aabbccddeeff',
};

describe('database deployment safety', () => {
  it('fails a production start that still uses the default novel_app password', () => {
    const env = envSchema.parse({ ...BASE_ENV, NODE_ENV: 'production' });

    expect(() => assertSecureEnv(env)).toThrow(
      'Refusing to start with the default novel_app database password',
    );
  });

  it('allows an explicit local override or a rotated password', () => {
    const localOverride = envSchema.parse({
      ...BASE_ENV,
      NODE_ENV: 'production',
      ALLOW_DEFAULT_DB_PASSWORD: 'true',
    });
    const rotated = envSchema.parse({
      ...BASE_ENV,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://novel_app:rotated-strong-password@localhost:5432/novel',
    });

    expect(() => assertSecureEnv(localOverride)).not.toThrow();
    expect(() => assertSecureEnv(rotated)).not.toThrow();
  });
});
