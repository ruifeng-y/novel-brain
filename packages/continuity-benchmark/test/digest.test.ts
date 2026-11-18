import { describe, expect, it } from "vitest";

import { sha256CanonicalJson } from "../src/digest";

describe("canonical JSON digest", () => {
  it("is stable across object key order and database jsonb normalization", () => {
    expect(sha256CanonicalJson({ z: 1, nested: { b: 2, a: 3 } })).toBe(
      sha256CanonicalJson({ nested: { a: 3, b: 2 }, z: 1 }),
    );
  });
});
