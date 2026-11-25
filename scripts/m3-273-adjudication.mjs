import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runCli } from "./cli-entry.mjs";

const ISSUE = 273;
const REVIEW_ID = "m3-239-2026-11-25";
const PROPOSED_AT = "2026-11-26";
const PROPOSAL_VERSION = "quality-benchmark-clean-blind-proposal-v2";
const PACKET_VERSION = "quality-benchmark-human-review-v1";
const HUMAN_ATTESTATION_MARKER = "M3-273-HUMAN-ATTESTATION";
const PACKET_DECISIONS = new Set([
  "refreeze_clean_packet",
  "replace_affected_samples",
  "preserve_with_product_owner_approval",
]);
const SAMPLE_DECISIONS = new Set([
  "accept_clean_proposal",
  "replace_sample",
  "preserve_source_with_product_owner_approval",
]);
const HOOK_PROSE_DECISIONS = new Set(["remediate_and_rerun", "approve_waiver"]);
const OLD_SCORE_IMPACTS = new Set([
  "invalidated_for_clean_review",
  "retained_as_warning_only",
  "approved_preserve",
]);
const ORACLE_MARKERS = [
  {
    code: "explicit-confirmed-fact-conflict",
    pattern: /与已确认事实“[^”]+”冲突。/u,
  },
  {
    code: "continuity-evidence-marker",
    pattern: /【连续性证据】/u,
  },
  {
    code: "seeded-defect-marker",
    pattern: /\bseeded defect\b/iu,
  },
];
const EXPLICIT_CONFIRMED_FACT_CONFLICT = /\s*与已确认事实“[^”]+”冲突。\s*$/u;
const EVIDENCE_DIR = "docs/quality/evidence/m3-273";
const OUTPUT_FILES = {
  proposalPacket: `${EVIDENCE_DIR}/reviewer-packet-v2.proposal.json`,
  cleanupEvidence: `${EVIDENCE_DIR}/oracle-cleanup-evidence.json`,
  adjudicationTemplate: `${EVIDENCE_DIR}/adjudication.template.json`,
  decisionRequest: `${EVIDENCE_DIR}/decision-request.md`,
  status: `${EVIDENCE_DIR}/status.json`,
};

export function scanOracleContent(text) {
  const markers = ORACLE_MARKERS.filter(({ pattern }) => pattern.test(text)).map(
    ({ code }) => code,
  );
  return {
    contaminated: markers.length > 0,
    markers,
  };
}

export function sampleExposesOracleContent(sample) {
  return (
    scanOracleContent(sample.text).contaminated ||
    sample.requiredBeats.some((beat) => scanOracleContent(beat).contaminated)
  );
}

export function computeM3_273DecisionPayloadSha256(adjudication) {
  const payload = structuredClone(adjudication);
  delete payload.humanAttestation;
  return sha256Json(payload);
}

export function sanitizeBlindReviewText(text) {
  return text.replace(EXPLICIT_CONFIRMED_FACT_CONFLICT, "").trimEnd();
}

