param(
  [int]$ApiPort = 3101,
  [int]$PostgresPort = 35432,
  [int]$RedisPort = 36379,
  [int]$MinioPort = 39000,
  [int]$MinioConsolePort = 39001,
  [string]$DatabaseName = "novelbrain_benchmark",
  [string]$StorageBucket = "novelbrain-capacity",
  [string]$OutputDirectory = "artifacts/capacity/runtime-compose",
  [switch]$Build,
  [switch]$Reset
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$resolvedOutput = Join-Path $repositoryRoot $OutputDirectory
$projectName = "novel-brain-capacity"
$composeArguments = @(
  "-p", $projectName,
  "-f", (Join-Path $repositoryRoot "infra/docker/compose.yml"),
  "-f", (Join-Path $repositoryRoot "scripts/capacity/compose.capacity.yml")
)

$environmentNames = @(
  "POSTGRES_PORT",
  "REDIS_PORT",
  "API_PORT",
  "MINIO_PORT",
  "MINIO_CONSOLE_PORT",
  "BENCHMARK_DATABASE_NAME",
  "STORAGE_BUCKET"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
}

try {
  [Environment]::SetEnvironmentVariable("POSTGRES_PORT", "$PostgresPort", "Process")
  [Environment]::SetEnvironmentVariable("REDIS_PORT", "$RedisPort", "Process")
  [Environment]::SetEnvironmentVariable("API_PORT", "$ApiPort", "Process")
  [Environment]::SetEnvironmentVariable("MINIO_PORT", "$MinioPort", "Process")
  [Environment]::SetEnvironmentVariable("MINIO_CONSOLE_PORT", "$MinioConsolePort", "Process")
  [Environment]::SetEnvironmentVariable("BENCHMARK_DATABASE_NAME", $DatabaseName, "Process")
  [Environment]::SetEnvironmentVariable("STORAGE_BUCKET", $StorageBucket, "Process")

  if ($Reset) {
    & docker compose @composeArguments down --remove-orphans
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to reset capacity Compose project."
    }
  }

  if ($Build) {
    & docker compose @composeArguments build api worker migrate
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to build capacity Compose images."
    }
  }

  & docker compose @composeArguments up -d --wait --wait-timeout 180 postgres redis minio
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start capacity dependencies."
  }

  & docker compose @composeArguments up migrate minio-init
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to migrate or initialize capacity storage."
  }

  & docker compose @composeArguments up -d --wait --wait-timeout 180 api worker
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start capacity API and Worker."
  }

  New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null
  @{
    project = $projectName
    databaseName = $DatabaseName
    storageBucket = $StorageBucket
    apiBaseUrl = "http://localhost:$ApiPort"
    databaseUrl = "postgresql://novelbrain:novelbrain@localhost:$PostgresPort/$DatabaseName"
    redisUrl = "redis://localhost:$RedisPort/0"
    storageMetricsUrl = "http://127.0.0.1:$MinioPort/minio/v2/metrics/cluster"
    cpuBudgetCores = 8
    memoryBudgetBytes = 17179869184
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $resolvedOutput "runtime.json")
} finally {
  foreach ($name in $environmentNames) {
    if ($null -eq $previousEnvironment[$name]) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], "Process")
    }
  }
}

Write-Output "Capacity Compose project: $projectName"
Write-Output "API: http://localhost:$ApiPort"
Write-Output "Postgres: localhost:$PostgresPort"
Write-Output "Redis: localhost:$RedisPort"
Write-Output "MinIO metrics: http://127.0.0.1:$MinioPort/minio/v2/metrics/cluster"
