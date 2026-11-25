import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

import { runCli } from "./cli-entry.mjs";
import { buildM3_273Artifacts } from "./m3-273-adjudication.mjs";
import {
  CURRENT_HEAD_CI_WORKFLOWS,
  validateNonUiCapabilityEvidence,
  validateUiCapabilityEvidence,
} from "./v1-capability-evidence.mjs";
import {
  GOLDEN_VIEWPORTS,
  PRODUCTION_PAGE_IDS,
  STATIC_PRODUCTION_PAGE_IDS,
  expandGoldenPaths,
  isValidGoldenImage,
  normalizeRepositoryPath,
  parseTraceabilityRows,
  parseUiMatrix,
} from "./v1-ledger.mjs";

export const REQUIRED_GATE_IDS = [
  "capability-ledger",
  "ui-parity",
  "security-lifecycle",
  "deployment-observability",
  "backup-restore",
  "export-publish-moderation",
  "deterministic-quality",
  "final-production-ci",
  "real-provider-smoke",
  "human-blind-review",
];

const REQUIRED_GATES = new Set(REQUIRED_GATE_IDS);
const GATE_STATUSES = new Set(["pass", "blocked", "failed", "deferred"]);
const GITHUB_ACTIONS_RUN_URL = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)$/u;
const GITHUB_ISSUE_REFERENCE = /^#(\d+)$/u;
const EXPECTED_GITHUB_REPOSITORY = "ruifeng-y/novel-brain";
const BOUNDED_GAP_LABELS = new Set(["ready-for-agent", "ready-for-human"]);
const AUTHORIZED_DEFERRAL_IDS = new Set(["PERF-001", "AGENT-007", "QUALITY-009"]);
const DEVIATION_DOCUMENTS = [
  "docs/ui/prototype-contract.md",
  "docs/ui/v1-ui-parity-matrix.md",
  "docs/ui/v1-prototype-signoff.md",
];

function normalizeReleaseReference(reference) {
  if (typeof reference === "string" && GITHUB_ACTIONS_RUN_URL.test(reference)) return reference;
  return normalizeRepositoryPath(reference);
}

function canonicalRepositoryPath(reference) {
  return normalizeReleaseReference(reference)?.toLowerCase() ?? null;
}

function isReproducibleReference(
  reference,
  { evidenceExists = () => false, githubRunIsSuccessful = () => false },
  runContext,
) {
  if (GITHUB_ACTIONS_RUN_URL.test(reference)) {
    return githubRunIsSuccessful(reference, runContext);
  }
  const normalized = normalizeReleaseReference(reference);
  return Boolean(normalized) && evidenceExists(normalized);
}

function validateReleaseLedger(evidence) {
  const blockers = [];
  if (evidence.schemaVersion !== 1) {
    blockers.push("release-evidence:schema-invalid");
  }
  if (evidence.releaseStatus !== "ready") {
    blockers.push(`release-evidence:status-${evidence.releaseStatus ?? "missing"}`);
  }
  if (!Array.isArray(evidence.p0Failures)) {
    blockers.push("release-evidence:p0-ledger-missing");
  } else if (evidence.p0Failures.length > 0) {
    blockers.push(...evidence.p0Failures.map((failure) => `p0:${failure.id ?? "unknown"}`));
  }
  if (!Array.isArray(evidence.waivers)) {
    blockers.push("release-evidence:waiver-ledger-missing");
  } else {
    for (const waiver of evidence.waivers) {
      if (!waiver.owner?.trim() || !waiver.rationale?.trim()) {
        blockers.push(`waiver:${waiver.gateId ?? "unknown"}:owner-or-rationale-missing`);
      }
      if (!REQUIRED_GATES.has(waiver.gateId)) {
        blockers.push(`waiver:${waiver.gateId ?? "unknown"}:unknown-gate`);
      }
    }
  }
  return blockers;
}

