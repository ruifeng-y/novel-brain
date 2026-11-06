import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  characterProfiles,
  customFieldDefinitions,
  customFieldValues,
  facts as canonicalFacts,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  settingChangeRequests,
  settingProposals,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import {
  characterDataSchema,
  factionDataSchema,
  goldenFingerDataSchema,
  itemDataSchema,
  mapDataSchema,
  powerSystemDataSchema,
  timelineEventDataSchema,
  worldRuleDataSchema,
  type CustomFieldDefinitionCreateRequest,
  type CustomFieldDefinitionPatchRequest,
  type SettingChangeRequestCreateRequest,
  type SettingProposalCreateRequest,
  type SettingProposalDecisionRequest,
  type SettingEntityCreateRequest,
  type SettingEntityListQuery,
  type SettingEntityPatchRequest,
} from "@novel-brain/contracts";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type SettingEntityRecord = InferSelectModel<typeof entities>;
export type CanonFactRecord = InferSelectModel<typeof canonicalFacts>;
export type CustomFieldDefinitionRecord = InferSelectModel<typeof customFieldDefinitions>;
export type SettingProposalRecord = InferSelectModel<typeof settingProposals>;
export type SettingChangeRequestRecord = InferSelectModel<typeof settingChangeRequests>;

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface SettingsWorkContext {
  workId: string;
  branchId: string;
}

export interface SettingsAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface SettingWriteConflict {
  kind: "name_conflict" | "alias_conflict";
  entityId: string;
  value: string;
}

export interface SettingWriteValidationError {
  kind: "custom_field_required" | "custom_field_invalid";
  fieldKey: string;
  message: string;
}

export type SettingWriteViolation = SettingWriteConflict | SettingWriteValidationError;
export type EntityCustomFieldValues = Record<string, Record<string, unknown>>;

