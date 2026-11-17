param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,
  [string]$RedisUrl = "redis://localhost:6379/3",
  [int]$ApiPort = 3101,
  [string]$Origin = "http://localhost:3000",
  [string]$StorageBucket = "novelbrain",
  [string]$OutputDirectory = "artifacts/capacity/runtime"
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$resolvedOutput = Join-Path $repositoryRoot $OutputDirectory
New-Item -ItemType Directory -Force -Path $resolvedOutput | Out-Null

$commonEnvironment = @{
  DATABASE_URL = $DatabaseUrl
  REDIS_URL = $RedisUrl
  AUTH_SECRET = "capacity-benchmark-auth-secret"
  PROXY_IP_SECRET = "capacity-benchmark-proxy-secret"
  ALLOW_INSECURE_LOCAL_PROXY_IP = "true"
  APP_ORIGIN = $Origin
  COOKIE_SECURE = "false"
  MODEL_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef"
  ALLOW_INSECURE_LOCAL_MODEL_KEY = "true"
  MODEL_PROVIDER_ALLOWLIST = "https://api.deepseek.com"
  AI_PROVIDER_MODE = "fake"
  STORAGE_ENDPOINT = "http://localhost:9000"
  STORAGE_REGION = "us-east-1"
  STORAGE_ACCESS_KEY_ID = "novelbrain"
  STORAGE_SECRET_ACCESS_KEY = "novelbrain-storage-secret"
  STORAGE_BUCKET = $StorageBucket
  STORAGE_HEALTH_URL = "http://localhost:9000/minio/health/live"
}
foreach ($entry in $commonEnvironment.GetEnumerator()) {
  [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, "Process")
}
[Environment]::SetEnvironmentVariable("API_PORT", "$ApiPort", "Process")
[Environment]::SetEnvironmentVariable("NODE_ENV", "development", "Process")

$api = Start-Process `
  -FilePath "node" `
  -ArgumentList "apps/api/dist/main.js" `
  -WorkingDirectory $repositoryRoot `
  -RedirectStandardOutput (Join-Path $resolvedOutput "api.out.log") `
  -RedirectStandardError (Join-Path $resolvedOutput "api.err.log") `
  -WindowStyle Hidden `
  -PassThru

$worker = Start-Process `
  -FilePath "node" `
  -ArgumentList "apps/worker/dist/main.js" `
  -WorkingDirectory $repositoryRoot `
  -RedirectStandardOutput (Join-Path $resolvedOutput "worker.out.log") `
  -RedirectStandardError (Join-Path $resolvedOutput "worker.err.log") `
  -WindowStyle Hidden `
  -PassThru

@{
  apiPid = $api.Id
  workerPid = $worker.Id
  apiBaseUrl = "http://localhost:$ApiPort"
  startedAt = (Get-Date).ToUniversalTime().ToString("o")
} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $resolvedOutput "processes.json")

Write-Output "API PID: $($api.Id)"
Write-Output "Worker PID: $($worker.Id)"
Write-Output "API: http://localhost:$ApiPort"