function validateGates(
  evidence,
  { evidenceExists = () => false, githubRunIsSuccessful = () => false, expectedCommit },
) {
  const blockers = [];
  const gates = Array.isArray(evidence.gates) ? evidence.gates : [];
  const gatesById = new Map(gates.map((gate) => [gate.id, gate]));
  for (const gateId of REQUIRED_GATES) {
    if (!gatesById.has(gateId)) {
      blockers.push(`${gateId}:missing`);
    }
  }
  for (const gate of gates) {
    if (!REQUIRED_GATES.has(gate.id)) {
      blockers.push(`${gate.id}:unknown-gate`);
      continue;
    }
    if (!GATE_STATUSES.has(gate.status)) {
      blockers.push(`${gate.id}:status-invalid`);
      continue;
    }
    if (gate.status === "pass" && !gate.owner?.trim()) {
      blockers.push(`${gate.id}:owner-missing`);
    }
    if (gate.status === "pass" && (!Array.isArray(gate.evidence) || gate.evidence.length === 0)) {
      blockers.push(`${gate.id}:pass-without-evidence`);
    } else if (gate.status === "pass") {
      for (const reference of gate.evidence) {
        if (
          !isReproducibleReference(
            reference,
            { evidenceExists, githubRunIsSuccessful },
            { gateId: gate.id, expectedCommit },
          )
        ) {
          blockers.push(`${gate.id}:missing-evidence:${reference}`);
        }
      }
    }
    if (gate.status === "blocked" || gate.status === "failed") {
      blockers.push(`${gate.id}:${gate.status}`);
    }
    if (gate.status === "deferred") {
      blockers.push(`${gate.id}:deferred-not-authorized`);
    }
  }
  return blockers;
}

function validateTraceability(
  traceability,
  deferrals,
  { evidenceExists = () => false, githubRunIsSuccessful = () => false } = {},
) {
  const blockers = [];
  const traceRows = parseTraceabilityRows(traceability);
  if (deferrals?.schemaVersion !== 1) {
    blockers.push("deferrals:schema-invalid");
  }
  const approvedDeferrals = Array.isArray(deferrals?.deferrals) ? deferrals.deferrals : [];
  const approvalsById = new Map(approvedDeferrals.map((deferral) => [deferral?.id, deferral]));
  const traceById = new Map(traceRows.map((row) => [row.id, row]));
  for (const approval of approvedDeferrals) {
    if (!AUTHORIZED_DEFERRAL_IDS.has(approval?.id)) {
      blockers.push(`deferral:${approval?.id ?? "unknown"}:authorization-invalid`);
    }
  }
  for (const row of traceRows.filter(
    (entry) => entry.status === "deferred" || entry.scope !== "V1",
  )) {
    if (!AUTHORIZED_DEFERRAL_IDS.has(row.id)) {
      blockers.push(`deferral:${row.id}:authorization-invalid`);
      continue;
    }
    const approval = approvalsById.get(row.id);
    if (!approval) {
      blockers.push(`deferral:${row.id}:not-authorized`);
      continue;
    }
    if (
      row.scope !== "后续" ||
      row.status !== "deferred" ||
      row.primaryIssue !== "—" ||
      approval.scope !== "后续" ||
      approval.status !== "deferred" ||
      !approval.approvedBy?.trim() ||
      !approval.approvedAt?.trim() ||
      !approval.rationale?.trim()
    ) {
      blockers.push(`deferral:${row.id}:invalid`);
    }
    if (!Array.isArray(approval.evidence) || approval.evidence.length === 0) {
      blockers.push(`deferral:${row.id}:evidence-missing`);
    } else {
      for (const reference of approval.evidence) {
        if (!isReproducibleReference(reference, { evidenceExists, githubRunIsSuccessful })) {
          blockers.push(`deferral:${row.id}:evidence-invalid:${reference}`);
        }
      }
    }
  }
  for (const approval of approvedDeferrals) {
    const row = traceById.get(approval?.id);
    if (!row || row.status !== "deferred" || row.scope !== "后续") {
      blockers.push(`deferral:${approval?.id ?? "unknown"}:trace-mismatch`);
    }
  }
  const unresolvedCapabilities = traceRows.filter(
    (row) => row.scope === "V1" && !["verified", "released"].includes(row.status),
  );
  if (unresolvedCapabilities.length > 0) {
    blockers.push(
      `capability-verification:${unresolvedCapabilities.length}:${unresolvedCapabilities
        .map((row) => `${row.id}:${row.status}`)
        .join(",")}`,
    );
  }
  return blockers;
}

