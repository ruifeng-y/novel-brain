import { describe, expect, it } from "vitest";

import type {
  OrchestratorCommand,
  OrchestratorEvent,
  OrchestratorScheduleCommand,
  OrchestratorTask,
} from "@novel-brain/contracts";

import {
  ORCHESTRATOR_MAX_CONCURRENCY,
  ORCHESTRATOR_RUN_TRANSITIONS,
  applyOrchestratorEvent,
  canTransitionOrchestratorRun,
  canTransitionOrchestratorStep,
  canTransitionOrchestratorTask,
  createScheduledOrchestratorState,
  orchestratorRuntimeEvent,
  nextRunnableTaskKeys,
  transitionOrchestrator,
  validateOrchestratorSchedule,
  validateOrchestratorSubtasks,
} from "../src";

const RUN_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e01";
const USER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e02";
const WORK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e03";
const BRANCH_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e04";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e05";
const GRANT_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e06";
const NOW = "2026-11-06T10:00:00.000Z";

function task(key: string, overrides: Partial<OrchestratorTask> = {}): OrchestratorTask {
  const index = Math.abs([...key].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 90;
  return {
    id: `0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1f${String(index).padStart(2, "0")}`,
    key,
    title: key,
    priority: 10,
    dependsOn: [],
    role: "writer",
    grantId: GRANT_ID,
    resource: { type: "chapter", id: CHAPTER_ID },
    affectedResources: 1,
    risk: "low",
    approval: "none",
    steps: [
      {
        key: "write",
        toolName: "draft.write_version",
        input: { chapterId: CHAPTER_ID, content: key },
        estimatedCostCny: 0.2,
        estimatedTokens: 100,
      },
    ],
    ...overrides,
  };
}

let commandCounter = 0;
let eventCounter = 0;

function schedule(tasks: OrchestratorTask[] = [task("draft")]): OrchestratorScheduleCommand {
  commandCounter += 1;
  return {
    type: "schedule",
    schemaVersion: 1,
    commandId: `0190f5e2-7e7a-7f4e-8d38-7e4e5b2a20${String(commandCounter).padStart(2, "0")}`,
    runId: RUN_ID,
    idempotencyKey: "workflow-one",
    workId: WORK_ID,
    branchId: BRANCH_ID,
    actor: { type: "human", id: USER_ID },
    envelope: {
      key: "chapter.write.v1",
      version: 1,
      maxTasks: 8,
      maxDepth: 4,
      maxFanOut: 4,
      maxConcurrency: 2,
      dynamicSubtasks: true,
      budget: { maxCostCny: 2, maxTokens: 5_000, maxCalls: 20 },
    },
    tasks,
  };
}

function command(
  value: Omit<
    Extract<OrchestratorCommand, { commandId: string }>,
    "schemaVersion" | "runId" | "commandId"
  >,
): OrchestratorCommand {
  commandCounter += 1;
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    commandId: `0190f5e2-7e7a-7f4e-8d38-7e4e5b2a20${String(commandCounter).padStart(2, "0")}`,
    ...value,
  } as OrchestratorCommand;
}

function runtimeEvent(
  type: OrchestratorEvent["type"],
  sequence: number,
  taskKey: string | null = null,
  stepKey: string | null = null,
  data: Record<string, unknown> = {},
): OrchestratorEvent {
  eventCounter += 1;
  return orchestratorRuntimeEvent({
    eventId: `runtime-event-${eventCounter}`,
    runId: RUN_ID,
    sequence,
    type,
    occurredAt: NOW,
    taskKey,
    stepKey,
    data,
  });
}

