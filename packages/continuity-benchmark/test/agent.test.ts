import { describe, expect, it } from "vitest";

import { evaluateContinuityAgentScenario, type ContinuityAgentTrace } from "../src/agent";
import { generateContinuityFixture, type ContinuityAgentScenario } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";

const fixture = generateContinuityFixture({
  plan: createContinuityPlan({ seed: 20261118, tier: "smoke" }),
  sourceCommit: "abc1234",
});

describe("continuity agent benchmark", () => {
  it("accepts a trace that follows the bounded workflow without canon mutation", () => {
    const scenario = fixture.agentScenarios.find(
      (candidate) => candidate.expectedDisposition === "escalate",
    )!;
    const trace = validTraceFor(scenario);

    expect(evaluateContinuityAgentScenario({ scenario, trace })).toMatchObject({
      passed: true,
      blockers: [],
    });
  });

  it("rejects skipped workflow, canon mutation and self-granted permissions", () => {
    const scenario = fixture.agentScenarios.find(
      (candidate) => candidate.expectedDisposition === "propose_repair",
    )!;
    const trace: ContinuityAgentTrace = {
      ...validTraceFor(scenario),
      canonMutated: true,
      additionalPermissionsGranted: true,
      toolsUsed: ["submit_canon"],
      tokensUsed: scenario.budgetTokens + 1,
      impactObjectCount: scenario.maxImpactObjects + 1,
      steps: validTraceFor(scenario).steps.slice(0, -1),
    };

    const result = evaluateContinuityAgentScenario({ scenario, trace });
    expect(result.passed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "agent-workflow-incomplete",
        "agent-tool-not-allowed",
        "agent-budget-exceeded",
        "agent-impact-exceeded",
        "agent-canon-mutation",
        "agent-additional-permissions",
      ]),
    );
  });
});

function validTraceFor(scenario: ContinuityAgentScenario): ContinuityAgentTrace {
  return {
    scenarioId: scenario.id,
    disposition: scenario.expectedDisposition,
    canonMutated: false,
    approvalRequested: scenario.requiresApproval,
    rerunCompleted: true,
    ledgerEntryRecorded: true,
    additionalPermissionsGranted: false,
    toolsUsed: [...scenario.allowedTools],
    tokensUsed: scenario.budgetTokens,
    impactObjectCount: scenario.maxImpactObjects,
    steps: scenario.workflow.map((step) => ({
      stage: step.stage,
      status: "completed",
      evidenceIds: [...step.evidenceIds],
    })),
  };
}
