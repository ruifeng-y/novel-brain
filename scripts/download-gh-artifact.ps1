[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [long]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$Name,
  [Parameter(Mandatory = $true)]
  [string]$Destination,
  [string]$Repository,
  [switch]$MetadataOnly
)

$ErrorActionPreference = "Stop"

if (-not $Repository) {
  $Repository = (& gh repo view --json nameWithOwner --jq ".nameWithOwner").Trim()
}
if (-not $Repository) {
  throw "GitHub repository could not be resolved."
}

$artifacts = (& gh api "repos/$Repository/actions/runs/$RunId/artifacts") | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) {
  throw "GitHub artifact metadata request failed."
}

$artifact = $artifacts.artifacts | Where-Object { $_.name -eq $Name } | Select-Object -First 1
if (-not $artifact) {
  throw "Artifact '$Name' was not found in run $RunId."
}
if ($artifact.expired) {
  throw "Artifact '$Name' in run $RunId has expired."
}

$metadata = [ordered]@{
  event = "github.artifact.selected"
  repository = $Repository
  runId = $RunId
  artifactId = $artifact.id
  name = $artifact.name
  sizeBytes = $artifact.size_in_bytes
}
if ($MetadataOnly) {
  $metadata | ConvertTo-Json -Compress
  exit 0
}

$token = (& gh auth token).Trim()
if (-not $token) {
  throw "GitHub authentication token is unavailable."
}
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
  throw "curl.exe is required for artifact download."
}

$destinationPath = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
$zipPath = Join-Path $destinationPath "$Name-$RunId.zip"

& curl.exe `
  --location `
  --fail `
  --retry 5 `
  --retry-all-errors `
  --retry-delay 2 `
  --connect-timeout 30 `
  --output $zipPath `
  --header "Authorization: Bearer $token" `
  --header "Accept: application/vnd.github+json" `
  $artifact.archive_download_url
if ($LASTEXITCODE -ne 0) {
  throw "Artifact download failed."
}

$downloaded = Get-Item -LiteralPath $zipPath
if ($downloaded.Length -ne [long]$artifact.size_in_bytes) {
  throw "Artifact size mismatch: expected $($artifact.size_in_bytes), received $($downloaded.Length)."
}

Expand-Archive -LiteralPath $zipPath -DestinationPath $destinationPath -Force
$metadata.downloadedBytes = $downloaded.Length
$metadata.zipPath = $zipPath
$metadata.destination = $destinationPath
$metadata | ConvertTo-Json -Compress
