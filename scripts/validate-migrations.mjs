import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { runCli } from "./cli-entry.mjs";

const migrationsDirectory = path.resolve("packages/db/migrations");
const metadataDirectory = path.join(migrationsDirectory, "meta");
const ROOT_SNAPSHOT_PREV_ID = "00000000-0000-0000-0000-000000000000";

export function validateMigrationCatalog({ journalEntries, migrationTags, snapshots }) {
  const errors = [];
  const indexes = new Set();
  const journalTags = new Set();
  const availableTags = new Set(migrationTags);

  for (const [position, entry] of journalEntries.entries()) {
    if (entry.idx !== position) {
      errors.push(
        `journal index gap at position ${position}: expected ${position}, found ${entry.idx}`,
      );
    }
    const expectedTagPrefix = `${String(entry.idx).padStart(4, "0")}_`;
    if (!entry.tag.startsWith(expectedTagPrefix)) {
      errors.push(
        `migration tag prefix mismatch at position ${position}: expected ${expectedTagPrefix}, found ${entry.tag}`,
      );
    }
    if (indexes.has(entry.idx)) {
      errors.push(`duplicate journal index ${entry.idx}`);
    }
    indexes.add(entry.idx);

    if (journalTags.has(entry.tag)) {
      errors.push(`duplicate journal tag ${entry.tag}`);
    }
    journalTags.add(entry.tag);

    if (!availableTags.has(entry.tag)) {
      errors.push(`missing migration file for ${entry.tag}`);
    }
  }

  for (const tag of availableTags) {
    if (!journalTags.has(tag)) {
      errors.push(`unregistered migration file ${tag}`);
    }
  }

  const snapshotsByName = new Map(snapshots.map((snapshot) => [snapshot.name, snapshot]));
  const expectedSnapshotNames = new Set();
  for (const entry of journalEntries) {
    const snapshotName = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
    expectedSnapshotNames.add(snapshotName);
    if (!snapshotsByName.has(snapshotName)) {
      errors.push(`missing snapshot for ${entry.tag}: ${snapshotName}`);
    }
  }
  for (const snapshot of snapshots) {
    if (!expectedSnapshotNames.has(snapshot.name)) {
      errors.push(`unregistered snapshot ${snapshot.name}`);
    }
  }

  const snapshotIds = new Set();
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshotIds.has(snapshot.id)) {
      errors.push(`duplicate snapshot id ${snapshot.id}`);
    }
    snapshotIds.add(snapshot.id);

    if (index === 0) {
      if (snapshot.prevId !== ROOT_SNAPSHOT_PREV_ID) {
        errors.push(
          `root snapshot prevId mismatch: ${snapshot.name} expects ${ROOT_SNAPSHOT_PREV_ID}, found ${snapshot.prevId}`,
        );
      }
      continue;
    }
    const previous = snapshots[index - 1];
    if (snapshot.prevId !== previous?.id) {
      errors.push(
        `snapshot parent chain mismatch: ${snapshot.name} expects ${previous?.id}, found ${snapshot.prevId}`,
      );
    }
  }

  return errors;
}

function main() {
  const journal = JSON.parse(readFileSync(path.join(metadataDirectory, "_journal.json"), "utf8"));
  const migrationTags = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4));
  const snapshots = readdirSync(metadataDirectory)
    .filter((name) => /^\d+_snapshot\.json$/.test(name))
    .sort()
    .map((name) => ({
      name,
      ...JSON.parse(readFileSync(path.join(metadataDirectory, name), "utf8")),
    }));
  const errors = validateMigrationCatalog({
    journalEntries: journal.entries,
    migrationTags,
    snapshots,
  });

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

runCli(import.meta.url, process.argv[1], main);
