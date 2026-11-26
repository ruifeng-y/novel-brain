[CmdletBinding()]
param(
  [ValidateSet("Review", "Draft", "Statement", "Attestation")]
  [string]$Mode = "Review",
  [string]$Root,
  [string]$OutputPath,
  [string]$ResponseFile,
  [string]$GithubVerifierModule = "./scripts/m3-278-clean-packet.mjs",
  [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $Root) {
  $Root = Split-Path -Parent $PSScriptRoot
}
if (-not $OutputPath) {
  $OutputPath = Join-Path $Root "docs/quality/evidence/m3-278/approvals.json"
}

$EvidenceDirectory = Join-Path $Root "docs/quality/evidence/m3-278"
$TemplatePath = Join-Path $EvidenceDirectory "approvals.template.json"
$CandidatesPath = Join-Path $EvidenceDirectory "replacement-candidates.source.json"
$ReviewFindingsPath = Join-Path $EvidenceDirectory "review-findings.source.json"
$ExpectedOwner = "ruifeng-y"
$script:UseResponseFile = $false
$script:ResponseLines = @()
$script:ResponseIndex = 0

function Stop-Wizard([string]$Message) {
  [Console]::Error.WriteLine($Message)
  exit 1
}

function Read-Required([string]$Prompt) {
  while ($true) {
    $raw = Read-InputLine $Prompt
    if ($null -eq $raw) {
      Stop-Wizard "M3_278_INPUT_EOF:$Prompt"
    }
    $value = $raw.Trim()
    if ($value) {
      return $value
    }
    Write-Host "输入不能为空。"
  }
}

function Read-Choice {
  param(
    [string]$Prompt,
    [string[]]$Choices,
    [string]$Default
  )
  while ($true) {
    $suffix = if ($Default) { " [$Default]" } else { "" }
    $raw = Read-InputLine "$Prompt$suffix"
    if ($null -eq $raw) {
      Stop-Wizard "M3_278_INPUT_EOF:$Prompt"
    }
    $value = $raw.Trim()
    if (-not $value -and $Default) {
      $value = $Default
    }
    if ($Choices -contains $value) {
      return $value
    }
    Write-Host "请输入：$($Choices -join ' / ')"
  }
}

function Read-InputLine([string]$Prompt) {
  if ($script:UseResponseFile) {
    if ($script:ResponseIndex -ge $script:ResponseLines.Count) {
      Stop-Wizard "M3_278_INPUT_EOF:$Prompt"
    }
    $value = $script:ResponseLines[$script:ResponseIndex]
    $script:ResponseIndex += 1
    Write-Host "$Prompt -> [response $($script:ResponseIndex)]"
    return $value
  }
  return Read-Host $Prompt
}

function Read-JsonFile([string]$PathValue) {
  if (-not (Test-Path -LiteralPath $PathValue -PathType Leaf)) {
    Stop-Wizard "M3_278_FILE_MISSING:$PathValue"
  }
  $content = [System.IO.File]::ReadAllText(
    $PathValue,
    [System.Text.UTF8Encoding]::new($false)
  )
  return $content | ConvertFrom-Json
}

function Write-JsonFile([string]$PathValue, $Value) {
  $directory = Split-Path -Parent $PathValue
  if ($directory -and -not (Test-Path -LiteralPath $directory)) {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
  }
  $json = ($Value | ConvertTo-Json -Depth 100) + "`n"
  [System.IO.File]::WriteAllText(
    $PathValue,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-PayloadHash([string]$PathValue) {
  $env:M3_278_APPROVALS_PATH = $PathValue
  $code = @(
    "import { readFileSync } from 'node:fs';",
    "import { computeM3_278ApprovalPayloadSha256 } from './scripts/m3-278-clean-packet.mjs';",
    "const approvals = JSON.parse(readFileSync(process.env.M3_278_APPROVALS_PATH, 'utf8'));",
    "process.stdout.write(computeM3_278ApprovalPayloadSha256(approvals));"
  ) -join "`n"
  Push-Location $Root
  try {
    $hash = (& node --input-type=module -e $code).Trim()
  } finally {
    Pop-Location
  }
  if ($LASTEXITCODE -ne 0 -or $hash -notmatch "^[a-f0-9]{64}$") {
    Stop-Wizard "M3_278_PAYLOAD_HASH_FAILED"
  }
  return $hash
}

function Get-Statement($Approvals) {
  $statement = @"
M3-278-HUMAN-APPROVAL

本人 $ExpectedOwner 作为 NovelBrain product/quality owner，确认已逐项审阅并批准 24/24 replacement candidates。

- Candidate packet SHA-256: $($Approvals.candidatePacketSha256)
- Replacement manifest SHA-256: $($Approvals.replacementManifestSha256)
- Approval payload SHA-256: $($Approvals.humanAttestation.approvalPayloadSha256)
"@
  return $statement.TrimEnd()
}

function Verify-GithubAttestation($Attestation) {
  $env:M3_278_ATTESTATION_JSON = $Attestation | ConvertTo-Json -Compress -Depth 20
  $env:M3_278_GITHUB_VERIFIER_MODULE = $GithubVerifierModule
  $code = @(
    "import { pathToFileURL } from 'node:url';",
    "const verifier = await import(pathToFileURL(process.env.M3_278_GITHUB_VERIFIER_MODULE).href);",
    "const attestation = JSON.parse(process.env.M3_278_ATTESTATION_JSON);",
    "process.stdout.write(verifier.verifyM3_278GithubApprovalAttestation(attestation) ? 'true' : 'false');"
  ) -join "`n"
  Push-Location $Root
  try {
    $verified = (& node --input-type=module -e $code).Trim()
  } finally {
    Pop-Location
  }
  return $LASTEXITCODE -eq 0 -and $verified -eq "true"
}

if ($ResponseFile) {
  if (-not (Test-Path -LiteralPath $ResponseFile -PathType Leaf)) {
    Stop-Wizard "M3_278_RESPONSE_FILE_MISSING:$ResponseFile"
  }
  $responseContent = [System.IO.File]::ReadAllText(
    $ResponseFile,
    [System.Text.UTF8Encoding]::new($false)
  )
  $script:ResponseLines = @($responseContent -split "\r?\n")
  $script:UseResponseFile = $true
}

if ($Mode -eq "Review" -and $ResponseFile) {
  Stop-Wizard "M3_278_RESPONSE_FILE_NOT_ALLOWED_FOR_REVIEW"
}
if ($Mode -eq "Draft" -and -not $ResponseFile) {
  Stop-Wizard "M3_278_DRAFT_REQUIRES_RESPONSE_FILE"
}

if ($Mode -eq "Review" -or $Mode -eq "Draft") {
  if ((Test-Path -LiteralPath $OutputPath) -and -not $Force) {
    Stop-Wizard "M3_278_APPROVALS_EXISTS:$OutputPath"
  }

  $approvals = Read-JsonFile $TemplatePath
  $candidates = Read-JsonFile $CandidatesPath
  $reviewFindings = Read-JsonFile $ReviewFindingsPath
  $candidateById = @{}
  foreach ($candidate in $candidates.candidates) {
    $candidateById[$candidate.blindSampleId] = $candidate
  }
  $reviewDecisionById = @{}
  foreach ($decision in $reviewFindings.ownerDecisions) {
    $reviewDecisionById[$decision.blindSampleId] = $decision
  }

  Write-Host ""
  Write-Host "M3-278 逐项人工审批。只有你本人输入的内容会被记录。"
  $owner = Read-Required "GitHub owner login (必须为 $ExpectedOwner)"
  if ($owner -ne $ExpectedOwner) {
    Stop-Wizard "M3_278_OWNER_INVALID:$owner"
  }

  for ($index = 0; $index -lt $approvals.approvals.Count; $index++) {
    $entry = $approvals.approvals[$index]
    $candidate = $candidateById[$entry.blindSampleId]
    if (-not $candidate) {
      Stop-Wizard "M3_278_CANDIDATE_MISSING:$($entry.blindSampleId)"
    }
    $reviewDecision = $reviewDecisionById[$entry.blindSampleId]

    Write-Host ""
    Write-Host ("=" * 72)
    Write-Host ("[{0}/24] {1}  {2} / {3}" -f ($index + 1), $entry.blindSampleId, $entry.family, $entry.severity)
    Write-Host "既定事实：$($entry.establishedFact)"
    Write-Host ""
    Write-Host $candidate.text
    Write-Host ""
    Write-Host "必须保留的 beats："
    foreach ($beat in $candidate.requiredBeats) {
      Write-Host " - $beat"
    }
    if ($reviewDecision) {
      Write-Host ""
      Write-Host "已记录裁决：$($reviewDecision.decision)"
      Write-Host "问题：$($reviewDecision.prompt)"
      Write-Host "结论：$($reviewDecision.resolution)"
    }

    $decision = Read-Choice "decision" @("approve", "reject")
    $rationale = Read-Required "rationale"
    $impact = Read-Required "impact"

    $entry.decision = $decision
    $entry.rationale = $rationale
    $entry.impact = $impact
    $entry.adjudicatorId = $owner
    $entry.adjudicatorKind = "human"
    $entry.attestationId = "M3-278-APPROVAL-$($entry.blindSampleId)"
    $entry.decidedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

    if ($reviewDecision) {
      $entry.reviewDecision = Read-Choice "reviewDecision" @(
        "accept_current",
        "revise_candidate",
        "reject_candidate"
      )
      $entry.reviewDecisionRationale = Read-Required "reviewDecisionRationale"
    } else {
      $entry.reviewDecision = "not-required"
      $entry.reviewDecisionRationale = $null
    }
  }

  $reviewComplete =
    @(
      $approvals.approvals | Where-Object {
        $_.decision -ne "approve" -or
        ($_.reviewDecisionPrompt -and $_.reviewDecision -ne "accept_current")
      }
    ).Count -eq 0

  if ($Mode -eq "Draft") {
    $approvals.status = "draft"
    $approvals | Add-Member -NotePropertyName draftReviewComplete -NotePropertyValue $reviewComplete -Force
    $approvals.humanAttestation.approvalPayloadSha256 = $null
    $approvals.humanAttestation.statement = $null
    Write-JsonFile $OutputPath $approvals
    Write-Host ""
    Write-Host "已写入不可冻结的审批草稿：$OutputPath"
    Write-Host "draftReviewComplete=$reviewComplete"
    exit 0
  }

  if (-not $reviewComplete) {
    Stop-Wizard "M3_278_REVIEW_NOT_APPROVED"
  }

  $approvals.status = "complete"
  $approvals.humanAttestation.commentUrl = $null
  $approvals.humanAttestation.commentId = $null
  $approvals.humanAttestation.author = $null
  $approvals.humanAttestation.attestedAt = $null
  $approvals.humanAttestation.statement = $null
  $approvals.humanAttestation.approvalPayloadSha256 = $null

  Write-JsonFile $OutputPath $approvals
  $payloadHash = Get-PayloadHash $OutputPath
  $approvals.humanAttestation.approvalPayloadSha256 = $payloadHash
  $approvals.humanAttestation.statement = Get-Statement $approvals
  Write-JsonFile $OutputPath $approvals

  Write-Host ""
  Write-Host "已写入 $OutputPath"
  Write-Host "下一步：将下面的评论原文发布到 #278，然后运行 -Mode Attestation。"
  Write-Host ""
  Write-Host $approvals.humanAttestation.statement
  exit 0
}

if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) {
  Stop-Wizard "M3_278_APPROVALS_MISSING:$OutputPath"
}

$approvals = Read-JsonFile $OutputPath
if ($approvals.status -ne "complete") {
  Stop-Wizard "M3_278_APPROVALS_NOT_COMPLETE"
}
$computedPayloadHash = Get-PayloadHash $OutputPath
if ($approvals.humanAttestation.approvalPayloadSha256 -ne $computedPayloadHash) {
  Stop-Wizard "M3_278_PAYLOAD_HASH_MISMATCH"
}
if (-not $approvals.humanAttestation.statement) {
  $approvals.humanAttestation.statement = Get-Statement $approvals
}

if ($Mode -eq "Statement") {
  Write-Host $approvals.humanAttestation.statement
  exit 0
}

Write-Host "请先在 #278 发布以下完整评论："
Write-Host ""
Write-Host $approvals.humanAttestation.statement
Write-Host ""

$commentUrl = Read-Required "GitHub comment URL"
$commentMatch = [regex]::Match(
  $commentUrl,
  "^https://github\.com/ruifeng-y/novel-brain/issues/278#issuecomment-(\d+)$"
)
if (-not $commentMatch.Success) {
  Stop-Wizard "M3_278_COMMENT_URL_INVALID"
}
$commentId = $commentMatch.Groups[1].Value
$authorRaw = Read-InputLine "comment author [$ExpectedOwner]"
if ($null -eq $authorRaw) {
  Stop-Wizard "M3_278_INPUT_EOF"
}
$author = $authorRaw.Trim()
if (-not $author) {
  $author = $ExpectedOwner
}
if ($author -ne $ExpectedOwner) {
  Stop-Wizard "M3_278_ATTESTATION_AUTHOR_INVALID"
}
$attestedAtInput = Read-InputLine "attestedAt UTC ISO-8601 [now]"
if ($null -eq $attestedAtInput) {
  Stop-Wizard "M3_278_INPUT_EOF"
}
if (-not $attestedAtInput) {
  $attestedAtInput = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
}

$attestation = [pscustomobject]@{
  provider = "github_issue_comment"
  issue = 278
  requiredMarker = "M3-278-HUMAN-APPROVAL"
  candidatePacketSha256 = $approvals.candidatePacketSha256
  replacementManifestSha256 = $approvals.replacementManifestSha256
  approvalPayloadSha256 = $computedPayloadHash
  commentUrl = $commentUrl
  commentId = $commentId
  author = $author
  attestedAt = $attestedAtInput
  statement = $approvals.humanAttestation.statement
}

if (-not (Verify-GithubAttestation $attestation)) {
  Stop-Wizard "M3_278_GITHUB_ATTESTATION_UNVERIFIED"
}

$approvals.humanAttestation = $attestation
Write-JsonFile $OutputPath $approvals
Write-Host "attestation 已核验并写入。"
Write-Host "下一步运行："
Write-Host "  pnpm quality:clean-packet"
Write-Host "  pnpm quality:clean-packet -- --check"
Write-Host "  pnpm quality:clean-packet -- --freeze"
