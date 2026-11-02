#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === '--skip-docker') {
      options.skipDocker = true;
      continue;
    }
    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }
    if (value !== '--env-file') {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error('Missing value for --env-file');
    }
    options.envFile = path.resolve(next);
    index += 1;
  }
  return options;
}

export function inspectProductionArtifacts(root = ROOT) {
  return Promise.all([
    readFile(path.join(root, 'infra', 'caddy', 'Caddyfile.production'), 'utf8'),
    readFile(path.join(root, 'docker-compose.production.yml'), 'utf8'),
    readFile(path.join(root, '.env.production.example'), 'utf8'),
    readFile(path.join(root, 'docs', 'operations', 'production-deployment.md'), 'utf8'),
  ]).then(([caddyfile, compose, envExample, runbook]) => {
    const findings = [];
    requireText(findings, caddyfile, 'Strict-Transport-Security', 'Caddy HSTS header');
    requireText(findings, caddyfile, 'format filter', 'Caddy redacting log filter');
    requireText(findings, caddyfile, '/downloads/[REDACTED]', 'signed download log redaction');
    requireText(findings, caddyfile, 'roll_keep_for 720h', '30-day Caddy log retention');
    requireText(findings, compose, 'NODE_ENV: production', 'production API environment');
    requireText(findings, compose, "COOKIE_SECURE: 'true'", 'secure production cookies');
    requireText(findings, compose, 'DOWNLOAD_SIGNING_SECRET:', 'signed download secret');
    requireText(findings, compose, 'SMTP_REQUIRE_TLS:', 'SMTP TLS');
    requireText(findings, compose, 'ENCRYPTION_AT_REST_CONFIRMED:', 'encryption-at-rest check');
    requireText(findings, compose, 'OFFSITE_BACKUP_CONFIRMED:', 'offsite backup check');
    forbidText(findings, compose, 'development-session-secret', 'development session secret');
    forbidText(findings, compose, 'minio123', 'default MinIO password');
    forbidText(findings, compose, '5432:5432', 'published Postgres port');
    forbidText(findings, compose, '6379:6379', 'published Redis port');
    forbidText(findings, compose, '9000:9000', 'published MinIO port');
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
      requireText(findings, envExample, `${key}=`, `production env example ${key}`);
    }
    requireText(findings, runbook, 'Offsite backup', 'offsite backup runbook');
    requireText(findings, runbook, 'Encryption at rest', 'encryption-at-rest runbook');
    requireText(findings, runbook, '日志保留与脱敏', 'log retention runbook');
    return findings;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`NovelBrain production deployment check

Usage:
  node scripts/deployment-check.mjs [--env-file .env.production] [--skip-docker]

Checks production Compose/Caddy artifacts, optionally validates the environment with
the compiled contracts package, and runs docker compose config plus caddy validate.
`);
    return;
  }

  const findings = await inspectProductionArtifacts();
  if (findings.length > 0) {
    throw new Error(`Production artifact check failed:\n- ${findings.join('\n- ')}`);
  }
  process.stdout.write('Production artifacts: PASS\n');

  const exampleValues = await parseEnvFile(path.join(ROOT, '.env.production.example'));
  let envValues = { ...exampleValues, ...process.env };
  if (options.envFile) {
    envValues = { ...envValues, ...(await parseEnvFile(options.envFile)) };
  } else {
    process.stdout.write(
      'Production environment: SKIPPED (pass --env-file to verify effective app env)\n',
    );
  }

  if (options.skipDocker) {
    if (options.envFile) {
      throw new Error('--env-file validation requires Docker Compose; remove --skip-docker');
    }
    process.stdout.write('Docker config validation: SKIPPED\n');
    return;
  }

  const composeArgs = [
    'compose',
    '-f',
    path.join(ROOT, 'docker-compose.yml'),
    '-f',
    path.join(ROOT, 'docker-compose.production.yml'),
  ];
  if (options.envFile) {
    composeArgs.push('--env-file', options.envFile);
  }
  composeArgs.push('config', '--format', 'json');
  const effectiveConfig = JSON.parse(await runCapture('docker', composeArgs, envValues));
  process.stdout.write('Production Compose config: PASS\n');

  if (options.envFile) {
    const compiledEnv = path.join(ROOT, 'packages', 'contracts', 'dist', 'env.js');
    if (!existsSync(compiledEnv)) {
      throw new Error('Build the workspace first so packages/contracts/dist/env.js exists');
    }
    const { assertSecureEnv, envSchema } = await import(pathToFileURL(compiledEnv).href);
    for (const service of ['api', 'worker']) {
      const serviceEnvironment = normalizeServiceEnvironment(
        effectiveConfig.services?.[service]?.environment,
      );
      assertSecureEnv(envSchema.parse(serviceEnvironment));
    }
    process.stdout.write('Production environment: PASS (api, worker)\n');
  }

  const caddyfile = path.join(ROOT, 'infra', 'caddy', 'Caddyfile.production');
  await run(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      `APP_DOMAIN=${envValues.APP_DOMAIN ?? 'novelbrain.example.com'}`,
      '-e',
      `ACME_EMAIL=${envValues.ACME_EMAIL ?? 'ops@example.com'}`,
      '-v',
      `${caddyfile}:/etc/caddy/Caddyfile:ro`,
      'caddy:2-alpine',
      'caddy',
      'validate',
      '--config',
      '/etc/caddy/Caddyfile',
    ],
    envValues,
  );
  process.stdout.write('Production Caddy config: PASS\n');
}

function requireText(findings, text, needle, label) {
  if (!text.includes(needle)) {
    findings.push(`${label} is missing (${needle})`);
  }
}

function forbidText(findings, text, needle, label) {
  if (text.includes(needle)) {
    findings.push(`${label} is still present (${needle})`);
  }
}

async function parseEnvFile(filename) {
  const values = {};
  const content = await readFile(filename, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function run(command, args, env) {
  return runCapture(command, args, env).then(() => undefined);
}

function runCapture(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat([...stdout, ...stderr])
          .toString('utf8')
          .trim();
        reject(new Error(`${command} exited with code ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function normalizeServiceEnvironment(environment) {
  if (Array.isArray(environment)) {
    return Object.fromEntries(
      environment
        .filter((entry) => typeof entry === 'string' && entry.includes('='))
        .map((entry) => {
          const separator = entry.indexOf('=');
          return [entry.slice(0, separator), entry.slice(separator + 1)];
        }),
    );
  }
  return Object.fromEntries(
    Object.entries(environment ?? {}).map(([key, value]) => [key, value ?? '']),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
