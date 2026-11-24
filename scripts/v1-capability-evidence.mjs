import { normalizeRepositoryPath, parseTraceabilityRows } from "./v1-ledger.mjs";

const EVIDENCE_KIND_DESCRIPTORS = {
  contract: { executable: true, pathPattern: /\.test\.(?:ts|mjs)$/u },
  unit: { executable: true, pathPattern: /\.test\.(?:ts|mjs)$/u },
  integration: { executable: true, pathPattern: /\.integration\.test\.ts$/u },
  e2e: { executable: true, pathPattern: /^apps\/web\/e2e\/.*\.spec\.ts$/u },
  guardrail: { executable: true, pathPattern: /^scripts\/test\/.*\.test\.mjs$/u },
  manual_signoff: { executable: false, pathPattern: /\.(?:md|json)$/u },
  ci: {
    executable: false,
    external: true,
    pathPattern: /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/u,
  },
};
export const EXECUTABLE_EVIDENCE_KINDS = new Set(
  Object.entries(EVIDENCE_KIND_DESCRIPTORS)
    .filter(([, descriptor]) => descriptor.executable)
    .map(([kind]) => kind),
);
const CAPABILITY_STATUSES = new Set(["verified", "implemented"]);
const GAP_ISSUE = /^#\d+$/u;
const CURRENT_HEAD_CI_WORKFLOWS = [
  ".github/workflows/ci.yml",
  ".github/workflows/deployment-smoke.yml",
  ".github/workflows/readiness-validation.yml",
];

function isNonUiV1Capability(row) {
  return row.scope === "V1" && !row.id.startsWith("UI-");
}

function isUiV1Capability(row) {
  return row.scope === "V1" && row.id.startsWith("UI-");
}

function validateEvidenceReferences(
  id,
  record,
  evidenceCatalog,
  { evidenceExists, githubRunIsSuccessful },
  blockers,
) {
  const executablePaths = [];
  const references = Array.isArray(record.evidence) ? record.evidence : [];
  if (references.length === 0) {
    blockers.push(`capability-audit:evidence-empty:${id}`);
    return executablePaths;
  }
  let executable = false;
  for (const key of references) {
    const item = evidenceCatalog?.[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      blockers.push(`capability-audit:evidence-unknown:${id}:${key}`);
      continue;
    }
    const descriptor = EVIDENCE_KIND_DESCRIPTORS[item.kind];
    if (!descriptor) {
      blockers.push(`capability-audit:evidence-kind-invalid:${id}:${key}`);
      continue;
    }
    if (descriptor.executable) executable = true;
    if (descriptor.external) {
      if (!descriptor.pathPattern.test(item.path ?? "")) {
        blockers.push(`capability-audit:evidence-kind-path-mismatch:${id}:${key}`);
      } else if (!githubRunIsSuccessful(item.path)) {
        blockers.push(`capability-audit:evidence-missing:${id}:${key}`);
      }
      continue;
    }
    const path = normalizeRepositoryPath(item.path);
    if (!path || !evidenceExists(path)) {
      blockers.push(`capability-audit:evidence-missing:${id}:${key}`);
      continue;
    }
    if (descriptor.executable) executablePaths.push(path);
    if (!descriptor.pathPattern.test(path)) {
      blockers.push(`capability-audit:evidence-kind-path-mismatch:${id}:${key}`);
    }
  }
  if (!executable) {
    blockers.push(`capability-audit:non-executable:${id}`);
  }
  return executablePaths;
}

function validateVerification(verification, auditCiRunIsValid, blockers) {
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    blockers.push("capability-audit:verification-missing");
    return;
  }
  if (
    verification.kind !== "ci" ||
    verification.status !== "passed" ||
    !/^[0-9a-f]{40}$/u.test(verification.headSha ?? "")
  ) {
    blockers.push("capability-audit:verification-invalid");
  }
  if (
    !/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/u.test(verification.path ?? "") ||
    !auditCiRunIsValid(verification.path, verification.headSha)
  ) {
    blockers.push("capability-audit:verification-evidence-missing");
  }
}

