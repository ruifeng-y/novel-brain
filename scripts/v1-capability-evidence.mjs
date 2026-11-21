import { normalizeRepositoryPath, parseTraceabilityRows } from "./v1-ledger.mjs";

export const EXECUTABLE_EVIDENCE_KINDS = new Set([
  "contract",
  "unit",
  "integration",
  "e2e",
  "benchmark",
  "guardrail",
]);

const EVIDENCE_KINDS = new Set([...EXECUTABLE_EVIDENCE_KINDS, "manual_signoff"]);
const CAPABILITY_STATUSES = new Set(["verified", "implemented"]);
const GAP_ISSUE = /^#\d+$/u;
const EVIDENCE_PATH_PATTERNS = {
  contract: /\.test\.(?:ts|mjs)$/u,
  unit: /\.test\.(?:ts|mjs)$/u,
  integration: /\.integration\.test\.ts$/u,
  e2e: /^apps\/web\/e2e\/.*\.spec\.ts$/u,
  benchmark: /(?:^|\/)test\/.*\.test\.(?:ts|mjs)$/u,
  guardrail: /^scripts\/test\/.*\.test\.mjs$/u,
  manual_signoff: /\.(?:md|json)$/u,
};

function isNonUiV1Capability(row) {
  return row.scope === "V1" && !row.id.startsWith("UI-");
}

function validateEvidenceReferences(id, record, evidence, evidenceExists, blockers) {
  const references = Array.isArray(record.evidence) ? record.evidence : [];
  if (references.length === 0) {
    blockers.push(`capability-audit:evidence-empty:${id}`);
    return;
  }
  let executable = false;
  for (const key of references) {
    const item = evidence?.[key];
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      blockers.push(`capability-audit:evidence-unknown:${id}:${key}`);
      continue;
    }
    if (!EVIDENCE_KINDS.has(item.kind)) {
      blockers.push(`capability-audit:evidence-kind-invalid:${id}:${key}`);
      continue;
    }
    if (EXECUTABLE_EVIDENCE_KINDS.has(item.kind)) executable = true;
    const path = normalizeRepositoryPath(item.path);
    if (!path || !evidenceExists(path)) {
      blockers.push(`capability-audit:evidence-missing:${id}:${key}`);
      continue;
    }
    if (!EVIDENCE_PATH_PATTERNS[item.kind].test(path)) {
      blockers.push(`capability-audit:evidence-kind-path-mismatch:${id}:${key}`);
    }
  }
  if (!executable) {
    blockers.push(`capability-audit:non-executable:${id}`);
  }
}

export function validateNonUiCapabilityEvidence(
  traceability,
  audit,
  { evidenceExists = () => false } = {},
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

    if (record.status === "verified") {
      if (row.status !== "verified") {
        blockers.push(`capability-audit:trace-mismatch:${row.id}`);
      }
      validateEvidenceReferences(row.id, record, evidence, evidenceExists, blockers);
      continue;
    }

    validateEvidenceReferences(row.id, record, evidence, evidenceExists, blockers);
    if (row.status === "verified") {
      blockers.push(`capability-audit:trace-mismatch:${row.id}`);
    }
    if (!record.reason?.trim()) {
      blockers.push(`capability-audit:reason-missing:${row.id}`);
    }
    if (!GAP_ISSUE.test(record.gapIssue ?? "")) {
      blockers.push(`capability-audit:gap-issue-missing:${row.id}`);
    }
  }

  return blockers;
}
