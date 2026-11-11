export interface PowerLifespanPolicyInput {
  mode: "none" | "realm" | "fixed" | "custom";
  unit: string;
  basis: string;
  description: string;
  pathId: string | null;
  fixedAmount: number | null;
}

export interface PowerRealmLifespanInput {
  rank: number;
  lifespanAmount: number | null;
}

export interface PowerLifespanResolution {
  amount: number | null;
  unit: string;
  issue: "LIFESPAN_REALM_AMOUNT_MISSING" | null;
}

export function resolvePowerLifespan(
  policy: PowerLifespanPolicyInput,
  realm: PowerRealmLifespanInput,
): PowerLifespanResolution {
  if (policy.mode === "fixed") {
    return { amount: policy.fixedAmount, unit: policy.unit, issue: null };
  }
  if (policy.mode === "realm") {
    return realm.lifespanAmount === null
      ? { amount: null, unit: policy.unit, issue: "LIFESPAN_REALM_AMOUNT_MISSING" }
      : { amount: realm.lifespanAmount, unit: policy.unit, issue: null };
  }
  return { amount: null, unit: policy.unit, issue: null };
}

export interface PowerRealmLadderEntry {
  id: string;
  pathId: string;
  rank: number;
  prerequisiteRealmId: string | null;
}

export type PowerRealmLadderFindingCode =
  | "POWER_REALM_RANK_DUPLICATE"
  | "POWER_REALM_PREREQUISITE_MISSING"
  | "POWER_REALM_PREREQUISITE_SELF"
  | "POWER_REALM_PREREQUISITE_RANK_ORDER"
  | "POWER_REALM_PREREQUISITE_CYCLE";

export interface PowerRealmLadderFinding {
  code: PowerRealmLadderFindingCode;
  message: string;
  relatedIds: string[];
}

export function validatePowerRealmLadder(
  realms: PowerRealmLadderEntry[],
): PowerRealmLadderFinding[] {
  const findings: PowerRealmLadderFinding[] = [];
  const byId = new Map(realms.map((realm) => [realm.id, realm] as const));
  const byRank = new Map<string, string[]>();
  for (const realm of realms) {
    const key = `${realm.pathId}\u0000${realm.rank}`;
    const group = byRank.get(key) ?? [];
    group.push(realm.id);
    byRank.set(key, group);
  }
  for (const [key, ids] of [...byRank.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (ids.length > 1) {
      const rank = Number(key.split("\u0000")[1]);
      findings.push({
        code: "POWER_REALM_RANK_DUPLICATE",
        message: `境界层级 ${rank} 被多个境界重复占用。`,
        relatedIds: ids,
      });
    }
  }
  for (const realm of realms) {
    if (realm.prerequisiteRealmId === null) {
      continue;
    }
    if (realm.prerequisiteRealmId === realm.id) {
      findings.push({
        code: "POWER_REALM_PREREQUISITE_SELF",
        message: "境界不能以自身作为突破前置。",
        relatedIds: [realm.id],
      });
      continue;
    }
    const prerequisite = byId.get(realm.prerequisiteRealmId);
    if (!prerequisite || prerequisite.pathId !== realm.pathId) {
      findings.push({
        code: "POWER_REALM_PREREQUISITE_MISSING",
        message: "突破前置境界不存在于当前路径。",
        relatedIds: [realm.id, realm.prerequisiteRealmId],
      });
      continue;
    }
    if (prerequisite.rank >= realm.rank) {
      findings.push({
        code: "POWER_REALM_PREREQUISITE_RANK_ORDER",
        message: "突破前置境界的层级必须低于当前境界。",
        relatedIds: [realm.id, prerequisite.id],
      });
    }
  }
  const cyclic = new Set<string>();
  for (const start of realms) {
    const seen = new Set<string>();
    let cursor: PowerRealmLadderEntry | undefined = start;
    while (cursor?.prerequisiteRealmId) {
      if (seen.has(cursor.id)) {
        cyclic.add(cursor.id);
        break;
      }
      seen.add(cursor.id);
      const next = byId.get(cursor.prerequisiteRealmId);
      cursor = next && next.pathId === cursor.pathId ? next : undefined;
    }
    if (cursor && seen.has(cursor.id)) {
      cyclic.add(cursor.id);
    }
  }
  if (cyclic.size > 0) {
    findings.push({
      code: "POWER_REALM_PREREQUISITE_CYCLE",
      message: "境界突破前置形成环，无法确定成长顺序。",
      relatedIds: [...cyclic].sort(),
    });
  }
  return findings;
}

export type ItemRightType = "ownership" | "custody" | "location" | "usage" | "disposal";

export interface ItemRightInterval {
  rightType: ItemRightType;
  holderId: string;
  sharePercent: number | null;
  validity: {
    fromChapter: number;
    toChapter: number | null;
  };
}

export interface ItemRightSubject {
  ownershipModel: "shared" | "unique";
  quantity: number;
}

export type ItemRightFindingCode =
  | "ITEM_RIGHT_VALIDITY_INVALID"
  | "ITEM_OWNERSHIP_SHARE_INVALID"
  | "ITEM_OWNERSHIP_SHARE_EXCEEDED"
  | "ITEM_UNIQUE_OWNERSHIP_CONFLICT"
  | "ITEM_CUSTODY_CONFLICT"
  | "ITEM_LOCATION_CONFLICT"
  | "ITEM_DEPLETED_RIGHTS";

export interface ItemRightFinding {
  code: ItemRightFindingCode;
  message: string;
  relatedIds: string[];
}

export function validateItemRightSet(
  item: ItemRightSubject,
  rights: ItemRightInterval[],
): ItemRightFinding[] {
  const findings: ItemRightFinding[] = [];
  for (const right of rights) {
    if (
      right.validity.toChapter !== null &&
      right.validity.toChapter < right.validity.fromChapter
    ) {
      findings.push({
        code: "ITEM_RIGHT_VALIDITY_INVALID",
        message: "权利结束章节不能早于开始章节。",
        relatedIds: [right.holderId],
      });
    }
    if (
      right.rightType === "ownership" &&
      (right.sharePercent === null || right.sharePercent <= 0 || right.sharePercent > 100)
    ) {
      findings.push({
        code: "ITEM_OWNERSHIP_SHARE_INVALID",
        message: "归属权必须给出 0 到 100 之间的份额。",
        relatedIds: [right.holderId],
      });
    }
  }

  for (const group of overlappingRightGroups(rights, "ownership")) {
    if (item.ownershipModel === "unique" && group.length > 1) {
      findings.push({
        code: "ITEM_UNIQUE_OWNERSHIP_CONFLICT",
        message: "唯一物品在同一章节只能有一个归属者。",
        relatedIds: group.map((right) => right.holderId),
      });
      continue;
    }
    const total = group.reduce((sum, right) => sum + (right.sharePercent ?? 0), 0);
    if (total > 100) {
      findings.push({
        code: "ITEM_OWNERSHIP_SHARE_EXCEEDED",
        message: "同一章节的有效归属份额不能超过 100%。",
        relatedIds: group.map((right) => right.holderId),
      });
    }
  }

  if (item.ownershipModel === "unique") {
    for (const group of overlappingRightGroups(rights, "custody")) {
      if (group.length > 1) {
        findings.push({
          code: "ITEM_CUSTODY_CONFLICT",
          message: "唯一物品在同一章节只能有一位保管者。",
          relatedIds: group.map((right) => right.holderId),
        });
      }
    }
  }
  for (const group of overlappingRightGroups(rights, "location")) {
    if (group.length > 1) {
      findings.push({
        code: "ITEM_LOCATION_CONFLICT",
        message: "同一物品在同一章节只能存在于一个位置。",
        relatedIds: group.map((right) => right.holderId),
      });
    }
  }
  if (item.quantity === 0 && rights.length > 0) {
    findings.push({
      code: "ITEM_DEPLETED_RIGHTS",
      message: "已耗尽的物品不能再保留有效权利。",
      relatedIds: [],
    });
  }
  return dedupeFindings(findings);
}

function overlappingRightGroups(
  rights: ItemRightInterval[],
  rightType: ItemRightType,
): ItemRightInterval[][] {
  const candidates = rights.filter((right) => right.rightType === rightType);
  const visited = new Set<number>();
  const groups: ItemRightInterval[][] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (visited.has(index)) {
      continue;
    }
    const group = [candidates[index]!];
    visited.add(index);
    for (let other = index + 1; other < candidates.length; other += 1) {
      if (
        !visited.has(other) &&
        group.some((right) => intervalsOverlap(right.validity, candidates[other]!.validity))
      ) {
        group.push(candidates[other]!);
        visited.add(other);
      }
    }
    if (group.length > 1) {
      groups.push(group);
    }
  }
  return groups;
}