@Injectable()
export class SettingsRepository implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly db: DatabaseClient;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }
    this.pool = createDatabasePool(databaseUrl);
    this.db = createDatabaseClient(this.pool);
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<SettingsWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
        .select({
          workId: works.id,
          branchId: workBranches.id,
        })
        .from(works)
        .innerJoin(
          workBranches,
          and(eq(workBranches.workId, works.id), eq(workBranches.userId, works.userId)),
        )
        .where(
          and(
            eq(works.id, workId),
            eq(works.userId, userId),
            eq(workBranches.id, branchId),
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async list(
    userId: string,
    context: SettingsWorkContext,
    input: SettingEntityListQuery,
  ): Promise<SettingEntityRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
            input.type ? eq(entities.type, input.type) : undefined,
            input.status ? eq(entities.status, input.status) : undefined,
          ),
        )
        .orderBy(asc(entities.createdAt)),
    );
  }

  async listCanonFacts(userId: string, context: SettingsWorkContext): Promise<CanonFactRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(canonicalFacts)
        .where(
          and(
            eq(canonicalFacts.userId, userId),
            eq(canonicalFacts.workId, context.workId),
            eq(canonicalFacts.branchId, context.branchId),
            eq(canonicalFacts.status, "active"),
          ),
        )
        .orderBy(asc(canonicalFacts.createdAt)),
    );
  }

  async listCustomFields(
    userId: string,
    context: SettingsWorkContext,
  ): Promise<CustomFieldDefinitionRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.userId, userId),
            eq(customFieldDefinitions.workId, context.workId),
            eq(customFieldDefinitions.branchId, context.branchId),
          ),
        )
        .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.createdAt)),
    );
  }

  async listEntityCustomFieldValues(
    userId: string,
    context: SettingsWorkContext,
    entityIds?: string[],
  ): Promise<EntityCustomFieldValues> {
    return this.withTenant(userId, async (transaction) =>
      readCustomFieldValues(transaction, userId, context, entityIds),
    );
  }

  async createCustomField(
    userId: string,
    context: SettingsWorkContext,
    input: CustomFieldDefinitionCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<CustomFieldDefinitionRecord | "duplicate"> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [existing] = await transaction
        .select({ id: customFieldDefinitions.id })
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.workId, context.workId),
            eq(customFieldDefinitions.branchId, context.branchId),
            eq(customFieldDefinitions.key, input.key),
          ),
        )
        .limit(1);
      if (existing) {
        return "duplicate";
      }
      const now = new Date();
      const [definition] = await transaction
        .insert(customFieldDefinitions)
        .values({
          id: uuidv7(),
          workId: context.workId,
          branchId: context.branchId,
          userId,
          key: input.key,
          label: input.label,
          fieldType: input.fieldType,
          appliesTo: input.appliesTo,
          required: input.required,
          options: input.options,
          relationTarget: input.relationTarget,
          enabled: true,
          schemaVersion: 1,
          sortOrder: input.sortOrder,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!definition) {
        throw new Error("Failed to create custom field");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "setting.custom_field.created",
        targetType: "custom_field",
        targetId: definition.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return definition;
    });
  }

  async updateCustomField(
    userId: string,
    context: SettingsWorkContext,
    fieldId: string,
    input: CustomFieldDefinitionPatchRequest,
    audit: SettingsAuditContext,
  ): Promise<
    | "not_found"
    | "version_conflict"
    | "immutable"
    | "option_in_use"
    | "duplicate"
    | CustomFieldDefinitionRecord
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.id, fieldId),
            eq(customFieldDefinitions.userId, userId),
            eq(customFieldDefinitions.workId, context.workId),
            eq(customFieldDefinitions.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.schemaVersion !== input.schemaVersion) {
        return "version_conflict";
      }
      if (
        (input.key !== undefined && input.key !== current.key) ||
        (input.fieldType !== undefined && input.fieldType !== current.fieldType) ||
        (input.appliesTo !== undefined && input.appliesTo !== current.appliesTo)
      ) {
        return "immutable";
      }
      if (input.key && input.key !== current.key) {
        const [duplicate] = await transaction
          .select({ id: customFieldDefinitions.id })
          .from(customFieldDefinitions)
          .where(
            and(
              eq(customFieldDefinitions.workId, context.workId),
              eq(customFieldDefinitions.branchId, context.branchId),
              eq(customFieldDefinitions.key, input.key),
              ne(customFieldDefinitions.id, fieldId),
            ),
          )
          .limit(1);
        if (duplicate) {
          return "duplicate";
        }
      }
      if (input.options) {
        const removedOptions = current.options.filter((option) => !input.options?.includes(option));
        if (removedOptions.length > 0) {
          const values = await transaction
            .select({ value: customFieldValues.value })
            .from(customFieldValues)
            .where(eq(customFieldValues.fieldDefinitionId, fieldId));
          const used = values.some((row) =>
            removedOptions.some((option) =>
              Array.isArray(row.value) ? row.value.includes(option) : row.value === option,
            ),
          );
          if (used) {
            return "option_in_use";
          }
        }
      }
      const nextFieldType = input.fieldType ?? current.fieldType;
      const nextOptions = input.options ?? current.options;
      const nextRelationTarget =
        input.relationTarget === undefined ? current.relationTarget : input.relationTarget;
      if (!validCustomFieldDefinitionShape(nextFieldType, nextOptions, nextRelationTarget)) {
        return "immutable";
      }
      const [updated] = await transaction
        .update(customFieldDefinitions)
        .set({
          label: input.label ?? current.label,
          required: input.required ?? current.required,
          options: nextOptions,
          relationTarget: nextRelationTarget,
          enabled: input.enabled ?? current.enabled,
          sortOrder: input.sortOrder ?? current.sortOrder,
          schemaVersion: current.schemaVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customFieldDefinitions.id, current.id),
            eq(customFieldDefinitions.schemaVersion, current.schemaVersion),
          ),
        )
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "setting.custom_field.updated",
        targetType: "custom_field",
        targetId: updated.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return updated;
    });
  }

  async listProposals(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
  ): Promise<SettingProposalRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(settingProposals)
        .where(
          and(
            eq(settingProposals.userId, userId),
            eq(settingProposals.workId, context.workId),
            eq(settingProposals.branchId, context.branchId),
            eq(settingProposals.entityId, entityId),
          ),
        )
        .orderBy(asc(settingProposals.createdAt)),
    );
  }

  async createProposal(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    input: SettingProposalCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<
    | "not_found"
    | "locked"
    | "discarded"
    | "pending_exists"
    | "version_conflict"
    | SettingProposalRecord
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status === "locked") {
        return "locked";
      }
      if (current.status === "discarded") {
        return "discarded";
      }
      if (current.version !== input.version) {
        return "version_conflict";
      }
      const [pending] = await transaction
        .select({ id: settingProposals.id })
        .from(settingProposals)
        .where(
          and(
            eq(settingProposals.entityId, current.id),
            eq(settingProposals.userId, userId),
            eq(settingProposals.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) {
        return "pending_exists";
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const [updated] = await transaction
        .update(entities)
        .set({
          status: "proposed",
          version: current.version + 1,
          updatedAt: now,
        })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      const [proposal] = await transaction
        .insert(settingProposals)
        .values({
          id: uuidv7(),
          entityId: updated.id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          entityVersion: updated.version,
          status: "pending",
          conflictType: input.conflictType,
          evidence: input.evidence,
          reason: input.reason,
          proposedBy: userId,
          createdAt: now,
        })
        .returning();
      if (!proposal) {
        throw new Error("Failed to create setting proposal");
      }
      const customFields =
        (await readCustomFieldValues(transaction, userId, context, [updated.id]))[updated.id] ?? {};
      await this.appendVersion(
        transaction,
        userId,
        updated,
        headNodeId,
        "setting.proposed",
        input.reason,
        audit,
        customFields,
      );
      return proposal;
    });
  }

  async decideProposal(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    proposalId: string,
    input: SettingProposalDecisionRequest,
    audit: SettingsAuditContext,
  ): Promise<
    | "not_found"
    | "invalid_state"
    | "unresolved_conflict"
    | "version_conflict"
    | SettingProposalRecord
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [proposal] = await transaction
        .select()
        .from(settingProposals)
        .where(
          and(
            eq(settingProposals.id, proposalId),
            eq(settingProposals.entityId, entityId),
            eq(settingProposals.userId, userId),
            eq(settingProposals.workId, context.workId),
            eq(settingProposals.branchId, context.branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!proposal) {
        return "not_found";
      }
      if (proposal.status !== "pending") {
        return "invalid_state";
      }
      if (input.decision === "accept" && input.conflictType !== "none") {
        return "unresolved_conflict";
      }
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status !== "proposed") {
        return "invalid_state";
      }
      if (current.version !== proposal.entityVersion) {
        return "version_conflict";
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const accepting = input.decision === "accept";
      const [updatedEntity] = await transaction
        .update(entities)
        .set({
          status: accepting ? "locked" : "discarded",
          lockedAt: accepting ? now : null,
          lockedBy: accepting ? userId : null,
          version: current.version + 1,
          updatedAt: now,
        })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!updatedEntity) {
        return "version_conflict";
      }
      const [updatedProposal] = await transaction
        .update(settingProposals)
        .set({
          status: accepting ? "accepted" : "rejected",
          decidedBy: userId,
          decidedAt: now,
          decisionReason: input.reason,
          decisionEvidence: input.evidence,
          decisionConflictType: input.conflictType,
        })
        .where(and(eq(settingProposals.id, proposal.id), eq(settingProposals.status, "pending")))
        .returning();
      if (!updatedProposal) {
        return "invalid_state";
      }
      const customFields =
        (await readCustomFieldValues(transaction, userId, context, [updatedEntity.id]))[
          updatedEntity.id
        ] ?? {};
      await this.appendVersion(
        transaction,
        userId,
        updatedEntity,
        headNodeId,
        accepting ? "setting.proposal.accepted" : "setting.proposal.rejected",
        input.reason,
        audit,
        customFields,
      );
      return updatedProposal;
    });
  }

  async listChangeRequests(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
  ): Promise<SettingChangeRequestRecord[]> {
    return this.withTenant(userId, async (transaction) =>
      transaction
        .select()
        .from(settingChangeRequests)
        .where(
          and(
            eq(settingChangeRequests.userId, userId),
            eq(settingChangeRequests.workId, context.workId),
            eq(settingChangeRequests.branchId, context.branchId),
            eq(settingChangeRequests.entityId, entityId),
          ),
        )
        .orderBy(asc(settingChangeRequests.createdAt)),
    );
  }

  async createChangeRequest(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    input: SettingChangeRequestCreateRequest,
    audit: SettingsAuditContext,
    idempotencyKey?: string,
  ): Promise<
    | "not_found"
    | "not_locked"
    | "version_conflict"
    | "invalid_data"
    | SettingWriteViolation
    | SettingChangeRequestRecord
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      if (idempotencyKey) {
        const [existing] = await transaction
          .select()
          .from(settingChangeRequests)
          .where(
            and(
              eq(settingChangeRequests.userId, userId),
              eq(settingChangeRequests.entityId, entityId),
              eq(settingChangeRequests.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          return existing;
        }
      }
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status !== "locked") {
        return "not_locked";
      }
      if (current.version !== input.version) {
        return "version_conflict";
      }
      const conflict = await findSettingConflict(
        transaction,
        userId,
        context,
        current.type,
        input.after.name ?? current.name,
        input.after.aliases ?? current.aliases,
        current.id,
      );
      if (conflict) {
        return conflict;
      }
      if (input.after.data) {
        const mergedData = { ...current.attributes, ...input.after.data };
        if (!settingDataSchemaForType(current.type).safeParse(mergedData).success) {
          return "invalid_data";
        }
      }
      const customFields =
        (await readCustomFieldValues(transaction, userId, context, [current.id]))[current.id] ?? {};
      const proposedCustomFields = await resolveCustomFieldWrite(
        transaction,
        userId,
        context,
        current.type,
        current.id,
        input.after.customFields,
      );
      if ("kind" in proposedCustomFields) {
        return proposedCustomFields;
      }
      const before = {
        name: current.name,
        aliases: current.aliases,
        summary: current.summary,
        description: current.description,
        tags: current.tags,
        data: current.attributes,
        customFields,
      };
      const after = {
        ...before,
        ...input.after,
        data: input.after.data
          ? { ...current.attributes, ...input.after.data }
          : current.attributes,
        customFields: proposedCustomFields.values,
      };
      const now = new Date();
      const [request] = await transaction
        .insert(settingChangeRequests)
        .values({
          id: uuidv7(),
          entityId: current.id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          entityVersion: current.version,
          title: input.title,
          reason: input.reason,
          before,
          after,
          status: "pending",
          conflictType: input.conflictType,
          evidence: input.evidence,
          idempotencyKey: idempotencyKey ?? null,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!request) {
        throw new Error("Failed to create setting change request");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "setting.change_requested",
        targetType: "setting",
        targetId: current.id,
        decision: "pending",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return request;
    });
  }

  async find(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
  ): Promise<SettingEntityRecord | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [entity] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .limit(1);
      return entity;
    });
  }

  async create(
    userId: string,
    context: SettingsWorkContext,
    input: SettingEntityCreateRequest,
    audit: SettingsAuditContext,
  ): Promise<SettingEntityRecord | SettingWriteViolation> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findSettingConflict(
        transaction,
        userId,
        context,
        input.type,
        input.name,
        input.aliases,
      );
      if (conflict) {
        return conflict;
      }
      const now = new Date();
      const entityId = uuidv7();
      const customFields = await resolveCustomFieldWrite(
        transaction,
        userId,
        context,
        input.type,
        entityId,
        input.customFields,
      );
      if ("kind" in customFields) {
        return customFields;
      }
      const [entity] = await transaction
        .insert(entities)
        .values({
          id: entityId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          type: input.type,
          name: input.name,
          aliases: input.aliases,
          summary: input.summary,
          description: input.description,
          attributes: input.data,
          tags: input.tags,
          status: "draft",
          source: "author",
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!entity) {
        throw new Error("Failed to create setting");
      }
      if (entity.type === "character") {
        await transaction.insert(characterProfiles).values({
          entityId: entity.id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          createdAt: now,
          updatedAt: now,
        });
      }
      await writeCustomFieldValues(
        transaction,
        userId,
        context,
        entity.id,
        customFields.values,
        customFields.definitions,
        now,
      );
      await this.appendVersion(
        transaction,
        userId,
        entity,
        headNodeId,
        "setting.created",
        "创建设定",
        audit,
        customFields.values,
      );
      return entity;
    });
  }

  async update(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    input: SettingEntityPatchRequest,
    audit: SettingsAuditContext,
  ): Promise<
    | "not_found"
    | "locked"
    | "proposed"
    | "discarded"
    | "version_conflict"
    | SettingWriteViolation
    | SettingEntityRecord
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status === "locked") {
        return "locked";
      }
      if (current.status === "proposed") {
        return "proposed";
      }
      if (current.status === "discarded") {
        return "discarded";
      }
      if (current.version !== input.version) {
        return "version_conflict";
      }
      const conflict = await findSettingConflict(
        transaction,
        userId,
        context,
        current.type,
        input.name ?? current.name,
        input.aliases ?? current.aliases,
        current.id,
      );
      if (conflict) {
        return conflict;
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const customFields = await resolveCustomFieldWrite(
        transaction,
        userId,
        context,
        current.type,
        current.id,
        input.customFields,
      );
      if ("kind" in customFields) {
        return customFields;
      }
      const now = new Date();
      const [updated] = await transaction
        .update(entities)
        .set({
          name: input.name ?? current.name,
          aliases: input.aliases ?? current.aliases,
          summary: input.summary ?? current.summary,
          description: input.description ?? current.description,
          tags: input.tags ?? current.tags,
          attributes: input.data ? { ...current.attributes, ...input.data } : current.attributes,
          status: "draft",
          version: current.version + 1,
          updatedAt: now,
        })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await writeCustomFieldValues(
        transaction,
        userId,
        context,
        updated.id,
        customFields.values,
        customFields.definitions,
        now,
      );
      await this.appendVersion(
        transaction,
        userId,
        updated,
        headNodeId,
        "setting.updated",
        "编辑设定",
        audit,
        customFields.values,
      );
      return updated;
    });
  }

  async lock(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    expectedVersion: number,
    audit: SettingsAuditContext,
  ): Promise<
    "not_found" | "locked" | "proposed" | "discarded" | "version_conflict" | SettingEntityRecord
  > {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status === "locked") {
        return "locked";
      }
      if (current.status === "proposed") {
        return "proposed";
      }
      if (current.status === "discarded") {
        return "discarded";
      }
      if (current.version !== expectedVersion) {
        return "version_conflict";
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const [locked] = await transaction
        .update(entities)
        .set({
          status: "locked",
          lockedAt: now,
          lockedBy: userId,
          version: current.version + 1,
          updatedAt: now,
        })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!locked) {
        return "version_conflict";
      }
      const customFields =
        (await readCustomFieldValues(transaction, userId, context, [locked.id]))[locked.id] ?? {};
      await this.appendVersion(
        transaction,
        userId,
        locked,
        headNodeId,
        "setting.locked",
        "锁定设定",
        audit,
        customFields,
      );
      return locked;
    });
  }

  async remove(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    audit: SettingsAuditContext,
  ): Promise<"not_found" | "locked" | "proposed" | "discarded" | SettingEntityRecord> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const [current] = await transaction
        .select()
        .from(entities)
        .where(
          and(
            eq(entities.id, entityId),
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.status === "locked") {
        return "locked";
      }
      if (current.status === "proposed") {
        return "proposed";
      }
      if (current.status === "discarded") {
        return "discarded";
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const [removed] = await transaction
        .update(entities)
        .set({
          status: "discarded",
          version: current.version + 1,
          deletedAt: now,
          updatedAt: now,
        })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!removed) {
        throw new Error("Setting changed while it was being deleted");
      }
      const customFields =
        (await readCustomFieldValues(transaction, userId, context, [removed.id]))[removed.id] ?? {};
      await this.appendVersion(
        transaction,
        userId,
        removed,
        headNodeId,
        "setting.deleted",
        "删除设定",
        audit,
        customFields,
      );
      return removed;
    });
  }

  private async appendVersion(
    transaction: DatabaseTransaction,
    userId: string,
    entity: SettingEntityRecord,
    parentNodeId: string,
    action: string,
    message: string,
    audit: SettingsAuditContext,
    customFields: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date();
    const entityVersionId = uuidv7();
    const versionNodeId = uuidv7();
    const [characterProfile] =
      entity.type === "character"
        ? await transaction
            .select()
            .from(characterProfiles)
            .where(eq(characterProfiles.entityId, entity.id))
            .limit(1)
        : [];
    const snapshot = {
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
      summary: entity.summary,
      description: entity.description,
      attributes: entity.attributes,
      tags: entity.tags,
      customFields,
      status: entity.status,
      source: entity.source,
      version: entity.version,
      lockedAt: entity.lockedAt?.toISOString() ?? null,
      lockedBy: entity.lockedBy,
      ...(characterProfile
        ? {
            characterProfile: {
              desire: characterProfile.desire,
              fear: characterProfile.fear,
              goal: characterProfile.goal,
              voiceSample: characterProfile.voiceSample,
              voiceGuide: characterProfile.voiceGuide,
              disguise: characterProfile.disguise,
            },
          }
        : {}),
    };
    await transaction.insert(versionNodes).values({
      id: versionNodeId,
      workId: entity.workId,
      branchId: entity.branchId,
      userId,
      parentNodeId,
      nodeType: "entity_version",
      objectType: "setting",
      objectId: entity.id,
      objectVersion: entity.version,
      snapshotId: entityVersionId,
      payload: snapshot,
      actorId: userId,
      message,
      createdAt: now,
    });
    await transaction.insert(entityVersions).values({
      id: entityVersionId,
      entityId: entity.id,
      workId: entity.workId,
      branchId: entity.branchId,
      userId,
      version: entity.version,
      snapshot,
      versionNodeId,
      createdBy: userId,
      createdAt: now,
    });
    await transaction
      .update(workBranches)
      .set({ headNodeId: versionNodeId, updatedAt: now })
      .where(eq(workBranches.id, entity.branchId));
    await transaction.insert(auditLogs).values({
      id: uuidv7(),
      actorId: userId,
      action,
      targetType: "setting",
      targetId: entity.id,
      decision: "allowed",
      correlationId: audit.requestId,
      ip: audit.ip,
      userAgent: audit.userAgent,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (transaction: DatabaseTransaction) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: SettingsWorkContext,
): Promise<string> {
  const [branch] = await transaction
    .select()
    .from(workBranches)
    .where(
      and(
        eq(workBranches.id, context.branchId),
        eq(workBranches.workId, context.workId),
        eq(workBranches.userId, userId),
      ),
    )
    .for("update")
    .limit(1);
  if (!branch?.headNodeId) {
    throw new Error("Settings branch is missing its version head");
  }
  return branch.headNodeId;
}

async function findSettingConflict(
  transaction: DatabaseTransaction,
  userId: string,
  context: SettingsWorkContext,
  type: string,
  name: string,
  aliases: string[],
  excludeEntityId?: string,
): Promise<SettingWriteConflict | undefined> {
  const normalizedName = normalizeSettingIdentifier(name);
  const normalizedAliases = aliases.map(normalizeSettingIdentifier);
  if (new Set(normalizedAliases).size !== normalizedAliases.length) {
    return {
      kind: "alias_conflict",
      entityId: excludeEntityId ?? "",
      value: aliases[0] ?? "",
    };
  }
  if (normalizedAliases.includes(normalizedName)) {
    return { kind: "alias_conflict", entityId: excludeEntityId ?? "", value: name };
  }

  const candidates = await transaction
    .select({
      id: entities.id,
      type: entities.type,
      name: entities.name,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        sql`${entities.deletedAt} is null`,
        excludeEntityId ? ne(entities.id, excludeEntityId) : undefined,
      ),
    );

  for (const candidate of candidates) {
    const candidateName = normalizeSettingIdentifier(candidate.name);
    const candidateAliases = candidate.aliases.map(normalizeSettingIdentifier);
    if (candidateName === normalizedName && candidate.type === type) {
      return { kind: "name_conflict", entityId: candidate.id, value: candidate.name };
    }
    if (candidateAliases.includes(normalizedName)) {
      return { kind: "alias_conflict", entityId: candidate.id, value: candidate.name };
    }
    for (const [index, alias] of aliases.entries()) {
      const normalizedAlias = normalizedAliases[index]!;
      if (candidateName === normalizedAlias || candidateAliases.includes(normalizedAlias)) {
        return { kind: "alias_conflict", entityId: candidate.id, value: alias };
      }
    }
  }
  return undefined;
}

async function readCustomFieldValues(
  transaction: DatabaseTransaction,
  userId: string,
  context: SettingsWorkContext,
  entityIds?: string[],
): Promise<EntityCustomFieldValues> {
  if (entityIds?.length === 0) {
    return {};
  }
  const rows = await transaction
    .select({
      entityId: customFieldValues.entityId,
      key: customFieldDefinitions.key,
      value: customFieldValues.value,
    })
    .from(customFieldValues)
    .innerJoin(
      customFieldDefinitions,
      eq(customFieldDefinitions.id, customFieldValues.fieldDefinitionId),
    )
    .where(
      and(
        eq(customFieldValues.userId, userId),
        eq(customFieldValues.workId, context.workId),
        eq(customFieldValues.branchId, context.branchId),
        entityIds ? inArray(customFieldValues.entityId, entityIds) : undefined,
      ),
    );
  const values: EntityCustomFieldValues = {};
  for (const row of rows) {
    values[row.entityId] = { ...values[row.entityId], [row.key]: row.value };
  }
  return values;
}

async function resolveCustomFieldWrite(
  transaction: DatabaseTransaction,
  userId: string,
  context: SettingsWorkContext,
  entityType: string,
  entityId: string,
  patch: Record<string, unknown> | undefined,
): Promise<
  | { values: Record<string, unknown>; definitions: CustomFieldDefinitionRecord[] }
  | SettingWriteValidationError
> {
  const definitions = await transaction
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.userId, userId),
        eq(customFieldDefinitions.workId, context.workId),
        eq(customFieldDefinitions.branchId, context.branchId),
      ),
    );
  const existing = (await readCustomFieldValues(transaction, userId, context, [entityId]))[
    entityId
  ];
  if (patch === undefined) {
    return { values: existing ?? {}, definitions };
  }

  const values = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    const definition = definitions.find((candidate) => candidate.key === key);
    if (!definition) {
      return customFieldInvalid(key, "自定义字段不存在");
    }
    if (!definition.enabled) {
      if (sameCustomFieldValue(existing?.[key], value)) {
        continue;
      }
      return customFieldInvalid(key, "自定义字段已停用");
    }
    if (definition.appliesTo !== "all" && definition.appliesTo !== entityType) {
      return customFieldInvalid(key, "自定义字段不适用于当前设定类型");
    }
    if (value === null) {
      if (definition.required) {
        return customFieldRequired(key, "必填自定义字段不能清空");
      }
      delete values[key];
      continue;
    }
    const normalized = await normalizeCustomFieldValueForEntity(
      transaction,
      userId,
      context,
      definition,
      value,
    );
    if (!normalized.ok) {
      return customFieldInvalid(key, normalized.message);
    }
    values[key] = normalized.value;
  }

  const applicable = definitions.filter(
    (definition) =>
      definition.enabled && (definition.appliesTo === "all" || definition.appliesTo === entityType),
  );
  for (const definition of applicable) {
    const value = values[definition.key];
    if (definition.required && isBlankCustomFieldValue(value)) {
      return customFieldRequired(definition.key, "缺少必填自定义字段");
    }
    if (value !== undefined && value !== null) {
      const normalized = await normalizeCustomFieldValueForEntity(
        transaction,
        userId,
        context,
        definition,
        value,
      );
      if (!normalized.ok) {
        return customFieldInvalid(definition.key, normalized.message);
      }
      values[definition.key] = normalized.value;
    }
  }
  return { values, definitions };
}

