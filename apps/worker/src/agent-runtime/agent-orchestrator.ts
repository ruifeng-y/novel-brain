import { Injectable } from "@nestjs/common";
import {
  orchestratorCommandSchema,
  orchestratorScheduleCommandSchema,
  type OrchestratorCommand,
  type OrchestratorEvent,
  type OrchestratorRunState,
  type OrchestratorTask,
  type OrchestratorTaskState,
  type OrchestratorTaskStepState,
} from "@novel-brain/contracts";
import type { AgentGrantAudit } from "@novel-brain/db";
import {
  applyOrchestratorEvent,
  createScheduledOrchestratorState,
  getToolRegistryEntry,
  nextRunnableTaskKeys,
  orchestratorRuntimeEvent,
  OrchestratorPolicyError,
  transitionOrchestrator,
} from "@novel-brain/core";
import { uuidv7 } from "uuidv7";

import { AgentGrantViolation } from "./agent-grant.guard";
// Nest uses runtime class references for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentGrantGuard } from "./agent-grant.guard";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentOrchestratorRepository } from "./agent-orchestrator.repository";

export interface OrchestratorToolExecutorInput {
  task: OrchestratorTaskState;
  step: OrchestratorTaskStepState;
}

export type OrchestratorToolExecutor = (
  input: OrchestratorToolExecutorInput,
) => Promise<{ output: Record<string, unknown> }>;

export interface OrchestratorExecutionResult {
  state: OrchestratorRunState;
  executed: { taskKey: string; stepKey: string } | null;
}

@Injectable()
export class AgentOrchestrator {
  constructor(
    private readonly repository: AgentOrchestratorRepository,
    private readonly guard: AgentGrantGuard,
  ) {}

  async close(): Promise<void> {
    await this.repository.close();
  }

  async get(runId: string, userId: string): Promise<OrchestratorRunState> {
    return this.repository.load(runId, userId);
  }

  async schedule(commandInput: unknown, audit: AgentGrantAudit): Promise<OrchestratorRunState> {
    const command = orchestratorScheduleCommandSchema.parse(commandInput);
    const existing = await this.repository.findByIdempotency(
      command.actor.id,
      command.workId,
      command.branchId,
      command.idempotencyKey,
    );
    if (existing) {
      return existing;
    }
    const state = createScheduledOrchestratorState(command);
    await this.assertScheduleGrants(state, audit);
    const event = orchestratorRuntimeEvent({
      eventId: uuidv7(),
      runId: state.runId,
      sequence: 1,
      type: "run.scheduled",
      occurredAt: new Date().toISOString(),
      taskKey: null,
      stepKey: null,
      data: { workflowKey: state.workflowKey, workflowVersion: state.workflowVersion },
    });
    return this.repository.schedule({
      userId: command.actor.id,
      state: {
        ...state,
        appliedEventIds: [event.eventId],
      },
      event,
    });
  }

  async command(
    commandInput: unknown,
    userId: string,
    audit: AgentGrantAudit,
  ): Promise<OrchestratorRunState> {
    const command = orchestratorCommandSchema.parse(commandInput);
    if (command.type === "schedule") {
      throw new OrchestratorPolicyError([
        {
          code: "invalid_child_task",
          message: "Scheduled runs must use schedule()",
          taskKey: null,
        },
      ]);
    }
    if (command.actor.type === "human" && command.actor.id !== userId) {
      throw new AgentGrantViolation("tenant_mismatch", "Command actor does not match tenant");
    }
    if (command.type === "add_subtasks") {
      const state = await this.repository.load(command.runId, userId);
      await this.assertTaskGrants(state, command.tasks, audit);
    }
    return this.repository.mutate(command.runId, userId, (state) =>
      transitionOrchestrator(state, command, {
        eventId: uuidv7(),
        occurredAt: new Date().toISOString(),
      }),
    );
  }