export function buildM3_273Artifacts({ root, adjudicationOverride }) {
  const source = readSource(root);
  verifySourceIntegrity({ root, source });
  const contaminatedSampleIds = source.packet.samples
    .filter(sampleExposesOracleContent)
    .map((sample) => sample.blindSampleId)
    .sort(compareStrings);
  const declaredContaminatedSampleIds = [
    ...source.validation.privacyScan.defectMetadataTextSampleIds,
  ].sort(compareStrings);
  if (!sameStrings(contaminatedSampleIds, declaredContaminatedSampleIds)) {
    throw new Error("M3_273_ORACLE_SCAN_DRIFT");
  }
  if (contaminatedSampleIds.length !== 24) {
    throw new Error(`M3_273_ORACLE_COUNT_INVALID:${contaminatedSampleIds.length}`);
  }

  const keyByBlindSampleId = new Map(
    source.key.entries.map((entry) => [entry.blindSampleId, entry.datasetSampleId]),
  );
  const transforms = [];
  const proposedSamples = source.packet.samples.map((sample) => {
    const datasetSampleId = keyByBlindSampleId.get(sample.blindSampleId);
    if (!datasetSampleId) {
      throw new Error(`M3_273_KEY_MAPPING_MISSING:${sample.blindSampleId}`);
    }
    if (!sampleExposesOracleContent(sample)) {
      return structuredClone(sample);
    }
    const markers = [
      ...new Set([
        ...scanOracleContent(sample.text).markers,
        ...sample.requiredBeats.flatMap((beat) => scanOracleContent(beat).markers),
      ]),
    ];
    const text = sanitizeBlindReviewText(sample.text);
    const requiredBeats = sample.requiredBeats.map((beat) => sanitizeBlindReviewText(beat));
    const remaining = scanOracleContent(`${text}\n${requiredBeats.join("\n")}`);
    if (remaining.contaminated) {
      throw new Error(
        `M3_273_ORACLE_CONTENT_NOT_CLEANABLE:${sample.blindSampleId}:${remaining.markers.join(",")}`,
      );
    }
    transforms.push({
      blindSampleId: sample.blindSampleId,
      datasetSampleId,
      transform: "strip-explicit-oracle-annotation-v1",
      sourceMarkers: markers,
      originalTextSha256: sha256Text(sample.text),
      cleanedTextSha256: sha256Text(text),
      allSamplesRetained: true,
    });
    return {
      ...structuredClone(sample),
      text,
      requiredBeats,
    };
  });

  const proposalWithoutHash = {
    schemaVersion: 1,
    packetVersion: PROPOSAL_VERSION,
    status: "proposed-not-approved",
    proposedAt: PROPOSED_AT,
    issue: ISSUE,
    instructions: [
      "该候选包仅供负责人审查，尚未冻结，也不得直接用于最终发布声明。",
      "评审人只能看到样本文本、题材和必需节拍；不得查看 oracle、模型身份或生成状态。",
      "批准候选包前必须完成 24 个样本裁决并明确旧评分是否失效。",
    ],
    source: {
      sourcePacketVersion: source.packet.packetVersion ?? PACKET_VERSION,
      sourcePacketFileSha256: source.validation.reviewerPacketFileSha256,
      sourcePacketCanonicalSha256: source.validation.reviewerPacketCanonicalSha256,
      datasetVersion: source.packet.source.datasetVersion,
      datasetSha256: source.packet.source.datasetSha256,
      rubricVersion: source.packet.source.rubricVersion,
      rubricSha256: source.packet.source.rubricSha256,
      sourceContaminatedSampleCount: contaminatedSampleIds.length,
    },
    reviewerReadiness: {
      status: "not-ready",
      cleanBlindReview: false,
      semanticOracleReviewRequired: true,
      caveat:
        "This proposal only removes the detected explicit oracle annotation. The adversarial event text and required beats still require a human packet decision; this is not a semantic clean-packet approval.",
    },
    samples: proposedSamples,
  };
  const proposalPacket = {
    ...proposalWithoutHash,
    proposalSha256: sha256Json(proposalWithoutHash),
  };
  const cleanupEvidence = {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    proposalPacketSha256: proposalPacket.proposalSha256,
    sourcePacketFileSha256: source.validation.reviewerPacketFileSha256,
    sourcePacketCanonicalSha256: source.validation.reviewerPacketCanonicalSha256,
    sourceContaminatedSampleIds: contaminatedSampleIds,
    sampleCountBefore: source.packet.samples.length,
    sampleCountAfter: proposedSamples.length,
    samplesDeleted: 0,
    semanticOracleReviewRequired: true,
    transforms,
  };
  const adjudicationTemplate = createAdjudicationTemplate({
    source,
    proposalPacket,
    pendingSampleIds: contaminatedSampleIds,
    keyByBlindSampleId,
  });
  const artifactsBase = {
    proposalPacket,
    cleanupEvidence,
    adjudicationTemplate,
  };
  const adjudicationPath = path.join(root, EVIDENCE_DIR, "adjudication.json");
  const decisionFilePresent = existsSync(adjudicationPath);
  const adjudication =
    adjudicationOverride ??
    (decisionFilePresent ? readJson(adjudicationPath) : adjudicationTemplate);
  const status = {
    ...evaluateM3_273Adjudication({
      artifacts: artifactsBase,
      adjudication,
    }),
    decisionFileStatus: adjudicationOverride
      ? "provided"
      : decisionFilePresent
        ? "present"
        : "missing",
    decisionFilePath: `${EVIDENCE_DIR}/adjudication.json`,
  };
  const decisionRequest = buildDecisionRequest({
    proposalPacket,
    pendingSampleIds: contaminatedSampleIds,
    keyByBlindSampleId,
  });
  const artifacts = {
    ...artifactsBase,
    decisionRequest,
    status,
  };
  const contents = serializeArtifacts(artifacts);
  const stalePaths = Object.entries(OUTPUT_FILES)
    .filter(([key, relativePath]) => {
      const absolutePath = path.join(root, relativePath);
      return !existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== contents[key];
    })
    .map(([, relativePath]) => relativePath);
  return {
    ...artifacts,
    artifactContents: contents,
    artifactFreshness: {
      status: stalePaths.length === 0 ? "passed" : "stale",
      stalePaths,
    },
  };
}

