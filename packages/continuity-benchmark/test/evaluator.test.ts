import { describe, expect, it } from "vitest";

import { evaluateContinuityFindings, type ContinuityFinding } from "../src/evaluator";
import { generateContinuityFixture } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";
import { findingsFor } from "./helpers";

const plan = createContinuityPlan({ seed: 20261118, tier: "smoke" });
const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

function perfectFindings(): ContinuityFinding[] {
  return findingsFor(fixture);
}

describe("continuity evaluator", () => {
  it("scores a perfect detector without losing clean controls", () => {
    const result = evaluateContinuityFindings({ fixture, findings: perfectFindings() });

    expect(result.summary).toMatchObject({
      truePositives: fixture.defects.length,
      falsePositives: 0,
      falseNegatives: 0,
      trueNegatives: fixture.controls.length,
      precision: 1,
      recall: 1,
    });
    expect(result.bySeverity).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "P0", metrics: expect.objectContaining({ recall: 1 }) }),
      ]),
    );
    expect(result.releaseGate).toEqual({
      passed: true,
      blockers: [],
      p0FalseNegatives: 0,
      knowledgeBoundaryFalseNegatives: 0,
    });
  });

  it("tracks missed and duplicate findings by family", () => {
    const findings = perfectFindings();
    const knowledgeFindings = findings.filter((finding) => finding.family === "knowledge_boundary");
    expect(knowledgeFindings).toHaveLength(3);
    const duplicate = { ...knowledgeFindings[0]! };
    const partiallyDetected = findings.filter(
      (finding) => finding !== knowledgeFindings[1] && finding !== knowledgeFindings[2],
    );

    const result = evaluateContinuityFindings({
      fixture,
      findings: [...partiallyDetected, duplicate],
    });
    const knowledgeMetrics = result.byFamily.find(
      (entry) => entry.key === "knowledge_boundary",
    )?.metrics;

    expect(knowledgeMetrics).toMatchObject({
      truePositives: 1,
      falsePositives: 1,
      falseNegatives: 2,
      recall: 1 / 3,
    });
    expect(result.releaseGate.passed).toBe(false);
    expect(result.releaseGate.knowledgeBoundaryFalseNegatives).toBe(2);
    expect(result.missingFindings).toHaveLength(2);
  });

  it("counts unexpected findings as false positives and invalidates their control windows", () => {
    const control = fixture.controls.find((candidate) => candidate.mode === "clean")!;
    const falsePositive: ContinuityFinding = {
      family: control.family,
      severity: control.family === "knowledge_boundary" ? "P0" : "P2",
      chapterNumber: control.chapterNumber,
      branchId: control.branchId,
      entityIds: [...control.entityIds],
      sourceFactId: fixture.facts[0]!.id,
      versionNodeId: fixture.chapters[0]!.versionNodeId,
      evidence: "surface wording is not a continuity defect",
    };

    const result = evaluateContinuityFindings({
      fixture,
      findings: [...perfectFindings(), falsePositive],
    });

    expect(result.summary.falsePositives).toBe(1);
    expect(result.summary.trueNegatives).toBe(fixture.controls.length - 1);
    expect(
      result.byVolumePosition.reduce((sum, entry) => sum + entry.metrics.falsePositives, 0),
    ).toBe(1);
    expect(result.byBranch.reduce((sum, entry) => sum + entry.metrics.falsePositives, 0)).toBe(1);
  });

  it("requires exact severity, source fact, version node and evidence for a true positive", () => {
    const findings = perfectFindings();
    const target = findings.find((finding) => finding.family === "knowledge_boundary")!;
    const invalidFinding: ContinuityFinding = {
      ...target,
      severity: "P2",
      sourceFactId: "00000000-0000-7000-8000-000000000000",
      versionNodeId: "00000000-0000-7000-8000-000000000001",
      evidence: "unrelated prose",
    };
    const result = evaluateContinuityFindings({
      fixture,
      findings: findings.map((finding) => (finding === target ? invalidFinding : finding)),
    });

    expect(result.summary.truePositives).toBe(fixture.defects.length - 1);
    expect(result.summary.falseNegatives).toBe(1);
    expect(result.summary.falsePositives).toBe(1);
    expect(result.missingFindings).toContainEqual(
      expect.objectContaining({
        family: "knowledge_boundary",
        chapterNumber: target.chapterNumber,
      }),
    );
    expect(result.unexpectedFindings).toContainEqual(invalidFinding);
  });

  it("accepts an independent evidence quote when structured locators match", () => {
    const findings = perfectFindings();
    findings[0] = {
      ...findings[0]!,
      evidence: "独立评审引用：该段与已确认正史冲突。",
    };

    const result = evaluateContinuityFindings({ fixture, findings });

    expect(result.summary.truePositives).toBe(fixture.defects.length);
    expect(result.summary.falsePositives).toBe(0);
    expect(result.summary.falseNegatives).toBe(0);
  });
});
