import { describe, expect, it } from "vitest";

import { APPROVED_TARGETS, DECISION_REQUIRED_TARGETS, compareTargets } from "../src/targets";
import { buildBenchmarkReport } from "../src/report";

describe("capacity benchmark release report", () => {
  it("passes approved p95 targets while leaving p99 open", () => {
    const comparison = compareTargets({
      interactiveReadP95Ms: 299,
      searchP95Ms: 999,
      firstTokenMs: 4_999,
      sseDeliveryP95Ms: 999,
      measuredRpoHours: 1,
      measuredRtoHours: 1,
      interactiveReadP99Ms: 500,
      apiErrorRate: 0,
    });

    expect(comparison.approved.find((target) => target.id === "crud-p95")).toMatchObject({
      measured: 299,
      target: 300,
      status: "pass",
    });
    expect(comparison.approved.find((target) => target.id === "search-p95")).toMatchObject({
      status: "pass",
    });
    expect(comparison.decisionRequired.find((target) => target.id === "p99-latency")).toMatchObject(
      {
        measured: 500,
        status: "decision-required",
      },
    );
    expect(APPROVED_TARGETS.map((target) => target.id)).toContain("restore-rto");
    expect(DECISION_REQUIRED_TARGETS.map((target) => target.id)).toContain("storage-headroom");
  });

  it("blocks ten-million readiness when recovery evidence is missing", () => {
    const report = buildBenchmarkReport({
      sourceCommit: "64b9909fb1a2af410a97f239c68d0400eebf87bb",
      fixtureManifest: {
        logicalCharacters: 10_000_000,
        chapterCount: 3_500,
        volumeCount: 35,
        branchCount: 3,
        sha256: "a".repeat(64),
      },
      workloadManifest: { apiConcurrency: 4, durationSeconds: 60 },
      targetComparison: compareTargets({
        interactiveReadP95Ms: 100,
        searchP95Ms: 200,
        firstTokenMs: 1_000,
        sseDeliveryP95Ms: 100,
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        interactiveReadP99Ms: 200,
        apiErrorRate: 0,
      }),
      recovery: null,
      decisions: [],
      rawArtifacts: ["raw/samples.ndjson", "summary.json"],
    });

    expect(report.tenMReady).toBe(false);
    expect(report.status).toBe("blocked");
    expect(report.blockers).toEqual(
      expect.arrayContaining(["recovery-evidence-missing", "decision-required:p99-latency"]),
    );
  });

  it("never declares readiness from throughput or an incomplete report", () => {
    const report = buildBenchmarkReport({
      sourceCommit: "64b9909fb1a2af410a97f239c68d0400eebf87bb",
      fixtureManifest: {
        logicalCharacters: 9_000_000,
        chapterCount: 3_000,
        volumeCount: 30,
        branchCount: 3,
        sha256: "b".repeat(64),
      },
      workloadManifest: { apiConcurrency: 4, durationSeconds: 60 },
      targetComparison: compareTargets({
        interactiveReadP95Ms: 100,
        searchP95Ms: 200,
        firstTokenMs: 1_000,
        sseDeliveryP95Ms: 100,
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        interactiveReadP99Ms: 200,
        apiErrorRate: 0,
      }),
      recovery: {
        status: "passed",
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        databaseIntegrity: true,
        objectIntegrity: true,
        evidencePath: "recovery/evidence.json",
      },
      decisions: DECISION_REQUIRED_TARGETS.map((target) => ({
        id: target.id,
        approved: true,
        owner: "容量负责人",
        rationale: `批准 ${target.id}`,
        approvedThreshold: "approved",
        decidedAt: "2026-11-17T00:00:00.000Z",
      })),
      rawArtifacts: ["raw/samples.ndjson", "summary.json"],
    });

    expect(report.tenMReady).toBe(false);
    expect(report.blockers).toContain("fixture-is-not-10m");
  });

  it("does not certify a run measured outside the approved host baseline", () => {
    const report = buildBenchmarkReport({
      sourceCommit: "64b9909fb1a2af410a97f239c68d0400eebf87bb",
      fixtureManifest: {
        logicalCharacters: 10_000_000,
        chapterCount: 3_500,
        volumeCount: 35,
        branchCount: 4,
        sha256: "c".repeat(64),
      },
      workloadManifest: { apiConcurrency: 4, durationSeconds: 60 },
      targetComparison: compareTargets({
        interactiveReadP95Ms: 100,
        searchP95Ms: 200,
        firstTokenMs: 1_000,
        sseDeliveryP95Ms: 100,
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        interactiveReadP99Ms: 200,
        apiErrorRate: 0,
      }),
      recovery: {
        status: "passed",
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        databaseIntegrity: true,
        objectIntegrity: true,
        evidencePath: "recovery/evidence.json",
      },
      decisions: DECISION_REQUIRED_TARGETS.map((target) => ({
        id: target.id,
        approved: true,
        owner: "容量负责人",
        rationale: `批准 ${target.id}`,
        approvedThreshold: "approved",
        decidedAt: "2026-11-17T00:00:00.000Z",
      })),
      environment: {
        baseline: {
          certificationEligible: false,
        },
      },
      rawArtifacts: ["raw/samples.ndjson", "summary.json"],
    });

    expect(report.tenMReady).toBe(false);
    expect(report.blockers).toContain("environment-not-approved-baseline");
  });

  it("does not accept an approval without owner, rationale, threshold, and decision time", () => {
    const report = buildBenchmarkReport({
      sourceCommit: "64b9909fb1a2af410a97f239c68d0400eebf87bb",
      fixtureManifest: {
        logicalCharacters: 10_000_000,
        chapterCount: 3_500,
        volumeCount: 35,
        branchCount: 4,
        sha256: "d".repeat(64),
      },
      workloadManifest: { apiConcurrency: 4, durationSeconds: 60 },
      targetComparison: compareTargets({
        interactiveReadP95Ms: 100,
        searchP95Ms: 200,
        firstTokenMs: 1_000,
        sseDeliveryP95Ms: 100,
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        interactiveReadP99Ms: 200,
        apiErrorRate: 0,
      }),
      recovery: {
        status: "passed",
        measuredRpoHours: 1,
        measuredRtoHours: 1,
        databaseIntegrity: true,
        objectIntegrity: true,
        evidencePath: "recovery/evidence.json",
      },
      decisions: DECISION_REQUIRED_TARGETS.map((target) => ({
        id: target.id,
        approved: true,
      })),
      environment: {
        baseline: {
          certificationEligible: true,
        },
      },
      artifactsConsistent: true,
      rawArtifacts: ["raw/samples.ndjson", "summary.json"],
    });

    expect(report.tenMReady).toBe(false);
    expect(report.blockers).toContain("decision-required:p99-latency");
  });
});
