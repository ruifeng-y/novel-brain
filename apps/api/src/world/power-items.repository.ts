import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  itemRights,
  itemTechniques,
  mapNodes,
  mechanismOwnershipEvents,
  powerPaths,
  powerRealms,
  powerSystems,
  specialMechanisms,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import {
  findEquipmentSlotConflicts,
  resolvePowerLifespan,
  validateItemConsumption,
  validateItemRightSet,
  validatePowerRealmLadder,
} from "@novel-brain/core";
import {
  type DomainHealthFinding,
  type DomainRef,
  type ItemConsumeRequest,
  type ItemCreateRequest,
  type ItemDomain,
  type ItemEquipRequest,
  type ItemPatchRequest,
  type ItemRight,
  type ItemRightGrantRequest,
  type PowerLifespanPolicy,
  type PowerPath,
  type PowerPathCreateRequest,
  type PowerRealm,
  type PowerRealmCreateRequest,
  type PowerSystem,
  type PowerSystemCreateRequest,
  type PowerSystemPatchRequest,
  type SettingEvidence,
  type SpecialMechanism,
  type SpecialMechanismCreateRequest,
  type SpecialMechanismOwnershipRecord,
  type SpecialMechanismOwnershipTransferRequest,
  type SpecialMechanismPatchRequest,
  type StoryTimePoint,
  type ValidityInterval,
} from "@novel-brain/contracts";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

type DatabaseTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];
type EntityRecord = InferSelectModel<typeof entities>;
type PowerSystemRecord = InferSelectModel<typeof powerSystems>;
type PowerPathRecord = InferSelectModel<typeof powerPaths>;
type PowerRealmRecord = InferSelectModel<typeof powerRealms>;
type MechanismRecord = InferSelectModel<typeof specialMechanisms>;
type OwnershipEventRecord = InferSelectModel<typeof mechanismOwnershipEvents>;
type ItemRightRecord = InferSelectModel<typeof itemRights>;

export interface PowerItemsWorkContext {
  workId: string;
  branchId: string;
}

export interface PowerItemsAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export type PowerItemsWriteResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "proposal_state" }
  | { kind: "version_conflict" }
  | { kind: "name_conflict" }
  | { kind: "alias_conflict" }
  | { kind: "target_not_found" }
  | { kind: "path_mismatch" }
  | { kind: "power_ladder_invalid"; findings: string[] }
  | { kind: "lifespan_invalid" }
  | { kind: "item_right_conflict"; findings: string[] }
  | { kind: "item_not_consumable" }
  | { kind: "item_quantity_insufficient" }
  | { kind: "equipment_conflict" }
  | { kind: "not_equipment" };

interface ReadOptions {
  chapterNumber?: number | undefined;
}

interface StoryTimeColumns {
  fromEra: string | null;
  fromStoryTimeLabel: string | null;
  fromStorySortKey: number | null;
  toEra: string | null;
  toStoryTimeLabel: string | null;
  toStorySortKey: number | null;
}

interface ValidityColumns extends StoryTimeColumns {
  validFromChapter: number;
  validToChapter: number | null;
}

interface MechanismOwnerColumns {
  ownerType: string | null;
  ownerId: string | null;
  ownerLabel: string | null;
}

@Injectable()
export class PowerItemsRepository implements OnModuleDestroy {
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

  onModuleDestroy(): void {
    void this.pool.end();
  }