export function evaluateM3_273Adjudication({ artifacts, adjudication }) {
  const expectedIds = [...artifacts.cleanupEvidence.sourceContaminatedSampleIds].sort(
    compareStrings,
  );
  const expectedIdSet = new Set(expectedIds);
  const expectedEntries = new Map(
    artifacts.adjudicationTemplate.adjudications.map((entry) => [entry.blindSampleId, entry]),
  );
  const blockers = [];
  const entries = Array.isArray(adjudication?.adjudications) ? adjudication.adjudications : [];
  const hasHumanInput =
    entries.some(
      (entry) =>
        hasText(entry?.decision) ||
        hasText(entry?.rationale) ||
        hasText(entry?.adjudicatorId) ||
        isIsoTimestamp(entry?.decidedAt),
    ) ||
    hasText(adjudication?.packetDecision?.decision) ||
    hasText(adjudication?.hookProseDisposition?.decision);
  if (adjudication?.schemaVersion !== 1) {
    blockers.push("adjudication-schema-invalid");
  }
  if (adjudication?.issue !== ISSUE) {
    blockers.push("adjudication-issue-mismatch");
  }
  if (adjudication?.reviewId !== REVIEW_ID) {
    blockers.push("adjudication-review-id-mismatch");
  }
  if (adjudication?.proposalPacketSha256 !== artifacts.proposalPacket.proposalSha256) {
    blockers.push("adjudication-proposal-mismatch");
  }
  if (adjudication?.status !== "complete" && hasHumanInput) {
    blockers.push("adjudication-status-pending");
  }

  const duplicateIds = entries
    .map((entry) => entry?.blindSampleId)
    .filter((blindSampleId, index, values) => values.indexOf(blindSampleId) !== index);
  if (duplicateIds.length > 0) {
    blockers.push(`adjudication-duplicate:${duplicateIds.length}`);
  }
  const unknownIds = entries
    .map((entry) => entry?.blindSampleId)
    .filter((blindSampleId) => !expectedIdSet.has(blindSampleId));
  if (unknownIds.length > 0) {
    blockers.push(`adjudication-unknown-sample:${unknownIds.length}`);
  }

  let nonHumanCount = 0;
  let incompleteCount = 0;
  let evidenceDriftCount = 0;
  const completedIds = [];
  for (const entry of entries) {
    if (
      !expectedIdSet.has(entry?.blindSampleId) ||
      !hasText(entry?.decision) ||
      !SAMPLE_DECISIONS.has(entry.decision)
    ) {
      continue;
    }
    const expectedEntry = expectedEntries.get(entry.blindSampleId);
    if (
      !expectedEntry ||
      entry.datasetSampleId !== expectedEntry.datasetSampleId ||
      entry.originalTextSha256 !== expectedEntry.originalTextSha256 ||
      entry.proposedTextSha256 !== expectedEntry.proposedTextSha256 ||
      entry.requiredBeatsSha256 !== expectedEntry.requiredBeatsSha256
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
      !isIsoTimestamp(entry.decidedAt)
    ) {
      incompleteCount += 1;
      continue;
    }
    completedIds.push(entry.blindSampleId);
  }
  if (nonHumanCount > 0) {
    blockers.push(`adjudication-non-human:${nonHumanCount}`);
  }
  if (incompleteCount > 0) {
    blockers.push(`adjudication-incomplete:${incompleteCount}`);
  }
  if (evidenceDriftCount > 0) {
    blockers.push(`adjudication-sample-evidence-drift:${evidenceDriftCount}`);
  }
  const completedSet = new Set(completedIds);
  const unresolvedSampleIds = expectedIds.filter((sampleId) => !completedSet.has(sampleId));
  if (unresolvedSampleIds.length > 0) {
    blockers.push(`adjudication-pending:${unresolvedSampleIds.length}`);
  }

  const packetDecision = adjudication?.packetDecision;
  const oldScoresImpactValid = OLD_SCORE_IMPACTS.has(packetDecision?.oldScoresImpact);
  let packetDecisionComplete =
    isCompleteOwnerDecision(packetDecision, PACKET_DECISIONS) && oldScoresImpactValid;
  if (!hasText(packetDecision?.decision)) {
    blockers.push(`oracle-content-disposition-pending:${expectedIds.length}`);
  } else if (!packetDecisionComplete) {
    blockers.push("oracle-content-disposition-incomplete");
  }
  if (hasText(packetDecision?.decision)) {
    if (!hasText(packetDecision.oldScoresImpact)) {
      blockers.push("packet-decision-old-score-impact-missing");
    } else if (!oldScoresImpactValid) {
      blockers.push("packet-decision-old-score-impact-invalid");
    }
  }
  if (packetDecisionComplete) {
    const completedIdSet = new Set(completedIds);
    const sampleDecisions = entries
      .filter((entry) => completedIdSet.has(entry.blindSampleId))
      .map((entry) => entry.decision);
    const expectedSampleDecision =
      packetDecision.decision === "refreeze_clean_packet"
        ? "accept_clean_proposal"
        : packetDecision.decision === "replace_affected_samples"
          ? "replace_sample"
          : "preserve_source_with_product_owner_approval";
    const mismatch = sampleDecisions.some((decision) => decision !== expectedSampleDecision);
    if (mismatch) {
      blockers.push("packet-decision-sample-disposition-mismatch");
      packetDecisionComplete = false;
    }
    if (
      packetDecision.decision === "refreeze_clean_packet" ||
      packetDecision.decision === "replace_affected_samples"
    ) {
      blockers.push("clean-blind-review-required");
    }
  }

  const hookDecision = adjudication?.hookProseDisposition;
  const hookDecisionComplete = isCompleteHookDecision(hookDecision);
  let hookProseDispositionComplete = false;
  if (!hasText(hookDecision?.decision)) {
    blockers.push("hook-prose-disposition-pending");
  } else if (!hookDecisionComplete) {
    blockers.push("hook-prose-disposition-incomplete");
  } else if (hookDecision.decision === "remediate_and_rerun") {
    if (!hasText(hookDecision.followUpIssue)) {
      blockers.push("hook-prose-follow-up-missing");
    } else {
      blockers.push("hook-prose-remeasurement-pending");
    }
  } else {
    if (!hasText(hookDecision.followUpIssue) || !isIsoTimestamp(hookDecision.expiresAt)) {
      blockers.push("hook-prose-waiver-incomplete");
    } else if (
      Date.parse(hookDecision.expiresAt) <= Date.parse(hookDecision.decidedAt) ||
      Date.parse(hookDecision.expiresAt) <= Date.now()
    ) {
      blockers.push("hook-prose-waiver-expired");
    } else {
      hookProseDispositionComplete = true;
    }
  }

  const decisionPayloadSha256 = computeM3_273DecisionPayloadSha256(adjudication);
  const humanAttestationComplete = isCompleteHumanAttestation(
    adjudication?.humanAttestation,
    artifacts.proposalPacket.proposalSha256,
    decisionPayloadSha256,
  );
  if (!humanAttestationComplete) {
    blockers.push(
      hasAnyHumanAttestationInput(adjudication?.humanAttestation)
        ? "human-attestation-incomplete"
        : "human-attestation-pending",
    );
  }
  const humanAdjudicationCompleted =
    adjudication?.status === "complete" &&
    unresolvedSampleIds.length === 0 &&
    nonHumanCount === 0 &&
    incompleteCount === 0 &&
    evidenceDriftCount === 0 &&
    humanAttestationComplete;
  const qualityBlockers = [...new Set(blockers)].sort(compareStrings);
  const status = {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    generatedAt: PROPOSED_AT,
    technicalStatus: qualityBlockers.every(isPendingQualityBlocker) ? "passed" : "blocked",
    humanAdjudicationCompleted,
    completedAdjudicationCount: completedIds.length,
    pendingAdjudicationCount: unresolvedSampleIds.length,
    pendingSampleIds: unresolvedSampleIds,
    decisionPayloadSha256,
    proposalPacketSha256: artifacts.proposalPacket.proposalSha256,
    cleanPacketProposed: true,
    reviewerReady: false,
    cleanPacketApproved:
      packetDecisionComplete && packetDecision.decision === "refreeze_clean_packet",
    oracleContentDisposition: packetDecisionComplete
      ? {
          decision: packetDecision.decision,
          oldScoresImpact: packetDecision.oldScoresImpact,
        }
      : null,
    hookProseDispositionComplete,
    hookProseDisposition:
      hookDecisionComplete && hookDecision.decision === "approve_waiver"
        ? {
            decision: hookDecision.decision,
            owner: hookDecision.owner,
            expiresAt: hookDecision.expiresAt,
          }
        : null,
    packetDispositionComplete: packetDecisionComplete,
    humanAttestation: humanAttestationComplete
      ? {
          provider: adjudication.humanAttestation.provider,
          issue: adjudication.humanAttestation.issue,
          requiredMarker: adjudication.humanAttestation.requiredMarker,
          proposalSha256: adjudication.humanAttestation.proposalSha256,
          decisionPayloadSha256: adjudication.humanAttestation.decisionPayloadSha256,
          commentUrl: adjudication.humanAttestation.commentUrl,
          commentId: adjudication.humanAttestation.commentId,
          author: adjudication.humanAttestation.author,
          attestedAt: adjudication.humanAttestation.attestedAt,
          statement: adjudication.humanAttestation.statement,
        }
      : null,
    qualityGate: {
      status: qualityBlockers.length === 0 ? "pass" : "blocked",
      blockers: qualityBlockers,
    },
    separateDecisions: [
      {
        id: "interRaterVarianceThreshold",
        owner: "#240",
        status: "outside-this-issue",
        mayBeApprovedByThisIssue: false,
        releaseGateRequiresIndependentApproval: true,
      },
    ],
  };
  return status;
}

