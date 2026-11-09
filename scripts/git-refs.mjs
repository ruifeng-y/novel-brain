import { execFileSync } from "node:child_process";

export function resolveGitRef(ref) {
  return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
}
