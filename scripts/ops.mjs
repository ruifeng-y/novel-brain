#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  backupDirectory,
  backupTimestamp,
  isBackupExpired,
  resolveInside,
  safeBucketName,
  safeDatabaseName,
} from './ops-lib.mjs';
import {
  createObjectBackup,
  createObjectClient,
  removeBucket,
  restoreObjectBackup,
} from './object-backup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_BACKUP_DIR = path.join(ROOT, 'backups');
const DEFAULT_COMPOSE_FILE = path.join(ROOT, 'docker-compose.yml');
const DEFAULT_RETENTION_DAYS = 30;
const RPO_SECONDS = 24 * 60 * 60;
const RTO_SECONDS = 4 * 60 * 60;

function parseArgs(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const key = value.slice(2);
    if (key === 'keep' || key === 'drop-existing') {
      options[key] = true;
      continue;
    }
    const next = values[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function config(options) {
  const objectBucket = options['object-bucket'] ?? process.env.MINIO_BUCKET ?? 'novel-brain';
  safeBucketName(objectBucket);
  return {
    composeFile: path.resolve(options['compose-file'] ?? DEFAULT_COMPOSE_FILE),
    postgresService: options['postgres-service'] ?? 'postgres',
    postgresUser: options['postgres-user'] ?? 'novel',
    postgresDb: options['postgres-db'] ?? 'novel',
    backupDir: path.resolve(options['backup-dir'] ?? DEFAULT_BACKUP_DIR),
    retentionDays: Number(options['retention-days'] ?? DEFAULT_RETENTION_DAYS),
    objectEndpoint: options['object-endpoint'] ?? process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
    objectAccessKey: process.env.MINIO_ACCESS_KEY ?? 'minio',
    objectSecretKey: process.env.MINIO_SECRET_KEY ?? 'minio123',
    objectBucket,
    objectPrefix: options['object-prefix'] ?? process.env.MINIO_PREFIX ?? '',
  };
}

function dockerCompose(settings, args, input) {
  return runProcess(
    'docker',
    ['compose', '-f', settings.composeFile, 'exec', '-T', settings.postgresService, ...args],
    input,
  );
}

function runProcess(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', reject);
    child.on('close', (code) => {
      const output = Buffer.concat(stdout);
      const errorOutput = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${errorOutput}`));
        return;
      }
      resolve({ output, stderr: errorOutput });
    });
    if (input) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

async function queryCounts(settings, database = settings.postgresDb) {
  const sql = `select json_build_object(
    'users', (select count(*) from users),
    'works', (select count(*) from works),
    'chapters', (select count(*) from chapters),
    'chapterVersions', (select count(*) from chapter_versions),
    'jobs', (select count(*) from jobs)
  )::text`;
  const result = await dockerCompose(settings, [
    'psql',
    '-U',
    settings.postgresUser,
    '-d',
    database,
    '-Atc',
    sql,
  ]);
  return JSON.parse(result.output.toString('utf8').trim());
}

async function queryCountsAtSnapshot(settings, snapshot) {
  if (!/^[0-9A-F-]{18,}$/i.test(snapshot)) {
    throw new Error('Invalid Postgres snapshot identifier');
  }
  const sql = `begin isolation level repeatable read;
    set transaction snapshot '${snapshot}';
    select json_build_object(
      'users', (select count(*) from users),
      'works', (select count(*) from works),
      'chapters', (select count(*) from chapters),
      'chapterVersions', (select count(*) from chapter_versions),
      'jobs', (select count(*) from jobs)
    )::text;
    commit;`;
  const result = await dockerCompose(settings, [
    'psql',
    '-qAt',
    '-U',
    settings.postgresUser,
    '-d',
    settings.postgresDb,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    sql,
  ]);
  const lines = result.output
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const jsonLine = lines.findLast((line) => line.startsWith('{'));
  if (!jsonLine) {
    throw new Error('Could not read row counts from the backup snapshot');
  }
  return JSON.parse(jsonLine);
}

async function exportSnapshot(settings) {
  const child = spawn(
    'docker',
    [
      'compose',
      '-f',
      settings.composeFile,
      'exec',
      '-T',
      settings.postgresService,
      'psql',
      '-qAt',
      '-U',
      settings.postgresUser,
      '-d',
      settings.postgresDb,
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  child.stdin.write('begin isolation level repeatable read;\nselect pg_export_snapshot();\n');

  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Timed out while creating a Postgres backup snapshot'));
    }, 10_000);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      const match = output.match(/([0-9A-F]{8}-[0-9A-F]{8}-[0-9A-F])/i);
      if (!match) {
        return;
      }
      clearTimeout(timeout);
      const snapshot = match[1];
      resolve({
        snapshot,
        async close() {
          await new Promise((closeResolve) => {
            child.once('close', closeResolve);
            child.stdin.end('commit;\n\\q\n');
          });
        },
      });
    });
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Snapshot session exited with code ${code}: ${errorOutput.trim()}`));
      }
    });
  });
}