function validateUiMatrix(uiMatrix, { goldenIsValid = () => false } = {}) {
  const blockers = [];
  const { productionRows } = parseUiMatrix(uiMatrix);
  const pageIds = new Set(productionRows.map((row) => row.page));
  for (const page of PRODUCTION_PAGE_IDS) {
    if (!pageIds.has(page)) {
      blockers.push(`${page}:missing-page-row`);
    }
  }
  for (const row of productionRows) {
    const { page, status } = row;
    if (!["parity-verified", "deviation-approved"].includes(status)) {
      blockers.push(`${page}:${status}`);
    }
    if (!row.playwrightSpecPath?.includes("apps/web/e2e/parity/")) {
      blockers.push(`${page}:missing-playwright-spec`);
    }
    if (!row.goldenPath?.includes("artifacts/ui/golden/")) {
      blockers.push(`${page}:missing-golden-path`);
    }
    if (["parity-verified", "deviation-approved"].includes(status)) {
      const goldenPaths = expandGoldenPaths(row.goldenPath);
      if (goldenPaths.length !== GOLDEN_VIEWPORTS.length) {
        blockers.push(`${page}:golden-views-invalid`);
      } else {
        for (const [index, goldenPath] of goldenPaths.entries()) {
          if (!goldenPath || !goldenIsValid(goldenPath, GOLDEN_VIEWPORTS[index])) {
            blockers.push(`${page}:golden-invalid:${goldenPath || "(unknown)"}`);
          }
        }
      }
    }
  }
  return blockers;
}

function validateDeviationApprovals(
  uiMatrix,
  deviationApprovals,
  { evidenceExists = () => false, githubRunIsSuccessful = () => false, fileContains = () => false },
) {
  const blockers = [];
  if (deviationApprovals?.schemaVersion !== 1) {
    blockers.push("ui-deviations:schema-invalid");
  }
  const approvals = Array.isArray(deviationApprovals?.deviations)
    ? deviationApprovals.deviations
    : [];
  const approvalsByPage = new Map(approvals.map((approval) => [approval.page, approval]));
  const { productionRows } = parseUiMatrix(uiMatrix);
  for (const row of productionRows.filter((entry) => entry.status === "deviation-approved")) {
    const approval = approvalsByPage.get(row.page);
    if (!approval) {
      blockers.push(`${row.page}:deviation-approval-missing`);
      continue;
    }
    if (
      !approval.approvedBy?.trim() ||
      !approval.approvedAt?.trim() ||
      !approval.scope?.trim() ||
      !approval.rationale?.trim() ||
      !approval.replacementBaseline?.trim() ||
      approval.documentMarker !== `deviation:${row.page}`
    ) {
      blockers.push(`${row.page}:deviation-approval-incomplete`);
    }
    const updatedDocuments = new Set(
      (Array.isArray(approval.updatedDocuments) ? approval.updatedDocuments : [])
        .map(canonicalRepositoryPath)
        .filter(Boolean),
    );
    for (const document of DEVIATION_DOCUMENTS) {
      if (!updatedDocuments.has(document)) {
        blockers.push(`${row.page}:deviation-document-missing:${document}`);
      } else if (
        !approval.documentMarker?.trim() ||
        !fileContains(document, approval.documentMarker)
      ) {
        blockers.push(`${row.page}:deviation-document-unverified:${document}`);
      }
    }
    const [baselinePath, baselineMarker] = approval.replacementBaseline.split("#", 2);
    const normalizedBaselinePath = normalizeReleaseReference(baselinePath);
    if (
      !normalizedBaselinePath ||
      !baselineMarker?.trim() ||
      !evidenceExists(normalizedBaselinePath) ||
      !fileContains(normalizedBaselinePath, baselineMarker)
    ) {
      blockers.push(`${row.page}:deviation-replacement-baseline-invalid`);
    }
    if (!Array.isArray(approval.evidence) || approval.evidence.length === 0) {
      blockers.push(`${row.page}:deviation-evidence-missing`);
    } else {
      for (const reference of approval.evidence) {
        if (!isReproducibleReference(reference, { evidenceExists, githubRunIsSuccessful })) {
          blockers.push(`${row.page}:deviation-evidence-invalid:${reference}`);
        }
      }
    }
    const selfReferencedOnly =
      Array.isArray(approval.evidence) &&
      approval.evidence.length > 0 &&
      approval.evidence.every((reference) =>
        updatedDocuments.has(canonicalRepositoryPath(reference)),
      );
    if (selfReferencedOnly) {
      blockers.push(`${row.page}:deviation-evidence-self-referential`);
    }
  }
  return blockers;
}

