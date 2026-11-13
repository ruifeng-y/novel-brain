import { describe, expect, it, vi } from "vitest";

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
