import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  createDatabaseClient,
  createDatabasePool,
  modelConfigs,
  type DatabaseClient,
} from "@novel-brain/db";
import type { CursorPageQuery } from "@novel-brain/contracts";
import { and, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

import { toCursorPage, type CursorPageResult } from "../common/cursor-page";

export type ModelConfigRecord = InferSelectModel<typeof modelConfigs>;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface ModelConfigAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

@Injectable()
export class ModelConfigRepository implements OnModuleDestroy {
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

  async list(
    userId: string,
    query: CursorPageQuery,
  ): Promise<CursorPageResult<ModelConfigRecord> | "invalid_cursor"> {
    const scope = and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt));
    const cursor = query.cursor
      ? (
          await this.db
            .select({
              id: modelConfigs.id,
              createdAt: modelConfigs.createdAt,
            })
            .from(modelConfigs)
            .where(and(scope, eq(modelConfigs.id, query.cursor)))
            .limit(1)
        )[0]
      : undefined;
    if (query.cursor && !cursor) {
      return "invalid_cursor";
    }
    const rows = await this.db
      .select()
      .from(modelConfigs)
      .where(
        and(
          scope,
          cursor
            ? or(
                lt(modelConfigs.createdAt, cursor.createdAt),
                and(eq(modelConfigs.createdAt, cursor.createdAt), lt(modelConfigs.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(modelConfigs.createdAt), desc(modelConfigs.id))
      .limit(query.limit + 1);
    return toCursorPage(rows, query.limit);
  }

  async find(userId: string, id: string): Promise<ModelConfigRecord | undefined> {
    const [config] = await this.db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.id, id),
          eq(modelConfigs.userId, userId),
          isNull(modelConfigs.deletedAt),
        ),
      )
      .limit(1);
    return config;
  }

  async hasOtherDefault(userId: string, id: string): Promise<boolean> {
    const [config] = await this.db
      .select({ id: modelConfigs.id })
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.userId, userId),
          eq(modelConfigs.isDefault, true),
          ne(modelConfigs.id, id),
          isNull(modelConfigs.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(config);
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<ModelConfigRecord | undefined> {
    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    const [config] = await this.db
      .select()
      .from(modelConfigs)
      .where(
        and(
          eq(modelConfigs.userId, userId),
          eq(modelConfigs.idempotencyKey, idempotencyKey),
          gt(modelConfigs.createdAt, cutoff),
        ),
      )
      .limit(1);
    return config;
  }

  async create(input: {
    id: string;
    userId: string;
    provider: string;
    label: string;
    baseUrl: string;
    model: string;
    purposes: string[];
    encryptedKey: string;
    keyMasked: string;
    isDefault: boolean;
    idempotencyKey: string | null;
    audit: ModelConfigAuditContext;
  }): Promise<ModelConfigRecord> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      if (input.idempotencyKey) {
        const [idempotentConfig] = await transaction
          .select()
          .from(modelConfigs)
          .where(
            and(
              eq(modelConfigs.userId, input.userId),
              eq(modelConfigs.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (idempotentConfig) {
          if (idempotentConfig.createdAt.getTime() >= Date.now() - IDEMPOTENCY_TTL_MS) {
            return idempotentConfig;
          }
          await transaction
            .update(modelConfigs)
            .set({ idempotencyKey: null })
            .where(eq(modelConfigs.id, idempotentConfig.id));
        }
      }
      const existing = await transaction
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, input.userId), isNull(modelConfigs.deletedAt)));
      const isDefault = existing.length === 0 ? true : input.isDefault;
      if (isDefault) {
        await transaction
          .update(modelConfigs)
          .set({
            isDefault: false,
            version: sql`${modelConfigs.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(modelConfigs.userId, input.userId), isNull(modelConfigs.deletedAt)));
      }
      const [config] = await transaction
        .insert(modelConfigs)
        .values({
          id: input.id,
          userId: input.userId,
          provider: input.provider,
          label: input.label,
          baseUrl: input.baseUrl,
          model: input.model,
          purposes: input.purposes,
          encryptedKey: input.encryptedKey,
          keyMasked: input.keyMasked,
          isDefault,
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      if (!config) {
        throw new Error("Failed to create model config");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "model_config.created",
        targetType: "model_config",
        targetId: config.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });
      return config;
    });
  }

  async update(
    userId: string,
    id: string,
    version: number,
    values: Partial<{
      label: string;
      baseUrl: string;
      model: string;
      purposes: string[];
      encryptedKey: string;
      keyMasked: string;
      isDefault: boolean;
    }>,
    audit: ModelConfigAuditContext,
  ): Promise<ModelConfigRecord | null> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [config] = await transaction
        .update(modelConfigs)
        .set({
          ...values,
          version: sql`${modelConfigs.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(modelConfigs.id, id),
            eq(modelConfigs.userId, userId),
            eq(modelConfigs.version, version),
            isNull(modelConfigs.deletedAt),
          ),
        )
        .returning();
      if (!config) {
        return null;
      }
      if (values.isDefault) {
        await transaction
          .update(modelConfigs)
          .set({
            isDefault: false,
            version: sql`${modelConfigs.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(modelConfigs.userId, userId),
              ne(modelConfigs.id, id),
              isNull(modelConfigs.deletedAt),
            ),
          );
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "model_config.updated",
        targetType: "model_config",
        targetId: config.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return config ?? null;
    });
  }

  async delete(
    userId: string,
    id: string,
    audit: ModelConfigAuditContext,
  ): Promise<"deleted" | "not_found" | "last_config"> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const configs = await transaction
        .select()
        .from(modelConfigs)
        .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)));
      const existing = configs.find((config) => config.id === id);
      if (!existing) {
        return "not_found";
      }
      if (configs.length === 1) {
        return "last_config";
      }
      await transaction
        .update(modelConfigs)
        .set({
          deletedAt: new Date(),
          isDefault: false,
          version: sql`${modelConfigs.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, userId)));
      if (existing.isDefault) {
        const [replacement] = await transaction
          .select({ id: modelConfigs.id })
          .from(modelConfigs)
          .where(and(eq(modelConfigs.userId, userId), isNull(modelConfigs.deletedAt)))
          .orderBy(desc(modelConfigs.updatedAt))
          .limit(1);
        if (replacement) {
          await transaction
            .update(modelConfigs)
            .set({
              isDefault: true,
              version: sql`${modelConfigs.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(modelConfigs.id, replacement.id));
        }
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "model_config.deleted",
        targetType: "model_config",
        targetId: existing.id,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return "deleted";
    });
  }

  async updateTestStatus(
    userId: string,
    id: string,
    status: string,
  ): Promise<ModelConfigRecord | null> {
    const [config] = await this.db
      .update(modelConfigs)
      .set({
        lastTestStatus: status,
        lastTestedAt: new Date(),
        version: sql`${modelConfigs.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(modelConfigs.id, id),
          eq(modelConfigs.userId, userId),
          isNull(modelConfigs.deletedAt),
        ),
      )
      .returning();
    return config ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
