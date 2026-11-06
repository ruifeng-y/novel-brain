import {
  ORCHESTRATOR_CONTRACT_VERSION,
  orchestratorEventSchema,
  orchestratorTaskSchema,
  type OrchestratorAddSubtasksCommand,
  type OrchestratorCommand,
  type OrchestratorEvent,
  type OrchestratorRunState,
  type OrchestratorRunStatus,
  type OrchestratorScheduleCommand,
  type OrchestratorTask,
  type OrchestratorTaskState,
  type OrchestratorTaskStatus,
  type OrchestratorTaskStepState,
  type OrchestratorStepStatus,
  type OrchestratorValidationIssue,
  type OrchestratorEnvelope,
} from "@novel-brain/contracts";

import { getToolRegistryEntry, isToolAllowedForRole } from "./agent-runtime";

export const ORCHESTRATOR_MAX_CONCURRENCY = 4;

export const ORCHESTRATOR_RUN_TRANSITIONS = {
  queued: ["preparing", "running", "paused", "waiting_review", "completed", "failed", "cancelled"],
  preparing: ["running", "paused", "waiting_review", "failed", "cancelled"],
  running: ["preparing", "paused", "waiting_review", "completed", "failed", "cancelled"],
  paused: ["queued", "running", "cancelled"],
  waiting_review: ["queued", "running", "paused", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
} as const satisfies Record<OrchestratorRunStatus, readonly OrchestratorRunStatus[]>;

export const ORCHESTRATOR_TASK_TRANSITIONS = {
  pending: ["ready", "waiting_review", "cancelled"],
  ready: ["running", "waiting_review", "cancelled"],
  running: ["succeeded", "failed", "waiting_review", "cancelled"],
  waiting_review: ["ready", "running", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
} as const satisfies Record<OrchestratorTaskStatus, readonly OrchestratorTaskStatus[]>;

export const ORCHESTRATOR_STEP_TRANSITIONS = {
  pending: ["running", "skipped", "cancelled"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  skipped: [],
  cancelled: [],
} as const satisfies Record<OrchestratorStepStatus, readonly OrchestratorStepStatus[]>;

export class OrchestratorPolicyError extends Error {
  constructor(readonly issues: OrchestratorValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "OrchestratorPolicyError";
  }
}

export function canTransitionOrchestratorRun(
  from: OrchestratorRunStatus,
  to: OrchestratorRunStatus,
): boolean {
  return (
    from === to ||
    (ORCHESTRATOR_RUN_TRANSITIONS[from] as readonly OrchestratorRunStatus[]).includes(to)
  );
}

export function canTransitionOrchestratorTask(
  from: OrchestratorTaskStatus,
  to: OrchestratorTaskStatus,
): boolean {
  return (
    from === to ||
    (ORCHESTRATOR_TASK_TRANSITIONS[from] as readonly OrchestratorTaskStatus[]).includes(to)
  );
}

export function canTransitionOrchestratorStep(
  from: OrchestratorStepStatus,
  to: OrchestratorStepStatus,
): boolean {
  return (
    from === to ||
    (ORCHESTRATOR_STEP_TRANSITIONS[from] as readonly OrchestratorStepStatus[]).includes(to)
  );
}

export function validateOrchestratorSchedule(
  command: OrchestratorScheduleCommand,
): OrchestratorValidationIssue[] {
  return validateTaskDag(command.envelope, command.tasks);
}

export function validateOrchestratorSubtasks(
  state: OrchestratorRunState,
  command: OrchestratorAddSubtasksCommand,
): OrchestratorValidationIssue[] {
  const issues: OrchestratorValidationIssue[] = [];
  if (!state.envelope.dynamicSubtasks) {
    issues.push(
      issue("dynamic_subtasks_disabled", "Workflow envelope does not allow dynamic subtasks"),
    );
  }
  if (!state.tasks.some((task) => task.key === command.parentTaskKey)) {
    issues.push(issue("invalid_child_task", "Parent task does not exist", command.parentTaskKey));
  }

  const existing = state.tasks.map((task) => taskFromState(task));
  const combined = [...existing, ...command.tasks];
  return [...issues, ...validateTaskDag(state.envelope, combined)];
}

export function createScheduledOrchestratorState(
  command: OrchestratorScheduleCommand,
): OrchestratorRunState {
  const issues = validateOrchestratorSchedule(command);
  if (issues.length > 0) {
    throw new OrchestratorPolicyError(issues);
  }
  const state: OrchestratorRunState = {
    schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
    runId: command.runId,
    ownerId: command.actor.id,
    workId: command.workId,
    branchId: command.branchId,
    workflowKey: command.envelope.key,
    workflowVersion: command.envelope.version,
    idempotencyKey: command.idempotencyKey,
    envelope: command.envelope,
    status: "queued",
    pauseRequested: false,
    cancelReason: null,
    failureMessage: null,
    lastSequence: 1,
    appliedCommandIds: [command.commandId],
    appliedEventIds: [],
    tasks: command.tasks.map(taskStateFromTask),
  };
  refreshReadyTasks(state);
  refreshRunStatus(state);
  return state;
}

export function nextRunnableTaskKeys(state: OrchestratorRunState): string[] {
  const running = state.tasks.filter((task) => task.status === "running").length;
  const available = Math.max(0, state.envelope.maxConcurrency - running);
  return state.tasks
    .filter((task) => task.status === "ready")
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
    )
    .slice(0, available)
    .map((task) => task.key);
}

export function orchestratorRuntimeEvent(
  input: Omit<OrchestratorEvent, "schemaVersion">,
): OrchestratorEvent {
  return orchestratorEventSchema.parse({
    schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
    ...input,
  });
}

export function transitionOrchestrator(
  state: OrchestratorRunState,
  command: OrchestratorCommand,
  context: { eventId: string; occurredAt: string },
): { state: OrchestratorRunState; events: OrchestratorEvent[] } {
  if (state.appliedCommandIds.includes(command.commandId)) {
    return { state, events: [] };
  }
  if (command.runId !== state.runId) {
    throw new OrchestratorPolicyError([
      issue("invalid_child_task", "Command belongs to another run"),
    ]);
  }

  if (command.type === "schedule") {
    if (state.idempotencyKey === command.idempotencyKey) {
      return { state, events: [] };
    }
    throw new OrchestratorPolicyError([issue("invalid_child_task", "Run is already scheduled")]);
  }

  if (
    (command.type === "pause" ||
      command.type === "resume" ||
      command.type === "cancel" ||
      command.type === "approve_task") &&
    (command.actor.type !== "human" || command.actor.id !== state.ownerId)
  ) {
    throw new OrchestratorPolicyError([
      issue("human_gate_required", "Only the run owner may control human gates"),
    ]);
  }

  const event = eventForCommand(state, command, context);
  const applied = applyOrchestratorEvent(state, event);
  if (!applied.applied) {
    return { state, events: [] };
  }
  const nextState = {
    ...applied.state,
    appliedCommandIds: [...applied.state.appliedCommandIds, command.commandId],
  };
  return { state: nextState, events: [event] };
}

export function applyOrchestratorEvent(
  state: OrchestratorRunState,
  event: OrchestratorEvent,
): { state: OrchestratorRunState; applied: boolean } {
  if (
    event.runId !== state.runId ||
    event.sequence <= state.lastSequence ||
    event.sequence !== state.lastSequence + 1 ||
    state.appliedEventIds.includes(event.eventId)
  ) {
    return { state, applied: false };
  }

  const next = structuredClone(state);
  const task = event.taskKey
    ? next.tasks.find((candidate) => candidate.key === event.taskKey)
    : undefined;

  switch (event.type) {
    case "run.scheduled":
      next.status = "queued";
      break;
    case "run.started":
      next.status = "running";
      break;
    case "run.pause_requested":
      next.pauseRequested = true;
      break;
    case "run.paused":
      next.status = "paused";
      next.pauseRequested = false;
      break;
    case "run.resumed":
      next.status = "queued";
      next.pauseRequested = false;
      break;
    case "run.waiting_review":
      next.status = "waiting_review";
      break;
    case "run.completed":
      next.status = "completed";
      break;
    case "run.failed":
      next.status = "failed";
      next.failureMessage = stringValue(event.data.message) ?? "Workflow failed";
      break;
    case "run.cancelled":
      next.status = "cancelled";
      next.cancelReason = stringValue(event.data.reason) ?? "Workflow cancelled";
      cancelUnfinished(next);
      break;
    case "tasks.added": {
      const added = orchestratorTaskSchema.array().parse(event.data.tasks);
      next.tasks.push(...added.map(taskStateFromTask));
      break;
    }
    case "task.ready":
      if (task && !isTaskTerminal(task.status)) {
        task.status = "ready";
      }
      break;
    case "task.started":
      if (task && !isTaskTerminal(task.status)) {
        task.status = "running";
        task.attempt += 1;
      }
      break;
    case "task.waiting_review":
      if (task && !isTaskTerminal(task.status)) {
        task.status = "waiting_review";
      }
      break;
    case "task.approved":
      if (task && task.status === "waiting_review") {
        task.status = "ready";
        task.approvedBy = stringValue(event.data.approvedBy);
        task.approvalId = stringValue(event.data.approvalId);
      }
      break;
    case "task.escalated":
      if (task && !isTaskTerminal(task.status)) {
        task.status = "waiting_review";
        task.escalationReason = stringValue(event.data.reason);
      }
      break;
    case "task.succeeded":
      if (task) {
        task.status = "succeeded";
      }
      break;
    case "task.failed":
      if (task) {
        task.status = "failed";
        next.failureMessage = stringValue(event.data.message) ?? "Task failed";
      }
      break;
    case "task.skipped":
      if (task) {
        task.status = "skipped";
      }
      break;
    case "task.cancelled":
      if (task) {
        task.status = "cancelled";
        cancelTaskSteps(task);
      }
      break;
    case "step.started": {
      const step = task ? findStep(task, event.stepKey) : undefined;
      if (task && step) {
        task.status = "running";
        step.status = "running";
        step.attempt += 1;
      }
      break;
    }
    case "step.succeeded": {
      const step = task ? findStep(task, event.stepKey) : undefined;
      if (task && step) {
        step.status = "succeeded";
        step.output = recordValue(event.data.output);
        step.errorCode = null;
        step.errorMessage = null;
      }
      break;
    }
    case "step.failed": {
      const step = task ? findStep(task, event.stepKey) : undefined;
      if (task && step) {
        step.status = "failed";
        step.errorCode = stringValue(event.data.code) ?? "ORCHESTRATOR_STEP_FAILED";
        step.errorMessage = stringValue(event.data.message) ?? "Step failed";
        task.status = "failed";
        next.failureMessage = step.errorMessage;
      }
      break;
    }
    case "step.skipped":
    case "step.cancelled": {
      const step = task ? findStep(task, event.stepKey) : undefined;
      if (step) {
        step.status = event.type === "step.skipped" ? "skipped" : "cancelled";
      }
      break;
    }
  }

  next.lastSequence = event.sequence;
  next.appliedEventIds = [...next.appliedEventIds, event.eventId].slice(-20_000);
  refreshReadyTasks(next);
  refreshRunStatus(next);
  if (event.type === "run.resumed" && next.status !== "cancelled") {
    next.status = "queued";
  }
  return { state: next, applied: true };
}

function eventForCommand(
  state: OrchestratorRunState,
  command: Exclude<OrchestratorCommand, OrchestratorScheduleCommand>,
  context: { eventId: string; occurredAt: string },
): OrchestratorEvent {
  const base = {
    eventId: context.eventId,
    runId: state.runId,
    sequence: state.lastSequence + 1,
    occurredAt: context.occurredAt,
    taskKey: null,
    stepKey: null,
    data: {},
  };

  switch (command.type) {
    case "pause": {
      const runningStep = state.tasks.some((task) =>
        task.steps.some((step) => step.status === "running"),
      );
      return orchestratorRuntimeEvent({
        ...base,
        type: runningStep ? "run.pause_requested" : "run.paused",
        data: { reason: command.reason },
      });
    }
    case "resume":
      if (state.status !== "paused") {
        throw new OrchestratorPolicyError([
          issue("invalid_child_task", "Only a paused run can resume"),
        ]);
      }
      return orchestratorRuntimeEvent({ ...base, type: "run.resumed" });
    case "cancel":
      return orchestratorRuntimeEvent({
        ...base,
        type: "run.cancelled",
        data: { reason: command.reason },
      });
    case "approve_task": {
      const task = requireTask(state, command.taskKey);
      if (task.status !== "waiting_review") {
        throw new OrchestratorPolicyError([
          issue("human_gate_required", "Task is not waiting for human approval", task.key),
        ]);
      }
      return orchestratorRuntimeEvent({
        ...base,
        type: "task.approved",
        taskKey: task.key,
        data: { approvedBy: command.actor.id, approvalId: command.approvalId },
      });
    }
    case "escalate_task": {
      const task = requireTask(state, command.taskKey);
      if (isTaskTerminal(task.status)) {
        throw new OrchestratorPolicyError([
          issue("human_gate_required", "Terminal tasks cannot be escalated", task.key),
        ]);
      }
      return orchestratorRuntimeEvent({
        ...base,
        type: "task.escalated",
        taskKey: task.key,
        data: { reason: command.reason },
      });
    }
    case "add_subtasks": {
      requireTask(state, command.parentTaskKey);
      const issues = validateOrchestratorSubtasks(state, command);
      if (issues.length > 0) {
        throw new OrchestratorPolicyError(issues);
      }
      return orchestratorRuntimeEvent({
        ...base,
        type: "tasks.added",
        data: { parentTaskKey: command.parentTaskKey, tasks: command.tasks },
      });
    }
  }
}

function validateTaskDag(
  envelope: OrchestratorEnvelope,
  tasks: OrchestratorTask[],
): OrchestratorValidationIssue[] {
  const issues: OrchestratorValidationIssue[] = [];
  if (tasks.length > envelope.maxTasks) {
    issues.push(issue("task_limit_exceeded", "Workflow exceeds the task limit"));
  }
  if (envelope.maxConcurrency > ORCHESTRATOR_MAX_CONCURRENCY) {
    issues.push(
      issue(
        "concurrency_exceeded",
        `Workflow concurrency exceeds the hard limit of ${ORCHESTRATOR_MAX_CONCURRENCY}`,
      ),
    );
  }

  const byKey = new Map<string, OrchestratorTask>();
  const ids = new Set<string>();
  for (const task of tasks) {
    if (byKey.has(task.key) || ids.has(task.id)) {
      issues.push(issue("duplicate_task", `Duplicate task ${task.key}`, task.key));
    }
    byKey.set(task.key, task);
    ids.add(task.id);
  }

  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!byKey.has(dependency)) {
        issues.push(
          issue(
            "unknown_dependency",
            `Task ${task.key} depends on unknown task ${dependency}`,
            task.key,
          ),
        );
      }
    }
    validateTaskPolicy(task, issues);
  }

  const cycleTasks = findCycles(byKey);
  for (const taskKey of cycleTasks) {
    issues.push(issue("cycle", `Task dependency cycle includes ${taskKey}`, taskKey));
  }

  if (cycleTasks.length === 0) {
    const depths = dependencyDepths(byKey);
    for (const [taskKey, depth] of depths) {
      if (depth > envelope.maxDepth) {
        issues.push(
          issue("depth_exceeded", `Task ${taskKey} exceeds the workflow depth limit`, taskKey),
        );
      }
    }
  }

  const dependents = new Map<string, number>();
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      dependents.set(dependency, (dependents.get(dependency) ?? 0) + 1);
    }
  }
  for (const [taskKey, count] of dependents) {
    if (count > envelope.maxFanOut) {
      issues.push(issue("fanout_exceeded", `Task ${taskKey} fans out to ${count} tasks`, taskKey));
    }
  }

  const estimated = tasks.reduce(
    (total, task) => {
      for (const step of task.steps) {
        total.cost += step.estimatedCostCny;
        total.tokens += step.estimatedTokens;
        total.calls += 1;
      }
      return total;
    },
    { cost: 0, tokens: 0, calls: 0 },
  );
  if (
    estimated.cost > envelope.budget.maxCostCny ||
    estimated.tokens > envelope.budget.maxTokens ||
    estimated.calls > envelope.budget.maxCalls
  ) {
    issues.push(issue("budget_exceeded", "Workflow estimate exceeds its budget envelope"));
  }

  return issues;
}

