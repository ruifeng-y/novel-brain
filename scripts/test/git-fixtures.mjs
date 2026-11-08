import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function withRepository(callback) {
  const repository = mkdtempSync(path.join(tmpdir(), "novel-brain-guardrails-"));
  runGit(repository, ["init"]);
  runGit(repository, ["config", "user.email", "guardrails@example.com"]);
  runGit(repository, ["config", "user.name", "Guardrails Test"]);

  try {
    return callback(repository);
  } finally {
    rmSync(repository, { force: true, recursive: true });
  }
}

export function commitFile(repository, { name, content, message }) {
  writeFileSync(path.join(repository, name), content);
  runGit(repository, ["add", name]);
  runGit(repository, ["commit", "-m", message]);
  return runGit(repository, ["rev-parse", "HEAD"]).trim();
}

export function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

export function runNode(cwd, script, args) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}
