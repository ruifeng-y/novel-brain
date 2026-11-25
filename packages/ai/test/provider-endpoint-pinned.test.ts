import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
}));

vi.mock("node:https", () => ({
  request: mocks.request,
}));

import { requestPinnedHttps } from "../src/provider-endpoint";

describe("pinned HTTPS request", () => {
  beforeEach(() => {
    mocks.request.mockReset();
  });

  it("returns the pinned address as an array when Node requests all addresses", async () => {
    let lookupResult:
      | {
          error: Error | null;
          addresses: unknown;
          family: number | undefined;
        }
      | undefined;

    mocks.request.mockImplementation(
      (
        _target: URL,
        options: {
          lookup: (
            hostname: string,
            options: { all: boolean },
            callback: (error: Error | null, addresses: unknown, family?: number) => void,
          ) => void;
        },
        onResponse: (response: PassThrough & { statusCode: number }) => void,
      ) => {
        options.lookup("api.deepseek.com", { all: true }, (error, addresses, family) => {
          lookupResult = { error, addresses, family };
        });

        const response = new PassThrough() as PassThrough & { statusCode: number };
        response.statusCode = 200;
        onResponse(response);
        response.end("ok");

        return Object.assign(new EventEmitter(), {
          setTimeout: vi.fn(),
          end: vi.fn(),
        });
      },
    );

    const result = await requestPinnedHttps({
      target: new URL("https://api.deepseek.com/models"),
      address: "8.8.8.8",
      timeoutMs: 1_000,
    });

    expect(result.status).toBe(200);
    expect(lookupResult).toEqual({
      error: null,
      addresses: [{ address: "8.8.8.8", family: 4 }],
      family: undefined,
    });
  });
});
