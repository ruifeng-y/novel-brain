import { readFileSync } from "node:fs";
import { release } from "node:os";

import { runCli } from "./cli-entry.mjs";

export function localRuntimeError({ cwd, platform, release: osRelease = "" }) {
  if (platform === "linux" && (/^\/mnt\/[a-z]\//i.test(cwd) || /microsoft/i.test(osRelease))) {
    return "This Windows workspace must run through native PowerShell, not WSL.";
  }
  return null;
}

export function validatePnpmLockfile(contents) {
  const lines = contents.split(/\r?\n/);
  const blockStart = lines.findIndex((line) => /^\s*packageManagerDependencies:\s*$/.test(line));
  if (blockStart === -1) {
    return [];
  }

  const blockIndent = lines[blockStart].match(/^\s*/)[0].length;
  for (let index = blockStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const indent = line.match(/^\s*/)[0].length;
    if (indent <= blockIndent) {
      break;
    }
    if (/^\s*['"]?@pnpm\/exe['"]?\s*:/.test(line)) {
      return [
        `pnpm-lock.yaml:${index + 1}: packageManagerDependencies must not contain '@pnpm/exe'`,
      ];
    }
  }

  return [];
}

function main() {
  const errors = [
    localRuntimeError({
      cwd: process.cwd(),
      platform: process.platform,
      release,
    }),
    ...validatePnpmLockfile(readFileSync("pnpm-lock.yaml", "utf8")),
  ].filter(Boolean);

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}

runCli(import.meta.url, process.argv[1], main);
