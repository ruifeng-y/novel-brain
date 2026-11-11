import { createHash } from "node:crypto";

import {
  AiProviderError,
  M0_COST_PER_TOKEN_CNY,
  classifyAiFailure,
  type AiGateway,
  type GenerationOperation,
  type GenerationResult,
} from "@novel-brain/ai";
import { planProviderCallBudget, PROVIDER_CALL_MAX_OUTPUT_TOKENS } from "@novel-brain/core";
import { BudgetReservationError, calculateModelCallCost as calculateCost } from "@novel-brain/db";

import {
  type StartedModelCall,
  type WorkerGenerationRepository,
  type WorkerJobBase,
} from "./generation.repository";
import {
  BUDGET_EXHAUSTED_ESCALATION,
  BUDGET_EXHAUSTED_MESSAGE,
  CostBudgetOverrunRecordedError,
  JobStoppedError,
  ProviderBudgetExceededError,
} from "./provider-call-errors";

export {
  BUDGET_EXHAUSTED_ESCALATION,
  BUDGET_EXHAUSTED_MESSAGE,
  CostBudgetOverrunRecordedError,
  ProviderBudgetExceededError,
} from "./provider-call-errors";

export interface ProviderCallTraceLogger {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
}

export interface BudgetedProviderCallInput {
  payload: WorkerJobBase;
  provider: AiGateway;
  step: string;
  attempt: number;
  role: "writer" | "critic" | "reviser";
  promptKey?: string;
  promptVersion?: number;
  operation: GenerationOperation;
  prompt: string;
  system: string;
  citations: unknown[];
  parameters: Record<string, unknown>;
  traceLogger?: ProviderCallTraceLogger;
}

export class BudgetedProviderCallExecutor {
  constructor(private readonly repository: WorkerGenerationRepository) {}

  async call(input: BudgetedProviderCallInput): Promise<GenerationResult> {
    const providerBudget = planProviderCallBudget({
      system: input.system,
      prompt: input.prompt,
      maxOutputTokens: PROVIDER_CALL_MAX_OUTPUT_TOKENS,
    });
    const estimatedTokens = providerBudget.reservedTokens;
    const estimatedCostCny = calculateCost(estimatedTokens, M0_COST_PER_TOKEN_CNY);
    const parameters = {
      ...input.parameters,
      maxTokens: providerBudget.maxOutputTokens,
      stream: false,
    };
    let call: StartedModelCall;
    try {
      call = await this.repository.beginModelCall({
        payload: input.payload,
        step: input.step,
        attempt: input.attempt,
        role: input.role,
        ...(input.promptKey ? { promptKey: input.promptKey } : {}),
        prompt: input.prompt,
        system: input.system,
        citations: input.citations,
        estimatedTokens,
        estimatedCostCny,
        parameters,
      });
    } catch (error) {
      if (error instanceof JobStoppedError) {
        throw error;
      }
      if (error instanceof BudgetReservationError) {
        await this.repository.recordBudgetFailure({
          payload: input.payload,
          step: input.step,
          attempt: input.attempt,
          role: input.role,
          prompt: input.prompt,
          system: input.system,
          estimatedTokens,
          estimatedCostCny,
          errorCode: "JOB_BUDGET_EXCEEDED",
          message: BUDGET_EXHAUSTED_MESSAGE,
          escalationReason: BUDGET_EXHAUSTED_ESCALATION,
          ...(error.details.bindingScope ? { bindingScope: error.details.bindingScope } : {}),
        });
        throw new ProviderBudgetExceededError();
      }
      throw error;
    }

    const startedAt = Date.now();
    input.traceLogger?.info({
      event: "worker.model_call.started",
      jobId: input.payload.jobId,
      runId: call.runId,
      modelCallId: call.modelCallId,
      reservationId: call.reservationId,
      step: input.step,
      inputHash: sha256(input.system + input.prompt).slice(0, 12),
    });

    let result: GenerationResult;
    try {
      result = await input.provider.generateText({
        prompt: input.prompt,
        system: input.system,
        maxTokens: providerBudget.maxOutputTokens,
        operation: input.operation,
      });
    } catch (error) {
      const failure = describeProviderFailure(error);
      await this.repository.failModelCall({
        payload: input.payload,
        step: input.step,
        call,
        failureClass: failure.failureClass,
        errorCode: failure.code,
        message: failure.message,
        escalationReason: failure.escalationReason,
      });
      input.traceLogger?.warn({
        event: "worker.model_call.failed",
        jobId: input.payload.jobId,
        runId: call.runId,
        modelCallId: call.modelCallId,
        step: input.step,
        failureClass: failure.failureClass,
        errorCode: failure.code,
        latencyMs: Date.now() - startedAt,
      });
      throw error;
    }

    const budgetOverrun = await this.repository.completeModelCall({
      payload: input.payload,
      step: input.step,
      call,
      result,
    });
    if (budgetOverrun) {
      input.traceLogger?.warn({
        event: "worker.model_call.budget_overrun",
        jobId: input.payload.jobId,
        runId: call.runId,
        modelCallId: call.modelCallId,
        reservationId: call.reservationId,
        step: input.step,
        actualTokens: result.usage.inputTokens + result.usage.outputTokens,
        failureClass: "budget",
      });
      throw new CostBudgetOverrunRecordedError();
    }

    input.traceLogger?.info({
      event: "worker.model_call.succeeded",
      jobId: input.payload.jobId,
      runId: call.runId,
      modelCallId: call.modelCallId,
      step: input.step,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costCny: calculateCost(
        result.usage.inputTokens + result.usage.outputTokens,
        M0_COST_PER_TOKEN_CNY,
      ),
      latencyMs: Date.now() - startedAt,
    });
    return result;
  }
}

