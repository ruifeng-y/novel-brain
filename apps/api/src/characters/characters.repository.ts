import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  characterChangeRequests,
  characterKnowledgeStates,
  characterProfiles,
  characterRelationships,
  characterStateTransitions,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  facts,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import {
  characterProfileSchema,
  type CharacterChangeRequest,
  type CharacterChangeRequestCreateRequest,
  type CharacterDetail,
  type CharacterHealthFinding,
  type CharacterHistory,
  type CharacterKnowledgeProjection,
  type CharacterKnowledgeState,
  type CharacterKnowledgeStateCreateRequest,
  type CharacterProfilePatch,
  type CharacterRelationship,
  type CharacterRelationshipCreateRequest,
  type CharacterStateTransition,
  type CharacterStateTransitionCreateRequest,
  type DomainRef,
  type StoryTimePoint,
  type ValidityInterval,
} from "@novel-brain/contracts";
import { projectCharacterKnowledgeAtChapter } from "@novel-brain/core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type CharacterEntityRecord = InferSelectModel<typeof entities>;
type CharacterProfileRecord = InferSelectModel<typeof characterProfiles>;
type CharacterRelationshipRecord = InferSelectModel<typeof characterRelationships>;
type CharacterStateRecord = InferSelectModel<typeof characterStateTransitions>;
type CharacterKnowledgeRecord = InferSelectModel<typeof characterKnowledgeStates>;
type CharacterChangeRequestRecord = InferSelectModel<typeof characterChangeRequests>;

export interface CharacterWorkContext {
  workId: string;
  branchId: string;
}

export interface CharacterAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface CharacterCreateInput {
  name: string;
  aliases: string[];
  summary: string;
  description: string;
  tags: string[];
  profile: {
    desire: string;
    fear: string;
    goal: string;
    voiceSample: string;
    voiceGuide: string;
    disguise: string;
  };
}

export type CharacterWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "version_conflict" }
  | { kind: "name_conflict"; entityId: string; value: string }
  | { kind: "alias_conflict"; entityId: string; value: string }
  | { kind: "state_overlap" }
  | { kind: "fact_not_found" }
  | { kind: "target_not_found" };

interface CharacterAggregate {
  entity: CharacterEntityRecord;
  profile: CharacterProfileRecord;
  relationships: CharacterRelationshipRecord[];
  stateTransitions: CharacterStateRecord[];
  knowledgeStates: CharacterKnowledgeRecord[];
  latestVersionNodeId: string;
}

interface CharacterSnapshotPayload {
  profile: CharacterDetail["profile"];
  relationships: CharacterDetail["relationships"];
  stateTransitions: CharacterDetail["stateTransitions"];
  knowledgeStates: CharacterDetail["knowledgeStates"];
}

