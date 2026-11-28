import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  chapters,
  createDatabaseClient,
  createDatabasePool,
  characterProfiles,
  entities,
  entityVersions,
  factionProfiles,
  findIdempotentResource,
  genrePacks,
  itemTechniques,
  jobs,
  mapLayers,
  modelConfigs,
  notifications,
  outlineNodes,
  powerSystems,
  rememberIdempotentResource,
  sceneCards,
  specialMechanisms,
  storyBibleVersions,
  storyBibleWorldRules,
  storyBibles,
  timelineEvents,
  versionNodes,
  volumeContracts,
  workBlueprints,
  workBranches,
  works,
  type DatabaseClient,
  type DatabaseTransaction,
} from "@novel-brain/db";
import {
  blueprintAcknowledgementSchema,
  blueprintBudgetSchema,
  blueprintCoreSettingDraftSchema,
  blueprintCostSchema,
  blueprintDraftSchema,
  blueprintOutlineDraftSchema,
  blueprintStoryBibleDraftSchema,
  type BlueprintAcknowledgement,
  type BlueprintConfirmRequest,
  type BlueprintBudgetUpdateRequest,
  type BlueprintCancelRequest,
  type BlueprintDraftPatchRequest,
  type GenerateBlueprintJob,
} from "@novel-brain/contracts";
import { validateBlueprintCandidates } from "@novel-brain/core";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { applyDraftPatch, blueprintDraftHash } from "./blueprint.draft";
import type { BlueprintAuditContext } from "./blueprint.types";
import { acknowledgementSignature, validateBlueprintForConfirmation } from "./blueprint-validation";

export type WorkBlueprintRecord = InferSelectModel<typeof workBlueprints>;
export type BlueprintJobRecord = InferSelectModel<typeof jobs>;

export type BlueprintLookup =
  | { kind: "forbidden" }
  | { kind: "missing" }
  | { kind: "ok"; blueprint: WorkBlueprintRecord; job: BlueprintJobRecord };

@Injectable()
export class BlueprintRepository implements OnModuleDestroy {
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

