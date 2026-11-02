[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectName = if ($env:M2_COMPOSE_PROJECT) {
  $env:M2_COMPOSE_PROJECT
} else {
  'novel-brain-m2-acceptance'
}

Push-Location $repoRoot
try {
  $env:AI_PROVIDER = 'fake'
  $env:M2_RUNTIME = 'Windows Docker Compose, deterministic fake AI provider'

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
  pnpm exec playwright test e2e/m2-acceptance.spec.ts
  if ($LASTEXITCODE -ne 0) {
    throw 'M2 acceptance Playwright failed.'
  }

  $screenshotSource = Join-Path $repoRoot 'test-results\m2-acceptance'
  $screenshotTarget = Join-Path $repoRoot 'docs\acceptance\m2\screenshots'
  New-Item -ItemType Directory -Force -Path $screenshotTarget | Out-Null
  Copy-Item -Path (Join-Path $screenshotSource '*.png') -Destination $screenshotTarget -Force
  Copy-Item -Path (Join-Path $screenshotSource 'metrics.json') -Destination (
    Join-Path $repoRoot 'docs\acceptance\m2\metrics.json'
  ) -Force

  $metrics = Get-Content -Raw -Encoding UTF8 (Join-Path $screenshotSource 'metrics.json') |
    ConvertFrom-Json
  Write-Host ''
  Write-Host 'M2 acceptance passed. Screenshots:'
  Write-Host '  test-results/m2-acceptance/01-three-genre-bookshelf.png'
  Write-Host '  test-results/m2-acceptance/02-history-rules.png'
  Write-Host '  test-results/m2-acceptance/03-batch-task-center.png'
  Write-Host '  test-results/m2-acceptance/04-review-queue.png'
  Write-Host '  test-results/m2-acceptance/05-change-impact.png'
  Write-Host '  test-results/m2-acceptance/06-parallel-version.png'
  Write-Host '  test-results/m2-acceptance/07-version-rollback.png'
  Write-Host '  Docs copy: docs/acceptance/m2/screenshots/'
  Write-Host ''
  Write-Host "History generation: $($metrics.generationMs.history) ms"
  Write-Host "Urban generation: $($metrics.generationMs.urban) ms"
  Write-Host "Batch to review: $($metrics.batchReviewMs) ms"
  Write-Host "Change analysis: $($metrics.changeAnalysisMs) ms"
  Write-Host "Read p95: $($metrics.readLatency.p95Ms) ms ($($metrics.readLatency.samples) samples)"
  Write-Host "Total browser journey: $($metrics.totalJourneyMs) ms"
  Write-Host ''
  Write-Host 'Reminder: M2 is an expanded internal beta, not a public release.'
} finally {
  Pop-Location
}
