import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./backup-crypto.mjs";

export {
  decryptBackupBuffer,
  encryptBackupBuffer,
  encryptionMetadata,
  parseBackupKey,
} from "./backup-crypto.mjs";

function decodeObjectKey(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.replace(/^\/+/u, ""));
  } catch {
    throw new Error("Object key must use valid URI encoding.");
  }

  if (!decoded || decoded.includes("\\") || decoded.split("/").some((part) => part === "..")) {
    throw new Error("Object key must be a non-empty, normalized relative path.");
  }

  return decoded;
}

export function parseObjectReference(value, expectedBucket) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Object reference must be a non-empty string.");
  }

  const match = /^(storage|s3):\/\/([^/]+)\/(.+)$/u.exec(value);
  if (!match) {
    throw new Error("Object reference must be an absolute storage or s3 URI.");
  }

  const [, protocol, bucket, rawKey] = match;
  if (bucket !== expectedBucket) {
    throw new Error(`Object reference bucket must be ${expectedBucket}.`);
  }

  const key = decodeObjectKey(rawKey);
  return {
    bucket,
    key,
    uri: `${protocol}://${bucket}/${key}`,
  };
}

export function planOrphanCleanup({ objects, references, bucket, now, minimumAgeMs }) {
  const referencedKeys = new Set(
    references.map((reference) => parseObjectReference(reference, bucket).key),
  );
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(minimumAgeMs) || minimumAgeMs < 0) {
    throw new Error("Orphan cleanup requires a valid time and non-negative minimum age.");
  }

  const candidates = objects
    .filter((object) => !referencedKeys.has(object.key))
    .filter((object) => {
      const lastModifiedMs = new Date(object.lastModified).getTime();
      return Number.isFinite(lastModifiedMs) && nowMs - lastModifiedMs >= minimumAgeMs;
    })
    .map((object) => ({
      key: object.key,
      reason: "unreferenced_and_aged",
      size: object.size,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  return {
    dryRun: true,
    candidates,
  };
}

const RETENTION_DAYS = 30;
const TARGETS = Object.freeze({ rpoHours: 24, rtoHours: 4 });

function assertIsoDate(value, field) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO timestamp.`);
  }
}

function assertSha256(value, field) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest.`);
  }
}

