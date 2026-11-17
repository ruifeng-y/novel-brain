import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { BACKUP_TAG_BYTES, decryptFile, encryptFile, hashFile, sha256 } from "./backup-crypto.mjs";
import {
  assertCompleteBackup,
  buildBackupManifest,
  encryptionMetadata,
  parseBackupKey,
  parseObjectReference,
  planBackupPruning,
  planOrphanCleanup,
  validateBackupManifest,
  verifyRestoredState,
  writeBackupCompletion,
} from "./backup-policy.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const composeFile = path.join(repositoryRoot, "infra/docker/compose.yml");
const objectReferenceConfigPath = path.join(repositoryRoot, "infra/backup/object-references.json");

export function backupDatabaseNameForTarget(env = {}) {
  const databaseName = env.BACKUP_DATABASE_NAME ?? process.env.BACKUP_DATABASE_NAME ?? "novelbrain";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
    throw new Error("BACKUP_DATABASE_NAME_INVALID");
  }
  return databaseName;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stderrBytes = 0;
    let stdoutDone;

    if (options.outputPath) {
      stdoutDone = pipeline(child.stdout, createWriteStream(options.outputPath));
    } else {
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
      stdoutDone = Promise.resolve();
    }
    child.stderr.on("data", (chunk) => {
      if (stderrBytes >= 1_000_000) {
        return;
      }
      const buffer = Buffer.from(chunk);
      stderr.push(buffer);
      stderrBytes += buffer.length;
    });
    if (options.inputPath) {
      pipeline(createReadStream(options.inputPath), child.stdin).catch((error) => {
        child.kill();
        reject(error);
      });
    } else {
      child.stdin.end();
    }

    child.on("error", reject);
    child.on("close", async (code) => {
      try {
        await stdoutDone;
      } catch (error) {
        reject(error);
        return;
      }
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrBuffer = Buffer.concat(stderr);
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed with exit code ${code}:\n${stderrBuffer.toString("utf8").trim()}`,
          ),
        );
        return;
      }
      resolve({
        stdout: stdoutBuffer.toString("utf8"),
        stderr: stderrBuffer.toString("utf8"),
      });
    });
  });
}

function compose(project, args, env = {}, options = {}) {
  return runCommand("docker", ["compose", "-p", project, "-f", composeFile, ...args], {
    env,
    ...options,
  });
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (!port) {
          reject(new Error("Could not reserve a local port."));
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function isolatedComposeEnvironment() {
  return {
    POSTGRES_PORT: String(await reservePort()),
    MINIO_PORT: String(await reservePort()),
    MINIO_CONSOLE_PORT: String(await reservePort()),
  };
}

async function startIsolatedServices(project, env) {
  await compose(project, ["up", "-d", "--wait", "postgres", "minio"], env);
  await compose(project, ["run", "--rm", "--no-deps", "minio-init"], env);
}

async function stopProject(project, env) {
  await compose(project, ["down", "--volumes", "--remove-orphans"], env).catch(() => {});
}

function dockerMountPath(value) {
  return path.resolve(value).replaceAll("\\", "/");
}

async function runMinioShell(project, hostDirectory, script, env = {}) {
  return compose(
    project,
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--volume",
      `${dockerMountPath(hostDirectory)}:/backup`,
      "--entrypoint",
      "/bin/sh",
      "minio-init",
      "-c",
      script,
    ],
    env,
  );
}

function mcAlias(script) {
  return [
    'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"',
    script,
  ].join("; ");
}

async function mirrorBucketToDirectory(project, bucket, backupDirectory, env = {}) {
  await fs.mkdir(path.join(backupDirectory, "objects"), { recursive: true });
  await runMinioShell(
    project,
    backupDirectory,
    mcAlias(`mc mirror --overwrite --preserve "local/${bucket}" /backup/objects`),
    env,
  );
}

async function mirrorDirectoryToBucket(project, bucket, sourceDirectory, env = {}) {
  await runMinioShell(
    project,
    sourceDirectory,
    mcAlias(`mc mirror --overwrite --preserve /backup/objects "local/${bucket}"`),
    env,
  );
}

async function deleteBucketObject(project, bucket, key, minimumAgeDays, env = {}) {
  parseObjectReference(`storage://${bucket}/${key}`, bucket);
  const result = await runMinioShell(
    project,
    os.tmpdir(),
    mcAlias(
      [
        `if ! mc stat "local/${bucket}/${key}" >/dev/null 2>&1; then echo MISSING; exit 0; fi`,
        `mc rm --older-than "${minimumAgeDays}d" "local/${bucket}/${key}"`,
        `if mc stat "local/${bucket}/${key}" >/dev/null 2>&1; then echo REMAINED; else echo DELETED; fi`,
      ].join("; "),
    ),
    env,
  );
  return result.stdout.trim().split(/\r?\n/u).at(-1);
}

async function psql(project, sql, env = {}) {
  const sqlFile = path.join(os.tmpdir(), `novelbrain-query-${randomUUID()}.sql`);
  await fs.writeFile(sqlFile, sql, "utf8");
  try {
    const result = await compose(
      project,
      [
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "novelbrain",
        "-d",
        backupDatabaseNameForTarget(env),
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-f",
        "-",
      ],
      env,
      { inputPath: sqlFile },
    );
    return result.stdout.trim();
  } finally {
    await fs.rm(sqlFile, { force: true });
  }
}

async function psqlJson(project, sql, env = {}) {
  const output = await psql(project, sql, env);
  return output ? JSON.parse(output) : null;
}

async function readTableNames(project, env = {}) {
  const output = await psql(
    project,
    `SELECT format('%I.%I', schemaname, relname)
       FROM pg_stat_user_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY 1`,
    env,
  );
  return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

async function readRowCounts(project, env = {}) {
  const tables = await readTableNames(project, env);
  if (tables.length === 0) {
    return {};
  }
  const query = tables
    .map(
      (table) =>
        `SELECT '${table}'::text AS table_name, count(*)::bigint AS row_count FROM ${table}`,
    )
    .join(" UNION ALL ");
  const rows = await psqlJson(
    project,
    `SELECT COALESCE(jsonb_object_agg(table_name, row_count), '{}'::jsonb)
       FROM (${query}) counts`,
    env,
  );
  return Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, Number(value)]));
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error(`Unsafe SQL identifier: ${value}.`);
  }
  return `"${value}"`;
}

