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

test("wires guardrails into the local check command", () => {
  const packageJson = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));

  assert.match(packageJson.scripts.check, /pnpm check:pr/);
  assert.match(packageJson.scripts.check, /pnpm check:migrations/);
  assert.match(packageJson.scripts["check:pr"], /node scripts\/validate-pr-topology\.mjs/);
  assert.match(packageJson.scripts["check:pr"], /node scripts\/validate-commits\.mjs/);
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
