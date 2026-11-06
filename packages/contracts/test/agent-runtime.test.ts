import { describe, expect, it } from "vitest";

import {
  agentContractSchema,
  agentGrantCreateRequestSchema,
  agentGrantRevokeRequestSchema,
  agentGrantSchema,
  agentToolCallRequestSchema,
  toolRegistryEntrySchema,
} from "../src";

const WORK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c21";
const BRANCH_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c22";
const TASK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c23";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c24";
const USER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c25";
const GRANT_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c26";

const objectSchema = {
  type: "object",
  properties: { goal: { type: "string", minLength: 1 } },
  required: ["goal"],
  additionalProperties: false,
};

describe("agent runtime contracts", () => {
  it("rejects unknown contract fields and malformed role declarations", () => {
    const contract = {
      key: "writer.chapter.v1",
      version: 1,
      role: "writer",
      description: "按章纲生成正文草稿",
      inputSchema: objectSchema,
      outputSchema: objectSchema,
      tools: [{ name: "draft.write_version", required: true }],
      failureSemantics: {
        invalidOutput: "fail_run",
        toolDenied: "fail_run",
        budgetExceeded: "pause_task",
        retry: {
          maxAttempts: 2,
          retryableCodes: ["PROVIDER_TIMEOUT"],
          exhaustedAction: "pause_task",
          preserveCheckpoint: true,
        },
      },
    };

    expect(agentContractSchema.parse(contract)).toEqual(contract);
    expect(() => agentContractSchema.parse({ ...contract, canGrant: true })).toThrow();
    expect(() => agentContractSchema.parse({ ...contract, role: "free_agent" })).toThrow();
    expect(() =>
      agentContractSchema.parse({
        ...contract,
        tools: [{ name: "draft.write_version", required: true, sideEffect: "S0" }],
      }),
    ).toThrow();
  });

  it("rejects grants that try to set tenant identity, delegation or pre-spent budget", () => {
    const request = {
      taskId: TASK_ID,
      role: "writer",
      tools: ["context.read_pack", "draft.write_version"],
      resourceScope: {
        chapterIds: [CHAPTER_ID],
        settingIds: [],
        includeCanon: false,
      },
      budget: {
        maxCostCny: 2,
        maxTokens: 12_000,
        maxCalls: 8,
      },
      maxImpact: {
        maxSideEffect: "S1",
        maxAffectedResources: 1,
      },
      expiresAt: "2026-11-06T12:00:00.000Z",
    };

    expect(agentGrantCreateRequestSchema.parse(request)).toEqual(request);
    expect(() => agentGrantCreateRequestSchema.parse({ ...request, userId: USER_ID })).toThrow();
    expect(() => agentGrantCreateRequestSchema.parse({ ...request, issuedBy: USER_ID })).toThrow();
    expect(() =>
      agentGrantCreateRequestSchema.parse({
        ...request,
        budget: { ...request.budget, spentCostCny: 0 },
      }),
    ).toThrow();
    expect(() =>
      agentGrantCreateRequestSchema.parse({
        ...request,
        tools: ["context.read_pack", "context.read_pack"],
      }),
    ).toThrow();
    expect(() =>
      agentGrantCreateRequestSchema.parse({
        ...request,
        maxImpact: { ...request.maxImpact, maxSideEffect: "S9" },
      }),
    ).toThrow();
  });

  it("models grant state, budget usage and revocation evidence", () => {
    const grant = {
      id: GRANT_ID,
      workId: WORK_ID,
      branchId: BRANCH_ID,
      taskId: TASK_ID,
      userId: USER_ID,
      role: "writer",
      state: "revoked",
      tools: ["context.read_pack", "draft.write_version"],
      resourceScope: {
        chapterIds: [CHAPTER_ID],
        settingIds: [],
        includeCanon: false,
      },
      budget: {
        maxCostCny: 2,
        maxTokens: 12_000,
        maxCalls: 8,
        spentCostCny: 0.1,
        spentTokens: 400,
        callCount: 1,
      },
      maxImpact: {
        maxSideEffect: "S1",
        maxAffectedResources: 1,
      },
      expiresAt: "2026-11-06T12:00:00.000Z",
      issuedBy: USER_ID,
      revokedAt: "2026-11-06T10:00:00.000Z",
      revokedBy: USER_ID,
      revocationReason: "作者取消本次生成",
      createdAt: "2026-11-06T09:00:00.000Z",
    };

    expect(agentGrantSchema.parse(grant)).toEqual(grant);
    expect(() => agentGrantSchema.parse({ ...grant, state: "pending" })).toThrow();
    expect(() =>
      agentGrantSchema.parse({
        ...grant,
        budget: { ...grant.budget, spentTokens: 12_001 },
      }),
    ).toThrow();
    expect(agentGrantRevokeRequestSchema.parse({ reason: "作者取消本次生成" })).toEqual({
      reason: "作者取消本次生成",
    });
    expect(() => agentGrantRevokeRequestSchema.parse({ reason: "", actorId: USER_ID })).toThrow();
  });

  it("validates tool registry entries and scoped tool call requests", () => {
    expect(
      toolRegistryEntrySchema.parse({
        name: "canon.commit",
        category: "commit_canon",
        sideEffect: "S3",
        description: "在作者确认后提交已批准章节的事实",
        inputSchema: objectSchema,
        agentCallable: true,
        approval: "human",
      }),
    ).toMatchObject({ name: "canon.commit", sideEffect: "S3" });
    expect(() =>
      toolRegistryEntrySchema.parse({
        name: "canon.commit",
        category: "commit_canon",
        sideEffect: "S3",
        description: "x",
        inputSchema: objectSchema,
        agentCallable: true,
        approval: "human",
        delegateToAgent: true,
      }),
    ).toThrow();

    const call = {
      grantId: GRANT_ID,
      taskId: TASK_ID,
      toolName: "draft.write_version",
      resource: { type: "chapter", id: CHAPTER_ID },
      input: { content: "草稿" },
      estimatedCostCny: 0.02,
      estimatedTokens: 120,
      affectedResources: 1,
      approval: null,
    };
    expect(agentToolCallRequestSchema.parse(call)).toEqual(call);
    expect(() =>
      agentToolCallRequestSchema.parse({
        ...call,
        resource: { type: "chapter", id: CHAPTER_ID, label: "第一章" },
      }),
    ).toThrow();
  });
});
