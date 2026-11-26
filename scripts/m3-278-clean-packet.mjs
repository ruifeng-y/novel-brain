import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runCli } from "./cli-entry.mjs";

const ISSUE = 278;
const REVIEW_ID = "m3-239-2026-11-25";
const EXPECTED_GITHUB_REPOSITORY = "ruifeng-y/novel-brain";
const EXPECTED_PRODUCT_QUALITY_OWNER = "ruifeng-y";
const APPROVAL_DECISION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CANDIDATE_DATASET_VERSION = "quality-benchmark-v2";
const CANDIDATE_PACKET_VERSION = "quality-benchmark-clean-blind-v3";
const EXPECTED_SOURCE_HASHES = {
  sourcePacket: "769abdfdb7f8486712d8fcd5b3784c14ffee5476572eb51e9839f4d1c19d432e",
  sourcePacketCanonical: "3fdae556029834bfcb97c321c3486c1fe3d57df9d6630cc99484a0ea56ce847c",
  sourceKey: "93ae0b632df27fc66ee4fc5d89d5cbfd2d28ad557299b1c93df1e9bbc0ba0c98",
  sourceDataset: "0d3f204c75fab5a52ef1940cb69a584516ae20c3b9b85cd2bfd3c1490a7f8ea6",
  sourceRubric: "5cbec16e8b2967cbe54c9a2606ea82fa8b22c53b833bf07a71037d09991bd1a4",
  sourceValidation: "b6ee1554667ecb89eff4442e572ddad031b1b1eed38027ae0c26733da45cb574",
  adjudication: "01f872aba2bb984a940ad7860f14030dae0388bb6ab677f4cdcf0334c9265c9c",
  adjudicationStatus: "3c37919d7d88daa24b4392e0ea607b530ebdfbc56d587f24ed54150616c6ab43",
  reviewPolicy: "c918948fa87a4dca5f7fc0a7d357c287865fd5b0998a93460c37ecca19685538",
};
const OLD_SCORES_SHA256 = "8d512dbf052429fa51debc053cbc046772ab50638afa7e9c0eb5a2c8240e20bc";
const EVIDENCE_DIR = "docs/quality/evidence/m3-278";
const OUTPUT_FILES = {
  replacementManifest: `${EVIDENCE_DIR}/replacement-manifest.json`,
  candidateDataset: `${EVIDENCE_DIR}/quality-benchmark-v2.dataset.candidate.json`,
  candidatePacket: `${EVIDENCE_DIR}/reviewer-packet-v3.candidate.json`,
  approvalTemplate: `${EVIDENCE_DIR}/approvals.template.json`,
  approvalRequest: `${EVIDENCE_DIR}/approval-request.md`,
  status: `${EVIDENCE_DIR}/status.json`,
};
const APPROVALS_FILE = `${EVIDENCE_DIR}/approvals.json`;
const PATHS = {
  sourceDataset: "docs/quality/quality-benchmark-v1.dataset.json",
  sourceRubric: "docs/quality/quality-benchmark-v1.rubric.json",
  sourcePacket: "docs/quality/evidence/m3-239/packet.json",
  sourceKey: "docs/quality/evidence/m3-239/key.json",
  sourceScores: "docs/quality/evidence/m3-239/human-scores.json",
  sourceValidation: "docs/quality/evidence/m3-239/validation.json",
  adjudication: "docs/quality/evidence/m3-273/adjudication.json",
  adjudicationStatus: "docs/quality/evidence/m3-273/status.json",
  reviewPolicy: "docs/quality/evidence/m3-240/review-policy.json",
  replacementCandidates: `${EVIDENCE_DIR}/replacement-candidates.source.json`,
};
const REVIEWER_SAMPLE_FIELDS = ["blindSampleId", "genre", "requiredBeats", "text"];
const REVIEWER_PACKET_FIELDS = [
  "issue",
  "packetSha256",
  "packetVersion",
  "reviewerReadiness",
  "samples",
  "schemaVersion",
  "source",
  "status",
];
const REVIEWER_PACKET_SOURCE_FIELDS = [
  "candidateDatasetSha256",
  "candidateDatasetVersion",
  "rubricSha256",
  "rubricVersion",
  "sourceDatasetSha256",
  "sourceDatasetVersion",
  "sourcePacketCanonicalSha256",
  "sourcePacketFileSha256",
  "sourcePacketVersion",
];
const REVIEWER_PACKET_READINESS_FIELDS = [
  "cleanBlindReview",
  "humanReplacementApprovalRequired",
  "status",
];
const REVIEWER_GENRES = new Set(["仙侠", "历史", "都市"]);
const OWNER_DECISION_PROMPTS = [
  {
    blindSampleId: "Q026",
    prompt: "是否将“自小怕黑”补入必需节拍，确保长期恐惧也属于评审契约？",
  },
  {
    blindSampleId: "Q075",
    prompt: "跨册同步异常是否保留，或改为仅保留两册分歧并更新节拍？",
  },
  {
    blindSampleId: "Q088",
    prompt: "是否删除“时间戳也落在同一天”这一过度定证句？",
  },
  {
    blindSampleId: "Q093",
    prompt: "既定事实是忘川书，是否将正文改为忘川书所有权冲突？",
  },
  {
    blindSampleId: "Q096",
    prompt: "是否将“第三年秋提剑回城”补为必需节拍？",
  },
  {
    blindSampleId: "Q130",
    prompt: "既定事实是忘川书，是否将正文改为忘川书使用权冲突？",
  },
  {
    blindSampleId: "Q149",
    prompt: "既定事实是灵魂转移，是否将分身共享记忆改为同一机制？",
  },
  {
    blindSampleId: "Q160",
    prompt: "既定事实是照骨镜真名，是否将归墟令伏笔改为照骨镜伏笔？",
  },
  {
    blindSampleId: "Q182",
    prompt: "是否保留预知式知识越界，或恢复平行版本来源并避免 oracle 提示？",
  },
  {
    blindSampleId: "Q186",
    prompt: "该样本应考事实转移，还是旁人的错误身份主张？",
  },
  {
    blindSampleId: "Q189",
    prompt: "既定事实是左臂骨折，是否改为骨折未愈却恢复能力的冲突？",
  },
];
const REVIEWER_LEAKAGE_PATTERNS = [
  {
    code: "explicit-confirmed-fact-conflict",
    pattern: /与已确认事实|【连续性证据】|\bseeded defect\b/iu,
  },
  {
    code: "defect-family",
    pattern:
      /\b(?:knowledge_boundary|body_continuity|identity_transition|inventory_rights|travel_time|foreshadow_payoff|branch_divergence|motivation_drift)\b/iu,
  },
  {
    code: "severity-label",
    pattern: /\bP[012]\b/u,
  },
  {
    code: "internal-evidence-field",
    pattern:
      /\b(?:sourceFactId|branchId|versionNodeId|knownIssues|expectedDisposition|sourceHash|oracle)\b/iu,
  },
  {
    code: "model-identity",
    pattern: /\b(?:deepseek|openai|gpt|claude)\b|模型身份/iu,
  },
  {
    code: "generation-state",
    pattern: /生成状态|\bgenerated\b|\bgeneration\b/iu,
  },
  {
    code: "cross-branch-or-future-oracle",
    pattern: /另一条分支|早期分支|中期分支|晚期分支|另一条时间线|未来的真相|未来真相|作者真相/iu,
  },
];

