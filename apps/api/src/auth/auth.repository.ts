import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  createDatabaseClient,
  createDatabasePool,
  emailVerificationCodes,
  sessions,
  users,
  type DatabaseClient,
} from "@novel-brain/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import type { Pool } from "pg";

export type UserRecord = InferSelectModel<typeof users>;
export type SessionRecord = InferSelectModel<typeof sessions>;
export type EmailCodeRecord = InferSelectModel<typeof emailVerificationCodes>;

export interface CreateUserInput {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string;
  ip: string;
  expiresAt: Date;
}

@Injectable()
export class AuthRepository implements OnModuleDestroy {
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

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const [user] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return user;
  }

  async createEmailCode(input: {
    id: string;
    email: string;
    codeHash: string;
    expiresAt: Date;
    requestedIp: string;
  }): Promise<EmailCodeRecord> {
    const [code] = await this.db
      .insert(emailVerificationCodes)
      .values({ ...input, purpose: "register" })
      .returning();
    if (!code) {
      throw new Error("Failed to create email verification code");
    }
    return code;
  }

  async findLatestActiveCode(email: string): Promise<EmailCodeRecord | undefined> {
    const [code] = await this.db
      .select()
      .from(emailVerificationCodes)
      .where(
        and(
          eq(emailVerificationCodes.email, email),
          eq(emailVerificationCodes.purpose, "register"),
          isNull(emailVerificationCodes.consumedAt),
          gt(emailVerificationCodes.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(emailVerificationCodes.createdAt))
      .limit(1);
    return code;
  }

  async incrementCodeAttempts(id: string): Promise<void> {
    await this.db
      .update(emailVerificationCodes)
      .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
      .where(eq(emailVerificationCodes.id, id));
  }

  async createUserAndConsumeCode(
    userInput: CreateUserInput,
    codeId: string,
  ): Promise<UserRecord | null> {
    return this.db.transaction(async (transaction) => {
      const [consumed] = await transaction
        .update(emailVerificationCodes)
        .set({ consumedAt: new Date() })
        .where(
          and(eq(emailVerificationCodes.id, codeId), isNull(emailVerificationCodes.consumedAt)),
        )
        .returning({ id: emailVerificationCodes.id });

      if (!consumed) {
        return null;
      }

      const [user] = await transaction.insert(users).values(userInput).returning();
      return user ?? null;
    });
  }

  async createSession(input: CreateSessionInput): Promise<SessionRecord> {
    const [session] = await this.db.insert(sessions).values(input).returning();
    if (!session) {
      throw new Error("Failed to create session");
    }
    return session;
  }

  async findSessionWithUser(
    tokenHash: string,
  ): Promise<{ session: SessionRecord; user: UserRecord } | null> {
    const [result] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async touchSession(id: string): Promise<void> {
    await this.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, id));
  }

  async updateLastLogin(id: string): Promise<void> {
    const now = new Date();
    await this.db.update(users).set({ lastLoginAt: now, updatedAt: now }).where(eq(users.id, id));
  }

  async revokeSession(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