@Injectable()
export class CharactersRepository implements OnModuleDestroy {
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
  ): Promise<CharacterWorkContext | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const [context] = await transaction
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
            sql`${works.deletedAt} is null`,
          ),
        )
        .limit(1);
      return context;
    });
  }

  async list(userId: string, context: CharacterWorkContext): Promise<CharacterDetail[]> {
    const ids = await this.withTenant(userId, async (transaction) =>
      transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "character"),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .orderBy(asc(entities.createdAt)),
    );
    const details: CharacterDetail[] = [];
    for (const id of ids) {
      const detail = await this.getDetail(userId, context, id.id);
      if (detail) {
        details.push(detail);
      }
    }
    return details;
  }

  async getDetail(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
  ): Promise<CharacterDetail | undefined> {
    return this.withTenant(userId, async (transaction) => {
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      return aggregate ? this.toDetail(aggregate) : undefined;
    });
  }

  async create(
    userId: string,
    context: CharacterWorkContext,
    input: CharacterCreateInput,
    audit: CharacterAuditContext,
  ): Promise<CharacterWriteResult<CharacterDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findCharacterConflict(
        transaction,
        userId,
        context,
        input.name,
        input.aliases,
      );
      if (conflict) {
        return conflict;
      }
      const now = new Date();
      const characterId = uuidv7();
      const [entity] = await transaction
        .insert(entities)
        .values({
          id: characterId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          type: "character",
          name: input.name,
          aliases: input.aliases,
          summary: input.summary,
          description: input.description,
          attributes: {
            bodyState: "当前身体状态请查看状态历史",
            knowledgeBoundary: "角色认知请查看知识状态",
            relationshipSummary: "人物关系请查看类型化关系",
          },
          tags: input.tags,
          status: "draft",
          source: "author",
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!entity) {
        throw new Error("Failed to create character");
      }
      await transaction.insert(characterProfiles).values({
        entityId: characterId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        ...input.profile,
        createdAt: now,
        updatedAt: now,
      });
      await this.appendVersion(
        transaction,
        userId,
        context,
        entity,
        headNodeId,
        "character.created",
        "创建人物档案",
        audit,
      );
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      if (!aggregate) {
        throw new Error("Created character is missing");
      }
      return { kind: "ok", value: this.toDetail(aggregate) };
    });
  }

  async updateProfile(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    expectedVersion: number,
    patch: CharacterProfilePatch,
    audit: CharacterAuditContext,
  ): Promise<CharacterWriteResult<CharacterDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableCharacter(
        transaction,
        userId,
        context,
        characterId,
        expectedVersion,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const now = new Date();
      const [updated] = await transaction
        .update(entities)
        .set({ version: current.value.version + 1, updatedAt: now })
        .where(and(eq(entities.id, characterId), eq(entities.version, expectedVersion)))
        .returning();
      if (!updated) {
        return { kind: "version_conflict" };
      }
      await transaction
        .insert(characterProfiles)
        .values({
          entityId: characterId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          ...characterProfileSchema.parse({ ...emptyProfile(), ...patch }),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: characterProfiles.entityId,
          set: { ...patch, updatedAt: now },
        });
      await this.appendVersion(
        transaction,
        userId,
        context,
        updated,
        await requireBranchHead(transaction, userId, context),
        "character.profile.updated",
        "更新人物档案",
        audit,
      );
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      if (!aggregate) {
        throw new Error("Updated character is missing");
      }
      return { kind: "ok", value: this.toDetail(aggregate) };
    });
  }

  async addRelationship(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    input: CharacterRelationshipCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterWriteResult<CharacterRelationship>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableCharacter(transaction, userId, context, characterId, null);
      if (current.kind !== "ok") {
        return current;
      }
      if (input.target.branchId !== context.branchId) {
        return { kind: "target_not_found" };
      }
      if (input.target.type !== "map_node") {
        const target = await findDomainTarget(
          transaction,
          userId,
          context,
          input.target.type,
          input.target.id,
        );
        if (!target) {
          return { kind: "target_not_found" };
        }
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const id = uuidv7();
      await insertVersionNode(
        transaction,
        userId,
        context,
        current.value,
        versionNodeId,
        "character.relationship.created",
        "新增人物关系",
      );
      const [relationship] = await transaction
        .insert(characterRelationships)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          sourceCharacterId: characterId,
          targetType: input.target.type,
          targetId: input.target.id,
          targetLabel: input.target.label,
          relationType: input.relationType,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          sourceChapterId: input.sourceChapterId,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!relationship) {
        throw new Error("Failed to create character relationship");
      }
      const updated = await advanceCharacterVersion(
        transaction,
        userId,
        context,
        current.value,
        versionNodeId,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toRelationshipContract(relationship) };
    });
  }

  async addStateTransition(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    input: CharacterStateTransitionCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterWriteResult<CharacterStateTransition>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableCharacter(transaction, userId, context, characterId, null);
      if (current.kind !== "ok") {
        return current;
      }
      if (input.target && input.target.branchId !== context.branchId) {
        return { kind: "target_not_found" };
      }
      if (input.target && input.target.type !== "map_node") {
        const target = await findDomainTarget(
          transaction,
          userId,
          context,
          input.target.type,
          input.target.id,
        );
        if (!target) {
          return { kind: "target_not_found" };
        }
      }
      const overlap = await hasStateOverlap(transaction, userId, context, characterId, input);
      if (overlap) {
        return { kind: "state_overlap" };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const id = uuidv7();
      await insertVersionNode(
        transaction,
        userId,
        context,
        current.value,
        versionNodeId,
        "character.state.created",
        "记录人物状态变化",
      );
      const [transition] = await transaction
        .insert(characterStateTransitions)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          characterId,
          stateKind: input.stateKind,
          stateKey: input.stateKey,
          value: input.value,
          targetType: input.target?.type ?? null,
          targetId: input.target?.id ?? null,
          targetLabel: input.target?.label ?? null,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          sourceChapterId: input.sourceChapterId,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!transition) {
        throw new Error("Failed to create character state transition");
      }
      const updated = await advanceCharacterVersion(
        transaction,
        userId,
        context,
        current.value,
        versionNodeId,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toStateContract(transition) };
    });
  }

  async addKnowledgeState(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    input: CharacterKnowledgeStateCreateRequest,
    audit: CharacterAuditContext,
  ): Promise<CharacterWriteResult<CharacterKnowledgeState>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableCharacter(transaction, userId, context, characterId, null);
      if (current.kind !== "ok") {
        return current;
      }
      const [fact] = await transaction
        .select({ id: facts.id })
        .from(facts)
        .where(
          and(
            eq(facts.id, input.objectiveFactId),
            eq(facts.userId, userId),
            eq(facts.workId, context.workId),
            eq(facts.branchId, context.branchId),
            eq(facts.status, "active"),
          ),
        )
        .limit(1);
      if (!fact) {
        return { kind: "fact_not_found" };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const id = uuidv7();
      await insertVersionNode(
        transaction,
        userId,
        context,
        current.value,
        versionNodeId,
        "character.knowledge.created",
        "记录角色认知",
      );
      const [knowledge] = await transaction
        .insert(characterKnowledgeStates)
        .values({
          id,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          characterId,
          objectiveFactId: input.objectiveFactId,
          state: input.state,
          claimedContent: input.claimedContent,
          sourceKind: input.sourceKind,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          sourceChapterId: input.sourceChapterId,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!knowledge) {
        throw new Error("Failed to create character knowledge state");
      }
      const updated = await advanceCharacterVersion(
        transaction,
        userId,
        context,
        current.value,
        versionNodeId,
        now,
      );
      await this.appendSnapshotAtVersion(
        transaction,
        userId,
        context,
        updated,
        versionNodeId,
        audit,
      );
      return { kind: "ok", value: toKnowledgeContract(knowledge) };
    });
  }

  async lock(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    expectedVersion: number,
    audit: CharacterAuditContext,
  ): Promise<CharacterWriteResult<CharacterDetail>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableCharacter(
        transaction,
        userId,
        context,
        characterId,
        expectedVersion,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const now = new Date();
      const [locked] = await transaction
        .update(entities)
        .set({
          status: "locked",
          lockedAt: now,
          lockedBy: userId,
          version: current.value.version + 1,
          updatedAt: now,
        })
        .where(and(eq(entities.id, characterId), eq(entities.version, expectedVersion)))
        .returning();
      if (!locked) {
        return { kind: "version_conflict" };
      }
      await this.appendVersion(
        transaction,
        userId,
        context,
        locked,
        await requireBranchHead(transaction, userId, context),
        "character.locked",
        "锁定人物档案",
        audit,
      );
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      if (!aggregate) {
        throw new Error("Locked character is missing");
      }
      return { kind: "ok", value: this.toDetail(aggregate) };
    });
  }

  async history(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    query: { chapterNumber?: number | undefined; versionNodeId?: string | undefined },
  ): Promise<CharacterWriteResult<CharacterHistory>> {
    return this.withTenant(userId, async (transaction) => {
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      if (!aggregate) {
        return { kind: "not_found" };
      }
      if (query.chapterNumber !== undefined) {
        return {
          kind: "ok",
          value: {
            character: characterRef(aggregate.entity),
            at: { chapterNumber: query.chapterNumber, versionNodeId: null },
            profile: toProfileContract(aggregate.profile),
            relationships: aggregate.relationships
              .map(toRelationshipContract)
              .filter((edge) => chapterActive(edge.validity, query.chapterNumber!)),
            stateTransitions: aggregate.stateTransitions
              .map(toStateContract)
              .filter((state) => chapterActive(state.validity, query.chapterNumber!)),
            knowledgeStates: aggregate.knowledgeStates
              .map(toKnowledgeContract)
              .filter((state) => chapterActive(state.validity, query.chapterNumber!)),
          },
        };
      }
      const versionNodeId = query.versionNodeId;
      if (!versionNodeId) {
        return { kind: "not_found" };
      }
      const ancestorIds = await versionAncestors(
        transaction,
        userId,
        context.branchId,
        versionNodeId,
      );
      if (ancestorIds.length === 0) {
        return { kind: "not_found" };
      }
      const snapshots = await transaction
        .select({ snapshot: entityVersions.snapshot })
        .from(entityVersions)
        .where(
          and(
            eq(entityVersions.entityId, characterId),
            eq(entityVersions.userId, userId),
            eq(entityVersions.workId, context.workId),
            eq(entityVersions.branchId, context.branchId),
            inArray(entityVersions.versionNodeId, ancestorIds),
          ),
        )
        .orderBy(desc(entityVersions.version));
      const payload = snapshots
        .map((snapshot) => parseCharacterSnapshot(snapshot.snapshot))
        .find((snapshot): snapshot is CharacterSnapshotPayload => snapshot !== undefined);
      if (!payload) {
        return { kind: "not_found" };
      }
      return {
        kind: "ok",
        value: {
          character: characterRef(aggregate.entity),
          at: { chapterNumber: null, versionNodeId },
          profile: payload.profile,
          relationships: payload.relationships,
          stateTransitions: payload.stateTransitions,
          knowledgeStates: payload.knowledgeStates,
        },
      };
    });
  }

  async knowledgeAtChapter(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    chapterNumber: number,
  ): Promise<CharacterWriteResult<CharacterKnowledgeProjection>> {
    return this.withTenant(userId, async (transaction) => {
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      if (!aggregate) {
        return { kind: "not_found" };
      }
      const objectiveFacts = await transaction
        .select()
        .from(facts)
        .where(
          and(
            eq(facts.userId, userId),
            eq(facts.workId, context.workId),
            eq(facts.branchId, context.branchId),
            eq(facts.status, "active"),
          ),
        )
        .orderBy(asc(facts.createdAt));
      const projection = projectCharacterKnowledgeAtChapter(
        objectiveFacts.map((fact) => ({
          id: fact.id,
          subject: fact.subject,
          predicate: fact.predicate,
          object: fact.object,
          validFromChapter: fact.validFromChapter,
          validToChapter: fact.validToChapter,
        })),
        aggregate.knowledgeStates.map((state) => ({
          objectiveFactId: state.objectiveFactId,
          state: state.state as CharacterKnowledgeState["state"],
          claimedContent: state.claimedContent,
          validFromChapter: state.validFromChapter,
          validToChapter: state.validToChapter,
        })),
        chapterNumber,
      );
      return { kind: "ok", value: projection };
    });
  }

  async listChangeRequests(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
  ): Promise<CharacterWriteResult<CharacterChangeRequest[]>> {
    return this.withTenant(userId, async (transaction) => {
      const character = await findCharacter(transaction, userId, context, characterId);
      if (!character) {
        return { kind: "not_found" };
      }
      const requests = await transaction
        .select()
        .from(characterChangeRequests)
        .where(
          and(
            eq(characterChangeRequests.userId, userId),
            eq(characterChangeRequests.workId, context.workId),
            eq(characterChangeRequests.branchId, context.branchId),
            eq(characterChangeRequests.characterId, characterId),
          ),
        )
        .orderBy(asc(characterChangeRequests.createdAt));
      return { kind: "ok", value: requests.map(toChangeRequestContract) };
    });
  }

  async createChangeRequest(
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
    input: CharacterChangeRequestCreateRequest,
    audit: CharacterAuditContext,
    idempotencyKey?: string,
  ): Promise<CharacterWriteResult<CharacterChangeRequest>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findCharacter(transaction, userId, context, characterId);
      if (!current) {
        return { kind: "not_found" };
      }
      if (current.version !== input.version) {
        return { kind: "version_conflict" };
      }
      if (idempotencyKey) {
        const [existing] = await transaction
          .select()
          .from(characterChangeRequests)
          .where(
            and(
              eq(characterChangeRequests.userId, userId),
              eq(characterChangeRequests.characterId, characterId),
              eq(characterChangeRequests.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          return { kind: "ok", value: toChangeRequestContract(existing) };
        }
      }
      const aggregate = await this.readAggregate(transaction, userId, context, characterId);
      if (!aggregate) {
        return { kind: "not_found" };
      }
      const before: Record<string, unknown> =
        input.kind === "profile" ? toProfileContract(aggregate.profile) : {};
      const now = new Date();
      const [request] = await transaction
        .insert(characterChangeRequests)
        .values({
          id: uuidv7(),
          characterId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          version: input.version,
          kind: input.kind,
          title: input.title,
          reason: input.reason,
          before,
          after: input.after as Record<string, unknown>,
          status: "pending",
          evidence: input.evidence,
          idempotencyKey: idempotencyKey ?? null,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!request) {
        throw new Error("Failed to create character change request");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "character.change_requested",
        targetType: "character",
        targetId: characterId,
        decision: "pending",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return { kind: "ok", value: toChangeRequestContract(request) };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private async readAggregate(
    transaction: DatabaseTransaction,
    userId: string,
    context: CharacterWorkContext,
    characterId: string,
  ): Promise<CharacterAggregate | undefined> {
    const entity = await findCharacter(transaction, userId, context, characterId);
    if (!entity) {
      return undefined;
    }
    const [profile, relationships, stateTransitions, knowledgeStates, branch] = await Promise.all([
      transaction
        .select()
        .from(characterProfiles)
        .where(eq(characterProfiles.entityId, characterId))
        .limit(1),
      transaction
        .select()
        .from(characterRelationships)
        .where(
          and(
            eq(characterRelationships.userId, userId),
            eq(characterRelationships.workId, context.workId),
            eq(characterRelationships.branchId, context.branchId),
            eq(characterRelationships.sourceCharacterId, characterId),
          ),
        )
        .orderBy(asc(characterRelationships.validFromChapter)),
      transaction
        .select()
        .from(characterStateTransitions)
        .where(
          and(
            eq(characterStateTransitions.userId, userId),
            eq(characterStateTransitions.workId, context.workId),
            eq(characterStateTransitions.branchId, context.branchId),
            eq(characterStateTransitions.characterId, characterId),
          ),
        )
        .orderBy(asc(characterStateTransitions.validFromChapter)),
      transaction
        .select()
        .from(characterKnowledgeStates)
        .where(
          and(
            eq(characterKnowledgeStates.userId, userId),
            eq(characterKnowledgeStates.workId, context.workId),
            eq(characterKnowledgeStates.branchId, context.branchId),
            eq(characterKnowledgeStates.characterId, characterId),
          ),
        )
        .orderBy(asc(characterKnowledgeStates.validFromChapter)),
      transaction
        .select({ headNodeId: workBranches.headNodeId })
        .from(workBranches)
        .where(eq(workBranches.id, context.branchId))
        .limit(1),
    ]);
    const headNodeId = branch[0]?.headNodeId;
    if (!headNodeId) {
      throw new Error("Character branch is missing its version head");
    }
    return {
      entity,
      profile: profile[0] ?? syntheticProfile(entity),
      relationships,
      stateTransitions,
      knowledgeStates,
      latestVersionNodeId: headNodeId,
    };
  }

  private toDetail(aggregate: CharacterAggregate): CharacterDetail {
    const detail: CharacterDetail = {
      character: characterRef(aggregate.entity),
      profile: toProfileContract(aggregate.profile),
      relationships: aggregate.relationships.map(toRelationshipContract),
      stateTransitions: aggregate.stateTransitions.map(toStateContract),
      knowledgeStates: aggregate.knowledgeStates.map(toKnowledgeContract),
      health: characterHealth(aggregate),
      version: aggregate.entity.version,
      latestVersionNodeId: aggregate.latestVersionNodeId,
      status: aggregate.entity.status as CharacterDetail["status"],
      lockedAt: aggregate.entity.lockedAt?.toISOString() ?? null,
    };
    return detail;
  }

  private async appendVersion(
    transaction: DatabaseTransaction,
    userId: string,
    context: CharacterWorkContext,
    entity: CharacterEntityRecord,
    parentNodeId: string,
    action: string,
    message: string,
    audit: CharacterAuditContext,
  ): Promise<void> {
    const versionNodeId = uuidv7();
    await insertVersionNode(
      transaction,
      userId,
      context,
      entity,
      versionNodeId,
      action,
      message,
      parentNodeId,
    );
    await this.appendSnapshotAtVersion(transaction, userId, context, entity, versionNodeId, audit);
    await transaction
      .update(workBranches)
      .set({ headNodeId: versionNodeId, updatedAt: new Date() })
      .where(eq(workBranches.id, context.branchId));
  }

  private async appendSnapshotAtVersion(
    transaction: DatabaseTransaction,
    userId: string,
    context: CharacterWorkContext,
    entity: CharacterEntityRecord,
    versionNodeId: string,
    audit: CharacterAuditContext,
  ): Promise<void> {
    const aggregate = await this.readAggregate(transaction, userId, context, entity.id);
    if (!aggregate) {
      throw new Error("Character snapshot is missing its aggregate");
    }
    const snapshot: CharacterSnapshotPayload & Record<string, unknown> = {
      profile: toProfileContract(aggregate.profile),
      relationships: aggregate.relationships.map(toRelationshipContract),
      stateTransitions: aggregate.stateTransitions.map(toStateContract),
      knowledgeStates: aggregate.knowledgeStates.map(toKnowledgeContract),
    };
    const entityVersionId = uuidv7();
    await transaction
      .update(versionNodes)
      .set({ snapshotId: entityVersionId, objectVersion: entity.version })
      .where(eq(versionNodes.id, versionNodeId));
    await transaction.insert(entityVersions).values({
      id: entityVersionId,
      entityId: entity.id,
      workId: context.workId,
      branchId: context.branchId,
      userId,
      version: entity.version,
      snapshot,
      versionNodeId,
      createdBy: userId,
      createdAt: new Date(),
    });
    await transaction.insert(auditLogs).values({
      id: uuidv7(),
      actorId: userId,
      action: "character.versioned",
      targetType: "character",
      targetId: entity.id,
      decision: "allowed",
      correlationId: audit.requestId,
      ip: audit.ip,
      userAgent: audit.userAgent,
    });
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

async function findCharacter(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  characterId: string,
): Promise<CharacterEntityRecord | undefined> {
  const [entity] = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, characterId),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, "character"),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .limit(1);
  return entity;
}

async function findWritableCharacter(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  characterId: string,
  expectedVersion: number | null,
): Promise<CharacterWriteResult<CharacterEntityRecord>> {
  const [current] = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, characterId),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, "character"),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .for("update")
    .limit(1);
  if (!current) {
    return { kind: "not_found" };
  }
  if (current.status === "locked") {
    return { kind: "locked" };
  }
  if (expectedVersion !== null && current.version !== expectedVersion) {
    return { kind: "version_conflict" };
  }
  return { kind: "ok", value: current };
}

async function findDomainTarget(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  type: string,
  id: string,
): Promise<boolean> {
  if (type === "fact") {
    const [fact] = await transaction
      .select({ id: facts.id })
      .from(facts)
      .where(
        and(
          eq(facts.id, id),
          eq(facts.userId, userId),
          eq(facts.workId, context.workId),
          eq(facts.branchId, context.branchId),
        ),
      )
      .limit(1);
    return Boolean(fact);
  }
  const [entity] = await transaction
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.id, id),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, type),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .limit(1);
  return Boolean(entity);
}

