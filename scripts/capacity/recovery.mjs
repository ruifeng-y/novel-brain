import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Pool } from "pg";

import {
  createBackup,
  readBackupKey,
  restoreBackup,
  verifyBackupArtefacts,
} from "../backup/backup-runtime.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument ?? ""}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    options[argument.slice(2)] = value;
    index += 1;
  }
  return options;
}

function required(options, name) {
  const value = options[name];
  if (!value) {
    throw new Error(`Missing required --${name}`);
  }
  return value;
}

function resolved(value) {
  return path.resolve(repositoryRoot, value);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const project = required(options, "project");
  const databaseName = required(options, "database-name");
  const databaseUrl = required(options, "database-url");
  const outputDirectory = resolved(options.output ?? "artifacts/capacity/backups");
  const evidencePath = resolved(required(options, "evidence"));
  if (!databaseName.endsWith("_benchmark")) {
    throw new Error("Benchmark recovery requires a *_benchmark database name.");
  }

  const key = await readBackupKey({
    ...(options["key-file"] ? { keyFile: resolved(options["key-file"]) } : {}),
  });
  const lastSourceWriteAt = await latestWriteTimestamp(databaseUrl);
  const backup = await createBackup({
    project,
    outputDirectory,
    bucket: options.bucket ?? "novelbrain",
    key,
    env: {
      BACKUP_DATABASE_NAME: databaseName,
      STORAGE_BUCKET: options.bucket ?? "novelbrain",
    },
  });
  const offlineVerification = await verifyBackupArtefacts({
    directory: backup.directory,
    key,
  });
  const restore = await restoreBackup({
    backupDirectory: backup.directory,
    key,
  });

  const measuredRpoHours = Math.max(
    0,
    (Date.parse(backup.manifest.snapshotStartedAt) - Date.parse(lastSourceWriteAt)) / 3_600_000,
  );
  const measuredRtoHours = restore.durationMs / 3_600_000;
  const databaseIntegrity =
    restore.ok && restore.verification.ok && restore.verification.foreignKeyConstraints === 0;
  const objectIntegrity =
    restore.verification.objectCount === backup.manifest.objects.count &&
    restore.verification.objectBytes === backup.manifest.objects.totalBytes;
  const evidence = {
    status: offlineVerification.ok && databaseIntegrity && objectIntegrity ? "passed" : "failed",
    measuredRpoHours,
    measuredRtoHours,
    databaseIntegrity,
    objectIntegrity,
    evidencePath: path.relative(repositoryRoot, evidencePath).replaceAll("\\", "/"),
    sourceCommit: backup.manifest.sourceCommit,
    backupId: backup.manifest.backupId,
    backupPath: path.relative(repositoryRoot, backup.directory).replaceAll("\\", "/"),
    backupManifestSha256: backup.manifestSha256,
    snapshotStartedAt: backup.manifest.snapshotStartedAt,
    snapshotCompletedAt: backup.manifest.snapshotCompletedAt,
    lastSourceWriteAt,
    dataset: {
      rowCount: restore.verification.rowCount,
      foreignKeyConstraints: restore.verification.foreignKeyConstraints,
      objectCount: restore.verification.objectCount,
      objectBytes: restore.verification.objectBytes,
      databaseEncryptedBytes: backup.manifest.database.encryptedBytes,
      backupFiles: backup.dataset.files,
      backupBytes: backup.dataset.bytes,
    },
    offlineVerification,
    restore: {
      ok: restore.ok,
      durationMs: restore.durationMs,
      verification: restore.verification,
    },
  };
  await mkdir(path.dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

async function latestWriteTimestamp(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      "SELECT COALESCE(max(created_at), now())::text AS last_write FROM audit_logs",
    );
    return result.rows[0]?.last_write ?? new Date().toISOString();
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