export function scanM3_278ReviewerLeakage(sample) {
  const findings = [];
  if (typeof sample === "string") {
    for (const { code, pattern } of REVIEWER_LEAKAGE_PATTERNS) {
      const match = sample.match(pattern);
      if (match) findings.push({ code, field: "text", match: match[0] });
    }
    return findings;
  }
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    return [{ code: "invalid-reviewer-sample", field: "sample", match: String(sample) }];
  }
  const unexpectedFields = Object.keys(sample ?? {}).filter(
    (field) => !REVIEWER_SAMPLE_FIELDS.includes(field),
  );
  for (const field of unexpectedFields) {
    findings.push({ code: "unexpected-reviewer-field", field, match: field });
  }
  for (const field of REVIEWER_SAMPLE_FIELDS) {
    const values = Array.isArray(sample?.[field]) ? sample[field] : [sample?.[field] ?? ""];
    values.forEach((value, index) => {
      for (const { code, pattern } of REVIEWER_LEAKAGE_PATTERNS) {
        const match = String(value).match(pattern);
        if (match) {
          findings.push({
            code,
            field: Array.isArray(sample[field]) ? `${field}[${index}]` : field,
            match: match[0],
          });
        }
      }
    });
  }
  return findings;
}

export function assertM3_278ReviewerPacketClean(packet) {
  if (
    !packet ||
    Array.isArray(packet) ||
    typeof packet !== "object" ||
    Object.keys(packet).sort().join(",") !== REVIEWER_PACKET_FIELDS.join(",") ||
    packet.schemaVersion !== 1 ||
    packet.issue !== ISSUE ||
    packet.status !== "candidate-not-approved" ||
    packet.packetVersion !== CANDIDATE_PACKET_VERSION ||
    !/^[a-f0-9]{64}$/u.test(packet.packetSha256 ?? "") ||
    !Array.isArray(packet.samples) ||
    packet.samples.length !== 204
  ) {
    throw new Error("M3_278_REVIEWER_PACKET_INVALID");
  }
  if (
    !packet.source ||
    Array.isArray(packet.source) ||
    typeof packet.source !== "object" ||
    Object.keys(packet.source).sort().join(",") !== REVIEWER_PACKET_SOURCE_FIELDS.join(",") ||
    !packet.reviewerReadiness ||
    Array.isArray(packet.reviewerReadiness) ||
    typeof packet.reviewerReadiness !== "object" ||
    Object.keys(packet.reviewerReadiness).sort().join(",") !==
      REVIEWER_PACKET_READINESS_FIELDS.join(",") ||
    packet.reviewerReadiness.status !== "not-ready" ||
    packet.reviewerReadiness.cleanBlindReview !== false ||
    packet.reviewerReadiness.humanReplacementApprovalRequired !== 24
  ) {
    throw new Error("M3_278_REVIEWER_PACKET_INVALID");
  }
  if (
    packet.samples.some(
      (sample) =>
        !sample ||
        typeof sample !== "object" ||
        Array.isArray(sample) ||
        Object.keys(sample).sort().join(",") !== REVIEWER_SAMPLE_FIELDS.join(",") ||
        !hasText(sample.blindSampleId) ||
        !/^Q\d{3}$/u.test(sample.blindSampleId) ||
        !REVIEWER_GENRES.has(sample.genre) ||
        !hasText(sample.text) ||
        !Array.isArray(sample.requiredBeats) ||
        sample.requiredBeats.length === 0 ||
        sample.requiredBeats.some((beat) => !hasText(beat)),
    ) ||
    new Set(packet.samples.map((sample) => sample.blindSampleId)).size !== 204
  ) {
    throw new Error("M3_278_REVIEWER_PACKET_INVALID");
  }
  const findings = packet.samples.flatMap((sample) =>
    scanM3_278ReviewerLeakage(sample).map((finding) => ({
      blindSampleId: sample?.blindSampleId ?? null,
      ...finding,
    })),
  );
  if (findings.length > 0) {
    throw new Error(`M3_278_REVIEWER_PACKET_LEAKAGE:${JSON.stringify(findings)}`);
  }
  const metadataFindings = scanM3_278NestedReviewerLeakage({
    schemaVersion: packet.schemaVersion,
    issue: packet.issue,
    status: packet.status,
    packetVersion: packet.packetVersion,
    packetSha256: packet.packetSha256,
    source: packet.source,
    reviewerReadiness: packet.reviewerReadiness,
  });
  if (metadataFindings.length > 0) {
    throw new Error(`M3_278_REVIEWER_PACKET_LEAKAGE:${JSON.stringify(metadataFindings)}`);
  }
}

function scanM3_278NestedReviewerLeakage(value, pathName = "packet") {
  const findings = [];
  if (typeof value === "string") {
    for (const { code, pattern } of REVIEWER_LEAKAGE_PATTERNS) {
      const match = value.match(pattern);
      if (match) findings.push({ code, field: pathName, match: match[0] });
    }
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      findings.push(...scanM3_278NestedReviewerLeakage(entry, `${pathName}[${index}]`));
    });
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      findings.push(...scanM3_278NestedReviewerLeakage(key, `${pathName}.<key>`));
      findings.push(...scanM3_278NestedReviewerLeakage(entry, `${pathName}.${key}`));
    }
  }
  return findings;
}

export function assertM3_278ReplacementCoverage(candidates) {
  const blindSampleIds = candidates.map((candidate) => candidate.blindSampleId);
  const datasetSampleIds = candidates.map((candidate) => candidate.datasetSampleId);
  if (
    candidates.length !== 24 ||
    new Set(blindSampleIds).size !== 24 ||
    new Set(datasetSampleIds).size !== 24
  ) {
    throw new Error("M3_278_REPLACEMENT_COVERAGE_INVALID");
  }
}

