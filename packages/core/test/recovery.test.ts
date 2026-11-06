import { WORKER_JOB_STEPS } from "@novel-brain/contracts";
import { describe, expect, it } from "vitest";

import { decideStepRecovery, resolveRecoveryStep } from "../src";

describe("recovery policy", () => {
  it("resumes from the first non-succeeded step and never replays committed steps", () => {
    expect(
      resolveRecoveryStep(WORKER_JOB_STEPS, [
        { stepKey: "prepare", status: "succeeded" },
        { stepKey: "compile_context", status: "succeeded" },
        { stepKey: "draft", status: "failed" },
      ]),
    ).toEqual({
      step: "draft",
      completedSteps: ["prepare", "compile_context"],
      reason: "failed_step",
    });

    expect(
      resolveRecoveryStep(WORKER_JOB_STEPS, [
        { stepKey: "prepare", status: "succeeded" },
        { stepKey: "compile_context", status: "succeeded" },
        { stepKey: "draft", status: "succeeded" },
        { stepKey: "verify", status: "running" },
      ]),
    ).toEqual({
      step: "verify",
      completedSteps: ["prepare", "compile_context", "draft"],
      reason: "restart_inflight",
    });

    expect(
      resolveRecoveryStep(WORKER_JOB_STEPS, [
        { stepKey: "prepare", status: "succeeded" },
        { stepKey: "compile_context", status: "succeeded" },
        { stepKey: "draft", status: "succeeded" },
        { stepKey: "verify", status: "succeeded" },
        { stepKey: "revise", status: "succeeded" },
        { stepKey: "extract_facts", status: "succeeded" },
        { stepKey: "await_review", status: "succeeded" },
      ]),
    ).toEqual({
      step: "await_review",
      completedSteps: [...WORKER_JOB_STEPS],
      reason: "all_succeeded",
    });
  });

  it("applies bounded exponential backoff and explicit terminal policies", () => {
    expect(
      decideStepRecovery({
        failureClass: "rate_limit",
        attempt: 1,
        maxAutomaticAttempts: 3,
      }),
    ).toEqual({ action: "automatic_retry", delayMs: 1_000, terminal: false });
    expect(
      decideStepRecovery({
        failureClass: "timeout",
        attempt: 3,
        maxAutomaticAttempts: 3,
      }),
    ).toEqual({ action: "manual_recovery", delayMs: null, terminal: true });
    expect(
      decideStepRecovery({
        failureClass: "provider",
        attempt: 2,
        maxAutomaticAttempts: 3,
      }),
    ).toEqual({ action: "automatic_retry", delayMs: 2_000, terminal: false });

    for (const failureClass of ["budget", "policy", "schema", "cancelled", "unknown"] as const) {
      expect(
        decideStepRecovery({
          failureClass,
          attempt: 1,
          maxAutomaticAttempts: 3,
        }),
      ).toEqual({ action: "manual_recovery", delayMs: null, terminal: true });
    }
  });
});