export function writeM3_273Artifacts(root, artifacts, contentOverrides = {}) {
  const contents = {
    ...serializeArtifacts(artifacts),
    ...contentOverrides,
  };
  for (const [key, relativePath] of Object.entries(OUTPUT_FILES)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, contents[key], "utf8");
  }
}

function readSource(root) {
  return {
    packet: readJson(path.join(root, "docs/quality/evidence/m3-239/packet.json")),
    key: readJson(path.join(root, "docs/quality/evidence/m3-239/key.json")),
    validation: readJson(path.join(root, "docs/quality/evidence/m3-239/validation.json")),
    dataset: readJson(path.join(root, "docs/quality/quality-benchmark-v1.dataset.json")),
    rubric: readJson(path.join(root, "docs/quality/quality-benchmark-v1.rubric.json")),
  };
}

function verifySourceIntegrity({ root, source }) {
  const packetPath = path.join(root, "docs/quality/evidence/m3-239/packet.json");
  const keyPath = path.join(root, "docs/quality/evidence/m3-239/key.json");
  const datasetPath = path.join(root, "docs/quality/quality-benchmark-v1.dataset.json");
  const rubricPath = path.join(root, "docs/quality/quality-benchmark-v1.rubric.json");
  if (
    sha256File(packetPath) !== source.validation.reviewerPacketFileSha256 ||
    sha256File(packetPath) !== source.validation.sourcePacket.sha256 ||
    sha256File(keyPath) !== source.validation.sourceKey.sha256 ||
    sha256File(datasetPath) !== source.validation.sourceDataset.sha256 ||
    sha256File(rubricPath) !== source.validation.sourceRubric.sha256 ||
    sha256Json(source.packet.samples) !== source.validation.reviewerPacketCanonicalSha256 ||
    source.packet.source.datasetSha256 !== source.dataset.manifest.datasetSha256 ||
    source.packet.source.rubricSha256 !== source.rubric.sha256
  ) {
    throw new Error("M3_273_SOURCE_DIGEST_MISMATCH");
  }
}

