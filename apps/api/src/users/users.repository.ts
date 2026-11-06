import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  auditLogs,
  createDatabaseClient,
  createDatabasePool,
  penNames,
  users,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";
import { uuidv7 } from "uuidv7";

export type UserProfileRecord = InferSelectModel<typeof users>;
export type PenNameRecord = InferSelectModel<typeof penNames>;

export interface ProfileAuditContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

export interface CreatePenNameInput {
  id: string;
  userId: string;
  name: string;
  bio: string;
  avatarUrl: string | null;
  isDefault: boolean;
  audit: ProfileAuditContext;
}

export interface UpdatePenNameInput {
  userId: string;
  penNameId: string;
  version: number;
  values: Partial<{
    name: string;
    bio: string;
    avatarUrl: string | null;
    isDefault: boolean;
  }>;
  audit: ProfileAuditContext;
}

@Injectable()
export class UsersRepository implements OnModuleDestroy {
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

  async updateProfile(
    userId: string,
    version: number,
    values: Partial<{
      displayName: string;
      bio: string;
      avatarUrl: string | null;
    }>,
    audit: ProfileAuditContext,
  ): Promise<UserProfileRecord | null> {
    return this.db.transaction(async (transaction) => {
      const [user] = await transaction
        .update(users)
        .set({
          ...values,
          version: sql`${users.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(users.id, userId), eq(users.version, version)))
        .returning();
      if (!user) {
        return null;
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "user.profile_updated",
        targetType: "user",
        targetId: userId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return user;
    });
  }

  async listPenNames(userId: string): Promise<PenNameRecord[]> {
    return this.db
      .select()
      .from(penNames)
      .where(and(eq(penNames.userId, userId), isNull(penNames.deletedAt)))
      .orderBy(desc(penNames.isDefault), desc(penNames.updatedAt));
  }

  async createPenName(input: CreatePenNameInput): Promise<PenNameRecord> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const existing = await transaction
        .select({ id: penNames.id })
        .from(penNames)
        .where(and(eq(penNames.userId, input.userId), isNull(penNames.deletedAt)));
      const isDefault = existing.length === 0 ? true : input.isDefault;
      if (isDefault) {
        await transaction
          .update(penNames)
          .set({
            isDefault: false,
            version: sql`${penNames.version} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(penNames.userId, input.userId), isNull(penNames.deletedAt)));
      }
      const [penName] = await transaction
        .insert(penNames)
        .values({
          id: input.id,
          userId: input.userId,
          name: input.name,
          bio: input.bio,
          avatarUrl: input.avatarUrl,
          isDefault,
        })
        .returning();
      if (!penName) {
        throw new Error("Failed to create pen name");
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "pen_name.created",
        targetType: "pen_name",
        targetId: penName.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });
      return penName;
    });
  }

  async updatePenName(
    input: UpdatePenNameInput,
  ): Promise<"not_found" | "version_conflict" | "last_default" | PenNameRecord> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [current] = await transaction
        .select()
        .from(penNames)
        .where(
          and(
            eq(penNames.id, input.penNameId),
            eq(penNames.userId, input.userId),
            isNull(penNames.deletedAt),
          ),
        )
        .limit(1);
      if (!current) {
        return "not_found";
      }
      if (current.version !== input.version) {
        return "version_conflict";
      }
      if (input.values.isDefault === false && current.isDefault) {
        return "last_default";
      }
      if (input.values.isDefault) {
        await transaction
          .update(penNames)
          .set({
            isDefault: false,
            version: sql`${penNames.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(penNames.userId, input.userId),
              ne(penNames.id, input.penNameId),
              isNull(penNames.deletedAt),
            ),
          );
      }
      const [penName] = await transaction
        .update(penNames)
        .set({
          ...input.values,
          version: sql`${penNames.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(penNames.id, input.penNameId), eq(penNames.version, input.version)))
        .returning();
      if (!penName) {
        return "version_conflict";
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: input.userId,
        action: "pen_name.updated",
        targetType: "pen_name",
        targetId: penName.id,
        decision: "allowed",
        correlationId: input.audit.requestId,
        ip: input.audit.ip,
        userAgent: input.audit.userAgent,
      });
      return penName;
    });
  }

  async deletePenName(
    userId: string,
    penNameId: string,
    audit: ProfileAuditContext,
  ): Promise<"not_found" | "deleted"> {
    return this.db.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [current] = await transaction
        .select()
        .from(penNames)
        .where(
          and(eq(penNames.id, penNameId), eq(penNames.userId, userId), isNull(penNames.deletedAt)),
        )
        .limit(1);
      if (!current) {
        return "not_found";
      }
      const now = new Date();
      await transaction
        .update(penNames)
        .set({
          deletedAt: now,
          isDefault: false,
          version: sql`${penNames.version} + 1`,
          updatedAt: now,
        })
        .where(eq(penNames.id, penNameId));
      if (current.isDefault) {
        const [replacement] = await transaction
          .select()
          .from(penNames)
          .where(and(eq(penNames.userId, userId), isNull(penNames.deletedAt)))
          .orderBy(desc(penNames.updatedAt))
          .limit(1);
        if (replacement) {
          await transaction
            .update(penNames)
            .set({
              isDefault: true,
              version: sql`${penNames.version} + 1`,
              updatedAt: now,
            })
            .where(eq(penNames.id, replacement.id));
        }
      }
      await transaction.insert(auditLogs).values({
        id: uuidv7(),
        actorId: userId,
        action: "pen_name.deleted",
        targetType: "pen_name",
        targetId: penNameId,
        decision: "allowed",
        correlationId: audit.requestId,
        ip: audit.ip,
        userAgent: audit.userAgent,
      });
      return "deleted";
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