describe("orchestrator DAG validation", () => {
  it("rejects cycles, unknown dependencies and duplicate task keys before scheduling", () => {
    const cycle = schedule([task("a", { dependsOn: ["b"] }), task("b", { dependsOn: ["a"] })]);
    expect(validateOrchestratorSchedule(cycle).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["cycle"]),
    );

    const unknown = schedule([task("a", { dependsOn: ["missing"] })]);
    expect(validateOrchestratorSchedule(unknown)).toContainEqual(
      expect.objectContaining({ code: "unknown_dependency", taskKey: "a" }),
    );

    const duplicate = schedule([task("a"), task("a")]);
    expect(validateOrchestratorSchedule(duplicate)).toContainEqual(
      expect.objectContaining({ code: "duplicate_task", taskKey: "a" }),
    );

    const closedCycle = schedule([
      task("a", { dependsOn: ["c"] }),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["b"] }),
    ]);
    expect(validateOrchestratorSchedule(closedCycle)).toContainEqual(
      expect.objectContaining({ code: "cycle" }),
    );
  });

  it("rejects depth, fan-out, concurrency, task count and budget violations", () => {
    const tooDeep = schedule([
      task("a"),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["b"] }),
    ]);
    tooDeep.envelope.maxDepth = 2;
    expect(validateOrchestratorSchedule(tooDeep)).toContainEqual(
      expect.objectContaining({ code: "depth_exceeded" }),
    );

    const tooWide = schedule([
      task("a"),
      task("b", { dependsOn: ["a"] }),
      task("c", { dependsOn: ["a"] }),
    ]);
    tooWide.envelope.maxFanOut = 1;
    expect(validateOrchestratorSchedule(tooWide)).toContainEqual(
      expect.objectContaining({ code: "fanout_exceeded" }),
    );

    const tooConcurrent = schedule();
    tooConcurrent.envelope.maxConcurrency = ORCHESTRATOR_MAX_CONCURRENCY + 1;
    expect(validateOrchestratorSchedule(tooConcurrent)).toContainEqual(
      expect.objectContaining({ code: "concurrency_exceeded" }),
    );

    const tooMany = schedule([task("a"), task("b")]);
    tooMany.envelope.maxTasks = 1;
    expect(validateOrchestratorSchedule(tooMany)).toContainEqual(
      expect.objectContaining({ code: "task_limit_exceeded" }),
    );

    const overBudget = schedule([
      task("a", {
        steps: [
          {
            key: "write",
            toolName: "draft.write_version",
            input: { chapterId: CHAPTER_ID, content: "a" },
            estimatedCostCny: 1.5,
            estimatedTokens: 3_000,
          },
        ],
      }),
      task("b", {
        steps: [
          {
            key: "write",
            toolName: "draft.write_version",
            input: { chapterId: CHAPTER_ID, content: "b" },
            estimatedCostCny: 1,
            estimatedTokens: 3_000,
          },
        ],
      }),
    ]);
    expect(validateOrchestratorSchedule(overBudget)).toContainEqual(
      expect.objectContaining({ code: "budget_exceeded" }),
    );
  });

  it("requires human approval for high-risk and human-only tools", () => {
    const highRisk = schedule([task("risk", { risk: "high" })]);
    expect(validateOrchestratorSchedule(highRisk)).toContainEqual(
      expect.objectContaining({ code: "human_gate_required", taskKey: "risk" }),
    );

    const canon = schedule([
      task("commit", {
        role: "canon_curator",
        steps: [
          {
            key: "commit",
            toolName: "canon.commit",
            input: {
              chapterId: CHAPTER_ID,
              approvalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e99",
            },
            estimatedCostCny: 0,
            estimatedTokens: 0,
          },
        ],
      }),
    ]);
    expect(validateOrchestratorSchedule(canon)).toContainEqual(
      expect.objectContaining({ code: "human_gate_required", taskKey: "commit" }),
    );
  });
});

