import { assertSecureEnv, envSchema, type Env } from '@novel/contracts';

export function validateEnv(config: Record<string, unknown>): Env {
  return assertSecureEnv(envSchema.parse(config));
}