function validateTaskPolicy(task: OrchestratorTask, issues: OrchestratorValidationIssue[]): void {
  if (task.risk === "high" && task.approval !== "human") {
    issues.push(issue("human_gate_required", "High-risk tasks require human approval", task.key));
  }
  for (const step of task.steps) {
    const entry = getToolRegistryEntry(step.toolName);
    if (!entry) {
      issues.push(
        issue("tool_not_registered", `Tool ${step.toolName} is not registered`, task.key),
      );
      continue;
    }
    if (!isToolAllowedForRole(task.role, step.toolName)) {
      issues.push(
        issue("role_tool_denied", `Role ${task.role} cannot call ${step.toolName}`, task.key),
      );
    }
    if (!entry.agentCallable) {
      issues.push(
        issue("tool_not_agent_callable", `Tool ${step.toolName} is author-only`, task.key),
      );
    }
    if (entry.approval === "human" && task.approval !== "human") {
      issues.push(
        issue("human_gate_required", `Tool ${step.toolName} requires human approval`, task.key),
      );
    }
  }
}

function findCycles(tasks: Map<string, OrchestratorTask>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = new Set<string>();

  const visit = (key: string, stack: string[]): void => {
    if (visiting.has(key)) {
      const start = stack.indexOf(key);
      for (const member of stack.slice(start)) {
        cycle.add(member);
      }
      cycle.add(key);
      return;
    }
    if (visited.has(key)) {
      return;
    }
    visiting.add(key);
    const task = tasks.get(key);
    for (const dependency of task?.dependsOn ?? []) {
      if (tasks.has(dependency)) {
        visit(dependency, [...stack, key]);
      }
    }
    visiting.delete(key);
    visited.add(key);
  };

  for (const key of tasks.keys()) {
    visit(key, []);
  }
  return [...cycle].sort();
}

