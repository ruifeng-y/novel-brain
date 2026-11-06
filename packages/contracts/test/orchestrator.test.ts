import { describe, expect, it } from "vitest";

import {
  ORCHESTRATOR_CONTRACT_VERSION,
  orchestratorEventSchema,
  orchestratorRunStateSchema,
  orchestratorScheduleCommandSchema,
} from "../src";

const RUN_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d01";
const COMMAND_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d02";
const TASK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d03";
const GRANT_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d04";
const USER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d05";
const WORK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d06";
const BRANCH_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d07";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1d08";

function scheduleCommand() {
  return {
    type: "schedule",
    schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
    commandId: COMMAND_ID,
    runId: RUN_ID,
    idempotencyKey: "chapter-1-workflow",
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
      budget: { maxCostCny: 3, maxTokens: 20_000, maxCalls: 12 },
    },
    tasks: [
      {
        id: TASK_ID,
        key: "draft",
        title: "起草",
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
            input: { chapterId: CHAPTER_ID, content: "草稿" },
            estimatedCostCny: 0.5,
            estimatedTokens: 1_000,
          },
        ],
      },
    ],
  };
}

describe("orchestrator contracts", () => {
  it("parses a versioned schedule command and rejects widened fields", () => {
    const command = scheduleCommand();
    expect(orchestratorScheduleCommandSchema.parse(command)).toEqual(command);
    expect(() => orchestratorScheduleCommandSchema.parse({ ...command, grantAll: true })).toThrow();
    expect(() =>
      orchestratorScheduleCommandSchema.parse({ ...command, schemaVersion: 2 }),
    ).toThrow();
    expect(() =>
      orchestratorScheduleCommandSchema.parse({
        ...command,
        tasks: [{ ...command.tasks[0], risk: "high" }],
      }),
    ).toThrow();
  });

  it("requires versioned events and durable run state", () => {
    const state = {
      schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
      runId: RUN_ID,
      ownerId: USER_ID,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      workflowKey: "chapter.write.v1",
      workflowVersion: 1,
      idempotencyKey: "chapter-1-workflow",
      envelope: scheduleCommand().envelope,
      status: "queued",
      pauseRequested: false,
      cancelReason: null,
      failureMessage: null,
      lastSequence: 1,
      appliedCommandIds: [COMMAND_ID],
      appliedEventIds: ["event-1"],
      tasks: [
        {
          id: TASK_ID,
          key: "draft",
          title: "起草",
          priority: 10,
          dependsOn: [],
          role: "writer",
          grantId: GRANT_ID,
          resource: { type: "chapter", id: CHAPTER_ID },
          affectedResources: 1,
          risk: "low",
          approval: "none",
          status: "ready",
          attempt: 0,
          approvedBy: null,
          approvalId: null,
          escalationReason: null,
          steps: [
            {
              key: "write",
              toolName: "draft.write_version",
              input: { chapterId: CHAPTER_ID, content: "草稿" },
              estimatedCostCny: 0.5,
              estimatedTokens: 1_000,
              status: "pending",
              attempt: 0,
              output: {},
              errorCode: null,
              errorMessage: null,
            },
          ],
        },
      ],
    };

    expect(orchestratorRunStateSchema.parse(state)).toEqual(state);
    expect(() => orchestratorRunStateSchema.parse({ ...state, schemaVersion: 2 })).toThrow();

    const event = {
      schemaVersion: ORCHESTRATOR_CONTRACT_VERSION,
      eventId: "event-1",
      runId: RUN_ID,
      sequence: 1,
      type: "run.scheduled",
      occurredAt: "2026-11-06T10:00:00.000Z",
      taskKey: null,
      stepKey: null,
      data: {},
    };
    expect(orchestratorEventSchema.parse(event)).toEqual(event);
    expect(() => orchestratorEventSchema.parse({ ...event, sequence: 0 })).toThrow();
    expect(() => orchestratorEventSchema.parse({ ...event, type: "run.unknown" })).toThrow();
  });
});