async function dropDatabase(settings, database) {
  const safeName = safeDatabaseName(database);
  await dockerCompose(settings, [
    'psql',
    '-U',
    settings.postgresUser,
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `drop database if exists ${safeName} with (force)`,
  ]);
}

async function createDatabase(settings, database) {
  const safeName = safeDatabaseName(database);
  await dropDatabase(settings, safeName);
  await dockerCompose(settings, [
    'psql',
    '-U',
    settings.postgresUser,
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `create database ${safeName}`,
  ]);
}

async function pruneBackups(settings, now = new Date()) {
  const postgresRoot = resolveInside(settings.backupDir, 'postgres');
  if (!existsSync(postgresRoot)) {
    return [];
  }

  const removed = [];
  for (const entry of await readdir(postgresRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const directory = resolveInside(postgresRoot, entry.name);
    const manifestPath = path.join(directory, 'manifest.json');
    let createdAt;
    if (existsSync(manifestPath)) {
      createdAt = new Date(JSON.parse(await readFile(manifestPath, 'utf8')).createdAt);
    } else {
      createdAt = (await stat(directory)).mtime;
    }
    if (isBackupExpired(createdAt, now, settings.retentionDays)) {
      await rm(directory, { recursive: true, force: true });
      removed.push(directory);
    }
  }
  return removed;
}

async function createBackup(options) {
  const settings = config(options);
  const createdAt = new Date();
  const directory = backupDirectory(settings.backupDir, createdAt);
  await mkdir(directory, { recursive: true });

  try {
    const snapshotSession = await exportSnapshot(settings);
    let counts;
    let dump;
    try {
      dump = await dockerCompose(settings, [
        'pg_dump',
        '-U',
        settings.postgresUser,
        '-d',
        settings.postgresDb,
        '--format=custom',
        '--no-owner',
        '--no-acl',
        `--snapshot=${snapshotSession.snapshot}`,
      ]);
      counts = await queryCountsAtSnapshot(settings, snapshotSession.snapshot);
    } finally {
      await snapshotSession.close();
    }
    const dumpPath = path.join(directory, 'database.pgcustom');
    await writeFile(dumpPath, dump.output);
    const sha256 = createHash('sha256').update(dump.output).digest('hex');
    const objectStore = await createObjectBackup(settings, directory);
    const manifest = {
      createdAt: createdAt.toISOString(),
      sourceDatabase: settings.postgresDb,
      format: 'pg_dump-custom',
      file: 'database.pgcustom',
      sizeBytes: dump.output.length,
      sha256,
      rowCounts: counts,
      objectStore: {
        directory: objectStore.directory,
        manifestFile: objectStore.manifestFile,
        bucket: objectStore.bucket,
        prefix: objectStore.prefix,
        objectCount: objectStore.objectCount,
        totalBytes: objectStore.totalBytes,
        checksum: objectStore.checksum,
      },
      retentionDays: settings.retentionDays,
      rpoSeconds: RPO_SECONDS,
      rtoSeconds: RTO_SECONDS,
    };
    await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    const removed = await pruneBackups(settings);

    return {
      backupDirectory: directory,
      manifest,
      pruned: removed.map((item) => path.relative(settings.backupDir, item)),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function loadBackup(settings, backupPath) {
  const input = path.resolve(backupPath);
  const directory = (await stat(input)).isDirectory() ? input : path.dirname(input);
  const manifestPath = path.join(directory, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Backup manifest.json was not found');
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.objectStore) {
    throw new Error('Backup does not contain an object storage manifest');
  }
  const dumpPath = path.join(directory, manifest.file ?? 'database.pgcustom');
  if (!existsSync(dumpPath)) {
    throw new Error('Backup database dump was not found');
  }
  const dump = await readFile(dumpPath);
  const sha256 = createHash('sha256').update(dump).digest('hex');
  if (sha256 !== manifest.sha256) {
    throw new Error('Backup checksum does not match the manifest');
  }
  return { directory, manifest, dump };
}

async function restoreDatabase(settings, backup, targetDatabase, dropExisting) {
  const target = safeDatabaseName(targetDatabase);
  if (dropExisting) {
    await dropDatabase(settings, target);
  }
  await dockerCompose(settings, [
    'psql',
    '-U',
    settings.postgresUser,
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `create database ${target}`,
  ]);
  await dockerCompose(
    settings,
    [
      'pg_restore',
      '-U',
      settings.postgresUser,
      '-d',
      target,
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
    ],
    backup.dump,
  );
  return queryCounts(settings, target);
}

async function restoreDrill(options) {
  if (!options.backup) {
    throw new Error('--backup is required for restore-drill');
  }
  const settings = config(options);
  const backup = await loadBackup(settings, options.backup);
  const targetDatabase =
    options['target-db'] ?? `novel_restore_drill_${backupTimestamp().replace(/\D/g, '')}`;
  safeDatabaseName(targetDatabase);
  const targetObjectBucket =
    options['target-object-bucket'] ??
    `novel-brain-restore-drill-${backupTimestamp().replace(/\D/g, '')}`;
  safeBucketName(targetObjectBucket);
  if (targetObjectBucket === backup.manifest.objectStore.bucket) {
    throw new Error('Restore drill requires a scratch object storage bucket');
  }
  if (backup.manifest.objectStore.objectCount === 0) {
    throw new Error('Restore drill requires at least one object in the backup');
  }
  const startedAt = Date.now();
  const backupAgeSeconds = Math.max(
    0,
    Math.round((startedAt - new Date(backup.manifest.createdAt).getTime()) / 1000),
  );

  let restoredCounts;
  let restoredObjects;
  try {
    restoredCounts = await restoreDatabase(settings, backup, targetDatabase, true);
    restoredObjects = await restoreObjectBackup(
      settings,
      backup.directory,
      targetObjectBucket,
      options['verify-key'],
    );
    const mismatches = Object.entries(backup.manifest.rowCounts).filter(
      ([key, value]) => restoredCounts[key] !== value,
    );
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    if (mismatches.length > 0) {
      throw new Error(`Restored row counts did not match: ${JSON.stringify(mismatches)}`);
    }
    if (
      restoredObjects.objectCount !== backup.manifest.objectStore.objectCount ||
      restoredObjects.verifiedObjects !== backup.manifest.objectStore.objectCount ||
      restoredObjects.checksum !== backup.manifest.objectStore.checksum
    ) {
      throw new Error('Restored objects did not match the backup manifest');
    }
    if (backupAgeSeconds > RPO_SECONDS) {
      throw new Error('Backup is older than the 24 hour recovery point objective');
    }
    if (durationSeconds > RTO_SECONDS) {
      throw new Error('Restore exceeded the 4 hour recovery time objective');
    }

    const evidence = {
      drill: 'postgres-and-object-store-restore',
      status: 'passed',
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      backupCreatedAt: backup.manifest.createdAt,
      backupSha256: backup.manifest.sha256,
      targetDatabase,
      durationSeconds,
      backupAgeSeconds,
      rpoSeconds: RPO_SECONDS,
      rtoSeconds: RTO_SECONDS,
      sourceRowCounts: backup.manifest.rowCounts,
      restoredRowCounts: restoredCounts,
      objectStore: {
        sourceBucket: backup.manifest.objectStore.bucket,
        sourcePrefix: backup.manifest.objectStore.prefix,
        targetBucket: restoredObjects.bucket,
        objectCount: backup.manifest.objectStore.objectCount,
        totalBytes: backup.manifest.objectStore.totalBytes,
        checksum: backup.manifest.objectStore.checksum,
        verifiedObjects: restoredObjects.verifiedObjects,
        sample: restoredObjects.sample,
        verifiedKey: restoredObjects.verifiedKey,
      },
    };
    const evidenceDirectory = path.join(ROOT, 'docs', 'acceptance', 'm3', 'restore-drill');
    await mkdir(evidenceDirectory, { recursive: true });
    const evidencePath = path.join(
      evidenceDirectory,
      `${backupTimestamp().replace(/[:.]/g, '')}.json`,
    );
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    return { ...evidence, evidencePath };
  } finally {
    if (!options.keep) {
      await dropDatabase(settings, targetDatabase).catch(() => undefined);
      const objectClient = createObjectClient(settings);
      await removeBucket(objectClient, targetObjectBucket).catch(() => undefined);
    }
  }
}

function printHelp() {
  process.stdout.write(`NovelBrain operations CLI

Usage:
  node scripts/ops.mjs backup [--backup-dir <dir>] [--retention-days 30] [--object-prefix <prefix>]
  node scripts/ops.mjs restore --backup <snapshot> --target-db <scratch-db> [--object-bucket <bucket>] [--drop-existing]
  node scripts/ops.mjs restore-drill --backup <snapshot> [--target-db <scratch-db>] [--target-object-bucket <bucket>] [--verify-key <object-key>] [--keep]

Options:
  --compose-file <path>   Docker Compose file (default: ./docker-compose.yml)
  --postgres-service      Compose service name (default: postgres)
  --postgres-user         Database owner user (default: novel)
  --postgres-db           Source database (default: novel)
  --object-bucket         Object storage bucket (default: MINIO_BUCKET or novel-brain)
  --object-prefix         Object key prefix for backup (default: whole bucket)
  --object-endpoint       S3-compatible endpoint (default: MINIO_ENDPOINT)

Restore targets must start with "novel_restore_drill_" and cannot be "novel".
The CLI never prints or exports model API keys.
`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }
  const options = parseArgs(rest);

  if (command === 'backup') {
    process.stdout.write(`${JSON.stringify(await createBackup(options), null, 2)}\n`);
    return;
  }
  if (command === 'restore') {
    if (!options.backup || !options['target-db']) {
      throw new Error('--backup and --target-db are required for restore');
    }
    const settings = config(options);
    const backup = await loadBackup(settings, options.backup);
    const counts = await restoreDatabase(
      settings,
      backup,
      options['target-db'],
      Boolean(options['drop-existing']),
    );
    const objectBucket = options['object-bucket'] ?? settings.objectBucket;
    safeBucketName(objectBucket);
    const objects = await restoreObjectBackup(
      settings,
      backup.directory,
      objectBucket,
      options['verify-key'],
    );
    process.stdout.write(
      `${JSON.stringify({ restored: options['target-db'], counts, objects }, null, 2)}\n`,
    );
    return;
  }
  if (command === 'restore-drill') {
    process.stdout.write(`${JSON.stringify(await restoreDrill(options), null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
