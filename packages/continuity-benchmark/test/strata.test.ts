import { describe, expect, it } from "vitest";

import { reviewStrata, volumeNumberForChapter, volumePositionFor } from "../src/strata";

describe("continuity review strata", () => {
  it("classifies complete volumes into the three review strata", () => {
    expect(reviewStrata).toEqual(["early", "middle", "late"]);
    expect(volumePositionFor(30, 10)).toBe("early");
    expect(volumePositionFor(30, 11)).toBe("middle");
    expect(volumePositionFor(30, 20)).toBe("middle");
    expect(volumePositionFor(30, 21)).toBe("late");
  });

  it("maps chapter boundaries to their containing volume", () => {
    expect(volumeNumberForChapter(100, 100)).toBe(1);
    expect(volumeNumberForChapter(100, 101)).toBe(2);
  });
});