function validateActionEvidence(
  actionEvidence,
  actionContract,
  { evidenceExists = () => false, fileContains = () => false } = {},
) {
  const blockers = [];
  if (actionEvidence?.schemaVersion !== 1) {
    blockers.push("action-evidence:schema-invalid");
  }
  if (actionContract?.schemaVersion !== 1) {
    blockers.push("action-contract:schema-invalid");
  }
  const capabilityAudit = actionEvidence?.capabilityAudit;
  if (
    !capabilityAudit ||
    capabilityAudit.issue !== "#238" ||
    capabilityAudit.status !== "verified" ||
    !capabilityAudit.verifiedAt?.trim() ||
    normalizeRepositoryPath(capabilityAudit.path) !==
      "docs/implementation/m3-238-ui-capability-evidence.json" ||
    !evidenceExists(normalizeRepositoryPath(capabilityAudit.path))
  ) {
    blockers.push("action-evidence:capability-audit-missing");
  }
  const records = actionEvidence?.pages;
  const contractPages = actionContract?.pages;
  const staticPages = new Set(STATIC_PRODUCTION_PAGE_IDS);
  const actionPages = PRODUCTION_PAGE_IDS.filter((page) => !staticPages.has(page));
  const missing = [];
  const pending = [];
  const incomplete = [];
  for (const page of actionPages) {
    const record = records?.[page];
    if (!record) {
      missing.push(page);
      continue;
    }
    const requiredActions = Array.isArray(contractPages?.[page])
      ? contractPages[page].filter((id) => typeof id === "string" && id.trim())
      : [];
    if (requiredActions.length === 0 || new Set(requiredActions).size !== requiredActions.length) {
      blockers.push(`action-contract:${page}:invalid`);
      continue;
    }
    if (record.status !== "verified") {
      if (!record.rationale?.trim()) {
        incomplete.push(page);
      } else {
        pending.push(page);
      }
      continue;
    }
    const actions = Array.isArray(record.actions) ? record.actions : [];
    const actionIds = actions.map((action) => action?.id);
    if (
      requiredActions.length === 0 ||
      new Set(requiredActions).size !== requiredActions.length ||
      actions.length !== requiredActions.length ||
      new Set(actionIds).size !== actions.length ||
      !requiredActions.every((id) => actionIds.includes(id))
    ) {
      incomplete.push(page);
      continue;
    }
    for (const action of actions) {
      if (
        !action.id?.trim() ||
        !action.name?.trim() ||
        !/^\/api\/v1\//u.test(action.api ?? "") ||
        canonicalRepositoryPath(action.spec) !==
          `apps/web/e2e/parity/${page}.spec.ts`.toLowerCase() ||
        !action.test?.trim() ||
        !action.assertion?.trim() ||
        !evidenceExists(action.spec) ||
        !fileContains(action.spec, action.api) ||
        !fileContains(action.spec, action.test) ||
        !fileContains(action.spec, action.assertion)
      ) {
        incomplete.push(page);
        break;
      }
    }
  }
  if (missing.length > 0) {
    blockers.push(`action-evidence:missing:${missing.join(",")}`);
  }
  if (pending.length > 0) {
    blockers.push(`action-evidence:${pending.length}:pending:${pending.join(",")}`);
  }
  if (incomplete.length > 0) {
    blockers.push(`action-evidence:incomplete:${incomplete.join(",")}`);
  }
  return blockers;
}

