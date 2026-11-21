import { describe, expect, it } from "vitest";

import {
  EXECUTABLE_EVIDENCE_KINDS,
  validateNonUiCapabilityEvidence,
} from "../v1-capability-evidence.mjs";

const traceability = [
  "| ID | Capability | Scope | Status | Primary issue | Supporting | Design | Evidence | Milestone |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| ACCT-001 | 注册 | V1 | verified | #68 | — | docs | auth | M0 |",
  "| IO-001 | 导入 | V1 | implemented | #126 | — | docs | import | M2 |",
  "| UI-001 | 页面 | V1 | verified | #104 | — | docs | ui | M0 |",
  "| PERF-001 | 容量 | 后续 | deferred | — | — | docs | performance | Post-V1 |",
].join("\n");

const completeAudit = {
  schemaVersion: 1,
  evidence: {
    auth: {
      kind: "integration",
      path: "apps/api/test/auth.integration.test.ts",
    },
    import: {
      kind: "integration",
      path: "apps/api/test/manuscript-import.integration.test.ts",
    },
  },
  capabilities: {
    "ACCT-001": {
      status: "verified",
      evidence: ["auth"],
    },
    "IO-001": {
      status: "blocked",
      reason: "DOCX 导入尚未实现。",
      gapIssue: "#300",
    },
  },
};

const validate = (audit = completeAudit, overrides = {}) =>
  validateNonUiCapabilityEvidence(traceability, audit, {
    evidenceExists: () => true,
    ...overrides,
  });

describe("non-UI capability evidence audit", () => {
  it("accepts one evidence-backed record for every non-UI V1 capability", () => {
    expect(validate()).toEqual([]);
    expect(EXECUTABLE_EVIDENCE_KINDS.has("integration")).toBe(true);
    expect(EXECUTABLE_EVIDENCE_KINDS.has("manual_signoff")).toBe(false);
  });

  it("rejects missing and unexpected non-UI capability records", () => {
    const audit = structuredClone(completeAudit);
    delete audit.capabilities["ACCT-001"];
    audit.capabilities["WORK-999"] = {
      status: "blocked",
      reason: "Unknown capability.",
      gapIssue: "#301",
    };

    expect(validate(audit)).toEqual(
      expect.arrayContaining([
        "capability-audit:missing:ACCT-001",
        "capability-audit:unexpected:WORK-999",
      ]),
    );
  });

  it("rejects status drift between the audit and traceability ledger", () => {
    const audit = structuredClone(completeAudit);
    audit.capabilities["ACCT-001"] = {
      status: "blocked",
      reason: "Status mismatch.",
      gapIssue: "#302",
    };
    audit.capabilities["IO-001"] = {
      status: "verified",
      evidence: ["import"],
    };

    expect(validate(audit)).toEqual(
      expect.arrayContaining([
        "capability-audit:trace-mismatch:ACCT-001",
        "capability-audit:trace-mismatch:IO-001",
      ]),
    );
  });

  it("requires reproducible executable evidence for verified capabilities", () => {
    const audit = structuredClone(completeAudit);
    audit.evidence.auth = {
      kind: "manual_signoff",
      path: "docs/implementation/example.md",
    };

    expect(validate(audit)).toContain("capability-audit:non-executable:ACCT-001");
    audit.evidence.auth = {
      kind: "integration",
      path: "apps/api/test/auth.integration.test.ts",
    };
    expect(
      validate(audit, {
        evidenceExists: (path) => path !== "apps/api/test/auth.integration.test.ts",
      }),
    ).toContain("capability-audit:evidence-missing:ACCT-001:auth");
  });

  it("requires a bounded follow-up issue for every blocked capability", () => {
    const audit = structuredClone(completeAudit);
    audit.capabilities["IO-001"] = {
      status: "blocked",
      reason: "Missing evidence.",
    };

    expect(validate(audit)).toContain("capability-audit:gap-issue-missing:IO-001");
  });

  it("rejects evidence paths that escape the repository", () => {
    const audit = structuredClone(completeAudit);
    audit.evidence.auth.path = "../outside-repository.txt";

    expect(validate(audit)).toContain("capability-audit:evidence-missing:ACCT-001:auth");
  });
});
