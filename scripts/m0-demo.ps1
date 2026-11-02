[CmdletBinding()]
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectName = if ($env:M0_COMPOSE_PROJECT) { $env:M0_COMPOSE_PROJECT } else { 'novel-brain' }

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

  pnpm exec playwright test e2e/m0-acceptance.spec.ts
  if ($LASTEXITCODE -ne 0) {
    throw 'M0 acceptance Playwright failed.'
  }

  $screenshotSource = Join-Path $repoRoot 'test-results\m0-acceptance'
  $screenshotTarget = Join-Path $repoRoot 'docs\acceptance\m0\screenshots'
  New-Item -ItemType Directory -Force -Path $screenshotTarget | Out-Null
  Copy-Item -Path (Join-Path $screenshotSource '*.png') -Destination $screenshotTarget -Force

  Write-Host ''
  Write-Host 'M0 acceptance passed. Screenshots:'
  Write-Host '  test-results/m0-acceptance/01-model-settings.png'
  Write-Host '  test-results/m0-acceptance/02-story-bible-and-outline.png'
  Write-Host '  test-results/m0-acceptance/03-streaming-chapter.png'
  Write-Host '  test-results/m0-acceptance/04-confirmed-facts.png'
  Write-Host '  test-results/m0-acceptance/05-continuity-state.png'
  Write-Host '  Docs copy: docs/acceptance/m0/screenshots/'
  Write-Host ''
  Write-Host 'Reminder: M0 is an internal walking skeleton, not a public release.'
} finally {
  Pop-Location
}
