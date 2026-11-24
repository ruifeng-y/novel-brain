import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  hasRequiredCurrentHeadCiEvidence,
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
    kind: "github-actions-current-head",
    status: "required",
    workflows: [
      ".github/workflows/ci.yml",
      ".github/workflows/deployment-smoke.yml",
      ".github/workflows/readiness-validation.yml",
    ],
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
        tests: [`${id} executable evidence`],
      },
    ]),
  ),
};

const validate = (audit = completeAudit, overrides = {}) =>
  validateUiCapabilityEvidence(traceability, audit, {
    evidenceExists: () => true,
    currentHeadCiIsSuccessful: () => true,
    expectedCommit: "a".repeat(40),
    fileContains: () => true,
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

  it("requires a successful GitHub Actions run for the current head", () => {
    const audit = structuredClone(completeAudit);
    delete audit.verification;

    expect(validate(audit)).toContain("capability-audit:verification-missing");
    expect(
      validate(completeAudit, {
        currentHeadCiIsSuccessful: () => false,
      }),
    ).toContain("capability-audit:verification-evidence-missing");
    expect(
      validate(completeAudit, {
        expectedCommit: undefined,
      }),
    ).toContain("capability-audit:verification-head-missing");
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

  it("requires every verified UI capability to name an executable test marker", () => {
    const audit = structuredClone(completeAudit);
    audit.capabilities["UI-001"].tests = ["missing UI evidence test"];

    expect(validate(audit, { fileContains: () => false })).toContain(
      "capability-audit:test-missing:UI-001:missing UI evidence test",
    );
    delete audit.capabilities["UI-002"].tests;
    expect(validate(audit)).toContain("capability-audit:test-marker-missing:UI-002");
  });
});

describe("M3-238 UI capability closeout", () => {
  it("requires every UI capability to bind to the current-head CI and executable tests", () => {
    const auditPath = new URL("docs/implementation/m3-238-ui-capability-evidence.json", rootUrl);
    expect(existsSync(auditPath), `${auditPath.pathname} must exist`).toBe(true);
    if (!existsSync(auditPath)) return;

    const audit = readRootJson("docs/implementation/m3-238-ui-capability-evidence.json");
    expect(
      validateUiCapabilityEvidence(readRoot("docs/planning/v1-capability-traceability.md"), audit, {
        evidenceExists: (path) => existsSync(new URL(path, rootUrl)),
        currentHeadCiIsSuccessful: () => true,
        expectedCommit: "a".repeat(40),
        fileContains: (path, marker) => readRoot(path).includes(marker),
      }),
    ).toEqual([]);
    expect(audit.verification).toMatchObject({
      kind: "github-actions-current-head",
      status: "required",
      workflows: expect.arrayContaining([".github/workflows/ci.yml"]),
    });
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
    }

    const actionEvidence = readRootJson("docs/implementation/v1-action-evidence.json");
    expect(Object.values(actionEvidence.pages).every((page) => page.status === "verified")).toBe(
      true,
    );
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
      currentHeadCiIsSuccessful: () => true,
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

  it("keeps seven setting columns and three genre packs aligned with production specs", () => {
    const contract = readRoot("docs/ui/prototype-contract.md");
    expect(contract).toContain("7 栏、3 题材");
    const newProjectSource = readRoot("apps/web/e2e/parity/new-project.spec.ts");
    for (const genre of ["xianxia", "history", "urban"]) {
      expect(newProjectSource).toContain(genre);
    }
    expect(readRoot("apps/web/e2e/parity/settings.spec.ts")).toContain("character");
    const workStatusSource = readRoot("apps/web/components/works-dashboard.tsx");
    for (const status of ["筹备中", "连载中", "暂停", "已完本", "已归档"]) {
      expect(workStatusSource).toContain(status);
    }
    const chapterStatusSource = readRoot("apps/web/components/writing-workspace.tsx");
    for (const status of [
      "已规划",
      "写作中",
      "待审",
      "要求修改",
      "已批准",
      "已锁定",
      "已发布",
      "已驳回",
    ]) {
      expect(chapterStatusSource).toContain(status);
    }
    const contracts = readRoot("packages/contracts/src/index.ts");
    for (const schema of [
      "workStatusSchema",
      "chapterStatusSchema",
      "changeStatusSchema",
      "generationJobStatusSchema",
      "settingStatusSchema",
      "chunkedImportProgressSchema",
      "mergeItemSchema",
    ]) {
      expect(contracts, `shared contracts must define ${schema}`).toContain(schema);
    }
    const requiredStatusEnums = {
      workStatusSchema: ["draft", "preparing", "serializing", "paused", "completed", "archived"],
      chapterStatusSchema: [
        "planned",
        "writing",
        "waiting_review",
        "changes_requested",
        "approved",
        "locked",
        "published",
        "rejected",
      ],
      changeStatusSchema: [
        "draft",
        "analyzing",
        "awaiting_confirmation",
        "applying",
        "applied",
        "rejected",
        "cancelled",
        "failed",
        "branched",
      ],
      generationJobStatusSchema: [
        "queued",
        "preparing",
        "running",
        "paused",
        "waiting_review",
        "completed",
        "failed",
        "cancelled",
      ],
      settingStatusSchema: ["draft", "proposed", "locked", "discarded"],
      chunkedImportProgressSchema: [
        "queued",
        "processing",
        "awaiting_confirmation",
        "paused",
        "partial",
        "failed",
        "cancelled",
        "completed",
      ],
      mergeItemSchema: ["pending", "accepted", "rejected", "applied", "stale"],
    };
    for (const [schema, statuses] of Object.entries(requiredStatusEnums)) {
      const start = contracts.indexOf(`export const ${schema}`);
      const next = contracts.indexOf("export const ", start + 1);
      const block = contracts.slice(start, next === -1 ? undefined : next);
      expect(start, `shared contracts must define ${schema}`).toBeGreaterThanOrEqual(0);
      for (const status of statuses) {
        expect(block, `${schema} must include ${status}`).toContain(`"${status}"`);
      }
    }
  });

  it("verifies required page states for every production page", () => {
    const { productionRows } = parseUiMatrix(readRoot("docs/ui/v1-ui-parity-matrix.md"));
    const stateMarkers = {
      loading: ["正在加载", "加载中", "loading"],
      empty: ["暂无", "没有", "空", "empty"],
      error: ["失败", "错误", "error", "没有找到"],
      disabled: ["tobedisabled", "disabled"],
      permission: ["403", "permission", "权限"],
      partial: ["部分", "partial", "待准备", "readiness"],
      conflict: ["冲突", "conflict", "409"],
      locked: ["锁定", "locked"],
      proposal: ["提案", "proposal", "proposed"],
      long: ["long", "长内容", "repeat"],
      paused: ["暂停", "paused"],
      failed: ["失败", "failed"],
      readonly: ["readonly", "只读", "完成"],
      archived: ["归档", "archived"],
      "stale-version": ["stale", "旧版本", "版本冲突"],
      expired: ["过期", "expired", "410"],
      "invalid-key": ["key", "invalid", "密钥"],
      "rate-limit": ["限流", "rate-limit", "操作过于频繁", "429"],
      "session-expired": ["会话", "session", "401"],
      confirmation: ["dialog", "确认"],
      static: ["test("],
    };
    const pageStateEvidence = {
      "work-overview": {
        partial: ["shows partial overview when optional style data fails"],
      },
    };

    for (const row of productionRows) {
      const specPath = row.playwrightSpecPath.match(/`([^`]+)`/u)?.[1];
      const source = readRoot(specPath).toLowerCase();
      for (const state of row.requiredStates.split("/").map((entry) => entry.trim())) {
        const markers = pageStateEvidence[row.page]?.[state] ?? stateMarkers[state];
        expect(markers, `${row.page} has no state evidence mapping for ${state}`).toBeTruthy();
        expect(
          markers.some((marker) => source.includes(marker)),
          `${row.page} is missing executable ${state} evidence`,
        ).toBe(true);
      }
    }
  });

  it("verifies four viewport coverage for every production page", () => {
    const { productionRows } = parseUiMatrix(readRoot("docs/ui/v1-ui-parity-matrix.md"));
    for (const row of productionRows) {
      const specPath = row.playwrightSpecPath.match(/`([^`]+)`/u)?.[1];
      const source = readRoot(specPath);
      for (const viewport of ["390", "900", "1180", "1440"]) {
        expect(source, `${row.page} must cover ${viewport}px`).toContain(viewport);
      }
    }
  });

  it("verifies Playwright screenshot baselines for every production page", () => {
    const { productionRows } = parseUiMatrix(readRoot("docs/ui/v1-ui-parity-matrix.md"));
    for (const row of productionRows) {
      const specPath = row.playwrightSpecPath.match(/`([^`]+)`/u)?.[1];
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
    }
  });

  it("verifies Agent UX evidence on writing batch and changes pages", () => {
    expect(readRoot("apps/web/e2e/parity/writing.spec.ts")).toContain("本章参考");
    expect(readRoot("apps/web/e2e/parity/batch.spec.ts")).toContain("任务报告");
    expect(readRoot("apps/web/e2e/parity/changes.spec.ts")).toContain("逐对象");
  });

  it("verifies import golden-three and branch comparison surface evidence", () => {
    expect(readRoot("apps/web/e2e/parity/new-project.spec.ts")).toContain("导入");
    expect(readRoot("apps/web/e2e/parity/outline.spec.ts")).toContain("seedGoldenThree");
    expect(readRoot("apps/web/e2e/parity/changes.spec.ts")).toContain("平行版本");
  });

  it("verifies author language and prototype-only scans across all production pages", () => {
    const { productionRows } = parseUiMatrix(readRoot("docs/ui/v1-ui-parity-matrix.md"));
    for (const row of productionRows) {
      const specPath = row.playwrightSpecPath.match(/`([^`]+)`/u)?.[1];
      const source = readRoot(specPath);
      expect(source, `${row.page} must scan author-facing language`).toContain(
        "expectAuthorFacingLanguage",
      );
      expect(source, `${row.page} must scan prototype-only leakage`).toContain(
        "expectNoPrototypeOnlyLeakage",
      );
    }
  });

  it("keeps GitHub Actions evidence validation fail-closed", () => {
    const reference = "https://github.com/ruifeng-y/novel-brain/actions/runs/123";
    const headSha = "a".repeat(40);
    const run = {
      status: "completed",
      conclusion: "success",
      url: reference,
      path: ".github/workflows/ci.yml",
      headSha,
      event: "pull_request",
    };
    expect(
      isValidGithubActionsRunData(reference, run, {
        gateId: "final-production-ci",
        expectedCommit: headSha,
      }),
    ).toBe(true);
    expect(
      isValidGithubActionsRunData(
        reference,
        { ...run, conclusion: "failure" },
        {
          gateId: "final-production-ci",
          expectedCommit: headSha,
        },
      ),
    ).toBe(false);
    expect(isSuccessfulGithubActionsRun("https://github.com/example/other/actions/runs/123")).toBe(
      false,
    );
  });

  it("requires pull-request CI, deployment smoke and readiness for the current head", () => {
    const headSha = "a".repeat(40);
    const requiredRuns = [
      {
        headSha,
        path: ".github/workflows/ci.yml",
        event: "pull_request",
        status: "completed",
        conclusion: "success",
      },
      {
        headSha,
        path: ".github/workflows/deployment-smoke.yml",
        event: "pull_request",
        status: "completed",
        conclusion: "success",
      },
      {
        headSha,
        path: ".github/workflows/readiness-validation.yml",
        event: "pull_request",
        status: "completed",
        conclusion: "success",
      },
    ];

    expect(hasRequiredCurrentHeadCiEvidence(requiredRuns, headSha)).toBe(true);
    expect(
      hasRequiredCurrentHeadCiEvidence(
        requiredRuns.map((run, index) => (index === 0 ? { ...run, event: "push" } : run)),
        headSha,
      ),
    ).toBe(false);
    expect(hasRequiredCurrentHeadCiEvidence(requiredRuns.slice(0, 2), headSha)).toBe(false);
  });
});
