#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CADDYFILE = path.join(ROOT, 'infra', 'caddy', 'Caddyfile.production');
const suffix = `${process.pid}-${Date.now()}`;
const network = `novelbrain-smoke-${suffix}`;
const upstreamWeb = `novelbrain-smoke-web-${suffix}`;
const upstreamApi = `novelbrain-smoke-api-${suffix}`;
const caddy = `novelbrain-smoke-caddy-${suffix}`;
const httpsPort = await reservePort();
const httpPort = await reservePort();
const logDirectory = await mkdtemp(path.join(os.tmpdir(), 'novelbrain-caddy-'));

try {
  await docker(['network', 'create', network]);
  await docker([
    'run',
    '-d',
    '--name',
    upstreamWeb,
    '--network',
    network,
    '--network-alias',
    'web',
    'caddy:2-alpine',
    'caddy',
    'respond',
    '--listen',
    ':3000',
    '--body',
    'web-ok',
  ]);
  await docker([
    'run',
    '-d',
    '--name',
    upstreamApi,
    '--network',
    network,
    '--network-alias',
    'api',
    'caddy:2-alpine',
    'caddy',
    'respond',
    '--listen',
    ':3001',
    '--body',
    'api-ok',
  ]);
  await docker([
    'run',
    '-d',
    '--name',
    caddy,
    '--network',
    network,
    '-e',
    'APP_DOMAIN=localhost',
    '-e',
    'ACME_EMAIL=ops@example.com',
    '-v',
    `${CADDYFILE}:/etc/caddy/Caddyfile:ro`,
    '-v',
    `${logDirectory}:/var/log/caddy`,
    '-p',
    `127.0.0.1:${httpsPort}:443`,
    '-p',
    `127.0.0.1:${httpPort}:80`,
    'caddy:2-alpine',
  ]);

  await waitForHttps();
  const response = await requestHttps('/api/v1/downloads/test-token-value', {
    Cookie: 'nb_session=smoke-cookie-value',
    Authorization: 'Bearer smoke-auth-token',
  });
  if (response.statusCode !== 200 || response.body !== 'api-ok') {
    throw new Error(`Unexpected HTTPS response: ${response.statusCode} ${response.body}`);
  }
  if (!String(response.headers['strict-transport-security'] ?? '').includes('max-age=31536000')) {
    throw new Error('HSTS header is missing from the HTTPS response');
  }

  const redirect = await requestHttp('/');
  if (![301, 302, 307, 308].includes(redirect.statusCode)) {
    throw new Error(`HTTP was not redirected to HTTPS: ${redirect.statusCode}`);
  }
  if (!String(redirect.headers.location ?? '').startsWith('https://localhost/')) {
    throw new Error('HTTP redirect did not target the HTTPS host');
  }

  await docker(['stop', caddy]);
  const accessLog = await readAccessLog();
  if (!accessLog.includes('/api/v1/downloads/[REDACTED]')) {
    throw new Error('Caddy access log did not redact the signed download path');
  }
  if (accessLog.includes('test-token-value')) {
    throw new Error('Caddy access log leaked a signed download token');
  }
  if (accessLog.includes('smoke-cookie-value') || accessLog.includes('smoke-auth-token')) {
    throw new Error('Caddy access log leaked a credential header');
  }
  process.stdout.write('Production Caddy runtime security smoke: PASS\n');
} finally {
  await docker(['rm', '-f', caddy], true);
  await docker(['rm', '-f', upstreamApi], true);
  await docker(['rm', '-f', upstreamWeb], true);
  await docker(['network', 'rm', network], true);
  await rm(logDirectory, { recursive: true, force: true });
}

async function waitForHttps() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await requestHttps('/');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `Caddy did not become ready: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
}

function requestHttps(requestPath, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: '127.0.0.1',
        port: httpsPort,
        path: requestPath,
        method: 'GET',
        rejectUnauthorized: false,
        servername: 'localhost',
        headers: { Host: 'localhost', ...extraHeaders },
        timeout: 5_000,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('HTTPS request timed out')));
    request.on('error', reject);
    request.end();
  });
}

function requestHttp(requestPath) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port: httpPort,
        path: requestPath,
        method: 'GET',
        headers: { Host: 'localhost' },
        timeout: 5_000,
      },
      (response) => {
        response.resume();
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
          });
        });
      },
    );
    request.on('timeout', () => request.destroy(new Error('HTTP request timed out')));
    request.on('error', reject);
    request.end();
  });
}

async function readAccessLog() {
  const contents = await dockerCapture([
    'run',
    '--rm',
    '-v',
    `${logDirectory}:/logs:ro`,
    'caddy:2-alpine',
    'sh',
    '-c',
    'cat /logs/access*.log',
  ]);
  if (!contents.trim()) {
    throw new Error('Caddy access log file was not created');
  }
  return contents;
}

function docker(args, allowFailure = false) {
  return dockerCapture(args, allowFailure).then(() => undefined);
}

function dockerCapture(args, allowFailure = false) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !allowFailure) {
        const detail = Buffer.concat([...stdout, ...stderr])
          .toString('utf8')
          .trim();
        reject(new Error(`docker ${args[0]} exited with code ${code}: ${detail}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a smoke-test port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}
