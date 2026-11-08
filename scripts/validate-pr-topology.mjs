import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function assertAncestor(base, head) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", base, head], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(`${base} is not an ancestor of ${head}`);
  }
}

function main() {
  const { base, head } = parseArguments(process.argv.slice(2));
  assertAncestor(base, head);
}

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--base" && flag !== "--head") || !value) {
      throw new Error("Usage: validate-pr-topology.mjs --base <ref> --head <ref>");
    }
    values.set(flag.slice(2), value);
  }
  const base = values.get("base");
  const head = values.get("head");
  if (!base || !head) {
    throw new Error("Usage: validate-pr-topology.mjs --base <ref> --head <ref>");
  }
  return { base, head };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
