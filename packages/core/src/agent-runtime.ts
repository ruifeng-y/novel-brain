import { z } from "zod";

import {
  agentContractSchema,
  toolRegistryEntrySchema,
  type AgentContract,
  type AgentGrant,
  type AgentRole,
  type AgentToolCallRequest,
  type ToolRegistryEntry,
  type ToolSideEffectLevel,
  type ToolName,
} from "@novel-brain/contracts";

export type AgentContractValidationCode =
  | "invalid_contract"
  | "schema_not_closed"
  | "unregistered_tool"
  | "role_tool_denied"
  | "invalid_input"
  | "invalid_output";

export class AgentContractValidationError extends Error {
  constructor(
    readonly code: AgentContractValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentContractValidationError";
  }
}

const UUID_V7_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

const registry = [
  {
    name: "context.read_pack",
    category: "read_context",
    sideEffect: "S0",
    description: "读取当前任务已编译的上下文包",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string", pattern: UUID_V7_PATTERN } },
      required: ["taskId"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "canon.read_confirmed",
    category: "read_story",
    sideEffect: "S0",
    description: "读取已确认设定和正史事实",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "string", pattern: UUID_V7_PATTERN } },
      required: ["chapterId"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "chapter.read_brief",
    category: "read_story",
    sideEffect: "S0",
    description: "读取章纲、场景节拍和必用事实",
    inputSchema: {
      type: "object",
      properties: { chapterId: { type: "string", pattern: UUID_V7_PATTERN } },
      required: ["chapterId"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "draft.write_version",
    category: "write_draft",
    sideEffect: "S1",
    description: "追加一个可回滚的章节草稿版本",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "string", pattern: UUID_V7_PATTERN },
        content: { type: "string", minLength: 1 },
      },
      required: ["chapterId", "content"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "review.report_finding",
    category: "write_review",
    sideEffect: "S1",
    description: "写入结构化评审问题，不修改正文",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "string", pattern: UUID_V7_PATTERN },
        finding: { type: "string", minLength: 1 },
      },
      required: ["chapterId", "finding"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "fact.propose",
    category: "propose_fact",
    sideEffect: "S2",
    description: "提交事实提案，等待作者逐条确认",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "string", pattern: UUID_V7_PATTERN },
        proposal: { type: "string", minLength: 1 },
      },
      required: ["chapterId", "proposal"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "canon.propose_commit",
    category: "propose_fact",
    sideEffect: "S2",
    description: "生成正史提交候选，不执行提交",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "string", pattern: UUID_V7_PATTERN },
        factIds: { type: "array", items: { type: "string", pattern: UUID_V7_PATTERN } },
      },
      required: ["chapterId", "factIds"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "none",
  },
  {
    name: "canon.commit",
    category: "commit_canon",
    sideEffect: "S3",
    description: "在作者确认后由唯一提交入口写入正史",
    inputSchema: {
      type: "object",
      properties: {
        chapterId: { type: "string", pattern: UUID_V7_PATTERN },
        approvalId: { type: "string", pattern: UUID_V7_PATTERN },
      },
      required: ["chapterId", "approvalId"],
      additionalProperties: false,
    },
    agentCallable: true,
    approval: "human",
  },
  {
    name: "export.work_bundle",
    category: "external_irreversible",
    sideEffect: "S4",
    description: "导出作品包，只能由作者本人发起",
    inputSchema: {
      type: "object",
      properties: { workId: { type: "string", pattern: UUID_V7_PATTERN } },
      required: ["workId"],
      additionalProperties: false,
    },
    agentCallable: false,
    approval: "human",
  },
] as const;

export const TOOL_REGISTRY: readonly ToolRegistryEntry[] = Object.freeze(
  registry.map((entry) => toolRegistryEntrySchema.parse(entry)),
);

const REGISTRY_BY_NAME = new Map(TOOL_REGISTRY.map((entry) => [entry.name, entry]));