function validateCurrentHeadVerification(
  verification,
  { expectedCommit, currentHeadCiIsSuccessful },
  blockers,
) {
  if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
    blockers.push("capability-audit:verification-missing");
    return;
  }
  if (
    verification.kind !== "github-actions-current-head" ||
    verification.status !== "required" ||
    !Array.isArray(verification.workflows) ||
    verification.workflows.length !== CURRENT_HEAD_CI_WORKFLOWS.length ||
    !CURRENT_HEAD_CI_WORKFLOWS.every((workflow) => verification.workflows.includes(workflow)) ||
    !/^[0-9a-f]{40}$/u.test(expectedCommit ?? "")
  ) {
    blockers.push("capability-audit:verification-invalid");
  }
  if (!expectedCommit) {
    blockers.push("capability-audit:verification-head-missing");
    return;
  }
  if (!currentHeadCiIsSuccessful(verification.workflows, expectedCommit)) {
    blockers.push("capability-audit:verification-evidence-missing");
  }
}

function validateCapabilityEvidence(
  traceability,
  audit,
  isExpectedCapability,
  {
    evidenceExists = () => false,
    githubRunIsSuccessful = () => false,
    auditCiRunIsValid = () => false,
    gapIssueIsValid = () => false,
    fileContains = () => false,
    requireTestMarkers = false,
    verificationMode = "recorded",
    expectedCommit,
    currentHeadCiIsSuccessful = () => false,
  } = {},
) {
  const blockers = [];
  if (audit?.schemaVersion !== 1) {
    blockers.push("capability-audit:schema-invalid");
  }

  const traceRows = parseTraceabilityRows(traceability).filter(isExpectedCapability);
  const expectedIds = new Set(traceRows.map((row) => row.id));
  const capabilities = audit?.capabilities;
  const evidence = audit?.evidence;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return [...blockers, "capability-audit:capabilities-missing"];
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    blockers.push("capability-audit:evidence-missing");
  }
  if (Object.values(capabilities).some((record) => record?.status === "verified")) {
    if (verificationMode === "current-head") {
      validateCurrentHeadVerification(
        audit.verification,
        { expectedCommit, currentHeadCiIsSuccessful },
        blockers,
      );
    } else {
      validateVerification(audit.verification, auditCiRunIsValid, blockers);
    }
  }

  for (const id of Object.keys(capabilities)) {
    if (!expectedIds.has(id)) {
      blockers.push(`capability-audit:unexpected:${id}`);
    }
  }

  for (const row of traceRows) {
    const record = capabilities[row.id];
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      blockers.push(`capability-audit:missing:${row.id}`);
      continue;
    }
    if (!CAPABILITY_STATUSES.has(record.status)) {
      blockers.push(`capability-audit:status-invalid:${row.id}`);
      continue;
    }

    if (row.status !== record.status) {
      blockers.push(`capability-audit:trace-mismatch:${row.id}`);
    }

    const executablePaths = validateEvidenceReferences(
      row.id,
      record,
      evidence,
      { evidenceExists, githubRunIsSuccessful },
      blockers,
    );

    if (record.status === "verified") {
      if (requireTestMarkers) {
        const tests = Array.isArray(record.tests)
          ? record.tests.filter((test) => typeof test === "string" && test.trim())
          : [];
        if (tests.length === 0) {
          blockers.push(`capability-audit:test-marker-missing:${row.id}`);
        }
        for (const test of tests) {
          if (!executablePaths.some((path) => fileContains(path, test))) {
            blockers.push(`capability-audit:test-missing:${row.id}:${test}`);
          }
        }
      }
      continue;
    }

    const gap = record.gap;
    if (!gap?.reason?.trim()) {
      blockers.push(`capability-audit:reason-missing:${row.id}`);
    }
    if (!GAP_ISSUE.test(gap?.issue ?? "")) {
      blockers.push(`capability-audit:gap-issue-missing:${row.id}`);
    } else if (!gapIssueIsValid(gap.issue)) {
      blockers.push(`capability-audit:gap-issue-invalid:${row.id}:${gap.issue}`);
    }
  }

  return blockers;
}

export function validateNonUiCapabilityEvidence(traceability, audit, options = {}) {
  return validateCapabilityEvidence(traceability, audit, isNonUiV1Capability, options);
}

export function validateUiCapabilityEvidence(traceability, audit, options = {}) {
  return validateCapabilityEvidence(traceability, audit, isUiV1Capability, {
    ...options,
    requireTestMarkers: true,
    verificationMode: "current-head",
  });
}
