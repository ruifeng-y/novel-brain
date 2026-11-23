import { describe, expect, it } from "vitest";

import { safeChunkLength } from "../lib/manuscript-chunking";

describe("manuscript chunking", () => {
  it("keeps a UTF-16 surrogate pair in the same upload chunk", () => {
    const requested = 250_000;
    const text = `${"a".repeat(requested - 1)}😀${"b".repeat(10)}`;

    expect(safeChunkLength(text, requested)).toBe(requested - 1);
  });

  it("keeps ordinary boundaries unchanged", () => {
    expect(safeChunkLength("abcdef", 3)).toBe(3);
  });
});