const ROLE_TOOL_ALLOWLIST: Record<AgentRole, readonly ToolName[]> = {
  planner: [
    "context.read_pack",
    "canon.read_confirmed",
    "chapter.read_brief",
    "canon.propose_commit",
  ],
  context_curator: ["context.read_pack", "canon.read_confirmed", "chapter.read_brief"],
  writer: [
    "context.read_pack",
    "canon.read_confirmed",
    "chapter.read_brief",
    "draft.write_version",
  ],
  critic: [
    "context.read_pack",
    "canon.read_confirmed",
    "chapter.read_brief",
    "review.report_finding",
  ],
  reviser: [
    "context.read_pack",
    "canon.read_confirmed",
    "chapter.read_brief",
    "draft.write_version",
  ],
  fact_extractor: [
    "context.read_pack",
    "canon.read_confirmed",
    "chapter.read_brief",
    "fact.propose",
  ],
  canon_curator: [
    "context.read_pack",
    "canon.read_confirmed",
    "chapter.read_brief",
    "canon.propose_commit",
    "canon.commit",
  ],
};

export function listToolRegistry(): readonly ToolRegistryEntry[] {
  return TOOL_REGISTRY;
}

export function getToolRegistryEntry(name: string): ToolRegistryEntry | undefined {
  return REGISTRY_BY_NAME.get(name);
}

export function isToolAllowedForRole(role: AgentRole, toolName: string): boolean {
  return ROLE_TOOL_ALLOWLIST[role].includes(toolName);
}

export function validateAgentContract(input: unknown): AgentContract {
  let contract: AgentContract;
  try {
    contract = agentContractSchema.parse(input);
  } catch (error) {
    throw new AgentContractValidationError("invalid_contract", errorMessage(error));
  }

  assertClosedObjectSchema(contract.inputSchema, "inputSchema");
  assertClosedObjectSchema(contract.outputSchema, "outputSchema");

  for (const tool of contract.tools) {
    const entry = getToolRegistryEntry(tool.name);
    if (!entry) {
      throw new AgentContractValidationError(
        "unregistered_tool",
        `Tool is not registered: ${tool.name}`,
      );
    }
    if (!ROLE_TOOL_ALLOWLIST[contract.role].includes(tool.name)) {
      throw new AgentContractValidationError(
        "role_tool_denied",
        `Role ${contract.role} cannot use tool ${tool.name}`,
      );
    }
  }

  return contract;
}

export function validateAgentInput(contract: AgentContract, input: unknown): unknown {
  return parseJsonSchema(contract.inputSchema, input, "invalid_input");
}

export function validateAgentOutput(contract: AgentContract, output: unknown): unknown {
  return parseJsonSchema(contract.outputSchema, output, "invalid_output");
}

export function validateToolCallInput(toolName: string, input: unknown): unknown {
  const entry = getToolRegistryEntry(toolName);
  if (!entry) {
    throw new AgentContractValidationError(
      "unregistered_tool",
      `Tool is not registered: ${toolName}`,
    );
  }
  return parseJsonSchema(entry.inputSchema, input, "invalid_input");
}

export type AgentToolPolicyReason =
  | "allowed"
  | "grant_revoked"
  | "grant_expired"
  | "tenant_mismatch"
  | "work_mismatch"
  | "branch_mismatch"
  | "task_mismatch"
  | "tool_not_registered"
  | "tool_not_agent_callable"
  | "role_not_allowed"
  | "tool_not_whitelisted"
  | "side_effect_exceeds_grant"
  | "approval_required"
  | "irreversible_requires_human"
  | "resource_out_of_scope"
  | "affected_resources_exceeded"
  | "budget_exceeded";

export interface AgentToolPolicyCall extends AgentToolCallRequest {
  userId: string;
  workId: string;
  branchId: string;
}

export interface AgentToolPolicyDecision {
  decision: "allow" | "deny";
  reason: AgentToolPolicyReason;
  toolName: string;
  sideEffect: ToolSideEffectLevel | null;
  approvalRequired: boolean;
}