function validateHumanReviewStatus(
  evidence,
  humanReviewStatus,
  recordedHumanReviewStatus,
  humanReviewArtifactsFresh,
  humanAttestationIsValid,
) {
  const blockers = [];
  const gate = (Array.isArray(evidence?.gates) ? evidence.gates : []).find(
    (candidate) => candidate?.id === "human-blind-review",
  );
  if (!humanReviewStatus || typeof humanReviewStatus !== "object") {
    blockers.push("human-blind-review:status-ledger-missing");
    return blockers;
  }
  if (
    !recordedHumanReviewStatus ||
    JSON.stringify(recordedHumanReviewStatus) !== JSON.stringify(humanReviewStatus)
  ) {
    blockers.push("human-blind-review:status-ledger-mismatch");
  }
  if (!humanReviewArtifactsFresh) {
    blockers.push("human-blind-review:artifact-stale");
  }
  if (
    humanReviewStatus.schemaVersion !== 1 ||
    humanReviewStatus.issue !== 273 ||
    !/^[a-f0-9]{64}$/u.test(humanReviewStatus.proposalPacketSha256 ?? "") ||
    !humanReviewStatus.qualityGate ||
    !Array.isArray(humanReviewStatus.qualityGate.blockers)
  ) {
    blockers.push("human-blind-review:status-ledger-invalid");
  }
  if (
    humanReviewStatus.qualityGate?.status === "pass" &&
    humanReviewStatus.qualityGate.blockers.length > 0
  ) {
    blockers.push("human-blind-review:status-ledger-invalid");
  }
  const pendingCount = humanReviewStatus.pendingAdjudicationCount;
  if (!Number.isInteger(pendingCount) || pendingCount < 0) {
    blockers.push("human-blind-review:pending-count-invalid");
  } else if (pendingCount > 0) {
    blockers.push("human-blind-review:pending-adjudications");
  }
  const varianceDecision = (
    Array.isArray(humanReviewStatus.separateDecisions) ? humanReviewStatus.separateDecisions : []
  ).find((decision) => decision?.id === "interRaterVarianceThreshold");
  if (
    !varianceDecision ||
    varianceDecision.owner !== "#240" ||
    varianceDecision.mayBeApprovedByThisIssue !== false ||
    varianceDecision.status !== "outside-this-issue" ||
    varianceDecision.releaseGateRequiresIndependentApproval !== true
  ) {
    blockers.push("human-blind-review:variance-owner-mismatch");
  }
  if (gate?.status === "pass" && humanReviewStatus.qualityGate?.status !== "pass") {
    blockers.push("human-blind-review:ledger-blocked");
  }
  if (gate?.status === "pass" && humanReviewStatus.humanAdjudicationCompleted !== true) {
    blockers.push("human-blind-review:adjudication-incomplete");
  }
  if (
    gate?.status === "pass" &&
    (humanReviewStatus.technicalStatus !== "passed" ||
      humanReviewStatus.packetDispositionComplete !== true ||
      !humanReviewStatus.oracleContentDisposition ||
      ![
        "refreeze_clean_packet",
        "replace_affected_samples",
        "preserve_with_product_owner_approval",
      ].includes(humanReviewStatus.oracleContentDisposition.decision) ||
      !humanReviewStatus.oracleContentDisposition.oldScoresImpact?.trim() ||
      humanReviewStatus.hookProseDispositionComplete !== true ||
      !humanReviewStatus.humanAttestation)
  ) {
    blockers.push("human-blind-review:ledger-state-invalid");
  }
  if (
    gate?.status === "pass" &&
    humanReviewStatus.hookProseDisposition?.decision === "approve_waiver" &&
    (!Number.isFinite(Date.parse(humanReviewStatus.hookProseDisposition.expiresAt)) ||
      Date.parse(humanReviewStatus.hookProseDisposition.expiresAt) <= Date.now())
  ) {
    blockers.push("human-blind-review:hook-prose-waiver-expired");
  }
  if (gate?.status === "pass" && !humanAttestationIsValid(humanReviewStatus.humanAttestation)) {
    blockers.push("human-blind-review:human-attestation-invalid");
  }
  return blockers;
}