async function loadObjectReferenceConfig() {
  const config = JSON.parse(await fs.readFile(objectReferenceConfigPath, "utf8"));
  if (config?.formatVersion !== 1 || !Array.isArray(config.references)) {
    throw new Error("Object reference configuration is invalid.");
  }
  return config.references;
}

async function readObjectReferences(project, env = {}) {
  const references = await loadObjectReferenceConfig();
  if (references.length === 0) {
    return [];
  }
  const bucket = objectReferenceBucket(env);
  const queries = references.map((reference) => {
    const table = quoteIdentifier(reference.table);
    const column = quoteIdentifier(reference.column);
    const tenantColumn = quoteIdentifier(reference.tenantColumn);
    const objectKeyMode = reference.format === "objectKey";
    const valueExpression = objectKeyMode
      ? `${quoteSqlLiteral(`storage://${bucket}/`)} || ${column}`
      : column;
    const whereExpression = objectKeyMode
      ? `${column} IS NOT NULL AND btrim(${column}) <> '' AND ${column} NOT LIKE '%://%'`
      : `(${column} LIKE 'storage://%' OR ${column} LIKE 's3://%')`;
    return `SELECT jsonb_build_object(
      'table', '${reference.table}',
      'column', '${reference.column}',
      'tenantId', ${tenantColumn}::text,
      'value', ${valueExpression}
    ) AS reference
      FROM ${table}
     WHERE ${whereExpression}`;
  });
  const rows = await psqlJson(
    project,
    `SELECT COALESCE(jsonb_agg(reference), '[]'::jsonb)
       FROM (${queries.join(" UNION ALL ")}) refs`,
    env,
  );
  return [...new Set(rows.map((row) => row.value))].sort();
}

function objectReferenceBucket(env) {
  const bucket = env.STORAGE_BUCKET ?? process.env.STORAGE_BUCKET ?? "novelbrain";
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(bucket)) {
    throw new Error("STORAGE_BUCKET is invalid for object reference resolution.");
  }
  return bucket;
}

function quoteSqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function readForeignKeyDefinitions(project, env = {}) {
  return psqlJson(
    project,
    `SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'name', c.conname,
       'childSchema', child_ns.nspname,
       'childTable', child.relname,
       'parentSchema', parent_ns.nspname,
       'parentTable', parent.relname,
       'childColumns', (
         SELECT jsonb_agg(attribute.attname ORDER BY key_column.ordinality)
           FROM unnest(c.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
           JOIN pg_attribute attribute
             ON attribute.attrelid = c.conrelid
            AND attribute.attnum = key_column.attnum
       ),
       'parentColumns', (
         SELECT jsonb_agg(attribute.attname ORDER BY key_column.ordinality)
           FROM unnest(c.confkey) WITH ORDINALITY AS key_column(attnum, ordinality)
           JOIN pg_attribute attribute
             ON attribute.attrelid = c.confrelid
            AND attribute.attnum = key_column.attnum
       )
     )), '[]'::jsonb)
     FROM pg_constraint c
     JOIN pg_class child ON child.oid = c.conrelid
     JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
     JOIN pg_class parent ON parent.oid = c.confrelid
     JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
    WHERE c.contype = 'f'
      AND child_ns.nspname NOT IN ('pg_catalog', 'information_schema')`,
    env,
  );
}

async function readForeignKeyViolations(project, env = {}) {
  const definitions = await readForeignKeyDefinitions(project, env);
  if (definitions.length === 0) {
    return {};
  }
  const queries = definitions.map((definition) => {
    const childTable = `${quoteIdentifier(definition.childSchema)}.${quoteIdentifier(definition.childTable)}`;
    const parentTable = `${quoteIdentifier(definition.parentSchema)}.${quoteIdentifier(definition.parentTable)}`;
    const join = definition.childColumns
      .map(
        (column, index) =>
          `child.${quoteIdentifier(column)} = parent.${quoteIdentifier(definition.parentColumns[index])}`,
      )
      .join(" AND ");
    const childNotNull = definition.childColumns
      .map((column) => `child.${quoteIdentifier(column)} IS NOT NULL`)
      .join(" AND ");
    const parentMissing = `parent.${quoteIdentifier(definition.parentColumns[0])} IS NULL`;
    return `SELECT '${definition.name.replaceAll("'", "''")}'::text AS constraint_name,
                   count(*)::bigint AS violation_count
              FROM ${childTable} child
              LEFT JOIN ${parentTable} parent ON ${join}
             WHERE ${childNotNull} AND ${parentMissing}`;
  });
  const rows = await psqlJson(
    project,
    `SELECT COALESCE(jsonb_object_agg(constraint_name, violation_count), '{}'::jsonb)
       FROM (${queries.join(" UNION ALL ")}) violations`,
    env,
  );
  return Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, Number(value)]));
}

