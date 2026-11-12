import { describe, expect, it } from "vitest";

import {
  genrePackDefinitionSchema,
  genrePackVersionChangeRequestSchema,
  workCreateRequestSchema,
} from "../src";

const packId = "019c1e8c-8e1c-7000-8000-000000000001";

describe("genre pack contracts", () => {
  it("accepts a versioned history pack with rules and UI hints", () => {
    expect(
      genrePackDefinitionSchema.parse({
        id: packId,
        key: "history",
        version: 2,
        label: "架空历史模板",
        fields: { world: "架空古代", powerSystem: "军制与武道" },
        fieldSchema: [
          {
            key: "world",
            label: "世界",
            type: "text",
            required: true,
            options: [],
          },
        ],
        rules: [
          {
            key: "no-cultivation",
            label: "不套用修仙境界",
            description: "历史题材不得出现修炼境界。",
          },
        ],
        uiHints: {
          worldLabel: "架空古代",
          powerSystemLabel: "军制与武道",
          powerLevelLabel: "军职层级",
          factionLabel: "门阀与边军",
          itemLabel: "军械文书",
        },
        generationGuidance: {
          protagonistArchetypes: ["寒门军校"],
          conflictSeeds: ["边军粮道被截"],
          worldRuleSeeds: ["粮草决定行军速度"],
          forbiddenElements: ["修仙境界"],
        },
        migration: {
          fromVersion: 1,
          toVersion: 2,
          notes: ["增加军功簿字段"],
        },
      }),
    ).toMatchObject({ key: "history", version: 2 });
  });

  it("allows all three genres in template creation and validates version changes", () => {
    expect(
      workCreateRequestSchema.parse({
        mode: "template",
        templateKey: "urban",
        genre: "urban",
        title: "旧城新局",
      }),
    ).toMatchObject({ templateKey: "urban", genre: "urban" });
    expect(
      genrePackVersionChangeRequestSchema.parse({
        targetVersion: 1,
        reason: "回滚到旧版字段",
      }),
    ).toEqual({ targetVersion: 1, reason: "回滚到旧版字段" });
  });
});
