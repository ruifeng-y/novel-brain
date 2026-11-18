[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [long]$RunId,
  [Parameter(Mandatory = $true)]
  [string]$Name,
  [Parameter(Mandatory = $true)]
  [string]$Destination,
  [string]$Repository,
  [ValidateRange(1, 32)]
  [int]$Parallelism = 8,
  [switch]$MetadataOnly
)

$ErrorActionPreference = "Stop"

if ($Name.IndexOfAny([char[]]@('"', '<', '>', '|', '*', '?', ':', '\', '/', "`r", "`n")) -ge 0) {
  throw "Artifact name contains characters unsupported by GitHub artifact names."
}
if ($Name -match "[\x00-\x1F]") {
  throw "Artifact name contains control characters."
}

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
  parallelism = $Parallelism
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
$workspaceRoot = (& git rev-parse --show-toplevel).Trim()
if ($LASTEXITCODE -ne 0 -or -not $workspaceRoot) {
  throw "Artifact downloads must run inside the repository workspace."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Test-ZipArchive([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return $false
  }
  try {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
      if ($archive.Entries.Count -eq 0) {
        return $false
      }
      $buffer = New-Object byte[] (64KB)
      foreach ($entry in $archive.Entries) {
        $entryStream = $entry.Open()
        try {
          while ($entryStream.Read($buffer, 0, $buffer.Length) -gt 0) {
            # Fully consume each entry to validate local headers and compressed data.
          }
        }
        finally {
          $entryStream.Dispose()
        }
      }
      return $true
    }
    finally {
      $archive.Dispose()
    }
  }
  catch {
    return $false
  }
}

function Assert-NoReparsePointPath([string]$Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if (-not $pathRoot) {
    throw "Path must be absolute: $Path"
  }
  $relativePath = $fullPath.Substring($pathRoot.Length)
  $segments = @($relativePath -split "[\\/]+" | Where-Object { $_ })
  $currentPath = $pathRoot
  foreach ($segment in $segments) {
    $candidatePath = Join-Path $currentPath $segment
    if (Test-Path -LiteralPath $candidatePath) {
      $item = Get-Item -LiteralPath $candidatePath -Force
      if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Reparse points are not allowed in artifact paths: $candidatePath"
      }
    }
    $currentPath = $candidatePath
  }
}

function Assert-PathWithin([string]$Path, [string]$Root, [string]$Label) {
  $rootPath = [System.IO.Path]::TrimEndingDirectorySeparator(
    [System.IO.Path]::GetFullPath($Root)
  )
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $prefix = $rootPath + [System.IO.Path]::DirectorySeparatorChar
  $comparison = if ($IsWindows) {
    [System.StringComparison]::OrdinalIgnoreCase
  }
  else {
    [System.StringComparison]::Ordinal
  }
  if (
    -not [System.String]::Equals($fullPath, $rootPath, $comparison) -and
    -not $fullPath.StartsWith($prefix, $comparison)
  ) {
    throw "$Label must stay inside the repository workspace."
  }
  Assert-NoReparsePointPath $fullPath
  return $fullPath
}

function Assert-NoReparsePointsInTree([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }
  Get-ChildItem -LiteralPath $Path -Recurse -Force | ForEach-Object {
    if ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
      throw "Reparse points are not allowed under artifact destination: $($_.FullName)"
    }
  }
}

$destinationPath = Assert-PathWithin -Path $Destination -Root $workspaceRoot -Label "Destination"
New-Item -ItemType Directory -Force -Path $destinationPath | Out-Null
Assert-NoReparsePointsInTree $destinationPath
$zipPath = Assert-PathWithin `
  -Path (Join-Path $destinationPath "$Name-$RunId.zip") `
  -Root $destinationPath `
  -Label "Artifact zip"
$zipHashPath = "$zipPath.sha256"
$partDirectory = Assert-PathWithin `
  -Path (Join-Path $destinationPath "$Name-$RunId.parts-$Parallelism") `
  -Root $destinationPath `
  -Label "Artifact part directory"

$totalBytes = [long]$artifact.size_in_bytes
$parallelThreshold = 8MB
$commonCurlArguments = @(
  "--location",
  "--fail",
  "--show-error",
  "--silent",
  "--retry", "5",
  "--retry-all-errors",
  "--retry-delay", "2",
  "--connect-timeout", "30",
  "--speed-time", "60",
  "--speed-limit", "1024"
)
$authConfig = "header = `"Authorization: Bearer $token`"`nheader = `"Accept: application/vnd.github+json`""
$downloadRequired = $true

