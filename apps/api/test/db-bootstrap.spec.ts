import { describe, expect, it } from 'vitest';
// @ts-expect-error Ops helpers are plain ESM so they can run without a build step.
import {
  buildAlterRoleSql,
  parseApplicationDatabaseUrl,
} from '../../../scripts/ensure-app-role-password.mjs';

describe('production database bootstrap', () => {
  it('reads the application role and password from the encoded database URL', () => {
    expect(
      parseApplicationDatabaseUrl('postgres://novel_app:p%40ss%27word@postgres:5432/novel'),
    ).toEqual({
      role: 'novel_app',
      password: "p@ss'word",
    });
  });

  it('builds a safely quoted ALTER ROLE statement', () => {
    expect(buildAlterRoleSql('novel_app', "p@ss'word")).toBe(
      `ALTER ROLE "novel_app" WITH PASSWORD 'p@ss''word'`,
    );
  });

  it('refuses to synchronize an unexpected role name', () => {
    expect(() => buildAlterRoleSql('novel; drop database novel', 'password')).toThrow(
      'Unexpected application database role',
    );
  });
});