export async function buildM3_278Artifacts({
  root,
  approvalsOverride,
  attestationVerifier = verifyM3_278GithubApprovalAttestation,
}) {
  const source = readM3_278Source(root);
  const candidateById = new Map(
    source.replacementCandidates.candidates.map((candidate) => [
      candidate.blindSampleId,
      candidate,
    ]),
  );
  const adjudicationById = new Map(
    source.adjudication.adjudications.map((entry) => [entry.blindSampleId, entry]),
  );
  const keyByBlindSampleId = new Map(
    source.key.entries.map((entry) => [entry.blindSampleId, entry.datasetSampleId]),
  );
  const datasetById = new Map(
    [...source.dataset.chapterSamples, ...source.dataset.adversarialCases].map((sample) => [
      sample.id,
      sample,
    ]),
  );

  if (candidateById.size !== 24 || adjudicationById.size !== 24) {
    throw new Error("M3_278_REPLACEMENT_COVERAGE_INVALID");
  }

  const replacementCandidates = {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    status: "candidate-not-approved",
    candidates: [...adjudicationById.keys()].sort(compareStrings).map((blindSampleId) => {
      const candidate = candidateById.get(blindSampleId);
      const datasetSampleId = keyByBlindSampleId.get(blindSampleId);
      const datasetSample = datasetSampleId ? datasetById.get(datasetSampleId) : undefined;
      if (
        !candidate ||
        !datasetSampleId ||
        !datasetSample ||
        datasetSample.kind !== "long_horizon_case"
      ) {
        throw new Error(`M3_278_REPLACEMENT_MAPPING_INVALID:${blindSampleId}`);
      }
      return {
        blindSampleId,
        datasetSampleId,
        genre: datasetSample.genre,
        difficulty: datasetSample.difficulty,
        family: datasetSample.family,
        severity: datasetSample.knownIssues[0]?.severity,
        establishedFact: extractEstablishedFact(datasetSample.text),
        text: candidate.text,
        requiredBeats: [...candidate.requiredBeats],
      };
    }),
  };
  assertM3_278ReplacementCoverage(replacementCandidates.candidates);

  const candidateDataset = createCandidateDataset(source.dataset, replacementCandidates.candidates);
  const candidatePacket = createCandidatePacket({
    key: source.key,
    dataset: candidateDataset,
    source,
  });
  assertM3_278ReviewerPacketClean(candidatePacket);
  const replacementManifest = createReplacementManifest({
    source,
    replacementCandidates,
    candidateDataset,
    candidatePacket,
  });
  const approvalTemplate = createApprovalTemplate({
    replacementCandidates,
    candidatePacket,
    candidateDataset,
    replacementManifest,
  });
  const approvalPath = path.join(root, APPROVALS_FILE);
  const approvalFilePresent = existsSync(approvalPath);
  const approvals =
    approvalsOverride ?? (approvalFilePresent ? readJson(root, APPROVALS_FILE) : approvalTemplate);
  const approvalPayloadSha256 = computeM3_278ApprovalPayloadSha256(approvals);
  const structuralAttestationComplete = isCompleteHumanApprovalAttestation(
    approvals?.humanAttestation,
    approvalTemplate.candidatePacketSha256,
    approvalTemplate.replacementManifestSha256,
    approvalPayloadSha256,
  );
  let humanAttestationVerified = false;
  if (structuralAttestationComplete) {
    try {
      humanAttestationVerified = Boolean(await attestationVerifier?.(approvals.humanAttestation));
    } catch {
      humanAttestationVerified = false;
    }
  }
  const approvalStatus = evaluateM3_278Approvals({
    approvalTemplate,
    approvals,
    humanAttestationVerified,
    approvalPayloadSha256,
  });
  const approvalRequest = createApprovalRequest({
    replacementCandidates,
    approvalTemplate,
  });
  const status = {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    status: approvalStatus.freezeAllowed ? "approved-ready-to-freeze" : "awaiting-human-approval",
    candidateDatasetVersion: candidateDataset.manifest.datasetVersion,
    candidateDatasetSha256: candidateDataset.manifest.datasetSha256,
    candidatePacketVersion: candidatePacket.packetVersion,
    candidatePacketSha256: candidatePacket.packetSha256,
    replacementManifestSha256: replacementManifest.manifestSha256,
    approvalFileStatus: approvalsOverride
      ? "provided"
      : approvalFilePresent
        ? "present"
        : "template-only",
    approvalFilePath: APPROVALS_FILE,
    approvedCount: approvalStatus.approvedCount,
    pendingCount: approvalStatus.pendingCount,
    pendingSampleIds: approvalStatus.pendingSampleIds,
    ownerDecisionPendingCount: OWNER_DECISION_PROMPTS.length,
    hardReviewFindingsResolved: 6,
    freezeAllowed: approvalStatus.freezeAllowed,
    humanAttestationComplete: approvalStatus.humanAttestationComplete,
    humanAttestationVerified: approvalStatus.humanAttestationVerified,
    approvalPayloadSha256: approvalStatus.approvalPayloadSha256,
    reviewerReady: false,
    cleanBlindReviewCompleted: false,
    oldScoresImpact: "invalidated_for_clean_review",
    reviewPolicy: {
      path: PATHS.reviewPolicy,
      interRaterVarianceThreshold: source.reviewPolicy.interRaterVarianceThreshold,
    },
    qualityGate: {
      status: "blocked",
      blockers: [
        ...approvalStatus.blockers,
        "clean-blind-review-required",
        "hook-prose-remeasurement-pending",
      ],
    },
    blockers: [
      ...approvalStatus.blockers,
      "clean-blind-review-required",
      "hook-prose-remeasurement-pending",
    ],
    blockingIssues: ["#279", "#242"],
    downstream: {
      "#242": {
        status: "blocked",
        blockedBy: ["#278", "#279"],
      },
    },
  };
  const artifacts = {
    source,
    replacementCandidates,
    candidateDataset,
    candidatePacket,
    replacementManifest,
    approvalTemplate,
    approvalStatus,
    approvalRequest,
    status,
  };
  const artifactContents = serializeM3_278Artifacts(artifacts);
  const stalePaths = Object.entries(OUTPUT_FILES)
    .filter(([key, relativePath]) => {
      const absolutePath = path.join(root, relativePath);
      return (
        !existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== artifactContents[key]
      );
    })
    .map(([, relativePath]) => relativePath);
  return {
    ...artifacts,
    artifactContents,
    artifactFreshness: {
      status: stalePaths.length === 0 ? "passed" : "stale",
      stalePaths,
    },
  };
}

export function verifyM3_278CandidateDatasetDigest(dataset) {
  const manifestWithoutDigest = omit(dataset.manifest, ["datasetSha256"]);
  return (
    dataset.manifest.datasetSha256 ===
    sha256Text(
      JSON.stringify({
        schemaVersion: dataset.schemaVersion,
        chapterSamples: dataset.chapterSamples,
        adversarialCases: dataset.adversarialCases,
        manifest: manifestWithoutDigest,
      }),
    )
  );
}

