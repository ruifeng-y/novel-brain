import { describe, expect, it } from "vitest";

import {
  agentFailureClassSchema,
  agentRunTraceSchema,
  costReservationSchema,
  modelCallSchema,
  promptVersionSchema,
} from "../src";

const WORK_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e02";
const BRANCH_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e03";
const CHAPTER_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e04";
const JOB_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e05";
const RUN_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e06";
const PROMPT_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e07";
const MODEL_CALL_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e08";
const RESERVATION_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e09";
const MODEL_CONFIG_ID = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1e0a";
const HASH = "a".repeat(64);

const promptVersion = {
  id: PROMPT_ID,
  jobId: JOB_ID,
  stepKey: "draft",
  key: "generation.draft",
  version: 1,
  role: "writer",
  promptHash: HASH,
  systemHash: HASH,
  inputHash: HASH,
  contextPackId: null,
  compilerVersion: "m0-context-v1",
  createdAt: "2026-11-06T10:00:00.000Z",
};

const modelCall = {
  id: MODEL_CALL_ID,
  agentRunId: RUN_ID,
  promptVersionId: PROMPT_ID,
  costReservationId: RESERVATION_ID,
  stepKey: "draft",
  attempt: 1,
  status: "succeeded",
  provider: "deepseek",
  model: "deepseek-chat",
  parameters: { operation: "draft", maxTokens: 2000, stream: false },
  configHash: HASH,
  inputHash: HASH,
  outputHash: HASH,
  inputTokens: 1200,
  outputTokens: 800,
  costCny: 0.004,
  failureClass: null,
  errorCode: null,
  escalationReason: null,
  providerRequestId: "provider-response-1",
  startedAt: "2026-11-06T10:00:00.000Z",
  finishedAt: "2026-11-06T10:00:02.000Z",
};

const costReservation = {
  id: RESERVATION_ID,
  status: "settled",
  reservedTokens: 2200,
  reservedCostCny: 0.0044,
  settledTokens: 2000,
  settledCostCny: 0.004,
  failureClass: null,
  createdAt: "2026-11-06T10:00:00.000Z",
  settledAt: "2026-11-06T10:00:02.000Z",
};

const trace = {
  run: {
    id: RUN_ID,
    jobId: JOB_ID,
    workId: WORK_ID,
    branchId: BRANCH_ID,
    chapterId: CHAPTER_ID,
    stepKey: "draft",
    role: "writer",
    status: "succeeded",
    failureClass: null,
    escalationReason: null,
    inputHash: HASH,
    outputHash: HASH,
    inputTokens: 1200,
    outputTokens: 800,
    costCny: 0.004,
    startedAt: "2026-11-06T10:00:00.000Z",
    finishedAt: "2026-11-06T10:00:02.000Z",
  },
  replay: {
    modelConfigId: MODEL_CONFIG_ID,
    provider: "deepseek",
    model: "deepseek-chat",
    parameters: { operation: "draft", maxTokens: 2000, stream: false },
    configHash: HASH,
    promptVersion: {
      id: PROMPT_ID,
      key: "generation.draft",
      version: 1,
      promptHash: HASH,
      systemHash: HASH,
      inputHash: HASH,
    },
  },
  promptVersions: [promptVersion],
  modelCalls: [modelCall],
  toolCalls: [],
  costReservations: [costReservation],
};

describe("agent trace contracts", () => {
  it("distinguishes provider, timeout, rate-limit, schema, policy and budget failures", () => {
    for (const failureClass of [
      "provider",
      "timeout",
      "rate_limit",
      "schema",
      "policy",
      "budget",
      "cancelled",
      "unknown",
    ]) {
      expect(agentFailureClassSchema.parse(failureClass)).toBe(failureClass);
    }
    expect(() => agentFailureClassSchema.parse("network")).toThrow();
  });

  it("validates prompt and model provenance without raw prompt or output fields", () => {
    expect(promptVersionSchema.parse(promptVersion)).toEqual(promptVersion);
    expect(modelCallSchema.parse(modelCall)).toEqual(modelCall);
    expect(costReservationSchema.parse(costReservation)).toEqual(costReservation);

    expect(() => promptVersionSchema.parse({ ...promptVersion, prompt: "完整提示词" })).toThrow();
    expect(() => modelCallSchema.parse({ ...modelCall, output: "完整正文" })).toThrow();
    expect(() => modelCallSchema.parse({ ...modelCall, apiKey: "sk-secret" })).toThrow();
  });

  it("exposes replay metadata and strips raw manuscript, prompt and credentials", () => {
    expect(agentRunTraceSchema.parse(trace)).toEqual(trace);
    expect(() =>
      agentRunTraceSchema.parse({
        ...trace,
        run: { ...trace.run, output: "完整正文" },
      }),
    ).toThrow();
    expect(() =>
      agentRunTraceSchema.parse({
        ...trace,
        replay: { ...trace.replay, prompt: "完整提示词" },
      }),
    ).toThrow();
    expect(() =>
      agentRunTraceSchema.parse({
        ...trace,
        modelCalls: [{ ...modelCall, apiKey: "sk-secret" }],
      }),
    ).toThrow();
  });

  it("rejects inconsistent failure evidence and settlement state", () => {
    expect(() =>
      modelCallSchema.parse({
        ...modelCall,
        status: "failed",
        failureClass: null,
      }),
    ).toThrow();
    expect(() =>
      costReservationSchema.parse({
        ...costReservation,
        status: "reserved",
        settledTokens: 100,
      }),
    ).toThrow();
  });
});
