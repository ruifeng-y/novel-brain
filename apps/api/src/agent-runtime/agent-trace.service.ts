import { Injectable } from "@nestjs/common";
import {
  agentRunTraceSchema,
  type AgentFailureClass,
  type AgentRunReplay,
  type AgentRunTrace,
  type AgentToolCallTrace,
  type CostReservation,
  type ModelCallStatus,
  type PromptVersion,
} from "@novel-brain/contracts";
import type {
  AgentRunRecord,
  AgentTraceRecord,
  AgentTraceReservationRecord,
  AgentTraceToolCallRecord,
  ModelCallRecord,
  PromptVersionRecord,
} from "@novel-brain/db";
import type { AgentTraceFilter, AgentTraceScope } from "@novel-brain/db";

import { ApiError } from "../common/api-error";
import { invalidCursorError } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AgentTraceRepository } from "./agent-trace.repository";

@Injectable()
export class AgentTraceService {
  constructor(private readonly repository: AgentTraceRepository) {}

  async list(
    userId: string,
    scope: AgentTraceScope,
    filter: AgentTraceFilter,
  ): Promise<{ traces: AgentRunTrace[]; nextCursor: string | null }> {
    if (!(await this.repository.scopeExists(userId, scope))) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，无权访问生成记录");
    }
    const result = await this.repository.listTraces(userId, scope, filter);
    if (result === "invalid_cursor") {
      throw invalidCursorError();
    }
    return {
      traces: result.traces.map((trace) => this.toContract(trace)),
      nextCursor: result.nextCursor,
    };
  }

  async get(userId: string, scope: AgentTraceScope, runId: string): Promise<AgentRunTrace> {
    if (!(await this.repository.scopeExists(userId, scope))) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或分支不存在，无权访问生成记录");
    }
    const trace = await this.repository.findTrace(userId, scope, runId);
    if (!trace) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "生成记录不存在或无权访问");
    }
    return this.toContract(trace);
  }

  private toContract(trace: AgentTraceRecord): AgentRunTrace {
    const { run } = trace;
    const totals = trace.modelCalls.reduce(
      (sum, call) => ({
        inputTokens: sum.inputTokens + call.inputTokens,
        outputTokens: sum.outputTokens + call.outputTokens,
        costCny: Number((sum.costCny + call.costCny).toFixed(8)),
      }),
      { inputTokens: 0, outputTokens: 0, costCny: 0 },
    );
    const prompt =
      trace.promptVersions.find((version) => version.id === run.promptVersionId) ??
      trace.promptVersions[0];
    const call = trace.modelCalls[0];
    return agentRunTraceSchema.parse({
      run: {
        id: run.id,
        jobId: run.jobId,
        workId: run.workId,
        branchId: run.branchId,
        chapterId: run.chapterId,
        stepKey: run.stepKey,
        role: run.role,
        status: run.status,
        failureClass: toFailureClass(run.failureClass),
        escalationReason: run.escalationReason,
        inputHash: hashOrFallback(run.inputHash),
        outputHash: hashOrNull(run.outputHash),
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        costCny: totals.costCny,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      },
      replay: prompt && call ? this.replay(run, prompt, call) : null,
      promptVersions: trace.promptVersions.map(toPromptVersion),
      modelCalls: trace.modelCalls.map(toModelCall),
      toolCalls: trace.toolCalls.map(toToolCall),
      costReservations: trace.costReservations.map(toReservation),
    });
  }

  private replay(
    run: AgentRunRecord,
    prompt: PromptVersionRecord,
    call: ModelCallRecord,
  ): AgentRunReplay {
    return {
      modelConfigId: run.modelConfigId,
      provider: run.provider ?? call.provider,
      model: run.model ?? call.model,
      parameters: call.parameters,
      configHash: call.configHash,
      promptVersion: {
        id: prompt.id,
        key: prompt.key,
        version: prompt.version,
        promptHash: prompt.promptHash,
        systemHash: prompt.systemHash,
        inputHash: prompt.inputHash,
      },
    };
  }
}

function toPromptVersion(record: PromptVersionRecord): PromptVersion {
  return {
    id: record.id,
    jobId: record.jobId,
    stepKey: record.stepKey,
    key: record.key,
    version: record.version,
    role: record.role as PromptVersion["role"],
    promptHash: record.promptHash,
    systemHash: record.systemHash,
    inputHash: record.inputHash,
    contextPackId: record.contextPackId,
    compilerVersion: record.compilerVersion,
    createdAt: record.createdAt.toISOString(),
  };
}

function toModelCall(record: ModelCallRecord): AgentRunTrace["modelCalls"][number] {
  return {
    id: record.id,
    agentRunId: record.agentRunId,
    promptVersionId: record.promptVersionId,
    costReservationId: record.costReservationId,
    stepKey: record.stepKey,
    attempt: record.attempt,
    status: record.status as ModelCallStatus,
    provider: record.provider,
    model: record.model,
    parameters: record.parameters,
    configHash: record.configHash,
    inputHash: record.inputHash,
    outputHash: record.outputHash,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    costCny: record.costCny,
    failureClass: toFailureClass(record.failureClass),
    errorCode: record.errorCode as AgentRunTrace["modelCalls"][number]["errorCode"],
    escalationReason: record.escalationReason,
    providerRequestId: record.providerRequestId,
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}

function toToolCall(record: AgentTraceToolCallRecord): AgentToolCallTrace {
  return {
    id: record.id,
    toolName: record.toolName,
    sideEffect: record.sideEffect as AgentToolCallTrace["sideEffect"],
    decision: record.decision as AgentToolCallTrace["decision"],
    status: record.status as AgentToolCallTrace["status"],
    reason: record.reason,
    inputHash: hashOrFallback(record.inputHash),
    inputSummary: record.inputSummary,
    outputSummary: record.outputSummary,
    estimatedCostCny: record.estimatedCostCny,
    estimatedTokens: record.estimatedTokens,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt?.toISOString() ?? null,
  };
}

function toReservation(record: AgentTraceReservationRecord): CostReservation {
  return {
    id: record.id,
    status: record.status as CostReservation["status"],
    reservedTokens: record.reservedTokens,
    reservedCostCny: record.reservedCostCny,
    settledTokens: record.settledTokens,
    settledCostCny: record.settledCostCny,
    failureClass: toFailureClass(record.failureClass),
    createdAt: record.createdAt.toISOString(),
    settledAt: record.settledAt?.toISOString() ?? null,
  };
}

function toFailureClass(value: string | null): AgentFailureClass | null {
  return value as AgentFailureClass | null;
}

function hashOrFallback(value: string): string {
  return /^[a-f0-9]{64}$/i.test(value)
    ? value
    : "0000000000000000000000000000000000000000000000000000000000000000";
}

function hashOrNull(value: string | null): string | null {
  return value && /^[a-f0-9]{64}$/i.test(value) ? value : null;
}
