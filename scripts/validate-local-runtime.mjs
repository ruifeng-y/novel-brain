import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function localRuntimeError({ cwd, platform }) {
  if (platform === "linux" && /^\/mnt\/[a-z]\//i.test(cwd)) {
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
    }),
    ...validatePnpmLockfile(readFileSync("pnpm-lock.yaml", "utf8")),
  ].filter(Boolean);

  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