function intervalsOverlap(
  left: ItemRightInterval["validity"],
  right: ItemRightInterval["validity"],
): boolean {
  const leftEnd = left.toChapter ?? Number.POSITIVE_INFINITY;
  const rightEnd = right.toChapter ?? Number.POSITIVE_INFINITY;
  return left.fromChapter <= rightEnd && right.fromChapter <= leftEnd;
}

function dedupeFindings(findings: ItemRightFinding[]): ItemRightFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}:${finding.relatedIds.join(",")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export interface ItemConsumptionState {
  consumable: boolean;
  quantity: number;
}

export type ItemConsumptionResult =
  | { ok: true; remaining: number }
  | { ok: false; code: "ITEM_NOT_CONSUMABLE" | "ITEM_QUANTITY_INSUFFICIENT" };

export function validateItemConsumption(
  item: ItemConsumptionState,
  amount: number,
): ItemConsumptionResult {
  if (!item.consumable) {
    return { ok: false, code: "ITEM_NOT_CONSUMABLE" };
  }
  if (amount <= 0 || item.quantity < amount) {
    return { ok: false, code: "ITEM_QUANTITY_INSUFFICIENT" };
  }
  return { ok: true, remaining: item.quantity - amount };
}

export interface EquipmentAssignment {
  itemId: string;
  holderId: string;
  slot: string;
  equipped: boolean;
}

export interface EquipmentSlotConflict {
  code: "EQUIPMENT_SLOT_CONFLICT";
  holderId: string;
  slot: string;
  itemIds: string[];
}

export function findEquipmentSlotConflicts(
  assignments: EquipmentAssignment[],
): EquipmentSlotConflict[] {
  const groups = new Map<string, string[]>();
  for (const assignment of assignments) {
    if (!assignment.equipped) {
      continue;
    }
    const key = `${assignment.holderId}\u0000${assignment.slot}`;
    const itemIds = groups.get(key) ?? [];
    itemIds.push(assignment.itemId);
    groups.set(key, itemIds);
  }
  return [...groups.entries()]
    .filter(([, itemIds]) => itemIds.length > 1)
    .map(([key, itemIds]) => {
      const [holderId, slot] = key.split("\u0000");
      return {
        code: "EQUIPMENT_SLOT_CONFLICT" as const,
        holderId: holderId!,
        slot: slot!,
        itemIds: [...itemIds].sort(),
      };
    })
    .sort(
      (left, right) =>
        left.holderId.localeCompare(right.holderId) || left.slot.localeCompare(right.slot),
    );
}
