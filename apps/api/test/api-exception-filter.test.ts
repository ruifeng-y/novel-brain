import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiExceptionFilter } from "../src/common/api-exception.filter";
import { ApiError } from "../src/common/api-error";

function createHost() {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  };
  return { host, response };
}

describe("API exception filter sensitive payload boundary", () => {
  it("redacts key, prompt and manuscript fields independently from operational details", () => {
    const { host, response } = createHost();
    const filter = new ApiExceptionFilter({ error: vi.fn() } as never, []);

    filter.catch(
      new ApiError(409, "QUALITY_GATE_BLOCKED", "当前状态不允许提交", {
        code: "QUALITY_GATE_BLOCKED",
        status: "blocked",
        apiKey: "sk-api-independent-133",
        prompt: "PROMPT_INDEPENDENT_133",
        manuscript: "沈砚把断臂藏进衣袍。",
        message: "MESSAGE_CANARY_133",
        unknownNumber: 42,
        unknownBoolean: true,
        unknownNull: null,
      }),
      host as never,
    );

    const body = response.json.mock.calls[0]?.[0];
    expect(body.error.details).toMatchObject({
      code: "QUALITY_GATE_BLOCKED",
      status: "blocked",
      apiKey: "[REDACTED]",
      prompt: "[REDACTED]",
      manuscript: "[REDACTED]",
      message: "[REDACTED]",
    });
    expect(body.error.details).not.toHaveProperty("unknownNumber");
    expect(body.error.details).not.toHaveProperty("unknownBoolean");
    expect(body.error.details).not.toHaveProperty("unknownNull");
    expect(body.error.message).toBe("当前状态不允许提交");
  });

  it("redacts secrets, prompts and manuscript text from API error details", () => {
    const { host, response } = createHost();
    const logger = { error: vi.fn() };
    const promptCanary = "PROMPT_RESPONSE_CANARY_133";
    const filter = new ApiExceptionFilter(logger as never, [promptCanary]);
    const apiKey = "sk-api-response-canary-133";
    const manuscript = "沈砚把断臂藏进衣袍。";
    const prompt = promptCanary;

    filter.catch(
      new ApiError(400, "VALIDATION_INVALID", `Invalid key ${apiKey}`, {
        apiKey,
        manuscript,
        prompt,
        status: promptCanary,
      }),
      host as never,
    );

    const body = JSON.stringify(response.json.mock.calls[0]?.[0]);
    expect(body).not.toContain(apiKey);
    expect(body).not.toContain(manuscript);
    expect(body).not.toContain(prompt);
  });

  it("drops sensitive validation path segments", () => {
    const { host, response } = createHost();
    const canary = "PROMPT_PATH_CANARY_133";
    const filter = new ApiExceptionFilter({ error: vi.fn() } as never, [canary]);
    const error = new z.ZodError([
      {
        code: "custom",
        path: [
          canary,
          "sk_live_1234567890abcdef",
          "AKIAIOSFODNN7EXAMPLE",
          "AIzaSyDUMMY_PROVIDER_KEY_133",
        ],
        message: "Invalid field",
      },
    ]);

    filter.catch(error, host as never);

    const body = JSON.stringify(response.json.mock.calls[0]?.[0]);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(body).not.toContain(canary);
    expect(response.json.mock.calls[0]?.[0].error.details.issues[0].path).toEqual([]);
  });

  it("logs unhandled errors through the redacting logger without payload text", () => {
    const { host, response } = createHost();
    const logger = { error: vi.fn() };
    const filter = new ApiExceptionFilter(logger as never);

    filter.catch(new Error("UNHANDLED_ERROR_CANARY_133"), host as never);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(response.json.mock.calls[0]?.[0])).not.toContain(
      "UNHANDLED_ERROR_CANARY_133",
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("UNHANDLED_ERROR_CANARY_133");
  });
});
