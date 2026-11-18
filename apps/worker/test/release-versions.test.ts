import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONTEXT_COMPILER_VERSION,
  DEFAULT_WRITING_PROMPT_VERSION,
  WRITING_PROMPT_BUNDLE_HASHES,
  resolveWritingRelease,
} from "../src/generation/release-versions";

describe("writing release version selection", () => {
  it("uses the legacy bundle by default and the strict bundle for a v1 pin", () => {
    const fallback = resolveWritingRelease();
    const canary = resolveWritingRelease({
      promptVersion: "m1-writing-prompts-v1",
      promptHash: WRITING_PROMPT_BUNDLE_HASHES["m1-writing-prompts-v1"],
      contextCompilerVersion: "m1-context-v1",
    });

    expect(fallback.promptVersion).toBe(DEFAULT_WRITING_PROMPT_VERSION);
    expect(fallback.contextCompilerVersion).toBe(DEFAULT_CONTEXT_COMPILER_VERSION);
    expect(canary.templates.draft.system).not.toBe(fallback.templates.draft.system);
    expect(canary.promptHash).toBe(WRITING_PROMPT_BUNDLE_HASHES["m1-writing-prompts-v1"]);
  });

  it("rejects a pin whose prompt hash does not match its selected version", () => {
    expect(() =>
      resolveWritingRelease({
        promptVersion: "m1-writing-prompts-v1",
        promptHash: WRITING_PROMPT_BUNDLE_HASHES["m1-writing-prompts-v0"],
        contextCompilerVersion: "m1-context-v1",
      }),
    ).toThrow("RELEASE_PROMPT_HASH_MISMATCH");
  });
});
