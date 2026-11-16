import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildBackupManifest,
  decryptBackupBuffer,
  encryptBackupBuffer,
  encryptionMetadata,
  parseBackupKey,
  parseObjectReference,
  planOrphanCleanup,
  verifyRestoredState,
  validateBackupManifest,
} from "../backup/backup-policy.mjs";

test("parses tenant-safe object references and rejects traversal", () => {
  assert.deepEqual(parseObjectReference("storage://novelbrain/users/u1/avatar.png", "novelbrain"), {
    bucket: "novelbrain",
    key: "users/u1/avatar.png",
    uri: "storage://novelbrain/users/u1/avatar.png",
  });
  assert.throws(
    () => parseObjectReference("storage://other/users/u1/avatar.png", "novelbrain"),
    /bucket/i,
  );
  assert.throws(
    () => parseObjectReference("storage://novelbrain/users/../secret.png", "novelbrain"),
    /object key/i,
  );
});

test("plans only aged orphan objects and keeps dry-run side-effect free", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  const objects = [
    {
      key: "users/u1/avatar.png",
      size: 10,
      lastModified: "2026-10-01T00:00:00.000Z",
    },
    {
      key: "users/u1/stale.tmp",
      size: 20,
      lastModified: "2026-10-01T00:00:00.000Z",
    },
    {
      key: "users/u1/new.tmp",
      size: 30,
      lastModified: "2026-11-15T00:00:00.000Z",
    },
  ];

  assert.deepEqual(
    planOrphanCleanup({
      objects,
      references: ["storage://novelbrain/users/u1/avatar.png"],
      bucket: "novelbrain",
      now,
      minimumAgeMs: 7 * 24 * 60 * 60 * 1_000,
    }),
    {
      dryRun: true,
      candidates: [
        {
          key: "users/u1/stale.tmp",
          reason: "unreferenced_and_aged",
          size: 20,
        },
      ],
    },
  );
});

test("encrypts backup artefacts with path-bound authenticated encryption", () => {
  const key = parseBackupKey(Buffer.alloc(32, 7).toString("base64"));
  const encrypted = encryptBackupBuffer(Buffer.from("private manuscript"), {
    key,
    backupId: "20261116T120000Z-abcdef123456",
    relativePath: "database.dump",
  });

  assert.equal(
    decryptBackupBuffer(encrypted, {
      key,
      backupId: "20261116T120000Z-abcdef123456",
      relativePath: "database.dump",
    }).toString(),
    "private manuscript",
  );
  assert.throws(
    () =>
      decryptBackupBuffer(encrypted, {
        key,
        backupId: "20261116T120000Z-abcdef123456",
        relativePath: "objects/copied.dump",
      }),
    /authenticate|unsupported state/i,
  );
  assert.throws(
    () =>
      decryptBackupBuffer(encrypted, {
        key: parseBackupKey(Buffer.alloc(32, 8).toString("base64")),
        backupId: "20261116T120000Z-abcdef123456",
        relativePath: "database.dump",
      }),
    /authenticate|unsupported state/i,
  );
});

test("builds a secret-free manifest with measured targets and validates checksums", () => {
  const key = parseBackupKey(Buffer.alloc(32, 7).toString("base64"));
  const keyText = key.toString("base64");
  const manifest = buildBackupManifest({
    backupId: "20261116T120000Z-abcdef123456",
    createdAt: "2026-11-16T12:10:00.000Z",
    snapshotStartedAt: "2026-11-16T12:00:00.000Z",
    snapshotCompletedAt: "2026-11-16T12:05:00.000Z",
    sourceCommit: "a".repeat(40),
    encryption: encryptionMetadata(key),
    database: {
      format: "postgres-custom",
      plaintextPath: "database.dump",
      encryptedPath: "database.dump.enc",
      plaintextBytes: 100,
      encryptedBytes: 150,
      plaintextSha256: "b".repeat(64),
      encryptedSha256: "c".repeat(64),
      rowCounts: { "public.users": 1 },
      migrations: [{ hash: "d".repeat(64), createdAt: "2026-11-01T00:00:00.000Z" }],
    },
    objects: {
      bucket: "novelbrain",
      count: 1,
      totalBytes: 20,
      entries: [
        {
          key: "users/u1/avatar.png",
          plaintextPath: "objects/users/u1/avatar.png",
          encryptedPath: "objects/users/u1/avatar.png.enc",
          size: 20,
          sha256: "e".repeat(64),
          encryptedSha256: "f".repeat(64),
          lastModified: "2026-11-15T00:00:00.000Z",
        },
      ],
    },
    objectReferences: ["storage://novelbrain/users/u1/avatar.png"],
    migrationFiles: [{ path: "0059_swift_nehzno.sql", sha256: "1".repeat(64) }],
    environment: {
      node: "v24.0.0",
      platform: "win32",
      arch: "x64",
      docker: "29.7.2",
      compose: "5.5.0",
    },
  });

  assert.equal(manifest.retention.days, 30);
  assert.equal(manifest.retention.expiresAt, "2026-12-16T12:10:00.000Z");
  assert.deepEqual(manifest.targets, { rpoHours: 24, rtoHours: 4 });
  assert.equal(JSON.stringify(manifest).includes(keyText), false);
  assert.doesNotThrow(() => validateBackupManifest(manifest));

  manifest.objects.entries[0].sha256 = "not-a-checksum";
  assert.throws(() => validateBackupManifest(manifest), /object checksum/i);
});

test("restore verification requires row, foreign-key, object and reference parity", () => {
  const manifest = {
    database: {
      rowCounts: {
        "public.users": 1,
        "public.works": 2,
      },
    },
    objects: {
      bucket: "novelbrain",
      count: 1,
      totalBytes: 20,
      entries: [
        {
          key: "users/u1/avatar.png",
          size: 20,
          sha256: "e".repeat(64),
        },
      ],
    },
    objectReferences: ["storage://novelbrain/users/u1/avatar.png"],
  };
  const restored = {
    rowCounts: {
      "public.users": 1,
      "public.works": 2,
    },
    foreignKeyViolations: {},
    objects: [
      {
        key: "users/u1/avatar.png",
        size: 20,
        sha256: "e".repeat(64),
      },
    ],
    objectReferences: ["storage://novelbrain/users/u1/avatar.png"],
  };

  assert.deepEqual(verifyRestoredState({ manifest, restored }), {
    ok: true,
    rowCount: 3,
    objectCount: 1,
    objectBytes: 20,
    foreignKeyConstraints: 0,
    objectReferences: 1,
  });
  assert.throws(
    () =>
      verifyRestoredState({
        manifest,
        restored: { ...restored, rowCounts: { ...restored.rowCounts, "public.works": 3 } },
      }),
    /row count/i,
  );
  assert.throws(
    () =>
      verifyRestoredState({
        manifest,
        restored: { ...restored, foreignKeyViolations: { works_author_id: 1 } },
      }),
    /foreign key/i,
  );
  assert.throws(
    () =>
      verifyRestoredState({
        manifest,
        restored: {
          ...restored,
          objects: [{ ...restored.objects[0], sha256: "f".repeat(64) }],
        },
      }),
    /object checksum/i,
  );
});