export function evaluateV1Release({
  evidence,
  traceability,
  capabilityEvidence = { schemaVersion: 1, evidence: {}, capabilities: {} },
  uiCapabilityEvidence = { schemaVersion: 1, evidence: {}, capabilities: {} },
  uiMatrix,
  deferrals,
  deviationApprovals,
  actionContract,
  actionEvidence,
  humanReviewStatus,
  recordedHumanReviewStatus = humanReviewStatus,
  humanReviewArtifactsFresh = true,
  humanAttestationIsValid = () => false,
  evidenceExists = () => false,
  githubRunIsSuccessful = () => false,
  auditCiRunIsValid = () => false,
  currentHeadCiIsSuccessful = () => false,
  gapIssueIsValid = () => false,
  fileContains = () => false,
  goldenIsValid = () => false,
  expectedCommit,
}) {
  const blockers = [
    ...validateReleaseLedger(evidence),
    ...validateGates(evidence, {
      evidenceExists,
      githubRunIsSuccessful,
      expectedCommit,
    }),
    ...validateTraceability(traceability, deferrals, {
      evidenceExists,
      githubRunIsSuccessful,
    }),
    ...validateNonUiCapabilityEvidence(traceability, capabilityEvidence, {
      evidenceExists,
      githubRunIsSuccessful,
      auditCiRunIsValid,
      gapIssueIsValid,
    }),
    ...validateUiCapabilityEvidence(traceability, uiCapabilityEvidence, {
      evidenceExists,
      githubRunIsSuccessful,
      auditCiRunIsValid,
      gapIssueIsValid,
      fileContains,
      expectedCommit,
      currentHeadCiIsSuccessful,
    }),
    ...validateUiMatrix(uiMatrix, { goldenIsValid }),
    ...validateDeviationApprovals(uiMatrix, deviationApprovals, {
      evidenceExists,
      githubRunIsSuccessful,
      fileContains,
    }),
    ...validateActionEvidence(actionEvidence, actionContract, { evidenceExists, fileContains }),
    ...validateHumanReviewStatus(
      evidence,
      humanReviewStatus,
      recordedHumanReviewStatus,
      humanReviewArtifactsFresh,
      humanAttestationIsValid,
    ),
  ];
  return { ready: blockers.length === 0, blockers };
}