function dependencyDepths(tasks: Map<string, OrchestratorTask>): Map<string, number> {
  const memo = new Map<string, number>();
  const depth = (key: string): number => {
    const cached = memo.get(key);
    if (cached) {
      return cached;
    }
    const task = tasks.get(key);
    const dependencies = (task?.dependsOn ?? []).filter((dependency) => tasks.has(dependency));
    const value =
      dependencies.length === 0
        ? 1
        : 1 + Math.max(...dependencies.map((dependency) => depth(dependency)));
    memo.set(key, value);
    return value;
  };
  for (const key of tasks.keys()) {
    depth(key);
  }
  return memo;
}

function refreshReadyTasks(state: OrchestratorRunState): void {
  const succeeded = new Set(
    state.tasks.filter((task) => task.status === "succeeded").map((task) => task.key),
  );
  for (const task of state.tasks) {
    if (task.status !== "pending") {
      continue;
    }
    if (!task.dependsOn.every((dependency) => succeeded.has(dependency))) {
      continue;
    }
    task.status = task.approval === "human" && !task.approvedBy ? "waiting_review" : "ready";
    task.escalationReason = null;
  }
}

function refreshRunStatus(state: OrchestratorRunState): void {
  if (state.status === "cancelled") {
    return;
  }
  const running = state.tasks.some((task) => task.steps.some((step) => step.status === "running"));
  if (state.pauseRequested && !running) {
    state.status = "paused";
    state.pauseRequested = false;
    return;
  }
  if (state.status === "paused") {
    return;
  }

  const unfinished = state.tasks.filter((task) => !isTaskTerminal(task.status));
  if (unfinished.length === 0) {
    state.status = state.tasks.some((task) => task.status === "failed") ? "failed" : "completed";
    return;
  }

  const waiting = unfinished.some((task) => task.status === "waiting_review");
  const runnable = unfinished.some((task) => task.status === "ready" || task.status === "running");
  const activelyRunning = unfinished.some((task) => task.status === "running");
  if (!runnable && waiting) {
    state.status = "waiting_review";
    return;
  }
  if (activelyRunning && (state.status === "queued" || state.status === "preparing")) {
    state.status = "running";
    return;
  }
  if (state.status === "waiting_review" && runnable) {
    state.status = "running";
  }
}

