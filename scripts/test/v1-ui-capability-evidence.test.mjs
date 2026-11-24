import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isSuccessfulGithubActionsRun,
  isValidGithubActionsRunData,
  evaluateV1Release,
} from "../validate-v1-release.mjs";
import { validateUiCapabilityEvidence } from "../v1-capability-evidence.mjs";
import { PRODUCTION_PAGE_IDS, parseUiMatrix } from "../v1-ledger.mjs";

const uiCapabilityIds = Array.from(
  { length: 9 },
  (_, index) => `UI-${String(index + 1).padStart(3, "0")}`,
);

const traceability = [
  "| ID | Capability | Scope | Status | Primary issue | Supporting | Design | Evidence | Milestone |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...uiCapabilityIds.map(
    (id) => `| ${id} | capability | V1 | verified | #104 | — | docs | evidence | M3 |`,
  ),
  "| PERF-001 | capacity | 后续 | deferred | — | — | docs | evidence | Post-V1 |",
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
    surface: {
      kind: "e2e",
      path: "apps/web/e2e/parity/auth.spec.ts",
    },
    guardrail: {
      kind: "guardrail",
      path: "scripts/test/v1-ui-capability-evidence.test.mjs",
    },
  },
  capabilities: Object.fromEntries(
    uiCapabilityIds.map((id) => [
      id,
      {
        status: "verified",
        evidence: ["surface", "guardrail"],
      },
    ]),
  ),
};

const validate = (audit = completeAudit, overrides = {}) =>
  validateUiCapabilityEvidence(traceability, audit, {
    evidenceExists: () => true,
    auditCiRunIsValid: () => true,
    githubRunIsSuccessful: () => true,
    ...overrides,
  });

const rootUrl = new URL("../../", import.meta.url);
const readRoot = (path) => readFileSync(new URL(path, rootUrl), "utf8");
const readRootJson = (path) => JSON.parse(readRoot(path));

describe("UI capability evidence audit", () => {
  it("accepts one evidence-backed verified record for every UI V1 capability", () => {
    expect(validate()).toEqual([]);
  });

  it("rejects missing and unexpected UI capability records", () => {
    const audit = structuredClone(completeAudit);
    delete audit.capabilities["UI-001"];
    audit.capabilities["UI-999"] = {
      status: "verified",
      evidence: ["surface"],
    };

    expect(validate(audit)).toEqual(
      expect.arrayContaining([
        "capability-audit:missing:UI-001",
        "capability-audit:unexpected:UI-999",
      ]),
    );
  });

  it("requires a successful CI run bound to the audited head", () => {
    const audit = structuredClone(completeAudit);
    delete audit.verification;

    expect(validate(audit)).toContain("capability-audit:verification-missing");
    expect(
      validate(completeAudit, {
        auditCiRunIsValid: () => false,
      }),
    ).toContain("capability-audit:verification-evidence-missing");
  });

  it("requires executable evidence and exact traceability status parity", () => {
    const audit = structuredClone(completeAudit);
    audit.evidence.surface = {
      kind: "manual_signoff",
      path: "docs/ui/v1-ui-parity-matrix.md",
    };
    audit.capabilities["UI-001"].evidence = ["surface"];
    audit.capabilities["UI-002"].status = "implemented";
    audit.capabilities["UI-002"].gap = {
      reason: "Status mismatch.",
      issue: "#300",
    };

    expect(validate(audit)).toEqual(
      expect.arrayContaining([
        "capability-audit:non-executable:UI-001",
        "capability-audit:trace-mismatch:UI-002",
      ]),
    );
  });
});

