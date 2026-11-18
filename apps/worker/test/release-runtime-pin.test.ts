import { describe, expect, it } from "vitest";

import {
  assertReleaseRuntimePinMatchesModelConfig,
  releaseRuntimePinForSubject,
} from "@novel-brain/ai";

const EVIDENCE = {
  action: "rollback",
  releaseVersion: "2026-11-18.1",
  cohort: {
    id: "internal-reviewers",
    subjectIds: ["user-a", "user-b"],
    sha256: "1".repeat(64),
  },
  pin: {
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    promptVersion: "m1-writing-prompts-v1",
    promptHash: "4e0ad7d7ce883b32a83be12ea7d7593bfeeafc4374e88c22404ed056f70af1cd",
    smokePromptHash: "2".repeat(64),
    contextCompilerVersion: "m1-context-v1",
    agentContractVersion: "agent-m3-06b-v1",
    configHash: "3".repeat(64),
  },
  limits: {
    maxCostCny: 0.01,
    maxLatencyMs: 10_000,
    maxAttempts: 2,
    timeoutMs: 15_000,
  },
};

describe("worker release pin resolution", () => {
  it("applies the active pin only to explicit internal cohort subjects", () => {
    expect(releaseRuntimePinForSubject(EVIDENCE, "user-a")).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      promptVersion: "m1-writing-prompts-v1",
      configHash: "3".repeat(64),
      maxAttempts: 2,
      timeoutMs: 15_000,
    });
    expect(releaseRuntimePinForSubject(EVIDENCE, "user-c")).toBeUndefined();
  });

  it("rejects malformed or non-release evidence", () => {
    expect(
      releaseRuntimePinForSubject({ ...EVIDENCE, action: "something-else" }, "user-a"),
    ).toBeUndefined();
    expect(() =>
      releaseRuntimePinForSubject(
        {
          ...EVIDENCE,
          pin: { ...EVIDENCE.pin, configHash: "not-a-hash" },
        },
        "user-a",
      ),
    ).toThrow("RELEASE_PIN_INVALID");
    expect(
      releaseRuntimePinForSubject(
        {
          ...EVIDENCE,
          pin: { ...EVIDENCE.pin, configHash: "not-a-hash" },
        },
        "user-c",
      ),
    ).toBeUndefined();
  });

  it("fails closed before a release pin can send a third-party key to DeepSeek", () => {
    const pin = releaseRuntimePinForSubject(EVIDENCE, "user-a");
    expect(() =>
      assertReleaseRuntimePinMatchesModelConfig(pin, {
        provider: "openai-compatible",
        baseUrl: "https://models.example.com/v1",
      }),
    ).toThrow("RELEASE_PIN_KEY_MISMATCH");
    expect(() =>
      assertReleaseRuntimePinMatchesModelConfig(pin, {
        provider: "deepseek",
        baseUrl: "https://api.deepseek.com",
      }),
    ).not.toThrow();
  });
});
