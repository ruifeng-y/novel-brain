import { execFileSync } from "node:child_process";

import { runCli } from "./cli-entry.mjs";
import { resolveGitRef } from "./git-refs.mjs";
import { parseReviewRangeArguments } from "./review-range-arguments.mjs";

export function headAncestorOfBaseError({ base, head, headIsAncestorOfBase }) {
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
  const baseSha = resolveGitRef(base);
  const headSha = resolveGitRef(head);
  if (baseSha === headSha) {
    return;
  }
  const error = headAncestorOfBaseError({
    base: baseSha,
    head: headSha,
    headIsAncestorOfBase: isAncestor(headSha, baseSha),
  });
  if (error) {
    throw new Error(error);
  }
}

runCli(import.meta.url, process.argv[1], main);
