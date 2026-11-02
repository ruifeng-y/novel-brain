#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const APPLICATION_ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

export function parseApplicationDatabaseUrl(value) {
  const url = new URL(value);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (role !== 'novel_app') {
    throw new Error('Unexpected application database role');
  }
  if (!password) {
    throw new Error('DATABASE_URL must include the application role password');
  }
  return { role, password };
}

export function buildAlterRoleSql(role, password) {
  if (!APPLICATION_ROLE.test(role) || role !== 'novel_app') {
    throw new Error('Unexpected application database role');
  }
  return `ALTER ROLE ${quoteIdentifier(role)} WITH PASSWORD ${quoteLiteral(password)}`;
}

export async function syncApplicationRolePassword({
  adminUrl,
  appUrl,
  connect = (connectionString) => new Client({ connectionString }),
}) {
  const { role, password } = parseApplicationDatabaseUrl(appUrl);
  const client = connect(adminUrl);
  await client.connect();
  try {
    await client.query(buildAlterRoleSql(role, password));
  } finally {
    await client.end();
  }
  return { role };
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function main() {
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  const appUrl = process.env.DATABASE_URL;
  if (!adminUrl || !appUrl) {
    throw new Error('DATABASE_ADMIN_URL and DATABASE_URL are required');
  }
  const { role } = await syncApplicationRolePassword({ adminUrl, appUrl });
  process.stdout.write(`Application database role ${role} password synchronized\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
