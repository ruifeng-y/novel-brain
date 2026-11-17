param(
  [string]$RuntimeDirectory = "artifacts/capacity/runtime"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$processesPath = Join-Path $repositoryRoot (Join-Path $RuntimeDirectory "processes.json")
if (-not (Test-Path -LiteralPath $processesPath)) {
  Write-Output "No capacity benchmark processes file found."
  exit 0
}

$processes = Get-Content -Raw -LiteralPath $processesPath | ConvertFrom-Json
foreach ($identifier in @($processes.apiPid, $processes.workerPid)) {
  $process = Get-Process -Id $identifier -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $identifier -Force
  }
}
Write-Output "Stopped capacity benchmark API and Worker."