async function readMigrationMetadata(project, env = {}) {
  return psqlJson(
    project,
    `SELECT COALESCE(jsonb_agg(jsonb_build_object(
       'hash', hash,
       'createdAt', to_char(to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     ) ORDER BY created_at), '[]'::jsonb)
     FROM drizzle.__drizzle_migrations`,
    env,
  );
}

async function hashMigrationFiles() {
  const migrationsDirectory = path.join(repositoryRoot, "packages/db/migrations");
  const names = (await fs.readdir(migrationsDirectory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      path: name,
      sha256: await hashFile(path.join(migrationsDirectory, name)),
    })),
  );
}

async function readObjectDirectory(directory) {
  const entries = [];
  async function walk(current) {
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = path.join(current, child.name);
      if (child.isSymbolicLink()) {
        throw new Error(`Object backup contains a symbolic link: ${childPath}.`);
      }
      if (child.isDirectory()) {
        await walk(childPath);
      } else if (child.isFile()) {
        const stat = await fs.stat(childPath);
        const key = path.relative(directory, childPath).split(path.sep).join("/");
        parseObjectReference(`storage://novelbrain/${key}`, "novelbrain");
        entries.push({
          key,
          plaintextPath: `objects/${key}`,
          encryptedPath: `objects/${key}.enc`,
          size: stat.size,
          sha256: await hashFile(childPath),
          lastModified: stat.mtime.toISOString(),
          sourcePath: childPath,
        });
      }
    }
  }
  await walk(directory);
  return entries;
}

async function fileSizes(directory) {
  let bytes = 0;
  let files = 0;
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const childPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(childPath);
      } else if (entry.isFile()) {
        bytes += (await fs.stat(childPath)).size;
        files += 1;
      }
    }
  }
  await walk(directory);
  return { files, bytes };
}

async function encryptObjectDirectory({ destinationObjectsDirectory, key, backupId, entries }) {
  for (const entry of entries) {
    const encryptedPath = path.join(destinationObjectsDirectory, `${entry.key}.enc`);
    await fs.mkdir(path.dirname(encryptedPath), { recursive: true });
    await encryptFile({
      sourcePath: entry.sourcePath,
      destinationPath: encryptedPath,
      key,
      backupId,
      relativePath: entry.plaintextPath,
    });
    entry.encryptedSha256 = await hashFile(encryptedPath);
    await fs.rm(entry.sourcePath);
  }
}

function withoutSourcePath(entry) {
  return {
    key: entry.key,
    plaintextPath: entry.plaintextPath,
    encryptedPath: entry.encryptedPath,
    size: entry.size,
    sha256: entry.sha256,
    encryptedSha256: entry.encryptedSha256,
    lastModified: entry.lastModified,
  };
}

async function readEnvironmentManifest() {
  const [docker, composeVersion] = await Promise.all([
    runCommand("docker", ["version", "--format", "{{.Server.Version}}"]),
    runCommand("docker", ["compose", "version", "--short"]),
  ]);
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    docker: docker.stdout.trim(),
    compose: composeVersion.stdout.trim(),
  };
}

async function currentCommit() {
  return (await runCommand("git", ["rev-parse", "HEAD"])).stdout.trim();
}

function createBackupId(now, sourceCommit) {
  return `${now.toISOString().replaceAll(/[-:.]/gu, "").replace("Z", "Z")}-${sourceCommit.slice(0, 12)}-${randomUUID().slice(0, 8)}`;
}

async function pauseWriters(project, env) {
  const result = await compose(project, ["ps", "--services", "--status", "running"], env);
  const running = new Set(result.stdout.split(/\r?\n/u).filter(Boolean));
  const writers = ["api", "worker"].filter((service) => running.has(service));
  if (writers.length > 0) {
    await compose(project, ["stop", ...writers], env);
  }
  return writers;
}

async function resumeWriters(project, writers, env) {
  if (writers.length > 0) {
    await compose(project, ["start", ...writers], env);
  }
}