if (Test-Path -LiteralPath $zipPath) {
  $existingBytes = (Get-Item -LiteralPath $zipPath).Length
  $existingHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
  $recordedHash = if (Test-Path -LiteralPath $zipHashPath) {
    (Get-Content -LiteralPath $zipHashPath -Raw).Trim().ToUpperInvariant()
  }
  else {
    ""
  }
  if (
    $existingBytes -eq $totalBytes -and
    $recordedHash -and
    $existingHash -eq $recordedHash -and
    (Test-ZipArchive $zipPath)
  ) {
    $downloadRequired = $false
  }
  else {
    Remove-Item -LiteralPath $zipPath -Force
    Remove-Item -LiteralPath $zipHashPath -Force -ErrorAction SilentlyContinue
  }
}

if ($downloadRequired) {
  if ($Parallelism -le 1 -or $totalBytes -lt $parallelThreshold) {
    $authConfig |
      & curl.exe @commonCurlArguments `
        --config - `
        --continue-at - `
        --output $zipPath `
        $artifact.archive_download_url
    if ($LASTEXITCODE -ne 0) {
      throw "Artifact download failed."
    }
  }
  else {
    New-Item -ItemType Directory -Force -Path $partDirectory | Out-Null
    $chunkSize = [math]::Ceiling($totalBytes / $Parallelism)
    $jobs = @()
    try {
      for ($index = 0; $index -lt $Parallelism; $index++) {
        $start = [long]$index * $chunkSize
        $end = [math]::Min($totalBytes - 1, $start + $chunkSize - 1)
        if ($start -gt $end) {
          continue
        }
        $jobContext = @{
          Start = $start
          End = $end
          OutputPath = (Join-Path $partDirectory ("chunk-{0:D2}.bin" -f $index))
          DownloadUrl = $artifact.archive_download_url
          CurlArguments = $commonCurlArguments
        }
        $jobs += Start-Job -ArgumentList $jobContext -ScriptBlock {
          param($context)

          function Get-JobFileLength([string]$Path) {
            if (Test-Path -LiteralPath $Path) {
              return (Get-Item -LiteralPath $Path).Length
            }
            return 0
          }

          function Add-ResumablePart(
            [string]$OutputPath,
            [string]$PartPath,
            [string]$PartMetadataPath,
            [long]$ExpectedStart
          ) {
            if (-not (Test-Path -LiteralPath $PartPath)) {
              Remove-Item -LiteralPath $PartMetadataPath -Force -ErrorAction SilentlyContinue
              return
            }
            if (-not (Test-Path -LiteralPath $PartMetadataPath)) {
              Remove-Item -LiteralPath $PartPath -Force -ErrorAction SilentlyContinue
              return
            }
            $recordedStart = [long]-1
            $metadataText = (Get-Content -LiteralPath $PartMetadataPath -Raw).Trim()
            if (
              -not [long]::TryParse($metadataText, [ref]$recordedStart) -or
              $recordedStart -ne $ExpectedStart
            ) {
              Remove-Item -LiteralPath $PartPath -Force -ErrorAction SilentlyContinue
              Remove-Item -LiteralPath $PartMetadataPath -Force -ErrorAction SilentlyContinue
              return
            }
            $partBytes = Get-JobFileLength $PartPath
            if ($partBytes -le 0) {
              Remove-Item -LiteralPath $PartPath -Force -ErrorAction SilentlyContinue
              Remove-Item -LiteralPath $PartMetadataPath -Force -ErrorAction SilentlyContinue
              return
            }
            $appendStream = [System.IO.File]::Open(
              $OutputPath,
              [System.IO.FileMode]::Append,
              [System.IO.FileAccess]::Write
            )
            $partStream = [System.IO.File]::OpenRead($PartPath)
            try {
              $partStream.CopyTo($appendStream)
            }
            finally {
              $partStream.Dispose()
              $appendStream.Dispose()
            }
            Remove-Item -LiteralPath $PartPath -Force
            Remove-Item -LiteralPath $PartMetadataPath -Force
          }

          $jobToken = (& gh auth token).Trim()
          if (-not $jobToken) {
            throw "GitHub authentication token is unavailable in download job."
          }
          $jobAuthConfig = "header = `"Authorization: Bearer $jobToken`"`nheader = `"Accept: application/vnd.github+json`""
          $expectedBytes = [long]$context.End - [long]$context.Start + 1
          $partPath = "$($context.OutputPath).part"
          $partMetadataPath = "$partPath.meta"

          for ($attempt = 0; $attempt -lt 10; $attempt++) {
            $currentBytes = [long](Get-JobFileLength $context.OutputPath)
            if ($currentBytes -gt $expectedBytes) {
              Remove-Item -LiteralPath $context.OutputPath -Force
              $currentBytes = 0
            }
            Add-ResumablePart `
              -OutputPath $context.OutputPath `
              -PartPath $partPath `
              -PartMetadataPath $partMetadataPath `
              -ExpectedStart ([long]$context.Start + $currentBytes)
            $currentBytes = [long](Get-JobFileLength $context.OutputPath)
            if ($currentBytes -eq $expectedBytes) {
              return
            }

            $requestStart = [long]$context.Start + $currentBytes
            Set-Content -LiteralPath $partMetadataPath -Value $requestStart -NoNewline
            $jobAuthConfig |
              & curl.exe @($context.CurlArguments) `
                --config - `
                --range "$requestStart-$($context.End)" `
                --output $partPath `
                $context.DownloadUrl
            $curlExitCode = $LASTEXITCODE
            Add-ResumablePart `
              -OutputPath $context.OutputPath `
              -PartPath $partPath `
              -PartMetadataPath $partMetadataPath `
              -ExpectedStart $requestStart

            $currentBytes = [long](Get-JobFileLength $context.OutputPath)
            if ($curlExitCode -eq 0 -and $currentBytes -eq $expectedBytes) {
              return
            }
            Start-Sleep -Seconds 2
          }
          throw "Artifact chunk download failed: $($context.OutputPath)"
        }
      }

      $jobs | Wait-Job | Out-Null
      $failedJobs = @($jobs | Where-Object State -ne "Completed")
      if ($failedJobs.Count -gt 0) {
        $jobDetails = @(
          $failedJobs | ForEach-Object {
            $errors = @(Receive-Job -Job $_ -ErrorAction SilentlyContinue 2>&1)
            "Job $($_.Id) $($_.State): $($errors -join ' ')"
          }
        )
        throw "Artifact chunk jobs failed. Retryable chunks remain: $($jobDetails -join ' | ')"
      }
      $jobs | Receive-Job -ErrorAction SilentlyContinue | Out-Null

      $assemblingPath = "$zipPath.assembling"
      $outputStream = [System.IO.File]::Open(
        $assemblingPath,
        [System.IO.FileMode]::Create,
        [System.IO.FileAccess]::Write
      )
      try {
        Get-ChildItem -LiteralPath $partDirectory -Filter "chunk-*.bin" |
          Sort-Object Name |
          ForEach-Object {
            $chunkStream = [System.IO.File]::OpenRead($_.FullName)
            try {
              $chunkStream.CopyTo($outputStream)
            }
            finally {
              $chunkStream.Dispose()
            }
          }
      }
      finally {
        $outputStream.Dispose()
      }
      Move-Item -LiteralPath $assemblingPath -Destination $zipPath -Force
    }
    finally {
      $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
    }
  }
}

$downloaded = Get-Item -LiteralPath $zipPath
if ($downloaded.Length -ne $totalBytes) {
  throw "Artifact size mismatch: expected $($artifact.size_in_bytes), received $($downloaded.Length)."
}
if (-not (Test-ZipArchive $zipPath)) {
  Remove-Item -LiteralPath $zipPath -Force
  Remove-Item -LiteralPath $zipHashPath -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $partDirectory) {
    Remove-Item -LiteralPath $partDirectory -Recurse -Force
  }
  throw "Artifact zip validation failed. Retry to download a clean artifact."
}
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
Set-Content -LiteralPath $zipHashPath -Value $zipHash -NoNewline

Expand-Archive -LiteralPath $zipPath -DestinationPath $destinationPath -Force
if (Test-Path -LiteralPath $partDirectory) {
  Remove-Item -LiteralPath $partDirectory -Recurse -Force
}
$metadata.downloadedBytes = $downloaded.Length
$metadata.zipPath = $zipPath
$metadata.zipSha256 = $zipHash
$metadata.destination = $destinationPath
$metadata | ConvertTo-Json -Compress