export function verifyM3_278ReplacementManifest(manifest) {
  return manifest.manifestSha256 === sha256Json(omit(manifest, ["manifestSha256"]));
}

export function computeM3_278ApprovalPayloadSha256(approvals) {
  return sha256Json(omit(approvals, ["humanAttestation"]));
}

export function assertM3_278FreezeAllowed(approvalStatus) {
  if (!approvalStatus?.freezeAllowed) {
    throw new Error(
      `M3_278_FREEZE_BLOCKED:${approvalStatus?.blockers?.join(",") ?? "approval-status-missing"}`,
    );
  }
}

export function evaluateM3_278Approvals({
  approvalTemplate,
  approvals,
  humanAttestationVerified = false,
  approvalPayloadSha256 = computeM3_278ApprovalPayloadSha256(approvals),
}) {
  const expectedIds = approvalTemplate.approvals.map((entry) => entry.blindSampleId);
  const expectedIdSet = new Set(expectedIds);
  const expectedById = new Map(
    approvalTemplate.approvals.map((entry) => [entry.blindSampleId, entry]),
  );
  const entries = Array.isArray(approvals?.approvals) ? approvals.approvals : [];
  const blockers = [];
  const approvedIds = [];
  let nonHumanCount = 0;
  let incompleteCount = 0;
  let evidenceDriftCount = 0;
  let identityMismatchCount = 0;
  const attestationAuthor = approvals?.humanAttestation?.author;

  if (approvals?.schemaVersion !== approvalTemplate.schemaVersion) {
    blockers.push("approval-schema-invalid");
  }
  if (approvals?.issue !== ISSUE) blockers.push("approval-issue-mismatch");
  if (approvals?.reviewId !== REVIEW_ID) blockers.push("approval-review-id-mismatch");
  if (approvals?.candidatePacketSha256 !== approvalTemplate.candidatePacketSha256) {
    blockers.push("approval-candidate-packet-mismatch");
  }
  if (approvals?.candidateDatasetSha256 !== approvalTemplate.candidateDatasetSha256) {
    blockers.push("approval-candidate-dataset-mismatch");
  }
  if (approvals?.replacementManifestSha256 !== approvalTemplate.replacementManifestSha256) {
    blockers.push("approval-replacement-manifest-mismatch");
  }
  const duplicateIds = entries
    .map((entry) => entry?.blindSampleId)
    .filter((blindSampleId, index, values) => values.indexOf(blindSampleId) !== index);
  if (duplicateIds.length > 0) {
    blockers.push(`replacement-approval-duplicate:${duplicateIds.length}`);
  }
  const unknownIds = entries
    .map((entry) => entry?.blindSampleId)
    .filter((blindSampleId) => !expectedIdSet.has(blindSampleId));
  if (unknownIds.length > 0) {
    blockers.push(`replacement-approval-unknown-sample:${unknownIds.length}`);
  }

  for (const entry of entries) {
    const expected = expectedById.get(entry?.blindSampleId);
    if (!expected) continue;
    if (entry.decision !== "approve") continue;
    if (
      entry.datasetSampleId !== expected.datasetSampleId ||
      entry.manifestEntrySha256 !== expected.manifestEntrySha256 ||
      entry.originalTextSha256 !== expected.originalTextSha256 ||
      entry.originalRequiredBeatsSha256 !== expected.originalRequiredBeatsSha256 ||
      entry.family !== expected.family ||
      entry.severity !== expected.severity ||
      entry.establishedFact !== expected.establishedFact ||
      entry.reviewDecisionPrompt !== expected.reviewDecisionPrompt ||
      entry.replacementTextSha256 !== expected.replacementTextSha256 ||
      entry.requiredBeatsSha256 !== expected.requiredBeatsSha256
    ) {
      evidenceDriftCount += 1;
      continue;
    }
    if (entry.adjudicatorKind !== "human") {
      nonHumanCount += 1;
      continue;
    }
    if (
      !hasText(entry.rationale) ||
      !hasText(entry.impact) ||
      !hasText(entry.adjudicatorId) ||
      !hasText(entry.attestationId) ||
      !isIsoTimestamp(entry.decidedAt) ||
      !isDecisionFresh(entry.decidedAt, approvals?.humanAttestation?.attestedAt)
    ) {
      incompleteCount += 1;
      continue;
    }
    if (
      entry.adjudicatorId !== attestationAuthor ||
      entry.attestationId !== `M3-278-APPROVAL-${entry.blindSampleId}`
    ) {
      identityMismatchCount += 1;
      continue;
    }
    approvedIds.push(entry.blindSampleId);
  }

  const approvedIdSet = new Set(approvedIds);
  const pendingSampleIds = expectedIds.filter((sampleId) => !approvedIdSet.has(sampleId));
  if (pendingSampleIds.length > 0) {
    blockers.push(`replacement-approval-pending:${pendingSampleIds.length}`);
  }
  if (nonHumanCount > 0) {
    blockers.push(`replacement-approval-non-human:${nonHumanCount}`);
  }
  if (incompleteCount > 0) {
    blockers.push(`replacement-approval-incomplete:${incompleteCount}`);
  }
  if (evidenceDriftCount > 0) {
    blockers.push(`replacement-approval-evidence-drift:${evidenceDriftCount}`);
  }
  if (identityMismatchCount > 0) {
    blockers.push(`replacement-approval-identity-mismatch:${identityMismatchCount}`);
  }
  if (hasHumanInput(approvals) && approvals?.status !== "complete") {
    blockers.push("approval-status-pending");
  }

  const humanAttestationComplete = isCompleteHumanApprovalAttestation(
    approvals?.humanAttestation,
    approvalTemplate.candidatePacketSha256,
    approvalTemplate.replacementManifestSha256,
    approvalPayloadSha256,
  );
  if (!humanAttestationComplete) {
    blockers.push("human-approval-attestation-pending");
  } else if (!humanAttestationVerified) {
    blockers.push("human-approval-attestation-unverified");
  }

  const uniqueBlockers = [...new Set(blockers)].sort(compareStrings);
  const freezeAllowed =
    approvals?.status === "complete" &&
    humanAttestationComplete &&
    humanAttestationVerified &&
    uniqueBlockers.length === 0;
  return {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    status: freezeAllowed ? "complete" : "awaiting-human-approval",
    approvedCount: approvedIds.length,
    pendingCount: pendingSampleIds.length,
    pendingSampleIds,
    freezeAllowed,
    humanAttestationComplete,
    humanAttestationVerified,
    approvalPayloadSha256,
    blockers: uniqueBlockers,
  };
}

