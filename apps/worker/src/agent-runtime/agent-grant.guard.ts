import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  agentToolCallRequestSchema,
  type AgentGrant,
  type AgentRole,
  type AgentToolCallRequest,
  type AgentToolResource,
} from "@novel-brain/contracts";
import {
  AgentContractValidationError,
  evaluateToolCallPolicy,
  validateToolCallInput,
  type AgentToolPolicyDecision,
} from "@novel-brain/core";
import { AgentGrantStore, toAgentGrantContract, type AgentGrantAudit } from "@novel-brain/db";

export class AgentGrantViolation extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentGrantViolation";
  }
}

export interface AgentGrantScopeInput {
  userId: string;
  workId: string;
  branchId: string;
  taskId: string;
}

export interface AgentGrantDispatchInput extends AgentGrantScopeInput {
  grantId: string;
  expectedRole?: AgentRole;
  expectedTools?: string[];
  audit: AgentGrantAudit;
  now?: Date;
}

export interface AgentGrantToolCallInput extends AgentGrantScopeInput {
  grantId: string;
  agentRunId?: string | null;
  toolName: string;
  resource: AgentToolResource;
  input: Record<string, unknown>;
  affectedResources: number;
  estimatedCostCny: number;
  estimatedTokens: number;
  approval: AgentToolCallRequest["approval"];
  audit: AgentGrantAudit;
}

@Injectable()
export class WorkerAgentGrantStore extends AgentGrantStore implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}

@Injectable()
export class AgentGrantGuard {
  constructor(private readonly store: AgentGrantStore) {}

  async assertDispatch(input: AgentGrantDispatchInput): Promise<AgentGrant> {
    const record = await this.store.findGrant(
      input.userId,
      { workId: input.workId, branchId: input.branchId },
      input.grantId,
    );
    if (!record) {
      await this.store.recordDispatchCheck({
        userId: input.userId,
        grantId: input.grantId,
        decision: "deny",
        audit: input.audit,
      });
      throw new AgentGrantViolation(
        "grant_not_found",
        "Agent Grant does not exist for this task scope",
      );
    }
    const now = input.now ?? new Date();
    const grant = toAgentGrantContract(record, now);
    const reason = dispatchDenial(grant, input);
    await this.store.recordDispatchCheck({
      userId: input.userId,
      grantId: input.grantId,
      decision: reason ? "deny" : "allow",
      audit: input.audit,
    });
    if (reason) {
      throw new AgentGrantViolation(reason, `Agent Grant dispatch denied: ${reason}`);
    }
    return grant;
  }

  async authorizeToolCall(input: AgentGrantToolCallInput): Promise<{
    grant: AgentGrant;
    decision: AgentToolPolicyDecision;
  }> {
    const parsed = agentToolCallRequestSchema.safeParse({
      grantId: input.grantId,
      taskId: input.taskId,
      toolName: input.toolName,
      resource: input.resource,
      input: input.input,
      estimatedCostCny: input.estimatedCostCny,
      estimatedTokens: input.estimatedTokens,
      affectedResources: input.affectedResources,
      approval: input.approval,
    });
    if (!parsed.success) {
      throw new AgentGrantViolation("invalid_tool_call", parsed.error.message);
    }
    const call = parsed.data;
    try {
      validateToolCallInput(call.toolName, call.input);
    } catch (error) {
      if (error instanceof AgentContractValidationError) {
        throw new AgentGrantViolation("invalid_tool_input", error.message);
      }
      throw error;
    }
    const result = await this.store.authorizeToolCall(
      {
        userId: input.userId,
        workId: input.workId,
        branchId: input.branchId,
        taskId: call.taskId,
        grantId: call.grantId,
        agentRunId: input.agentRunId ?? null,
        toolName: call.toolName,
        resource: call.resource,
        input: call.input,
        affectedResources: call.affectedResources,
        estimatedCostCny: call.estimatedCostCny,
        estimatedTokens: call.estimatedTokens,
        audit: input.audit,
      },
      (record, now) =>
        evaluateToolCallPolicy({
          now,
          grant: toAgentGrantContract(record, now),
          call: {
            ...call,
            userId: input.userId,
            workId: input.workId,
            branchId: input.branchId,
          },
        }),
    );
    if (result.decision.decision === "deny" || !result.grant) {
      throw new AgentGrantViolation(
        result.decision.reason,
        `Agent tool call denied: ${result.decision.reason}`,
      );
    }
    return {
      grant: toAgentGrantContract(result.grant),
      decision: result.decision as AgentToolPolicyDecision,
    };
  }
}

function dispatchDenial(grant: AgentGrant, input: AgentGrantDispatchInput): string | null {
  if (grant.state === "revoked") {
    return "grant_revoked";
  }
  if (grant.state === "expired") {
    return "grant_expired";
  }
  if (grant.userId !== input.userId) {
    return "tenant_mismatch";
  }
  if (grant.workId !== input.workId) {
    return "work_mismatch";
  }
  if (grant.branchId !== input.branchId) {
    return "branch_mismatch";
  }
  if (grant.taskId !== input.taskId) {
    return "task_mismatch";
  }
  if (input.expectedRole && grant.role !== input.expectedRole) {
    return "grant_role_mismatch";
  }
  if (input.expectedTools?.some((tool) => !grant.tools.includes(tool))) {
    return "tool_not_whitelisted";
  }
  return null;
}
