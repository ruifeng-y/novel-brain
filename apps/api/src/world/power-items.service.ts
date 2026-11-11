import { Injectable } from "@nestjs/common";
import type {
  ItemConsumeRequest,
  ItemCreateRequest,
  ItemDomain,
  ItemEquipRequest,
  ItemListQuery,
  ItemPatchRequest,
  ItemRight,
  ItemRightGrantRequest,
  PowerPath,
  PowerPathCreateRequest,
  PowerRealm,
  PowerRealmCreateRequest,
  PowerSystem,
  PowerSystemCreateRequest,
  PowerSystemListQuery,
  PowerSystemPatchRequest,
  SpecialMechanism,
  SpecialMechanismCreateRequest,
  SpecialMechanismListQuery,
  SpecialMechanismOwnershipTransferRequest,
  SpecialMechanismPatchRequest,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
import { invalidCursorError, type CursorPageResult } from "../common/cursor-page";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PowerItemsRepository } from "./power-items.repository";
import type {
  PowerItemsAuditContext,
  PowerItemsWorkContext,
  PowerItemsWriteResult,
} from "./power-items.repository";

interface ReadQuery {
  chapterNumber?: number | undefined;
}

@Injectable()
export class PowerItemsService {
  constructor(private readonly repository: PowerItemsRepository) {}

  async listPowerSystems(
    userId: string,
    workId: string,
    branchId: string,
    query: PowerSystemListQuery,
  ): Promise<CursorPageResult<PowerSystem>> {
    const context = await this.requireContext(userId, workId, branchId);
    const page = await this.repository.listPowerSystems(userId, context, query, query);
    if (page === "invalid_cursor") {
      throw invalidCursorError();
    }
    return page;
  }

  async getPowerSystem(
    userId: string,
    workId: string,
    branchId: string,
    powerSystemId: string,
    query: ReadQuery,
  ): Promise<PowerSystem> {
    const context = await this.requireContext(userId, workId, branchId);
    const detail = await this.repository.getPowerSystem(userId, context, powerSystemId, query);
    if (!detail) {
      throw tenantError("力量体系不存在或无权访问");
    }
    return detail;
  }

  async createPowerSystem(
    userId: string,
    workId: string,
    branchId: string,
    input: PowerSystemCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerSystem> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createPowerSystem(userId, context, input, audit));
  }

  async updatePowerSystem(
    userId: string,
    workId: string,
    branchId: string,
    powerSystemId: string,
    input: PowerSystemPatchRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerSystem> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.updatePowerSystem(userId, context, powerSystemId, input, audit),
    );
  }

  async addPowerPath(
    userId: string,
    workId: string,
    branchId: string,
    powerSystemId: string,
    input: PowerPathCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerPath> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.addPowerPath(userId, context, powerSystemId, input, audit));
  }

  async addPowerRealm(
    userId: string,
    workId: string,
    branchId: string,
    powerSystemId: string,
    pathId: string,
    input: PowerRealmCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerRealm> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.addPowerRealm(userId, context, powerSystemId, pathId, input, audit),
    );
  }

  async listMechanisms(
    userId: string,
    workId: string,
    branchId: string,
    query: SpecialMechanismListQuery,
  ): Promise<CursorPageResult<SpecialMechanism>> {
    const context = await this.requireContext(userId, workId, branchId);
    const page = await this.repository.listMechanisms(userId, context, query, query);
    if (page === "invalid_cursor") {
      throw invalidCursorError();
    }
    return page;
  }

  async getMechanism(
    userId: string,
    workId: string,
    branchId: string,
    mechanismId: string,
    query: ReadQuery,
  ): Promise<SpecialMechanism> {
    const context = await this.requireContext(userId, workId, branchId);
    const detail = await this.repository.getMechanism(userId, context, mechanismId, query);
    if (!detail) {
      throw tenantError("特殊机制不存在或无权访问");
    }
    return detail;
  }

  async createMechanism(
    userId: string,
    workId: string,
    branchId: string,
    input: SpecialMechanismCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<SpecialMechanism> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createMechanism(userId, context, input, audit));
  }

  async updateMechanism(
    userId: string,
    workId: string,
    branchId: string,
    mechanismId: string,
    input: SpecialMechanismPatchRequest,
    audit: PowerItemsAuditContext,
  ): Promise<SpecialMechanism> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.updateMechanism(userId, context, mechanismId, input, audit),
    );
  }

  async transferMechanismOwnership(
    userId: string,
    workId: string,
    branchId: string,
    mechanismId: string,
    input: SpecialMechanismOwnershipTransferRequest,
    audit: PowerItemsAuditContext,
  ): Promise<SpecialMechanism> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(
      await this.repository.transferMechanismOwnership(userId, context, mechanismId, input, audit),
    );
  }

  async listItems(
    userId: string,
    workId: string,
    branchId: string,
    query: ItemListQuery,
  ): Promise<CursorPageResult<ItemDomain>> {
    const context = await this.requireContext(userId, workId, branchId);
    const page = await this.repository.listItems(userId, context, query, query);
    if (page === "invalid_cursor") {
      throw invalidCursorError();
    }
    return page;
  }

  async getItem(
    userId: string,
    workId: string,
    branchId: string,
    itemId: string,
    query: ReadQuery,
  ): Promise<ItemDomain> {
    const context = await this.requireContext(userId, workId, branchId);
    const detail = await this.repository.getItem(userId, context, itemId, query);
    if (!detail) {
      throw tenantError("物品功法不存在或无权访问");
    }
    return detail;
  }

  async createItem(
    userId: string,
    workId: string,
    branchId: string,
    input: ItemCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<ItemDomain> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.createItem(userId, context, input, audit));
  }

  async updateItem(
    userId: string,
    workId: string,
    branchId: string,
    itemId: string,
    input: ItemPatchRequest,
    audit: PowerItemsAuditContext,
  ): Promise<ItemDomain> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.updateItem(userId, context, itemId, input, audit));
  }

  async grantItemRight(
    userId: string,
    workId: string,
    branchId: string,
    itemId: string,
    input: ItemRightGrantRequest,
    audit: PowerItemsAuditContext,
  ): Promise<ItemRight> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.grantItemRight(userId, context, itemId, input, audit));
  }

  async consumeItem(
    userId: string,
    workId: string,
    branchId: string,
    itemId: string,
    input: ItemConsumeRequest,
    audit: PowerItemsAuditContext,
  ): Promise<ItemDomain> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.consumeItem(userId, context, itemId, input, audit));
  }

  async equipItem(
    userId: string,
    workId: string,
    branchId: string,
    itemId: string,
    input: ItemEquipRequest,
    audit: PowerItemsAuditContext,
  ): Promise<ItemDomain> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.equipItem(userId, context, itemId, input, audit));
  }

  async unequipItem(
    userId: string,
    workId: string,
    branchId: string,
    itemId: string,
    version: number,
    audit: PowerItemsAuditContext,
  ): Promise<ItemDomain> {
    const context = await this.requireContext(userId, workId, branchId);
    return unwrap(await this.repository.unequipItem(userId, context, itemId, version, audit));
  }

  private async requireContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<PowerItemsWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw tenantError("作品或创作线不存在，或无权访问");
    }
    return context;
  }
}