  async findWorkContext(
    userId: string,
    workId: string,
    branchId: string,
  ): Promise<PowerItemsWorkContext | undefined> {
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

  async listPowerSystems(
    userId: string,
    context: PowerItemsWorkContext,
    options: ReadOptions,
  ): Promise<PowerSystem[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "power_system"),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .orderBy(asc(entities.createdAt));
      const details: PowerSystem[] = [];
      for (const row of rows) {
        const detail = await this.readPowerSystemInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          details.push(detail);
        }
      }
      return details;
    });
  }

  async getPowerSystem(
    userId: string,
    context: PowerItemsWorkContext,
    powerSystemId: string,
    options: ReadOptions,
  ): Promise<PowerSystem | undefined> {
    return this.withTenant(userId, async (transaction) =>
      this.readPowerSystemInTransaction(transaction, userId, context, powerSystemId, options),
    );
  }

  async createPowerSystem(
    userId: string,
    context: PowerItemsWorkContext,
    input: PowerSystemCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<PowerSystem>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findEntityConflict(
        transaction,
        userId,
        context,
        input.name,
        input.aliases,
      );
      if (conflict) {
        return conflict;
      }
      const realmPlan = planNestedRealms(input.paths);
      const ladderFindings = realmPlan.flatMap((path) =>
        validatePowerRealmLadder(
          path.realms.map((realm) => ({
            id: realm.id,
            pathId: path.id,
            rank: realm.rank,
            prerequisiteRealmId: realm.prerequisiteRealmId,
          })),
        ),
      );
      if (ladderFindings.length > 0) {
        return {
          kind: "power_ladder_invalid",
          findings: ladderFindings.map((finding) => finding.code),
        };
      }

      const now = new Date();
      const powerSystemId = uuidv7();
      const versionNodeId = uuidv7();
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "power_system",
        powerSystemId,
        "power_system.created",
        "创建力量体系",
      );
      await transaction.insert(entities).values({
        id: powerSystemId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        type: "power_system",
        name: input.name,
        aliases: input.aliases,
        summary: input.summary,
        description: input.description,
        attributes: { details: input.overview },
        tags: input.tags,
        status: "draft",
        source: "author",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(powerSystems).values({
        entityId: powerSystemId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        overview: input.overview,
        ...lifespanColumns(input.lifespanPolicy),
        createdAt: now,
        updatedAt: now,
      });
      for (const path of realmPlan) {
        await transaction.insert(powerPaths).values({
          id: path.id,
          powerSystemId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          name: path.name,
          pathType: path.pathType,
          description: path.description,
          sortOrder: path.sortOrder,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        });
        if (path.realms.length > 0) {
          await transaction.insert(powerRealms).values(
            path.realms.map((realm) => ({
              id: realm.id,
              pathId: path.id,
              workId: context.workId,
              branchId: context.branchId,
              userId,
              name: realm.name,
              rank: realm.rank,
              description: realm.description,
              breakthroughConditions: realm.breakthroughConditions,
              breakthroughCosts: realm.breakthroughCosts,
              bottlenecks: realm.bottlenecks,
              counters: realm.counters,
              counteredBy: realm.counteredBy,
              lifespanAmount: realm.lifespanAmount,
              prerequisiteRealmId: realm.prerequisiteRealmId,
              versionNodeId,
              createdBy: userId,
              createdAt: now,
            })),
          );
        }
      }
      const [entity] = await transaction
        .select()
        .from(entities)
        .where(eq(entities.id, powerSystemId))
        .limit(1);
      if (!entity) {
        throw new Error("Created power system entity is missing");
      }
      await appendSnapshotAtVersion(transaction, userId, context, entity, versionNodeId, audit);
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, context.branchId));
      const detail = await this.readPowerSystemInTransaction(
        transaction,
        userId,
        context,
        powerSystemId,
        {},
      );
      if (!detail) {
        throw new Error("Created power system is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async updatePowerSystem(
    userId: string,
    context: PowerItemsWorkContext,
    powerSystemId: string,
    input: PowerSystemPatchRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<PowerSystem>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        powerSystemId,
        "power_system",
        input.version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (input.name !== undefined || input.aliases !== undefined) {
        const conflict = await findEntityConflict(
          transaction,
          userId,
          context,
          input.name ?? current.value.name,
          input.aliases ?? current.value.aliases,
          powerSystemId,
        );
        if (conflict) {
          return conflict;
        }
      }
      if (input.lifespanPolicy?.pathId) {
        if (
          !(await findPath(
            transaction,
            userId,
            context,
            powerSystemId,
            input.lifespanPolicy.pathId,
          ))
        ) {
          return { kind: "lifespan_invalid" };
        }
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "power_system",
        powerSystemId,
        "power_system.updated",
        "更新力量体系",
      );
      await transaction
        .update(entities)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.overview !== undefined
            ? { attributes: { ...current.value.attributes, details: input.overview } }
            : {}),
          updatedAt: now,
        })
        .where(eq(entities.id, powerSystemId));
      await transaction
        .insert(powerSystems)
        .values({
          entityId: powerSystemId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          overview: input.overview ?? "",
          ...lifespanColumns(input.lifespanPolicy ?? emptyLifespanPolicy()),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: powerSystems.entityId,
          set: {
            ...(input.overview !== undefined ? { overview: input.overview } : {}),
            ...(input.lifespanPolicy !== undefined ? lifespanColumns(input.lifespanPolicy) : {}),
            updatedAt: now,
          },
        });
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readPowerSystemInTransaction(
        transaction,
        userId,
        context,
        powerSystemId,
        {},
      );
      if (!detail) {
        throw new Error("Updated power system is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async addPowerPath(
    userId: string,
    context: PowerItemsWorkContext,
    powerSystemId: string,
    input: PowerPathCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<PowerPath>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        powerSystemId,
        "power_system",
        null,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const pathId = uuidv7();
      const nested = planNestedRealms([input])[0]!;
      const findings = validatePowerRealmLadder(
        nested.realms.map((realm) => ({
          id: realm.id,
          pathId,
          rank: realm.rank,
          prerequisiteRealmId: realm.prerequisiteRealmId,
        })),
      );
      if (findings.length > 0) {
        return { kind: "power_ladder_invalid", findings: findings.map((finding) => finding.code) };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "power_path",
        pathId,
        "power_path.created",
        "新增力量路径",
      );
      await transaction.insert(powerPaths).values({
        id: pathId,
        powerSystemId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        name: input.name,
        pathType: input.pathType,
        description: input.description,
        sortOrder: input.sortOrder,
        versionNodeId,
        createdBy: userId,
        createdAt: now,
      });
      if (nested.realms.length > 0) {
        await transaction.insert(powerRealms).values(
          nested.realms.map((realm) => ({
            id: realm.id,
            pathId,
            workId: context.workId,
            branchId: context.branchId,
            userId,
            name: realm.name,
            rank: realm.rank,
            description: realm.description,
            breakthroughConditions: realm.breakthroughConditions,
            breakthroughCosts: realm.breakthroughCosts,
            bottlenecks: realm.bottlenecks,
            counters: realm.counters,
            counteredBy: realm.counteredBy,
            lifespanAmount: realm.lifespanAmount,
            prerequisiteRealmId: realm.prerequisiteRealmId,
            versionNodeId,
            createdBy: userId,
            createdAt: now,
          })),
        );
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const path = await readPath(transaction, pathId);
      if (!path) {
        throw new Error("Created power path is missing");
      }
      return { kind: "ok", value: path };
    });
  }

  async addPowerRealm(
    userId: string,
    context: PowerItemsWorkContext,
    powerSystemId: string,
    pathId: string,
    input: PowerRealmCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<PowerRealm>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        powerSystemId,
        "power_system",
        null,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (!(await findPath(transaction, userId, context, powerSystemId, pathId))) {
        return { kind: "path_mismatch" };
      }
      const existing = await transaction
        .select()
        .from(powerRealms)
        .where(and(eq(powerRealms.pathId, pathId), eq(powerRealms.userId, userId)));
      const realmId = uuidv7();
      const findings = validatePowerRealmLadder([
        ...existing.map((realm) => ({
          id: realm.id,
          pathId,
          rank: realm.rank,
          prerequisiteRealmId: realm.prerequisiteRealmId,
        })),
        {
          id: realmId,
          pathId,
          rank: input.rank,
          prerequisiteRealmId: input.prerequisiteRealmId,
        },
      ]);
      if (findings.length > 0) {
        return { kind: "power_ladder_invalid", findings: findings.map((finding) => finding.code) };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "power_realm",
        realmId,
        "power_realm.created",
        "新增境界",
      );
      await transaction.insert(powerRealms).values({
        id: realmId,
        pathId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        name: input.name,
        rank: input.rank,
        description: input.description,
        breakthroughConditions: input.breakthroughConditions,
        breakthroughCosts: input.breakthroughCosts,
        bottlenecks: input.bottlenecks,
        counters: input.counters,
        counteredBy: input.counteredBy,
        lifespanAmount: input.lifespanAmount,
        prerequisiteRealmId: input.prerequisiteRealmId,
        versionNodeId,
        createdBy: userId,
        createdAt: now,
      });
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const realm = await readRealm(transaction, realmId);
      if (!realm) {
        throw new Error("Created power realm is missing");
      }
      return { kind: "ok", value: realm };
    });
  }

  async listMechanisms(
    userId: string,
    context: PowerItemsWorkContext,
    options: ReadOptions,
  ): Promise<SpecialMechanism[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "golden_finger"),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .orderBy(asc(entities.createdAt));
      const details: SpecialMechanism[] = [];
      for (const row of rows) {
        const detail = await this.readMechanismInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          details.push(detail);
        }
      }
      return details;
    });
  }

  async getMechanism(
    userId: string,
    context: PowerItemsWorkContext,
    mechanismId: string,
    options: ReadOptions,
  ): Promise<SpecialMechanism | undefined> {
    return this.withTenant(userId, async (transaction) =>
      this.readMechanismInTransaction(transaction, userId, context, mechanismId, options),
    );
  }

  async createMechanism(
    userId: string,
    context: PowerItemsWorkContext,
    input: SpecialMechanismCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<SpecialMechanism>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findEntityConflict(
        transaction,
        userId,
        context,
        input.name,
        input.aliases,
      );
      if (conflict) {
        return conflict;
      }
      if (input.owner && !(await holderExists(transaction, userId, context, input.owner))) {
        return { kind: "target_not_found" };
      }
      if (
        input.powerSystem &&
        !(await entityExists(transaction, userId, context, input.powerSystem.id, "power_system"))
      ) {
        return { kind: "target_not_found" };
      }
      const now = new Date();
      const mechanismId = uuidv7();
      const versionNodeId = uuidv7();
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "golden_finger",
        mechanismId,
        "mechanism.created",
        "创建特殊机制",
      );
      await transaction.insert(entities).values({
        id: mechanismId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        type: "golden_finger",
        name: input.name,
        aliases: input.aliases,
        summary: input.summary,
        description: input.description,
        attributes: {
          rules: input.rules,
          cost: input.costs,
          limits: input.limits,
          growth: input.growth,
        },
        tags: input.tags,
        status: "draft",
        source: "author",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(specialMechanisms).values({
        entityId: mechanismId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        mechanismType: input.mechanismType,
        ...ownerColumns(input.owner),
        powerSystemId: input.powerSystem?.id ?? null,
        rules: input.rules,
        costs: input.costs,
        limits: input.limits,
        growth: input.growth,
        createdAt: now,
        updatedAt: now,
      });
      if (input.owner) {
        await transaction.insert(mechanismOwnershipEvents).values({
          id: uuidv7(),
          mechanismId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          previousOwnerType: null,
          previousOwnerId: null,
          previousOwnerLabel: null,
          ownerType: input.owner.type,
          ownerId: input.owner.id,
          ownerLabel: input.owner.label,
          reason: "创建机制时记录所有权。",
          validFromChapter: 1,
          validToChapter: null,
          ...storyTimeColumns({
            fromChapter: 1,
            toChapter: null,
            fromStoryTime: null,
            toStoryTime: null,
          }),
          evidence: [],
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        });
      }
      const entity = await findEntity(transaction, userId, context, mechanismId, "golden_finger");
      if (!entity) {
        throw new Error("Created mechanism entity is missing");
      }
      await appendSnapshotAtVersion(transaction, userId, context, entity, versionNodeId, audit);
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, context.branchId));
      const detail = await this.readMechanismInTransaction(
        transaction,
        userId,
        context,
        mechanismId,
        {},
      );
      if (!detail) {
        throw new Error("Created mechanism is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async updateMechanism(
    userId: string,
    context: PowerItemsWorkContext,
    mechanismId: string,
    input: SpecialMechanismPatchRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<SpecialMechanism>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        mechanismId,
        "golden_finger",
        input.version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (
        input.powerSystem &&
        !(await entityExists(transaction, userId, context, input.powerSystem.id, "power_system"))
      ) {
        return { kind: "target_not_found" };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "golden_finger",
        mechanismId,
        "mechanism.updated",
        "更新特殊机制",
      );
      await transaction
        .update(entities)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.rules !== undefined ||
          input.costs !== undefined ||
          input.limits !== undefined ||
          input.growth !== undefined ||
          input.mechanismType !== undefined
            ? {
                attributes: {
                  ...withoutMechanismType(current.value.attributes),
                  ...(input.rules !== undefined ? { rules: input.rules } : {}),
                  ...(input.costs !== undefined ? { cost: input.costs } : {}),
                  ...(input.limits !== undefined ? { limits: input.limits } : {}),
                  ...(input.growth !== undefined ? { growth: input.growth } : {}),
                },
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(entities.id, mechanismId));
      await transaction
        .insert(specialMechanisms)
        .values({
          entityId: mechanismId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          mechanismType: input.mechanismType ?? "特殊机制",
          rules: input.rules ?? "",
          costs: input.costs ?? "",
          limits: input.limits ?? "",
          growth: input.growth ?? "",
          powerSystemId: input.powerSystem?.id ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: specialMechanisms.entityId,
          set: {
            ...(input.mechanismType !== undefined ? { mechanismType: input.mechanismType } : {}),
            ...(input.rules !== undefined ? { rules: input.rules } : {}),
            ...(input.costs !== undefined ? { costs: input.costs } : {}),
            ...(input.limits !== undefined ? { limits: input.limits } : {}),
            ...(input.growth !== undefined ? { growth: input.growth } : {}),
            ...(input.powerSystem !== undefined
              ? { powerSystemId: input.powerSystem?.id ?? null }
              : {}),
            updatedAt: now,
          },
        });
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readMechanismInTransaction(
        transaction,
        userId,
        context,
        mechanismId,
        {},
      );
      if (!detail) {
        throw new Error("Updated mechanism is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async transferMechanismOwnership(
    userId: string,
    context: PowerItemsWorkContext,
    mechanismId: string,
    input: SpecialMechanismOwnershipTransferRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<SpecialMechanism>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        mechanismId,
        "golden_finger",
        input.version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (!(await holderExists(transaction, userId, context, input.owner))) {
        return { kind: "target_not_found" };
      }
      const [mechanism] = await transaction
        .select()
        .from(specialMechanisms)
        .where(eq(specialMechanisms.entityId, mechanismId))
        .limit(1);
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "golden_finger",
        mechanismId,
        "mechanism.ownership.transferred",
        "转移特殊机制所有权",
      );
      await transaction.insert(mechanismOwnershipEvents).values({
        id: uuidv7(),
        mechanismId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        previousOwnerType: mechanism?.ownerType ?? null,
        previousOwnerId: mechanism?.ownerId ?? null,
        previousOwnerLabel: mechanism?.ownerLabel ?? null,
        ownerType: input.owner.type,
        ownerId: input.owner.id,
        ownerLabel: input.owner.label,
        reason: input.reason,
        validFromChapter: input.validity.fromChapter,
        validToChapter: input.validity.toChapter,
        ...storyTimeColumns(input.validity),
        evidence: input.evidence,
        versionNodeId,
        createdBy: userId,
        createdAt: now,
      });
      await transaction
        .insert(specialMechanisms)
        .values({
          entityId: mechanismId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          mechanismType: mechanism?.mechanismType ?? "特殊机制",
          rules: mechanism?.rules ?? "",
          ...ownerColumns(input.owner),
          costs: mechanism?.costs ?? "",
          limits: mechanism?.limits ?? "",
          growth: mechanism?.growth ?? "",
          powerSystemId: mechanism?.powerSystemId ?? null,
          createdAt: mechanism?.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: specialMechanisms.entityId,
          set: { ...ownerColumns(input.owner), updatedAt: now },
        });
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readMechanismInTransaction(
        transaction,
        userId,
        context,
        mechanismId,
        {},
      );
      if (!detail) {
        throw new Error("Transferred mechanism is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async listItems(
    userId: string,
    context: PowerItemsWorkContext,
    options: ReadOptions,
  ): Promise<ItemDomain[]> {
    return this.withTenant(userId, async (transaction) => {
      const rows = await transaction
        .select({ id: entities.id })
        .from(entities)
        .where(
          and(
            eq(entities.userId, userId),
            eq(entities.workId, context.workId),
            eq(entities.branchId, context.branchId),
            eq(entities.type, "item"),
            sql`${entities.deletedAt} is null`,
          ),
        )
        .orderBy(asc(entities.createdAt));
      const details: ItemDomain[] = [];
      for (const row of rows) {
        const detail = await this.readItemInTransaction(
          transaction,
          userId,
          context,
          row.id,
          options,
        );
        if (detail) {
          details.push(detail);
        }
      }
      return details;
    });
  }

  async getItem(
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    options: ReadOptions,
  ): Promise<ItemDomain | undefined> {
    return this.withTenant(userId, async (transaction) =>
      this.readItemInTransaction(transaction, userId, context, itemId, options),
    );
  }

  async createItem(
    userId: string,
    context: PowerItemsWorkContext,
    input: ItemCreateRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<ItemDomain>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const conflict = await findEntityConflict(
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
      const itemId = uuidv7();
      const versionNodeId = uuidv7();
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "item",
        itemId,
        "item.created",
        "创建物品功法",
      );
      await transaction.insert(entities).values({
        id: itemId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        type: "item",
        name: input.name,
        aliases: input.aliases,
        summary: input.summary,
        description: input.description,
        attributes: {
          category: input.category,
          grade: input.grade,
          effect: input.effect,
          cost: input.cost,
          ownership: "",
          limits: input.limits,
        },
        tags: input.tags,
        status: "draft",
        source: "author",
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await transaction.insert(itemTechniques).values({
        entityId: itemId,
        workId: context.workId,
        branchId: context.branchId,
        userId,
        kind: input.kind,
        category: input.category,
        grade: input.grade,
        effect: input.effect,
        cost: input.cost,
        limits: input.limits,
        ownershipModel: input.ownershipModel,
        consumable: input.consumable,
        quantity: input.quantity,
        equipmentSlot: input.equipmentSlot,
        createdAt: now,
        updatedAt: now,
      });
      const entity = await findEntity(transaction, userId, context, itemId, "item");
      if (!entity) {
        throw new Error("Created item entity is missing");
      }
      await appendSnapshotAtVersion(transaction, userId, context, entity, versionNodeId, audit);
      await transaction
        .update(workBranches)
        .set({ headNodeId: versionNodeId, updatedAt: now })
        .where(eq(workBranches.id, context.branchId));
      const detail = await this.readItemInTransaction(transaction, userId, context, itemId, {});
      if (!detail) {
        throw new Error("Created item is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async updateItem(
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    input: ItemPatchRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<ItemDomain>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        itemId,
        "item",
        input.version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const [existing] = await transaction
        .select()
        .from(itemTechniques)
        .where(eq(itemTechniques.entityId, itemId))
        .limit(1);
      const kind = input.kind ?? existing?.kind ?? "item";
      const equipmentSlot =
        input.equipmentSlot !== undefined ? input.equipmentSlot : (existing?.equipmentSlot ?? null);
      if (kind === "equipment" && equipmentSlot === null) {
        return { kind: "not_equipment" };
      }
      if (kind !== "equipment" && equipmentSlot !== null) {
        return { kind: "not_equipment" };
      }
      if (input.name !== undefined || input.aliases !== undefined) {
        const conflict = await findEntityConflict(
          transaction,
          userId,
          context,
          input.name ?? current.value.name,
          input.aliases ?? current.value.aliases,
          itemId,
        );
        if (conflict) {
          return conflict;
        }
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "item",
        itemId,
        "item.updated",
        "更新物品功法",
      );
      await transaction
        .update(entities)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.category !== undefined ||
          input.grade !== undefined ||
          input.effect !== undefined ||
          input.cost !== undefined ||
          input.limits !== undefined
            ? {
                attributes: {
                  ...current.value.attributes,
                  ...(input.category !== undefined ? { category: input.category } : {}),
                  ...(input.grade !== undefined ? { grade: input.grade } : {}),
                  ...(input.effect !== undefined ? { effect: input.effect } : {}),
                  ...(input.cost !== undefined ? { cost: input.cost } : {}),
                  ...(input.limits !== undefined ? { limits: input.limits } : {}),
                },
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(entities.id, itemId));
      await transaction
        .insert(itemTechniques)
        .values({
          entityId: itemId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          kind,
          category: input.category ?? existing?.category ?? "未分类",
          grade: input.grade ?? existing?.grade ?? "",
          effect: input.effect ?? existing?.effect ?? current.value.summary,
          cost: input.cost ?? existing?.cost ?? "",
          limits: input.limits ?? existing?.limits ?? "",
          ownershipModel: input.ownershipModel ?? existing?.ownershipModel ?? "shared",
          consumable: input.consumable ?? existing?.consumable ?? false,
          quantity: existing?.quantity ?? 1,
          equipmentSlot,
          equippedByType: existing?.equippedByType ?? null,
          equippedById: existing?.equippedById ?? null,
          equippedByLabel: existing?.equippedByLabel ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: itemTechniques.entityId,
          set: {
            ...(input.kind !== undefined ? { kind: input.kind } : {}),
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.grade !== undefined ? { grade: input.grade } : {}),
            ...(input.effect !== undefined ? { effect: input.effect } : {}),
            ...(input.cost !== undefined ? { cost: input.cost } : {}),
            ...(input.limits !== undefined ? { limits: input.limits } : {}),
            ...(input.ownershipModel !== undefined ? { ownershipModel: input.ownershipModel } : {}),
            ...(input.consumable !== undefined ? { consumable: input.consumable } : {}),
            ...(input.equipmentSlot !== undefined ? { equipmentSlot: input.equipmentSlot } : {}),
            updatedAt: now,
          },
        });
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readItemInTransaction(transaction, userId, context, itemId, {});
      if (!detail) {
        throw new Error("Updated item is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async grantItemRight(
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    input: ItemRightGrantRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<ItemRight>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(transaction, userId, context, itemId, "item", null);
      if (current.kind !== "ok") {
        return current;
      }
      if (!(await holderExists(transaction, userId, context, input.holder))) {
        return { kind: "target_not_found" };
      }
      const [item] = await transaction
        .select()
        .from(itemTechniques)
        .where(eq(itemTechniques.entityId, itemId))
        .limit(1);
      if (!item) {
        return { kind: "not_found" };
      }
      const existing = await transaction
        .select()
        .from(itemRights)
        .where(and(eq(itemRights.itemId, itemId), eq(itemRights.userId, userId)));
      const findings = validateItemRightSet(
        { ownershipModel: item.ownershipModel as "shared" | "unique", quantity: item.quantity },
        [
          ...existing.map((right) => ({
            rightType: right.rightType as ItemRight["rightType"],
            holderId: right.holderId,
            sharePercent: right.sharePercent,
            validity: {
              fromChapter: right.validFromChapter,
              toChapter: right.validToChapter,
            },
          })),
          {
            rightType: input.rightType,
            holderId: input.holder.id,
            sharePercent: input.sharePercent,
            validity: {
              fromChapter: input.validity.fromChapter,
              toChapter: input.validity.toChapter,
            },
          },
        ],
      );
      if (findings.length > 0) {
        return {
          kind: "item_right_conflict",
          findings: findings.map((finding) => finding.code),
        };
      }
      const now = new Date();
      const rightId = uuidv7();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "item_right",
        rightId,
        "item.right.granted",
        "记录物品权利",
      );
      const [right] = await transaction
        .insert(itemRights)
        .values({
          id: rightId,
          itemId,
          workId: context.workId,
          branchId: context.branchId,
          userId,
          rightType: input.rightType,
          holderType: input.holder.type,
          holderId: input.holder.id,
          holderLabel: input.holder.label,
          sharePercent: input.sharePercent,
          validFromChapter: input.validity.fromChapter,
          validToChapter: input.validity.toChapter,
          ...storyTimeColumns(input.validity),
          sourceChapterId: input.sourceChapterId,
          evidence: input.evidence,
          reason: input.reason,
          versionNodeId,
          createdBy: userId,
          createdAt: now,
        })
        .returning();
      if (!right) {
        throw new Error("Created item right is missing");
      }
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      return { kind: "ok", value: toItemRightContract(right) };
    });
  }

  async consumeItem(
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    input: ItemConsumeRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<ItemDomain>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        itemId,
        "item",
        input.version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const [item] = await transaction
        .select()
        .from(itemTechniques)
        .where(eq(itemTechniques.entityId, itemId))
        .limit(1);
      if (!item) {
        return { kind: "not_found" };
      }
      const consumption = validateItemConsumption(
        { consumable: item.consumable, quantity: item.quantity },
        input.quantity,
      );
      if (!consumption.ok) {
        return consumption.code === "ITEM_NOT_CONSUMABLE"
          ? { kind: "item_not_consumable" }
          : { kind: "item_quantity_insufficient" };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "item",
        itemId,
        "item.consumed",
        "消耗物品",
      );
      await transaction
        .update(itemTechniques)
        .set({ quantity: consumption.remaining, updatedAt: now })
        .where(eq(itemTechniques.entityId, itemId));
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readItemInTransaction(transaction, userId, context, itemId, {});
      if (!detail) {
        throw new Error("Consumed item is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async equipItem(
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    input: ItemEquipRequest,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<ItemDomain>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        itemId,
        "item",
        input.version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      if (!(await holderExists(transaction, userId, context, input.holder))) {
        return { kind: "target_not_found" };
      }
      const [item] = await transaction
        .select()
        .from(itemTechniques)
        .where(eq(itemTechniques.entityId, itemId))
        .limit(1);
      if (!item) {
        return { kind: "not_found" };
      }
      if (item.kind !== "equipment" || item.equipmentSlot === null) {
        return { kind: "not_equipment" };
      }
      const assigned = await transaction
        .select()
        .from(itemTechniques)
        .where(
          and(
            eq(itemTechniques.userId, userId),
            eq(itemTechniques.workId, context.workId),
            eq(itemTechniques.branchId, context.branchId),
            eq(itemTechniques.equippedByType, input.holder.type),
            eq(itemTechniques.equippedById, input.holder.id),
          ),
        );
      const conflicts = findEquipmentSlotConflicts([
        ...assigned
          .filter((entry) => entry.entityId !== itemId)
          .map((entry) => ({
            itemId: entry.entityId,
            holderId: input.holder.id,
            slot: entry.equipmentSlot ?? "",
            equipped: true,
          })),
        {
          itemId,
          holderId: input.holder.id,
          slot: item.equipmentSlot,
          equipped: true,
        },
      ]);
      if (conflicts.length > 0) {
        return { kind: "equipment_conflict" };
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "item",
        itemId,
        "item.equipped",
        "装备物品",
      );
      await transaction
        .update(itemTechniques)
        .set({
          equippedByType: input.holder.type,
          equippedById: input.holder.id,
          equippedByLabel: input.holder.label,
          updatedAt: now,
        })
        .where(eq(itemTechniques.entityId, itemId));
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readItemInTransaction(transaction, userId, context, itemId, {});
      if (!detail) {
        throw new Error("Equipped item is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  async unequipItem(
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    version: number,
    audit: PowerItemsAuditContext,
  ): Promise<PowerItemsWriteResult<ItemDomain>> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const current = await findWritableEntity(
        transaction,
        userId,
        context,
        itemId,
        "item",
        version,
      );
      if (current.kind !== "ok") {
        return current;
      }
      const now = new Date();
      const versionNodeId = uuidv7();
      const headNodeId = await requireBranchHead(transaction, userId, context);
      await insertVersionNode(
        transaction,
        userId,
        context,
        headNodeId,
        versionNodeId,
        "item",
        itemId,
        "item.unequipped",
        "卸下物品",
      );
      await transaction
        .update(itemTechniques)
        .set({
          equippedByType: null,
          equippedById: null,
          equippedByLabel: null,
          updatedAt: now,
        })
        .where(eq(itemTechniques.entityId, itemId));
      const updated = await advanceEntityVersion(
        transaction,
        current.value,
        versionNodeId,
        context,
        now,
      );
      await appendSnapshotAtVersion(transaction, userId, context, updated, versionNodeId, audit);
      const detail = await this.readItemInTransaction(transaction, userId, context, itemId, {});
      if (!detail) {
        throw new Error("Unequipped item is missing");
      }
      return { kind: "ok", value: detail };
    });
  }

  private async readPowerSystemInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: PowerItemsWorkContext,
    powerSystemId: string,
    options: ReadOptions,
  ): Promise<PowerSystem | undefined> {
    const entity = await findEntity(transaction, userId, context, powerSystemId, "power_system");
    if (!entity) {
      return undefined;
    }
    const [row] = await transaction
      .select()
      .from(powerSystems)
      .where(eq(powerSystems.entityId, powerSystemId))
      .limit(1);
    const policy = row ? lifespanFromRow(row) : emptyLifespanPolicy();
    const paths = row
      ? await this.readPaths(transaction, userId, (path) => path.powerSystemId === powerSystemId)
      : [];
    const health = powerSystemHealth(policy, paths, options.chapterNumber);
    return {
      powerSystem: entityRef(entity),
      overview:
        row?.overview ??
        (typeof entity.attributes.details === "string" ? entity.attributes.details : ""),
      lifespanPolicy: policy,
      paths,
      health,
      version: entity.version,
      latestVersionNodeId: await latestEntityVersionNodeId(transaction, powerSystemId),
      status: entity.status as PowerSystem["status"],
      lockedAt: entity.lockedAt?.toISOString() ?? null,
    };
  }

  private async readPaths(
    transaction: DatabaseTransaction,
    userId: string,
    predicate: (path: PowerPathRecord) => boolean,
  ): Promise<PowerPath[]> {
    const pathRows = await transaction
      .select()
      .from(powerPaths)
      .where(eq(powerPaths.userId, userId))
      .orderBy(asc(powerPaths.sortOrder), asc(powerPaths.createdAt));
    return Promise.all(
      pathRows.filter(predicate).map(async (path) => {
        const realmRows = await transaction
          .select()
          .from(powerRealms)
          .where(eq(powerRealms.pathId, path.id))
          .orderBy(asc(powerRealms.rank), asc(powerRealms.createdAt));
        return {
          id: path.id,
          powerSystemId: path.powerSystemId,
          workId: path.workId,
          branchId: path.branchId,
          name: path.name,
          pathType: path.pathType,
          description: path.description,
          sortOrder: path.sortOrder,
          realms: realmRows.map((realm) => toRealmContract(realm)),
          versionNodeId: path.versionNodeId,
          createdAt: path.createdAt.toISOString(),
        };
      }),
    );
  }

  private async readMechanismInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: PowerItemsWorkContext,
    mechanismId: string,
    options: ReadOptions,
  ): Promise<SpecialMechanism | undefined> {
    const entity = await findEntity(transaction, userId, context, mechanismId, "golden_finger");
    if (!entity) {
      return undefined;
    }
    const [row] = await transaction
      .select()
      .from(specialMechanisms)
      .where(eq(specialMechanisms.entityId, mechanismId))
      .limit(1);
    const events = row
      ? await transaction
          .select()
          .from(mechanismOwnershipEvents)
          .where(eq(mechanismOwnershipEvents.mechanismId, mechanismId))
          .orderBy(asc(mechanismOwnershipEvents.createdAt))
      : [];
    const ownershipHistory = events
      .map((event) => toOwnershipRecord(event))
      .filter((record) => chapterActive(record.validity, options.chapterNumber));
    const owner = row ? ownerRef(row) : null;
    const linkedPowerSystem = row?.powerSystemId
      ? await findEntity(transaction, userId, context, row.powerSystemId, "power_system")
      : undefined;
    const powerSystem = row?.powerSystemId
      ? linkedPowerSystem
        ? entityRef(linkedPowerSystem)
        : syntheticRef("power_system", row.powerSystemId, context.branchId)
      : null;
    const health = mechanismHealth(owner, powerSystem);
    return {
      mechanism: entityRef(entity),
      mechanismType:
        row?.mechanismType ?? stringAttribute(entity.attributes.mechanismType) ?? "特殊机制",
      owner,
      powerSystem,
      rules: row?.rules ?? stringAttribute(entity.attributes.rules) ?? entity.summary,
      costs: row?.costs ?? stringAttribute(entity.attributes.cost) ?? "",
      limits: row?.limits ?? stringAttribute(entity.attributes.limits) ?? "",
      growth: row?.growth ?? stringAttribute(entity.attributes.growth) ?? "",
      ownershipHistory,
      health,
      version: entity.version,
      latestVersionNodeId: await latestEntityVersionNodeId(transaction, mechanismId),
      status: entity.status as SpecialMechanism["status"],
      lockedAt: entity.lockedAt?.toISOString() ?? null,
    };
  }

  private async readItemInTransaction(
    transaction: DatabaseTransaction,
    userId: string,
    context: PowerItemsWorkContext,
    itemId: string,
    options: ReadOptions,
  ): Promise<ItemDomain | undefined> {
    const entity = await findEntity(transaction, userId, context, itemId, "item");
    if (!entity) {
      return undefined;
    }
    const [row] = await transaction
      .select()
      .from(itemTechniques)
      .where(eq(itemTechniques.entityId, itemId))
      .limit(1);
    const rightRows = await transaction
      .select()
      .from(itemRights)
      .where(and(eq(itemRights.itemId, itemId), eq(itemRights.userId, userId)))
      .orderBy(asc(itemRights.validFromChapter), asc(itemRights.createdAt));
    const rights = rightRows
      .map((right) => toItemRightContract(right))
      .filter((right) => chapterActive(right.validity, options.chapterNumber));
    const quantity = row?.quantity ?? 1;
    const ownershipModel = (row?.ownershipModel ?? "shared") as ItemDomain["ownershipModel"];
    const itemHealth = itemHealthFindings({
      quantity,
      ownershipModel,
      kind: (row?.kind ?? "item") as ItemDomain["kind"],
      equippedBy: row?.equippedById ?? null,
      rights,
      chapterNumber: options.chapterNumber,
    });
    return {
      item: entityRef(entity),
      kind: (row?.kind ?? "item") as ItemDomain["kind"],
      category: row?.category ?? stringAttribute(entity.attributes.category) ?? "未分类",
      grade: row?.grade ?? stringAttribute(entity.attributes.grade) ?? "",
      effect: row?.effect ?? stringAttribute(entity.attributes.effect) ?? entity.summary,
      cost: row?.cost ?? stringAttribute(entity.attributes.cost) ?? "",
      limits: row?.limits ?? stringAttribute(entity.attributes.limits) ?? "",
      ownershipModel,
      consumable: row?.consumable ?? false,
      quantity,
      equipmentSlot: row?.equipmentSlot ?? null,
      equippedBy:
        row?.equippedById && row.equippedByType
          ? syntheticRef(
              row.equippedByType as DomainRef["type"],
              row.equippedById,
              context.branchId,
              row.equippedByLabel,
            )
          : null,
      rights,
      health: itemHealth,
      version: entity.version,
      latestVersionNodeId: await latestEntityVersionNodeId(transaction, itemId),
      status: entity.status as ItemDomain["status"],
      lockedAt: entity.lockedAt?.toISOString() ?? null,
    };
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

interface PlannedRealm extends PowerRealmCreateRequest {
  id: string;
}

interface PlannedPath extends Omit<PowerPathCreateRequest, "realms"> {
  id: string;
  realms: PlannedRealm[];
}

function planNestedRealms(paths: PowerPathCreateRequest[]): PlannedPath[] {
  return paths.map((path) => ({
    ...path,
    id: uuidv7(),
    realms: path.realms.map((realm) => ({ ...realm, id: uuidv7() })),
  }));
}

async function findEntity(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  entityId: string,
  type: "power_system" | "golden_finger" | "item",
): Promise<EntityRecord | undefined> {
  const [entity] = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, type),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .limit(1);
  return entity;
}

async function entityExists(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  entityId: string,
  type: "power_system" | "golden_finger" | "item",
): Promise<boolean> {
  return Boolean(await findEntity(transaction, userId, context, entityId, type));
}

async function findWritableEntity(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  entityId: string,
  type: "power_system" | "golden_finger" | "item",
  expectedVersion: number | null,
): Promise<
  | { kind: "ok"; value: EntityRecord }
  | { kind: "not_found" }
  | { kind: "locked" }
  | { kind: "proposal_state" }
  | { kind: "version_conflict" }
> {
  const [entity] = await transaction
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.id, entityId),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, type),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .for("update")
    .limit(1);
  if (!entity) {
    return { kind: "not_found" };
  }
  if (entity.status === "locked") {
    return { kind: "locked" };
  }
  if (entity.status === "proposed" || entity.status === "discarded") {
    return { kind: "proposal_state" };
  }
  if (expectedVersion !== null && entity.version !== expectedVersion) {
    return { kind: "version_conflict" };
  }
  return { kind: "ok", value: entity };
}

async function findPath(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  powerSystemId: string,
  pathId: string,
): Promise<PowerPathRecord | undefined> {
  const [path] = await transaction
    .select()
    .from(powerPaths)
    .where(
      and(
        eq(powerPaths.id, pathId),
        eq(powerPaths.userId, userId),
        eq(powerPaths.workId, context.workId),
        eq(powerPaths.branchId, context.branchId),
        eq(powerPaths.powerSystemId, powerSystemId),
      ),
    )
    .limit(1);
  return path;
}

async function readPath(
  transaction: DatabaseTransaction,
  pathId: string,
): Promise<PowerPath | undefined> {
  const [path] = await transaction
    .select()
    .from(powerPaths)
    .where(eq(powerPaths.id, pathId))
    .limit(1);
  if (!path) {
    return undefined;
  }
  const realms = await transaction
    .select()
    .from(powerRealms)
    .where(eq(powerRealms.pathId, pathId))
    .orderBy(asc(powerRealms.rank));
  return {
    id: path.id,
    powerSystemId: path.powerSystemId,
    workId: path.workId,
    branchId: path.branchId,
    name: path.name,
    pathType: path.pathType,
    description: path.description,
    sortOrder: path.sortOrder,
    realms: realms.map((realm) => toRealmContract(realm)),
    versionNodeId: path.versionNodeId,
    createdAt: path.createdAt.toISOString(),
  };
}

async function readRealm(
  transaction: DatabaseTransaction,
  realmId: string,
): Promise<PowerRealm | undefined> {
  const [realm] = await transaction
    .select()
    .from(powerRealms)
    .where(eq(powerRealms.id, realmId))
    .limit(1);
  return realm ? toRealmContract(realm) : undefined;
}

async function holderExists(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  holder: DomainRef,
): Promise<boolean> {
  if (holder.branchId !== context.branchId) {
    return false;
  }
  if (holder.type === "map_node") {
    const [node] = await transaction
      .select({ id: mapNodes.id })
      .from(mapNodes)
      .where(
        and(
          eq(mapNodes.id, holder.id),
          eq(mapNodes.userId, userId),
          eq(mapNodes.workId, context.workId),
          eq(mapNodes.branchId, context.branchId),
        ),
      )
      .limit(1);
    return Boolean(node);
  }
  if (
    holder.type !== "character" &&
    holder.type !== "faction" &&
    holder.type !== "item" &&
    holder.type !== "map"
  ) {
    return false;
  }
  const [entity] = await transaction
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.id, holder.id),
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        eq(entities.type, holder.type),
        sql`${entities.deletedAt} is null`,
      ),
    )
    .limit(1);
  return Boolean(entity);
}