function createAdjudicationTemplate(input) {
  const originalSamples = new Map(
    input.source.packet.samples.map((sample) => [sample.blindSampleId, sample]),
  );
  return {
    schemaVersion: 1,
    issue: ISSUE,
    reviewId: REVIEW_ID,
    status: "awaiting-human-input",
    proposalPacketSha256: input.proposalPacket.proposalSha256,
    instructions: [
      "只能由真实产品/质量负责人在完成审查后填写。",
      "不得由模型补写、推断或伪造裁决、时间、身份和影响。",
      "不得通过修改冻结 rubric、原始评分或删除失败样本来解除门禁。",
      "本文件不批准 inter-rater variance threshold；该决定仍归 #240。",
    ],
    humanAttestation: {
      provider: "github_issue_comment",
      issue: ISSUE,
      requiredMarker: HUMAN_ATTESTATION_MARKER,
      proposalSha256: input.proposalPacket.proposalSha256,
      decisionPayloadSha256: null,
      commentUrl: null,
      commentId: null,
      author: null,
      attestedAt: null,
      statement: null,
    },
    packetDecision: {
      decision: null,
      oldScoresImpact: null,
      adjudicatorId: null,
      adjudicatorKind: null,
      attestationId: null,
      rationale: null,
      decidedAt: null,
    },
    adjudications: input.pendingSampleIds.map((blindSampleId) => ({
      blindSampleId,
      datasetSampleId: input.keyByBlindSampleId.get(blindSampleId),
      originalTextSha256: sha256Text(originalSamples.get(blindSampleId).text),
      proposedTextSha256: sha256Text(
        input.proposalPacket.samples.find((sample) => sample.blindSampleId === blindSampleId).text,
      ),
      requiredBeatsSha256: sha256Json(
        input.proposalPacket.samples.find((sample) => sample.blindSampleId === blindSampleId)
          .requiredBeats,
      ),
      decision: null,
      rationale: null,
      impact: null,
      adjudicatorId: null,
      adjudicatorKind: null,
      attestationId: null,
      decidedAt: null,
    })),
    hookProseDisposition: {
      metric: "hook_prose_score",
      observedValue: 1.882353,
      threshold: 4,
      decision: null,
      owner: null,
      rationale: null,
      impact: null,
      followUpIssue: null,
      expiresAt: null,
      decidedAt: null,
    },
  };
}

