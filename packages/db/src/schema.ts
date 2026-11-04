import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const systemMetadata = pgTable("system_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent").notNull(),
    ip: text("ip").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export const emailVerificationCodes = pgTable(
  "email_verification_codes",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    purpose: text("purpose").notNull().default("register"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: text("requested_ip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_codes_email_purpose_created_idx").on(table.email, table.purpose, table.createdAt),
  ],
);

export const modelConfigs = pgTable(
  "model_configs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    purposes: jsonb("purposes")
      .$type<string[]>()
      .notNull()
      .default(sql`'["writing"]'::jsonb`),
    encryptedKey: text("encrypted_key").notNull(),
    keyMasked: text("key_masked").notNull(),
    idempotencyKey: text("idempotency_key"),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    lastTestStatus: text("last_test_status"),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("model_configs_user_id_idx").on(table.userId),
    uniqueIndex("model_configs_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    decision: text("decision").notNull(),
    correlationId: text("correlation_id").notNull(),
    ip: text("ip").notNull().default("unknown"),
    userAgent: text("user_agent").notNull().default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_logs_actor_created_idx").on(table.actorId, table.createdAt),
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
  ],
);

export const genrePacks = pgTable(
  "genre_packs",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    label: text("label").notNull(),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("genre_packs_key_version_unique").on(table.key, table.version),
    check("genre_packs_key_check", sql`${table.key} in ('xianxia', 'history', 'urban')`),
  ],
);

export const works = pgTable(
  "works",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    penName: text("pen_name").notNull(),
    genre: text("genre").notNull(),
    status: text("status").notNull().default("draft"),
    scaleTarget: text("scale_target").notNull().default("long"),
    chapterLengthTarget: integer("chapter_length_target").notNull().default(3000),
    sourceMode: text("source_mode").notNull(),
    idea: text("idea"),
    templateKey: text("template_key"),
    templatePackId: uuid("template_pack_id").references(() => genrePacks.id, {
      onDelete: "restrict",
    }),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("works_user_status_updated_idx").on(table.userId, table.status, table.updatedAt),
    uniqueIndex("works_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    check(
      "works_status_check",
      sql`${table.status} in ('draft', 'preparing', 'serializing', 'paused', 'completed', 'archived')`,
    ),
    check("works_genre_check", sql`${table.genre} in ('xianxia', 'history', 'urban')`),
    check(
      "works_scale_target_check",
      sql`${table.scaleTarget} in ('short', 'medium', 'long', 'epic')`,
    ),
    check("works_source_mode_check", sql`${table.sourceMode} in ('idea', 'blank', 'template')`),
  ],
);

export const workBranches = pgTable(
  "work_branches",
  {
    id: uuid("id").primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    headNodeId: uuid("head_node_id").references((): AnyPgColumn => versionNodes.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("work_branches_work_name_unique").on(table.workId, table.name),
    uniqueIndex("work_branches_head_node_unique").on(table.headNodeId),
    index("work_branches_user_work_idx").on(table.userId, table.workId),
    check("work_branches_status_check", sql`${table.status} in ('active', 'archived')`),
  ],
);

export const versionNodes = pgTable(
  "version_nodes",
  {
    id: uuid("id").primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentNodeId: uuid("parent_node_id").references((): AnyPgColumn => versionNodes.id, {
      onDelete: "restrict",
    }),
    nodeType: text("node_type").notNull(),
    snapshotId: uuid("snapshot_id"),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id").notNull(),
    objectVersion: integer("object_version").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("version_nodes_branch_created_idx").on(table.branchId, table.createdAt),
    index("version_nodes_user_work_idx").on(table.userId, table.workId),
    check(
      "version_nodes_node_type_check",
      sql`${table.nodeType} in ('chapter_version', 'outline_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback')`,
    ),
  ],
);