async function findEntityConflict(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  name: string,
  aliases: string[],
  ignoreEntityId?: string,
): Promise<{ kind: "name_conflict" } | { kind: "alias_conflict" } | undefined> {
  const normalizedName = normalizeIdentifier(name);
  const normalizedAliases = aliases.map(normalizeIdentifier);
  if (
    new Set(normalizedAliases).size !== normalizedAliases.length ||
    normalizedAliases.includes(normalizedName)
  ) {
    return { kind: "alias_conflict" };
  }
  const rows = await transaction
    .select({ id: entities.id, name: entities.name, aliases: entities.aliases })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.workId, context.workId),
        eq(entities.branchId, context.branchId),
        sql`${entities.deletedAt} is null`,
      ),
    );
  for (const row of rows) {
    if (ignoreEntityId && row.id === ignoreEntityId) {
      continue;
    }
    if (normalizeIdentifier(row.name) === normalizedName) {
      return { kind: "name_conflict" };
    }
    const identifiers = [row.name, ...row.aliases].map(normalizeIdentifier);
    if (normalizedAliases.some((alias) => identifiers.includes(alias))) {
      return { kind: "alias_conflict" };
    }
  }
  return undefined;
}

async function insertVersionNode(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  parentNodeId: string,
  versionNodeId: string,
  objectType: string,
  objectId: string,
  action: string,
  message: string,
): Promise<void> {
  await transaction.insert(versionNodes).values({
    id: versionNodeId,
    workId: context.workId,
    branchId: context.branchId,
    userId,
    parentNodeId,
    nodeType: "entity_version",
    objectType,
    objectId,
    objectVersion: 1,
    snapshotId: null,
    payload: { action },
    actorId: userId,
    message,
    createdAt: new Date(),
  });
}