function readM3_278Source(root) {
  const dataset = readJson(root, PATHS.sourceDataset);
  const source = {
    dataset,
    rubric: readJson(root, PATHS.sourceRubric),
    packet: readJson(root, PATHS.sourcePacket),
    key: readJson(root, PATHS.sourceKey),
    scores: readJson(root, PATHS.sourceScores),
    validation: readJson(root, PATHS.sourceValidation),
    adjudication: readJson(root, PATHS.adjudication),
    adjudicationStatus: readJson(root, PATHS.adjudicationStatus),
    reviewPolicy: readJson(root, PATHS.reviewPolicy),
    replacementCandidates: readJson(root, PATHS.replacementCandidates),
    fileSha256: Object.fromEntries(
      Object.entries(PATHS).map(([key, relativePath]) => [
        key,
        sha256File(path.join(root, relativePath)),
      ]),
    ),
  };
  verifySourceIntegrity(source);
  return source;
}

function verifySourceIntegrity(source) {
  const datasetWithoutDigest = {
    schemaVersion: source.dataset.schemaVersion,
    chapterSamples: source.dataset.chapterSamples,
    adversarialCases: source.dataset.adversarialCases,
    manifest: omit(source.dataset.manifest, ["datasetSha256"]),
  };
  const packetCanonicalSha256 = sha256Json(source.packet.samples);
  const keyByBlindSampleId = new Map(
    source.key.entries.map((entry) => [entry.blindSampleId, entry.datasetSampleId]),
  );
  const datasetById = new Map(
    [...source.dataset.chapterSamples, ...source.dataset.adversarialCases].map((sample) => [
      sample.id,
      sample,
    ]),
  );
  const adjudications = source.adjudication.adjudications ?? [];
  if (
    source.dataset.manifest.datasetSha256 !== sha256Text(JSON.stringify(datasetWithoutDigest)) ||
    source.fileSha256.sourcePacket !== EXPECTED_SOURCE_HASHES.sourcePacket ||
    source.validation.reviewerPacketFileSha256 !== EXPECTED_SOURCE_HASHES.sourcePacket ||
    source.fileSha256.sourcePacket !== source.validation.sourcePacket?.sha256 ||
    source.fileSha256.sourceKey !== EXPECTED_SOURCE_HASHES.sourceKey ||
    source.fileSha256.sourceDataset !== EXPECTED_SOURCE_HASHES.sourceDataset ||
    source.fileSha256.sourceRubric !== EXPECTED_SOURCE_HASHES.sourceRubric ||
    source.fileSha256.sourceValidation !== EXPECTED_SOURCE_HASHES.sourceValidation ||
    packetCanonicalSha256 !== EXPECTED_SOURCE_HASHES.sourcePacketCanonical ||
    source.validation.reviewerPacketCanonicalSha256 !==
      EXPECTED_SOURCE_HASHES.sourcePacketCanonical ||
    source.packet.source?.datasetSha256 !== source.dataset.manifest.datasetSha256 ||
    source.packet.source?.rubricSha256 !== source.rubric.sha256 ||
    source.fileSha256.sourceScores !== OLD_SCORES_SHA256 ||
    source.fileSha256.adjudication !== EXPECTED_SOURCE_HASHES.adjudication ||
    source.fileSha256.adjudicationStatus !== EXPECTED_SOURCE_HASHES.adjudicationStatus ||
    source.fileSha256.reviewPolicy !== EXPECTED_SOURCE_HASHES.reviewPolicy ||
    source.scores.reviewId !== REVIEW_ID ||
    source.scores.scoreCaptureCompleted !== true ||
    source.scores.humanScores?.length !== 816 ||
    source.scores.datasetSha256 !== source.dataset.manifest.datasetSha256 ||
    source.scores.rubricSha256 !== source.rubric.sha256 ||
    source.scores.reviewerPacketFileSha256 !== source.fileSha256.sourcePacket ||
    source.scores.reviewerPacketCanonicalSha256 !== packetCanonicalSha256 ||
    source.adjudication.status !== "complete" ||
    source.adjudication.packetDecision?.decision !== "replace_affected_samples" ||
    source.adjudication.packetDecision?.oldScoresImpact !== "invalidated_for_clean_review" ||
    adjudications.length !== 24 ||
    new Set(adjudications.map((entry) => entry.blindSampleId)).size !== 24 ||
    new Set(adjudications.map((entry) => entry.datasetSampleId)).size !== 24 ||
    adjudications.some(
      (entry) =>
        entry.decision !== "replace_sample" ||
        entry.adjudicatorKind !== "human" ||
        keyByBlindSampleId.get(entry.blindSampleId) !== entry.datasetSampleId ||
        !datasetById.has(entry.datasetSampleId) ||
        sha256Text(datasetById.get(entry.datasetSampleId)?.text ?? "") !== entry.originalTextSha256,
    ) ||
    source.adjudicationStatus.completedAdjudicationCount !== 24 ||
    source.adjudicationStatus.pendingAdjudicationCount !== 0 ||
    source.adjudicationStatus.proposalPacketSha256 !== source.adjudication.proposalPacketSha256 ||
    source.reviewPolicy.issue !== 240 ||
    source.reviewPolicy.decisionId !== "interRaterVarianceThreshold" ||
    source.reviewPolicy.interRaterVarianceThreshold !== 0.1
  ) {
    throw new Error("M3_278_SOURCE_DIGEST_MISMATCH");
  }
}

function createApprovalTemplate({
  replacementCandidates,
  candidatePacket,
  candidateDataset,
  replacementManifest,
}) {
  const manifestEntryById = new Map(
    replacementManifest.replacements.map((entry) => [entry.blindSampleId, entry]),
  );
  const decisionPromptById = new Map(
    OWNER_DECISION_PROMPTS.map((entry) => [entry.blindSampleId, entry.prompt]),
  );
  return {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    status: "awaiting-human-approval",
    candidatePacketSha256: candidatePacket.packetSha256,
    candidateDatasetSha256: candidateDataset.manifest.datasetSha256,
    replacementManifestSha256: replacementManifest.manifestSha256,
    instructions: [
      "只能由真实产品/质量负责人逐项审查并填写。",
      "不得由模型补写、推断或伪造批准、身份、时间、理由和影响。",
      "填写 24 项后先将 status 改为 complete，再生成 approval payload hash。",
      "24/24 全部批准且外部 GitHub attestation 通过前，不得冻结 clean packet。",
      "本文件不改写 #240 已批准的 inter-rater variance threshold 0.1。",
    ],
    humanAttestation: {
      provider: "github_issue_comment",
      issue: ISSUE,
      requiredMarker: "M3-278-HUMAN-APPROVAL",
      candidatePacketSha256: candidatePacket.packetSha256,
      replacementManifestSha256: replacementManifest.manifestSha256,
      approvalPayloadSha256: null,
      commentUrl: null,
      commentId: null,
      author: null,
      attestedAt: null,
      statement: null,
    },
    approvals: replacementCandidates.candidates.map((candidate) => {
      const manifestEntry = manifestEntryById.get(candidate.blindSampleId);
      if (!manifestEntry) {
        throw new Error(`M3_278_APPROVAL_MANIFEST_MISSING:${candidate.blindSampleId}`);
      }
      return {
        blindSampleId: candidate.blindSampleId,
        datasetSampleId: candidate.datasetSampleId,
        family: candidate.family,
        severity: candidate.severity,
        establishedFact: candidate.establishedFact,
        reviewDecisionPrompt: decisionPromptById.get(candidate.blindSampleId) ?? null,
        originalTextSha256: manifestEntry.originalTextSha256,
        originalRequiredBeatsSha256: manifestEntry.originalRequiredBeatsSha256,
        replacementTextSha256: manifestEntry.replacementTextSha256,
        requiredBeatsSha256: manifestEntry.requiredBeatsSha256,
        manifestEntrySha256: sha256Json(manifestEntry),
        decision: null,
        rationale: null,
        impact: null,
        adjudicatorId: null,
        adjudicatorKind: null,
        attestationId: null,
        decidedAt: null,
      };
    }),
  };
}

