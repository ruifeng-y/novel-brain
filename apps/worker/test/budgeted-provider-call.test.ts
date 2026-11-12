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

describe("budgeted provider call", () => {
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
  });
});
