[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectName = if ($env:M1_COMPOSE_PROJECT) {
  $env:M1_COMPOSE_PROJECT
} else {
  'novel-brain-m1-acceptance'
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

  $health = Invoke-RestMethod http://127.0.0.1/api/v1/health
  if ($health.status -ne 'ok') {
    throw 'The API liveness check did not report ok.'
  }
  $ready = Invoke-RestMethod http://127.0.0.1/api/v1/health/ready
  if (
    $ready.checks.database -ne 'up' -or
    $ready.checks.redis -ne 'up' -or
    $ready.checks.objectStorage -ne 'up'
  ) {
    throw 'The API readiness check did not report every dependency as up.'
  }

  $env:PLAYWRIGHT_SKIP_WEBSERVER = '1'
  $env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3000'
  pnpm exec playwright test e2e/m1-acceptance.spec.ts
  if ($LASTEXITCODE -ne 0) {
    throw 'M1 acceptance Playwright failed.'
  }

  $screenshotSource = Join-Path $repoRoot 'test-results\m1-acceptance'
  $screenshotTarget = Join-Path $repoRoot 'docs\acceptance\m1\screenshots'
  New-Item -ItemType Directory -Force -Path $screenshotTarget | Out-Null
  Copy-Item -Path (Join-Path $screenshotSource '*.png') -Destination $screenshotTarget -Force

  $metrics = Get-Content -Raw -Encoding UTF8 (Join-Path $screenshotSource 'metrics.json') |
    ConvertFrom-Json
  Write-Host ''
  Write-Host 'M1 acceptance passed. Screenshots:'
  Write-Host '  test-results/m1-acceptance/01-story-bible-locked.png'
  Write-Host '  test-results/m1-acceptance/02-five-level-outline.png'
  Write-Host '  test-results/m1-acceptance/03-generation-readiness.png'
  Write-Host '  test-results/m1-acceptance/04-settings-center.png'
  Write-Host '  test-results/m1-acceptance/05-map-and-faction.png'
  Write-Host '  test-results/m1-acceptance/06-six-part-quality-report.png'
  Write-Host '  test-results/m1-acceptance/07-confirmed-facts.png'
  Write-Host '  test-results/m1-acceptance/08-three-chapter-writing-desk.png'
  Write-Host '  test-results/m1-acceptance/09-writing-desk-mobile.png'
  Write-Host '  Docs copy: docs/acceptance/m1/screenshots/'
  Write-Host ''
  Write-Host "Read p95: $($metrics.readLatency.p95Ms) ms ($($metrics.readLatency.samples) samples)"
  Write-Host "Search p95: $($metrics.searchLatency.p95Ms) ms ($($metrics.searchLatency.samples) samples)"
  Write-Host "Confirmed facts: $($metrics.confirmedFacts)"
  Write-Host "Total browser journey: $($metrics.totalJourneyMs) ms"
  Write-Host ''
  Write-Host 'Reminder: M1 is an internal beta for xianxia, not a public release.'
} finally {
  Pop-Location
}
