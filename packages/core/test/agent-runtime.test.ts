import { describe, expect, it } from "vitest";

import type { AgentContract, AgentGrant, AgentToolCallRequest } from "@novel-brain/contracts";

import {
  AgentContractValidationError,
  evaluateToolCallPolicy,
  getToolRegistryEntry,
  listToolRegistry,
  validateAgentContract,
  validateAgentOutput,
  validateToolCallInput,
} from "../src";

const WORK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c21";
const BRANCH_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c22";
const TASK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c23";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c24";
const SETTING_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c25";
const USER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c26";
const GRANT_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c27";
const APPROVAL_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c28";
const NOW = "2026-11-06T10:00:00.000Z";

const outputSchema = {
  type: "object",
  properties: { draft: { type: "string", minLength: 1 } },
  required: ["draft"],
  additionalProperties: false,
};

function grant(overrides: Partial<AgentGrant> = {}): AgentGrant {
  return {
    id: GRANT_ID,
    workId: WORK_ID,
    branchId: BRANCH_ID,
    taskId: TASK_ID,
    userId: USER_ID,
    role: "writer",
    state: "active",
    tools: ["context.read_pack", "draft.write_version"],
    resourceScope: {
      chapterIds: [CHAPTER_ID],
      settingIds: [SETTING_ID],
      includeCanon: false,
    },
    budget: {
      maxCostCny: 2,
      maxTokens: 12_000,
      maxCalls: 8,
      spentCostCny: 0.1,
      spentTokens: 500,
      callCount: 1,
    },
    maxImpact: {
      maxSideEffect: "S1",
      maxAffectedResources: 2,
    },
    expiresAt: "2026-11-06T12:00:00.000Z",
    issuedBy: USER_ID,
    revokedAt: null,
    revokedBy: null,
    revocationReason: null,
    createdAt: "2026-11-06T09:00:00.000Z",
    ...overrides,
  };
}

function call(
  overrides: Partial<
    AgentToolCallRequest & { userId: string; workId: string; branchId: string }
  > = {},
) {
  return {
    grantId: GRANT_ID,
    taskId: TASK_ID,
    toolName: "draft.write_version",
    resource: { type: "chapter" as const, id: CHAPTER_ID },
    input: { chapterId: CHAPTER_ID, content: "草稿" },
    estimatedCostCny: 0.01,
    estimatedTokens: 100,
    affectedResources: 1,
    approval: null,
    userId: USER_ID,
    workId: WORK_ID,
    branchId: BRANCH_ID,
    ...overrides,
  };
}

