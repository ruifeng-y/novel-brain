import { afterEach, describe, expect, it, vi } from "vitest";

import { SafePinoLogger } from "../src/logging/safe-logger";

describe("worker safe logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("proves key, manuscript and prompt canaries stay out of ordinary worker logs", () => {
    const writes: string[] = [];
    process.env.LOG_CANARY_VALUES = JSON.stringify(["WORKER_CANARY_133"]);
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      new SafePinoLogger().info({
        event: "worker.model_call.started",
        apiKey: "sk-worker-secret-133",
        manuscript: "沈砚把断臂藏进衣袍。",
        prompt: "PROMPT_WORKER_CANARY_133",
        status: "WORKER_CANARY_133",
      });
    } finally {
      delete process.env.LOG_CANARY_VALUES;
    }

    const output = writes.join("");
    expect(output).toContain("logging.redaction_failed");
    expect(output).not.toContain("sk-worker-secret-133");
    expect(output).not.toContain("沈砚");
    expect(output).not.toContain("PROMPT_WORKER_CANARY_133");
    expect(output).not.toContain("WORKER_CANARY_133");
  });

  it("redacts key, manuscript and prompt fields independently", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    new SafePinoLogger().info({
      event: "worker.model_call.started",
      jobId: "01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
      apiKey: "sk-worker-secret-133",
      manuscript: "沈砚把断臂藏进衣袍。",
      prompt: "PROMPT_WORKER_CANARY_133",
      unknownField: "UNKNOWN_FIELD_CANARY_133",
      headers: { "x-api-key": "custom-provider-credential" },
    });

    const output = writes.join("");
    expect(output).toContain("worker.model_call.started");
    expect(output).not.toContain("sk-worker-secret-133");
    expect(output).not.toContain("沈砚");
    expect(output).not.toContain("PROMPT_WORKER_CANARY_133");
    expect(output).not.toContain("UNKNOWN_FIELD_CANARY_133");
    expect(output).not.toContain("custom-provider-credential");
  });

  it("emits only sanitized low-cardinality metric labels", () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });

    new SafePinoLogger().metric("worker.job.started", {
      job_type: "generate_chapter",
      queue: "novelbrain",
      request_id: "req_dynamic_133",
      route: "/api/v1/works/01a1d573-7f8c-7c9e-9f27-2a98f91bbaa1",
      model: "author-private-model",
    });

    const output = writes.join("");
    expect(output).toContain("telemetry.metric");
    expect(output).toContain("generate_chapter");
    expect(output).not.toContain("req_dynamic_133");
    expect(output).not.toContain("01a1d573-7f8c");
    expect(output).not.toContain("author-private-model");
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
