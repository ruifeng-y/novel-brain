import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

export function topologyError({ base, head, headIsAncestorOfBase }) {
  if (headIsAncestorOfBase) {
    return `PR head must not be an ancestor of its base: ${head} is an ancestor of ${base}`;
  }
  return null;
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      stdio: "ignore",
    });
    return true;
  } catch (error) {
    if (error?.status === 1) {
      return false;
    }
    throw error;
  }
}

function main() {
  const { base, head } = parseReviewRangeArguments(
    process.argv.slice(2),
    "validate-pr-topology.mjs",
  );
  const error = topologyError({
    base,
    head,
    headIsAncestorOfBase: isAncestor(head, base),
  });
  if (error) {
    throw new Error(error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
