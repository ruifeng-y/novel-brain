import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("runs guardrail tests through Vitest in production CI", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
  const workflow = readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  const vitestConfig = readFileSync(path.join(repositoryRoot, "vitest.config.mts"), "utf8");

  assert.match(packageJson.scripts["test:guardrails"], /^vitest run scripts\/test$/);
  assert.match(vitestConfig, /"scripts\/test\/\*\*\/\*\.test\.mjs"/);
  assert.match(workflow, /^\s+- run: pnpm test\s*$/m);
});

test("uses one pinned range for PR guardrails", () => {
  const workflow = readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
  const commands = workflow.match(/run: node scripts\/check-pr-guardrails\.mjs[^\n]+/g);

  assert.equal(commands?.length, 1);
  assert.match(commands[0], /--base \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(
    workflow,
    /- name: Validate push commit messages\s+if: github\.event_name == 'push'\s+run: node scripts\/validate-commits\.mjs --base \$\{\{ github\.event\.before \}\} --head HEAD/,
  );
});

test("wires guardrails into the local check command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));

  assert.match(packageJson.scripts.check, /pnpm check:pr/);
  assert.match(packageJson.scripts.check, /pnpm check:migrations/);
  assert.match(packageJson.scripts["check:pr"], /node scripts\/check-pr-guardrails\.mjs/);
  assert.match(packageJson.scripts["check:migrations"], /node scripts\/validate-migrations\.mjs/);
  assert.match(packageJson.scripts["check:migrations"], /pnpm db:migrations:check/);
});

test("commits a guardrail baseline for historical branch commits", () => {
  const baseline = readFileSync(
    path.join(repositoryRoot, "scripts/commit-guardrail-baseline.txt"),
    "utf8",
  ).trim();

  assert.match(baseline, /^[a-f0-9]{40}$/);
});

test("runs the runtime guard before dependencies are installed", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));

  assert.equal(
    packageJson.scripts["pnpm:devPreinstall"],
    "node scripts/validate-local-runtime.mjs",
  );
  assert.equal(packageJson.scripts.preinstall, undefined);
});

test("points local guidance to the executable guardrail commands", () => {
  const guidance = readFileSync(path.join(repositoryRoot, "AGENTS.md"), "utf8");

  assert.match(guidance, /pnpm check:pr/);
  assert.match(guidance, /pnpm test:guardrails/);
  assert.match(guidance, /pnpm check:migrations/);
  assert.doesNotMatch(guidance, /node scripts\/validate-pr-topology\.mjs/);
  assert.doesNotMatch(guidance, /node scripts\/validate-commits\.mjs/);
});