function buildDecisionRequest(input) {
  const proposedById = new Map(
    input.proposalPacket.samples.map((sample) => [sample.blindSampleId, sample]),
  );
  const rows = input.pendingSampleIds.flatMap((blindSampleId) => {
    const proposed = proposedById.get(blindSampleId);
    return [
      `### ${blindSampleId}`,
      "",
      `- Dataset sample: \`${input.keyByBlindSampleId.get(blindSampleId)}\``,
      `- Proposed cleanup hash: \`${sha256Text(proposed.text)}\``,
      `- Required beats hash: \`${sha256Json(proposed.requiredBeats)}\``,
      "",
      "候选无 oracle 注入文本：",
      "",
      `> ${proposed.text}`,
      "",
      `- Required beats: ${proposed.requiredBeats.map((beat) => `\`${beat}\``).join("、")}`,
      "",
      "待负责人填写：`decision`、`rationale`、`impact`、`adjudicatorId`、`adjudicatorKind`、`attestationId`、`decidedAt`。",
      "",
    ];
  });
  return (
    `# M3-273 人类裁决请求

> Owner-only decision package. Do not send this request or the oracle cleanup evidence to blind reviewers.

Issue: #273

冻结 rubric、816 条原始评分和旧 packet 均不得改写。候选 packet 只是未批准的清洗提案。

## 全局处置

- Packet decision: \`refreeze_clean_packet\`、\`replace_affected_samples\` 或 \`preserve_with_product_owner_approval\`。
- Old-score impact: 明确旧 816 条评分是失效、只保留为警告证据，还是经批准保留。
- Oracle cleanup: 必须保留全部 204 个样本身份；当前提案只移除 24 条文本末尾的显式事实对照注释。
- Threshold boundary: 不得在本文件中批准 inter-rater variance threshold；#240 保持独立。

## 外部真人声明

负责人必须先在本仓库 Issue #273 发布分别签名的 GitHub comment，正文包含
\`${HUMAN_ATTESTATION_MARKER}\`、候选包哈希 \`${input.proposalPacket.proposalSha256}\`
和最终裁决载荷哈希。先完成全部裁决字段，再运行
\`node scripts/m3-273-adjudication.mjs --payload-hash\` 获取载荷哈希并写入评论及
\`humanAttestation.decisionPayloadSha256\`，最后填写评论 URL、编号、作者、时间和原声明。
发布门禁会通过 GitHub API 核对 Issue 编号、评论作者关联、评论时间和正文标记；只填写
\`adjudicatorKind: "human"\` 不能满足真人证据要求。

## Hook/prose 处置

- Observed: \`hook_prose_score = 1.882353\`
- Frozen threshold: \`>= 4\`
- Choices: \`remediate_and_rerun\` 或 \`approve_waiver\`。
- Waiver 必须包含 owner、rationale、impact、follow-up issue 和 expiry。

## 24 个样本

${rows.join("\n").trimEnd()}
`.trimEnd() + "\n"
  );
}

