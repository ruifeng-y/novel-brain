import { describe, expect, it } from "vitest";

import {
  REQUIRED_FAILURE_SCENARIOS,
  validateFailureInjectionEvidence,
  type FailureInjectionEvidence,
} from "../src/failure-injection";

describe("failure injection evidence", () => {
  it("requires every scenario with an evidence path", () => {
    const evidence: FailureInjectionEvidence = {
      status: "passed",
      runId: "capacity-test-run",
      sourceCommit: "a".repeat(40),
      scenarios: REQUIRED_FAILURE_SCENARIOS.map((id) => ({
        id,
        status: "passed",
        evidencePath: `failure-injection/${id}.json`,
        observedAt: "2026-11-17T00:00:00.000Z",
      })),
    };

    expect(
      validateFailureInjectionEvidence(evidence, {
        runId: evidence.runId,
        sourceCommit: evidence.sourceCommit,
      }),
    ).toBe(true);
  });

  it("rejects shell evidence without the required scenarios", () => {
    expect(
      validateFailureInjectionEvidence(
        {
          status: "passed",
          runId: "capacity-test-run",
          sourceCommit: "a".repeat(40),
          scenarios: [],
        },
        {
          runId: "capacity-test-run",
          sourceCommit: "a".repeat(40),
        },
      ),
    ).toBe(false);
  });

  it("rejects another workload run or a failed scenario", () => {
    const evidence: FailureInjectionEvidence = {
      status: "passed",
      runId: "capacity-test-run",
      sourceCommit: "a".repeat(40),
      scenarios: REQUIRED_FAILURE_SCENARIOS.map((id) => ({
        id,
        status: id === "disk_pressure" ? "failed" : "passed",
        evidencePath: `failure-injection/${id}.json`,
        observedAt: "2026-11-17T00:00:00.000Z",
      })),
    };

    expect(
      validateFailureInjectionEvidence(evidence, {
        runId: "capacity-stale",
        sourceCommit: evidence.sourceCommit,
      }),
    ).toBe(false);
    expect(
      validateFailureInjectionEvidence(evidence, {
        runId: evidence.runId,
        sourceCommit: evidence.sourceCommit,
      }),
    ).toBe(false);
  });
});
