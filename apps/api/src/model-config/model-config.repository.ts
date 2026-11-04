import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  createDatabaseClient,
  createDatabasePool,
  modelConfigs,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

export type ModelConfigRecord = InferSelectModel<typeof modelConfigs>;

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

  async list(userId: string): Promise<ModelConfigRecord[]> {
    return this.db
      .select()
      .from(modelConfigs)
      .where(eq(modelConfigs.userId, userId))
      .orderBy(desc(modelConfigs.isDefault), desc(modelConfigs.updatedAt));
  }

  async find(userId: string, id: string): Promise<ModelConfigRecord | undefined> {
    const [config] = await this.db
      .select()
      .from(modelConfigs)
      .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, userId)))
      .limit(1);
    return config;
  }

  async findByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<ModelConfigRecord | undefined> {
    const [config] = await this.db
      .select()
      .from(modelConfigs)
      .where(and(eq(modelConfigs.userId, userId), eq(modelConfigs.idempotencyKey, idempotencyKey)))
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
    encryptedKey: string;
    keyMasked: string;
    isDefault: boolean;
    idempotencyKey: string | null;
  }): Promise<ModelConfigRecord> {
    return this.db.transaction(async (transaction) => {
      if (input.isDefault) {
        await transaction
          .update(modelConfigs)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(modelConfigs.userId, input.userId));
      }
      const [config] = await transaction.insert(modelConfigs).values(input).returning();
      if (!config) {
        throw new Error("Failed to create model config");
      }
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
      encryptedKey: string;
      keyMasked: string;
      isDefault: boolean;
    }>,
  ): Promise<ModelConfigRecord | null> {
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: modelConfigs.id })
        .from(modelConfigs)
        .where(
          and(
            eq(modelConfigs.id, id),
            eq(modelConfigs.userId, userId),
            eq(modelConfigs.version, version),
          ),
        )
        .limit(1);
      if (!existing) {
        return null;
      }
      if (values.isDefault) {
        await transaction
          .update(modelConfigs)
          .set({ isDefault: false, updatedAt: new Date() })
          .where(eq(modelConfigs.userId, userId));
      }
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
          ),
        )
        .returning();
      return config ?? null;
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    return this.db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(modelConfigs)
        .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, userId)))
        .limit(1);
      if (!existing) {
        return false;
      }
      await transaction
        .delete(modelConfigs)
        .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, userId)));
      if (existing.isDefault) {
        const [replacement] = await transaction
          .select({ id: modelConfigs.id })
          .from(modelConfigs)
          .where(eq(modelConfigs.userId, userId))
          .orderBy(desc(modelConfigs.updatedAt))
          .limit(1);
        if (replacement) {
          await transaction
            .update(modelConfigs)
            .set({ isDefault: true, updatedAt: new Date() })
            .where(eq(modelConfigs.id, replacement.id));
        }
      }
      return true;
    });
  }

  async updateTestStatus(
    userId: string,
    id: string,
    status: string,
  ): Promise<ModelConfigRecord | null> {
    const [config] = await this.db
      .update(modelConfigs)
      .set({ lastTestStatus: status, lastTestedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(modelConfigs.id, id), eq(modelConfigs.userId, userId)))
      .returning();
    return config ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
