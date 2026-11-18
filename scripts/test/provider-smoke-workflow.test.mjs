import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const workflowPath = new URL("../../.github/workflows/provider-smoke.yml", import.meta.url);

test("provider smoke is manual-only and uses the environment secret", async () => {
  const workflow = await readFile(workflowPath, "utf8");

  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s*pull_request:/mu);
  assert.doesNotMatch(workflow, /^\s*push:/mu);
  assert.match(workflow, /environment:\s*provider-smoke/u);
  assert.match(workflow, /DEEPSEEK_SMOKE_ENABLED:\s*"1"/u);
  assert.match(workflow, /REQUIRE_DEEPSEEK_SMOKE:\s*"1"/u);
  const secretLines = workflow.split(/\r?\n/u).filter((line) => line.includes("DEEPSEEK_API_KEY:"));
  assert.equal(secretLines.length, 1);
  assert.match(secretLines[0], /DEEPSEEK_API_KEY:\s*\$\{\{\s*secrets\.DEEPSEEK_API_KEY\s*\}\}/u);
});