function serializeArtifacts(artifacts) {
  return {
    proposalPacket: `${JSON.stringify(artifacts.proposalPacket, null, 2)}\n`,
    cleanupEvidence: `${JSON.stringify(artifacts.cleanupEvidence, null, 2)}\n`,
    adjudicationTemplate: `${JSON.stringify(artifacts.adjudicationTemplate, null, 2)}\n`,
    decisionRequest: artifacts.decisionRequest,
    status: `${JSON.stringify(artifacts.status, null, 2)}\n`,
  };
}

function isCompleteOwnerDecision(value, allowedDecisions) {
  return Boolean(
    value &&
    hasText(value.decision) &&
    allowedDecisions.has(value.decision) &&
    hasText(value.adjudicatorId) &&
    value.adjudicatorKind === "human" &&
    hasText(value.attestationId) &&
    hasText(value.rationale) &&
    hasText(value.oldScoresImpact) &&
    isIsoTimestamp(value.decidedAt),
  );
}

function isCompleteHookDecision(value) {
  return Boolean(
    value &&
    hasText(value.decision) &&
    HOOK_PROSE_DECISIONS.has(value.decision) &&
    hasText(value.owner) &&
    hasText(value.rationale) &&
    hasText(value.impact) &&
    isIsoTimestamp(value.decidedAt),
  );
}

