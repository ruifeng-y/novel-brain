import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const migrationsDirectory = path.resolve("packages/db/migrations");
const metadataDirectory = path.join(migrationsDirectory, "meta");

export function validateMigrationCatalog({ journalEntries, migrationTags, snapshots }) {
  const errors = [];
  const indexes = new Set();
  const journalTags = new Set();
  const availableTags = new Set(migrationTags);

  for (const entry of journalEntries) {
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

  const snapshotIds = new Set();
  for (const [index, snapshot] of snapshots.entries()) {
    if (snapshotIds.has(snapshot.id)) {
      errors.push(`duplicate snapshot id ${snapshot.id}`);
    }
    snapshotIds.add(snapshot.id);

    if (index === 0) {
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
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
