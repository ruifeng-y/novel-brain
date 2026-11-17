# Local environment recovery

Use this runbook when a local command crosses the shell boundary, GitHub network access fails, or CI evidence must be downloaded.

## PowerShell enforcement

Every mutating command runs in native PowerShell. If `pnpm:devPreinstall` reports that the workspace ran through WSL, stop before running more package commands:

```powershell
git diff -- pnpm-lock.yaml
```

WSL pnpm can add an `@pnpm/exe` package-manager entry and snapshot to `pnpm-lock.yaml`. Remove only those newly added `@pnpm/exe` definitions, then rerun:

```powershell
pnpm test:guardrails
```

Do not discard unrelated lockfile changes.

## Main branch synchronization

If `git fetch` fails with an SSH or HTTPS connection reset, synchronize the local branch through the authenticated GitHub CLI:

```powershell
gh repo sync --branch main
git status --short --branch
```

Use this only for the local default branch mirror. Feature branches still use normal fetch, rebase, or merge behavior.

## CI artifact download

Download a GitHub Actions artifact with metadata lookup, retries, size verification, and extraction:

```powershell
pwsh ./scripts/download-gh-artifact.ps1 `
  -RunId 44045578715 `
  -Name playwright-evidence `
  -Destination artifacts/ui/candidates/example
```

Use `-MetadataOnly` to inspect the artifact ID, size, and selection without downloading. Production Golden evidence still follows `docs/ui/production-visual-regression.md`; local Windows screenshots never become authoritative Linux Golden files.
