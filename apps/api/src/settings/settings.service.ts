import { Injectable } from "@nestjs/common";
import {
  characterDataSchema,
  factionDataSchema,
  goldenFingerDataSchema,
  mapDataSchema,
  powerSystemDataSchema,
  type CharacterData,
  type ConfirmedSetting,
  type GoldenFingerData,
  type SettingEntity,
  type SettingEntityCreateRequest,
  type SettingEntityListQuery,
  type SettingEntityLockRequest,
  type SettingEntityPatchRequest,
  type WorldRuleData,
  worldRuleDataSchema,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsRepository } from "./settings.repository";
import type {
  SettingEntityRecord,
  SettingsAuditContext,
  SettingsWorkContext,
} from "./settings.repository";

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async list(
    userId: string,
    workId: string,
    branchId: string,
    query: SettingEntityListQuery,
  ): Promise<SettingEntity[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const records = await this.repository.list(userId, context, query);
    return records.map((record) => this.toContract(record));
  }

  async get(userId: string, workId: string, branchId: string, entityId: string) {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const record = await this.repository.find(userId, context, entityId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    return this.toContract(record);
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: SettingEntityCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingEntity> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    return this.toContract(await this.repository.create(userId, context, input, audit));
  }

  async confirmed(userId: string, workId: string, branchId: string): Promise<ConfirmedSetting[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const [records, canonFacts] = await Promise.all([
      this.repository.list(userId, context, { status: "locked" }),
      this.repository.listCanonFacts(userId, context),
    ]);
    return [
      ...records.map((record) => ({
        id: record.id,
        type: record.type as ConfirmedSetting["type"],
        name: record.name,
        summary: record.summary,
        source: record.source as ConfirmedSetting["source"],
        status: "locked" as const,
        version: record.version,
        lockedAt: record.lockedAt?.toISOString() ?? new Date(0).toISOString(),
      })),
      ...canonFacts.map((fact) => ({
        kind: "fact" as const,
        id: fact.id,
        type: factType(fact.predicate),
        name: fact.subject,
        summary: `${fact.predicate}：${fact.object}`,
        source: "canon" as const,
        status: "locked" as const,
        version: 1,
        lockedAt: fact.createdAt.toISOString(),
        sourceChapterId: fact.chapterId,
        sourceFactId: fact.id,
        validFromChapter: fact.validFromChapter,
        validToChapter: fact.validToChapter,
        predicate: fact.predicate,
        object: fact.object,
      })),
    ];
  }

  async patch(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: SettingEntityPatchRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingEntity> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const current = await this.repository.find(userId, context, entityId);
    if (!current) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    if (current.status === "locked") {
      throw new ApiError(409, "SETTING_LOCKED", "设定已锁定，不能直接编辑或修改别名");
    }
    if (current.version !== input.version) {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    if (input.data !== undefined) {
      requireMatchingSettingData(current.type as SettingEntity["type"], input.data);
    }
    const updated = await this.repository.update(userId, context, entityId, input, audit);
    if (updated === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    if (updated === "locked") {
      throw new ApiError(409, "SETTING_LOCKED", "设定已锁定，不能直接编辑或修改别名");
    }
    if (updated === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    return this.toContract(updated);
  }

  async lock(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: SettingEntityLockRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingEntity> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const locked = await this.repository.lock(userId, context, entityId, input.version, audit);
    if (locked === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    if (locked === "locked") {
      throw new ApiError(409, "SETTING_LOCKED", "设定已锁定");
    }
    if (locked === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    return this.toContract(locked);
  }

  async remove(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    audit: SettingsAuditContext,
  ): Promise<{ deleted: true }> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const removed = await this.repository.remove(userId, context, entityId, audit);
    if (removed === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    if (removed === "locked") {
      throw new ApiError(409, "SETTING_LOCKED", "设定已锁定，不能直接删除");
    }
    return { deleted: true };
  }

  private async requireWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<SettingsWorkContext> {
    const context = await this.repository.findWorkContext(userId, workId, branchId);
    if (!context) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "作品或创作线不存在，或无权访问");
    }
    return context;
  }

  private toContract(record: SettingEntityRecord): SettingEntity {
    if (record.type === "character") {
      return {
        id: record.id,
        workId: record.workId,
        branchId: record.branchId,
        type: "character",
        name: record.name,
        aliases: record.aliases,
        summary: record.summary,
        description: record.description,
        tags: record.tags,
        status: record.status as SettingEntity["status"],
        source: record.source as SettingEntity["source"],
        version: record.version,
        data: record.attributes as CharacterData,
        lockedAt: record.lockedAt?.toISOString() ?? null,
        lockedBy: record.lockedBy,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    }

    if (record.type === "golden_finger") {
      return {
        id: record.id,
        workId: record.workId,
        branchId: record.branchId,
        type: "golden_finger",
        name: record.name,
        aliases: record.aliases,
        summary: record.summary,
        description: record.description,
        tags: record.tags,
        status: record.status as SettingEntity["status"],
        source: record.source as SettingEntity["source"],
        version: record.version,
        data: record.attributes as GoldenFingerData,
        lockedAt: record.lockedAt?.toISOString() ?? null,
        lockedBy: record.lockedBy,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    }

    if (record.type === "faction" || record.type === "map" || record.type === "power_system") {
      return {
        id: record.id,
        workId: record.workId,
        branchId: record.branchId,
        type: record.type,
        name: record.name,
        aliases: record.aliases,
        summary: record.summary,
        description: record.description,
        tags: record.tags,
        status: record.status as SettingEntity["status"],
        source: record.source as SettingEntity["source"],
        version: record.version,
        data: record.attributes as { details: string },
        lockedAt: record.lockedAt?.toISOString() ?? null,
        lockedBy: record.lockedBy,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    }

    return {
      id: record.id,
      workId: record.workId,
      branchId: record.branchId,
      type: "world_rule",
      name: record.name,
      aliases: record.aliases,
      summary: record.summary,
      description: record.description,
      tags: record.tags,
      status: record.status as SettingEntity["status"],
      source: record.source as SettingEntity["source"],
      version: record.version,
      data: record.attributes as WorldRuleData,
      lockedAt: record.lockedAt?.toISOString() ?? null,
      lockedBy: record.lockedBy,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

function factType(predicate: string): ConfirmedSetting["type"] {
  if (predicate.includes("身体") || predicate.includes("认知") || predicate.includes("关系")) {
    return "character";
  }
  if (predicate.includes("金手指") || predicate.includes("能力")) {
    return "golden_finger";
  }
  return "world_rule";
}

function requireMatchingSettingData(
  type: SettingEntity["type"],
  data: SettingEntityPatchRequest["data"],
): void {
  if (!data || Object.keys(data).length === 0) {
    throw new ApiError(400, "VALIDATION_INVALID", "至少需要修改一个类型字段");
  }
  const schema =
    type === "character"
      ? characterDataSchema.partial()
      : type === "golden_finger"
        ? goldenFingerDataSchema.partial()
        : type === "faction"
          ? factionDataSchema.partial()
          : type === "map"
            ? mapDataSchema.partial()
            : type === "power_system"
              ? powerSystemDataSchema.partial()
              : worldRuleDataSchema.partial();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_INVALID", "设定字段与当前类型不匹配");
  }
}