async function hasStateOverlap(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  characterId: string,
  input: CharacterStateTransitionCreateRequest,
): Promise<boolean> {
  const [overlap] = await transaction
    .select({ id: characterStateTransitions.id })
    .from(characterStateTransitions)
    .where(
      and(
        eq(characterStateTransitions.userId, userId),
        eq(characterStateTransitions.workId, context.workId),
        eq(characterStateTransitions.branchId, context.branchId),
        eq(characterStateTransitions.characterId, characterId),
        eq(characterStateTransitions.stateKind, input.stateKind),
        eq(characterStateTransitions.stateKey, input.stateKey),
        sql`(${characterStateTransitions.validToChapter} is null or ${characterStateTransitions.validToChapter} >= ${input.validity.fromChapter})`,
        input.validity.toChapter === null
          ? sql`true`
          : sql`${characterStateTransitions.validFromChapter} <= ${input.validity.toChapter}`,
      ),
    )
    .limit(1);
  return Boolean(overlap);
}

async function insertVersionNode(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  entity: CharacterEntityRecord,
  versionNodeId: string,
  action: string,
  message: string,
  parentNodeId?: string,
): Promise<void> {
  const parent = parentNodeId ?? (await requireBranchHead(transaction, userId, context));
  await transaction.insert(versionNodes).values({
    id: versionNodeId,
    workId: context.workId,
    branchId: context.branchId,
    userId,
    parentNodeId: parent,
    nodeType: "entity_version",
    objectType: "character",
    objectId: entity.id,
    objectVersion: entity.version,
    snapshotId: null,
    payload: { action },
    actorId: userId,
    message,
    createdAt: new Date(),
  });
}

