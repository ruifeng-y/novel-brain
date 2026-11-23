import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  PRODUCTION_PAGE_IDS,
  STATIC_PRODUCTION_PAGE_IDS,
  isValidGoldenImage,
  parseUiMatrix,
} from "../v1-ledger.mjs";
import {
  REQUIRED_GATE_IDS,
  evaluateV1Release,
  isValidGapIssueData,
  isValidGithubActionsRunData,
  isSuccessfulGithubActionsRun,
} from "../validate-v1-release.mjs";

const pageRow = (page, status = "parity-verified") =>
  `| ${page} | #${page} | /${page} | M0 | #68 | — | API | states | prototype | \`apps/web/e2e/parity/${page}.spec.ts\` | \`artifacts/ui/golden/${page}/${page}-{390,900,1180,1440}.png\` | ${status} |`;

const uiMatrix = [
  "| Page ID | Prototype | Route | Milestone | Owner | Supporting | API | States | Prototype screens | Spec | Goldens | Status |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...PRODUCTION_PAGE_IDS.map((page) => pageRow(page)),
].join("\n");

const traceRow = (id, scope, status, primaryIssue) =>
  `| ${id} | Capability | ${scope} | ${status} | ${primaryIssue} | — | docs | evidence | M3 |`;

const verifiedTraceability = [
  "| ID | Capability | Scope | Status | Primary issue | Supporting | Design | Evidence | Milestone |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  traceRow("UI-001", "V1", "verified", "#104"),
  traceRow("PERF-001", "后续", "deferred", "—"),
].join("\n");

const passingEvidence = () => ({
  schemaVersion: 1,
  releaseStatus: "ready",
  p0Failures: [],
  waivers: [],
  gates: REQUIRED_GATE_IDS.map((id) => ({
    id,
    status: "pass",
    owner: "release-owner",
    evidence: [`evidence/${id}.txt`],
  })),
});

const actionPages = PRODUCTION_PAGE_IDS.filter(
  (page) => !STATIC_PRODUCTION_PAGE_IDS.includes(page),
);

const passingActionEvidence = () => ({
  schemaVersion: 1,
  pages: Object.fromEntries(
    actionPages.map((page) => [
      page,
      {
        status: "verified",
        requiredActions: ["primary"],
        actions: [
          {
            id: "primary",
            name: "primary action",
            api: "/api/v1/test",
            spec: `apps/web/e2e/parity/${page}.spec.ts`,
            test: "primary action persists",
            assertion: "expectPersistedResult",
          },
        ],
      },
    ]),
  ),
});

const passingActionContract = () => ({
  schemaVersion: 1,
  pages: Object.fromEntries(actionPages.map((page) => [page, ["primary"]])),
});

const passingDeviationApprovals = () => ({
  schemaVersion: 1,
  deviations: [],
});

const passingDeferrals = () => ({
  schemaVersion: 1,
  deferrals: [
    {
      id: "PERF-001",
      scope: "后续",
      status: "deferred",
      approvedBy: "product-owner",
      approvedAt: "2026-11-18",
      rationale: "Excluded from V1 claims.",
      evidence: ["docs/planning/v1-capability-manifest.md"],
    },
  ],
});

const evaluate = (overrides = {}) =>
  evaluateV1Release({
    evidence: passingEvidence(),
    traceability: verifiedTraceability,
    uiMatrix,
    deferrals: passingDeferrals(),
    actionContract: passingActionContract(),
    actionEvidence: passingActionEvidence(),
    deviationApprovals: passingDeviationApprovals(),
    evidenceExists: () => true,
    githubRunIsSuccessful: () => true,
    fileContains: () => true,
    goldenIsValid: () => true,
    expectedCommit: "abc123",
    ...overrides,
  });