function createReplacementManifest({
  source,
  replacementCandidates,
  candidateDataset,
  candidatePacket,
}) {
  const adjudicationById = new Map(
    source.adjudication.adjudications.map((entry) => [entry.blindSampleId, entry]),
  );
  const datasetById = new Map(
    [...source.dataset.chapterSamples, ...source.dataset.adversarialCases].map((sample) => [
      sample.id,
      sample,
    ]),
  );
  const replacements = replacementCandidates.candidates.map((candidate) => {
    const adjudication = adjudicationById.get(candidate.blindSampleId);
    const sourceSample = datasetById.get(candidate.datasetSampleId);
    if (!adjudication || !sourceSample) {
      throw new Error(`M3_278_MANIFEST_EVIDENCE_MISSING:${candidate.blindSampleId}`);
    }
    const originalTextSha256 = sha256Text(sourceSample.text);
    if (originalTextSha256 !== adjudication.originalTextSha256) {
      throw new Error(`M3_278_ORIGINAL_HASH_DRIFT:${candidate.blindSampleId}`);
    }
    return {
      blindSampleId: candidate.blindSampleId,
      datasetSampleId: candidate.datasetSampleId,
      family: candidate.family,
      severity: candidate.severity,
      establishedFact: candidate.establishedFact,
      establishedFactSha256: sha256Text(candidate.establishedFact),
      originalTextSha256,
      replacementTextSha256: sha256Text(candidate.text),
      originalRequiredBeatsSha256: sha256Json(sourceSample.requiredBeats),
      requiredBeatsSha256: sha256Json(candidate.requiredBeats),
      evidence: {
        adjudicationPath: PATHS.adjudication,
        adjudicationEntrySha256: sha256Json(adjudication),
        candidateSourcePath: PATHS.replacementCandidates,
        sourceDatasetPath: PATHS.sourceDataset,
        sourceSampleSha256: sha256Json(sourceSample),
      },
    };
  });
  const manifestWithoutHash = {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    status: "candidate-not-approved",
    source: {
      datasetVersion: source.dataset.manifest.datasetVersion,
      datasetSha256: source.dataset.manifest.datasetSha256,
      rubricVersion: source.rubric.rubricVersion,
      rubricSha256: source.rubric.sha256,
      sourcePacketFileSha256: source.fileSha256.sourcePacket,
      sourcePacketCanonicalSha256: source.validation.reviewerPacketCanonicalSha256,
      sourceValidationSha256: source.fileSha256.sourceValidation,
      sourceAdjudicationSha256: source.fileSha256.adjudication,
      sourceAdjudicationStatusSha256: source.fileSha256.adjudicationStatus,
      candidateSourceSha256: source.fileSha256.replacementCandidates,
      reviewPolicy: {
        path: PATHS.reviewPolicy,
        sha256: source.fileSha256.reviewPolicy,
        interRaterVarianceThreshold: source.reviewPolicy.interRaterVarianceThreshold,
      },
      oldScores: {
        path: PATHS.sourceScores,
        sha256: source.fileSha256.sourceScores,
        status: "invalidated_for_clean_review",
        includedInCleanReview: false,
      },
    },
    candidate: {
      datasetVersion: candidateDataset.manifest.datasetVersion,
      datasetSha256: candidateDataset.manifest.datasetSha256,
      packetVersion: candidatePacket.packetVersion,
      packetSha256: candidatePacket.packetSha256,
      sampleCount: candidatePacket.samples.length,
      replacementCount: replacements.length,
      samplesDeleted: 0,
    },
    replacements,
  };
  return {
    ...manifestWithoutHash,
    manifestSha256: sha256Json(manifestWithoutHash),
  };
}

function createApprovalRequest({ replacementCandidates, approvalTemplate }) {
  const approvalById = new Map(
    approvalTemplate.approvals.map((entry) => [entry.blindSampleId, entry]),
  );
  const sections = replacementCandidates.candidates.map((candidate) => {
    const approval = approvalById.get(candidate.blindSampleId);
    return `### ${candidate.blindSampleId}

- Dataset sample: \`${candidate.datasetSampleId}\`
- 场景 family: \`${candidate.family}\`
- 严重度: \`${candidate.severity}\`
- 既定事实: \`${candidate.establishedFact}\`
- 题材 / 难度: \`${candidate.genre}\` / \`${candidate.difficulty}\`
- Manifest entry SHA-256: \`${approval.manifestEntrySha256}\`
- 替代文本 SHA-256: \`${approval.replacementTextSha256}\`
- 必需节拍 SHA-256: \`${approval.requiredBeatsSha256}\`

候选叙事：

> ${candidate.text}

必须保留的 beats：

${candidate.requiredBeats.map((beat) => `- ${beat}`).join("\n")}

逐项审批字段：

- [ ] \`decision\`: \`approve\` 或 \`reject\`
- [ ] \`rationale\`: 真实审查理由
- [ ] \`impact\`: 对 clean packet / #279 的影响
- [ ] \`adjudicatorId\`: 产品/质量负责人身份
- [ ] \`adjudicatorKind\`: 必须为 \`human\`
- [ ] \`attestationId\`: \`M3-278-APPROVAL-${candidate.blindSampleId}\`
- [ ] \`decidedAt\`: ISO 时间戳
`;
  });
  return `# M3-278 长线替换候选逐项审批

> Owner-only review material. Do not send this file to blind reviewers.
>
> Status: awaiting human approval

Issue: #278

- Candidate dataset: \`${approvalTemplate.candidateDatasetSha256}\`
- Candidate reviewer packet: \`${approvalTemplate.candidatePacketSha256}\`
- Replacement manifest: \`${approvalTemplate.replacementManifestSha256}\`
- Required approvals: 24/24
- Old scores: \`invalidated_for_clean_review\`
- Variance threshold: #240 已批准为 \`0.1\`，本票不得改写
- Downstream: #279 全量重评、#242 最终发布门禁

候选文件不是已冻结 packet。只有 24 个样本全部由真实产品/质量负责人逐项批准，并在 #278
发布包含 \`M3-278-HUMAN-APPROVAL\`、candidate packet hash 和 replacement manifest hash
以及填完 24 项后的 approval payload hash 的外部 GitHub attestation 后，才允许冻结。
发布检查会通过 GitHub API 核对评论作者关联、Issue 278、评论时间与完整正文；每个
\`adjudicatorId\` 必须等于评论作者，每个 \`attestationId\` 必须使用该样本的固定审批 token。

## 待负责人裁决

${OWNER_DECISION_PROMPTS.map((entry) => `- ${entry.blindSampleId}: ${entry.prompt}`).join("\n")}

填写完 24 项后先将 \`status\` 改为 \`complete\`，再运行
\`pnpm quality:clean-packet -- --payload-hash\`，把输出的 approval payload hash 写入
comment 与 \`humanAttestation.approvalPayloadSha256\`。修改任何审批字段后必须重新生成
payload hash 和 comment；只修改 \`humanAttestation\` 不会改变 payload。

${sections.join("\n").trimEnd()}
`;
}

