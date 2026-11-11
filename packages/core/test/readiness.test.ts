import { describe, expect, it } from "vitest";

import {
  evaluateGenerationReadiness,
  isReadinessStale,
  READINESS_RULE_VERSION,
  type GenerationReadinessInput,
} from "../src";

function readyInput(): GenerationReadinessInput {
  return {
    workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1001",
    branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1002",
    branchHeadNodeId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ff0",
    chapterId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1003",
    chapterLengthTarget: 3000,
    storyBible: {
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1004",
      version: 3,
      status: "locked",
      readiness: {
        status: "ready",
        completed: 9,
        total: 9,
        canLock: false,
        missingCards: [],
        issues: [],
      },
      worldRuleIds: ["0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1005"],
    },
    settings: [
      {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1006",
        type: "world_rule",
        name: "天门只认完整记忆",
        aliases: [],
        status: "locked",
        version: 2,
      },
      {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1007",
        type: "character",
        name: "沈砚",
        aliases: ["小砚"],
        status: "locked",
        version: 3,
      },
      {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1008",
        type: "golden_finger",
        name: "忘川书",
        aliases: [],
        status: "locked",
        version: 1,
      },
    ],
    pendingSettingProposals: [],
    pendingRiskApprovals: [],
    outline: {
      nodes: [
        structureNode("0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1010", "book", null, 0),
        structureNode(
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1011",
          "volume",
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1010",
          0,
        ),
        structureNode(
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1012",
          "act",
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1011",
          0,
        ),
        structureNode(
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1013",
          "chapter",
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1012",
          0,
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1003",
        ),
        structureNode(
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
          "scene",
          "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1013",
          0,
        ),
      ],
      volumeContractNodeIds: ["0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1011"],
      chapterBriefReadyIds: ["0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1013"],
      sceneCards: [
        {
          nodeId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
          povReady: true,
          locationReady: true,
          storyTimeReady: true,
          beatCount: 3,
          informationReleaseCount: 1,
        },
      ],
    },
    chapter: {
      id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1003",
      version: 4,
      status: "planned",
      brief: {
        goal: "让沈砚找到新的战斗方式。",
        pov: "沈砚",
        location: "荒寺外山道",
        sceneBeats: ["沈砚藏起断臂。"],
        requiredFacts: ["左臂骨折，不能双手结印。"],
      },
    },
    hasReadyChapterBrief: true,
    unresolvedHighRiskFactIds: [],
    config: {
      modelConfig: {
        id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1020",
        version: 2,
        label: "DeepSeek 正文",
        model: "deepseek-chat",
        purposes: ["writing"],
        lastTestStatus: "success",
      },
      budget: {
        maxCostCny: 2.5,
        maxTokens: 30_000,
        maxRevisionRounds: 2,
      },
      budgetSource: "request",
    },
  };
}

function structureNode(
  id: string,
  level: "book" | "volume" | "act" | "chapter" | "scene",
  parentId: string | null,
  sortOrder: number,
  chapterId?: string,
) {
  return {
    id,
    workId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1001",
    branchId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1002",
    level,
    parentId,
    sortOrder,
    locked: false,
    ...(chapterId ? { chapterId } : {}),
  };
}