async function appendSnapshotAtVersion(
  transaction: DatabaseTransaction,
  userId: string,
  context: PowerItemsWorkContext,
  entity: EntityRecord,
  versionNodeId: string,
  audit: PowerItemsAuditContext,
): Promise<void> {
  const entityVersionId = uuidv7();
  const snapshot = entitySnapshot(entity);
  if (entity.type === "power_system") {
    const [powerSystem] = await transaction
      .select()
      .from(powerSystems)
      .where(
        and(
          eq(powerSystems.entityId, entity.id),
          eq(powerSystems.userId, userId),
          eq(powerSystems.workId, context.workId),
          eq(powerSystems.branchId, context.branchId),
        ),
      )
      .limit(1);
    if (powerSystem) {
      const pathRows = await transaction
        .select()
        .from(powerPaths)
        .where(
          and(
            eq(powerPaths.powerSystemId, entity.id),
            eq(powerPaths.userId, userId),
            eq(powerPaths.workId, context.workId),
            eq(powerPaths.branchId, context.branchId),
          ),
        )
        .orderBy(asc(powerPaths.sortOrder), asc(powerPaths.createdAt));
      const paths = await Promise.all(
        pathRows.map(async (path) => {
          const realmRows = await transaction
            .select()
            .from(powerRealms)
            .where(
              and(
                eq(powerRealms.pathId, path.id),
                eq(powerRealms.userId, userId),
                eq(powerRealms.workId, context.workId),
                eq(powerRealms.branchId, context.branchId),
              ),
            )
            .orderBy(asc(powerRealms.rank), asc(powerRealms.createdAt));
          return {
            id: path.id,
            powerSystemId: path.powerSystemId,
            workId: path.workId,
            branchId: path.branchId,
            name: path.name,
            pathType: path.pathType,
            description: path.description,
            sortOrder: path.sortOrder,
            realms: realmRows.map(toRealmContract),
            versionNodeId: path.versionNodeId,
            createdAt: path.createdAt.toISOString(),
          };
        }),
      );
      snapshot.domain = {
        overview: powerSystem.overview,
        lifespanPolicy: lifespanFromRow(powerSystem),
        paths,
      };
    }
  }
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
  await writeAudit(transaction, userId, audit, "world.versioned", entity.type, entity.id);
}