export function evaluateToolCallPolicy(input: {
  now: string | Date;
  grant: AgentGrant;
  call: AgentToolPolicyCall;
}): AgentToolPolicyDecision {
  const { grant, call } = input;
  const deny = (reason: AgentToolPolicyReason, entry?: ToolRegistryEntry) =>
    decision("deny", reason, call.toolName, entry);

  if (grant.state === "revoked" || grant.revokedAt) {
    return deny("grant_revoked");
  }
  if (grant.state === "expired" || new Date(input.now).getTime() >= Date.parse(grant.expiresAt)) {
    return deny("grant_expired");
  }
  if (call.grantId !== grant.id) {
    return deny("tenant_mismatch");
  }
  if (call.userId !== grant.userId) {
    return deny("tenant_mismatch");
  }
  if (call.workId !== grant.workId) {
    return deny("work_mismatch");
  }
  if (call.branchId !== grant.branchId) {
    return deny("branch_mismatch");
  }
  if (call.taskId !== grant.taskId) {
    return deny("task_mismatch");
  }

  const entry = getToolRegistryEntry(call.toolName);
  if (!entry) {
    return deny("tool_not_registered");
  }
  if (!entry.agentCallable) {
    return deny("tool_not_agent_callable", entry);
  }
  if (!ROLE_TOOL_ALLOWLIST[grant.role].includes(entry.name)) {
    return deny("role_not_allowed", entry);
  }
  if (!grant.tools.includes(entry.name)) {
    return deny("tool_not_whitelisted", entry);
  }
  if (sideEffectRank(entry.sideEffect) > sideEffectRank(grant.maxImpact.maxSideEffect)) {
    return deny("side_effect_exceeds_grant", entry);
  }
  if (entry.sideEffect === "S4") {
    return deny("irreversible_requires_human", entry);
  }
  if (entry.approval === "human") {
    if (
      !call.approval ||
      call.approval.approvedSideEffect !== entry.sideEffect ||
      call.approval.approvedBy !== grant.userId
    ) {
      return deny("approval_required", entry);
    }
  }
  if (!resourceInScope(grant, call)) {
    return deny("resource_out_of_scope", entry);
  }
  if (call.affectedResources > grant.maxImpact.maxAffectedResources) {
    return deny("affected_resources_exceeded", entry);
  }
  if (
    grant.budget.callCount >= grant.budget.maxCalls ||
    grant.budget.spentCostCny + call.estimatedCostCny > grant.budget.maxCostCny ||
    grant.budget.spentTokens + call.estimatedTokens > grant.budget.maxTokens
  ) {
    return deny("budget_exceeded", entry);
  }
  return decision("allow", "allowed", call.toolName, entry);
}

function decision(
  value: "allow" | "deny",
  reason: AgentToolPolicyReason,
  toolName: string,
  entry?: ToolRegistryEntry,
): AgentToolPolicyDecision {
  return {
    decision: value,
    reason,
    toolName,
    sideEffect: entry?.sideEffect ?? null,
    approvalRequired: entry?.approval === "human",
  };
}

function sideEffectRank(level: ToolSideEffectLevel): number {
  return Number(level.slice(1));
}

function resourceInScope(grant: AgentGrant, call: AgentToolPolicyCall): boolean {
  switch (call.resource.type) {
    case "task":
      return call.resource.id === grant.taskId;
    case "chapter":
      return grant.resourceScope.chapterIds.includes(call.resource.id);
    case "setting":
      return grant.resourceScope.settingIds.includes(call.resource.id);
    case "canon":
      return grant.resourceScope.includeCanon;
  }
}

function parseJsonSchema(
  schema: Record<string, unknown>,
  value: unknown,
  code: "invalid_input" | "invalid_output",
): unknown {
  try {
    const parsed = z.fromJSONSchema(schema as never).safeParse(value);
    if (!parsed.success) {
      throw new AgentContractValidationError(code, parsed.error.message);
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AgentContractValidationError) {
      throw error;
    }
    throw new AgentContractValidationError(code, errorMessage(error));
  }
}

function assertClosedObjectSchema(
  schema: Record<string, unknown>,
  field: "inputSchema" | "outputSchema",
): void {
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    throw new AgentContractValidationError(
      "schema_not_closed",
      `${field} must be a closed object schema with additionalProperties: false`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