describe("V1 release gate", () => {
  it("passes only with required gates, evidence and complete UI parity", () => {
    expect(evaluate()).toEqual({
      ready: true,
      blockers: [],
    });
  });

  it("blocks open gates, P0 failures, invalid waivers and incomplete pages", () => {
    const evidence = passingEvidence();
    evidence.gates.find((gate) => gate.id === "real-provider-smoke").status = "blocked";
    evidence.gates.find((gate) => gate.id === "human-blind-review").status = "blocked";
    evidence.releaseStatus = "blocked";
    evidence.p0Failures = [{ id: "canon-loss-1" }];
    evidence.waivers = [
      { gateId: "real-provider-smoke" },
      { gateId: "capacity-claim", owner: "product-owner", rationale: "Unknown gate." },
    ];
    const blockedTraceability = [
      "| ID | Capability | Scope | Status | Primary issue | Supporting | Design | Evidence | Milestone |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      traceRow("UI-001", "V1", "verified", "#104"),
      traceRow("EVAL-003", "V1", "implemented", "#140"),
      traceRow("PERF-001", "V1", "verified", "#137"),
    ].join("\n");
    const incompleteMatrix = uiMatrix.replace(pageRow("auth"), pageRow("auth", "production-built"));

    const result = evaluate({
      evidence,
      traceability: blockedTraceability,
      uiMatrix: incompleteMatrix,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "real-provider-smoke:blocked",
        "human-blind-review:blocked",
        "release-evidence:status-blocked",
        "capability-verification:1:EVAL-003:implemented",
        "deferral:PERF-001:trace-mismatch",
        "p0:canon-loss-1",
        "waiver:real-provider-smoke:owner-or-rationale-missing",
        "waiver:capacity-claim:unknown-gate",
        "auth:production-built",
      ]),
    );
  });

  it("rejects pass gates that point at missing evidence", () => {
    const evidence = passingEvidence();
    evidence.gates.find((gate) => gate.id === "security-lifecycle").evidence = [
      "evidence/missing.txt",
    ];
    const result = evaluate({
      evidence,
      evidenceExists: (path) => path !== "evidence/missing.txt",
    });

    expect(result.blockers).toContain("security-lifecycle:missing-evidence:evidence/missing.txt");
  });

  it("rejects unknown capabilities even when they claim a passing gate", () => {
    const evidence = passingEvidence();
    evidence.gates.push({
      id: "capacity-claim",
      status: "pass",
      owner: "product-owner",
      rationale: "Excluded from V1 claims.",
      evidence: ["docs/performance/v1-10m-capacity-benchmark.md"],
    });
    const result = evaluate({
      evidence,
    });

    expect(result.blockers).toContain("capacity-claim:unknown-gate");
  });

  it("rejects an unregistered capability deferral", () => {
    const blockedTraceability = [
      "| ID | Capability | Scope | Status | Primary issue | Supporting | Design | Evidence | Milestone |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      traceRow("UI-001", "V1", "verified", "#104"),
      traceRow("EVAL-003", "后续", "deferred", "—"),
      traceRow("PERF-001", "后续", "deferred", "—"),
    ].join("\n");
    const deferrals = passingDeferrals();
    deferrals.deferrals.push({
      id: "EVAL-003",
      scope: "后续",
      status: "deferred",
      approvedBy: "product-owner",
      approvedAt: "2026-11-18",
      rationale: "Attempted silent deferral.",
      evidence: ["docs/planning/v1-capability-manifest.md"],
    });
    const result = evaluate({ traceability: blockedTraceability, deferrals });

    expect(result.blockers).toContain("deferral:EVAL-003:authorization-invalid");
  });

  it("rejects GitHub Actions evidence that is not a successful completed run", () => {
    const evidence = passingEvidence();
    const reference = "https://github.com/ruifeng-y/novel-brain/actions/runs/123";
    evidence.gates.find((gate) => gate.id === "security-lifecycle").evidence = [reference];
    const result = evaluate({
      evidence,
      githubRunIsSuccessful: () => false,
    });

    expect(result.blockers).toContain(`security-lifecycle:missing-evidence:${reference}`);
  });

  it("requires recorded approval and four goldens for deviation-approved pages", () => {
    const deviationMatrix = uiMatrix.replace(
      pageRow("auth"),
      pageRow("auth", "deviation-approved"),
    );
    const result = evaluate({ uiMatrix: deviationMatrix });

    expect(result.blockers).toContain("auth:deviation-approval-missing");
  });

  it("accepts a complete deviation approval with four reproducible goldens", () => {
    const deviationMatrix = uiMatrix.replace(
      pageRow("auth"),
      pageRow("auth", "deviation-approved"),
    );
    const deviationApprovals = {
      schemaVersion: 1,
      deviations: [
        {
          page: "auth",
          approvedBy: "product-owner",
          approvedAt: "2026-11-18",
          scope: "Login layout",
          rationale: "Approved replacement baseline.",
          replacementBaseline: "docs/ui/prototype-contract.md#auth",
          documentMarker: "deviation:auth",
          updatedDocuments: [
            "docs/ui/prototype-contract.md",
            "docs/ui/v1-ui-parity-matrix.md",
            "docs/ui/v1-prototype-signoff.md",
          ],
          evidence: ["docs/ui/production-visual-regression.md"],
        },
      ],
    };
    const result = evaluate({ uiMatrix: deviationMatrix, deviationApprovals });

    expect(result.ready).toBe(true);
  });

  it("keeps per-action persistence evidence fail-closed while it is pending", () => {
    const actionEvidence = passingActionEvidence();
    actionEvidence.pages.auth = {
      requiredActions: ["primary"],
      status: "pending",
      rationale: "Action-level persistence audit is incomplete.",
    };
    const result = evaluate({ actionEvidence });

    expect(result.blockers).toContain("action-evidence:1:pending:auth");
  });

  it("verifies deviation document markers instead of trusting path lists", () => {
    const deviationMatrix = uiMatrix.replace(
      pageRow("auth"),
      pageRow("auth", "deviation-approved"),
    );
    const deviationApprovals = {
      schemaVersion: 1,
      deviations: [
        {
          page: "auth",
          approvedBy: "product-owner",
          approvedAt: "2026-11-18",
          scope: "Login layout",
          rationale: "Approved replacement baseline.",
          replacementBaseline: "docs/ui/prototype-contract.md#auth",
          documentMarker: "deviation:auth",
          updatedDocuments: [
            "docs/ui/prototype-contract.md",
            "docs/ui/v1-ui-parity-matrix.md",
            "docs/ui/v1-prototype-signoff.md",
          ],
          evidence: ["docs/ui/production-visual-regression.md"],
        },
      ],
    };
    const result = evaluate({
      uiMatrix: deviationMatrix,
      deviationApprovals,
      fileContains: () => false,
    });

    expect(result.blockers).toContain(
      "auth:deviation-document-unverified:docs/ui/prototype-contract.md",
    );
  });

  it("normalizes evidence paths before rejecting self-referential deviations", () => {
    const deviationMatrix = uiMatrix.replace(
      pageRow("auth"),
      pageRow("auth", "deviation-approved"),
    );
    const deviationApprovals = {
      schemaVersion: 1,
      deviations: [
        {
          page: "auth",
          approvedBy: "product-owner",
          approvedAt: "2026-11-18",
          scope: "Login layout",
          rationale: "Approved replacement baseline.",
          replacementBaseline: "docs/ui/prototype-contract.md#auth",
          documentMarker: "deviation:auth",
          updatedDocuments: [
            "./docs/ui/prototype-contract.md",
            "docs/ui/v1-ui-parity-matrix.md",
            "docs/ui/v1-prototype-signoff.md",
          ],
          evidence: ["docs\\ui\\prototype-contract.md"],
        },
      ],
    };
    const result = evaluate({ uiMatrix: deviationMatrix, deviationApprovals });

    expect(result.blockers).toContain("auth:deviation-evidence-self-referential");
  });

  it("propagates non-UI capability audit blockers through the release gate", () => {
    const blockedTraceability = [
      "| ID | Capability | Scope | Status | Primary issue | Supporting | Design | Evidence | Milestone |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      traceRow("UI-001", "V1", "verified", "#104"),
      traceRow("IO-001", "V1", "implemented", "#126"),
      traceRow("PERF-001", "后续", "deferred", "—"),
    ].join("\n");
    const result = evaluate({
      traceability: blockedTraceability,
      capabilityEvidence: {
        schemaVersion: 1,
        evidence: {},
        capabilities: {},
      },
    });

    expect(result.blockers).toContain("capability-audit:missing:IO-001");
  });

  it("requires action evidence to cover the declared required action IDs", () => {
    const actionContract = passingActionContract();
    actionContract.pages.auth.push("secondary");
    const result = evaluate({ actionContract });

    expect(result.blockers).toContain("action-evidence:incomplete:auth");
  });

  it("binds each action evidence entry to the page owner spec", () => {
    const actionEvidence = passingActionEvidence();
    actionEvidence.pages.auth.actions[0].spec = "apps/web/e2e/parity/dashboard.spec.ts";
    const result = evaluate({ actionEvidence });

    expect(result.blockers).toContain("action-evidence:incomplete:auth");
  });

  it("validates four real Golden images for every release-approved page", () => {
    const result = evaluate({
      goldenIsValid: (path) => !path.includes("/auth/"),
    });

    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "auth:golden-invalid:artifacts/ui/golden/auth/auth-390.png",
        "auth:golden-invalid:artifacts/ui/golden/auth/auth-900.png",
        "auth:golden-invalid:artifacts/ui/golden/auth/auth-1180.png",
        "auth:golden-invalid:artifacts/ui/golden/auth/auth-1440.png",
      ]),
    );
  });

  it("rejects GitHub Actions evidence from a different repository", () => {
    expect(
      isSuccessfulGithubActionsRun("https://github.com/example/other-repository/actions/runs/123"),
    ).toBe(false);
  });

  it("binds final Production CI to the expected workflow and commit", () => {
    const reference = "https://github.com/ruifeng-y/novel-brain/actions/runs/123";
    const baseRun = {
      status: "completed",
      conclusion: "success",
      url: reference,
      path: ".github/workflows/ci.yml",
      headSha: "abc123",
      event: "pull_request",
    };
    expect(
      isValidGithubActionsRunData(reference, baseRun, {
        gateId: "final-production-ci",
        expectedCommit: "abc123",
      }),
    ).toBe(true);
    expect(
      isValidGithubActionsRunData(
        reference,
        { ...baseRun, headSha: "old-commit" },
        { gateId: "final-production-ci", expectedCommit: "abc123" },
      ),
    ).toBe(false);
    expect(
      isValidGithubActionsRunData(
        reference,
        { ...baseRun, event: "workflow_dispatch" },
        { gateId: "final-production-ci", expectedCommit: "abc123" },
      ),
    ).toBe(false);
  });

  it("accepts only open, bounded follow-up issues for capability gaps", () => {
    const reference = "#261";
    const issue = {
      state: "open",
      title: "补齐 DOCX 导入",
      labels: ["ready-for-agent", "m3"],
    };
    expect(isValidGapIssueData(reference, issue)).toBe(true);
    expect(isValidGapIssueData(reference, { ...issue, state: "CLOSED" })).toBe(false);
    expect(isValidGapIssueData(reference, { ...issue, labels: ["m3"] })).toBe(false);
    expect(isValidGapIssueData("999", issue)).toBe(false);
  });

  it("rejects truncated pseudo-PNG evidence", () => {
    expect(isValidGoldenImage(Buffer.alloc(24), "390")).toBe(false);
  });

  it("requires real API and non-mock evidence for every action page", () => {
    const matrix = readFileSync(
      new URL("../../docs/ui/v1-ui-parity-matrix.md", import.meta.url),
      "utf8",
    );
    const { productionRows } = parseUiMatrix(matrix);
    expect(productionRows).toHaveLength(17);
    const staticPages = new Set(STATIC_PRODUCTION_PAGE_IDS);
    for (const row of productionRows) {
      const specPath = row.playwrightSpecPath.match(/`([^`]+)`/u)?.[1];
      expect(specPath, `${row.page} must declare a Playwright spec`).toBeTruthy();
      const source = readFileSync(new URL(`../../${specPath}`, import.meta.url), "utf8");
      expect(row.actionApiContract, `${row.page} must map visible actions to APIs`).toBeTruthy();
      expect(row.requiredStates, `${row.page} must declare required states`).toBeTruthy();
      expect(source, `${row.page} must scan for prototype-only leakage`).toContain(
        "expectNoPrototypeOnlyLeakage",
      );
      expect(source, `${row.page} must reject mock-success controls`).not.toMatch(
        /\b(?:fakeAction|mockApi|mockSuccess|toastOnly)\b/iu,
      );
      if (!staticPages.has(row.page)) {
        expect(
          source,
          `${row.page} must exercise the real request API rather than mock success`,
        ).toMatch(
          /\bpage\.request\b|\brequest\.(?:delete|get|patch|post|put)\b|\bregisterUser\(request\b/u,
        );
      }
    }
  });

  it("keeps prototype-contract page status aligned with the parity matrix", () => {
    const matrix = readFileSync(
      new URL("../../docs/ui/v1-ui-parity-matrix.md", import.meta.url),
      "utf8",
    );
    const contract = readFileSync(
      new URL("../../docs/ui/prototype-contract.md", import.meta.url),
      "utf8",
    );
    const { productionRows } = parseUiMatrix(matrix);
    const contractStatuses = new Map();
    for (const line of contract.split(/\r?\n/u)) {
      if (!/^\|\s*[a-z-]+\s*\|/u.test(line)) continue;
      const cells = line.split("|").map((cell) => cell.trim());
      contractStatuses.set(cells[1], cells[6]?.split(/[；;]/u)[0].trim());
    }
    for (const row of productionRows) {
      expect(contractStatuses.get(row.page), `${row.page} status drift`).toBe(row.status);
    }
  });
});