export function describeProviderFailure(error: unknown): {
  failureClass:
    | "provider"
    | "timeout"
    | "rate_limit"
    | "schema"
    | "policy"
    | "budget"
    | "cancelled"
    | "unknown";
  code: string;
  message: string;
  escalationReason: string;
} {
  const failureClass = error instanceof AiProviderError ? classifyAiFailure(error) : "provider";
  const mapping = {
    timeout: {
      code: "MODEL_TIMEOUT",
      message: "模型服务响应超时，草稿和检查点已保留",
      escalationReason: "模型响应超时，可稍后从断点重试",
    },
    rate_limit: {
      code: "MODEL_RATE_LIMITED",
      message: "模型服务繁忙，草稿和检查点已保留",
      escalationReason: "模型服务限流，请稍后从断点重试",
    },
    policy: {
      code: "MODEL_POLICY_BLOCKED",
      message: "模型拒绝了本次请求，草稿和检查点已保留",
      escalationReason: "模型拒绝请求，请检查正文模型配置或稍后重试",
    },
    schema: {
      code: "MODEL_RESPONSE_INVALID",
      message: "模型返回内容无法识别，草稿和检查点已保留",
      escalationReason: "模型返回格式异常，请从断点重试",
    },
    budget: {
      code: "JOB_BUDGET_EXCEEDED",
      message: BUDGET_EXHAUSTED_MESSAGE,
      escalationReason: BUDGET_EXHAUSTED_ESCALATION,
    },
    cancelled: {
      code: "JOB_CANCELLED",
      message: "任务已取消，草稿和检查点已保留",
      escalationReason: "任务已取消",
    },
    provider: {
      code: "MODEL_PROVIDER_ERROR",
      message: "模型服务暂时不可用，草稿和检查点已保留",
      escalationReason: "模型服务异常，请稍后从断点重试",
    },
    unknown: {
      code: "MODEL_PROVIDER_ERROR",
      message: "模型服务暂时不可用，草稿和检查点已保留",
      escalationReason: "模型调用异常，请稍后从断点重试",
    },
  } as const;
  return { failureClass, ...mapping[failureClass] };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