async function writeCustomFieldValues(
  transaction: DatabaseTransaction,
  userId: string,
  context: SettingsWorkContext,
  entityId: string,
  values: Record<string, unknown>,
  definitions: CustomFieldDefinitionRecord[],
  now: Date,
): Promise<void> {
  await transaction
    .delete(customFieldValues)
    .where(and(eq(customFieldValues.userId, userId), eq(customFieldValues.entityId, entityId)));
  const rows = Object.entries(values).flatMap(([key, value]) => {
    const definition = definitions.find((candidate) => candidate.key === key);
    if (!definition) {
      return [];
    }
    return [
      {
        id: uuidv7(),
        fieldDefinitionId: definition.id,
        entityId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        value,
        createdAt: now,
        updatedAt: now,
      },
    ];
  });
  if (rows.length > 0) {
    await transaction.insert(customFieldValues).values(rows);
  }
}

function normalizeCustomFieldValue(
  definition: CustomFieldDefinitionRecord,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; message: string } {
  if (definition.fieldType === "text" || definition.fieldType === "long_text") {
    if (typeof value !== "string" || value.trim().length === 0) {
      return { ok: false, message: "请输入文本" };
    }
    return { ok: true, value: value.trim() };
  }
  if (definition.fieldType === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, message: "请输入有效数字" };
    }
    return { ok: true, value };
  }
  if (definition.fieldType === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
      return { ok: false, message: "请输入有效日期" };
    }
    return { ok: true, value };
  }
  if (definition.fieldType === "boolean") {
    if (typeof value !== "boolean") {
      return { ok: false, message: "请选择是或否" };
    }
    return { ok: true, value };
  }
  if (definition.fieldType === "single_select") {
    if (typeof value !== "string" || !definition.options.includes(value)) {
      return { ok: false, message: "请选择有效选项" };
    }
    return { ok: true, value };
  }
  if (definition.fieldType === "multi_select") {
    if (
      !Array.isArray(value) ||
      value.some((item) => typeof item !== "string" || !definition.options.includes(item)) ||
      new Set(value).size !== value.length
    ) {
      return { ok: false, message: "请选择有效选项" };
    }
    return { ok: true, value };
  }
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    return { ok: false, message: "请选择有效引用" };
  }
  return { ok: true, value };
}

