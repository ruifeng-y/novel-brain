import assert from "node:assert/strict";
import { test } from "vitest";

import { localRuntimeError, validatePnpmLockfile } from "../validate-local-runtime.mjs";

test("rejects WSL execution against a mounted Windows workspace", () => {
  assert.match(
    localRuntimeError({ cwd: "/mnt/d/AI/Codex/novel-brain", platform: "linux" }),
    /native PowerShell/,
  );
  assert.equal(localRuntimeError({ cwd: "D:\\AI\\Codex\\novel-brain", platform: "win32" }), null);
  assert.equal(
    localRuntimeError({ cwd: "/home/runner/work/novel-brain", platform: "linux" }),
    null,
  );
});

test("rejects any WSL process even with a custom automount root", () => {
  assert.match(
    localRuntimeError({
      cwd: "/custom/windows/novel-brain",
      platform: "linux",
      release: "5.15.153.1-microsoft-standard-WSL2",
    }),
    /native PowerShell/,
  );
});

test("rejects pnpm self-management pollution in the lockfile", () => {
  const polluted = [
    "    packageManagerDependencies:",
    "      '@pnpm/exe':",
    "        specifier: 12.15.0",
    "      pnpm:",
    "        specifier: 12.15.0",
  ].join("\n");
  const clean = [
    "    packageManagerDependencies:",
    "      pnpm:",
    "        specifier: 12.15.0",
  ].join("\n");

  assert.match(validatePnpmLockfile(polluted).join("\n"), /@pnpm\/exe/);
  assert.deepEqual(validatePnpmLockfile(clean), []);
});
