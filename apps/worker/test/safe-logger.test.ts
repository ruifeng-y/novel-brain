import { afterEach, describe, expect, it, vi } from "vitest";

import { SafePinoLogger } from "../src/logging/safe-logger";

describe("worker safe logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proves key, manuscript and prompt canaries stay out of ordinary worker logs", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    new SafePinoLogger({ canaryValues: ["WORKER_CANARY_133"] }).info({
      event: "worker.model_call.started",
      apiKey: "sk-worker-secret-133",
      manuscript: "沈砚把断臂藏进衣袍。",
      prompt: "PROMPT_WORKER_CANARY_133",
      unknownField: "WORKER_CANARY_133",
    });

    const output = writes.join("");
    expect(output).toContain("logging.redaction_failed");
    expect(output).not.toContain("sk-worker-secret-133");
    expect(output).not.toContain("沈砚");
    expect(output).not.toContain("PROMPT_WORKER_CANARY_133");
    expect(output).not.toContain("WORKER_CANARY_133");
  });

  it("keeps safe identifiers and low-cardinality operational fields", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    new SafePinoLogger().info({
      event: "worker.job.started",
      jobId: "01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
      jobType: "generate_chapter",
    });

    const output = writes.join("");
    expect(output).toContain("worker.job.started");
    expect(output).toContain("01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1");
  });
});