function unwrap<T>(result: PowerItemsWriteResult<T>): T {
  if (result.kind === "ok") {
    return result.value;
  }
  switch (result.kind) {
    case "not_found":
      throw tenantError("设定不存在或无权访问");
    case "locked":
      throw new ApiError(409, "SETTING_LOCKED", "设定已锁定，请提交修改请求");
    case "proposal_state":
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定正在提案或已废弃，不能直接编辑");
    case "version_conflict":
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    case "name_conflict":
      throw new ApiError(409, "SETTING_NAME_CONFLICT", "名称已被其他设定使用");
    case "alias_conflict":
      throw new ApiError(409, "SETTING_ALIAS_CONFLICT", "别名与其他设定冲突");
    case "target_not_found":
      throw new ApiError(400, "VALIDATION_INVALID", "引用的对象不存在或不属于当前分支");
    case "path_mismatch":
      throw new ApiError(409, "POWER_PATH_MISMATCH", "路径不属于当前力量体系");
    case "power_ladder_invalid":
      throw new ApiError(409, "POWER_REALM_LADDER_INVALID", "境界层级或突破前置不合法", {
        findings: result.findings,
      });
    case "lifespan_invalid":
      throw new ApiError(409, "POWER_LIFESPAN_POLICY_INVALID", "寿命策略绑定的路径不存在");
    case "item_right_conflict":
      throw new ApiError(409, "ITEM_RIGHT_CONFLICT", "物品权利与现有归属或位置冲突", {
        findings: result.findings,
      });
    case "item_not_consumable":
      throw new ApiError(409, "ITEM_NOT_CONSUMABLE", "该物品不是消耗品");
    case "item_quantity_insufficient":
      throw new ApiError(409, "ITEM_QUANTITY_INSUFFICIENT", "物品数量不足");
    case "equipment_conflict":
      throw new ApiError(409, "EQUIPMENT_SLOT_CONFLICT", "同一装备位已有其他物品");
    case "not_equipment":
      throw new ApiError(409, "ITEM_NOT_EQUIPMENT", "该物品不能按装备处理");
  }
}

function tenantError(message: string): ApiError {
  return new ApiError(403, "FORBIDDEN_TENANT_ACCESS", message);
}
