import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateCommitMessages, validateCommitSubjects } from "./validate-commits.mjs";
import { localRuntimeError, validatePnpmLockfile } from "./validate-local-runtime.mjs";
import { validateMigrationCatalog } from "./validate-migrations.mjs";

const topologyScript = fileURLToPath(new URL("./validate-pr-topology.mjs", import.meta.url));
const commitScript = fileURLToPath(new URL("./validate-commits.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("runs focused guardrail tests in production CI", () => {
  const workflow = readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /^\s+- run: pnpm test:guardrails\s*$/m);
});

test("uses the pinned PR base SHA for PR guardrails", () => {
  const workflow = readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  const commands = workflow.match(
    /run: node scripts\/validate-(?:pr-topology|commits)\.mjs[^\n]+/g,
  );

  assert.equal(commands?.length, 2);
  for (const command of commands) {
    assert.match(command, /--base \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  }
  assert.doesNotMatch(workflow, /origin\/\$\{\{ github\.base_ref \}\}/);
});

test("runs migration guardrails from the local check command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));

  assert.match(packageJson.scripts.check, /pnpm check:migrations/);
  assert.match(packageJson.scripts["check:migrations"], /node scripts\/validate-migrations\.mjs/);
  assert.match(packageJson.scripts["check:migrations"], /pnpm db:migrations:check/);
});

test("points local guidance to the executable guardrail commands", () => {
  const guidance = readFileSync(path.join(repositoryRoot, "AGENTS.md"), "utf8");

  assert.match(guidance, /node scripts\/validate-pr-topology\.mjs --base origin\/main --head HEAD/);
  assert.match(guidance, /node scripts\/validate-commits\.mjs --base origin\/main --head HEAD/);
  assert.match(guidance, /pnpm test:guardrails/);
  assert.match(guidance, /pnpm check:migrations/);
});

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

test("rejects an English description even when the scope contains Chinese", () => {
  const errors = validateCommitSubjects(["feat(中文): add release guard"]);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /简体中文/);
});

test("requires a Chinese commit body when a body is present", () => {
  assert.match(
    validateCommitMessages(["feat: 增加校验\n\n- add release guard"]).join("\n"),
    /body must include 简体中文/,
  );
  assert.deepEqual(validateCommitMessages(["feat: 增加校验\n\n- 增加发布护栏"]), []);
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
    assert.match(reverse.stderr, /must not be an ancestor/);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test("accepts a PR when its base advances after the head diverges", () => {
  const repository = createRepository();
  try {
    writeFileSync(path.join(repository, "root.txt"), "root\n");
    runGit(repository, ["add", "root.txt"]);
    runGit(repository, ["commit", "-m", "feat: 根提交"]);
    const root = runGit(repository, ["rev-parse", "HEAD"]).trim();

    runGit(repository, ["checkout", "-b", "feature"]);
    writeFileSync(path.join(repository, "feature.txt"), "feature\n");
    runGit(repository, ["add", "feature.txt"]);
    runGit(repository, ["commit", "-m", "feat: 功能提交"]);
    const head = runGit(repository, ["rev-parse", "HEAD"]).trim();

    runGit(repository, ["checkout", "-b", "main", root]);
    writeFileSync(path.join(repository, "base.txt"), "base\n");
    runGit(repository, ["add", "base.txt"]);
    runGit(repository, ["commit", "-m", "feat: 基准前进"]);
    const base = runGit(repository, ["rev-parse", "HEAD"]).trim();

    const result = runNode(repository, topologyScript, ["--base", base, "--head", head]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test("validates merge commit messages in the PR range", () => {
  const repository = createRepository();
  try {
    writeFileSync(path.join(repository, "root.txt"), "root\n");
    runGit(repository, ["add", "root.txt"]);
    runGit(repository, ["commit", "-m", "feat: 根提交"]);
    const base = runGit(repository, ["rev-parse", "HEAD"]).trim();

    runGit(repository, ["checkout", "-b", "side"]);
    writeFileSync(path.join(repository, "side.txt"), "side\n");
    runGit(repository, ["add", "side.txt"]);
    runGit(repository, ["commit", "-m", "feat: 侧支提交"]);

    runGit(repository, ["checkout", "-b", "main", base]);
    writeFileSync(path.join(repository, "main.txt"), "main\n");
    runGit(repository, ["add", "main.txt"]);
    runGit(repository, ["commit", "-m", "feat: 主线提交"]);
    runGit(repository, ["merge", "--no-ff", "side", "-m", "Merge branch 'side'"]);

    const result = runNode(repository, commitScript, ["--base", base, "--head", "HEAD"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Merge branch 'side'/);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
});

test("accepts a PR range with multiple Chinese commits", () => {
  const repository = createRepository();
  try {
    writeFileSync(path.join(repository, "root.txt"), "root\n");
    runGit(repository, ["add", "root.txt"]);
    runGit(repository, ["commit", "-m", "feat: 根提交"]);
    const base = runGit(repository, ["rev-parse", "HEAD"]).trim();

    writeFileSync(path.join(repository, "first.txt"), "first\n");
    runGit(repository, ["add", "first.txt"]);
    runGit(repository, ["commit", "-m", "feat: 第一个提交"]);

    writeFileSync(path.join(repository, "second.txt"), "second\n");
    runGit(repository, ["add", "second.txt"]);
    runGit(repository, ["commit", "-m", "fix: 第二个提交"]);

    const result = runNode(repository, commitScript, ["--base", base, "--head", "HEAD"]);
    assert.equal(result.status, 0, result.stderr);
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