describe("deterministic orchestrator state machine", () => {
  it("uses priority then stable key ordering for runnable tasks", () => {
    const scheduled = schedule([
      task("low", { priority: 1 }),
      task("high-b", { priority: 90 }),
      task("high-a", { priority: 90 }),
    ]);
    const state = createScheduledOrchestratorState(scheduled);
    expect(nextRunnableTaskKeys(state)).toEqual(["high-a", "high-b"]);
  });

  it("treats duplicate and out-of-order events as no-ops", () => {
    const scheduled = schedule();
    let state = createScheduledOrchestratorState(scheduled);
    const started = runtimeEvent("task.started", 2, "draft");
    state = applyOrchestratorEvent(state, started).state;
    expect(state.tasks[0]?.status).toBe("running");

    const duplicate = applyOrchestratorEvent(state, started);
    expect(duplicate.applied).toBe(false);
    expect(duplicate.state).toEqual(state);

    const stale = applyOrchestratorEvent(state, runtimeEvent("task.succeeded", 1, "draft"));
    expect(stale.applied).toBe(false);
    expect(stale.state).toEqual(state);

    const future = applyOrchestratorEvent(state, runtimeEvent("step.started", 4, "draft", "write"));
    expect(future.applied).toBe(false);
    expect(future.state).toEqual(state);
  });

  it("is idempotent by command id and workflow idempotency key", () => {
    const scheduled = schedule();
    const state = createScheduledOrchestratorState(scheduled);
    const duplicateCommand = transitionOrchestrator(state, scheduled, {
      eventId: "duplicate-schedule",
      occurredAt: NOW,
    });
    expect(duplicateCommand.events).toEqual([]);
    expect(duplicateCommand.state).toEqual(state);
  });

  it("pauses at a step boundary and resumes from the committed state", () => {
    let state = createScheduledOrchestratorState(schedule());
    state = applyOrchestratorEvent(state, runtimeEvent("task.started", 2, "draft")).state;
    state = applyOrchestratorEvent(state, runtimeEvent("step.started", 3, "draft", "write")).state;

    const paused = transitionOrchestrator(
      state,
      command({
        type: "pause",
        actor: { type: "human", id: USER_ID },
        reason: "作者暂停",
      }),
      { eventId: "pause-request", occurredAt: NOW },
    );
    state = paused.state;
    expect(state.status).toBe("running");
    expect(state.pauseRequested).toBe(true);

    state = applyOrchestratorEvent(
      state,
      runtimeEvent("step.succeeded", 5, "draft", "write"),
    ).state;
    expect(state.status).toBe("paused");

    const resumed = transitionOrchestrator(
      state,
      command({
        type: "resume",
        actor: { type: "human", id: USER_ID },
      }),
      { eventId: "resume", occurredAt: NOW },
    );
    expect(resumed.state.status).toBe("queued");
    expect(resumed.state.pauseRequested).toBe(false);
  });

  it("cancels unfinished tasks without deleting completed history", () => {
    let state = createScheduledOrchestratorState(
      schedule([task("a"), task("b", { dependsOn: ["a"] })]),
    );
    state = applyOrchestratorEvent(state, runtimeEvent("task.started", 2, "a")).state;
    state = applyOrchestratorEvent(state, runtimeEvent("step.started", 3, "a", "write")).state;
    state = applyOrchestratorEvent(state, runtimeEvent("step.succeeded", 4, "a", "write")).state;
    state = applyOrchestratorEvent(state, runtimeEvent("task.succeeded", 5, "a")).state;

    const canceled = transitionOrchestrator(
      state,
      command({
        type: "cancel",
        actor: { type: "human", id: USER_ID },
        reason: "停止后续章节",
      }),
      { eventId: "cancel", occurredAt: NOW },
    );
    expect(canceled.state.status).toBe("cancelled");
    expect(canceled.state.tasks.find((candidate) => candidate.key === "a")?.status).toBe(
      "succeeded",
    );
    expect(canceled.state.tasks.find((candidate) => candidate.key === "b")?.status).toBe(
      "cancelled",
    );
  });

  it("cannot let an agent approve a human or high-risk gate", () => {
    let state = createScheduledOrchestratorState(
      schedule([task("risk", { risk: "high", approval: "human" })]),
    );
    expect(state.tasks[0]?.status).toBe("waiting_review");

    expect(() =>
      transitionOrchestrator(
        state,
        {
          schemaVersion: 1,
          runId: RUN_ID,
          commandId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a2f01",
          type: "approve_task",
          actor: { type: "agent", id: GRANT_ID },
          taskKey: "risk",
          approvalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e99",
        } as OrchestratorCommand,
        { eventId: "agent-approve", occurredAt: NOW },
      ),
    ).toThrow();

    state = transitionOrchestrator(
      state,
      command({
        type: "approve_task",
        actor: { type: "human", id: USER_ID },
        taskKey: "risk",
        approvalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e99",
      }),
      { eventId: "human-approve", occurredAt: NOW },
    ).state;
    expect(state.tasks[0]).toMatchObject({
      status: "ready",
      approvedBy: USER_ID,
      approvalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e99",
    });
  });

  it("escalates to a human gate and only the owner can approve", () => {
    let state = createScheduledOrchestratorState(schedule());
    state = transitionOrchestrator(
      state,
      command({
        type: "escalate_task",
        actor: { type: "agent", id: GRANT_ID },
        taskKey: "draft",
        reason: "需要作者确认世界观",
      }),
      { eventId: "escalate", occurredAt: NOW },
    ).state;
    expect(state.tasks[0]?.status).toBe("waiting_review");
    expect(state.tasks[0]?.escalationReason).toBe("需要作者确认世界观");

    expect(() =>
      transitionOrchestrator(
        state,
        command({
          type: "approve_task",
          actor: { type: "human", id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e98" },
          taskKey: "draft",
          approvalId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e97",
        }),
        { eventId: "wrong-owner", occurredAt: NOW },
      ),
    ).toThrow();
  });

  it("keeps the transition table versioned and closed", () => {
    expect(ORCHESTRATOR_RUN_TRANSITIONS.queued).toContain("running");
    expect(canTransitionOrchestratorRun("cancelled", "running")).toBe(false);
    expect(canTransitionOrchestratorRun("running", "paused")).toBe(true);
    expect(canTransitionOrchestratorTask("waiting_review", "ready")).toBe(true);
    expect(canTransitionOrchestratorTask("succeeded", "running")).toBe(false);
    expect(canTransitionOrchestratorStep("running", "succeeded")).toBe(true);
    expect(canTransitionOrchestratorStep("cancelled", "running")).toBe(false);
  });
});

describe("dynamic subtask envelope", () => {
  it("rejects additions when disabled or outside task, depth, fan-out and budget limits", () => {
    const state = createScheduledOrchestratorState(schedule());
    const disabled = {
      ...state,
      envelope: { ...state.envelope, dynamicSubtasks: false },
    };
    const addCommand = command({
      type: "add_subtasks",
      actor: { type: "agent", id: GRANT_ID },
      parentTaskKey: "draft",
      tasks: [task("child", { dependsOn: ["draft"] })],
    }) as Extract<OrchestratorCommand, { type: "add_subtasks" }>;

    expect(validateOrchestratorSubtasks(disabled, addCommand)).toContainEqual(
      expect.objectContaining({ code: "dynamic_subtasks_disabled" }),
    );

    const tooMany = {
      ...state,
      envelope: { ...state.envelope, maxTasks: 1 },
    };
    expect(validateOrchestratorSubtasks(tooMany, addCommand)).toContainEqual(
      expect.objectContaining({ code: "task_limit_exceeded" }),
    );

    const tooWide = {
      ...state,
      envelope: { ...state.envelope, maxFanOut: 0 },
    };
    expect(validateOrchestratorSubtasks(tooWide, addCommand)).toContainEqual(
      expect.objectContaining({ code: "fanout_exceeded" }),
    );

    const overBudget = {
      ...state,
      envelope: {
        ...state.envelope,
        budget: { maxCostCny: 0.1, maxTokens: 1_000, maxCalls: 10 },
      },
    };
    expect(validateOrchestratorSubtasks(overBudget, addCommand)).toContainEqual(
      expect.objectContaining({ code: "budget_exceeded" }),
    );
  });

  it("adds authorized subtasks deterministically", () => {
    let state = createScheduledOrchestratorState(schedule());
    const add = transitionOrchestrator(
      state,
      command({
        type: "add_subtasks",
        actor: { type: "agent", id: GRANT_ID },
        parentTaskKey: "draft",
        tasks: [task("verify", { dependsOn: ["draft"], priority: 5 })],
      }),
      { eventId: "add-subtasks", occurredAt: NOW },
    );
    state = add.state;
    expect(state.tasks.map((candidate) => candidate.key)).toEqual(["draft", "verify"]);
    expect(state.tasks.find((candidate) => candidate.key === "verify")?.status).toBe("pending");
  });
});
