import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('production deployment artifacts', () => {
  it('serves HTTPS with HSTS and redacts signed download paths in retained access logs', async () => {
    const caddyfile = await readFile(
      path.join(ROOT, 'infra', 'caddy', 'Caddyfile.production'),
      'utf8',
    );

    expect(caddyfile).toContain('{$APP_DOMAIN}');
    expect(caddyfile).toContain('Strict-Transport-Security');
    expect(caddyfile).toContain('format filter');
    expect(caddyfile).toContain('request>uri');
    expect(caddyfile).toContain('/downloads/[REDACTED]');
    expect(caddyfile).toContain('roll_keep_for 720h');
    expect(caddyfile).toContain('request>headers>Cookie delete');
  });

  it('overlays strict production service, TLS, SMTP, and logging settings', async () => {
    const compose = await readFile(path.join(ROOT, 'docker-compose.production.yml'), 'utf8');
    const envExample = await readFile(path.join(ROOT, '.env.production.example'), 'utf8');

    expect(compose).toContain('NODE_ENV: production');
    expect(compose).toContain("COOKIE_SECURE: 'true'");
    expect(compose).toContain('DOWNLOAD_SIGNING_SECRET: ${DOWNLOAD_SIGNING_SECRET:?');
    expect(compose).toContain('SMTP_SECURE:');
    expect(compose).toContain('SMTP_REQUIRE_TLS:');
    expect(compose).toContain('LOG_FORMAT: json');
    expect(compose).toContain('LOG_RETENTION_DAYS:');
    expect(compose).toContain('ENCRYPTION_AT_REST_CONFIRMED:');
    expect(compose).toContain('OFFSITE_BACKUP_CONFIRMED:');
    expect(compose).toContain('max-size:');
    expect(compose).not.toContain('development-session-secret');
    expect(compose).not.toContain("ALLOW_DEFAULT_DB_PASSWORD: 'true'");
    expect(compose).not.toContain('5432:5432');
    expect(compose).not.toContain('6379:6379');
    expect(compose).not.toContain('9000:9000');

    for (const key of [
      'APP_DOMAIN',
      'ACME_EMAIL',
      'SESSION_SECRET',
      'MODEL_KEY_ENCRYPTION_KEY',
      'DOWNLOAD_SIGNING_SECRET',
      'SMTP_HOST',
      'SMTP_USER',
      'SMTP_PASSWORD',
      'ENCRYPTION_AT_REST_CONFIRMED',
      'OFFSITE_BACKUP_CONFIRMED',
    ]) {
      expect(envExample).toContain(`${key}=`);
    }
    expect(envExample).not.toContain('development-session-secret');
    expect(envExample).not.toContain('minio123');
  });
});