describe("generation readiness", () => {
  it("is deterministic and ready when every dependency is present", () => {
    const first = evaluateGenerationReadiness(readyInput());
    const second = evaluateGenerationReadiness(readyInput());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ruleVersion: READINESS_RULE_VERSION,
      status: "ready",
      canProceed: true,
      blockers: 0,
      warnings: 0,
      completed: first.total,
    });
    expect(first.dependencyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.items.map((item) => item.key)).toEqual([
      "story_bible",
      "world_rules",
      "settings",
      "pov",
      "outline:structure",
      "outline:book_root",
      "outline:volume_contract:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1011",
      "outline:chapter_brief:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1013",
      "outline:scene_pov:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
      "outline:scene_location:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
      "outline:scene_beats:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
      "outline:scene_time:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
      "outline:scene_information:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
      "required_facts",
      "model_config",
      "budget",
      "risk_approval",
    ]);
    expect(first.items.every((item) => item.ready)).toBe(true);
    expect(isReadinessStale(first, second)).toBe(false);
  });

  it("reports missing resources with exact remediation targets", () => {
    const input = readyInput();
    const readiness = evaluateGenerationReadiness({
      ...input,
      storyBible: null,
      settings: [],
      pendingSettingProposals: [],
      pendingRiskApprovals: [],
      outline: {
        nodes: [],
        volumeContractNodeIds: [],
        chapterBriefReadyIds: [],
        sceneCards: [],
      },
      chapter: null,
      config: {
        ...input.config,
        modelConfig: null,
      },
    });

    expect(readiness).toMatchObject({
      status: "not_ready",
      canProceed: false,
    });
    expect(readiness.blockers).toBeGreaterThan(0);
    expect(readiness.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "story_bible",
          severity: "blocker",
          state: "missing",
          remediation: expect.objectContaining({
            href: `/workspace/${input.workId}/bible#story-bible-readiness`,
          }),
        }),
        expect.objectContaining({
          key: "settings",
          severity: "blocker",
          state: "missing",
        }),
        expect.objectContaining({
          key: "outline:structure",
          severity: "blocker",
          state: "conflict",
        }),
        expect.objectContaining({
          key: "model_config",
          severity: "blocker",
          state: "missing",
          remediation: expect.objectContaining({
            href: "/workspace/settings/account#model-config-title",
          }),
        }),
      ]),
    );
  });

  it("keeps warnings non-blocking and distinguishes unlocked resources", () => {
    const input = readyInput();
    const partial = evaluateGenerationReadiness({
      ...input,
      storyBible: input.storyBible
        ? {
            ...input.storyBible,
            status: "proposed",
          }
        : null,
    });
    expect(partial).toMatchObject({
      status: "not_ready",
      canProceed: false,
    });
    expect(partial.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "story_bible",
          state: "unlocked",
          severity: "blocker",
        }),
      ]),
    );

    const warningOnly = evaluateGenerationReadiness({
      ...input,
      config: {
        ...input.config,
        modelConfig: input.config.modelConfig
          ? { ...input.config.modelConfig, lastTestStatus: null }
          : null,
      },
      outline: {
        ...input.outline,
        sceneCards: input.outline.sceneCards.map((card) => ({
          ...card,
          storyTimeReady: false,
          informationReleaseCount: 0,
        })),
      },
    });
    expect(warningOnly).toMatchObject({
      status: "partial",
      canProceed: true,
      blockers: 0,
    });
    expect(warningOnly.warnings).toBe(3);
    expect(warningOnly.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "model_config",
          severity: "warning",
          ready: false,
        }),
        expect.objectContaining({
          key: "outline:scene_time:0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1014",
          severity: "warning",
        }),
      ]),
    );
  });

  it("blocks conflicting or high-risk dependencies and invalid budgets", () => {
    const input = readyInput();
    const conflict = evaluateGenerationReadiness({
      ...input,
      pendingSettingProposals: [
        {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1030",
          entityId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1007",
          entityType: "character",
          conflictType: "contradictory_fact",
          status: "pending",
        },
      ],
      pendingRiskApprovals: [
        {
          id: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1031",
          kind: "setting_change_request",
          label: "改变沈砚的身体状态",
          resourceId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1032",
          entityId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1007",
          entityType: "character",
        },
      ],
      config: {
        ...input.config,
        budget: { maxCostCny: 0, maxTokens: 1000, maxRevisionRounds: 2 },
      },
    });

    expect(conflict).toMatchObject({
      status: "not_ready",
      canProceed: false,
    });
    expect(conflict.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "settings",
          state: "conflict",
        }),
        expect.objectContaining({
          key: "risk_approval",
          state: "pending",
          remediation: expect.objectContaining({
            href: `/workspace/${input.workId}/settings?column=characters&entityId=0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1007`,
            action: "review",
          }),
        }),
        expect.objectContaining({
          key: "budget",
          state: "invalid",
          resource: expect.objectContaining({
            version: "0:1000:2",
          }),
        }),
      ]),
    );
  });

  it("invalidates prior readiness when a dependency version changes", () => {
    const input = readyInput();
    const previous = evaluateGenerationReadiness(input);
    const current = evaluateGenerationReadiness({
      ...input,
      branchHeadNodeId: "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1ff1",
      chapter: input.chapter ? { ...input.chapter, version: input.chapter.version + 1 } : null,
    });

    expect(previous.dependencyFingerprint).not.toBe(current.dependencyFingerprint);
    expect(isReadinessStale(previous, current)).toBe(true);
  });

  it("holds status, count and remediation invariants across generated dependency states", () => {
    let seed = 148;
    const random = () => {
      seed = (seed * 48_271) % 2_147_483_647;
      return seed / 2_147_483_647;
    };

    for (let index = 0; index < 80; index += 1) {
      const base = readyInput();
      const input: GenerationReadinessInput = {
        ...base,
        branchHeadNodeId: `0190f5e2-7e7a-7f4e-8d38-${Math.floor(random() * 1_000_000)
          .toString(16)
          .padStart(12, "0")}`,
        storyBible:
          random() < 0.25
            ? null
            : {
                ...base.storyBible!,
                version: 1 + Math.floor(random() * 20),
                status: random() < 0.3 ? "draft" : "locked",
                worldRuleIds: random() < 0.2 ? [] : base.storyBible!.worldRuleIds,
              },
        settings: base.settings.map((setting, settingIndex) => ({
          ...setting,
          version: 1 + settingIndex + Math.floor(random() * 5),
          status: random() < 0.2 ? "draft" : "locked",
        })),
        pendingSettingProposals:
          random() < 0.15
            ? [
                {
                  id: `0190f5e2-7e7a-7f4e-8d38-${Math.floor(random() * 1_000_000)
                    .toString(16)
                    .padStart(12, "0")}`,
                  entityId: base.settings[1]!.id,
                  entityType: "character",
                  conflictType: "contradictory_fact",
                  status: "pending",
                },
              ]
            : [],
        pendingRiskApprovals:
          random() < 0.1
            ? [
                {
                  id: `0190f5e2-7e7a-7f4e-8d38-${Math.floor(random() * 1_000_000)
                    .toString(16)
                    .padStart(12, "0")}`,
                  kind: "story_bible_change_request",
                  label: "高风险修改",
                  resourceId: base.storyBible!.id,
                  entityId: null,
                  entityType: null,
                },
              ]
            : [],
        config: {
          ...base.config,
          modelConfig:
            random() < 0.15
              ? null
              : {
                  ...base.config.modelConfig!,
                  version: 1 + Math.floor(random() * 5),
                  lastTestStatus:
                    random() < 0.2 ? null : random() < 0.1 ? "provider_error" : "success",
                },
          budget: {
            maxCostCny: random() < 0.1 ? 0 : 2.5,
            maxTokens: random() < 0.1 ? 1_000 : 30_000,
            maxRevisionRounds: 2,
          },
        },
      };
      const readiness = evaluateGenerationReadiness(input);
      const unresolved = readiness.items.filter((item) => !item.ready);

      expect(readiness.canProceed).toBe(readiness.blockers === 0);
      expect(readiness.status).toBe(
        readiness.blockers > 0 ? "not_ready" : readiness.warnings > 0 ? "partial" : "ready",
      );
      expect(readiness.completed).toBe(readiness.total - unresolved.length);
      expect(readiness.blockers + readiness.warnings).toBe(unresolved.length);
      expect(unresolved.every((item) => item.remediation !== null && item.reason.length > 0)).toBe(
        true,
      );
      expect(evaluateGenerationReadiness(input)).toEqual(readiness);
    }
  });
});