async function normalizeCustomFieldValueForEntity(
  transaction: DatabaseTransaction,
  userId: string,
  context: SettingsWorkContext,
  definition: CustomFieldDefinitionRecord,
  value: unknown,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const normalized = normalizeCustomFieldValue(definition, value);
  if (!normalized.ok || definition.fieldType !== "relation_ref") {
    return normalized;
  }
  const [target] = await transaction
    .select({ id: entities.id, type: entities.type })
    .from(entities)
    .where(
      and(
        eq(entities.id, String(normalized.value)),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        sql`${entities.deletedAt} is null`,
        sql`${entities.status} <> 'discarded'`,
      ),
    )
    .limit(1);
  if (!target) {
    return { ok: false, message: "关系引用目标不存在" };
  }
  if (definition.relationTarget && target.type !== definition.relationTarget) {
    return { ok: false, message: "关系引用目标类型不匹配" };
  }
  return normalized;
}

function settingDataSchemaForType(type: string) {
  switch (type) {
    case "character":
      return characterDataSchema;
    case "faction":
      return factionDataSchema;
    case "map":
      return mapDataSchema;
    case "power_system":
      return powerSystemDataSchema;
    case "golden_finger":
      return goldenFingerDataSchema;
    case "item":
      return itemDataSchema;
    case "timeline_event":
      return timelineEventDataSchema;
    default:
      return worldRuleDataSchema;
  }
}

function customFieldRequired(fieldKey: string, message: string): SettingWriteValidationError {
  return { kind: "custom_field_required", fieldKey, message };
}

function isBlankCustomFieldValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function sameCustomFieldValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function customFieldInvalid(fieldKey: string, message: string): SettingWriteValidationError {
  return { kind: "custom_field_invalid", fieldKey, message };
}

function validCustomFieldDefinitionShape(
  fieldType: string,
  options: string[],
  relationTarget: string | null,
): boolean {
  const selectField = fieldType === "single_select" || fieldType === "multi_select";
  if (selectField !== options.length > 0 || new Set(options).size !== options.length) {
    return false;
  }
  if (fieldType === "relation_ref") {
    return relationTarget !== null;
  }
  return relationTarget === null;
}

function normalizeSettingIdentifier(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