function isNonEmptyFile(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function fileContains(path, marker) {
  try {
    return readFileSync(path, "utf8").includes(marker);
  } catch {
    return false;
  }
}

function goldenIsValid(path, viewport) {
  try {
    return isValidGoldenImage(readFileSync(path), viewport);
  } catch {
    return false;
  }
}

export function isValidGithubActionsRunData(reference, run, context = {}) {
  if (run?.status !== "completed" || run?.conclusion !== "success" || run?.url !== reference) {
    return false;
  }
  if (context.gateId === "final-production-ci") {
    return (
      run.path === ".github/workflows/ci.yml" &&
      run.event === "pull_request" &&
      Boolean(context.expectedCommit) &&
      run.headSha === context.expectedCommit
    );
  }
  return true;
}

export function isSuccessfulGithubActionsRun(reference, context = {}) {
  const match = reference.match(GITHUB_ACTIONS_RUN_URL);
  if (!match) return false;
  const [, owner, repository, runId] = match;
  if (`${owner}/${repository}` !== EXPECTED_GITHUB_REPOSITORY) return false;
  try {
    const run = queryGithubApi(
      `repos/${owner}/${repository}/actions/runs/${runId}`,
      "{status: .status, conclusion: .conclusion, url: .html_url, headSha: .head_sha, path: .path, event: .event}",
    );
    return isValidGithubActionsRunData(reference, run, context);
  } catch {
    return false;
  }
}

function isGithubHumanAttestationValid(attestation) {
  if (
    attestation?.provider !== "github_issue_comment" ||
    attestation.issue !== 273 ||
    attestation.requiredMarker !== "M3-273-HUMAN-ATTESTATION" ||
    !/^[a-f0-9]{64}$/u.test(attestation.proposalSha256 ?? "") ||
    !/^\d+$/u.test(attestation.commentId ?? "") ||
    attestation.commentUrl !==
      `https://github.com/${EXPECTED_GITHUB_REPOSITORY}/issues/273#issuecomment-${attestation.commentId}`
  ) {
    return false;
  }
  try {
    const comment = queryGithubApi(
      `repos/${EXPECTED_GITHUB_REPOSITORY}/issues/comments/${attestation.commentId}`,
      "{body: .body, issueUrl: .issue_url, author: .user.login, authorAssociation: .author_association, createdAt: .created_at}",
    );
    const attestedAt = Date.parse(attestation.attestedAt);
    const createdAt = Date.parse(comment.createdAt);
    return (
      comment.author === attestation.author &&
      ["OWNER", "MEMBER", "COLLABORATOR"].includes(comment.authorAssociation) &&
      comment.issueUrl?.endsWith(`/repos/${EXPECTED_GITHUB_REPOSITORY}/issues/273`) &&
      Number.isFinite(attestedAt) &&
      Number.isFinite(createdAt) &&
      Math.abs(attestedAt - createdAt) <= 60_000 &&
      comment.body?.includes("M3-273-HUMAN-ATTESTATION") &&
      comment.body?.includes(attestation.proposalSha256)
    );
  } catch {
    return false;
  }
}

export function isValidGapIssueData(reference, issue) {
  const match = reference.match(GITHUB_ISSUE_REFERENCE);
  return Boolean(
    match &&
    issue?.state?.toUpperCase() === "OPEN" &&
    issue.title?.trim() &&
    Array.isArray(issue.labels) &&
    issue.labels.some((label) => BOUNDED_GAP_LABELS.has(label)),
  );
}

function isOpenReadyGithubIssue(reference) {
  const match = reference.match(GITHUB_ISSUE_REFERENCE);
  if (!match) return false;
  try {
    const issue = queryGithubApi(
      `repos/${EXPECTED_GITHUB_REPOSITORY}/issues/${match[1]}`,
      "{state: .state, title: .title, labels: [.labels[].name]}",
    );
    return isValidGapIssueData(reference, issue);
  } catch {
    return false;
  }
}

function isAuditCiRun(reference, expectedHeadSha) {
  const match = reference?.match(GITHUB_ACTIONS_RUN_URL);
  if (!match || !expectedHeadSha) return false;
  const [, owner, repository, runId] = match;
  if (`${owner}/${repository}` !== EXPECTED_GITHUB_REPOSITORY) return false;
  try {
    const run = queryGithubApi(
      `repos/${owner}/${repository}/actions/runs/${runId}`,
      "{status: .status, conclusion: .conclusion, url: .html_url, headSha: .head_sha, path: .path, event: .event}",
    );
    return isValidGithubActionsRunData(reference, run, {
      gateId: "final-production-ci",
      expectedCommit: expectedHeadSha,
    });
  } catch {
    return false;
  }
}

export function hasRequiredCurrentHeadCiEvidence(
  runs,
  expectedHeadSha,
  workflows = CURRENT_HEAD_CI_WORKFLOWS,
) {
  if (!expectedHeadSha || !Array.isArray(runs)) return false;
  const successfulPullRequestRuns = new Set(
    runs
      .filter(
        (run) =>
          run?.headSha === expectedHeadSha &&
          run?.event === "pull_request" &&
          run?.status === "completed" &&
          run?.conclusion === "success",
      )
      .map((run) => run.path),
  );
  return workflows.every((workflow) => successfulPullRequestRuns.has(workflow));
}

function isCurrentHeadCiSuccessful(workflows, expectedHeadSha) {
  if (!expectedHeadSha) return false;
  try {
    const runs = queryGithubApi(
      `repos/${EXPECTED_GITHUB_REPOSITORY}/actions/runs?head_sha=${expectedHeadSha}&per_page=100`,
      "{workflow_runs: [.workflow_runs[] | {status: .status, conclusion: .conclusion, headSha: .head_sha, path: .path, event: .event}]}",
    );
    return hasRequiredCurrentHeadCiEvidence(runs.workflow_runs, expectedHeadSha, workflows);
  } catch {
    return false;
  }
}

function queryGithubApi(path, jq) {
  const output = execFileSync("gh", ["api", path, "--jq", jq], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 15_000,
  });
  return JSON.parse(output);
}

