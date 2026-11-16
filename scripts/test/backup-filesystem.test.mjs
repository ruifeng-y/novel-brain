import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "vitest";

import {
  assertCompleteBackup,
  planBackupPruning,
  writeBackupCompletion,
} from "../backup/backup-policy.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function backupDirectory(manifestText) {
  const directory = await mkdtemp(path.join(tmpdir(), "novelbrain-backup-"));
  temporaryDirectories.push(directory);
  await writeFile(path.join(directory, "manifest.json"), manifestText);
  return directory;
}

test("rejects a backup without a completion record", async () => {
  const directory = await backupDirectory("{}");
  await assert.rejects(() => assertCompleteBackup(directory), /completion/i);
});

test("accepts only a completion record bound to the current manifest hash", async () => {
  const manifestText = '{"backupId":"20261116T120000Z-abcdef123456"}';
  const directory = await backupDirectory(manifestText);
  const manifestSha256 = createHash("sha256").update(manifestText).digest("hex");
  await writeBackupCompletion(directory, manifestSha256);

  assert.equal(await assertCompleteBackup(directory), manifestSha256);

  await writeFile(path.join(directory, "manifest.json"), `${manifestText}\n`);
  await assert.rejects(() => assertCompleteBackup(directory), /manifest hash/i);
});

test("prunes expired and interrupted backups without selecting active backups", () => {
  assert.deepEqual(
    planBackupPruning(
      [
        {
          path: "expired",
          complete: true,
          expiresAt: "2026-11-01T00:00:00.000Z",
        },
        {
          path: "interrupted",
          complete: false,
          updatedAt: "2026-11-01T00:00:00.000Z",
        },
        {
          path: "active",
          complete: true,
          expiresAt: "2026-12-01T00:00:00.000Z",
        },
      ],
      new Date("2026-11-16T12:00:00.000Z"),
    ),
    [
      { path: "expired", reason: "expired" },
      { path: "interrupted", reason: "interrupted" },
    ],
  );
});
