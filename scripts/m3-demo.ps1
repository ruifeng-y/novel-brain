[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$Full
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectName = if ($env:M3_COMPOSE_PROJECT) {
  $env:M3_COMPOSE_PROJECT
} else {
  'novel-brain-m3-acceptance'
}
$healthBaseUrl = if ($env:M3_HEALTH_BASE_URL) {
  $env:M3_HEALTH_BASE_URL
} else {
  'http://127.0.0.1'
}
$playwrightBaseUrl = if ($env:PLAYWRIGHT_BASE_URL) {
  $env:PLAYWRIGHT_BASE_URL
} else {
  'http://127.0.0.1:3000'
}

Push-Location $repoRoot
try {
  $env:AI_PROVIDER = 'fake'

  if ($SkipBuild) {
    docker compose -p $projectName up -d --wait
  } else {
    docker compose -p $projectName up -d --build --wait
  }
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose did not reach a healthy state.'
  }

  docker compose -p $projectName ps
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not read Docker Compose service status.'
  }

  $health = Invoke-RestMethod "$healthBaseUrl/api/v1/health"
  if ($health.status -ne 'ok') {
    throw 'The API liveness check did not report ok.'
  }
  $ready = Invoke-RestMethod "$healthBaseUrl/api/v1/health/ready"
  if (
    $ready.checks.database -ne 'up' -or
    $ready.checks.redis -ne 'up' -or
    $ready.checks.objectStorage -ne 'up'
  ) {
    throw 'The API readiness check did not report every dependency as up.'
  }

  $env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
  $env:PLAYWRIGHT_BASE_URL = $playwrightBaseUrl
  if ($Full) {
    pnpm exec playwright test --workers=4
  } else {
    pnpm exec playwright test `
      e2e/account-lifecycle.spec.ts `
      e2e/account-audit-export.spec.ts `
      e2e/work-lifecycle.spec.ts `
      e2e/exports.spec.ts `
      e2e/publish-assistance.spec.ts `
      e2e/compliance.spec.ts `
      --workers=2
  }
  if ($LASTEXITCODE -ne 0) {
    throw 'M3 acceptance Playwright failed.'
  }

  Write-Host ''
  Write-Host 'M3 release-candidate gate passed.'
  Write-Host 'Account lifecycle, audit/export, work lifecycle, export, publish, and compliance checks are green.'
  Write-Host ''
  Write-Host 'LAN/internal release candidate: GO.'
  Write-Host 'Public release: NO-GO until B-05 human quality, B-06 real DeepSeek,'
  Write-Host 'B-08 legal sign-off, B-07 real deployment evidence, and B-12/B-13 scope close.'
  Write-Host 'See docs/acceptance/m3/acceptance.md and docs/release/v1-known-limitations.md.'
} finally {
  Pop-Location
}