function main() {
  const expectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const recordedHumanReviewStatus = JSON.parse(
    readFileSync("docs/quality/evidence/m3-273/status.json", "utf8"),
  );
  const humanReviewArtifacts = buildM3_273Artifacts({
    root: process.cwd(),
  });
  const result = evaluateV1Release({
    evidence: JSON.parse(readFileSync("docs/implementation/v1-release-evidence.json", "utf8")),
    traceability: readFileSync("docs/planning/v1-capability-traceability.md", "utf8"),
    capabilityEvidence: JSON.parse(
      readFileSync("docs/implementation/m3-236-non-ui-capability-evidence.json", "utf8"),
    ),
    uiCapabilityEvidence: JSON.parse(
      readFileSync("docs/implementation/m3-238-ui-capability-evidence.json", "utf8"),
    ),
    uiMatrix: readFileSync("docs/ui/v1-ui-parity-matrix.md", "utf8"),
    deferrals: JSON.parse(readFileSync("docs/planning/v1-deferrals.json", "utf8")),
    deviationApprovals: JSON.parse(readFileSync("docs/ui/v1-ui-deviations.json", "utf8")),
    actionContract: JSON.parse(readFileSync("docs/ui/v1-action-contract.json", "utf8")),
    actionEvidence: JSON.parse(readFileSync("docs/implementation/v1-action-evidence.json", "utf8")),
    humanReviewStatus: humanReviewArtifacts.status,
    recordedHumanReviewStatus,
    humanReviewArtifactsFresh: humanReviewArtifacts.artifactFreshness.stalePaths.length === 0,
    humanAttestationIsValid: isGithubHumanAttestationValid,
    evidenceExists: isNonEmptyFile,
    githubRunIsSuccessful: isSuccessfulGithubActionsRun,
    auditCiRunIsValid: isAuditCiRun,
    currentHeadCiIsSuccessful: isCurrentHeadCiSuccessful,
    gapIssueIsValid: isOpenReadyGithubIssue,
    fileContains,
    goldenIsValid,
    expectedCommit,
  });
  if (result.blockers.length > 0) {
    process.stderr.write("V1 RELEASE BLOCKED\n");
    for (const blocker of result.blockers) {
      process.stderr.write(`- ${blocker}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write("V1 RELEASE READY\n");
}

runCli(import.meta.url, process.argv[1], main);
