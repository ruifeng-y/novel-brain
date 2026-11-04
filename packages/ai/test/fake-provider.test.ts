import { afterEach, describe, expect, it, vi } from "vitest";

import { FakeAiProvider } from "../src";

describe("FakeAiProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns deterministic output without making a network call", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network access is forbidden in fake mode");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new FakeAiProvider();

    const first = await provider.generateText({ prompt: "第一章", model: "fake-model" });
    const second = await provider.generateText({ prompt: "第一章", model: "fake-model" });

    expect(first).toEqual(second);
    expect(first.model).toBe("fake-model");
    expect(first.text).toMatch(/^fake:[0-9a-f]{8}:第一章$/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("streams the same deterministic content in chunks", async () => {
    const provider = new FakeAiProvider();
    const chunks: string[] = [];

    for await (const chunk of provider.streamText({ prompt: "测试" })) {
      chunks.push(chunk.text);
    }

    expect(chunks.join("")).toBe((await provider.generateText({ prompt: "测试" })).text);
  });
});
