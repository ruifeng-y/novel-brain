import { describe, expect, it } from "vitest";

import {
  itemCreateRequestSchema,
  itemEquipRequestSchema,
  itemRightGrantRequestSchema,
  itemUnequipRequestSchema,
  powerRealmCreateRequestSchema,
  powerSystemCreateRequestSchema,
  specialMechanismCreateRequestSchema,
  specialMechanismOwnershipTransferRequestSchema,
  worldSnapshotSchema,
} from "../src";

const branchId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c11";
const characterId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c13";
const mapNodeId = "0190f5e2-7e7a-7f4e-8d38-7e4e5b2a1c14";

describe("power, mechanism and item contracts", () => {
  it("accepts a multi-path power system with configurable realm lifespan", () => {
    const parsed = powerSystemCreateRequestSchema.parse({
      name: "北域修行体系",
      summary: "两条并行路径，寿命由境界配置。",
      overview: "不同路径共享同一套突破代价。",
      lifespanPolicy: {
        mode: "realm",
        unit: "年",
        basis: "境界",
        fixedAmount: null,
      },
      paths: [
        {
          name: "剑修",
          pathType: "剑道",
          realms: [
            {
              name: "引气",
              rank: 1,
              breakthroughConditions: "感应灵气。",
              lifespanAmount: 120,
            },
            {
              name: "筑基",
              rank: 2,
              breakthroughConditions: "灵台稳固。",
              breakthroughCosts: "消耗三百灵石。",
              bottlenecks: "心魔未除则无法筑基。",
              counters: "被破阵类术法克制。",
              lifespanAmount: 240,
            },
          ],
        },
        {
          name: "体修",
          pathType: "肉身",
          realms: [
            {
              name: "锻骨",
              rank: 1,
              breakthroughConditions: "完成百日锻体。",
              lifespanAmount: 150,
            },
          ],
        },
      ],
    });

    expect(parsed.paths).toHaveLength(2);
    expect(parsed.paths[0]?.realms[1]?.lifespanAmount).toBe(240);
  });

  it("rejects genre-specific shortcuts and missing breakthrough data", () => {
    expect(() =>
      powerRealmCreateRequestSchema.parse({
        name: "金丹",
        rank: 3,
        breakthroughConditions: "",
      }),
    ).toThrow();
    expect(() =>
      powerSystemCreateRequestSchema.parse({
        name: "资源体系",
        summary: "寿命必须可配置。",
        overview: "",
        lifespanPolicy: { mode: "fixed", unit: "年", fixedAmount: null },
      }),
    ).toThrow();
  });

  it("separates unique, shared, consumable and equipment item rules", () => {
    const shared = itemCreateRequestSchema.parse({
      name: "共灵丹炉",
      summary: "由两名丹师共同持有。",
      kind: "resource",
      category: "丹炉",
      effect: "可同时炼两炉丹。",
      ownershipModel: "shared",
      consumable: false,
      quantity: 1,
    });
    expect(shared.ownershipModel).toBe("shared");

    expect(() =>
      itemCreateRequestSchema.parse({
        name: "唯一剑",
        summary: "唯一物品不能复制。",
        kind: "equipment",
        category: "兵器",
        effect: "斩断灵体。",
        ownershipModel: "unique",
        quantity: 2,
        equipmentSlot: "main_hand",
      }),
    ).toThrow();
    expect(() =>
      itemCreateRequestSchema.parse({
        name: "未绑定装备",
        summary: "装备必须说明槽位。",
        kind: "equipment",
        category: "防具",
        effect: "护体。",
        ownershipModel: "shared",
        quantity: 1,
      }),
    ).toThrow();
  });

  it("requires distinct right holders and valid equipment targets", () => {
    expect(
      itemRightGrantRequestSchema.parse({
        rightType: "ownership",
        holder: { type: "character", id: characterId, branchId, label: "沈砚" },
        sharePercent: 60,
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        reason: "共同持有。",
      }).rightType,
    ).toBe("ownership");

    expect(() =>
      itemRightGrantRequestSchema.parse({
        rightType: "location",
        holder: { type: "character", id: characterId, branchId, label: "沈砚" },
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        reason: "位置必须落到地图节点。",
      }),
    ).toThrow();
    expect(
      itemRightGrantRequestSchema.parse({
        rightType: "location",
        holder: { type: "map_node", id: mapNodeId, branchId, label: "问剑峰" },
        validity: { fromChapter: 1, toChapter: null, fromStoryTime: null, toStoryTime: null },
        reason: "存放于问剑峰。",
      }).rightType,
    ).toBe("location");
    expect(() =>
      itemEquipRequestSchema.parse({
        version: 1,
        holder: { type: "map_node", id: mapNodeId, branchId, label: "问剑峰" },
        reason: "地图节点不能装备物品。",
      }),
    ).toThrow();
    expect(itemUnequipRequestSchema.parse({ version: 2 })).toEqual({ version: 2 });
    expect(() => itemUnequipRequestSchema.parse({ version: 0 })).toThrow();
  });

  it("requires ownership evidence for mechanism transfers", () => {
    const mechanism = specialMechanismCreateRequestSchema.parse({
      name: "忘川书",
      summary: "吞噬记忆换取答案。",
      mechanismType: "记忆交易",
      owner: { type: "character", id: characterId, branchId, label: "沈砚" },
      rules: "写下问题，交换一段记忆。",
      costs: "每次交换失去一段记忆。",
      limits: "同一天只能问一次。",
      growth: "回答越远，代价越高。",
    });
    expect(mechanism.owner?.id).toBe(characterId);

    expect(() =>
      specialMechanismOwnershipTransferRequestSchema.parse({
        version: 1,
        owner: { type: "character", id: characterId, branchId, label: "沈砚" },
        reason: "所有权转移。",
        evidence: [],
        validity: { fromChapter: 2, toChapter: null, fromStoryTime: null, toStoryTime: null },
      }),
    ).toThrow();
  });

  it("includes dedicated domains in branch snapshots", () => {
    const parsed = worldSnapshotSchema.parse({
      at: { versionNodeId: null, chapterNumber: null },
      factions: [],
      maps: [],
      timeline: {
        eras: [],
        events: [],
        itineraries: [],
        health: [],
        latestVersionNodeId: branchId,
      },
      powerSystems: [],
      mechanisms: [],
      items: [],
    });
    expect(parsed.powerSystems).toEqual([]);
    expect(parsed.items).toEqual([]);
  });
});
