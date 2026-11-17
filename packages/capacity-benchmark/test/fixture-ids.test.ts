import { describe, expect, it } from "vitest";

import { createBenchmarkFixtureIds, deterministicUuid } from "../src/fixture-ids";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("deterministic fixture identifiers", () => {
  it("generates valid deterministic UUID v7 values for every API-visible id", () => {
    const ids = createBenchmarkFixtureIds(20261117, 3);
    const generated = [
      ids.userId,
      ids.penNameId,
      ids.modelConfigId,
      ids.sessionId,
      ids.workId,
      ids.mainBranchId,
      ...ids.branchIds,
      ...Array.from({ length: 1_000 }, (_, index) =>
        deterministicUuid(20261117, `entity:${index + 1}`),
      ),
    ];

    expect(new Set(generated).size).toBe(generated.length);
    for (const id of generated) {
      expect(id).toMatch(UUID_V7);
    }
    expect(deterministicUuid(20261117, "chapter:42")).toBe(
      deterministicUuid(20261117, "chapter:42"),
    );
  });
});
