import { Injectable } from "@nestjs/common";
import {
  characterDataSchema,
  type CustomFieldDefinition,
  type CustomFieldDefinitionCreateRequest,
  type CustomFieldDefinitionPatchRequest,
  type CustomFieldValue,
  factionDataSchema,
  goldenFingerDataSchema,
  mapDataSchema,
  powerSystemDataSchema,
  type CharacterData,
  type ConfirmedSetting,
  type GoldenFingerData,
  type ItemData,
  type SettingEntity,
  type SettingEntityCreateRequest,
  type SettingEntityListQuery,
  type SettingEntityLockRequest,
  type SettingEntityPatchRequest,
  type SettingChangeRequest,
  type SettingChangeRequestCreateRequest,
  type SettingProposal,
  type SettingProposalCreateRequest,
  type SettingProposalDecisionRequest,
  type TimelineEventData,
  type WorldRuleData,
  itemDataSchema,
  timelineEventDataSchema,
  worldRuleDataSchema,
} from "@novel-brain/contracts";

import { ApiError } from "../common/api-error";
// Nest uses the runtime class reference for dependency injection metadata.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { SettingsRepository } from "./settings.repository";
import type {
  CustomFieldDefinitionRecord,
  SettingProposalRecord,
  SettingChangeRequestRecord,
  SettingWriteViolation,
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
    const [records, customFields] = await Promise.all([
      this.repository.list(userId, context, query),
      this.repository.listEntityCustomFieldValues(userId, context),
    ]);
    return records.map((record) => this.toContract(record, customFields[record.id] ?? {}));
  }

  async get(userId: string, workId: string, branchId: string, entityId: string) {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const record = await this.repository.find(userId, context, entityId);
    if (!record) {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    const customFields = await this.repository.listEntityCustomFieldValues(userId, context, [
      record.id,
    ]);
    return this.toContract(record, customFields[record.id] ?? {});
  }

  async create(
    userId: string,
    workId: string,
    branchId: string,
    input: SettingEntityCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingEntity> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const created = await this.repository.create(userId, context, input, audit);
    if (isSettingWriteViolation(created)) {
      throw settingConflict(created);
    }
    const customFields = await this.repository.listEntityCustomFieldValues(userId, context, [
      created.id,
    ]);
    return this.toContract(created, customFields[created.id] ?? {});
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
    if (updated === "proposed") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定有待确认提案，请先完成裁决");
    }
    if (updated === "discarded") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定已废弃，不能再编辑");
    }
    if (updated === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    if (isSettingWriteViolation(updated)) {
      throw settingConflict(updated);
    }
    const customFields = await this.repository.listEntityCustomFieldValues(userId, context, [
      updated.id,
    ]);
    return this.toContract(updated, customFields[updated.id] ?? {});
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
    if (locked === "proposed") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定有待确认提案，请先完成裁决");
    }
    if (locked === "discarded") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定已废弃，不能再锁定");
    }
    if (locked === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    const customFields = await this.repository.listEntityCustomFieldValues(userId, context, [
      locked.id,
    ]);
    return this.toContract(locked, customFields[locked.id] ?? {});
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
    if (removed === "proposed") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定有待确认提案，请先完成裁决");
    }
    if (removed === "discarded") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "设定已废弃");
    }
    return { deleted: true };
  }

  async listCustomFields(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<CustomFieldDefinition[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const definitions = await this.repository.listCustomFields(userId, context);
    return definitions.map((definition) => this.toCustomFieldContract(definition));
  }

  async createCustomField(
    userId: string,
    workId: string,
    branchId: string,
    input: CustomFieldDefinitionCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<CustomFieldDefinition> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const definition = await this.repository.createCustomField(userId, context, input, audit);
    if (definition === "duplicate") {
      throw new ApiError(409, "CUSTOM_FIELD_DUPLICATE", "自定义字段标识已存在", {
        key: input.key,
      });
    }
    return this.toCustomFieldContract(definition);
  }

  async updateCustomField(
    userId: string,
    workId: string,
    branchId: string,
    fieldId: string,
    input: CustomFieldDefinitionPatchRequest,
    audit: SettingsAuditContext,
  ): Promise<CustomFieldDefinition> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const updated = await this.repository.updateCustomField(userId, context, fieldId, input, audit);
    if (updated === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "自定义字段不存在或无权访问");
    }
    if (updated === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "自定义字段已被其他操作更新，请刷新后重试");
    }
    if (updated === "immutable") {
      throw new ApiError(
        400,
        "CUSTOM_FIELD_IMMUTABLE",
        "字段标识、类型和适用范围创建后不能直接修改",
      );
    }
    if (updated === "option_in_use") {
      throw new ApiError(409, "CUSTOM_FIELD_INVALID", "已有设定使用该选项，不能删除");
    }
    if (updated === "duplicate") {
      throw new ApiError(409, "CUSTOM_FIELD_DUPLICATE", "自定义字段标识已存在");
    }
    return this.toCustomFieldContract(updated);
  }

  async listProposals(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<SettingProposal[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const proposals = await this.repository.listProposals(userId, context, entityId);
    return proposals.map((proposal) => this.toProposalContract(proposal));
  }

  async createProposal(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: SettingProposalCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingProposal> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const proposal = await this.repository.createProposal(userId, context, entityId, input, audit);
    if (proposal === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    if (proposal === "locked") {
      throw new ApiError(409, "SETTING_LOCKED", "锁定设定需要发起修改请求");
    }
    if (proposal === "discarded") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "废弃设定不能再提交提案");
    }
    if (proposal === "pending_exists") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "该设定已有待确认提案");
    }
    if (proposal === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    return this.toProposalContract(proposal);
  }

  async decideProposal(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    proposalId: string,
    input: SettingProposalDecisionRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingProposal> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const proposal = await this.repository.decideProposal(
      userId,
      context,
      entityId,
      proposalId,
      input,
      audit,
    );
    if (proposal === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "提案不存在或无权访问");
    }
    if (proposal === "invalid_state") {
      throw new ApiError(409, "SETTING_PROPOSAL_STATE", "提案或设定状态已变化，请刷新后重试");
    }
    if (proposal === "unresolved_conflict") {
      throw new ApiError(409, "SETTING_CONFLICT_UNRESOLVED", "冲突未解决，不能直接确认提案");
    }
    if (proposal === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    return this.toProposalContract(proposal);
  }

  async listChangeRequests(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
  ): Promise<SettingChangeRequest[]> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const requests = await this.repository.listChangeRequests(userId, context, entityId);
    return requests.map((request) => this.toChangeRequestContract(request));
  }

  async createChangeRequest(
    userId: string,
    workId: string,
    branchId: string,
    entityId: string,
    input: SettingChangeRequestCreateRequest,
    audit: SettingsAuditContext,
    idempotencyKey?: string,
  ): Promise<SettingChangeRequest> {
    const context = await this.requireWorkContext(userId, workId, branchId);
    const request = await this.repository.createChangeRequest(
      userId,
      context,
      entityId,
      input,
      audit,
      idempotencyKey,
    );
    if (request === "not_found") {
      throw new ApiError(403, "FORBIDDEN_TENANT_ACCESS", "设定不存在或无权访问");
    }
    if (request === "not_locked") {
      throw new ApiError(409, "SETTING_NOT_LOCKED", "只有锁定设定需要发起修改请求");
    }
    if (request === "version_conflict") {
      throw new ApiError(409, "VERSION_CONFLICT", "设定已被其他操作更新，请刷新后重试");
    }
    if (request === "invalid_data") {
      throw new ApiError(400, "VALIDATION_INVALID", "修改内容与当前设定类型不匹配");
    }
    if (isSettingWriteViolation(request)) {
      throw settingConflict(request);
    }
    return this.toChangeRequestContract(request);
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

  private toContract(
    record: SettingEntityRecord,
    customFields: Record<string, unknown>,
  ): SettingEntity {
    const values = customFields as Record<string, CustomFieldValue>;
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
        customFields: values,
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
        customFields: values,
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
        customFields: values,
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

    if (record.type === "item") {
      return {
        id: record.id,
        workId: record.workId,
        branchId: record.branchId,
        type: "item",
        name: record.name,
        aliases: record.aliases,
        summary: record.summary,
        description: record.description,
        tags: record.tags,
        customFields: values,
        status: record.status as SettingEntity["status"],
        source: record.source as SettingEntity["source"],
        version: record.version,
        data: record.attributes as ItemData,
        lockedAt: record.lockedAt?.toISOString() ?? null,
        lockedBy: record.lockedBy,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      };
    }

    if (record.type === "timeline_event") {
      return {
        id: record.id,
        workId: record.workId,
        branchId: record.branchId,
        type: "timeline_event",
        name: record.name,
        aliases: record.aliases,
        summary: record.summary,
        description: record.description,
        tags: record.tags,
        customFields: values,
        status: record.status as SettingEntity["status"],
        source: record.source as SettingEntity["source"],
        version: record.version,
        data: record.attributes as TimelineEventData,
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
      customFields: values,
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

  private toCustomFieldContract(record: CustomFieldDefinitionRecord): CustomFieldDefinition {
    return {
      id: record.id,
      workId: record.workId,
      branchId: record.branchId,
      key: record.key,
      label: record.label,
      fieldType: record.fieldType as CustomFieldDefinition["fieldType"],
      appliesTo: record.appliesTo as CustomFieldDefinition["appliesTo"],
      required: record.required,
      options: record.options,
      relationTarget: record.relationTarget as CustomFieldDefinition["relationTarget"],
      enabled: record.enabled,
      schemaVersion: record.schemaVersion,
      sortOrder: record.sortOrder,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toProposalContract(record: SettingProposalRecord): SettingProposal {
    return {
      id: record.id,
      entityId: record.entityId,
      workId: record.workId,
      branchId: record.branchId,
      entityVersion: record.entityVersion,
      status: record.status as SettingProposal["status"],
      conflictType: record.conflictType as SettingProposal["conflictType"],
      evidence: record.evidence as SettingProposal["evidence"],
      reason: record.reason,
      proposedBy: record.proposedBy,
      createdAt: record.createdAt.toISOString(),
      decidedBy: record.decidedBy,
      decidedAt: record.decidedAt?.toISOString() ?? null,
      decisionReason: record.decisionReason,
      decisionEvidence: record.decisionEvidence as SettingProposal["decisionEvidence"],
      decisionConflictType: record.decisionConflictType as SettingProposal["decisionConflictType"],
    };
  }

  private toChangeRequestContract(record: SettingChangeRequestRecord): SettingChangeRequest {
    return {
      id: record.id,
      entityId: record.entityId,
      workId: record.workId,
      branchId: record.branchId,
      entityVersion: record.entityVersion,
      title: record.title,
      reason: record.reason,
      before: record.before,
      after: record.after,
      status: record.status as SettingChangeRequest["status"],
      conflictType: record.conflictType as SettingChangeRequest["conflictType"],
      evidence: record.evidence as SettingChangeRequest["evidence"],
      createdBy: record.createdBy,
      createdAt: record.createdAt.toISOString(),
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
              : type === "item"
                ? itemDataSchema.partial()
                : type === "timeline_event"
                  ? timelineEventDataSchema.partial()
                  : worldRuleDataSchema.partial();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_INVALID", "设定字段与当前类型不匹配");
  }
}

function isSettingWriteViolation(
  value: Awaited<ReturnType<SettingsRepository["create"]>> | object,
): value is SettingWriteViolation {
  return typeof value === "object" && value !== null && "kind" in value;
}

function settingConflict(conflict: SettingWriteViolation): ApiError {
  if (conflict.kind === "custom_field_required") {
    return new ApiError(400, "CUSTOM_FIELD_REQUIRED", conflict.message, {
      fieldKey: conflict.fieldKey,
    });
  }
  if (conflict.kind === "custom_field_invalid") {
    return new ApiError(400, "CUSTOM_FIELD_INVALID", conflict.message, {
      fieldKey: conflict.fieldKey,
    });
  }
  if (conflict.kind === "name_conflict") {
    return new ApiError(409, "SETTING_NAME_CONFLICT", "同一栏目已有同名设定，请使用别名区分", {
      entityId: conflict.entityId,
      conflictingName: conflict.value,
    });
  }
  if (conflict.kind === "alias_conflict") {
    return new ApiError(409, "SETTING_ALIAS_CONFLICT", "别名已被其他设定使用，请换一个名称", {
      entityId: conflict.entityId,
      conflictingAlias: conflict.value,
    });
  }
  throw new Error("Unhandled setting write conflict");
}