async function advanceCharacterVersion(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  current: CharacterEntityRecord,
  versionNodeId: string,
  now: Date,
): Promise<CharacterEntityRecord> {
  const [updated] = await transaction
    .update(entities)
    .set({ version: current.version + 1, updatedAt: now })
    .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
    .returning();
  if (!updated) {
    throw new Error("Character changed while applying a versioned write");
  }
  await transaction
    .update(versionNodes)
    .set({ objectVersion: updated.version })
    .where(eq(versionNodes.id, versionNodeId));
  await transaction
    .update(workBranches)
    .set({ headNodeId: versionNodeId, updatedAt: now })
    .where(eq(workBranches.id, context.branchId));
  return updated;
}

async function requireBranchHead(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
): Promise<string> {
  const [branch] = await transaction
    .select({ headNodeId: workBranches.headNodeId })
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
    throw new Error("Character branch is missing its version head");
  }
  return branch.headNodeId;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function findCharacterConflict(
  transaction: DatabaseTransaction,
  userId: string,
  context: CharacterWorkContext,
  name: string,
  aliases: string[],
): Promise<
  | { kind: "name_conflict"; entityId: string; value: string }
  | { kind: "alias_conflict"; entityId: string; value: string }
  | undefined
> {
  const normalizedName = normalizeIdentifier(name);
  const normalizedAliases = aliases.map(normalizeIdentifier);
  if (
    new Set(normalizedAliases).size !== normalizedAliases.length ||
    normalizedAliases.includes(normalizedName)
  ) {
    return { kind: "alias_conflict", entityId: "", value: name };
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
      ),
    );
  for (const candidate of candidates) {
    const candidateName = normalizeIdentifier(candidate.name);
    const candidateAliases = candidate.aliases.map(normalizeIdentifier);
    if (candidate.type === "character" && candidateName === normalizedName) {
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

async function versionAncestors(
  transaction: DatabaseTransaction,
  userId: string,
  branchId: string,
  versionNodeId: string,
): Promise<string[]> {
  const result = await transaction.execute<{ id: string }>(sql`
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_node_id
      FROM version_nodes
      WHERE id = ${versionNodeId} AND branch_id = ${branchId} AND user_id = ${userId}
      UNION ALL
      SELECT parent.id, parent.parent_node_id
      FROM version_nodes parent
      INNER JOIN ancestors child ON parent.id = child.parent_node_id
      WHERE parent.branch_id = ${branchId} AND parent.user_id = ${userId}
    )
    SELECT id FROM ancestors
  `);
  return result.rows.map((row) => row.id);
}

function characterRef(entity: CharacterEntityRecord): DomainRef {
  return {
    type: "character",
    id: entity.id,
    branchId: entity.branchId,
    label: entity.name,
    version: null,
  };
}

function toProfileContract(profile: CharacterProfileRecord): CharacterDetail["profile"] {
  return {
    desire: profile.desire,
    fear: profile.fear,
    goal: profile.goal,
    voiceSample: profile.voiceSample,
    voiceGuide: profile.voiceGuide,
    disguise: profile.disguise,
  };
}

function syntheticProfile(entity: CharacterEntityRecord): CharacterProfileRecord {
  return {
    entityId: entity.id,
    workId: entity.workId,
    branchId: entity.branchId,
    userId: entity.userId,
    ...emptyProfile(),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function emptyProfile() {
  return {
    desire: "",
    fear: "",
    goal: "",
    voiceSample: "",
    voiceGuide: "",
    disguise: "",
  };
}

function toRelationshipContract(row: CharacterRelationshipRecord): CharacterRelationship {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    sourceCharacterId: row.sourceCharacterId,
    target: {
      type: row.targetType as DomainRef["type"],
      id: row.targetId,
      branchId: row.branchId,
      label: row.targetLabel,
      version: null,
    },
    relationType: row.relationType as CharacterRelationship["relationType"],
    validity: validityFromColumns(row),
    sourceChapterId: row.sourceChapterId,
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toStateContract(row: CharacterStateRecord): CharacterStateTransition {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    characterId: row.characterId,
    stateKind: row.stateKind as CharacterStateTransition["stateKind"],
    stateKey: row.stateKey,
    value: row.value,
    target:
      row.targetType && row.targetId
        ? {
            type: row.targetType as DomainRef["type"],
            id: row.targetId,
            branchId: row.branchId,
            label: row.targetLabel,
            version: null,
          }
        : null,
    validity: validityFromColumns(row),
    sourceChapterId: row.sourceChapterId,
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toKnowledgeContract(row: CharacterKnowledgeRecord): CharacterKnowledgeState {
  return {
    id: row.id,
    workId: row.workId,
    branchId: row.branchId,
    characterId: row.characterId,
    objectiveFactId: row.objectiveFactId,
    state: row.state as CharacterKnowledgeState["state"],
    claimedContent: row.claimedContent,
    sourceKind: row.sourceKind as CharacterKnowledgeState["sourceKind"],
    validity: validityFromColumns(row),
    sourceChapterId: row.sourceChapterId,
    versionNodeId: row.versionNodeId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toChangeRequestContract(row: CharacterChangeRequestRecord): CharacterChangeRequest {
  return {
    id: row.id,
    characterId: row.characterId,
    workId: row.workId,
    branchId: row.branchId,
    version: row.version,
    kind: row.kind as CharacterChangeRequest["kind"],
    title: row.title,
    reason: row.reason,
    before: row.before,
    after: row.after,
    status: row.status as CharacterChangeRequest["status"],
    evidence: row.evidence as CharacterChangeRequest["evidence"],
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function validityFromColumns(row: {
  validFromChapter: number;
  validToChapter: number | null;
  fromEra: string | null;
  fromStoryTimeLabel: string | null;
  fromStorySortKey: number | null;
  toEra: string | null;
  toStoryTimeLabel: string | null;
  toStorySortKey: number | null;
}): ValidityInterval {
  return {
    fromChapter: row.validFromChapter,
    toChapter: row.validToChapter,
    fromStoryTime: storyTimeFromColumns(row.fromEra, row.fromStoryTimeLabel, row.fromStorySortKey),
    toStoryTime: storyTimeFromColumns(row.toEra, row.toStoryTimeLabel, row.toStorySortKey),
  };
}

function storyTimeFromColumns(
  era: string | null,
  label: string | null,
  sortKey: number | null,
): StoryTimePoint | null {
  if (era === null || label === null || sortKey === null) {
    return null;
  }
  return { era, label, sortKey };
}

function storyTimeColumns(validity: ValidityInterval) {
  return {
    fromEra: validity.fromStoryTime?.era ?? null,
    fromStoryTimeLabel: validity.fromStoryTime?.label ?? null,
    fromStorySortKey: validity.fromStoryTime?.sortKey ?? null,
    toEra: validity.toStoryTime?.era ?? null,
    toStoryTimeLabel: validity.toStoryTime?.label ?? null,
    toStorySortKey: validity.toStoryTime?.sortKey ?? null,
  };
}

function chapterActive(validity: ValidityInterval, chapterNumber: number): boolean {
  return (
    validity.fromChapter <= chapterNumber &&
    (validity.toChapter === null || validity.toChapter >= chapterNumber)
  );
}

function characterHealth(aggregate: CharacterAggregate): CharacterHealthFinding[] {
  const health: CharacterHealthFinding[] = [];
  if (!aggregate.profile.goal.trim()) {
    health.push({
      code: "character.goal_missing",
      severity: "warning",
      message: "人物目标尚未填写。",
    });
  }
  if (!aggregate.profile.fear.trim()) {
    health.push({
      code: "character.fear_missing",
      severity: "warning",
      message: "人物恐惧尚未填写。",
    });
  }
  if (aggregate.stateTransitions.length === 0) {
    health.push({
      code: "character.state_missing",
      severity: "warning",
      message: "尚无身体、位置或能力状态记录。",
    });
  }
  return health;
}

function parseCharacterSnapshot(
  value: Record<string, unknown>,
): CharacterSnapshotPayload | undefined {
  const characterProfile = value.profile ?? value.characterProfile;
  if (!characterProfile || typeof characterProfile !== "object") {
    return undefined;
  }
  const profile = characterProfileSchema.parse(characterProfile);
  return {
    profile,
    relationships: Array.isArray(value.relationships)
      ? (value.relationships as CharacterRelationship[])
      : [],
    stateTransitions: Array.isArray(value.stateTransitions)
      ? (value.stateTransitions as CharacterStateTransition[])
      : [],
    knowledgeStates: Array.isArray(value.knowledgeStates)
      ? (value.knowledgeStates as CharacterKnowledgeState[])
      : [],
  };
}

function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}