function isCompleteHumanAttestation(value, proposalSha256, decisionPayloadSha256) {
  return Boolean(
    value?.provider === "github_issue_comment" &&
    value.issue === ISSUE &&
    value.requiredMarker === HUMAN_ATTESTATION_MARKER &&
    value.proposalSha256 === proposalSha256 &&
    value.decisionPayloadSha256 === decisionPayloadSha256 &&
    /^https:\/\/github\.com\/ruifeng-y\/novel-brain\/issues\/273#issuecomment-\d+$/u.test(
      value.commentUrl ?? "",
    ) &&
    /^\d+$/u.test(value.commentId ?? "") &&
    value.commentUrl.endsWith(`#issuecomment-${value.commentId}`) &&
    hasText(value.author) &&
    isIsoTimestamp(value.attestedAt) &&
    hasText(value.statement) &&
    value.statement.includes(HUMAN_ATTESTATION_MARKER) &&
    value.statement.includes(proposalSha256) &&
    value.statement.includes(decisionPayloadSha256),
  );
}

function hasAnyHumanAttestationInput(value) {
  return Boolean(
    value &&
    ["commentUrl", "commentId", "author", "attestedAt", "statement"].some((field) =>
      hasText(value[field]),
    ),
  );
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function sha256Json(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeJson(value)))
    .digest("hex");
}

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIsoTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPendingQualityBlocker(blocker) {
  return (
    /^adjudication-pending:\d+$/u.test(blocker) ||
    /^oracle-content-disposition-pending:\d+$/u.test(blocker) ||
    blocker === "hook-prose-disposition-pending" ||
    blocker === "hook-prose-remeasurement-pending" ||
    blocker === "clean-blind-review-required" ||
    blocker === "human-attestation-pending"
  );
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  if (process.argv.includes("--payload-hash")) {
    const adjudicationPath = path.join(root, EVIDENCE_DIR, "adjudication.json");
    if (!existsSync(adjudicationPath)) {
      process.stderr.write("M3_273_ADJUDICATION_FILE_MISSING\n");
      process.exitCode = 1;
      return;
    }
    const adjudication = readJson(adjudicationPath);
    process.stdout.write(
      `${JSON.stringify(
        {
          proposalPacketSha256: adjudication.proposalPacketSha256,
          decisionPayloadSha256: computeM3_273DecisionPayloadSha256(adjudication),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const checkOnly = process.argv.includes("--check");
  const artifacts = await buildM3_273Artifacts({ root });
  if (!checkOnly) {
    writeM3_273Artifacts(root, artifacts);
  }
  const stalePaths = checkOnly ? artifacts.artifactFreshness.stalePaths : [];
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: checkOnly ? "check" : "write",
        issue: ISSUE,
        status: artifacts.status.qualityGate.status,
        humanAdjudicationCompleted: artifacts.status.humanAdjudicationCompleted,
        completedAdjudicationCount: artifacts.status.completedAdjudicationCount,
        pendingAdjudicationCount: artifacts.status.pendingAdjudicationCount,
        qualityGate: artifacts.status.qualityGate,
        stalePaths,
      },
      null,
      2,
    )}\n`,
  );
  if (stalePaths.length > 0) {
    process.exitCode = 1;
  }
}

runCli(import.meta.url, process.argv[1], main);