function cancelUnfinished(state: OrchestratorRunState): void {
  for (const task of state.tasks) {
    if (!isTaskTerminal(task.status)) {
      task.status = "cancelled";
      cancelTaskSteps(task);
    }
  }
}

function cancelTaskSteps(task: OrchestratorTaskState): void {
  for (const step of task.steps) {
    if (step.status === "pending" || step.status === "running") {
      step.status = "cancelled";
    }
  }
}

function taskStateFromTask(task: OrchestratorTask): OrchestratorTaskState {
  return {
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
    status: "pending",
    attempt: 0,
    approvedBy: null,
    approvalId: null,
    escalationReason: null,
    steps: task.steps.map((step): OrchestratorTaskStepState => ({
      key: step.key,
      toolName: step.toolName,
      input: step.input,
      estimatedCostCny: step.estimatedCostCny,
      estimatedTokens: step.estimatedTokens,
      status: "pending",
      attempt: 0,
      output: {},
      errorCode: null,
      errorMessage: null,
    })),
  };
}

function taskFromState(task: OrchestratorTaskState): OrchestratorTask {
  return {
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
  };
}

function requireTask(state: OrchestratorRunState, taskKey: string): OrchestratorTaskState {
  const task = state.tasks.find((candidate) => candidate.key === taskKey);
  if (!task) {
    throw new OrchestratorPolicyError([
      issue("invalid_child_task", "Task does not exist", taskKey),
    ]);
  }
  return task;
}

function findStep(
  task: OrchestratorTaskState,
  stepKey: string | null,
): OrchestratorTaskStepState | undefined {
  return stepKey ? task.steps.find((step) => step.key === stepKey) : undefined;
}

function isTaskTerminal(status: OrchestratorTaskState["status"]): boolean {
  return ["succeeded", "failed", "skipped", "cancelled"].includes(status);
}

function issue(
  code: OrchestratorValidationIssue["code"],
  message: string,
  taskKey: string | null = null,
): OrchestratorValidationIssue {
  return { code, message, taskKey };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
