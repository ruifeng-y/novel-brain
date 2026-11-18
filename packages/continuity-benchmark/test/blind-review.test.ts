import { describe, expect, it } from "vitest";

import { buildContinuityBlindReviewPacket } from "../src/blind-review";
import { generateContinuityFixture } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";

const plan = createContinuityPlan({ seed: 20261118, tier: "minimum" });
const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

describe("continuity blind review packet", () => {
  it("stratifies deterministic samples across early, middle and late volumes", () => {
    const first = buildContinuityBlindReviewPacket({
      fixture,
      samplesPerStratum: 2,
    });
    const second = buildContinuityBlindReviewPacket({
      fixture,
      samplesPerStratum: 2,
    });

    expect(first).toEqual(second);
    expect(first.packet.items).toHaveLength(6);
    for (const stratum of ["early", "middle", "late"] as const) {
      expect(first.packet.items.filter((item) => item.stratum === stratum)).toHaveLength(2);
    }
    expect(new Set(first.packet.items.map((item) => item.chapterNumber)).size).toBe(
      first.packet.items.length,
    );
    expect(first.packet.packetSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.oracle.oracleSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("withholds hidden author truth and provider identity from reviewers", () => {
    const { packet, oracle } = buildContinuityBlindReviewPacket({
      fixture,
      samplesPerStratum: 1,
    });

    expect(packet.items.every((item) => !("expectedDefectIds" in item))).toBe(true);
    expect(packet.items.every((item) => !("hiddenFactIds" in item))).toBe(true);
    expect(packet.items.every((item) => !("modelIdentity" in item))).toBe(true);
    expect(oracle.items).toHaveLength(3);
    expect(oracle.items.every((item) => item.expectedDefectIds.length > 0)).toBe(true);
    expect(
      packet.items.some((item) =>
        item.povContext.approvedFacts.every(
          (fact) =>
            fixture.facts.find((candidate) => candidate.id === fact.id)?.visibility === "public",
        ),
      ),
    ).toBe(true);
    for (const stratum of ["early", "middle", "late"] as const) {
      const reviewIds = new Set(
        packet.items.filter((item) => item.stratum === stratum).map((item) => item.reviewId),
      );
      const families = oracle.items
        .filter((item) => reviewIds.has(item.reviewId))
        .flatMap((item) => item.expectedFamilies);
      expect(
        families.some((family) =>
          [
            "knowledge_boundary",
            "identity_transition",
            "branch_divergence",
            "foreshadow_payoff",
          ].includes(family),
        ),
      ).toBe(true);
    }
  });

  it("requires an explicit positive sample count", () => {
    expect(() => buildContinuityBlindReviewPacket({ fixture, samplesPerStratum: 0 })).toThrow(
      "BLIND_SAMPLE_COUNT_INVALID",
    );
  });

  it("keeps each reviewer packet inside its branch history", () => {
    const { packet } = buildContinuityBlindReviewPacket({
      fixture,
      samplesPerStratum: 3,
    });
    const mainBranchId = fixture.branches[0]!.id;

    for (const item of packet.items) {
      const branch = fixture.branches.find((candidate) => candidate.id === item.branchId)!;
      const visibleFactIds = new Set([
        ...item.povContext.approvedFacts.map((fact) => fact.id),
        ...item.povContext.knownStates.map((state) => state.objectiveFactId),
      ]);
      for (const factId of visibleFactIds) {
        const fact = fixture.facts.find((candidate) => candidate.id === factId)!;
        const sharedHistory =
          fact.branchId === mainBranchId &&
          branch.divergenceChapter !== null &&
          fact.validFromChapter <= branch.divergenceChapter;
        expect(fact.branchId === item.branchId || sharedHistory).toBe(true);
      }
    }
  });
});
