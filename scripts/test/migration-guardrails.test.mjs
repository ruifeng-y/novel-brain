import assert from "node:assert/strict";
import { test } from "vitest";

import { validateMigrationCatalog } from "../validate-migrations.mjs";

test("validates migration journal files and snapshot parent chain", () => {
  const valid = validateMigrationCatalog({
    journalEntries: [
      { idx: 0, tag: "0000_initial" },
      { idx: 1, tag: "0001_followup" },
    ],
    migrationTags: ["0000_initial", "0001_followup"],
    snapshots: [
      { id: "root", name: "0000_snapshot.json", prevId: "00000000-0000-0000-0000-000000000000" },
      { id: "next", name: "0001_snapshot.json", prevId: "root" },
    ],
  });
  assert.deepEqual(valid, []);

  const invalid = validateMigrationCatalog({
    journalEntries: [
      { idx: 0, tag: "0000_initial" },
      { idx: 0, tag: "0001_missing" },
    ],
    migrationTags: ["0000_initial"],
    snapshots: [
      { id: "root", name: "0000_snapshot.json", prevId: "00000000-0000-0000-0000-000000000000" },
      { id: "next", name: "0001_snapshot.json", prevId: "missing" },
    ],
  });

  assert.match(invalid.join("\n"), /duplicate journal index/);
  assert.match(invalid.join("\n"), /missing migration file/);
  assert.match(invalid.join("\n"), /snapshot parent chain/);
});

test("rejects a journal entry without a matching snapshot", () => {
  const errors = validateMigrationCatalog({
    journalEntries: [
      { idx: 0, tag: "0000_initial" },
      { idx: 1, tag: "0001_followup" },
    ],
    migrationTags: ["0000_initial", "0001_followup"],
    snapshots: [
      { id: "root", name: "0000_snapshot.json", prevId: "00000000-0000-0000-0000-000000000000" },
    ],
  });

  assert.match(errors.join("\n"), /missing snapshot for 0001_followup/);
});

test("rejects a migration file missing from the journal", () => {
  const errors = validateMigrationCatalog({
    journalEntries: [{ idx: 0, tag: "0000_initial" }],
    migrationTags: ["0000_initial", "0001_unregistered"],
    snapshots: [
      { id: "root", name: "0000_snapshot.json", prevId: "00000000-0000-0000-0000-000000000000" },
    ],
  });

  assert.match(errors.join("\n"), /unregistered migration file 0001_unregistered/);
});

test("rejects a root snapshot with a non-empty parent", () => {
  const errors = validateMigrationCatalog({
    journalEntries: [{ idx: 0, tag: "0000_initial" }],
    migrationTags: ["0000_initial"],
    snapshots: [{ id: "root", name: "0000_snapshot.json", prevId: "unexpected-parent" }],
  });

  assert.match(errors.join("\n"), /root snapshot prevId mismatch/);
});

test("rejects a snapshot missing from the journal", () => {
  const errors = validateMigrationCatalog({
    journalEntries: [{ idx: 0, tag: "0000_initial" }],
    migrationTags: ["0000_initial"],
    snapshots: [
      { id: "root", name: "0000_snapshot.json", prevId: "00000000-0000-0000-0000-000000000000" },
      { id: "extra", name: "0001_snapshot.json", prevId: "root" },
    ],
  });

  assert.match(errors.join("\n"), /unregistered snapshot 0001_snapshot\.json/);
});

test("rejects a gap in journal indexes", () => {
  const errors = validateMigrationCatalog({
    journalEntries: [
      { idx: 0, tag: "0000_initial" },
      { idx: 2, tag: "0002_followup" },
    ],
    migrationTags: ["0000_initial", "0002_followup"],
    snapshots: [
      { id: "root", name: "0000_snapshot.json", prevId: "00000000-0000-0000-0000-000000000000" },
      { id: "next", name: "0002_snapshot.json", prevId: "root" },
    ],
  });

  assert.match(errors.join("\n"), /journal index gap at position 1/);
});
