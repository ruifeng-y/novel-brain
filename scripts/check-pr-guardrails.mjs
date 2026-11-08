import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveGitRef } from "./git-refs.mjs";
import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

const topologyScript = fileURLToPath(new URL("./validate-pr-topology.mjs", import.meta.url));
const commitScript = fileURLToPath(new URL("./validate-commits.mjs", import.meta.url));
const args = process.argv.slice(2);
const { base, head } =
  args.length > 0
    ? parseReviewRangeArguments(args, "check-pr-guardrails.mjs")
    : { base: "origin/main", head: "HEAD" };
const baseSha = resolveGitRef(base);
const headSha = resolveGitRef(head);

process.stdout.write(`Guardrail range: ${baseSha}..${headSha}\n`);
for (const script of [topologyScript, commitScript]) {
  const result = spawnSync(process.execPath, [script, "--base", baseSha, "--head", headSha], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