export function buildBackupManifest(input) {
  assertIsoDate(input.createdAt, "createdAt");
  assertIsoDate(input.snapshotStartedAt, "snapshotStartedAt");
  assertIsoDate(input.snapshotCompletedAt, "snapshotCompletedAt");
  const expiresAt = new Date(
    Date.parse(input.createdAt) + RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const parsedReferences = input.objectReferences.map((reference) =>
    parseObjectReference(reference, input.objects.bucket),
  );
  const objectKeys = new Set(input.objects.entries.map((entry) => entry.key));
  const missingReference = parsedReferences.find((reference) => !objectKeys.has(reference.key));
  if (missingReference) {
    throw new Error(
      `Database object reference is missing from the backup: ${missingReference.uri}.`,
    );
  }
  const objectReferences = parsedReferences.map((reference) => reference.uri);
  const manifest = {
    formatVersion: 1,
    inventoryVersion: "m3-backup/1",
    backupId: input.backupId,
    createdAt: input.createdAt,
    snapshotStartedAt: input.snapshotStartedAt,
    snapshotCompletedAt: input.snapshotCompletedAt,
    sourceCommit: input.sourceCommit,
    targets: TARGETS,
    retention: {
      days: RETENTION_DAYS,
      expiresAt,
    },
    encryption: input.encryption,
    database: input.database,
    objects: input.objects,
    objectReferences,
    migrationFiles: input.migrationFiles,
    environment: input.environment,
  };
  validateBackupManifest(manifest);
  return manifest;
}

export function validateBackupManifest(manifest) {
  if (manifest?.formatVersion !== 1 || manifest.inventoryVersion !== "m3-backup/1") {
    throw new Error("Unsupported backup manifest format.");
  }
  if (typeof manifest.backupId !== "string" || !/^[A-Za-z0-9T-]{20,80}$/u.test(manifest.backupId)) {
    throw new Error("Backup manifest backupId is invalid.");
  }
  for (const field of ["createdAt", "snapshotStartedAt", "snapshotCompletedAt"]) {
    assertIsoDate(manifest[field], field);
  }
  if (!/^[a-f0-9]{40}$/u.test(manifest.sourceCommit)) {
    throw new Error("Backup manifest sourceCommit is invalid.");
  }
  if (manifest.targets?.rpoHours !== 24 || manifest.targets?.rtoHours !== 4) {
    throw new Error("Backup manifest must retain the approved RPO/RTO targets.");
  }
  if (
    manifest.retention?.days !== RETENTION_DAYS ||
    Date.parse(manifest.retention.expiresAt) !==
      Date.parse(manifest.createdAt) + RETENTION_DAYS * 24 * 60 * 60 * 1_000
  ) {
    throw new Error("Backup manifest retention must be exactly 30 days.");
  }
  if (
    manifest.encryption?.algorithm !== "aes-256-gcm" ||
    !/^[a-f0-9]{64}$/u.test(manifest.encryption.keyFingerprint) ||
    Object.keys(manifest.encryption).some(
      (field) => !["algorithm", "keyFingerprint", "aadTemplate"].includes(field),
    )
  ) {
    throw new Error("Backup manifest encryption metadata is invalid.");
  }
  for (const field of ["plaintextSha256", "encryptedSha256"]) {
    assertSha256(manifest.database?.[field], `Database ${field}`);
  }
  if (
    !Number.isSafeInteger(manifest.database.plaintextBytes) ||
    manifest.database.plaintextBytes < 0 ||
    !Number.isSafeInteger(manifest.database.encryptedBytes) ||
    manifest.database.encryptedBytes < manifest.database.plaintextBytes
  ) {
    throw new Error("Database byte counts are invalid.");
  }
  if (!manifest.database.rowCounts || typeof manifest.database.rowCounts !== "object") {
    throw new Error("Database row counts are required.");
  }
  if (
    !Array.isArray(manifest.objects?.entries) ||
    !Number.isSafeInteger(manifest.objects.count) ||
    !Number.isSafeInteger(manifest.objects.totalBytes) ||
    manifest.objects.count !== manifest.objects.entries.length
  ) {
    throw new Error("Object manifest counts are invalid.");
  }
  const objectKeys = new Set();
  for (const entry of manifest.objects.entries) {
    const parsed = parseObjectReference(
      `storage://${manifest.objects.bucket}/${entry.key}`,
      manifest.objects.bucket,
    );
    if (objectKeys.has(parsed.key)) {
      throw new Error("Object manifest contains duplicate keys.");
    }
    objectKeys.add(parsed.key);
    assertSha256(entry.sha256, "Object checksum");
    assertSha256(entry.encryptedSha256, "Encrypted object checksum");
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error("Object byte size is invalid.");
    }
    assertIsoDate(entry.lastModified, "Object lastModified");
  }
  if (
    manifest.objects.entries.reduce((total, entry) => total + entry.size, 0) !==
    manifest.objects.totalBytes
  ) {
    throw new Error("Object manifest total bytes are invalid.");
  }
  for (const reference of manifest.objectReferences) {
    const parsed = parseObjectReference(reference, manifest.objects.bucket);
    if (!objectKeys.has(parsed.key)) {
      throw new Error(`Database object reference is missing from the backup: ${parsed.uri}.`);
    }
  }
  for (const migration of manifest.migrationFiles) {
    assertSha256(migration.sha256, "Migration file checksum");
  }
  return true;
}

