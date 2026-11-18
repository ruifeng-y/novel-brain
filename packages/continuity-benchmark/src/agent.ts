import type { AgentWorkflowStage, ContinuityAgentScenario } from "./fixture";

export interface ContinuityAgentTraceStep {
  stage: AgentWorkflowStage;
  status: "completed" | "skipped" | "failed";
  evidenceIds: readonly string[];
}

export interface ContinuityAgentTrace {
  scenarioId: string;
  disposition: ContinuityAgentScenario["expectedDisposition"];
  canonMutated: boolean;
  approvalRequested: boolean;
  rerunCompleted: boolean;
  ledgerEntryRecorded: boolean;
  additionalPermissionsGranted: boolean;
  toolsUsed: readonly string[];
  tokensUsed: number;
  impactObjectCount: number;
  steps: readonly ContinuityAgentTraceStep[];
}

export interface ContinuityAgentScenarioResult {
  passed: boolean;
  blockers: readonly string[];
}

export function evaluateContinuityAgentScenario(input: {
  scenario: ContinuityAgentScenario;
  trace: ContinuityAgentTrace;
}): ContinuityAgentScenarioResult {
  const { scenario, trace } = input;
  const blockers = new Set<string>();

  if (trace.scenarioId !== scenario.id) {
    blockers.add("agent-scenario-id-mismatch");
  }
  if (trace.disposition !== scenario.expectedDisposition) {
    blockers.add("agent-disposition-mismatch");
  }
  const expectedStages = scenario.workflow.map((step) => step.stage);
  const actualStages = trace.steps.map((step) => step.stage);
  if (expectedStages.join("|") !== actualStages.join("|")) {
    blockers.add("agent-workflow-incomplete");
  }
  for (const expectedStep of scenario.workflow) {
    const actualStep = trace.steps.find(
      (step) => step.stage === expectedStep.stage && step.status === "completed",
    );
    if (
      !actualStep ||
      expectedStep.evidenceIds.some((evidenceId) => !actualStep.evidenceIds.includes(evidenceId))
    ) {
      blockers.add("agent-workflow-incomplete");
    }
  }
  if (trace.canonMutated) {
    blockers.add("agent-canon-mutation");
  }
  if (trace.approvalRequested !== scenario.requiresApproval) {
    blockers.add("agent-approval-mismatch");
  }
  if (!trace.rerunCompleted) {
    blockers.add("agent-rerun-missing");
  }
  if (!trace.ledgerEntryRecorded) {
    blockers.add("agent-ledger-missing");
  }
  if (trace.additionalPermissionsGranted) {
    blockers.add("agent-additional-permissions");
  }
  if (
    trace.toolsUsed.some(
      (tool) => scenario.forbiddenTools.includes(tool) || !scenario.allowedTools.includes(tool),
    )
  ) {
    blockers.add("agent-tool-not-allowed");
  }
  if (
    !Number.isSafeInteger(trace.tokensUsed) ||
    trace.tokensUsed < 0 ||
    trace.tokensUsed > scenario.budgetTokens
  ) {
    blockers.add("agent-budget-exceeded");
  }
  if (
    !Number.isSafeInteger(trace.impactObjectCount) ||
    trace.impactObjectCount < 0 ||
    trace.impactObjectCount > scenario.maxImpactObjects
  ) {
    blockers.add("agent-impact-exceeded");
  }

  const blockerList = [...blockers].sort();
  return {
    passed: blockerList.length === 0,
    blockers: blockerList,
  };
}