describe("M3-238 UI capability closeout", () => {
  it("binds every UI capability to reproducible tests and the current green CI baseline", () => {
    const auditPath = new URL("docs/implementation/m3-238-ui-capability-evidence.json", rootUrl);
    expect(existsSync(auditPath), `${auditPath.pathname} must exist`).toBe(true);
    if (!existsSync(auditPath)) return;

    const audit = readRootJson("docs/implementation/m3-238-ui-capability-evidence.json");
    expect(
      validateUiCapabilityEvidence(readRoot("docs/planning/v1-capability-traceability.md"), audit, {
        evidenceExists: (path) => existsSync(new URL(path, rootUrl)),
        auditCiRunIsValid: () => true,
        githubRunIsSuccessful: () => true,
      }),
    ).toEqual([]);
    expect(audit.verification.headSha).toBe("491d059e2d08c787758b31f1a72c5ef652800570");
  });

  it("keeps the 17-page matrix, per-action evidence and release ledger aligned", () => {
    const matrix = readRoot("docs/ui/v1-ui-parity-matrix.md");
    const { productionRows } = parseUiMatrix(matrix);
    expect(productionRows).toHaveLength(PRODUCTION_PAGE_IDS.length);
    expect(new Set(productionRows.map((row) => row.page))).toEqual(new Set(PRODUCTION_PAGE_IDS));
    for (const row of productionRows) {
      expect(["parity-verified", "deviation-approved"]).toContain(row.status);
      expect(row.requiredStates.trim().length).toBeGreaterThan(0);
      const specPath = row.playwrightSpecPath.match(/`([^`]+)`/u)?.[1];
      expect(specPath).toBeTruthy();
      const source = readRoot(specPath);
      const screenshotSource = source.includes("toHaveScreenshot")
        ? source
        : readRoot("apps/web/e2e/parity/m0-closeout.spec.ts");
      expect(screenshotSource, `${row.page} must compare production screenshots`).toContain(
        "toHaveScreenshot",
      );
      if (!source.includes("toHaveScreenshot")) {
        expect(
          screenshotSource,
          `${row.page} screenshot comparison must live in an aggregate M0 spec`,
        ).toContain(row.page);
      }
      expect(source, `${row.page} must scan author-facing language`).toContain(
        "expectAuthorFacingLanguage",
      );
      expect(source, `${row.page} must scan prototype-only leakage`).toContain(
        "expectNoPrototypeOnlyLeakage",
      );
      for (const viewport of ["390", "900", "1180", "1440"]) {
        expect(source, `${row.page} must cover ${viewport}px`).toContain(viewport);
      }
    }

    const releaseEvidence = readRootJson("docs/implementation/v1-release-evidence.json");
    expect(releaseEvidence.gates.find((gate) => gate.id === "ui-parity")).toMatchObject({
      status: "pass",
    });
  });

  it("leaves only release-level blockers after UI and traceability verification", () => {
    const audit = readRootJson("docs/implementation/m3-238-ui-capability-evidence.json");
    const result = evaluateV1Release({
      evidence: readRootJson("docs/implementation/v1-release-evidence.json"),
      traceability: readRoot("docs/planning/v1-capability-traceability.md"),
      uiCapabilityEvidence: audit,
      capabilityEvidence: readRootJson(
        "docs/implementation/m3-236-non-ui-capability-evidence.json",
      ),
      uiMatrix: readRoot("docs/ui/v1-ui-parity-matrix.md"),
      deferrals: readRootJson("docs/planning/v1-deferrals.json"),
      deviationApprovals: readRootJson("docs/ui/v1-ui-deviations.json"),
      actionContract: readRootJson("docs/ui/v1-action-contract.json"),
      actionEvidence: readRootJson("docs/implementation/v1-action-evidence.json"),
      evidenceExists: () => true,
      githubRunIsSuccessful: () => true,
      auditCiRunIsValid: () => true,
      gapIssueIsValid: () => true,
      fileContains: () => true,
      goldenIsValid: () => true,
      expectedCommit: "a".repeat(40),
    });

    expect(result.blockers.filter((blocker) => /UI-\d{3}|ui-parity/u.test(blocker))).toEqual([]);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "capability-verification:4:EVAL-002:implemented,EVAL-003:implemented,EVAL-004:implemented,CONT-001:implemented",
        "release-evidence:status-blocked",
      ]),
    );
  });

  it("keeps UI contract tokens and the component inventory executable", () => {
    const contract = readRoot("docs/ui/prototype-contract.md");
    const productionStyles = readRoot("apps/web/app/globals.css");
    for (const token of [
      "--ink",
      "--paper",
      "--cinnabar",
      "--jade",
      "--gold",
      "--blue",
      "--radius",
      "--sidebar",
    ]) {
      expect(contract, `prototype contract must document ${token}`).toContain(token);
      expect(productionStyles, `production styles must define ${token}`).toContain(token);
    }
    for (const component of [
      "壳层/侧栏",
      "顶栏/面包屑",
      "站内通知抽屉",
      "按钮/图标按钮",
      "弹窗/抽屉",
      "质量报告",
      "版本图",
      "对比",
    ]) {
      expect(contract, `component inventory must include ${component}`).toContain(component);
    }
  });

  it("keeps GitHub Actions evidence validation fail-closed", () => {
    const reference = "https://github.com/ruifeng-y/novel-brain/actions/runs/45332565381";
    const run = {
      status: "completed",
      conclusion: "success",
      url: reference,
      path: ".github/workflows/ci.yml",
      headSha: "491d059e2d08c787758b31f1a72c5ef652800570",
      event: "pull_request",
    };
    expect(
      isValidGithubActionsRunData(reference, run, {
        gateId: "final-production-ci",
        expectedCommit: "491d059e2d08c787758b31f1a72c5ef652800570",
      }),
    ).toBe(true);
    expect(
      isValidGithubActionsRunData(
        reference,
        { ...run, conclusion: "failure" },
        {
          gateId: "final-production-ci",
          expectedCommit: "491d059e2d08c787758b31f1a72c5ef652800570",
        },
      ),
    ).toBe(false);
    expect(
      isSuccessfulGithubActionsRun("https://github.com/example/other/actions/runs/45332565381"),
    ).toBe(false);
  });
});
