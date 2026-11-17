param(
  [switch]$All,
  [switch]$RemoveVolumes
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$composeArguments = @(
  "-p", "novel-brain-capacity",
  "-f", (Join-Path $repositoryRoot "infra/docker/compose.yml"),
  "-f", (Join-Path $repositoryRoot "scripts/capacity/compose.capacity.yml"),
  "stop",
  "api",
  "worker"
)

if ($All -or $RemoveVolumes) {
  $composeArguments = @(
    "-p", "novel-brain-capacity",
    "-f", (Join-Path $repositoryRoot "infra/docker/compose.yml"),
    "-f", (Join-Path $repositoryRoot "scripts/capacity/compose.capacity.yml"),
    "down",
    "--remove-orphans"
  )
}

if ($RemoveVolumes) {
  $composeArguments += "--volumes"
}

& docker compose @composeArguments
if ($LASTEXITCODE -ne 0) {
  throw "Failed to stop capacity Compose project."
}