  async preferredModelConfigId(userId: string): Promise<string | null> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: modelConfigs.id, purposes: modelConfigs.purposes })
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)))
        .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt));
      return rows.find((row) => row.purposes.includes("planning"))?.id ?? null;
    });
  }

  async find(userId: string, workId: string, branchId: string): Promise<BlueprintLookup> {
    return this.withTenant(userId, async (transaction) => {
      const [scope] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
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
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!scope) {
        return { kind: "forbidden" };
      }

      const [row] = await transaction
        .select({ blueprint: workBlueprints, job: jobs })
        .from(workBlueprints)
        .innerJoin(jobs, eq(jobs.id, workBlueprints.jobId))
        .where(
          and(
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .limit(1);
      return row ? { kind: "ok", ...row } : { kind: "missing" };
    });
  }

  async requeuePayload(
    userId: string,
    workId: string,
    branchId: string,
    allowRecovery = false,
    audit?: BlueprintAuditContext,
  ): Promise<GenerateBlueprintJob | null> {
    return this.withTenant(userId, async (transaction) => {
      const [scope] = await transaction
        .select({ workId: works.id, branchId: workBranches.id })
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
            isNull(works.deletedAt),
          ),
        )
        .limit(1);
      if (!scope) {
        return null;
      }
      const [row] = await transaction
        .select({ blueprint: workBlueprints, job: jobs })
        .from(workBlueprints)
        .innerJoin(jobs, eq(jobs.id, workBlueprints.jobId))
        .where(
          and(
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!row) {
        return null;
      }
      const recoverable = ["queued", "failed", "waiting_model_config"];
      if (
        !recoverable.includes(row.blueprint.status) ||
        (!allowRecovery && row.blueprint.status !== "queued")
      ) {
        return null;
      }

      let modelConfigId = row.job.modelConfigId;
      if (row.blueprint.status === "waiting_model_config") {
        const configs = await transaction
          .select({ id: modelConfigs.id, purposes: modelConfigs.purposes })
          .from(modelConfigs)
          .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)))
          .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt));
        modelConfigId = configs.find((config) => config.purposes.includes("planning"))?.id ?? null;
      }

      if (row.blueprint.status !== "queued") {
        await transaction.execute(
          sql`UPDATE jobs
                 SET status = 'queued', model_config_id = ${modelConfigId},
                     error_code = NULL, error_message = NULL,
                     finished_at = NULL, updated_at = now()
               WHERE id = ${row.job.id} AND user_id = ${userId}`,
        );
        await transaction.execute(
          sql`UPDATE work_blueprints
                 SET status = 'queued', updated_at = now()
               WHERE id = ${row.blueprint.id} AND user_id = ${userId}`,
        );
      }
      if (audit) {
        await transaction.insert(auditLogs).values({
          id: uuidv7(),
          actorId: userId,
          action: "blueprint.retried",
          targetType: "work_blueprint",
          targetId: row.blueprint.id,
          decision: "allowed",
          correlationId: audit.requestId,
          ip: audit.ip,
          userAgent: audit.userAgent,
        });
      }
      return {
        jobId: row.job.id,
        jobType: "generate_blueprint",
        workId: row.job.workId,
        branchId: row.job.branchId,
        actorId: row.job.userId,
        modelConfigId,
        idempotencyKey: row.job.idempotencyKey,
        budget: row.job.budget as GenerateBlueprintJob["budget"],
        checkpoint: row.job.checkpoint as GenerateBlueprintJob["checkpoint"],
      };
    });
  }

  async patchDraft(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintDraftPatchRequest,
    audit: BlueprintAuditContext,
  ): Promise<
    | "forbidden"
    | "missing"
    | "not_reviewable"
    | "version_conflict"
    | "invalid_patch"
    | "required_removal"
    | WorkBlueprintRecord
  > {
    const lookup = await this.find(userId, workId, branchId);
    if (lookup.kind !== "ok") {
      return lookup.kind;
    }
    return this.withTenant(userId, async (transaction) => {
      const [current] = await transaction
        .select()
        .from(workBlueprints)
        .where(
          and(
            eq(workBlueprints.id, lookup.blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!current) {
        return "missing";
      }
      if (current.status !== "waiting_review") {
        return "not_reviewable";
      }
      if (current.version !== input.expectedVersion) {
        return "version_conflict";
      }
      const storyBible = blueprintStoryBibleDraftSchema.safeParse(current.storyBibleDraft);
      const coreSettings = blueprintCoreSettingDraftSchema
        .array()
        .safeParse(current.coreSettingsDraft);
      const outline = blueprintOutlineDraftSchema.safeParse(current.outlineDraft);
      const acknowledgements = blueprintAcknowledgementSchema
        .array()
        .safeParse(current.acknowledgements);
      if (
        !storyBible.success ||
        !coreSettings.success ||
        !outline.success ||
        !acknowledgements.success
      ) {
        return "not_reviewable";
      }
      const draft = blueprintDraftSchema.safeParse({
        storyBible: storyBible.data,
        coreSettings: coreSettings.data,
        outline: outline.data,
      });
      if (!draft.success) {
        return "not_reviewable";
      }
      const patched = applyDraftPatch(draft.data, acknowledgements.data, input.operations);
      if (!patched.ok) {
        return patched.reason;
      }
      const validationContext = await blueprintValidationContext(transaction, userId, workId);
      if (!validationContext) {
        return "missing";
      }
      const validation = validateBlueprintCandidates({
        ...patched.draft,
        ...validationContext,
      });
      const now = new Date();
      const [updated] = await transaction
        .update(workBlueprints)
        .set({
          version: current.version + 1,
          storyBibleDraft: patched.draft.storyBible,
          coreSettingsDraft: patched.draft.coreSettings,
          outlineDraft: patched.draft.outline,
          acknowledgements: patched.acknowledgements,
          missingFields: validation.missingFields,
          conflicts: validation.conflicts,
          draftHash: patched.draftHash,
          updatedAt: now,
        })
        .where(
          and(
            eq(workBlueprints.id, current.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.version, current.version),
          ),
        )
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "blueprint.draft_edited",
        targetType: "work_blueprint",
        targetId: current.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return updated;
    });
  }

  async updateBudget(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintBudgetUpdateRequest,
    audit: BlueprintAuditContext,
  ): Promise<
    | "forbidden"
    | "missing"
    | "not_paused"
    | "version_conflict"
    | "invalid_budget"
    | GenerateBlueprintJob
  > {
    const lookup = await this.find(userId, workId, branchId);
    if (lookup.kind !== "ok") {
      return lookup.kind;
    }
    return this.withTenant(userId, async (transaction) => {
      const [blueprint] = await transaction
        .select()
        .from(workBlueprints)
        .where(
          and(
            eq(workBlueprints.id, lookup.blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!blueprint) {
        return "missing";
      }
      if (blueprint.status !== "budget_paused") {
        return "not_paused";
      }
      if (blueprint.version !== input.expectedVersion) {
        return "version_conflict";
      }
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, blueprint.jobId), eq(jobs.userId, userId)))
        .for("update")
        .limit(1);
      if (!job) {
        return "missing";
      }
      const currentBudget = blueprintBudgetSchema.parse(job.budget);
      const cost = blueprintCostSchema.parse(job.cost);
      const increased =
        input.maxTokens > currentBudget.maxTokens || input.maxCostCny > currentBudget.maxCostCny;
      const decreased =
        input.maxTokens < currentBudget.maxTokens || input.maxCostCny < currentBudget.maxCostCny;
      if (
        !increased ||
        decreased ||
        input.maxTokens <= cost.totalTokens ||
        input.maxCostCny <= cost.costCny
      ) {
        return "invalid_budget";
      }
      const budget = { maxTokens: input.maxTokens, maxCostCny: input.maxCostCny };
      const now = new Date();
      await transaction
        .update(jobs)
        .set({
          status: "queued",
          budget,
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.userId, userId)));
      const [updated] = await transaction
        .update(workBlueprints)
        .set({
          status: "queued",
          version: blueprint.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(workBlueprints.id, blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.version, blueprint.version),
          ),
        )
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "blueprint.budget_updated",
        targetType: "work_blueprint",
        targetId: blueprint.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return {
        jobId: job.id,
        jobType: "generate_blueprint" as const,
        workId: job.workId,
        branchId: job.branchId,
        actorId: job.userId,
        modelConfigId: job.modelConfigId,
        idempotencyKey: job.idempotencyKey,
        budget,
        checkpoint: job.checkpoint as GenerateBlueprintJob["checkpoint"],
      };
    });
  }

  async cancel(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintCancelRequest,
    audit: BlueprintAuditContext,
  ): Promise<"forbidden" | "missing" | "not_cancellable" | "version_conflict" | { jobId: string }> {
    const lookup = await this.find(userId, workId, branchId);
    if (lookup.kind !== "ok") {
      return lookup.kind;
    }
    return this.withTenant(userId, async (transaction) => {
      const [blueprint] = await transaction
        .select()
        .from(workBlueprints)
        .where(
          and(
            eq(workBlueprints.id, lookup.blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!blueprint) {
        return "missing";
      }
      if (
        !["queued", "running", "waiting_model_config", "budget_paused", "waiting_review"].includes(
          blueprint.status,
        )
      ) {
        return "not_cancellable";
      }
      if (blueprint.version !== input.expectedVersion) {
        return "version_conflict";
      }
      const now = new Date();
      const [updated] = await transaction
        .update(workBlueprints)
        .set({
          status: "cancelled",
          version: blueprint.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(workBlueprints.id, blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.version, blueprint.version),
          ),
        )
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await transaction
        .update(jobs)
        .set({
          status: "cancelled",
          finishedAt: now,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, blueprint.jobId), eq(jobs.userId, userId)));
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "blueprint.cancelled",
        targetType: "work_blueprint",
        targetId: blueprint.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { jobId: blueprint.jobId };
    });
  }

  async confirm(
    userId: string,
    workId: string,
    branchId: string,
    input: BlueprintConfirmRequest,
    idempotencyKey: string | undefined,
    audit: BlueprintAuditContext,
  ): Promise<
    | "forbidden"
    | "missing"
    | "not_reviewable"
    | "version_conflict"
    | "p0_conflict"
    | "required_field_missing"
    | "invalid_draft"
    | { kind: "confirmed"; blueprint: WorkBlueprintRecord }
  > {
    const lookup = await this.find(userId, workId, branchId);
    if (lookup.kind !== "ok") {
      return lookup.kind;
    }
    const scope = `blueprint-confirm:${workId}:${branchId}`;
    const normalizedIdempotencyKey = idempotencyKey?.trim() || input.draftHash;

    return this.withTenant(userId, async (transaction) => {
      const existingResource = await findIdempotentResource(
        transaction,
        userId,
        scope,
        normalizedIdempotencyKey,
      );
      if (existingResource && existingResource.resourceId !== lookup.blueprint.id) {
        return "version_conflict";
      }

      const [blueprint] = await transaction
        .select()
        .from(workBlueprints)
        .where(
          and(
            eq(workBlueprints.id, lookup.blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.workId, workId),
            eq(workBlueprints.branchId, branchId),
          ),
        )
        .for("update")
        .limit(1);
      if (!blueprint) {
        return "missing";
      }

      const storedDraft = blueprintDraftSchema.safeParse({
        storyBible: blueprint.storyBibleDraft,
        coreSettings: blueprint.coreSettingsDraft,
        outline: blueprint.outlineDraft,
      });
      const storedAcknowledgements = blueprintAcknowledgementSchema
        .array()
        .safeParse(blueprint.acknowledgements);
      if (!storedDraft.success || !storedAcknowledgements.success) {
        return "invalid_draft";
      }
      const storedHash =
        blueprint.draftHash ?? blueprintDraftHash(storedDraft.data, storedAcknowledgements.data);

      if (
        blueprint.status === "confirmed" &&
        blueprint.version === input.expectedVersion &&
        storedHash === input.draftHash &&
        sameAcknowledgements(storedAcknowledgements.data, input.acknowledgements)
      ) {
        return { kind: "confirmed", blueprint };
      }
      if (blueprint.status === "confirmed") {
        return "version_conflict";
      }
      if (blueprint.status !== "waiting_review") {
        return "not_reviewable";
      }
      if (blueprint.version !== input.expectedVersion || storedHash !== input.draftHash) {
        return "version_conflict";
      }

      const validationContext = await blueprintValidationContext(transaction, userId, workId);
      if (!validationContext) {
        return "missing";
      }
      const validation = validateBlueprintForConfirmation({
        storyBibleDraft: blueprint.storyBibleDraft,
        coreSettingsDraft: blueprint.coreSettingsDraft,
        outlineDraft: blueprint.outlineDraft,
        storedAcknowledgements: blueprint.acknowledgements,
        submittedAcknowledgements: input.acknowledgements,
        ...validationContext,
      });
      if (!validation.ok) {
        if (validation.code === "p0_conflict") {
          return "p0_conflict";
        }
        if (validation.code === "required_field_missing") {
          return "required_field_missing";
        }
        return "invalid_draft";
      }

      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`blueprint-confirm:${branchId}`}))`,
      );
      const [branch] = await transaction
        .select()
        .from(workBranches)
        .where(
          and(
            eq(workBranches.id, branchId),
            eq(workBranches.workId, workId),
            eq(workBranches.userId, userId),
          ),
        )
        .for("update")
        .limit(1);
      if (!branch?.headNodeId) {
        return "missing";
      }
      const [job] = await transaction
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, blueprint.jobId), eq(jobs.userId, userId)))
        .for("update")
        .limit(1);
      if (!job) {
        return "missing";
      }

      const now = new Date();
      const draft = validation.draft;
      let parentNodeId = branch.headNodeId;

      const storyBibleId = uuidv7();
      const storyBibleVersionId = uuidv7();
      const storyBibleNodeId = uuidv7();
      const worldRules =
        draft.storyBible.cards.find((card) => card.key === "worldLaws")?.worldRules ?? [];
      const worldRuleIds = new Map(worldRules.map((rule) => [rule.id, uuidv7()] as const));
      const persistedCards = draft.storyBible.cards.map((card) =>
        card.key === "worldLaws"
          ? {
              ...card,
              worldRules: card.worldRules.map((rule) => ({
                ...rule,
                id: worldRuleIds.get(rule.id)!,
              })),
            }
          : card,
      );
      await transaction.insert(storyBibles).values({
        id: storyBibleId,
        workId,
        branchId,
        userId,
        version: 1,
        status: "locked",
        cards: persistedCards,
        lockedAt: now,
        lockedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(versionNodes).values({
        id: storyBibleNodeId,
        workId,
        branchId,
        userId,
        parentNodeId,
        nodeType: "story_bible_version",
        objectType: "story_bible",
        objectId: storyBibleId,
        objectVersion: 1,
        snapshotId: storyBibleVersionId,
        payload: {
          action: "locked",
          reason: "确认故事蓝图",
          cards: persistedCards,
          sourceBlueprintId: blueprint.id,
        },
        actorId: userId,
        message: "确认故事蓝图",
        createdAt: now,
      });
      await transaction.insert(storyBibleVersions).values({
        id: storyBibleVersionId,
        storyBibleId,
        workId,
        branchId,
        userId,
        version: 1,
        cards: persistedCards,
        readiness: { ready: true, completed: 9, source: "blueprint_confirmation" },
        action: "locked",
        reason: "确认故事蓝图",
        versionNodeId: storyBibleNodeId,
        createdBy: userId,
        createdAt: now,
      });
      parentNodeId = storyBibleNodeId;

      if (worldRules.length > 0) {
        await transaction.insert(storyBibleWorldRules).values(
          worldRules.map((rule) => ({
            id: worldRuleIds.get(rule.id)!,
            storyBibleVersionId,
            storyBibleId,
            workId,
            branchId,
            userId,
            name: rule.name,
            constraint: rule.constraint,
            scope: rule.scope,
            exceptions: rule.exceptions,
            createdAt: now,
          })),
        );
      }

      const entityIdsByType = new Map<string, string>();
      for (const [candidateIndex, candidate] of draft.coreSettings.entries()) {
        const entityId = uuidv7();
        const entityVersionId = uuidv7();
        const entityNodeId = uuidv7();
        entityIdsByType.set(candidate.type, entityId);
        await transaction.insert(entities).values({
          id: entityId,
          workId,
          branchId,
          userId,
          type: candidate.type,
          name: candidate.name,
          aliases: candidate.aliases,
          summary: candidate.summary,
          description: candidate.description,
          attributes: candidate.data,
          tags: candidate.tags,
          status: "locked",
          source: "ai",
          version: 1,
          lockedAt: now,
          lockedBy: userId,
          createdAt: now,
          updatedAt: now,
        });
        const snapshot = {
          type: candidate.type,
          name: candidate.name,
          aliases: candidate.aliases,
          summary: candidate.summary,
          description: candidate.description,
          attributes: candidate.data,
          tags: candidate.tags,
          status: "locked",
          source: "ai",
          version: 1,
          lockedAt: now.toISOString(),
          lockedBy: userId,
        };
        await transaction.insert(versionNodes).values({
          id: entityNodeId,
          workId,
          branchId,
          userId,
          parentNodeId,
          nodeType: "entity_version",
          objectType: "entity",
          objectId: entityId,
          objectVersion: 1,
          snapshotId: entityVersionId,
          payload: snapshot,
          actorId: userId,
          message: `确认核心设定：${candidate.name}`,
          createdAt: now,
        });
        await transaction.insert(entityVersions).values({
          id: entityVersionId,
          entityId,
          workId,
          branchId,
          userId,
          version: 1,
          snapshot,
          versionNodeId: entityNodeId,
          createdBy: userId,
          createdAt: now,
        });
        const stringAttribute = (key: string, fallback = ""): string =>
          typeof candidate.data[key] === "string" ? candidate.data[key] : fallback;
        switch (candidate.type) {
          case "character":
            await transaction.insert(characterProfiles).values({
              entityId,
              workId,
              branchId,
              userId,
              desire: stringAttribute("desire"),
              fear: stringAttribute("fear"),
              goal: stringAttribute("goal"),
              voiceSample: stringAttribute("voiceSample"),
              voiceGuide: stringAttribute("voiceGuide", candidate.summary),
              disguise: stringAttribute("disguise"),
              createdAt: now,
              updatedAt: now,
            });
            break;
          case "faction":
            await transaction.insert(factionProfiles).values({
              entityId,
              workId,
              branchId,
              userId,
              overview: stringAttribute("overview", candidate.summary),
              goals: stringAttribute("goals"),
              resources: stringAttribute("resources"),
              doctrine: stringAttribute("doctrine"),
              createdAt: now,
              updatedAt: now,
            });
            break;
          case "map":
            await transaction.insert(mapLayers).values({
              id: uuidv7(),
              workId,
              branchId,
              userId,
              mapId: entityId,
              name: "主图层",
              sortOrder: 0,
              validFromChapter: 1,
              versionNodeId: entityNodeId,
              createdBy: userId,
              createdAt: now,
            });
            break;
          case "power_system":
            await transaction.insert(powerSystems).values({
              entityId,
              workId,
              branchId,
              userId,
              overview: candidate.summary,
              lifespanMode: "none",
              createdAt: now,
              updatedAt: now,
            });
            break;
          case "golden_finger":
            await transaction.insert(specialMechanisms).values({
              entityId,
              workId,
              branchId,
              userId,
              mechanismType: "golden_finger",
              powerSystemId: entityIdsByType.get("power_system") ?? null,
              rules: stringAttribute("rules", candidate.summary),
              costs: stringAttribute("costs"),
              limits: stringAttribute("limits"),
              growth: stringAttribute("growth"),
              createdAt: now,
              updatedAt: now,
            });
            break;
          case "item":
            await transaction.insert(itemTechniques).values({
              entityId,
              workId,
              branchId,
              userId,
              kind: "item",
              category: stringAttribute("category", "blueprint"),
              grade: stringAttribute("grade"),
              effect: stringAttribute("effect", candidate.summary),
              cost: stringAttribute("cost"),
              limits: stringAttribute("limits"),
              ownershipModel: stringAttribute("ownershipModel") === "shared" ? "shared" : "unique",
              quantity: 1,
              createdAt: now,
              updatedAt: now,
            });
            break;
          case "timeline_event":
            await transaction.insert(timelineEvents).values({
              id: entityId,
              workId,
              branchId,
              userId,
              era: "story",
              storyTimeLabel: stringAttribute("time", `故事时间 ${candidateIndex + 1}`),
              storyTimeSortKey: candidateIndex + 1,
              eventText: stringAttribute("event", candidate.summary),
              validFromChapter: 1,
              versionNodeId: entityNodeId,
              createdBy: userId,
              createdAt: now,
            });
            break;
          case "world_rule":
            break;
        }
        parentNodeId = entityNodeId;
      }

      const chapterNodes = draft.outline.nodes.filter((node) => node.level === "chapter");
      const chapterIdsByNodeId = new Map(chapterNodes.map((node) => [node.id, uuidv7()] as const));
      if (chapterNodes.length > 0) {
        await transaction.insert(chapters).values(
          chapterNodes.map((node) => ({
            id: chapterIdsByNodeId.get(node.id)!,
            workId,
            branchId,
            userId,
            number: node.chapterNumber!,
            title: node.title,
            status: "planned",
            version: 1,
            brief: node.brief!,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      const bookRoot = draft.outline.nodes.find((node) => node.level === "book")!;
      const outlineIdsByDraftId = new Map(
        draft.outline.nodes.map((node) => [node.id, uuidv7()] as const),
      );
      const outlineNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: outlineNodeId,
        workId,
        branchId,
        userId,
        parentNodeId,
        nodeType: "outline_version",
        objectType: "outline",
        objectId: outlineIdsByDraftId.get(bookRoot.id)!,
        objectVersion: 1,
        payload: {
          sourceBlueprintId: blueprint.id,
          nodes: draft.outline.nodes,
          volumeContracts: draft.outline.volumeContracts,
          sceneCards: draft.outline.sceneCards,
        },
        actorId: userId,
        message: "确认初始大纲",
        createdAt: now,
      });
      parentNodeId = outlineNodeId;

      const levelOrder = { book: 0, volume: 1, act: 2, chapter: 3, scene: 4 } as const;
      const orderedNodes = [...draft.outline.nodes].sort(
        (left, right) => levelOrder[left.level] - levelOrder[right.level],
      );
      await transaction.insert(outlineNodes).values(
        orderedNodes.map((node) => ({
          id: outlineIdsByDraftId.get(node.id)!,
          workId,
          branchId,
          userId,
          level: node.level,
          parentId: node.parentId ? outlineIdsByDraftId.get(node.parentId)! : null,
          sortOrder: node.sortOrder,
          title: node.title,
          summary: node.summary,
          status: node.status,
          locked: false,
          version: 1,
          chapterId: chapterIdsByNodeId.get(node.id) ?? null,
          tension: node.tension,
          versionNodeId: outlineNodeId,
          createdAt: now,
          updatedAt: now,
        })),
      );

      if (draft.outline.volumeContracts.length > 0) {
        await transaction.insert(volumeContracts).values(
          draft.outline.volumeContracts.map((contract) => ({
            id: uuidv7(),
            nodeId: outlineIdsByDraftId.get(contract.nodeId)!,
            workId,
            branchId,
            userId,
            objective: contract.objective,
            conflict: contract.conflict,
            turningPoints: contract.turningPoints,
            exitConditions: contract.exitConditions,
            plotLines: contract.plotLines,
            version: 1,
            versionNodeId: outlineNodeId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }
      if (draft.outline.sceneCards.length > 0) {
        await transaction.insert(sceneCards).values(
          draft.outline.sceneCards.map((card, cardIndex) => ({
            id: uuidv7(),
            nodeId: outlineIdsByDraftId.get(card.nodeId)!,
            workId,
            branchId,
            userId,
            title: card.title,
            povLabel: card.povLabel,
            locationLabel: card.locationLabel,
            storyEra: "story",
            storyTimeLabel: card.storyTime,
            storySortKey: cardIndex,
            beats: card.beats.map((description, order) => ({
              id: uuidv7(),
              order,
              description,
            })),
            informationReleases: card.informationReleases.map((description, order) => ({
              id: uuidv7(),
              order,
              description,
              constraint: null,
            })),
            tension: card.tension,
            version: 1,
            versionNodeId: outlineNodeId,
            createdAt: now,
            updatedAt: now,
          })),
        );
      }

      const blueprintNodeId = uuidv7();
      await transaction.insert(versionNodes).values({
        id: blueprintNodeId,
        workId,
        branchId,
        userId,
        parentNodeId,
        nodeType: "blueprint_version",
        objectType: "work_blueprint",
        objectId: blueprint.id,
        objectVersion: 1,
        payload: {
          status: "confirmed",
          draftHash: storedHash,
          version: blueprint.version,
          acknowledgements: validation.acknowledgements,
        },
        actorId: userId,
        message: "确认故事蓝图",
        createdAt: now,
      });
      await transaction
        .update(workBranches)
        .set({ headNodeId: blueprintNodeId, updatedAt: now })
        .where(
          and(
            eq(workBranches.id, branchId),
            eq(workBranches.workId, workId),
            eq(workBranches.userId, userId),
          ),
        );
      await transaction
        .update(works)
        .set({ status: "preparing", updatedAt: now })
        .where(and(eq(works.id, workId), eq(works.userId, userId), eq(works.status, "draft")));
      await transaction
        .update(jobs)
        .set({
          status: "completed",
          progress: 100,
          currentStep: "await_review",
          finishedAt: now,
          updatedAt: now,
        })
        .where(and(eq(jobs.id, job.id), eq(jobs.userId, userId)));
      const [updated] = await transaction
        .update(workBlueprints)
        .set({
          status: "confirmed",
          draftHash: storedHash,
          acknowledgements: validation.acknowledgements,
          missingFields: validation.missingFields,
          conflicts: validation.conflicts,
          confirmedAt: now,
          confirmedBy: userId,
          progress: 100,
          currentStep: "await_review",
          updatedAt: now,
        })
        .where(
          and(
            eq(workBlueprints.id, blueprint.id),
            eq(workBlueprints.userId, userId),
            eq(workBlueprints.version, blueprint.version),
          ),
        )
        .returning();
      if (!updated) {
        throw new Error("Blueprint confirmation lost its row lock");
      }

      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "blueprint.confirmed",
        targetType: "work_blueprint",
        targetId: blueprint.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      await transaction
        .insert(notifications)
        .values({
          id: uuidv7(),
          userId,
          workId,
          branchId,
          type: "job_completed",
          targetType: "work",
          targetId: workId,
          payload: {
            title: "故事蓝图已确认",
            message: "故事蓝图已确认，可以开始写第一章。",
            href: `/workspace/${workId}/overview`,
          },
          dedupeKey: `blueprint-confirmed:${blueprint.id}:${storedHash}`,
          createdAt: now,
        })
        .onConflictDoNothing();
      await rememberIdempotentResource(transaction, userId, scope, normalizedIdempotencyKey, {
        resourceType: "work_blueprint",
        resourceId: blueprint.id,
      });
      return { kind: "confirmed" as const, blueprint: updated };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async withTenant<T>(
    userId: string,
    operation: (
      transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return operation(transaction);
    });
  }
}

async function blueprintValidationContext(
  transaction: DatabaseTransaction,
  userId: string,
  workId: string,
): Promise<{
  genre: string;
  scaleTarget: string;
  genrePackFields: Record<string, unknown>;
  optionalGenrePackFields: Record<string, unknown>;
  generationGuidance: Record<string, unknown>;
} | null> {
  const [row] = await transaction
    .select({
      genre: works.genre,
      scaleTarget: works.scaleTarget,
      genrePackFields: genrePacks.fields,
      genrePackFieldSchema: genrePacks.fieldSchema,
      generationGuidance: genrePacks.generationGuidance,
    })
    .from(works)
    .leftJoin(genrePacks, eq(genrePacks.id, works.templatePackId))
    .where(and(eq(works.id, workId), eq(works.userId, userId), isNull(works.deletedAt)))
    .limit(1);
  if (!row) {
    return null;
  }
  const genreFields = genrePackValidationFields(
    row.genrePackFields ?? {},
    row.genrePackFieldSchema ?? [],
  );
  return {
    genre: row.genre,
    scaleTarget: row.scaleTarget,
    genrePackFields: genreFields.required,
    optionalGenrePackFields: genreFields.optional,
    generationGuidance: row.generationGuidance ?? {},
  };
}

function genrePackValidationFields(
  fields: Record<string, unknown>,
  fieldSchema: Array<{ key: string; required: boolean }>,
): { required: Record<string, unknown>; optional: Record<string, unknown> } {
  const definitions =
    fieldSchema.length > 0
      ? fieldSchema
      : Object.keys(fields).map((key) => ({ key, required: true }));
  return {
    required: Object.fromEntries(
      definitions
        .filter((definition) => definition.required)
        .map((definition) => [definition.key, fields[definition.key]]),
    ),
    optional: Object.fromEntries(
      definitions
        .filter((definition) => !definition.required)
        .map((definition) => [definition.key, fields[definition.key]]),
    ),
  };
}

function sameAcknowledgements(
  left: BlueprintAcknowledgement[],
  right: BlueprintAcknowledgement[],
): boolean {
  return acknowledgementSignature(left) === acknowledgementSignature(right);
}
