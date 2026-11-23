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
  verification: {
    kind: "ci",
    status: "passed",
    path: "https://github.com/ruifeng-y/novel-brain/actions/runs/123",
    headSha: "a".repeat(40),
  },
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
      status: "implemented",
      evidence: ["import"],
      gap: {
        reason: "DOCX 导入尚未实现。",
        issue: "#300",
      },
    },
  },
};

const validate = (audit = completeAudit, overrides = {}) =>
  validateNonUiCapabilityEvidence(traceability, audit, {
    evidenceExists: () => true,
    auditCiRunIsValid: () => true,
    gapIssueIsValid: () => true,
    githubRunIsSuccessful: () => true,
    ...overrides,
  });

describe("non-UI capability evidence audit", () => {
  it("accepts one evidence-backed record for every non-UI V1 capability", () => {
    expect(validate()).toEqual([]);
    expect(EXECUTABLE_EVIDENCE_KINDS.has("integration")).toBe(true);
    expect(EXECUTABLE_EVIDENCE_KINDS.has("manual_signoff")).toBe(false);
    expect(EXECUTABLE_EVIDENCE_KINDS.has("ci")).toBe(false);
  });

  it("rejects missing and unexpected non-UI capability records", () => {
    const audit = structuredClone(completeAudit);
    delete audit.capabilities["ACCT-001"];
    audit.capabilities["WORK-999"] = {
      status: "implemented",
      evidence: ["import"],
      gap: {
        reason: "Unknown capability.",
        issue: "#301",
      },
    };

    expect(validate(audit)).toEqual(
      expect.arrayContaining([
        "capability-audit:missing:ACCT-001",
        "capability-audit:unexpected:WORK-999",
      ]),
    );
  });

  it("requires a passed machine test run before any capability is verified", () => {
    const audit = structuredClone(completeAudit);
    delete audit.verification;

    expect(validate(audit)).toContain("capability-audit:verification-missing");
  });

  it("requires the recorded CI run to match the audited code head", () => {
    expect(
      validate(completeAudit, {
        auditCiRunIsValid: () => false,
      }),
    ).toContain("capability-audit:verification-evidence-missing");
  });

  it("rejects status drift between the audit and traceability ledger", () => {
    const audit = structuredClone(completeAudit);
    audit.capabilities["ACCT-001"] = {
      status: "implemented",
      evidence: ["auth"],
      gap: {
        reason: "Status mismatch.",
        issue: "#302",
      },
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
      status: "implemented",
      evidence: ["import"],
    };

    expect(validate(audit)).toContain("capability-audit:gap-issue-missing:IO-001");
  });

  it("rejects mapped capabilities that claim implemented evidence", () => {
    const mappedTraceability = traceability.replace(
      "| IO-001 | 导入 | V1 | implemented",
      "| IO-001 | 导入 | V1 | mapped",
    );
    const blockers = validateNonUiCapabilityEvidence(mappedTraceability, completeAudit, {
      evidenceExists: () => true,
      auditCiRunIsValid: () => true,
      gapIssueIsValid: () => true,
      githubRunIsSuccessful: () => true,
    });

    expect(blockers).toContain("capability-audit:trace-mismatch:IO-001");
  });

  it("requires the referenced follow-up issue to be open and bounded", () => {
    expect(
      validate(completeAudit, {
        gapIssueIsValid: () => false,
      }),
    ).toContain("capability-audit:gap-issue-invalid:IO-001:#300");
  });

  it("requires existing partial evidence for every implemented capability", () => {
    const audit = structuredClone(completeAudit);
    delete audit.capabilities["IO-001"].evidence;

    expect(validate(audit)).toContain("capability-audit:evidence-empty:IO-001");
  });

  it("rejects evidence paths that escape the repository", () => {
    const audit = structuredClone(completeAudit);
    audit.evidence.auth.path = "../outside-repository.txt";

    expect(validate(audit)).toContain("capability-audit:evidence-missing:ACCT-001:auth");
  });

  it("rejects evidence kinds that do not match the referenced file type", () => {
    const audit = structuredClone(completeAudit);
    audit.evidence.auth.path = "docs/implementation/example.md";

    expect(validate(audit)).toContain("capability-audit:evidence-kind-path-mismatch:ACCT-001:auth");
  });
});
