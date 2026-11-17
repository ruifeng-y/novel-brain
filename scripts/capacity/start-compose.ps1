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

$env:POSTGRES_PORT = "$PostgresPort"
$env:REDIS_PORT = "$RedisPort"
$env:API_PORT = "$ApiPort"
$env:MINIO_PORT = "$MinioPort"
$env:MINIO_CONSOLE_PORT = "$MinioConsolePort"
$env:BENCHMARK_DATABASE_NAME = $DatabaseName
$env:STORAGE_BUCKET = $StorageBucket

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

Write-Output "Capacity Compose project: $projectName"
Write-Output "API: http://localhost:$ApiPort"
Write-Output "Postgres: localhost:$PostgresPort"
Write-Output "Redis: localhost:$RedisPort"
Write-Output "MinIO metrics: http://127.0.0.1:$MinioPort/minio/v2/metrics/cluster"
