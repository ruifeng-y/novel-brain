import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveGitRef } from "./git-refs.mjs";
import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

const topologyScript = fileURLToPath(new URL("./validate-pr-topology.mjs", import.meta.url));
const commitScript = fileURLToPath(new URL("./validate-commits.mjs", import.meta.url));
const baselinePath =
  process.env.COMMIT_GUARDRAIL_BASELINE ??
  fileURLToPath(new URL("./commit-guardrail-baseline.txt", import.meta.url));
const args = process.argv.slice(2);
const { base, head } =
  args.length > 0
    ? parseReviewRangeArguments(args, "check-pr-guardrails.mjs")
    : { base: "origin/main", head: "HEAD" };
const baseSha = resolveGitRef(base);
const headSha = resolveGitRef(head);
const baselineSha = readBaseline(baselinePath);
const guardrailBase = resolveGuardrailBase({ baseSha, headSha, baselineSha });

process.stdout.write(`Guardrail range: ${guardrailBase}..${headSha}\n`);
for (const script of [topologyScript, commitScript]) {
  const result = spawnSync(process.execPath, [script, "--base", guardrailBase, "--head", headSha], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}

export function resolveGuardrailBase({ baseSha, headSha, baselineSha, cwd = process.cwd() }) {
  if (!baselineSha || baselineSha === baseSha) {
    return baseSha;
  }
  if (isAncestor(baseSha, baselineSha, cwd) && isAncestor(baselineSha, headSha, cwd)) {
    return baselineSha;
  }
  return baseSha;
}

function readBaseline(path) {
  if (!existsSync(path)) {
    return undefined;
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
}

function isAncestor(ancestor, descendant, cwd) {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd,
    stdio: "ignore",
  });
  return result.status === 0;
}
