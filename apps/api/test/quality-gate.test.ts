import { describe, expect, it } from "vitest";

import { qualityGateFromFindings, type OpenQualityFinding } from "../src/review/quality-gate";

function finding(overrides: Partial<OpenQualityFinding> = {}): OpenQualityFinding {
  return {
    id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a01",
    code: "STYLE_DRIFT",
    severity: "P2",
    structural: false,
    recommendation: "收紧感叹和句长。",
    ...overrides,
  };
}

describe("quality downstream gates", () => {
  const freshReport = { state: "fresh" as const, reportId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a3a02" };

  it("blocks approval and canon submission when the current version has no fresh report", () => {
    const gate = qualityGateFromFindings([]);
    expect(gate).toMatchObject({
      canApprove: false,
      canCommitCanon: false,
      reportState: "missing",
      reportId: null,
    });
  });

  it("blocks approval and canon submission for open P0/P1 findings", () => {
    for (const severity of ["P0", "P1"] as const) {
      const gate = qualityGateFromFindings([finding({ severity })], freshReport);
      expect(gate.canApprove).toBe(false);
      expect(gate.canCommitCanon).toBe(false);
      expect(gate.blockers).toEqual([expect.objectContaining({ severity, gate: "both" })]);
    }
  });

  it("blocks canon submission for structural conflicts even below P1", () => {
    const gate = qualityGateFromFindings([finding({ structural: true })], freshReport);

    expect(gate.canApprove).toBe(true);
    expect(gate.canCommitCanon).toBe(false);
    expect(gate.blockers).toEqual([
      expect.objectContaining({ gate: "canon_commit", severity: "P2" }),
    ]);
  });

  it("allows low-risk non-structural findings to proceed", () => {
    const gate = qualityGateFromFindings([finding()], freshReport);

    expect(gate).toEqual({
      canApprove: true,
      canCommitCanon: true,
      reportState: "fresh",
      reportId: freshReport.reportId,
      blockers: [],
    });
  });
});