export async function writeBackupCompletion(directory, manifestSha256) {
  assertSha256(manifestSha256, "Backup manifest hash");
  await writeFile(
    path.join(directory, "completion.json"),
    `${JSON.stringify(
      {
        formatVersion: 1,
        manifestSha256,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export async function assertCompleteBackup(directory) {
  let manifest;
  let completion;
  try {
    [manifest, completion] = await Promise.all([
      readFile(path.join(directory, "manifest.json"), "utf8"),
      readFile(path.join(directory, "completion.json"), "utf8"),
    ]);
  } catch {
    throw new Error("Backup completion record or manifest is missing.");
  }

  let completionRecord;
  try {
    completionRecord = JSON.parse(completion);
  } catch {
    throw new Error("Backup completion record is invalid.");
  }
  const manifestSha256 = sha256(manifest);
  if (completionRecord?.formatVersion !== 1 || completionRecord.manifestSha256 !== manifestSha256) {
    throw new Error("Backup manifest hash does not match the completion record.");
  }
  return manifestSha256;
}

export function planBackupPruning(backups, now) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const interruptedCutoffMs = 24 * 60 * 60 * 1_000;
  return backups
    .flatMap((backup) => {
      if (backup.complete) {
        return Date.parse(backup.expiresAt) <= nowMs
          ? [{ path: backup.path, reason: "expired" }]
          : [];
      }
      return Date.parse(backup.updatedAt) <= nowMs - interruptedCutoffMs
        ? [{ path: backup.path, reason: "interrupted" }]
        : [];
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function verifyRestoredState({ manifest, restored }) {
  const expectedRows = manifest.database.rowCounts;
  const actualRows = restored.rowCounts;
  const expectedTables = Object.keys(expectedRows).sort();
  const actualTables = Object.keys(actualRows).sort();
  if (JSON.stringify(expectedTables) !== JSON.stringify(actualTables)) {
    throw new Error("Restored database table set differs from the backup manifest.");
  }
  for (const table of expectedTables) {
    if (expectedRows[table] !== actualRows[table]) {
      throw new Error(
        `Restored row count mismatch for ${table}: expected ${expectedRows[table]}, got ${actualRows[table]}.`,
      );
    }
  }

  const foreignKeyViolationCount = Object.values(restored.foreignKeyViolations).reduce(
    (total, count) => total + Number(count),
    0,
  );
  if (foreignKeyViolationCount !== 0) {
    throw new Error("Restored database has foreign key violations.");
  }

  const expectedObjects = new Map(manifest.objects.entries.map((entry) => [entry.key, entry]));
  const actualObjects = new Map(restored.objects.map((entry) => [entry.key, entry]));
  if (expectedObjects.size !== actualObjects.size) {
    throw new Error("Restored object count differs from the backup manifest.");
  }
  for (const [key, expected] of expectedObjects) {
    const actual = actualObjects.get(key);
    if (!actual) {
      throw new Error(`Restored object is missing: ${key}.`);
    }
    if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`Restored object checksum or size mismatch: ${key}.`);
    }
  }

  const expectedReferences = new Set(
    manifest.objectReferences.map(
      (reference) => parseObjectReference(reference, manifest.objects.bucket).key,
    ),
  );
  const actualReferences = new Set(
    restored.objectReferences.map(
      (reference) => parseObjectReference(reference, manifest.objects.bucket).key,
    ),
  );
  if (
    expectedReferences.size !== actualReferences.size ||
    [...expectedReferences].some((key) => !actualReferences.has(key))
  ) {
    throw new Error("Restored database object references differ from the backup manifest.");
  }
  const danglingReference = [...expectedReferences].find((key) => !expectedObjects.has(key));
  if (danglingReference) {
    throw new Error(
      `Database object reference is missing from object storage: ${danglingReference}.`,
    );
  }

  return {
    ok: true,
    rowCount: Object.values(expectedRows).reduce((total, count) => total + count, 0),
    objectCount: expectedObjects.size,
    objectBytes: manifest.objects.totalBytes,
    foreignKeyConstraints: foreignKeyViolationCount,
    objectReferences: expectedReferences.size,
  };
}
