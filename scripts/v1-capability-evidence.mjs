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

function isNonUiV1Capability(row) {
  return row.scope === "V1" && !row.id.startsWith("UI-");
}

function validateEvidenceReferences(
  id,
  record,
  evidenceCatalog,
  { evidenceExists, githubRunIsSuccessful },
  blockers,
) {
  const references = Array.isArray(record.evidence) ? record.evidence : [];
  if (references.length === 0) {
    blockers.push(`capability-audit:evidence-empty:${id}`);
    return;
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
    if (!descriptor.pathPattern.test(path)) {
      blockers.push(`capability-audit:evidence-kind-path-mismatch:${id}:${key}`);
    }
  }
  if (!executable) {
    blockers.push(`capability-audit:non-executable:${id}`);
  }
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

export function validateNonUiCapabilityEvidence(
  traceability,
  audit,
  {
    evidenceExists = () => false,
    githubRunIsSuccessful = () => false,
    auditCiRunIsValid = () => false,
    gapIssueIsValid = () => false,
  } = {},
) {
  const blockers = [];
  if (audit?.schemaVersion !== 1) {
    blockers.push("capability-audit:schema-invalid");
  }

  const traceRows = parseTraceabilityRows(traceability).filter(isNonUiV1Capability);
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
    validateVerification(audit.verification, auditCiRunIsValid, blockers);
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

    validateEvidenceReferences(
      row.id,
      record,
      evidence,
      { evidenceExists, githubRunIsSuccessful },
      blockers,
    );

    if (record.status === "verified") {
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
