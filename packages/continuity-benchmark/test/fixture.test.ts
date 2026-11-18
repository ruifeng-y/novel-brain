import { describe, expect, it } from "vitest";

import { generateContinuityFixture } from "../src/fixture";
import { createContinuityPlan } from "../src/plan";

describe("continuity fixture", () => {
  const plan = createContinuityPlan({ seed: 20261118, tier: "smoke" });

  it("generates a deterministic multi-volume branch fixture", () => {
    const first = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const second = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

    expect(first).toEqual(second);
    expect(first.chapters).toHaveLength(12);
    expect(first.volumes).toHaveLength(3);
    expect(first.branches.map((branch) => branch.name)).toEqual([
      "main",
      "early-divergence",
      "middle-divergence",
      "late-divergence",
    ]);
    expect(first.digest).toMatchObject({
      schemaVersion: 1,
      generatorVersion: "continuity-benchmark-v1",
      sourceCommit: "abc1234",
      chapterCount: 12,
      volumeCount: 3,
    });
    expect(first.digest.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("keeps objective canon, subjective knowledge and hidden facts separate", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

    expect(fixture.facts.some((fact) => fact.visibility === "hidden")).toBe(true);
    expect(fixture.facts.map((fact) => fact.decisionState)).toEqual(
      expect.arrayContaining(["proposed", "confirmed", "locked", "superseded"]),
    );
    expect(fixture.facts.every((fact) => typeof fact.objectiveCanon === "boolean")).toBe(true);
    expect(
      fixture.knowledgeStates.every(
        (state) =>
          typeof state.allowedDisclosureFromChapter === "number" ||
          state.allowedDisclosureFromChapter === null,
      ),
    ).toBe(true);
    expect(
      fixture.knowledgeStates.every(
        (state) =>
          state.allowedDisclosureFromChapter === null ||
          state.validFromChapter >= state.allowedDisclosureFromChapter,
      ),
    ).toBe(true);
    expect(new Set(fixture.knowledgeStates.map((state) => state.state))).toEqual(
      new Set(["knowledge", "belief", "suspicion", "misbelief", "unknown"]),
    );
    expect(fixture.items[0]?.rights).toMatchObject({
      ownerId: expect.any(String),
      custodianId: expect.any(String),
      locationId: expect.any(String),
      usageRightId: expect.any(String),
    });
  });

  it("seeds every required scenario family with linked, actionable failures", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const defectFamilies = new Set(fixture.defects.map((defect) => defect.family));

    for (const family of [
      "knowledge_boundary",
      "body_continuity",
      "identity_transition",
      "inventory_rights",
      "travel_time",
      "foreshadow_payoff",
      "motivation_drift",
      "branch_divergence",
    ] as const) {
      expect(defectFamilies).toContain(family);
    }
    for (const defect of fixture.defects) {
      expect(defect.chapterNumber).toBeGreaterThanOrEqual(1);
      expect(defect.chapterNumber).toBeLessThanOrEqual(plan.chapterCount);
      expect(defect.sourceFactId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(defect.entityIds.length).toBeGreaterThan(0);
      expect(defect.versionNodeId).toMatch(/^[0-9a-f-]{36}$/u);
      expect(defect.evidence.trim().length).toBeGreaterThan(0);
    }
    expect(fixture.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: "false_alarm" }),
        expect.objectContaining({ mode: "incomplete_context" }),
      ]),
    );
  });

  it("makes every seeded defect reviewable in its cited chapter", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

    for (const defect of fixture.defects) {
      const chapter =
        defect.branchId === fixture.branches[0]!.id
          ? fixture.chapters.find((candidate) => candidate.number === defect.chapterNumber)
          : fixture.branchChapters.find(
              (candidate) =>
                candidate.branchId === defect.branchId &&
                candidate.chapterNumber === defect.chapterNumber,
            );
      expect(chapter).toBeDefined();
      expect(chapter?.versionNodeId).toBe(defect.versionNodeId);
      expect(chapter?.content).toContain(defect.evidence);
      const sourceFact = fixture.facts.find((fact) => fact.id === defect.sourceFactId);
      expect(sourceFact?.objectiveCanon).toBe(true);
      expect(["confirmed", "locked"]).toContain(sourceFact?.decisionState);
      expect(
        defect.entityIds.every((entityId) =>
          fixture.entities.some((entity) => entity.id === entityId),
        ),
      ).toBe(true);
    }
  });

  it("models the story bible, five-level outline, identity rules and branch-scoped state", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const branchIds = new Set(fixture.branches.map((branch) => branch.id));

    expect(fixture.storyBible.title).toBe("忘川旧梦");
    expect(fixture.storyBible.worldRules.length).toBeGreaterThan(0);
    expect(fixture.genrePack.name).toBe("仙侠");
    expect(fixture.genrePacks.map((genre) => genre.name)).toEqual(["仙侠", "历史", "都市"]);
    expect(fixture.genreScenarios.map((scenario) => scenario.genre)).toEqual([
      "仙侠",
      "历史",
      "都市",
    ]);
    expect(fixture.genreScenarios.map((scenario) => scenario.chapterSample)).toEqual(
      expect.arrayContaining([expect.stringContaining("驿马"), expect.stringContaining("股权")]),
    );
    expect(fixture.genreScenarios.map((scenario) => scenario.defectSample)).toEqual(
      expect.arrayContaining([expect.stringContaining("军报"), expect.stringContaining("调查")]),
    );
    expect(fixture.powerSystem.realms.length).toBeGreaterThanOrEqual(3);
    expect(fixture.powerSystem.lifespanPolicy).toContain("境界");
    expect(fixture.specialMechanisms).toHaveLength(2);
    expect(fixture.characterPowerStates.length).toBeGreaterThanOrEqual(4);
    expect(fixture.characterPowerStates.every((state) => state.ageYears > 0)).toBe(true);
    expect(
      fixture.characterPowerStates.some(
        (state) => state.remainingLifespanYears !== state.previousLifespanYears,
      ),
    ).toBe(true);
    for (const state of fixture.characterPowerStates) {
      const realm = fixture.powerSystem.realms.find((candidate) => candidate.name === state.realm)!;
      expect(state.ageYears + state.remainingLifespanYears).toBe(realm.lifespanYears);
    }
    expect(new Set(fixture.lifespanWorldCases.map((entry) => entry.mode))).toEqual(
      new Set(["realm_bound", "age_only"]),
    );
    expect(fixture.itemRightsTransitions.map((transition) => transition.action)).toEqual(
      expect.arrayContaining([
        "transfer",
        "theft",
        "loan",
        "consumption",
        "destruction",
        "disposal",
      ]),
    );
    expect(new Set(fixture.mapNodes.map((node) => node.scale))).toEqual(
      new Set(["world", "realm", "region", "city"]),
    );
    expect(fixture.timeline.some((event) => event.simultaneousGroup !== null)).toBe(true);
    expect(fixture.timeline.some((event) => event.isTimeSkip)).toBe(true);
    expect(fixture.workId).toMatch(/^[0-9a-f-]{36}$/u);
    for (const eventId of fixture.facts.map((fact) => fact.sourceEventId)) {
      expect(fixture.eventManifest.some((event) => event.id === eventId)).toBe(true);
    }
    expect(
      new Set(fixture.identityTransitions.map((transition) => transition.sourceEventId)).size,
    ).toBe(fixture.identityTransitions.length);
    for (const item of fixture.items) {
      const transitions = fixture.itemRightsTransitions
        .filter((transition) => transition.itemId === item.id)
        .sort((left, right) => left.chapterNumber - right.chapterNumber);
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions[0]?.fromRights).toEqual(item.rights);
      expect(transitions[0]?.chapterNumber).toBeGreaterThan(item.validFromChapter);
      for (let index = 1; index < transitions.length; index += 1) {
        expect(transitions[index]?.fromRights).toEqual(transitions[index - 1]?.toRights);
      }
    }
    expect(new Set(fixture.outlineNodes.map((node) => node.level))).toEqual(
      new Set(["book", "volume", "act", "chapter", "scene"]),
    );
    expect(fixture.outlineNodes.every((node) => branchIds.has(node.branchId))).toBe(true);
    expect(new Set(fixture.identityTransitions.map((transition) => transition.kind))).toEqual(
      new Set([
        "same_identity_new_body",
        "new_identity_inherited_memories",
        "temporary_control",
        "independent_clone",
        "death",
        "resurrection",
        "soul_split",
        "possession",
        "reincarnation",
      ]),
    );
    expect(fixture.characterArcs).toHaveLength(4);
    expect(fixture.foreshadows.map((foreshadow) => foreshadow.status)).toEqual(
      expect.arrayContaining(["planted", "paid_off", "abandoned"]),
    );
    expect(fixture.foreshadows.map((foreshadow) => foreshadow.kind)).toContain("false_lead");

    for (const collection of [
      fixture.facts,
      fixture.knowledgeStates,
      fixture.stateTransitions,
      fixture.identityTransitions,
      fixture.items,
      fixture.itemRightsTransitions,
      fixture.timeline,
      fixture.mapNodes,
      fixture.relationships,
      fixture.plotThreads,
      fixture.foreshadows,
      fixture.styleSamples,
      fixture.characterArcs,
      fixture.characterPowerStates,
      fixture.branchChapters,
    ]) {
      expect(collection.every((entry) => branchIds.has(entry.branchId))).toBe(true);
    }
  });

  it("keeps branch facts, chapter snapshots and timeline events after their divergence", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });

    for (const branch of fixture.branches.slice(1)) {
      const branchFacts = fixture.facts.filter((fact) => fact.branchId === branch.id);
      expect(branchFacts.length).toBeGreaterThan(0);
      expect(branchFacts.every((fact) => fact.validFromChapter >= branch.divergenceChapter!)).toBe(
        true,
      );

      const branchChapters = fixture.branchChapters.filter(
        (chapter) => chapter.branchId === branch.id,
      );
      expect(branchChapters.length).toBeGreaterThan(0);
      expect(
        branchChapters.every((chapter) => chapter.chapterNumber >= branch.divergenceChapter!),
      ).toBe(true);
      expect(
        fixture.timeline.some(
          (event) =>
            event.branchId === branch.id && event.chapterNumber >= branch.divergenceChapter!,
        ),
      ).toBe(true);
    }
  });

  it("defines bounded-agent scenarios for repair, abstention and escalation", () => {
    const fixture = generateContinuityFixture({ plan, sourceCommit: "abc1234" });
    const dispositions = new Set(
      fixture.agentScenarios.map((scenario) => scenario.expectedDisposition),
    );

    expect(dispositions).toEqual(new Set(["propose_repair", "abstain", "escalate"]));
    for (const scenario of fixture.agentScenarios) {
      expect(scenario.budgetTokens).toBeGreaterThan(0);
      expect(scenario.maxImpactObjects).toBeGreaterThan(0);
      expect(scenario.allowedTools).not.toContain("submit_canon");
      expect(scenario.forbiddenTools).toContain("submit_canon");
      expect(scenario.forbiddenTools).toContain("grant_permission");
      expect(scenario.expectedDefectIds.length + scenario.controlIds.length).toBeGreaterThan(0);
      expect(new Set(scenario.workflow.map((step) => step.stage))).toEqual(
        new Set([
          "detect",
          "cite_evidence",
          "classify_severity",
          "propose_repair",
          "check_task_envelope",
          "execute_or_escalate",
          "rerun_checks",
          "record_change_ledger",
        ]),
      );
      expect(scenario.workflow.every((step) => step.required)).toBe(true);
      expect(scenario.expectedResult).toMatchObject({
        disposition: scenario.expectedDisposition,
        canonMutated: false,
        approvalRequested: scenario.requiresApproval,
        rerunCompleted: true,
        ledgerEntryRecorded: true,
        additionalPermissionsGranted: false,
      });
    }
  });
});