async function advanceEntityVersion(
  transaction: DatabaseTransaction,
  entity: EntityRecord,
  versionNodeId: string,
  context: PowerItemsWorkContext,
  now: Date,
): Promise<EntityRecord> {
  const [updated] = await transaction
    .update(entities)
    .set({ version: entity.version + 1, updatedAt: now })
    .where(and(eq(entities.id, entity.id), eq(entities.version, entity.version)))
    .returning();
  if (!updated) {
    throw new Error("Domain entity changed while applying a versioned write");
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
  context: PowerItemsWorkContext,
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
    throw new Error("Domain branch is missing its version head");
  }
  return branch.headNodeId;
}

async function lockBranch(transaction: DatabaseTransaction, branchId: string): Promise<void> {
  await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${branchId}))`);
}

async function writeAudit(
  transaction: DatabaseTransaction,
  userId: string,
  audit: PowerItemsAuditContext,
  action: string,
  targetType: string,
  targetId: string,
): Promise<void> {
  await transaction.insert(auditLogs).values({
    id: uuidv7(),
    actorId: userId,
    action,
    targetType,
    targetId,
    decision: "allowed",
    correlationId: audit.requestId,
    ip: audit.ip,
    userAgent: audit.userAgent,
  });
}

async function latestEntityVersionNodeId(
  transaction: DatabaseTransaction,
  entityId: string,
): Promise<string> {
  const [row] = await transaction
    .select({ versionNodeId: entityVersions.versionNodeId })
    .from(entityVersions)
    .where(eq(entityVersions.entityId, entityId))
    .orderBy(desc(entityVersions.version))
    .limit(1);
  if (!row) {
    throw new Error("Domain entity has no version node");
  }
  return row.versionNodeId;
}

function lifespanColumns(policy: PowerLifespanPolicy) {
  return {
    lifespanMode: policy.mode,
    lifespanUnit: policy.unit,
    lifespanBasis: policy.basis,
    lifespanDescription: policy.description,
    lifespanPathId: policy.pathId,
    lifespanFixedAmount: policy.fixedAmount,
  };
}

function lifespanFromRow(row: PowerSystemRecord): PowerLifespanPolicy {
  return {
    mode: row.lifespanMode as PowerLifespanPolicy["mode"],
    unit: row.lifespanUnit,
    basis: row.lifespanBasis,
    description: row.lifespanDescription,
    pathId: row.lifespanPathId,
    fixedAmount: row.lifespanFixedAmount,
  };
}

function emptyLifespanPolicy(): PowerLifespanPolicy {
  return {
    mode: "none",
    unit: "年",
    basis: "",
    description: "",
    pathId: null,
    fixedAmount: null,
  };
}

function ownerColumns(owner: DomainRef | null): MechanismOwnerColumns {
  return {
    ownerType: owner?.type ?? null,
    ownerId: owner?.id ?? null,
    ownerLabel: owner?.label ?? null,
  };
}

function ownerRef(row: MechanismRecord): DomainRef | null {
  if (!row.ownerType || !row.ownerId) {
    return null;
  }
  return syntheticRef(
    row.ownerType as DomainRef["type"],
    row.ownerId,
    row.branchId,
    row.ownerLabel,
  );
}

function storyTimeColumns(validity: ValidityInterval): StoryTimeColumns {
  return {
    fromEra: validity.fromStoryTime?.era ?? null,
    fromStoryTimeLabel: validity.fromStoryTime?.label ?? null,
    fromStorySortKey: validity.fromStoryTime?.sortKey ?? null,
    toEra: validity.toStoryTime?.era ?? null,
    toStoryTimeLabel: validity.toStoryTime?.label ?? null,
    toStorySortKey: validity.toStoryTime?.sortKey ?? null,
  };
}

function validityFromRow(row: ValidityColumns): ValidityInterval {
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

function chapterActive(validity: ValidityInterval, chapterNumber?: number): boolean {
  return (
    chapterNumber === undefined ||
    (validity.fromChapter <= chapterNumber &&
      (validity.toChapter === null || validity.toChapter >= chapterNumber))
  );
}

function toRealmContract(realm: PowerRealmRecord): PowerRealm {
  return {
    id: realm.id,
    pathId: realm.pathId,
    workId: realm.workId,
    branchId: realm.branchId,
    name: realm.name,
    rank: realm.rank,
    description: realm.description,
    breakthroughConditions: realm.breakthroughConditions,
    breakthroughCosts: realm.breakthroughCosts,
    bottlenecks: realm.bottlenecks,
    counters: realm.counters,
    counteredBy: realm.counteredBy,
    lifespanAmount: realm.lifespanAmount,
    prerequisiteRealmId: realm.prerequisiteRealmId,
    versionNodeId: realm.versionNodeId,
    createdAt: realm.createdAt.toISOString(),
  };
}

function toOwnershipRecord(event: OwnershipEventRecord): SpecialMechanismOwnershipRecord {
  return {
    id: event.id,
    mechanismId: event.mechanismId,
    workId: event.workId,
    branchId: event.branchId,
    previousOwner:
      event.previousOwnerType && event.previousOwnerId
        ? syntheticRef(
            event.previousOwnerType as DomainRef["type"],
            event.previousOwnerId,
            event.branchId,
            event.previousOwnerLabel,
          )
        : null,
    owner: syntheticRef(
      event.ownerType as DomainRef["type"],
      event.ownerId,
      event.branchId,
      event.ownerLabel,
    ),
    reason: event.reason,
    validity: validityFromRow(event),
    evidence: event.evidence as SettingEvidence[],
    versionNodeId: event.versionNodeId,
    createdBy: event.createdBy,
    createdAt: event.createdAt.toISOString(),
  };
}

function toItemRightContract(row: ItemRightRecord): ItemRight {
  return {
    id: row.id,
    itemId: row.itemId,
    workId: row.workId,
    branchId: row.branchId,
    rightType: row.rightType as ItemRight["rightType"],
    holder: syntheticRef(
      row.holderType as DomainRef["type"],
      row.holderId,
      row.branchId,
      row.holderLabel,
    ),
    sharePercent: row.sharePercent,
    validity: validityFromRow(row),
    sourceChapterId: row.sourceChapterId,
    evidence: row.evidence as SettingEvidence[],
    reason: row.reason,
    versionNodeId: row.versionNodeId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function powerSystemHealth(
  policy: PowerLifespanPolicy,
  paths: PowerPath[],
  chapterNumber?: number,
): DomainHealthFinding[] {
  const findings: DomainHealthFinding[] = [];
  if (paths.length === 0) {
    findings.push({
      code: "POWER_SYSTEM_NO_PATHS",
      severity: "warning",
      message: "还没有记录力量路径。",
      relatedIds: [],
    });
  }
  for (const path of paths) {
    if (path.realms.length === 0) {
      findings.push({
        code: "POWER_PATH_NO_REALMS",
        severity: "warning",
        message: `路径“${path.name}”还没有境界。`,
        relatedIds: [path.id],
      });
    }
    for (const finding of validatePowerRealmLadder(
      path.realms.map((realm) => ({
        id: realm.id,
        pathId: path.id,
        rank: realm.rank,
        prerequisiteRealmId: realm.prerequisiteRealmId,
      })),
    )) {
      findings.push({
        code: finding.code,
        severity: "blocker",
        message: finding.message,
        relatedIds: finding.relatedIds,
      });
    }
    if (policy.mode === "realm") {
      for (const realm of path.realms) {
        const resolution = resolvePowerLifespan(policy, realm);
        if (resolution.issue) {
          findings.push({
            code: resolution.issue,
            severity: "warning",
            message: `境界“${realm.name}”缺少寿命配置。`,
            relatedIds: [realm.id],
          });
        }
      }
    }
  }
  if (
    policy.mode === "realm" &&
    policy.pathId &&
    !paths.some((path) => path.id === policy.pathId)
  ) {
    findings.push({
      code: "POWER_LIFESPAN_PATH_MISSING",
      severity: "blocker",
      message: "寿命策略绑定的路径不存在。",
      relatedIds: [policy.pathId],
    });
  }
  if (chapterNumber !== undefined && paths.length > 0) {
    findings.push({
      code: "POWER_SYSTEM_CHAPTER_FILTER_IGNORED",
      severity: "info",
      message: "力量体系结构不按章节失效，章节筛选只影响时序型引用。",
      relatedIds: [],
    });
  }
  return findings;
}

function mechanismHealth(
  owner: DomainRef | null,
  powerSystem: DomainRef | null,
): DomainHealthFinding[] {
  const findings: DomainHealthFinding[] = [];
  if (!owner) {
    findings.push({
      code: "MECHANISM_OWNER_MISSING",
      severity: "warning",
      message: "还没有记录机制所有者。",
      relatedIds: [],
    });
  }
  if (powerSystem && !powerSystem.label) {
    findings.push({
      code: "MECHANISM_POWER_SYSTEM_UNRESOLVED",
      severity: "warning",
      message: "机制关联的力量体系尚未解析名称。",
      relatedIds: [powerSystem.id],
    });
  }
  return findings;
}

function itemHealthFindings(input: {
  quantity: number;
  ownershipModel: ItemDomain["ownershipModel"];
  kind: ItemDomain["kind"];
  equippedBy: string | null;
  rights: ItemRight[];
  chapterNumber?: number | undefined;
}): DomainHealthFinding[] {
  const findings: DomainHealthFinding[] = [];
  for (const finding of validateItemRightSet(
    { ownershipModel: input.ownershipModel, quantity: input.quantity },
    input.rights.map((right) => ({
      rightType: right.rightType,
      holderId: right.holder.id,
      sharePercent: right.sharePercent,
      validity: {
        fromChapter: right.validity.fromChapter,
        toChapter: right.validity.toChapter,
      },
    })),
  )) {
    findings.push({
      code: finding.code,
      severity: "blocker",
      message: finding.message,
      relatedIds: finding.relatedIds.filter(isUuid),
    });
  }
  if (input.kind !== "equipment" && input.equippedBy) {
    findings.push({
      code: "ITEM_EQUIPPED_NON_EQUIPMENT",
      severity: "blocker",
      message: "非装备物品不能处于装备状态。",
      relatedIds: [],
    });
  }
  return findings;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function entityRef(entity: EntityRecord): DomainRef {
  return syntheticRef(entity.type as DomainRef["type"], entity.id, entity.branchId, entity.name);
}

function syntheticRef(
  type: DomainRef["type"],
  id: string,
  branchId: string,
  label: string | null = null,
): DomainRef {
  return { type, id, branchId, label, version: null };
}

function entitySnapshot(entity: EntityRecord): Record<string, unknown> {
  return {
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases,
    summary: entity.summary,
    description: entity.description,
    attributes: entity.attributes,
    tags: entity.tags,
    status: entity.status,
    source: entity.source,
    version: entity.version,
    lockedAt: entity.lockedAt?.toISOString() ?? null,
    lockedBy: entity.lockedBy,
  };
}

function normalizeIdentifier(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function withoutMechanismType(attributes: Record<string, unknown>): Record<string, unknown> {
  const next = { ...attributes };
  delete next.mechanismType;
  return next;
}
