import { describe, expect, it } from "vitest";

import { generateContinuityFixture } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";

describe("continuity fixture", () => {
  const plan = createContinuityPlan({ seed: 20261118, tier: "smoke" });

  it("generates a deterministic multi-volume branch fixture", () => {
    const first = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const second = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

    expect(first).toEqual(second);
    expect(first.chapters).toHaveLength(12);
    expect(first.volumes).toHaveLength(3);
    expect(first.branches.map((branch) => branch.name)).toEqual([
      "main",
      "early-divergence",
      "middle-divergence",
      "late-divergence",
    ]);
    expect(first.digest).toMatchObject({
      schemaVersion: 1,
      generatorVersion: "continuity-benchmark-v1",
      sourceCommit: "abc1234",
      chapterCount: 12,
      volumeCount: 3,
    });
    expect(first.digest.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps objective canon, subjective knowledge and hidden facts separate", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

    expect(fixture.facts.some((fact) => fact.visibility === "hidden")).toBe(true);
    expect(new Set(fixture.knowledgeStates.map((state) => state.state))).toEqual(
      new Set(["knowledge", "belief", "suspicion", "misbelief", "unknown"]),
    );
    expect(fixture.items[0]?.rights).toMatchObject({
      ownerId: expect.any(String),
      custodianId: expect.any(String),
      locationId: expect.any(String),
      usageRightId: expect.any(String),
    });
  });

  it("seeds every required scenario family with linked, actionable failures", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const defectFamilies = new Set(fixture.defects.map((defect) => defect.family));

    for (const family of [
      "knowledge_boundary",
      "body_continuity",
      "identity_transition",
      "inventory_rights",
      "travel_time",
      "foreshadow_payoff",
      "motivation_drift",
      "branch_divergence",
    ] as const) {
      expect(defectFamilies).toContain(family);
    }
    for (const defect of fixture.defects) {
      expect(defect.chapterNumber).toBeGreaterThanOrEqual(1);
      expect(defect.chapterNumber).toBeLessThanOrEqual(plan.chapterCount);
      expect(defect.sourceFactId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(defect.entityIds.length).toBeGreaterThan(0);
      expect(defect.versionNodeId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(defect.evidence.trim().length).toBeGreaterThan(0);
    }
    expect(fixture.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "false_alarm" }),
        expect.objectContaining({ mode: "incomplete_context" }),
      ]),
    );
  });

  it("defines bounded-agent scenarios for repair, abstention and escalation", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const dispositions = new Set(
      fixture.agentScenarios.map((scenario) => scenario.expectedDisposition),
    );

    expect(dispositions).toEqual(new Set(["propose_repair", "abstain", "escalate"]));
    for (const scenario of fixture.agentScenarios) {
      expect(scenario.budgetTokens).toBeGreaterThan(0);
      expect(scenario.maxImpactObjects).toBeGreaterThan(0);
      expect(scenario.allowedTools).not.toContain("submit_canon");
      expect(scenario.forbiddenTools).toContain("submit_canon");
      expect(scenario.forbiddenTools).toContain("grant_permission");
      expect(scenario.expectedDefectIds.length + scenario.controlIds.length).toBeGreaterThan(0);
    }
  });
});
