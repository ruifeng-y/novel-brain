import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

const topologyScript = fileURLToPath(new URL("./validate-pr-topology.mjs", import.meta.url));
const commitScript = fileURLToPath(new URL("./validate-commits.mjs", import.meta.url));
const { base, head } = parseReviewRangeArguments(process.argv.slice(2), "check-pr-guardrails.mjs");
const baseSha = resolveRef(base);
const headSha = resolveRef(head);

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

function resolveRef(ref) {
  return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
}
