import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  facts as canonicalFacts,
  createDatabaseClient,
  createDatabasePool,
  entities,
  entityVersions,
  versionNodes,
  workBranches,
  works,
  type DatabaseClient,
} from "@novel-brain/db";
import type {
  SettingEntityCreateRequest,
  SettingEntityListQuery,
  SettingEntityPatchRequest,
} from "@novel-brain/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type SettingEntityRecord = InferSelectModel<typeof entities>;
export type CanonFactRecord = InferSelectModel<typeof canonicalFacts>;

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
  ): Promise<SettingEntityRecord> {
    return this.withTenant(userId, async (transaction) => {
      await lockBranch(transaction, context.branchId);
      const headNodeId = await requireBranchHead(transaction, userId, context);
      const now = new Date();
      const [entity] = await transaction
        .insert(entities)
        .values({
          id: uuidv7(),
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
      await this.appendVersion(
        transaction,
        userId,
        entity,
        headNodeId,
        "setting.created",
        "创建设定",
        audit,
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
  ): Promise<"not_found" | "locked" | "version_conflict" | SettingEntityRecord> {
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
      if (current.version !== input.version) {
        return "version_conflict";
      }
      const headNodeId = await requireBranchHead(transaction, userId, context);
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
          updatedAt: new Date(),
        })
        .where(and(eq(entities.id, current.id), eq(entities.version, current.version)))
        .returning();
      if (!updated) {
        return "version_conflict";
      }
      await this.appendVersion(
        transaction,
        userId,
        updated,
        headNodeId,
        "setting.updated",
        "编辑设定",
        audit,
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
  ): Promise<"not_found" | "locked" | "version_conflict" | SettingEntityRecord> {
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
      await this.appendVersion(
        transaction,
        userId,
        locked,
        headNodeId,
        "setting.locked",
        "锁定设定",
        audit,
      );
      return locked;
    });
  }

  async remove(
    userId: string,
    context: SettingsWorkContext,
    entityId: string,
    audit: SettingsAuditContext,
  ): Promise<"not_found" | "locked" | SettingEntityRecord> {
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
      await this.appendVersion(
        transaction,
        userId,
        removed,
        headNodeId,
        "setting.deleted",
        "删除设定",
        audit,
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
  ): Promise<void> {
    const now = new Date();
    const entityVersionId = uuidv7();
    const versionNodeId = uuidv7();
    const snapshot = {
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