export async function createBackup({
  project,
  outputDirectory,
  bucket = "novelbrain",
  key,
  now = new Date(),
  env = {},
  quiesceWriters = true,
  injectFailureAt = null,
}) {
  if (!project || !outputDirectory || !Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error("Backup requires a project, output directory and 32-byte key.");
  }
  await fs.mkdir(outputDirectory, { recursive: true });
  const sourceCommit = await currentCommit();
  const backupId = createBackupId(now, sourceCommit);
  const incompleteDirectory = path.join(outputDirectory, `.${backupId}.incomplete`);
  const finalDirectory = path.join(outputDirectory, backupId);
  const plaintextStaging = await fs.mkdtemp(path.join(os.tmpdir(), "novelbrain-backup-staging-"));
  const rawDatabasePath = path.join(plaintextStaging, "database.dump");
  const rawObjectsDirectory = path.join(plaintextStaging, "objects");
  const encryptedObjectsDirectory = path.join(incompleteDirectory, "objects");
  let pausedWriters = [];
  await fs.mkdir(incompleteDirectory, { recursive: true });
  await fs.mkdir(rawObjectsDirectory, { recursive: true });
  await fs.writeFile(
    path.join(incompleteDirectory, "state.json"),
    `${JSON.stringify({ status: "backup_in_progress", backupId, startedAt: now.toISOString() }, null, 2)}\n`,
  );

  let backupResult;
  let backupError;
  const snapshotStartedAt = new Date().toISOString();
  try {
    if (quiesceWriters) {
      pausedWriters = await pauseWriters(project, env);
    }
    const [rowCounts, migrationMetadata, objectReferences, migrationFiles, environment] =
      await Promise.all([
        readRowCounts(project, env),
        readMigrationMetadata(project, env),
        readObjectReferences(project, env),
        hashMigrationFiles(),
        readEnvironmentManifest(),
      ]);
    await compose(
      project,
      [
        "exec",
        "-T",
        "postgres",
        "pg_dump",
        "-U",
        "novelbrain",
        "-d",
        backupDatabaseNameForTarget(env),
        "--format=custom",
        "--no-owner",
        "--no-acl",
      ],
      env,
      { outputPath: rawDatabasePath },
    );
    const databasePlaintextBytes = (await fs.stat(rawDatabasePath)).size;
    const databasePlaintextSha256 = await hashFile(rawDatabasePath);
    await mirrorBucketToDirectory(project, bucket, plaintextStaging, env);
    const objectEntries = await readObjectDirectory(rawObjectsDirectory);
    if (injectFailureAt === "before_encryption") {
      throw new Error("Injected backup interruption before encryption.");
    }
    await encryptObjectDirectory({
      destinationObjectsDirectory: encryptedObjectsDirectory,
      key,
      backupId,
      entries: objectEntries,
    });
    const snapshotCompletedAt = new Date().toISOString();
    const encryptedDatabasePath = path.join(incompleteDirectory, "database.dump.enc");
    await encryptFile({
      sourcePath: rawDatabasePath,
      destinationPath: encryptedDatabasePath,
      key,
      backupId,
      relativePath: "database.dump",
    });
    const databaseEncryptedBytes = (await fs.stat(encryptedDatabasePath)).size;
    const databaseEncryptedSha256 = await hashFile(encryptedDatabasePath);

    const manifest = buildBackupManifest({
      backupId,
      createdAt: now.toISOString(),
      snapshotStartedAt,
      snapshotCompletedAt,
      sourceCommit,
      encryption: encryptionMetadata(key),
      database: {
        format: "postgres-custom",
        plaintextPath: "database.dump",
        encryptedPath: "database.dump.enc",
        plaintextBytes: databasePlaintextBytes,
        encryptedBytes: databaseEncryptedBytes,
        plaintextSha256: databasePlaintextSha256,
        encryptedSha256: databaseEncryptedSha256,
        rowCounts,
        migrations: migrationMetadata,
        writerServicesPaused: pausedWriters,
      },
      objects: {
        bucket,
        count: objectEntries.length,
        totalBytes: objectEntries.reduce((total, entry) => total + entry.size, 0),
        entries: objectEntries.map(withoutSourcePath),
      },
      objectReferences,
      migrationFiles,
      environment,
    });
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    await fs.writeFile(path.join(incompleteDirectory, "manifest.json"), manifestText, "utf8");
    await writeBackupCompletion(incompleteDirectory, sha256(manifestText));
    await fs.rm(path.join(incompleteDirectory, "state.json"));
    await fs.rename(incompleteDirectory, finalDirectory);
    backupResult = {
      directory: finalDirectory,
      manifest,
      manifestSha256: sha256(manifestText),
      dataset: await fileSizes(finalDirectory),
    };
  } catch (error) {
    backupError = error;
  } finally {
    let resumeError;
    try {
      await resumeWriters(project, pausedWriters, env);
    } catch (error) {
      resumeError = error;
    }
    await fs.rm(plaintextStaging, { recursive: true, force: true });
    if (await fs.stat(incompleteDirectory).catch(() => null)) {
      await fs.writeFile(
        path.join(incompleteDirectory, "state.json"),
        `${JSON.stringify({ status: "backup_incomplete", backupId, failedAt: new Date().toISOString() }, null, 2)}\n`,
      );
    }
    if (resumeError) {
      const failureDirectory = (await fs.stat(finalDirectory).catch(() => null))
        ? finalDirectory
        : incompleteDirectory;
      await fs.writeFile(
        path.join(failureDirectory, "writer-restart-failed.json"),
        `${JSON.stringify(
          {
            status: "writer_restart_failed",
            backupId,
            failedAt: new Date().toISOString(),
            services: pausedWriters,
            error: resumeError instanceof Error ? resumeError.message : String(resumeError),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const restartError = new Error(
        `Backup could not restart writer services: ${pausedWriters.join(", ")}. Start them manually before serving traffic.`,
      );
      backupError = backupError
        ? new AggregateError(
            [backupError, restartError],
            "Backup and writer service restart both failed.",
          )
        : restartError;
    }
  }
  if (backupError) {
    throw backupError;
  }
  return backupResult;
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Backup path escapes its directory: ${relativePath}.`);
  }
  return resolvedPath;
}

export async function loadBackup(directory) {
  const manifestSha256 = await assertCompleteBackup(directory);
  const manifestText = await fs.readFile(path.join(directory, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);
  validateBackupManifest(manifest);
  return { directory, manifest, manifestSha256 };
}

async function decryptBackupArtefacts({ directory, manifest, key, targetDirectory }) {
  const metadata = encryptionMetadata(key);
  if (metadata.keyFingerprint !== manifest.encryption.keyFingerprint) {
    throw new Error("Backup encryption key fingerprint does not match the manifest.");
  }
  const databasePath = resolveInside(targetDirectory, "database.dump");
  const encryptedDatabasePath = resolveInside(directory, manifest.database.encryptedPath);
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  await decryptFile({
    sourcePath: encryptedDatabasePath,
    destinationPath: databasePath,
    key,
    backupId: manifest.backupId,
    relativePath: manifest.database.plaintextPath,
  });
  if ((await hashFile(databasePath)) !== manifest.database.plaintextSha256) {
    throw new Error("Decrypted database checksum does not match the backup manifest.");
  }

  const objectsDirectory = path.join(targetDirectory, "objects");
  const restoredObjects = [];
  for (const entry of manifest.objects.entries) {
    const destinationPath = resolveInside(objectsDirectory, entry.key);
    const encryptedPath = resolveInside(directory, entry.encryptedPath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await decryptFile({
      sourcePath: encryptedPath,
      destinationPath,
      key,
      backupId: manifest.backupId,
      relativePath: entry.plaintextPath,
    });
    const stat = await fs.stat(destinationPath);
    const digest = await hashFile(destinationPath);
    if (stat.size !== entry.size || digest !== entry.sha256) {
      throw new Error(`Decrypted object checksum mismatch: ${entry.key}.`);
    }
    restoredObjects.push({
      key: entry.key,
      size: stat.size,
      sha256: digest,
    });
  }
  return { databasePath, objectsDirectory, restoredObjects };
}

export async function verifyBackupArtefacts({ directory, key }) {
  const { manifest } = await loadBackup(directory);
  const encryptedDatabasePath = resolveInside(directory, manifest.database.encryptedPath);
  if (
    (await fs.stat(encryptedDatabasePath)).size !== manifest.database.encryptedBytes ||
    (await hashFile(encryptedDatabasePath)) !== manifest.database.encryptedSha256
  ) {
    throw new Error("Encrypted database artefact checksum mismatch.");
  }
  for (const entry of manifest.objects.entries) {
    const encryptedPath = resolveInside(directory, entry.encryptedPath);
    const stat = await fs.stat(encryptedPath).catch(() => null);
    if (!stat) {
      throw new Error(`Encrypted object artefact is missing: ${entry.key}.`);
    }
    if ((await hashFile(encryptedPath)) !== entry.encryptedSha256) {
      throw new Error(`Encrypted object checksum mismatch: ${entry.key}.`);
    }
  }
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "novelbrain-verify-"));
  try {
    const decrypted = await decryptBackupArtefacts({
      directory,
      manifest,
      key,
      targetDirectory: temporaryDirectory,
    });
    return {
      ok: true,
      backupId: manifest.backupId,
      databaseBytes: manifest.database.plaintextBytes,
      objectCount: decrypted.restoredObjects.length,
      objectBytes: manifest.objects.totalBytes,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function projectIsEmpty(project, env = {}) {
  const result = await compose(project, ["ps", "--all", "--format", "json"], env);
  const output = result.stdout.trim();
  if (!output) {
    return true;
  }
  try {
    const projects = JSON.parse(output);
    return Array.isArray(projects) && projects.length === 0;
  } catch {
    return false;
  }
}

export async function restoreBackup({
  backupDirectory,
  key,
  project = `novelbrain-restore-${randomUUID().slice(0, 8)}`,
  env,
  injectFailureAt = null,
}) {
  const startedAt = new Date().toISOString();
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "novelbrain-restore-"));
  let phase = "loading";
  let managedEnv = env;
  try {
    const backup = await loadBackup(backupDirectory);
    phase = "preparing";
    managedEnv = managedEnv ?? (await isolatedComposeEnvironment());
    if (!(await projectIsEmpty(project, managedEnv))) {
      throw new Error(`Restore project ${project} is not empty; refusing to overwrite it.`);
    }
    phase = "starting";
    await startIsolatedServices(project, managedEnv);
    if (injectFailureAt === "after_start") {
      throw new Error("Injected restore interruption after service startup.");
    }
    phase = "decrypting";
    const decrypted = await decryptBackupArtefacts({
      directory: backupDirectory,
      manifest: backup.manifest,
      key,
      targetDirectory: workDirectory,
    });
    if (injectFailureAt === "after_decrypt") {
      throw new Error("Injected restore interruption after decryption.");
    }
    phase = "restoring_database";
    await compose(
      project,
      [
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "-U",
        "novelbrain",
        "-d",
        "novelbrain",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
      ],
      managedEnv,
      { inputPath: decrypted.databasePath },
    );
    if (injectFailureAt === "after_database_restore") {
      throw new Error("Injected restore interruption after database restore.");
    }
    phase = "restoring_objects";
    await mirrorDirectoryToBucket(
      project,
      backup.manifest.objects.bucket,
      workDirectory,
      managedEnv,
    );
    if (injectFailureAt === "after_object_restore") {
      throw new Error("Injected restore interruption after object restore.");
    }
    phase = "verifying";
    const verificationDirectory = path.join(workDirectory, "verification");
    await fs.mkdir(verificationDirectory, { recursive: true });
    await mirrorBucketToDirectory(
      project,
      backup.manifest.objects.bucket,
      verificationDirectory,
      managedEnv,
    );
    const restoredObjectEntries = await readObjectDirectory(
      path.join(verificationDirectory, "objects"),
    );
    const [rowCounts, foreignKeyViolations, objectReferences] = await Promise.all([
      readRowCounts(project, managedEnv),
      readForeignKeyViolations(project, managedEnv),
      readObjectReferences(project, managedEnv),
    ]);
    const verification = verifyRestoredState({
      manifest: backup.manifest,
      restored: {
        rowCounts,
        foreignKeyViolations,
        objects: restoredObjectEntries.map((entry) => ({
          key: entry.key,
          size: entry.size,
          sha256: entry.sha256,
        })),
        objectReferences,
      },
    });
    const completedAt = new Date().toISOString();
    return {
      ok: true,
      project,
      backupId: backup.manifest.backupId,
      startedAt,
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(startedAt),
      verification,
      rowCounts,
      foreignKeyViolations,
      objectReferences,
    };
  } catch (error) {
    error.restorePhase = phase;
    throw error;
  } finally {
    await stopProject(project, managedEnv);
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}

async function seedDrillSource(project, env, bucket) {
  const migrateScript = path.join(repositoryRoot, "packages/db/dist/migrate.js");
  await fs.access(migrateScript).catch(() => {
    throw new Error("Backup drill requires pnpm build:packages before running.");
  });
  await runCommand("node", [migrateScript], {
    env: {
      DATABASE_URL: `postgresql://novelbrain:novelbrain@127.0.0.1:${env.POSTGRES_PORT}/novelbrain`,
    },
  });
  const userId = randomUUID();
  const avatarKey = `users/${userId}/avatar.txt`;
  const orphanKey = `users/${userId}/trash/stale.tmp`;
  const avatarReference = `storage://${bucket}/${avatarKey}`;
  const seedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "novelbrain-seed-"));
  try {
    const avatarPath = path.join(seedDirectory, "avatar.txt");
    const orphanPath = path.join(seedDirectory, "stale.tmp");
    await fs.writeFile(avatarPath, "backup drill avatar\n", "utf8");
    await fs.writeFile(orphanPath, "stale unreferenced object\n", "utf8");
    const staleAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await fs.utimes(orphanPath, staleAt, staleAt);
    const escapedId = userId.replaceAll("'", "''");
    const escapedReference = avatarReference.replaceAll("'", "''");
    await psql(
      project,
      `INSERT INTO users (id, email, password_hash, display_name, avatar_url)
       VALUES ('${escapedId}', 'backup-drill-${escapedId}@example.test',
               'drill-not-a-real-password-hash', 'Backup Drill', '${escapedReference}')`,
      env,
    );
    await runMinioShell(
      project,
      seedDirectory,
      mcAlias(
        [
          `mc cp --preserve /backup/avatar.txt "local/${bucket}/${avatarKey}"`,
          `mc cp --preserve /backup/stale.tmp "local/${bucket}/${orphanKey}"`,
        ].join("; "),
      ),
      env,
    );
    return {
      userId,
      avatarReference,
      objectKeys: [avatarKey, orphanKey],
      lastSourceWriteAt: new Date().toISOString(),
    };
  } finally {
    await fs.rm(seedDirectory, { recursive: true, force: true });
  }
}

async function copyDirectory(source, destination) {
  await fs.cp(source, destination, { recursive: true, force: true });
}

async function flipFileByte(filePath) {
  const file = await fs.open(filePath, "r+");
  try {
    const byte = Buffer.alloc(1);
    await file.read(byte, 0, 1, Math.max(0, (await file.stat()).size - BACKUP_TAG_BYTES - 1));
    byte[0] ^= 0xff;
    await file.write(byte, 0, 1, Math.max(0, (await file.stat()).size - BACKUP_TAG_BYTES - 1));
  } finally {
    await file.close();
  }
}

async function backupContainsPlaintext(directory) {
  const allowed = new Set(["state.json", "manifest.json", "completion.json"]);
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const childPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (await walk(childPath)) {
          return true;
        }
      } else if (!allowed.has(entry.name) && !entry.name.endsWith(".enc")) {
        return true;
      }
    }
    return false;
  }
  return walk(directory);
}

