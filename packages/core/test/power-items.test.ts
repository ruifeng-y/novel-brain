import { describe, expect, it } from "vitest";

import {
  findEquipmentSlotConflicts,
  resolvePowerLifespan,
  validateItemConsumption,
  validateItemRightSet,
  validatePowerRealmLadder,
} from "../src";

const realm = (
  id: string,
  rank: number,
  prerequisiteRealmId: string | null = null,
  lifespanAmount: number | null = null,
  pathId = "p1",
) => ({ id, rank, prerequisiteRealmId, lifespanAmount, pathId });

describe("power system invariants", () => {
  it("accepts separate multi-path ladders", () => {
    expect(
      validatePowerRealmLadder([
        realm("a1", 1),
        realm("a2", 2, "a1"),
        realm("b1", 1, null, null, "p2"),
        realm("b2", 2, "b1", null, "p2"),
      ]),
    ).toEqual([]);
  });

  it("reports duplicate ranks, missing prerequisites, backward prerequisites and cycles", () => {
    const findings = validatePowerRealmLadder([
      realm("a1", 1),
      realm("a2", 1),
      realm("a3", 3, "missing"),
      realm("a4", 2, "a5"),
      realm("a5", 4, "a4"),
    ]);
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "POWER_REALM_RANK_DUPLICATE",
        "POWER_REALM_PREREQUISITE_MISSING",
        "POWER_REALM_PREREQUISITE_RANK_ORDER",
        "POWER_REALM_PREREQUISITE_CYCLE",
      ]),
    );
  });

  it("resolves lifespan from configurable policy instead of a hardcoded genre rule", () => {
    expect(
      resolvePowerLifespan(
        { mode: "none", unit: "年", basis: "", description: "", pathId: null, fixedAmount: null },
        realm("a1", 1, null, 120),
      ),
    ).toEqual({ amount: null, unit: "年", issue: null });
    expect(
      resolvePowerLifespan(
        { mode: "fixed", unit: "年", basis: "", description: "", pathId: null, fixedAmount: 80 },
        realm("a1", 1, null, 120),
      ),
    ).toEqual({ amount: 80, unit: "年", issue: null });
    expect(
      resolvePowerLifespan(
        {
          mode: "realm",
          unit: "年",
          basis: "境界",
          description: "",
          pathId: null,
          fixedAmount: null,
        },
        realm("a1", 1, null, 120),
      ),
    ).toEqual({ amount: 120, unit: "年", issue: null });
    expect(
      resolvePowerLifespan(
        {
          mode: "realm",
          unit: "年",
          basis: "境界",
          description: "",
          pathId: null,
          fixedAmount: null,
        },
        realm("a1", 1, null, null),
      ),
    ).toEqual({ amount: null, unit: "年", issue: "LIFESPAN_REALM_AMOUNT_MISSING" });
    expect(
      resolvePowerLifespan(
        {
          mode: "custom",
          unit: "任期",
          basis: "组织贡献",
          description: "由宗门贡献决定。",
          pathId: null,
          fixedAmount: null,
        },
        realm("a1", 1),
      ),
    ).toEqual({ amount: null, unit: "任期", issue: null });
  });
});

describe("item and resource right invariants", () => {
  const validity = {
    fromChapter: 1,
    toChapter: null,
    fromStoryTime: null,
    toStoryTime: null,
  };
  it("allows shared owners but enforces the 100 percent ceiling", () => {
    expect(
      validateItemRightSet({ ownershipModel: "shared", quantity: 1 }, [
        { rightType: "ownership", holderId: "a", sharePercent: 60, validity },
        { rightType: "ownership", holderId: "b", sharePercent: 40, validity },
      ]),
    ).toEqual([]);
    expect(
      validateItemRightSet({ ownershipModel: "shared", quantity: 1 }, [
        { rightType: "ownership", holderId: "a", sharePercent: 60, validity },
        { rightType: "ownership", holderId: "b", sharePercent: 60, validity },
      ]).map((finding) => finding.code),
    ).toContain("ITEM_OWNERSHIP_SHARE_EXCEEDED");
  });

  it("allows only one active owner and one active location for unique items", () => {
    expect(
      validateItemRightSet({ ownershipModel: "unique", quantity: 1 }, [
        { rightType: "ownership", holderId: "a", sharePercent: 100, validity },
        { rightType: "ownership", holderId: "b", sharePercent: 100, validity },
        { rightType: "location", holderId: "node-1", sharePercent: null, validity },
        { rightType: "location", holderId: "node-2", sharePercent: null, validity },
      ]).map((finding) => finding.code),
    ).toEqual(expect.arrayContaining(["ITEM_UNIQUE_OWNERSHIP_CONFLICT", "ITEM_LOCATION_CONFLICT"]));
  });

  it("keeps custody, usage and disposal distinct from ownership", () => {
    expect(
      validateItemRightSet({ ownershipModel: "shared", quantity: 1 }, [
        { rightType: "ownership", holderId: "owner", sharePercent: 100, validity },
        { rightType: "custody", holderId: "keeper", sharePercent: null, validity },
        { rightType: "usage", holderId: "user", sharePercent: null, validity },
        { rightType: "disposal", holderId: "steward", sharePercent: null, validity },
      ]),
    ).toEqual([]);
  });

  it("blocks rights on depleted items and validates consumption", () => {
    expect(
      validateItemRightSet({ ownershipModel: "shared", quantity: 0 }, [
        { rightType: "usage", holderId: "a", sharePercent: null, validity },
      ]).map((finding) => finding.code),
    ).toContain("ITEM_DEPLETED_RIGHTS");
    expect(validateItemConsumption({ consumable: true, quantity: 2 }, 1)).toEqual({
      ok: true,
      remaining: 1,
    });
    expect(validateItemConsumption({ consumable: false, quantity: 2 }, 1)).toEqual({
      ok: false,
      code: "ITEM_NOT_CONSUMABLE",
    });
    expect(validateItemConsumption({ consumable: true, quantity: 1 }, 2)).toEqual({
      ok: false,
      code: "ITEM_QUANTITY_INSUFFICIENT",
    });
  });

  it("detects equipment slot conflicts per holder", () => {
    expect(
      findEquipmentSlotConflicts([
        { itemId: "sword", holderId: "a", slot: "main_hand", equipped: true },
        { itemId: "blade", holderId: "a", slot: "main_hand", equipped: true },
      ]),
    ).toEqual([
      {
        code: "EQUIPMENT_SLOT_CONFLICT",
        holderId: "a",
        slot: "main_hand",
        itemIds: ["blade", "sword"],
      },
    ]);
  });
});
