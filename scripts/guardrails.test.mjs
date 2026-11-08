import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateCommitSubjects } from "./validate-commits.mjs";
import { localRuntimeError, validatePnpmLockfile } from "./validate-local-runtime.mjs";
import { validateMigrationCatalog } from "./validate-migrations.mjs";

const topologyScript = fileURLToPath(new URL("./validate-pr-topology.mjs", import.meta.url));

test("accepts Chinese Conventional Commit subjects", () => {
  assert.deepEqual(validateCommitSubjects(["feat(scope): 增加发布校验", "fix: 修正快照链"]), []);
});

test("rejects malformed and English-only commit subjects", () => {
  const errors = validateCommitSubjects([
    'Revert "feat: old behavior"',
    "feat(scope): add release guard",
  ]);

  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /Conventional Commits/);
  assert.match(errors.join("\n"), /简体中文/);
});

test("rejects WSL execution against a mounted Windows workspace", () => {
  assert.match(
    localRuntimeError({ cwd: "/mnt/d/AI/Codex/novel-brain", platform: "linux" }),
    /native PowerShell/,
  );
  assert.equal(localRuntimeError({ cwd: "D:\\AI\\Codex\\novel-brain", platform: "win32" }), null);
  assert.equal(
    localRuntimeError({ cwd: "/home/runner/work/novel-brain", platform: "linux" }),
    null,
  );
});

test("rejects pnpm self-management pollution in the lockfile", () => {
  const polluted = [
    "    packageManagerDependencies:",
    "      '@pnpm/exe':",
    "        specifier: 12.15.0",
    "      pnpm:",
    "        specifier: 12.15.0",
  ].join("\n");
  const clean = [
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.15.0",
  ].join("\n");

  assert.match(validatePnpmLockfile(polluted).join("\n"), /@pnpm\/exe/);
  assert.deepEqual(validatePnpmLockfile(clean), []);
});

test("rejects a PR whose head is an ancestor of its base", () => {
  const repository = createRepository();
  try {
    writeFileSync(path.join(repository, "base.txt"), "base\n");
    runGit(repository, ["add", "base.txt"]);
    runGit(repository, ["commit", "-m", "feat: 基准提交"]);
    const base = runGit(repository, ["rev-parse", "HEAD"]).trim();

    writeFileSync(path.join(repository, "feature.txt"), "feature\n");
    runGit(repository, ["add", "feature.txt"]);
    runGit(repository, ["commit", "-m", "feat: 功能提交"]);
    const head = runGit(repository, ["rev-parse", "HEAD"]).trim();

    const forward = runNode(repository, topologyScript, ["--base", base, "--head", head]);
    assert.equal(forward.status, 0, forward.stderr);

    const reverse = runNode(repository, topologyScript, ["--base", head, "--head", base]);
    assert.equal(reverse.status, 1);
    assert.match(reverse.stderr, /not an ancestor/);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

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

function createRepository() {
  const repository = mkdtempSync(path.join(tmpdir(), "novel-brain-guardrails-"));
  runGit(repository, ["init"]);
  runGit(repository, ["config", "user.email", "guardrails@example.com"]);
  runGit(repository, ["config", "user.name", "Guardrails Test"]);
  return repository;
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function runNode(cwd, script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}