async function runFaultScenarios({ backupDirectory, key, project, sourceProject, sourceEnv }) {
  const { manifest } = await loadBackup(backupDirectory);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "novelbrain-backup-faults-"));
  const results = [];
  try {
    const interruptedOutput = path.join(tempRoot, "interrupted-output");
    const interrupted = await captureFault(
      "interrupted_backup",
      () =>
        createBackup({
          project: sourceProject,
          outputDirectory: interruptedOutput,
          bucket: manifest.objects.bucket,
          key,
          env: sourceEnv,
          injectFailureAt: "before_encryption",
        }),
      /injected backup interruption/i,
    );
    const incompleteDirectories = (await fs.readdir(interruptedOutput)).filter((name) =>
      name.endsWith(".incomplete"),
    );
    const storedPlaintext =
      incompleteDirectories.length === 0 ||
      (await backupContainsPlaintext(path.join(interruptedOutput, incompleteDirectories[0])));
    results.push({
      ...interrupted,
      plaintextAbsent: !storedPlaintext,
      passed: interrupted.passed && !storedPlaintext,
      message: storedPlaintext
        ? `${interrupted.message} Plaintext artefacts were retained.`
        : `${interrupted.message} No plaintext artefacts were retained.`,
    });

    const missing = path.join(tempRoot, "missing");
    await copyDirectory(backupDirectory, missing);
    const firstObject = manifest.objects.entries[0];
    if (firstObject) {
      await fs.rm(resolveInside(missing, firstObject.encryptedPath));
      results.push(
        await captureFault(
          "missing_object",
          () => verifyBackupArtefacts({ directory: missing, key }),
          /missing/i,
        ),
      );
    }

    const corrupted = path.join(tempRoot, "corrupted");
    await copyDirectory(backupDirectory, corrupted);
    if (firstObject) {
      await flipFileByte(resolveInside(corrupted, firstObject.encryptedPath));
      results.push(
        await captureFault(
          "corrupt_object",
          () => verifyBackupArtefacts({ directory: corrupted, key }),
          /checksum mismatch/i,
        ),
      );
    }

    results.push(
      await captureFault(
        "interrupted_restore",
        () =>
          restoreBackup({
            backupDirectory,
            key,
            project: `${project}-fault`,
            injectFailureAt: "after_decrypt",
          }),
        /injected restore interruption/i,
      ),
    );
    const faultProjectEmpty = await projectIsEmpty(`${project}-fault`);
    results.push({
      scenario: "interrupted_restore_cleanup",
      expectedFailure: false,
      passed: faultProjectEmpty,
      message: faultProjectEmpty
        ? "Interrupted restore project was removed."
        : "Interrupted restore project still exists.",
    });
    return results;
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function captureFault(scenario, operation, expectedPattern) {
  try {
    await operation();
    return {
      scenario,
      expectedFailure: true,
      passed: false,
      message: "Operation unexpectedly succeeded.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      scenario,
      expectedFailure: true,
      passed: expectedPattern.test(message),
      message,
    };
  }
}

export async function runBackupDrill({ outputDirectory, key, bucket = "novelbrain" }) {
  const drillStartedAt = new Date().toISOString();
  const sourceProject = `novelbrain-source-${randomUUID().slice(0, 8)}`;
  const sourceEnv = await isolatedComposeEnvironment();
  let backup;
  let seed;
  try {
    await startIsolatedServices(sourceProject, sourceEnv);
    seed = await seedDrillSource(sourceProject, sourceEnv, bucket);
    backup = await createBackup({
      project: sourceProject,
      outputDirectory,
      bucket,
      key,
      env: sourceEnv,
    });
    const verification = await verifyBackupArtefacts({ directory: backup.directory, key });
    const restore = await restoreBackup({
      backupDirectory: backup.directory,
      key,
    });
    const faults = await runFaultScenarios({
      backupDirectory: backup.directory,
      key,
      project: `novelbrain-drill-${randomUUID().slice(0, 8)}`,
      sourceProject,
      sourceEnv,
    });
    const orphanDryRun = await runOrphanAudit({
      backupDirectory: backup.directory,
      project: sourceProject,
      minimumAgeDays: 30,
      env: sourceEnv,
    });
    const orphanApply = await runOrphanAudit({
      backupDirectory: backup.directory,
      project: sourceProject,
      minimumAgeDays: 30,
      apply: true,
      confirmBucket: bucket,
      env: sourceEnv,
    });
    const completedAt = new Date().toISOString();
    const rpoSeconds =
      (Date.parse(backup.manifest.snapshotStartedAt) - Date.parse(seed.lastSourceWriteAt)) / 1_000;
    const evidence = {
      formatVersion: 1,
      ticket: 136,
      status: "passed",
      drillStartedAt,
      completedAt,
      sourceCommit: backup.manifest.sourceCommit,
      backupId: backup.manifest.backupId,
      backupPath: path.relative(repositoryRoot, backup.directory).replaceAll("\\", "/"),
      snapshotStartedAt: backup.manifest.snapshotStartedAt,
      snapshotCompletedAt: backup.manifest.snapshotCompletedAt,
      lastSourceWriteAt: seed.lastSourceWriteAt,
      dataset: {
        backupFiles: backup.dataset.files,
        backupBytes: backup.dataset.bytes,
        databasePlaintextBytes: backup.manifest.database.plaintextBytes,
        objectCount: backup.manifest.objects.count,
        objectBytes: backup.manifest.objects.totalBytes,
        rowCount: restore.verification.rowCount,
      },
      recoveryObjectives: {
        targets: backup.manifest.targets,
        measuredRpoSeconds: Math.max(0, rpoSeconds),
        measuredRtoSeconds: restore.durationMs / 1_000,
        rpoWithinTarget: rpoSeconds <= 24 * 60 * 60,
        rtoWithinTarget: restore.durationMs <= 4 * 60 * 60 * 1_000,
        note: "Single deterministic drill; this does not certify a production SLA.",
      },
      verification: {
        offline: verification,
        restore: restore.verification,
        foreignKeys: {
          constraintCount: Object.keys(restore.foreignKeyViolations).length,
          violations: Object.fromEntries(
            Object.entries(restore.foreignKeyViolations).filter(([, count]) => count > 0),
          ),
        },
      },
      faultInjection: faults,
      orphanCleanup: {
        dryRunCandidates: orphanDryRun.candidates,
        deleted: orphanApply.deleted,
        auditIds: [orphanDryRun.auditId, orphanApply.auditId],
        auditPaths: [orphanDryRun.auditPath, orphanApply.auditPath].map((auditPath) =>
          path.relative(repositoryRoot, auditPath).replaceAll("\\", "/"),
        ),
      },
      environment: backup.manifest.environment,
    };
    return evidence;
  } finally {
    await stopProject(sourceProject, sourceEnv);
  }
}

export async function runOrphanAudit({
  backupDirectory,
  project,
  minimumAgeDays = 30,
  apply = false,
  confirmBucket = null,
  env = {},
  now = new Date(),
  auditDirectory = path.join(repositoryRoot, "artifacts/backups/audits"),
}) {
  const { manifest } = await loadBackup(backupDirectory);
  if (apply && confirmBucket !== manifest.objects.bucket) {
    throw new Error(`Orphan cleanup requires --confirm-bucket ${manifest.objects.bucket}.`);
  }
  const inventoryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "novelbrain-orphan-audit-"));
  try {
    await mirrorBucketToDirectory(project, manifest.objects.bucket, inventoryDirectory, env);
    const [objects, references] = await Promise.all([
      readObjectDirectory(path.join(inventoryDirectory, "objects")),
      readObjectReferences(project, env),
    ]);
    const plan = planOrphanCleanup({
      objects,
      references,
      bucket: manifest.objects.bucket,
      now,
      minimumAgeMs: minimumAgeDays * 24 * 60 * 60 * 1_000,
    });
    const audit = {
      formatVersion: 1,
      auditId: randomUUID(),
      createdAt: now.toISOString(),
      backupId: manifest.backupId,
      bucket: manifest.objects.bucket,
      dryRun: !apply,
      minimumAgeDays,
      currentObjectCount: objects.length,
      currentReferenceCount: references.length,
      candidates: plan.candidates,
      deleted: [],
      skipped: [],
    };
    const auditPath = path.join(
      auditDirectory,
      `${now.toISOString().replaceAll(/[-:.]/gu, "")}-${audit.auditId}.json`,
    );
    const writeAudit = async () => {
      await fs.mkdir(auditDirectory, { recursive: true });
      await fs.writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
    };
    if (apply) {
      audit.status = "applying";
      await writeAudit();
      for (const candidate of plan.candidates) {
        const latestReferences = await readObjectReferences(project, env);
        const latestKeys = new Set(
          latestReferences.map(
            (reference) => parseObjectReference(reference, manifest.objects.bucket).key,
          ),
        );
        if (latestKeys.has(candidate.key)) {
          audit.skipped.push({
            ...candidate,
            reason: "became_referenced_before_delete",
          });
          await writeAudit();
          continue;
        }
        const deletion = await deleteBucketObject(
          project,
          manifest.objects.bucket,
          candidate.key,
          minimumAgeDays,
          env,
        );
        if (deletion === "DELETED") {
          audit.deleted.push(candidate);
        } else {
          audit.skipped.push({
            ...candidate,
            reason:
              deletion === "MISSING"
                ? "object_missing_before_delete"
                : "object_changed_before_delete",
          });
        }
        await writeAudit();
      }
      audit.status = "completed";
    } else {
      audit.status = "dry_run";
    }
    await writeAudit();
    return { ...audit, auditPath };
  } finally {
    await fs.rm(inventoryDirectory, { recursive: true, force: true });
  }
}

export async function pruneBackups({ directory, now = new Date(), apply = false }) {
  const children = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const backups = [];
  for (const child of children) {
    if (!child.isDirectory()) {
      continue;
    }
    const backupPath = path.join(directory, child.name);
    const stat = await fs.stat(backupPath);
    try {
      const { manifest } = await loadBackup(backupPath);
      backups.push({
        path: backupPath,
        complete: true,
        expiresAt: manifest.retention.expiresAt,
      });
    } catch {
      backups.push({
        path: backupPath,
        complete: false,
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }
  const plan = planBackupPruning(backups, now);
  for (const item of plan) {
    if (apply) {
      await fs.rm(item.path, { recursive: true, force: true });
    }
  }
  return {
    dryRun: !apply,
    candidates: plan.map((item) => ({
      path: path.relative(directory, item.path).replaceAll("\\", "/"),
      reason: item.reason,
    })),
  };
}

export async function readBackupKey({
  keyFile,
  environmentVariable = "BACKUP_ENCRYPTION_KEY_BASE64",
}) {
  const value = keyFile
    ? (await fs.readFile(keyFile, "utf8")).trim()
    : process.env[environmentVariable];
  return parseBackupKey(value ?? "");
}