describe("tool registry and grant policy", () => {
  it("classifies every tool from S0 through S4", () => {
    const levels = new Map(listToolRegistry().map((tool) => [tool.sideEffect, tool.name]));
    expect([...levels.keys()].sort()).toEqual(["S0", "S1", "S2", "S3", "S4"]);
    expect(getToolRegistryEntry("context.read_pack")?.sideEffect).toBe("S0");
    expect(getToolRegistryEntry("draft.write_version")?.sideEffect).toBe("S1");
    expect(getToolRegistryEntry("fact.propose")?.sideEffect).toBe("S2");
    expect(getToolRegistryEntry("canon.commit")).toMatchObject({
      sideEffect: "S3",
      approval: "human",
    });
    expect(getToolRegistryEntry("export.work_bundle")).toMatchObject({
      sideEffect: "S4",
      agentCallable: false,
    });
  });

  it.each([
    [
      "S0 read",
      { tools: ["context.read_pack"] },
      { toolName: "context.read_pack", input: { taskId: TASK_ID } },
      "allow",
      "allowed",
    ],
    ["S1 draft", {}, {}, "allow", "allowed"],
    [
      "S2 proposal",
      {
        role: "fact_extractor",
        tools: ["fact.propose"],
        maxImpact: { maxSideEffect: "S2", maxAffectedResources: 2 },
      },
      {
        toolName: "fact.propose",
        input: { chapterId: CHAPTER_ID, proposal: "左臂骨折" },
        resource: { type: "chapter", id: CHAPTER_ID },
      },
      "allow",
      "allowed",
    ],
    [
      "S3 human approval",
      {
        role: "canon_curator",
        tools: ["canon.commit"],
        maxImpact: { maxSideEffect: "S3", maxAffectedResources: 2 },
        resourceScope: { chapterIds: [CHAPTER_ID], settingIds: [SETTING_ID], includeCanon: true },
      },
      {
        toolName: "canon.commit",
        input: { chapterId: CHAPTER_ID, approvalId: APPROVAL_ID },
        resource: { type: "canon", id: CHAPTER_ID },
        approval: { approvalId: APPROVAL_ID, approvedBy: USER_ID, approvedSideEffect: "S3" },
      },
      "allow",
      "allowed",
    ],
    [
      "S3 missing approval",
      {
        role: "canon_curator",
        tools: ["canon.commit"],
        maxImpact: { maxSideEffect: "S3", maxAffectedResources: 2 },
        resourceScope: { chapterIds: [CHAPTER_ID], settingIds: [SETTING_ID], includeCanon: true },
      },
      {
        toolName: "canon.commit",
        input: { chapterId: CHAPTER_ID, approvalId: APPROVAL_ID },
        resource: { type: "canon", id: CHAPTER_ID },
      },
      "deny",
      "approval_required",
    ],
    [
      "S4 external",
      {
        tools: ["export.work_bundle"],
        maxImpact: { maxSideEffect: "S4", maxAffectedResources: 2 },
      },
      {
        toolName: "export.work_bundle",
        input: { workId: WORK_ID },
        resource: { type: "task", id: TASK_ID },
      },
      "deny",
      "tool_not_agent_callable",
    ],
    [
      "unknown tool",
      { tools: ["grant.issue"] },
      { toolName: "grant.issue", input: {} },
      "deny",
      "tool_not_registered",
    ],
    ["not whitelisted", { tools: ["context.read_pack"] }, {}, "deny", "tool_not_whitelisted"],
    [
      "role cannot use tool",
      {
        role: "writer",
        tools: ["canon.commit"],
        maxImpact: { maxSideEffect: "S3", maxAffectedResources: 2 },
      },
      {
        toolName: "canon.commit",
        input: { chapterId: CHAPTER_ID, approvalId: APPROVAL_ID },
        resource: { type: "canon", id: CHAPTER_ID },
        approval: { approvalId: APPROVAL_ID, approvedBy: USER_ID, approvedSideEffect: "S3" },
      },
      "deny",
      "role_not_allowed",
    ],
    [
      "side effect exceeds grant",
      { maxImpact: { maxSideEffect: "S0", maxAffectedResources: 2 } },
      {},
      "deny",
      "side_effect_exceeds_grant",
    ],
    [
      "chapter outside scope",
      {},
      { resource: { type: "chapter", id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c99" } },
      "deny",
      "resource_out_of_scope",
    ],
    [
      "canon outside scope",
      {},
      { resource: { type: "canon", id: CHAPTER_ID } },
      "deny",
      "resource_out_of_scope",
    ],
    [
      "affected resources exceeded",
      {},
      { affectedResources: 3 },
      "deny",
      "affected_resources_exceeded",
    ],
    ["cost budget exceeded", {}, { estimatedCostCny: 1.91 }, "deny", "budget_exceeded"],
    ["token budget exceeded", {}, { estimatedTokens: 11_501 }, "deny", "budget_exceeded"],
    [
      "call budget exceeded",
      { budget: { ...grant().budget, callCount: 8 } },
      {},
      "deny",
      "budget_exceeded",
    ],
    [
      "revoked grant",
      {
        state: "revoked",
        revokedAt: "2026-11-06T09:30:00.000Z",
        revokedBy: USER_ID,
        revocationReason: "作者撤销",
      },
      {},
      "deny",
      "grant_revoked",
    ],
    ["expired grant", { state: "expired" }, {}, "deny", "grant_expired"],
    [
      "tenant mismatch",
      {},
      { userId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c98" },
      "deny",
      "tenant_mismatch",
    ],
    [
      "work mismatch",
      {},
      { workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c97" },
      "deny",
      "work_mismatch",
    ],
    [
      "branch mismatch",
      {},
      { branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c96" },
      "deny",
      "branch_mismatch",
    ],
    [
      "task mismatch",
      {},
      { taskId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c95" },
      "deny",
      "task_mismatch",
    ],
  ])("%s is %s", (_name, grantOverrides, callOverrides, decision, reason) => {
    const result = evaluateToolCallPolicy({
      now: NOW,
      grant: grant(grantOverrides as Partial<AgentGrant>),
      call: call(callOverrides as Partial<AgentToolCallRequest>),
    });
    expect(result).toMatchObject({ decision, reason });
  });

  it("treats wall-clock expiry as unusable for running calls", () => {
    expect(
      evaluateToolCallPolicy({
        now: "2026-11-06T12:00:00.000Z",
        grant: grant(),
        call: call(),
      }),
    ).toMatchObject({ decision: "deny", reason: "grant_expired" });
  });
});

describe("agent contract validation", () => {
  const contract: AgentContract = {
    key: "writer.chapter.v1",
    version: 1,
    role: "writer",
    description: "按章纲生成正文草稿",
    inputSchema: {
      type: "object",
      properties: { goal: { type: "string", minLength: 1 } },
      required: ["goal"],
      additionalProperties: false,
    },
    outputSchema,
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

  it("accepts registered tools for the declared role", () => {
    expect(validateAgentContract(contract)).toEqual(contract);
  });

  it("rejects unregistered tools and tools outside the role capability", () => {
    expect(() =>
      validateAgentContract({
        ...contract,
        tools: [{ name: "grant.issue", required: true }],
      }),
    ).toThrow(AgentContractValidationError);
    expect(() => validateAgentContract({ ...contract, role: "critic" })).toThrow(
      AgentContractValidationError,
    );
  });

  it("requires closed schemas and rejects invalid or widened output", () => {
    expect(() =>
      validateAgentContract({
        ...contract,
        outputSchema: { type: "object", properties: { draft: { type: "string" } } },
      }),
    ).toThrow(AgentContractValidationError);

    expect(validateAgentOutput(contract, { draft: "沈砚用右手结印。" })).toEqual({
      draft: "沈砚用右手结印。",
    });
    expect(() => validateAgentOutput(contract, { draft: "" })).toThrow(
      AgentContractValidationError,
    );
    expect(() => validateAgentOutput(contract, { draft: "草稿", canon: true })).toThrow(
      AgentContractValidationError,
    );
  });

  it("validates tool input against the registry, not a model-supplied schema", () => {
    expect(
      validateToolCallInput("draft.write_version", { chapterId: CHAPTER_ID, content: "草稿" }),
    ).toEqual({ chapterId: CHAPTER_ID, content: "草稿" });
    expect(() =>
      validateToolCallInput("draft.write_version", {
        chapterId: CHAPTER_ID,
        content: "草稿",
        canonCommit: true,
      }),
    ).toThrow(AgentContractValidationError);
  });
});