function serializeM3_278Artifacts(artifacts) {
  return {
    replacementManifest: `${JSON.stringify(artifacts.replacementManifest, null, 2)}\n`,
    candidateDataset: `${JSON.stringify(artifacts.candidateDataset, null, 2)}\n`,
    candidatePacket: `${JSON.stringify(artifacts.candidatePacket, null, 2)}\n`,
    approvalTemplate: `${JSON.stringify(artifacts.approvalTemplate, null, 2)}\n`,
    approvalRequest: artifacts.approvalRequest,
    status: `${JSON.stringify(artifacts.status, null, 2)}\n`,
  };
}

export function writeM3_278Artifacts(root, artifacts) {
  for (const [key, relativePath] of Object.entries(OUTPUT_FILES)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, artifacts.artifactContents[key], "utf8");
  }
}

function createCandidateDataset(sourceDataset, candidates) {
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.blindSampleId, candidate]),
  );
  const datasetSampleIds = new Set(candidates.map((candidate) => candidate.datasetSampleId));
  const adversarialCases = sourceDataset.adversarialCases.map((sample) => {
    if (!datasetSampleIds.has(sample.id)) return structuredClone(sample);
    const candidate = [...candidateById.values()].find(
      (entry) => entry.datasetSampleId === sample.id,
    );
    if (!candidate) throw new Error(`M3_278_CANDIDATE_MISSING:${sample.id}`);
    return {
      ...structuredClone(sample),
      text: candidate.text,
      requiredBeats: [...candidate.requiredBeats],
      sourceVersion: "quality-replacement-v1",
      sourceHash: sha256Json({
        sourceDatasetId: sample.id,
        originalSourceHash: sample.sourceHash,
        replacementText: candidate.text,
        requiredBeats: candidate.requiredBeats,
      }),
    };
  });
  const entries = sourceDataset.manifest.entries.map((entry) => {
    if (!datasetSampleIds.has(entry.id)) return structuredClone(entry);
    const candidate = [...candidateById.values()].find((item) => item.datasetSampleId === entry.id);
    const replacement = adversarialCases.find((sample) => sample.id === entry.id);
    if (!candidate || !replacement) throw new Error(`M3_278_MANIFEST_MAPPING_INVALID:${entry.id}`);
    return {
      ...structuredClone(entry),
      sourceVersion: replacement.sourceVersion,
      sourceHash: replacement.sourceHash,
      requiredBeats: [...replacement.requiredBeats],
    };
  });
  const manifestWithoutDigest = {
    ...structuredClone(sourceDataset.manifest),
    datasetVersion: CANDIDATE_DATASET_VERSION,
    entries,
  };
  delete manifestWithoutDigest.datasetSha256;
  const withoutDigest = {
    schemaVersion: sourceDataset.schemaVersion,
    chapterSamples: structuredClone(sourceDataset.chapterSamples),
    adversarialCases,
    manifest: manifestWithoutDigest,
  };
  return {
    ...withoutDigest,
    manifest: {
      ...manifestWithoutDigest,
      datasetSha256: sha256Text(JSON.stringify(withoutDigest)),
    },
  };
}

function createCandidatePacket({ key, dataset, source }) {
  const datasetById = new Map(
    [...dataset.chapterSamples, ...dataset.adversarialCases].map((sample) => [sample.id, sample]),
  );
  const samples = key.entries.map((entry) => {
    const sample = datasetById.get(entry.datasetSampleId);
    if (!sample) throw new Error(`M3_278_PACKET_MAPPING_MISSING:${entry.blindSampleId}`);
    return {
      blindSampleId: entry.blindSampleId,
      genre: sample.genre,
      text: sample.text,
      requiredBeats: [...sample.requiredBeats],
    };
  });
  const packetWithoutHash = {
    schemaVersion: 1,
    packetVersion: CANDIDATE_PACKET_VERSION,
    status: "candidate-not-approved",
    issue: ISSUE,
    source: {
      sourcePacketVersion: source.packet.packetVersion ?? "m3-239-quality-blind-review-v1",
      sourcePacketFileSha256: source.fileSha256.sourcePacket,
      sourcePacketCanonicalSha256: source.validation.reviewerPacketCanonicalSha256,
      sourceDatasetVersion: source.dataset.manifest.datasetVersion,
      sourceDatasetSha256: source.dataset.manifest.datasetSha256,
      candidateDatasetVersion: dataset.manifest.datasetVersion,
      candidateDatasetSha256: dataset.manifest.datasetSha256,
      rubricVersion: source.rubric.rubricVersion,
      rubricSha256: source.rubric.sha256,
    },
    reviewerReadiness: {
      status: "not-ready",
      cleanBlindReview: false,
      humanReplacementApprovalRequired: 24,
    },
    samples,
  };
  return {
    ...packetWithoutHash,
    packetSha256: sha256Json(packetWithoutHash),
  };
}

function readJson(root, relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));
}

