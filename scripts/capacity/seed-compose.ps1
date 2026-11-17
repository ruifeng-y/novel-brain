param(
  [string]$DatabaseUrl = "postgresql://novelbrain:novelbrain@localhost:35432/novelbrain_benchmark",
  [string]$DatabaseName = "novelbrain_benchmark",
  [int]$Seed = 20261117,
  [string]$Tier = "full",
  [string]$Topology = "mid",
  [int]$Branches = 3,
  [string]$StorageEndpoint = "http://127.0.0.1:39000",
  [string]$StorageBucket = "novelbrain-capacity",
  [string]$Output = "artifacts/capacity/full-compose/fixture-manifest.json"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$environment = @{
  STORAGE_ENDPOINT = $StorageEndpoint
  STORAGE_REGION = "us-east-1"
  STORAGE_ACCESS_KEY_ID = "novelbrain"
  STORAGE_SECRET_ACCESS_KEY = "novelbrain-storage-secret"
  STORAGE_BUCKET = $StorageBucket
}
$previousEnvironment = @{}
foreach ($name in $environment.Keys) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  foreach ($entry in $environment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
  }

  & node packages/capacity-benchmark/dist/cli.js seed `
    --database-url $DatabaseUrl `
    --confirm-database $DatabaseName `
    --seed "$Seed" `
    --tier $Tier `
    --topology $Topology `
    --branches "$Branches" `
    --output $Output
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to seed the capacity fixture."
  }
} finally {
  foreach ($name in $environment.Keys) {
    if ($null -eq $previousEnvironment[$name]) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
  }
}
