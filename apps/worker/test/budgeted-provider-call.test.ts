import { describe, expect, it, vi } from "vitest";

import type { AiGateway, GenerationResult } from "@novel-brain/ai";
import { BudgetReservationError } from "@novel-brain/db";

import {
  BudgetedProviderCallExecutor,
  CostBudgetOverrunRecordedError,
  ProviderBudgetExceededError,
} from "../src/generation/budgeted-provider-call";
import type {
  StartedModelCall,
  WorkerGenerationRepository,
  WorkerJobBase,
} from "../src/generation/generation.repository";

const PAYLOAD: WorkerJobBase = {
  jobId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4001",
  workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4002",
  branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4003",
  chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4004",
  actorId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4005",
  modelConfigId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4006",
  idempotencyKey: "budget-call-test",
};

const STARTED_CALL: StartedModelCall = {
  runId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4007",
  promptVersionId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4008",
  modelCallId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4009",
  reservationId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2b4010",
  reservationKey: "generation:draft:attempt:1",
  attempt: 1,
};

const RESULT: GenerationResult = {
  text: "沈砚收剑。",
  model: "fake",
  finishReason: "stop",
  usage: { inputTokens: 20, outputTokens: 30 },
};

const RELEASE_PIN = {
  releaseVersion: "2026-11-18.1",
  provider: "deepseek" as const,
  model: "deepseek-chat",
  promptVersion: "m1-writing-prompts-v1",
  promptHash: "4e0ad7d7ce883b32a83be12ea7d7593bfeeafc4374e88c22404ed056f70af1cd",
  smokePromptHash: "d".repeat(64),
  baseUrl: "https://api.deepseek.com",
  contextCompilerVersion: "m1-context-v1",
  agentContractVersion: "agent-m3-06b-v1",
  configHash: "a".repeat(64),
  maxCostCny: 1,
  maxLatencyMs: 10_000,
  maxAttempts: 2,
  timeoutMs: 15_000,
};

describe("budgeted provider call", () => {
  it("records the active release pin with the model call parameters", async () => {
    const beginModelCall = vi.fn(async () => STARTED_CALL);
    const repository = {
      beginModelCall,
      completeModelCall: vi.fn(async () => false),
      failModelCall: vi.fn(async () => undefined),
    } as unknown as WorkerGenerationRepository;
    const provider: AiGateway = {
      async generateText() {
        return RESULT;
      },
      async *streamText() {
        yield { text: "", done: true };
      },
    };
    await new BudgetedProviderCallExecutor(repository).call({
      payload: PAYLOAD,
      provider,
      step: "draft",
      attempt: 1,
      role: "writer",
      operation: "draft",
      prompt: "写一段正文",
      system: "只输出正文",
      citations: [],
      parameters: { operation: "draft" },
      releasePin: RELEASE_PIN,
    });

    expect(beginModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        parameters: expect.objectContaining({ releasePin: RELEASE_PIN }),
      }),
    );
  });

  it("stops before the provider when reservation is rejected", async () => {
    const recordBudgetFailure = vi.fn(async () => undefined);
    const generateText = vi.fn(async () => RESULT);
    const repository = {
      beginModelCall: vi.fn(async () => {
        throw new BudgetReservationError({
          maxCostCny: 1,
          maxTokens: 10_000,
          usedCostCny: 0.9,
          usedTokens: 9_000,
          reservedCostCny: 0,
          reservedTokens: 0,
          requestedCostCny: 0.2,
          requestedTokens: 2_000,
          bindingScope: "volume",
        });
      }),
      recordBudgetFailure,
    } as unknown as WorkerGenerationRepository;
    const provider: AiGateway = {
      generateText,
      async *streamText() {
        yield { text: "", done: true };
      },
    };
    const traceLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    await expect(
      new BudgetedProviderCallExecutor(repository).call({
        payload: PAYLOAD,
        provider,
        step: "draft",
        attempt: 1,
        role: "writer",
        operation: "draft",
        prompt: "写一段正文",
        system: "只输出正文",
        citations: [],
        parameters: { operation: "draft" },
        releasePin: RELEASE_PIN,
        traceLogger,
      }),
    ).rejects.toBeInstanceOf(ProviderBudgetExceededError);

    expect(generateText).not.toHaveBeenCalled();
    expect(recordBudgetFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: PAYLOAD,
        step: "draft",
        attempt: 1,
        errorCode: "JOB_BUDGET_EXCEEDED",
        bindingScope: "volume",
        releasePin: RELEASE_PIN,
      }),
    );
  });

  it("stops before the provider when the active release budget is lower than the call estimate", async () => {
    const recordBudgetFailure = vi.fn(async () => undefined);
    const generateText = vi.fn(async () => RESULT);
    const repository = {
      recordBudgetFailure,
    } as unknown as WorkerGenerationRepository;
    const provider: AiGateway = {
      generateText,
      async *streamText() {
        yield { text: "", done: true };
      },
    };

    await expect(
      new BudgetedProviderCallExecutor(repository).call({
        payload: PAYLOAD,
        provider,
        step: "draft",
        attempt: 1,
        role: "writer",
        operation: "draft",
        prompt: "写一段正文",
        system: "只输出正文",
        citations: [],
        parameters: { operation: "draft" },
        releasePin: { ...RELEASE_PIN, maxCostCny: 0 },
      }),
    ).rejects.toBeInstanceOf(ProviderBudgetExceededError);

    expect(generateText).not.toHaveBeenCalled();
    expect(recordBudgetFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "RELEASE_BUDGET_EXCEEDED",
        releasePin: expect.objectContaining({ maxCostCny: 0 }),
      }),
    );
  });

  it("reports recorded actual overrun without entering provider failure handling", async () => {
    const completeModelCall = vi.fn(async () => true);
    const failModelCall = vi.fn(async () => undefined);
    const repository = {
      beginModelCall: vi.fn(async () => STARTED_CALL),
      completeModelCall,
      failModelCall,
    } as unknown as WorkerGenerationRepository;
    const provider: AiGateway = {
      async generateText() {
        return RESULT;
      },
      async *streamText() {
        yield { text: "", done: true };
      },
    };
    const traceLogger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    await expect(
      new BudgetedProviderCallExecutor(repository).call({
        payload: PAYLOAD,
        provider,
        step: "draft",
        attempt: 1,
        role: "writer",
        operation: "draft",
        prompt: "写一段正文",
        system: "只输出正文",
        citations: [],
        parameters: { operation: "draft" },
        traceLogger,
      }),
    ).rejects.toBeInstanceOf(CostBudgetOverrunRecordedError);

    expect(completeModelCall).toHaveBeenCalledTimes(1);
    expect(completeModelCall).toHaveBeenCalledWith({
      payload: PAYLOAD,
      step: "draft",
      call: STARTED_CALL,
      result: RESULT,
    });
    expect(failModelCall).not.toHaveBeenCalled();
    expect(traceLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "worker.model_call.budget_overrun",
        inputTokens: RESULT.usage.inputTokens,
        outputTokens: RESULT.usage.outputTokens,
        costCny: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
    );
  });
});