  async executeNext(
    runId: string,
    userId: string,
    executor: OrchestratorToolExecutor,
    audit: AgentGrantAudit,
  ): Promise<OrchestratorExecutionResult> {
    const state = await this.repository.load(runId, userId);
    const candidate = selectCandidate(state);
    if (!candidate) {
      return { state, executed: null };
    }

    await this.guard.assertDispatch({
      userId,
      workId: state.workId,
      branchId: state.branchId,
      taskId: candidate.task.id,
      grantId: candidate.task.grantId,
      expectedRole: candidate.task.role,
      expectedTools: candidate.task.steps.map((step) => step.toolName),
      audit,
    });

    const claimed: {
      task: OrchestratorTaskState | undefined;
      step: OrchestratorTaskStepState | undefined;
    } = { task: undefined, step: undefined };
    await this.repository.mutate(runId, userId, (current) => {
      const selected = selectCandidate(current);
      if (!selected) {
        return { state: current, events: [] };
      }
      let next = current;
      const events: OrchestratorEvent[] = [];
      if (selected.task.status === "ready") {
        const event = appendRuntimeEvent(next, "task.started", selected.task.key, null, {});
        next = event.state;
        events.push(event.event);
      }
      const stepEvent = appendRuntimeEvent(
        next,
        "step.started",
        selected.task.key,
        selected.step.key,
        {},
      );
      next = stepEvent.state;
      events.push(stepEvent.event);
      claimed.task = next.tasks.find((task) => task.key === selected.task.key);
      claimed.step = claimed.task?.steps.find((step) => step.key === selected.step.key);
      return { state: next, events };
    });

    if (!claimed.task || !claimed.step) {
      return { state: await this.repository.load(runId, userId), executed: null };
    }
    const activeTask = claimed.task;
    const activeStep = claimed.step;

    try {
      const entry = getToolRegistryEntry(activeStep.toolName);
      const approval =
        entry?.approval === "human"
          ? {
              approvalId: requireApprovalId(activeTask),
              approvedBy: requireApprovedBy(activeTask),
              approvedSideEffect: entry.sideEffect,
            }
          : null;
      await this.guard.authorizeToolCall({
        userId,
        workId: state.workId,
        branchId: state.branchId,
        taskId: activeTask.id,
        grantId: activeTask.grantId,
        toolName: activeStep.toolName,
        resource: activeTask.resource,
        input: activeStep.input,
        affectedResources: activeTask.affectedResources,
        estimatedCostCny: activeStep.estimatedCostCny,
        estimatedTokens: activeStep.estimatedTokens,
        approval,
        audit,
      });
      const result = await executor({ task: activeTask, step: activeStep });
      const finalState = await this.repository.mutate(runId, userId, (current) => {
        const events: OrchestratorEvent[] = [];
        const stepSuccess = appendRuntimeEvent(
          current,
          "step.succeeded",
          activeTask.key,
          activeStep.key,
          { output: result.output },
        );
        let next = stepSuccess.state;
        events.push(stepSuccess.event);
        const taskAfterStep = next.tasks.find((task) => task.key === activeTask.key);
        if (taskAfterStep?.steps.every((step) => step.status === "succeeded")) {
          const taskSuccess = appendRuntimeEvent(
            next,
            "task.succeeded",
            taskAfterStep.key,
            null,
            {},
          );
          next = taskSuccess.state;
          events.push(taskSuccess.event);
        }
        return { state: next, events };
      });
      return {
        state: finalState,
        executed: { taskKey: activeTask.key, stepKey: activeStep.key },
      };
    } catch (error) {
      await this.repository.mutate(runId, userId, (current) => {
        const failure = appendRuntimeEvent(current, "step.failed", activeTask.key, activeStep.key, {
          code: error instanceof AgentGrantViolation ? error.code : "ORCHESTRATOR_STEP_FAILED",
          message: error instanceof Error ? error.message : "Step failed",
        });
        return { state: failure.state, events: [failure.event] };
      });
      throw error;
    }
  }

  private async assertScheduleGrants(
    state: OrchestratorRunState,
    audit: AgentGrantAudit,
  ): Promise<void> {
    await this.assertTaskGrants(
      state,
      state.tasks.map((task) => ({
        id: task.id,
        key: task.key,
        title: task.title,
        priority: task.priority,
        dependsOn: task.dependsOn,
        role: task.role,
        grantId: task.grantId,
        resource: task.resource,
        affectedResources: task.affectedResources,
        risk: task.risk,
        approval: task.approval,
        steps: task.steps.map((step) => ({
          key: step.key,
          toolName: step.toolName,
          input: step.input,
          estimatedCostCny: step.estimatedCostCny,
          estimatedTokens: step.estimatedTokens,
        })),
      })),
      audit,
    );
  }

  private async assertTaskGrants(
    state: OrchestratorRunState,
    tasks: OrchestratorTask[],
    audit: AgentGrantAudit,
  ): Promise<void> {
    for (const task of tasks) {
      await this.guard.assertDispatch({
        userId: state.ownerId,
        workId: state.workId,
        branchId: state.branchId,
        taskId: task.id,
        grantId: task.grantId,
        expectedRole: task.role,
        expectedTools: task.steps.map((step) => step.toolName),
        audit,
      });
    }
  }
}

function selectCandidate(
  state: OrchestratorRunState,
): { task: OrchestratorTaskState; step: OrchestratorTaskStepState } | null {
  if (!["queued", "preparing", "running"].includes(state.status)) {
    return null;
  }
  const runnable = nextRunnableTaskKeys(state);
  for (const key of runnable) {
    const task = state.tasks.find((candidate) => candidate.key === key);
    const step = task?.steps.find((candidate) => candidate.status === "pending");
    if (task && step) {
      return { task, step };
    }
  }
  const resuming = state.tasks.find(
    (task) => task.status === "running" && task.steps.some((step) => step.status === "pending"),
  );
  const step = resuming?.steps.find((candidate) => candidate.status === "pending");
  return resuming && step ? { task: resuming, step } : null;
}

function appendRuntimeEvent(
  state: OrchestratorRunState,
  type: Parameters<typeof orchestratorRuntimeEvent>[0]["type"],
  taskKey: string | null,
  stepKey: string | null,
  data: Record<string, unknown>,
): { state: OrchestratorRunState; event: ReturnType<typeof orchestratorRuntimeEvent> } {
  const event = orchestratorRuntimeEvent({
    eventId: uuidv7(),
    runId: state.runId,
    sequence: state.lastSequence + 1,
    type,
    occurredAt: new Date().toISOString(),
    taskKey,
    stepKey,
    data,
  });
  const applied = applyOrchestratorEvent(state, event);
  if (!applied.applied) {
    throw new Error(`Orchestrator event was not applied: ${type}`);
  }
  return { state: applied.state, event };
}

function requireApprovedBy(task: OrchestratorTaskState): string {
  if (!task.approvedBy) {
    throw new AgentGrantViolation("approval_required", "Human approval is missing");
  }
  return task.approvedBy;
}

function requireApprovalId(task: OrchestratorTaskState): string {
  if (!task.approvalId) {
    throw new AgentGrantViolation("approval_required", "Human approval is missing");
  }
  return task.approvalId;
}

export type { OrchestratorCommand, OrchestratorTask };
export { AgentOrchestratorRepository } from "./agent-orchestrator.repository";
