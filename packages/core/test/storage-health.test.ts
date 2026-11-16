import { afterEach, describe, expect, it, vi } from "vitest";

import { checkStorageHealth } from "../src/storage-health";

describe("storage health", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("checks storage without following redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkStorageHealth("http://minio:9000/minio/health/live"),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://minio:9000/minio/health/live",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("fails when storage is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(checkStorageHealth("http://minio:9000/minio/health/live")).rejects.toThrow(
      "Object storage health check failed with HTTP 503",
    );
  });
});