function extractEstablishedFact(text) {
  const match = text.match(/与已确认事实“([^”]+)”冲突。/u);
  if (!match?.[1]) throw new Error("M3_278_ESTABLISHED_FACT_MISSING");
  return match[1];
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256Json(value) {
  return sha256Text(JSON.stringify(canonicalizeJson(value)));
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function omit(value, keys) {
  const result = structuredClone(value);
  for (const key of keys) delete result[key];
  return result;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasHumanInput(approvals) {
  return Boolean(
    approvals?.status === "complete" ||
    approvals?.approvals?.some((entry) =>
      ["decision", "rationale", "impact", "adjudicatorId", "attestationId"].some((field) =>
        hasText(entry?.[field]),
      ),
    ) ||
    approvals?.humanAttestation?.commentUrl,
  );
}

function isIsoTimestamp(value) {
  return parseStrictIsoTimestamp(value) !== null;
}

function parseStrictIsoTimestamp(value) {
  if (typeof value !== "string") return null;
  const match =
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<millisecond>\d{1,3}))?(?<offset>Z|[+-]\d{2}:\d{2})$/u.exec(
      value,
    );
  if (!match?.groups) return null;
  const year = Number(match.groups.year);
  const month = Number(match.groups.month);
  const day = Number(match.groups.day);
  const hour = Number(match.groups.hour);
  const minute = Number(match.groups.minute);
  const second = Number(match.groups.second);
  const millisecond = Number((match.groups.millisecond ?? "").padEnd(3, "0"));
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const localDate = new Date(localAsUtc);
  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hour ||
    localDate.getUTCMinutes() !== minute ||
    localDate.getUTCSeconds() !== second ||
    localDate.getUTCMilliseconds() !== millisecond
  ) {
    return null;
  }
  const offset = match.groups.offset;
  const offsetMinutes =
    offset === "Z"
      ? 0
      : (offset.startsWith("-") ? -1 : 1) *
        (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
  const timestamp = localAsUtc - offsetMinutes * 60_000;
  return timestamp === Date.parse(value) ? timestamp : null;
}

function isDecisionFresh(decidedAt, attestedAt) {
  const decided = parseStrictIsoTimestamp(decidedAt);
  const attested = parseStrictIsoTimestamp(attestedAt);
  return (
    decided !== null &&
    attested !== null &&
    decided <= attested + 60_000 &&
    attested - decided <= APPROVAL_DECISION_WINDOW_MS
  );
}

function isCompleteHumanApprovalAttestation(
  value,
  candidatePacketSha256,
  replacementManifestSha256,
  approvalPayloadSha256,
) {
  return Boolean(
    value?.provider === "github_issue_comment" &&
    value.issue === ISSUE &&
    value.requiredMarker === "M3-278-HUMAN-APPROVAL" &&
    value.candidatePacketSha256 === candidatePacketSha256 &&
    value.replacementManifestSha256 === replacementManifestSha256 &&
    value.approvalPayloadSha256 === approvalPayloadSha256 &&
    new RegExp(
      `^https://github\\.com/${EXPECTED_GITHUB_REPOSITORY}/issues/${ISSUE}#issuecomment-\\d+$`,
      "u",
    ).test(value.commentUrl ?? "") &&
    /^\d+$/u.test(value.commentId ?? "") &&
    value.commentUrl.endsWith(`#issuecomment-${value.commentId}`) &&
    value.author === EXPECTED_PRODUCT_QUALITY_OWNER &&
    isIsoTimestamp(value.attestedAt) &&
    hasText(value.statement) &&
    value.statement.includes("M3-278-HUMAN-APPROVAL") &&
    value.statement.includes(candidatePacketSha256) &&
    value.statement.includes(replacementManifestSha256) &&
    value.statement.includes(approvalPayloadSha256),
  );
}

export function verifyM3_278GithubApprovalAttestation(
  attestation,
  { githubApi = queryGithubApi } = {},
) {
  if (
    attestation?.provider !== "github_issue_comment" ||
    attestation.issue !== ISSUE ||
    attestation.requiredMarker !== "M3-278-HUMAN-APPROVAL" ||
    !/^[a-f0-9]{64}$/u.test(attestation.approvalPayloadSha256 ?? "") ||
    !/^\d+$/u.test(attestation.commentId ?? "") ||
    attestation.commentUrl !==
      `https://github.com/${EXPECTED_GITHUB_REPOSITORY}/issues/${ISSUE}#issuecomment-${attestation.commentId}`
  ) {
    return false;
  }
  try {
    const comment = githubApi(
      `repos/${EXPECTED_GITHUB_REPOSITORY}/issues/comments/${attestation.commentId}`,
      "{body: .body, issueUrl: .issue_url, author: .user.login, authorAssociation: .author_association, createdAt: .created_at}",
    );
    const attestedAt = parseStrictIsoTimestamp(attestation.attestedAt);
    const createdAt = parseStrictIsoTimestamp(comment.createdAt);
    return (
      comment.author === EXPECTED_PRODUCT_QUALITY_OWNER &&
      comment.authorAssociation === "OWNER" &&
      comment.issueUrl?.endsWith(`/repos/${EXPECTED_GITHUB_REPOSITORY}/issues/${ISSUE}`) &&
      attestedAt !== null &&
      createdAt !== null &&
      Math.abs(attestedAt - createdAt) <= 60_000 &&
      comment.body?.trim() === attestation.statement?.trim() &&
      comment.body?.includes(attestation.approvalPayloadSha256)
    );
  } catch {
    return false;
  }
}

function queryGithubApi(pathname, jq) {
  const output = execFileSync("gh", ["api", pathname, "--jq", jq], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 15_000,
  });
  return JSON.parse(output);
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  if (process.argv.includes("--payload-hash")) {
    const approvalPath = path.join(root, APPROVALS_FILE);
    if (!existsSync(approvalPath)) {
      process.stderr.write("M3_278_APPROVALS_FILE_MISSING\n");
      process.exitCode = 1;
      return;
    }
    const approvals = readJson(root, APPROVALS_FILE);
    process.stdout.write(
      `${JSON.stringify(
        {
          candidatePacketSha256: approvals.candidatePacketSha256,
          replacementManifestSha256: approvals.replacementManifestSha256,
          approvalPayloadSha256: computeM3_278ApprovalPayloadSha256(approvals),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const checkOnly = process.argv.includes("--check");
  const artifacts = await buildM3_278Artifacts({ root });
  if (!checkOnly) {
    writeM3_278Artifacts(root, artifacts);
  }
  const stalePaths = checkOnly ? artifacts.artifactFreshness.stalePaths : [];
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: checkOnly ? "check" : "write",
        issue: ISSUE,
        status: artifacts.status.status,
        approvedCount: artifacts.status.approvedCount,
        pendingCount: artifacts.status.pendingCount,
        freezeAllowed: artifacts.status.freezeAllowed,
        candidateDatasetSha256: artifacts.status.candidateDatasetSha256,
        candidatePacketSha256: artifacts.status.candidatePacketSha256,
        replacementManifestSha256: artifacts.status.replacementManifestSha256,
        stalePaths,
      },
      null,
      2,
    )}\n`,
  );
  if (stalePaths.length > 0) process.exitCode = 1;
}

runCli(import.meta.url, process.argv[1], main);
