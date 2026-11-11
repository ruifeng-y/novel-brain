import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
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
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`)],
);

export const penNames = pgTable(
  "pen_names",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("pen_names_user_name_unique")
      .on(table.userId, table.name)
      .where(sql`${table.deletedAt} is null`),
    uniqueIndex("pen_names_user_default_unique")
      .on(table.userId)
      .where(sql`${table.isDefault} and ${table.deletedAt} is null`),
    index("pen_names_user_updated_idx").on(table.userId, table.updatedAt),
  ],
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

export const passwordResets = pgTable(
  "password_resets",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    requestedIp: text("requested_ip").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_resets_token_hash_unique").on(table.tokenHash),
    index("password_resets_user_created_idx").on(table.userId, table.createdAt),
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

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idempotency_records_user_scope_key_unique").on(
      table.userId,
      table.scope,
      table.idempotencyKey,
    ),
    index("idempotency_records_resource_idx").on(table.resourceType, table.resourceId),
    check("idempotency_records_key_check", sql`length(trim(${table.idempotencyKey})) > 0`),
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
    check(
      "works_source_mode_check",
      sql`${table.sourceMode} in ('idea', 'blank', 'template', 'settings_import', 'manuscript_import')`,
    ),
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
      sql`${table.nodeType} in ('chapter_version', 'outline_version', 'ledger_version', 'story_bible_version', 'entity_version', 'canon_commit', 'writing_action_output', 'snapshot', 'change_apply', 'branch_merge', 'rollback')`,
    ),
  ],
);

export const storyBibles = pgTable(
  "story_bibles",
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
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("draft"),
    cards: jsonb("cards")
      .$type<
        Array<{
          key: string;
          title: string;
          content: string;
          complete: boolean;
          worldRules?: Array<{
            id: string;
            name: string;
            constraint: string;
            scope: string;
            exceptions: string[];
          }>;
        }>
      >()
      .notNull(),
    proposalGeneratedAt: timestamp("proposal_generated_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("story_bibles_work_branch_unique").on(table.workId, table.branchId),
    index("story_bibles_user_work_idx").on(table.userId, table.workId),
    check("story_bibles_status_check", sql`${table.status} in ('draft', 'proposed', 'locked')`),
    check("story_bibles_nine_cards_check", sql`jsonb_array_length(${table.cards}) = 9`),
    check(
      "story_bibles_lock_metadata_check",
      sql`(${table.status} = 'locked' and ${table.lockedAt} is not null and ${table.lockedBy} is not null) or (${table.status} <> 'locked' and ${table.lockedAt} is null and ${table.lockedBy} is null)`,
    ),
  ],
);

export const storyBibleVersions = pgTable(
  "story_bible_versions",
  {
    id: uuid("id").primaryKey(),
    storyBibleId: uuid("story_bible_id")
      .notNull()
      .references(() => storyBibles.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    cards: jsonb("cards")
      .$type<
        Array<{
          key: string;
          title: string;
          content: string;
          complete: boolean;
          worldRules?: Array<{
            id: string;
            name: string;
            constraint: string;
            scope: string;
            exceptions: string[];
          }>;
        }>
      >()
      .notNull(),
    readiness: jsonb("readiness").$type<Record<string, unknown>>().notNull(),
    action: text("action").notNull().default("locked"),
    reason: text("reason").notNull().default("锁定故事圣经"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("story_bible_versions_bible_version_unique").on(table.storyBibleId, table.version),
    uniqueIndex("story_bible_versions_node_unique").on(table.versionNodeId),
    index("story_bible_versions_user_work_idx").on(table.userId, table.workId),
    check("story_bible_versions_nine_cards_check", sql`jsonb_array_length(${table.cards}) = 9`),
    check(
      "story_bible_versions_action_check",
      sql`${table.action} in ('proposed', 'edited', 'locked', 'unlocked')`,
    ),
    check("story_bible_versions_reason_check", sql`length(trim(${table.reason})) > 0`),
  ],
);

export const storyBibleWorldRules = pgTable(
  "story_bible_world_rules",
  {
    id: uuid("id").notNull(),
    storyBibleVersionId: uuid("story_bible_version_id")
      .notNull()
      .references(() => storyBibleVersions.id, { onDelete: "cascade" }),
    storyBibleId: uuid("story_bible_id")
      .notNull()
      .references(() => storyBibles.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    constraint: text("constraint").notNull(),
    scope: text("scope").notNull(),
    exceptions: jsonb("exceptions").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.storyBibleVersionId] }),
    index("story_bible_world_rules_version_name_idx").on(table.storyBibleVersionId, table.name),
    index("story_bible_world_rules_user_work_idx").on(table.userId, table.workId),
    index("story_bible_world_rules_branch_idx").on(table.branchId),
  ],
);

export const storyBibleChangeRequests = pgTable(
  "story_bible_change_requests",
  {
    id: uuid("id").primaryKey(),
    storyBibleId: uuid("story_bible_id")
      .notNull()
      .references(() => storyBibles.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cardKey: text("card_key").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    before: jsonb("before")
      .$type<{
        key: string;
        title: string;
        content: string;
        complete: boolean;
        worldRules?: Array<{
          id: string;
          name: string;
          constraint: string;
          scope: string;
          exceptions: string[];
        }>;
      }>()
      .notNull(),
    after: jsonb("after")
      .$type<{
        key: string;
        title: string;
        content: string;
        complete: boolean;
        worldRules?: Array<{
          id: string;
          name: string;
          constraint: string;
          scope: string;
          exceptions: string[];
        }>;
      }>()
      .notNull(),
    status: text("status").notNull().default("pending"),
    risk: text("risk").notNull().default("medium"),
    source: text("source").notNull().default("author"),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("story_bible_change_requests_user_work_idx").on(table.userId, table.workId),
    index("story_bible_change_requests_status_idx").on(table.workId, table.branchId, table.status),
    uniqueIndex("story_bible_change_requests_user_idempotency_unique").on(
      table.userId,
      table.storyBibleId,
      table.idempotencyKey,
    ),
    check(
      "story_bible_change_requests_card_key_check",
      sql`${table.cardKey} in ('oneSentence', 'sellingPoints', 'protagonist', 'goldenFinger', 'worldLaws', 'mainPlot', 'subplots', 'ending', 'readerPromise')`,
    ),
    check(
      "story_bible_change_requests_status_check",
      sql`${table.status} in ('pending', 'analyzing', 'approved', 'rejected', 'applied')`,
    ),
    check(
      "story_bible_change_requests_risk_check",
      sql`${table.risk} in ('low', 'medium', 'high')`,
    ),
    check(
      "story_bible_change_requests_source_check",
      sql`${table.source} in ('author', 'ai', 'import', 'batch')`,
    ),
  ],
);

export const entities = pgTable(
  "entities",
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
    type: text("type").notNull(),
    name: text("name").notNull(),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    summary: text("summary").notNull(),
    description: text("description").notNull().default(""),
    attributes: jsonb("attributes").$type<Record<string, unknown>>().notNull().default({}),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull().default("author"),
    version: integer("version").notNull().default(1),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: uuid("locked_by").references(() => users.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entities_user_work_type_status_idx").on(
      table.userId,
      table.workId,
      table.type,
      table.status,
    ),
    index("entities_branch_type_idx").on(table.branchId, table.type),
    check(
      "entities_type_check",
      sql`${table.type} in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')`,
    ),
    check(
      "entities_status_check",
      sql`${table.status} in ('draft', 'proposed', 'locked', 'discarded')`,
    ),
    check("entities_source_check", sql`${table.source} in ('author', 'import', 'ai', 'canon')`),
    check(
      "entities_lock_metadata_check",
      sql`(${table.status} = 'locked' and ${table.lockedAt} is not null and ${table.lockedBy} is not null) or (${table.status} <> 'locked' and ${table.lockedAt} is null and ${table.lockedBy} is null)`,
    ),
  ],
);

export const entityVersions = pgTable(
  "entity_versions",
  {
    id: uuid("id").primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("entity_versions_entity_version_unique").on(table.entityId, table.version),
    uniqueIndex("entity_versions_node_unique").on(table.versionNodeId),
    index("entity_versions_user_work_idx").on(table.userId, table.workId),
  ],
);

export const customFieldDefinitions = pgTable(
  "custom_field_definitions",
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
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: text("field_type").notNull(),
    appliesTo: text("applies_to").notNull(),
    required: boolean("required").notNull().default(false),
    options: jsonb("options").$type<string[]>().notNull().default([]),
    relationTarget: text("relation_target"),
    enabled: boolean("enabled").notNull().default(true),
    schemaVersion: integer("schema_version").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("custom_field_definitions_scope_key_unique").on(
      table.workId,
      table.branchId,
      table.key,
    ),
    index("custom_field_definitions_user_work_idx").on(table.userId, table.workId),
    check(
      "custom_field_definitions_type_check",
      sql`${table.fieldType} in ('text', 'long_text', 'number', 'date', 'single_select', 'multi_select', 'boolean', 'relation_ref')`,
    ),
    check(
      "custom_field_definitions_applies_to_check",
      sql`${table.appliesTo} in ('all', 'world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')`,
    ),
    check(
      "custom_field_definitions_relation_target_check",
      sql`${table.relationTarget} is null or ${table.relationTarget} in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')`,
    ),
    check("custom_field_definitions_schema_version_check", sql`${table.schemaVersion} > 0`),
  ],
);

export const customFieldValues = pgTable(
  "custom_field_values",
  {
    id: uuid("id").primaryKey(),
    fieldDefinitionId: uuid("field_definition_id")
      .notNull()
      .references(() => customFieldDefinitions.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    value: jsonb("value").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("custom_field_values_field_entity_unique").on(
      table.fieldDefinitionId,
      table.entityId,
    ),
    index("custom_field_values_entity_idx").on(table.entityId),
    index("custom_field_values_user_work_idx").on(table.userId, table.workId),
  ],
);

export const settingProposals = pgTable(
  "setting_proposals",
  {
    id: uuid("id").primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityVersion: integer("entity_version").notNull(),
    status: text("status").notNull().default("pending"),
    conflictType: text("conflict_type").notNull().default("none"),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull(),
    reason: text("reason").notNull(),
    proposedBy: uuid("proposed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionReason: text("decision_reason"),
    decisionEvidence: jsonb("decision_evidence")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    decisionConflictType: text("decision_conflict_type"),
  },
  (table) => [
    index("setting_proposals_entity_idx").on(table.entityId),
    index("setting_proposals_user_work_status_idx").on(table.userId, table.workId, table.status),
    check(
      "setting_proposals_status_check",
      sql`${table.status} in ('pending', 'accepted', 'rejected')`,
    ),
    check(
      "setting_proposals_conflict_type_check",
      sql`${table.conflictType} in ('none', 'duplicate_name', 'alias_collision', 'contradictory_fact', 'import_candidate', 'ai_disagreement')`,
    ),
    check(
      "setting_proposals_decision_conflict_type_check",
      sql`${table.decisionConflictType} is null or ${table.decisionConflictType} in ('none', 'duplicate_name', 'alias_collision', 'contradictory_fact', 'import_candidate', 'ai_disagreement')`,
    ),
    check(
      "setting_proposals_decision_metadata_check",
      sql`(${table.status} = 'pending' and ${table.decidedBy} is null and ${table.decidedAt} is null and ${table.decisionReason} is null) or (${table.status} <> 'pending' and ${table.decidedBy} is not null and ${table.decidedAt} is not null and ${table.decisionReason} is not null)`,
    ),
  ],
);

export const settingChangeRequests = pgTable(
  "setting_change_requests",
  {
    id: uuid("id").primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityVersion: integer("entity_version").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    conflictType: text("conflict_type").notNull().default("none"),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull(),
    impact: jsonb("impact").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("setting_change_requests_entity_idx").on(table.entityId, table.status),
    index("setting_change_requests_user_work_idx").on(table.userId, table.workId),
    uniqueIndex("setting_change_requests_user_entity_idempotency_unique").on(
      table.userId,
      table.entityId,
      table.idempotencyKey,
    ),
    check(
      "setting_change_requests_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'applied')`,
    ),
    check(
      "setting_change_requests_conflict_type_check",
      sql`${table.conflictType} in ('none', 'duplicate_name', 'alias_collision', 'contradictory_fact', 'import_candidate', 'ai_disagreement')`,
    ),
  ],
);

export const chapters = pgTable(
  "chapters",
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
    number: integer("number").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("planned"),
    version: integer("version").notNull().default(1),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => chapterVersions.id, {
      onDelete: "set null",
    }),
    wordCount: integer("word_count").notNull().default(0),
    brief: jsonb("brief").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chapters_work_branch_number_unique").on(
      table.workId,
      table.branchId,
      table.number,
    ),
    uniqueIndex("chapters_current_version_unique").on(table.currentVersionId),
    index("chapters_user_work_idx").on(table.userId, table.workId),
    check(
      "chapters_status_check",
      sql`${table.status} in ('planned', 'writing', 'waiting_review', 'changes_requested', 'approved', 'locked', 'published', 'rejected')`,
    ),
  ],
);

export const reviewDecisions = pgTable(
  "review_decisions",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id").references(() => chapterVersions.id, {
      onDelete: "restrict",
    }),
    action: text("action").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorName: text("actor_name").notNull(),
    reason: text("reason").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("review_decisions_chapter_decided_idx").on(table.chapterId, table.decidedAt),
    index("review_decisions_user_work_idx").on(table.userId, table.workId),
    check("review_decisions_action_check", sql`${table.action} in ('approve', 'reject')`),
  ],
);

export const chapterVersions = pgTable(
  "chapter_versions",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    source: text("source").notNull().default("manual"),
    generationJobId: uuid("generation_job_id").references((): AnyPgColumn => jobs.id, {
      onDelete: "set null",
    }),
    generationStep: text("generation_step"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chapter_versions_chapter_version_unique").on(table.chapterId, table.version),
    uniqueIndex("chapter_versions_node_unique").on(table.versionNodeId),
    uniqueIndex("chapter_versions_generation_step_unique").on(
      table.generationJobId,
      table.generationStep,
    ),
    index("chapter_versions_user_work_idx").on(table.userId, table.workId),
  ],
);

export const factProposals = pgTable(
  "fact_proposals",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "cascade" }),
    extractionKey: text("extraction_key").notNull(),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    object: text("object").notNull(),
    sourceSentence: text("source_sentence").notNull(),
    status: text("status").notNull().default("proposed"),
    confidence: real("confidence").notNull(),
    risk: text("risk").notNull(),
    required: boolean("required").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fact_proposals_source_extraction_unique").on(
      table.chapterId,
      table.sourceVersionId,
      table.extractionKey,
    ),
    index("fact_proposals_user_work_status_idx").on(table.userId, table.workId, table.status),
    index("fact_proposals_chapter_created_idx").on(table.chapterId, table.createdAt),
    check(
      "fact_proposals_status_check",
      sql`${table.status} in ('proposed', 'confirmed', 'modified_confirmed', 'rejected', 'superseded')`,
    ),
    check("fact_proposals_risk_check", sql`${table.risk} in ('low', 'medium', 'high')`),
    check(
      "fact_proposals_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export const factDecisions = pgTable(
  "fact_decisions",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    factProposalId: uuid("fact_proposal_id")
      .notNull()
      .references(() => factProposals.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorName: text("actor_name").notNull(),
    reason: text("reason").notNull(),
    originalPayload: jsonb("original_payload").$type<Record<string, unknown>>().notNull(),
    resultingPayload: jsonb("resulting_payload").$type<Record<string, unknown>>().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fact_decisions_proposal_decided_idx").on(table.factProposalId, table.decidedAt),
    index("fact_decisions_user_work_idx").on(table.userId, table.workId),
    check(
      "fact_decisions_action_check",
      sql`${table.action} in ('confirm', 'modify_confirm', 'reject', 'supersede')`,
    ),
  ],
);

export const canonCommits = pgTable(
  "canon_commits",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    decisionSnapshot: jsonb("decision_snapshot")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("canon_commits_chapter_unique").on(table.chapterId),
    uniqueIndex("canon_commits_version_node_unique").on(table.versionNodeId),
    uniqueIndex("canon_commits_user_chapter_idempotency_unique").on(
      table.userId,
      table.chapterId,
      table.idempotencyKey,
    ),
    index("canon_commits_user_work_idx").on(table.userId, table.workId),
    index("canon_commits_branch_created_idx").on(table.branchId, table.createdAt),
  ],
);

export const facts = pgTable(
  "facts",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    factProposalId: uuid("fact_proposal_id")
      .notNull()
      .references(() => factProposals.id, { onDelete: "restrict" }),
    decisionId: uuid("decision_id")
      .notNull()
      .references(() => factDecisions.id, { onDelete: "restrict" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    canonCommitId: uuid("canon_commit_id")
      .notNull()
      .references(() => canonCommits.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    object: text("object").notNull(),
    risk: text("risk").notNull(),
    required: boolean("required").notNull().default(false),
    status: text("status").notNull().default("active"),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("facts_fact_proposal_unique").on(table.factProposalId),
    index("facts_user_work_status_idx").on(table.userId, table.workId, table.status),
    index("facts_chapter_created_idx").on(table.chapterId, table.createdAt),
    index("facts_canon_commit_idx").on(table.canonCommitId),
    check("facts_risk_check", sql`${table.risk} in ('low', 'medium', 'high')`),
    check("facts_status_check", sql`${table.status} in ('active', 'superseded')`),
  ],
);

export const characterProfiles = pgTable(
  "character_profiles",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    desire: text("desire").notNull().default(""),
    fear: text("fear").notNull().default(""),
    goal: text("goal").notNull().default(""),
    voiceSample: text("voice_sample").notNull().default(""),
    voiceGuide: text("voice_guide").notNull().default(""),
    disguise: text("disguise").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_profiles_user_work_idx").on(table.userId, table.workId),
    index("character_profiles_branch_idx").on(table.branchId),
  ],
);

export const characterRelationships = pgTable(
  "character_relationships",
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
    sourceCharacterId: uuid("source_character_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetLabel: text("target_label"),
    relationType: text("relation_type").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_relationships_source_valid_idx").on(
      table.sourceCharacterId,
      table.validFromChapter,
    ),
    index("character_relationships_user_work_idx").on(table.userId, table.workId),
    check(
      "character_relationships_relation_type_check",
      sql`${table.relationType} in ('kinship', 'ally', 'enemy', 'mentor', 'student', 'subordinate', 'superior', 'member_of', 'located_at', 'controls', 'owns')`,
    ),
    check(
      "character_relationships_target_type_check",
      sql`${table.targetType} in ('character', 'faction', 'map', 'map_node', 'power_system', 'golden_finger', 'item', 'timeline_event')`,
    ),
    check(
      "character_relationships_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
    check(
      "character_relationships_from_story_time_check",
      sql`(${table.fromEra} is null and ${table.fromStoryTimeLabel} is null and ${table.fromStorySortKey} is null) or (${table.fromEra} is not null and ${table.fromStoryTimeLabel} is not null and ${table.fromStorySortKey} is not null)`,
    ),
    check(
      "character_relationships_to_story_time_check",
      sql`(${table.toEra} is null and ${table.toStoryTimeLabel} is null and ${table.toStorySortKey} is null) or (${table.fromEra} is not null and ${table.toEra} is not null and ${table.toStoryTimeLabel} is not null and ${table.toStorySortKey} is not null)`,
    ),
  ],
);

export const characterStateTransitions = pgTable(
  "character_state_transitions",
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
    characterId: uuid("character_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    stateKind: text("state_kind").notNull(),
    stateKey: text("state_key").notNull(),
    value: text("value").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    targetLabel: text("target_label"),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_state_transitions_character_valid_idx").on(
      table.characterId,
      table.validFromChapter,
    ),
    index("character_state_transitions_user_work_idx").on(table.userId, table.workId),
    check(
      "character_state_transitions_kind_check",
      sql`${table.stateKind} in ('body', 'limb', 'location', 'ability', 'disguise')`,
    ),
    check(
      "character_state_transitions_key_check",
      sql`${table.stateKey} ~ '^[a-z][a-z0-9_]{0,63}$'`,
    ),
    check(
      "character_state_transitions_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
    check(
      "character_state_transitions_target_check",
      sql`(${table.stateKind} = 'location' and ${table.targetType} in ('map', 'map_node') and ${table.targetId} is not null) or (${table.stateKind} <> 'location' and ${table.targetType} is null and ${table.targetId} is null and ${table.targetLabel} is null)`,
    ),
    check(
      "character_state_transitions_from_story_time_check",
      sql`(${table.fromEra} is null and ${table.fromStoryTimeLabel} is null and ${table.fromStorySortKey} is null) or (${table.fromEra} is not null and ${table.fromStoryTimeLabel} is not null and ${table.fromStorySortKey} is not null)`,
    ),
    check(
      "character_state_transitions_to_story_time_check",
      sql`(${table.toEra} is null and ${table.toStoryTimeLabel} is null and ${table.toStorySortKey} is null) or (${table.fromEra} is not null and ${table.toEra} is not null and ${table.toStoryTimeLabel} is not null and ${table.toStorySortKey} is not null)`,
    ),
  ],
);

export const characterKnowledgeStates = pgTable(
  "character_knowledge_states",
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
    characterId: uuid("character_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    objectiveFactId: uuid("objective_fact_id")
      .notNull()
      .references(() => facts.id, { onDelete: "restrict" }),
    state: text("state").notNull(),
    claimedContent: text("claimed_content"),
    sourceKind: text("source_kind").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_knowledge_states_character_valid_idx").on(
      table.characterId,
      table.validFromChapter,
    ),
    index("character_knowledge_states_fact_idx").on(table.objectiveFactId),
    index("character_knowledge_states_user_work_idx").on(table.userId, table.workId),
    check(
      "character_knowledge_states_state_check",
      sql`${table.state} in ('knowledge', 'belief', 'suspicion', 'misbelief', 'unknown')`,
    ),
    check(
      "character_knowledge_states_source_kind_check",
      sql`${table.sourceKind} in ('observed', 'told', 'inferred', 'read', 'assumed')`,
    ),
    check(
      "character_knowledge_states_content_check",
      sql`(${table.state} = 'unknown' and ${table.claimedContent} is null) or (${table.state} <> 'unknown' and length(trim(coalesce(${table.claimedContent}, ''))) > 0)`,
    ),
    check(
      "character_knowledge_states_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
    check(
      "character_knowledge_states_from_story_time_check",
      sql`(${table.fromEra} is null and ${table.fromStoryTimeLabel} is null and ${table.fromStorySortKey} is null) or (${table.fromEra} is not null and ${table.fromStoryTimeLabel} is not null and ${table.fromStorySortKey} is not null)`,
    ),
    check(
      "character_knowledge_states_to_story_time_check",
      sql`(${table.toEra} is null and ${table.toStoryTimeLabel} is null and ${table.toStorySortKey} is null) or (${table.fromEra} is not null and ${table.toEra} is not null and ${table.toStoryTimeLabel} is not null and ${table.toStorySortKey} is not null)`,
    ),
  ],
);

export const characterChangeRequests = pgTable(
  "character_change_requests",
  {
    id: uuid("id").primaryKey(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    before: jsonb("before").$type<Record<string, unknown>>().notNull().default({}),
    after: jsonb("after").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull(),
    idempotencyKey: text("idempotency_key"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_change_requests_character_idx").on(table.characterId, table.status),
    index("character_change_requests_user_work_idx").on(table.userId, table.workId),
    uniqueIndex("character_change_requests_user_idempotency_unique").on(
      table.userId,
      table.characterId,
      table.idempotencyKey,
    ),
    check(
      "character_change_requests_kind_check",
      sql`${table.kind} in ('profile', 'relationship', 'state_transition', 'knowledge_state')`,
    ),
    check(
      "character_change_requests_status_check",
      sql`${table.status} in ('pending', 'approved', 'rejected', 'applied')`,
    ),
    check("character_change_requests_version_check", sql`${table.version} > 0`),
  ],
);

export const factionProfiles = pgTable(
  "faction_profiles",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    overview: text("overview").notNull().default(""),
    goals: text("goals").notNull().default(""),
    resources: text("resources").notNull().default(""),
    doctrine: text("doctrine").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("faction_profiles_user_work_idx").on(table.userId, table.workId),
    index("faction_profiles_branch_idx").on(table.branchId),
  ],
);

export const factionRelationships = pgTable(
  "faction_relationships",
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
    sourceFactionId: uuid("source_faction_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    targetLabel: text("target_label"),
    relationType: text("relation_type").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("faction_relationships_source_valid_idx").on(
      table.sourceFactionId,
      table.validFromChapter,
    ),
    index("faction_relationships_user_work_idx").on(table.userId, table.workId),
    check("faction_relationships_target_type_check", sql`${table.targetType} = 'faction'`),
    check(
      "faction_relationships_relation_type_check",
      sql`${table.relationType} in ('ally', 'enemy', 'vassal', 'overlord', 'trade', 'neutral')`,
    ),
    check(
      "faction_relationships_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
    check(
      "faction_relationships_from_story_time_check",
      sql`(${table.fromEra} is null and ${table.fromStoryTimeLabel} is null and ${table.fromStorySortKey} is null) or (${table.fromEra} is not null and ${table.fromStoryTimeLabel} is not null and ${table.fromStorySortKey} is not null)`,
    ),
    check(
      "faction_relationships_to_story_time_check",
      sql`(${table.toEra} is null and ${table.toStoryTimeLabel} is null and ${table.toStorySortKey} is null) or (${table.fromEra} is not null and ${table.toEra} is not null and ${table.toStoryTimeLabel} is not null and ${table.toStorySortKey} is not null)`,
    ),
  ],
);

export const mapControl = pgTable(
  "map_control",
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
    factionId: uuid("faction_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    mapId: uuid("map_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    nodeType: text("node_type").notNull(),
    nodeId: uuid("node_id").notNull(),
    nodeLabel: text("node_label"),
    controlLevel: text("control_level").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default([]),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("map_control_node_valid_idx").on(table.nodeId, table.validFromChapter),
    index("map_control_user_work_idx").on(table.userId, table.workId),
    check("map_control_node_type_check", sql`${table.nodeType} in ('map', 'map_node')`),
    check(
      "map_control_level_check",
      sql`${table.controlLevel} in ('direct', 'military', 'influence', 'contested')`,
    ),
    check(
      "map_control_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const mapLayers = pgTable(
  "map_layers",
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
    mapId: uuid("map_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentLayerId: uuid("parent_layer_id").references((): AnyPgColumn => mapLayers.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    minScale: real("min_scale").notNull().default(0),
    maxScale: real("max_scale").notNull().default(100),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("map_layers_map_name_unique").on(table.mapId, table.name),
    index("map_layers_user_work_idx").on(table.userId, table.workId),
    check("map_layers_scale_check", sql`${table.maxScale} >= ${table.minScale}`),
    check(
      "map_layers_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const mapNodes = pgTable(
  "map_nodes",
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
    mapId: uuid("map_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id").references(() => mapLayers.id, { onDelete: "set null" }),
    parentNodeId: uuid("parent_node_id").references((): AnyPgColumn => mapNodes.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    nodeType: text("node_type").notNull(),
    summary: text("summary").notNull().default(""),
    x: real("x"),
    y: real("y"),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("map_nodes_map_name_unique").on(table.mapId, table.name),
    index("map_nodes_map_parent_idx").on(table.mapId, table.parentNodeId),
    index("map_nodes_user_work_idx").on(table.userId, table.workId),
    check(
      "map_nodes_type_check",
      sql`${table.nodeType} in ('region', 'settlement', 'landmark', 'passage', 'battlefield', 'sect', 'dungeon', 'other')`,
    ),
    check(
      "map_nodes_coordinates_check",
      sql`(${table.x} is null and ${table.y} is null) or (${table.x} >= 0 and ${table.x} <= 1 and ${table.y} >= 0 and ${table.y} <= 1)`,
    ),
    check(
      "map_nodes_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const mapEdges = pgTable(
  "map_edges",
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
    mapId: uuid("map_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id").references(() => mapLayers.id, { onDelete: "set null" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => mapNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => mapNodes.id, { onDelete: "cascade" }),
    routeType: text("route_type").notNull(),
    bidirectional: boolean("bidirectional").notNull().default(true),
    travelMinutes: integer("travel_minutes").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("map_edges_map_from_idx").on(table.mapId, table.fromNodeId),
    index("map_edges_user_work_idx").on(table.userId, table.workId),
    check(
      "map_edges_type_check",
      sql`${table.routeType} in ('road', 'trail', 'water', 'air', 'teleport', 'secret')`,
    ),
    check("map_edges_endpoint_check", sql`${table.fromNodeId} <> ${table.toNodeId}`),
    check("map_edges_travel_time_check", sql`${table.travelMinutes} > 0`),
    check(
      "map_edges_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const mapMarkers = pgTable(
  "map_markers",
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
    mapId: uuid("map_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    layerId: uuid("layer_id").references(() => mapLayers.id, { onDelete: "set null" }),
    nodeId: uuid("node_id").references(() => mapNodes.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    markerType: text("marker_type").notNull(),
    x: real("x").notNull(),
    y: real("y").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("map_markers_map_idx").on(table.mapId),
    index("map_markers_user_work_idx").on(table.userId, table.workId),
    check(
      "map_markers_type_check",
      sql`${table.markerType} in ('danger', 'event', 'resource', 'note', 'character')`,
    ),
    check(
      "map_markers_coordinates_check",
      sql`${table.x} >= 0 and ${table.x} <= 1 and ${table.y} >= 0 and ${table.y} <= 1`,
    ),
    check(
      "map_markers_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const timelineEras = pgTable(
  "timeline_eras",
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
    name: text("name").notNull(),
    orderIndex: integer("order_index").notNull(),
    startSortKey: integer("start_sort_key").notNull(),
    endSortKey: integer("end_sort_key"),
    description: text("description").notNull().default(""),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("timeline_eras_branch_name_unique").on(table.branchId, table.name),
    index("timeline_eras_user_work_idx").on(table.userId, table.workId),
    check(
      "timeline_eras_range_check",
      sql`${table.endSortKey} is null or ${table.endSortKey} >= ${table.startSortKey}`,
    ),
  ],
);

export const timelineEvents = pgTable(
  "timeline_events",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    era: text("era").notNull(),
    storyTimeLabel: text("story_time_label").notNull(),
    storyTimeSortKey: integer("story_time_sort_key").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(0),
    durationLabel: text("duration_label").notNull().default(""),
    eventText: text("event_text").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("timeline_events_branch_slot_unique").on(
      table.branchId,
      table.era,
      table.storyTimeSortKey,
    ),
    index("timeline_events_user_work_idx").on(table.userId, table.workId),
    check("timeline_events_duration_check", sql`${table.durationMinutes} >= 0`),
    check(
      "timeline_events_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const characterItineraries = pgTable(
  "character_itineraries",
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
    characterId: uuid("character_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => mapNodes.id, { onDelete: "restrict" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => mapNodes.id, { onDelete: "restrict" }),
    departureEra: text("departure_era").notNull(),
    departureLabel: text("departure_label").notNull(),
    departureSortKey: integer("departure_sort_key").notNull(),
    arrivalEra: text("arrival_era").notNull(),
    arrivalLabel: text("arrival_label").notNull(),
    arrivalSortKey: integer("arrival_sort_key").notNull(),
    routeTravelMinutes: integer("route_travel_minutes").notNull(),
    travelMinutes: integer("travel_minutes").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default([]),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_itineraries_character_time_idx").on(table.characterId, table.departureSortKey),
    index("character_itineraries_user_work_idx").on(table.userId, table.workId),
    check(
      "character_itineraries_time_check",
      sql`${table.arrivalEra} <> ${table.departureEra} or ${table.arrivalSortKey} > ${table.departureSortKey}`,
    ),
    check(
      "character_itineraries_travel_check",
      sql`${table.travelMinutes} >= ${table.routeTravelMinutes}`,
    ),
    check(
      "character_itineraries_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const powerSystems = pgTable(
  "power_systems",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    overview: text("overview").notNull().default(""),
    lifespanMode: text("lifespan_mode").notNull().default("none"),
    lifespanUnit: text("lifespan_unit").notNull().default("年"),
    lifespanBasis: text("lifespan_basis").notNull().default(""),
    lifespanDescription: text("lifespan_description").notNull().default(""),
    lifespanPathId: uuid("lifespan_path_id"),
    lifespanFixedAmount: integer("lifespan_fixed_amount"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("power_systems_user_work_idx").on(table.userId, table.workId),
    index("power_systems_branch_idx").on(table.branchId),
    check(
      "power_systems_lifespan_mode_check",
      sql`${table.lifespanMode} in ('none', 'realm', 'fixed', 'custom')`,
    ),
    check(
      "power_systems_lifespan_amount_check",
      sql`(${table.lifespanMode} = 'fixed' and ${table.lifespanFixedAmount} is not null and ${table.lifespanFixedAmount} > 0) or (${table.lifespanMode} <> 'fixed' and ${table.lifespanFixedAmount} is null)`,
    ),
    check("power_systems_lifespan_unit_check", sql`length(trim(${table.lifespanUnit})) > 0`),
  ],
);

export const powerPaths = pgTable(
  "power_paths",
  {
    id: uuid("id").primaryKey(),
    powerSystemId: uuid("power_system_id")
      .notNull()
      .references(() => powerSystems.entityId, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    pathType: text("path_type").notNull(),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("power_paths_system_name_unique").on(table.powerSystemId, table.name),
    index("power_paths_user_work_idx").on(table.userId, table.workId),
  ],
);

export const powerRealms = pgTable(
  "power_realms",
  {
    id: uuid("id").primaryKey(),
    pathId: uuid("path_id")
      .notNull()
      .references(() => powerPaths.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rank: integer("rank").notNull(),
    description: text("description").notNull().default(""),
    breakthroughConditions: text("breakthrough_conditions").notNull(),
    breakthroughCosts: text("breakthrough_costs").notNull().default(""),
    bottlenecks: text("bottlenecks").notNull().default(""),
    counters: text("counters").notNull().default(""),
    counteredBy: text("countered_by").notNull().default(""),
    lifespanAmount: integer("lifespan_amount"),
    prerequisiteRealmId: uuid("prerequisite_realm_id").references(
      (): AnyPgColumn => powerRealms.id,
      { onDelete: "set null" },
    ),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("power_realms_path_name_unique").on(table.pathId, table.name),
    uniqueIndex("power_realms_path_rank_unique").on(table.pathId, table.rank),
    index("power_realms_user_work_idx").on(table.userId, table.workId),
    check("power_realms_rank_check", sql`${table.rank} > 0`),
    check(
      "power_realms_lifespan_check",
      sql`${table.lifespanAmount} is null or ${table.lifespanAmount} > 0`,
    ),
    check(
      "power_realms_prerequisite_check",
      sql`${table.prerequisiteRealmId} is null or ${table.prerequisiteRealmId} <> ${table.id}`,
    ),
  ],
);

export const specialMechanisms = pgTable(
  "special_mechanisms",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mechanismType: text("mechanism_type").notNull(),
    ownerType: text("owner_type"),
    ownerId: uuid("owner_id"),
    ownerLabel: text("owner_label"),
    powerSystemId: uuid("power_system_id").references(() => entities.id, {
      onDelete: "set null",
    }),
    rules: text("rules").notNull(),
    costs: text("costs").notNull().default(""),
    limits: text("limits").notNull().default(""),
    growth: text("growth").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("special_mechanisms_user_work_idx").on(table.userId, table.workId),
    check(
      "special_mechanisms_owner_check",
      sql`(${table.ownerType} is null and ${table.ownerId} is null and ${table.ownerLabel} is null) or (${table.ownerType} in ('character', 'faction', 'item') and ${table.ownerId} is not null)`,
    ),
    check("special_mechanisms_type_check", sql`length(trim(${table.mechanismType})) > 0`),
  ],
);

export const mechanismOwnershipEvents = pgTable(
  "mechanism_ownership_events",
  {
    id: uuid("id").primaryKey(),
    mechanismId: uuid("mechanism_id")
      .notNull()
      .references(() => specialMechanisms.entityId, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    previousOwnerType: text("previous_owner_type"),
    previousOwnerId: uuid("previous_owner_id"),
    previousOwnerLabel: text("previous_owner_label"),
    ownerType: text("owner_type").notNull(),
    ownerId: uuid("owner_id").notNull(),
    ownerLabel: text("owner_label"),
    reason: text("reason").notNull(),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default([]),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("mechanism_ownership_events_mechanism_idx").on(table.mechanismId, table.createdAt),
    index("mechanism_ownership_events_user_work_idx").on(table.userId, table.workId),
    check(
      "mechanism_ownership_events_owner_check",
      sql`${table.ownerType} in ('character', 'faction', 'item')`,
    ),
    check(
      "mechanism_ownership_events_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const itemTechniques = pgTable(
  "item_techniques",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    category: text("category").notNull(),
    grade: text("grade").notNull().default(""),
    effect: text("effect").notNull(),
    cost: text("cost").notNull().default(""),
    limits: text("limits").notNull().default(""),
    ownershipModel: text("ownership_model").notNull(),
    consumable: boolean("consumable").notNull().default(false),
    quantity: integer("quantity").notNull().default(1),
    equipmentSlot: text("equipment_slot"),
    equippedByType: text("equipped_by_type"),
    equippedById: uuid("equipped_by_id"),
    equippedByLabel: text("equipped_by_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("item_techniques_user_work_idx").on(table.userId, table.workId),
    check(
      "item_techniques_kind_check",
      sql`${table.kind} in ('item', 'technique', 'equipment', 'resource')`,
    ),
    check(
      "item_techniques_ownership_model_check",
      sql`${table.ownershipModel} in ('shared', 'unique')`,
    ),
    check("item_techniques_quantity_check", sql`${table.quantity} >= 0`),
    check(
      "item_techniques_unique_quantity_check",
      sql`${table.ownershipModel} <> 'unique' or ${table.quantity} <= 1`,
    ),
    check(
      "item_techniques_equipment_check",
      sql`(${table.kind} = 'equipment' and ${table.equipmentSlot} is not null) or (${table.kind} <> 'equipment' and ${table.equipmentSlot} is null and ${table.equippedByType} is null and ${table.equippedById} is null and ${table.equippedByLabel} is null)`,
    ),
  ],
);

export const itemRights = pgTable(
  "item_rights",
  {
    id: uuid("id").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => itemTechniques.entityId, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rightType: text("right_type").notNull(),
    holderType: text("holder_type").notNull(),
    holderId: uuid("holder_id").notNull(),
    holderLabel: text("holder_label"),
    sharePercent: real("share_percent"),
    validFromChapter: integer("valid_from_chapter").notNull(),
    validToChapter: integer("valid_to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull().default([]),
    reason: text("reason").notNull(),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("item_rights_item_type_valid_idx").on(
      table.itemId,
      table.rightType,
      table.validFromChapter,
    ),
    index("item_rights_user_work_idx").on(table.userId, table.workId),
    check(
      "item_rights_type_check",
      sql`${table.rightType} in ('ownership', 'custody', 'location', 'usage', 'disposal')`,
    ),
    check(
      "item_rights_holder_check",
      sql`(${table.rightType} = 'location' and ${table.holderType} in ('map', 'map_node') and ${table.sharePercent} is null) or (${table.rightType} <> 'location' and ${table.holderType} in ('character', 'faction', 'item'))`,
    ),
    check(
      "item_rights_share_check",
      sql`(${table.rightType} = 'ownership' and ${table.sharePercent} is not null and ${table.sharePercent} > 0 and ${table.sharePercent} <= 100) or (${table.rightType} <> 'ownership' and ${table.sharePercent} is null)`,
    ),
    check(
      "item_rights_validity_check",
      sql`${table.validToChapter} is null or ${table.validToChapter} >= ${table.validFromChapter}`,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
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
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id").references(() => chapterVersions.id, {
      onDelete: "restrict",
    }),
    modelConfigId: uuid("model_config_id").references(() => modelConfigs.id, {
      onDelete: "restrict",
    }),
    parentJobId: uuid("parent_job_id").references((): AnyPgColumn => jobs.id, {
      onDelete: "cascade",
    }),
    jobType: text("job_type"),
    workItemKey: text("work_item_key"),
    type: text("type").notNull(),
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    currentStep: text("current_step").notNull().default("prepare"),
    priority: integer("priority").notNull().default(0),
    idempotencyKey: text("idempotency_key").notNull(),
    budget: jsonb("budget").$type<Record<string, unknown>>().notNull(),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull(),
    checkpointVersion: integer("checkpoint_version").notNull().default(0),
    orchestration: jsonb("orchestration").$type<Record<string, unknown>>(),
    action: text("action"),
    actionInput: jsonb("action_input").$type<Record<string, unknown>>(),
    cost: jsonb("cost").$type<Record<string, unknown>>().notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("jobs_chapter_idempotency_unique").on(
      table.userId,
      table.chapterId,
      table.type,
      table.idempotencyKey,
    ),
    uniqueIndex("jobs_workflow_idempotency_unique")
      .on(table.userId, table.workId, table.branchId, table.idempotencyKey)
      .where(sql`${table.type} = 'agent_workflow'`),
    uniqueIndex("jobs_batch_plan_idempotency_unique")
      .on(table.userId, table.workId, table.branchId, table.idempotencyKey)
      .where(sql`${table.type} = 'batch_plan'`),
    index("jobs_user_work_created_idx").on(table.userId, table.workId, table.createdAt),
    index("jobs_chapter_created_idx").on(table.chapterId, table.createdAt),
    index("jobs_parent_created_idx").on(table.parentJobId, table.createdAt),
    check(
      "jobs_type_check",
      sql`${table.type} in ('generate_chapter', 'agent_workflow', 'write_action', 'batch_plan')`,
    ),
    check(
      "jobs_required_scope_check",
      sql`(${table.type} in ('agent_workflow', 'batch_plan')) or (${table.type} in ('generate_chapter', 'write_action') and ${table.chapterId} is not null and ${table.modelConfigId} is not null)`,
    ),
    check(
      "jobs_job_type_check",
      sql`${table.jobType} is null or ${table.jobType} in ('book', 'volume', 'chapter', 'step')`,
    ),
    check(
      "jobs_batch_plan_scope_check",
      sql`${table.type} <> 'batch_plan' or (${table.jobType} = 'book' and ${table.workItemKey} = 'book' and ${table.chapterId} is null and ${table.modelConfigId} is null)`,
    ),
    check(
      "jobs_writing_action_scope_check",
      sql`(${table.type} = 'write_action' and ${table.action} is not null and ${table.sourceVersionId} is not null and ${table.actionInput} is not null) or (${table.type} <> 'write_action' and ${table.action} is null and ${table.sourceVersionId} is null and ${table.actionInput} is null)`,
    ),
    check(
      "jobs_status_check",
      sql`${table.status} in ('queued', 'preparing', 'running', 'paused', 'waiting_review', 'completed', 'failed', 'cancelled')`,
    ),
    check("jobs_progress_check", sql`${table.progress} >= 0 and ${table.progress} <= 100`),
  ],
);

export const jobWorkItems = pgTable(
  "job_work_items",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => jobWorkItems.id, {
      onDelete: "cascade",
    }),
    itemType: text("item_type").notNull(),
    workItemKey: text("work_item_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    outlineNodeId: uuid("outline_node_id").references(() => outlineNodes.id, {
      onDelete: "set null",
    }),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    priorityClass: text("priority_class").notNull().default("batch"),
    sortOrder: integer("sort_order").notNull(),
    inputVersion: jsonb("input_version")
      .$type<{ outlineVersion: number | null; chapterVersion: number | null }>()
      .notNull(),
    dependencies: jsonb("dependencies").$type<string[]>().notNull().default([]),
    outputRefs: jsonb("output_refs")
      .$type<Array<{ type: string; id: string }>>()
      .notNull()
      .default([]),
    cost: jsonb("cost").$type<Record<string, unknown>>().notNull().default({}),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull().default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_work_items_job_key_unique").on(table.jobId, table.workItemKey),
    uniqueIndex("job_work_items_job_idempotency_unique").on(table.jobId, table.idempotencyKey),
    index("job_work_items_job_type_order_idx").on(table.jobId, table.itemType, table.sortOrder),
    index("job_work_items_job_user_order_idx").on(
      table.jobId,
      table.userId,
      table.sortOrder,
      table.id,
    ),
    index("job_work_items_job_status_priority_idx").on(
      table.jobId,
      table.status,
      table.priority,
      table.sortOrder,
    ),
    index("job_work_items_user_work_created_idx").on(table.userId, table.workId, table.createdAt),
    index("job_work_items_parent_idx").on(table.parentId),
    check(
      "job_work_items_type_check",
      sql`${table.itemType} in ('book', 'volume', 'chapter', 'step')`,
    ),
    check(
      "job_work_items_status_check",
      sql`${table.status} in ('pending', 'ready', 'running', 'paused', 'waiting_review', 'succeeded', 'failed', 'skipped', 'cancelled')`,
    ),
    check(
      "job_work_items_priority_class_check",
      sql`${table.priorityClass} in ('interactive', 'batch')`,
    ),
    check("job_work_items_key_check", sql`${table.workItemKey} ~ '^[a-z][a-z0-9:._-]{0,119}$'`),
    check("job_work_items_sort_order_check", sql`${table.sortOrder} >= 0`),
    check("job_work_items_attempt_check", sql`${table.attempt} >= 0`),
    check(
      "job_work_items_priority_check",
      sql`${table.priority} >= 0 and ${table.priority} <= 1000`,
    ),
    check(
      "job_work_items_parent_check",
      sql`(${table.itemType} = 'book' and ${table.parentId} is null) or (${table.itemType} <> 'book' and ${table.parentId} is not null)`,
    ),
    check(
      "job_work_items_chapter_check",
      sql`(${table.itemType} in ('chapter', 'step') and ${table.chapterId} is not null) or (${table.itemType} in ('book', 'volume') and ${table.chapterId} is null)`,
    ),
    check(
      "job_work_items_input_version_check",
      sql`jsonb_typeof(${table.inputVersion}) = 'object'`,
    ),
    check("job_work_items_dependencies_check", sql`jsonb_typeof(${table.dependencies}) = 'array'`),
    check("job_work_items_output_refs_check", sql`jsonb_typeof(${table.outputRefs}) = 'array'`),
  ],
);

export type BatchReviewRiskReasonJson = {
  code: string;
  message: string;
};

export type BatchReviewQualityJson = {
  reportState: "fresh" | "missing" | "stale";
  canApprove: boolean;
  scoreAverage: number | null;
  blockerCount: number;
};

export const batchReviewItems = pgTable(
  "batch_review_items",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => jobWorkItems.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id").references(() => chapterVersions.id, {
      onDelete: "set null",
    }),
    targetVersion: integer("target_version").notNull(),
    chapterNumber: integer("chapter_number"),
    chapterTitle: text("chapter_title"),
    volumeTitle: text("volume_title"),
    status: text("status").notNull().default("pending"),
    risk: text("risk").notNull(),
    riskReasons: jsonb("risk_reasons").$type<BatchReviewRiskReasonJson[]>().notNull().default([]),
    quality: jsonb("quality").$type<BatchReviewQualityJson>().notNull(),
    claimedBy: uuid("claimed_by").references(() => users.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("batch_review_items_plan_work_item_unique").on(table.planId, table.workItemId),
    index("batch_review_items_queue_idx").on(
      table.userId,
      table.branchId,
      table.status,
      table.risk,
    ),
    index("batch_review_items_plan_idx").on(table.planId),
    index("batch_review_items_target_idx").on(table.targetType, table.targetId),
    check(
      "batch_review_items_target_type_check",
      sql`${table.targetType} in ('chapter', 'volume')`,
    ),
    check(
      "batch_review_items_status_check",
      sql`${table.status} in ('pending', 'claimed', 'approved', 'rejected', 'stale')`,
    ),
    check("batch_review_items_risk_check", sql`${table.risk} in ('low', 'medium', 'high')`),
    check("batch_review_items_target_version_check", sql`${table.targetVersion} > 0`),
    check("batch_review_items_version_check", sql`${table.version} > 0`),
    check(
      "batch_review_items_risk_reasons_check",
      sql`jsonb_typeof(${table.riskReasons}) = 'array'`,
    ),
    check(
      "batch_review_items_target_check",
      sql`(${table.targetType} = 'chapter' and ${table.chapterId} is not null) or (${table.targetType} = 'volume' and ${table.chapterId} is null)`,
    ),
    check(
      "batch_review_items_claim_check",
      sql`(${table.status} = 'claimed' and ${table.claimedBy} is not null and ${table.claimedAt} is not null) or (${table.status} <> 'claimed' and (${table.claimedBy} is null or ${table.status} in ('approved', 'rejected')))`,
    ),
  ],
);

export const batchReviewDecisionBatches = pgTable(
  "batch_review_decision_batches",
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
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    response: jsonb("response").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("batch_review_decision_batches_idempotency_unique").on(
      table.userId,
      table.workId,
      table.branchId,
      table.idempotencyKey,
    ),
    index("batch_review_decision_batches_user_created_idx").on(table.userId, table.createdAt),
    check(
      "batch_review_decision_batches_request_hash_check",
      sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`,
    ),
  ],
);

export const batchReviewDecisions = pgTable(
  "batch_review_decisions",
  {
    id: uuid("id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchReviewDecisionBatches.id, { onDelete: "cascade" }),
    queueItemId: uuid("queue_item_id")
      .notNull()
      .references(() => batchReviewItems.id, { onDelete: "restrict" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    risk: text("risk").notNull(),
    reason: text("reason").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorName: text("actor_name").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("batch_review_decisions_batch_item_unique").on(table.batchId, table.queueItemId),
    index("batch_review_decisions_user_created_idx").on(table.userId, table.createdAt),
    index("batch_review_decisions_target_idx").on(table.targetType, table.targetId),
    check(
      "batch_review_decisions_target_type_check",
      sql`${table.targetType} in ('chapter', 'volume')`,
    ),
    check("batch_review_decisions_action_check", sql`${table.action} in ('approve', 'reject')`),
    check("batch_review_decisions_risk_check", sql`${table.risk} in ('low', 'medium', 'high')`),
    check("batch_review_decisions_expected_version_check", sql`${table.expectedVersion} > 0`),
  ],
);

export const writingActions = pgTable(
  "writing_actions",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    outputKind: text("output_kind").notNull(),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    chapterVersionId: uuid("chapter_version_id").references(() => chapterVersions.id, {
      onDelete: "restrict",
    }),
    affectedRange: jsonb("affected_range").$type<Record<string, number>>(),
    artifact: jsonb("artifact").$type<Record<string, unknown>>().notNull(),
    promptKey: text("prompt_key").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    modelProvider: text("model_provider").notNull(),
    model: text("model").notNull(),
    modelParameters: jsonb("model_parameters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("writing_actions_job_unique").on(table.jobId),
    uniqueIndex("writing_actions_chapter_version_unique").on(table.chapterId, table.version),
    index("writing_actions_user_work_idx").on(table.userId, table.workId),
    index("writing_actions_chapter_created_idx").on(table.chapterId, table.createdAt),
    check(
      "writing_actions_action_check",
      sql`${table.action} in ('continue', 'rewrite', 'expand', 'condense', 'change_pov', 'add_hook', 'generate_title', 'generate_summary', 'selection_rewrite', 'targeted_revision')`,
    ),
    check(
      "writing_actions_output_kind_check",
      sql`${table.outputKind} in ('chapter_text', 'title_options', 'summary', 'hooks')`,
    ),
    check("writing_actions_version_check", sql`${table.version} > 0`),
    check(
      "writing_actions_chapter_output_check",
      sql`(${table.outputKind} = 'chapter_text' and ${table.chapterVersionId} is not null) or (${table.outputKind} <> 'chapter_text' and ${table.chapterVersionId} is null)`,
    ),
    check("writing_actions_prompt_hash_check", sql`${table.promptHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const jobSteps = pgTable(
  "job_steps",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    inputHash: text("input_hash"),
    output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
    outputRefs: jsonb("output_refs")
      .$type<Array<{ type: string; id: string }>>()
      .notNull()
      .default([]),
    cost: jsonb("cost").$type<Record<string, unknown>>().notNull().default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_steps_job_step_unique").on(table.jobId, table.stepKey),
    index("job_steps_job_status_idx").on(table.jobId, table.status),
    check("job_steps_step_check", sql`${table.stepKey} ~ '^[a-z][a-z0-9_.-]{0,99}$'`),
    check(
      "job_steps_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')`,
    ),
  ],
);

export const jobStepAttempts = pgTable(
  "job_step_attempts",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull().default("running"),
    inputHash: text("input_hash"),
    outputRefs: jsonb("output_refs")
      .$type<Array<{ type: string; id: string }>>()
      .notNull()
      .default([]),
    checkpointRevision: integer("checkpoint_revision").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_step_attempts_job_step_attempt_unique").on(
      table.jobId,
      table.stepKey,
      table.attempt,
    ),
    index("job_step_attempts_job_step_started_idx").on(table.jobId, table.stepKey, table.startedAt),
    check("job_step_attempts_step_check", sql`${table.stepKey} ~ '^[a-z][a-z0-9_.-]{0,99}$'`),
    check(
      "job_step_attempts_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'skipped', 'cancelled')`,
    ),
    check("job_step_attempts_attempt_check", sql`${table.attempt} > 0`),
    check("job_step_attempts_checkpoint_revision_check", sql`${table.checkpointRevision} >= 0`),
  ],
);

export const jobCheckpoints = pgTable(
  "job_checkpoints",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    revision: integer("revision").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    inputHash: text("input_hash"),
    outputRefs: jsonb("output_refs")
      .$type<Array<{ type: string; id: string }>>()
      .notNull()
      .default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_checkpoints_job_revision_unique").on(table.jobId, table.revision),
    index("job_checkpoints_job_created_idx").on(table.jobId, table.createdAt),
    check("job_checkpoints_schema_version_check", sql`${table.schemaVersion} > 0`),
    check("job_checkpoints_revision_check", sql`${table.revision} >= 0`),
    check("job_checkpoints_attempt_check", sql`${table.attempt} >= 0`),
  ],
);

export const jobRecoveries = pgTable(
  "job_recoveries",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    fromStatus: text("from_status").notNull(),
    fromCheckpointVersion: integer("from_checkpoint_version").notNull(),
    checkpointVersion: integer("checkpoint_version").notNull(),
    resumeStep: text("resume_step").notNull(),
    correlationId: text("correlation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_recoveries_job_idempotency_unique").on(table.jobId, table.idempotencyKey),
    index("job_recoveries_user_work_idx").on(table.userId, table.workId),
    index("job_recoveries_job_created_idx").on(table.jobId, table.createdAt),
    check("job_recoveries_action_check", sql`${table.action} in ('retry', 'resume')`),
    check("job_recoveries_reason_check", sql`length(trim(${table.reason})) > 0`),
    check(
      "job_recoveries_from_status_check",
      sql`${table.fromStatus} in ('queued', 'preparing', 'running', 'paused', 'waiting_review', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "job_recoveries_versions_check",
      sql`${table.fromCheckpointVersion} >= 0 and ${table.checkpointVersion} > ${table.fromCheckpointVersion}`,
    ),
    check(
      "job_recoveries_resume_step_check",
      sql`${table.resumeStep} ~ '^[a-z][a-z0-9_.-]{0,99}$'`,
    ),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("job_events_job_sequence_unique").on(table.jobId, table.sequence),
    index("job_events_job_occurred_idx").on(table.jobId, table.occurredAt),
  ],
);

export const contextPackVersions = pgTable(
  "context_pack_versions",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    compilerVersion: text("compiler_version").notNull(),
    tokenBudget: integer("token_budget").notNull(),
    tokenUsed: integer("token_used").notNull(),
    selected: jsonb("selected").$type<unknown[]>().notNull(),
    evicted: jsonb("evicted").$type<unknown[]>().notNull(),
    sourceRefs: jsonb("source_refs").$type<unknown[]>().notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("context_pack_versions_job_version_unique").on(table.jobId, table.version),
    index("context_pack_versions_chapter_created_idx").on(table.chapterId, table.createdAt),
  ],
);

export const promptVersions = pgTable(
  "prompt_versions",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    key: text("key").notNull(),
    version: integer("version").notNull(),
    role: text("role").notNull(),
    promptHash: text("prompt_hash").notNull(),
    systemHash: text("system_hash").notNull(),
    inputHash: text("input_hash").notNull(),
    contextPackId: uuid("context_pack_id").references(() => contextPackVersions.id, {
      onDelete: "set null",
    }),
    compilerVersion: text("compiler_version"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("prompt_versions_job_step_hash_unique").on(
      table.jobId,
      table.stepKey,
      table.key,
      table.promptHash,
    ),
    index("prompt_versions_user_work_idx").on(table.userId, table.workId),
    index("prompt_versions_job_created_idx").on(table.jobId, table.createdAt),
    check(
      "prompt_versions_role_check",
      sql`${table.role} in ('planner', 'context_curator', 'writer', 'critic', 'reviser', 'fact_extractor', 'canon_curator')`,
    ),
    check("prompt_versions_version_check", sql`${table.version} > 0`),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    promptVersionId: uuid("prompt_version_id").references(() => promptVersions.id, {
      onDelete: "set null",
    }),
    modelConfigId: uuid("model_config_id").references(() => modelConfigs.id, {
      onDelete: "set null",
    }),
    stepKey: text("step_key").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    provider: text("provider"),
    model: text("model"),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    output: text("output").notNull().default(""),
    inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull().default({}),
    outputSummary: jsonb("output_summary").$type<Record<string, unknown>>().notNull().default({}),
    citations: jsonb("citations").$type<unknown[]>().notNull().default([]),
    usage: jsonb("usage").$type<Record<string, unknown>>().notNull().default({}),
    failureClass: text("failure_class"),
    escalationReason: text("escalation_reason"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("agent_runs_job_step_unique").on(table.jobId, table.stepKey),
    index("agent_runs_job_step_idx").on(table.jobId, table.stepKey),
    index("agent_runs_chapter_created_idx").on(table.chapterId, table.startedAt),
    index("agent_runs_user_work_idx").on(table.userId, table.workId),
    check("agent_runs_status_check", sql`${table.status} in ('running', 'succeeded', 'failed')`),
    check(
      "agent_runs_role_check",
      sql`${table.role} in ('planner', 'context_curator', 'writer', 'critic', 'reviser', 'fact_extractor', 'canon_curator')`,
    ),
    check(
      "agent_runs_failure_class_check",
      sql`${table.failureClass} is null or ${table.failureClass} in ('provider', 'timeout', 'rate_limit', 'schema', 'policy', 'budget', 'cancelled', 'unknown')`,
    ),
  ],
);

export const costReservations = pgTable(
  "cost_reservations",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("reserved"),
    reservedTokens: integer("reserved_tokens").notNull(),
    reservedCostCny: real("reserved_cost_cny").notNull(),
    settledTokens: integer("settled_tokens").notNull().default(0),
    settledCostCny: real("settled_cost_cny").notNull().default(0),
    failureClass: text("failure_class"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("cost_reservations_job_idempotency_unique").on(table.jobId, table.idempotencyKey),
    index("cost_reservations_job_status_idx").on(table.jobId, table.status),
    index("cost_reservations_user_work_idx").on(table.userId, table.workId),
    index("cost_reservations_agent_run_idx").on(table.agentRunId),
    check(
      "cost_reservations_status_check",
      sql`${table.status} in ('reserved', 'settled', 'released')`,
    ),
    check(
      "cost_reservations_amounts_check",
      sql`${table.reservedTokens} >= 0 and ${table.reservedCostCny} >= 0 and ${table.settledTokens} >= 0 and ${table.settledCostCny} >= 0`,
    ),
    check(
      "cost_reservations_failure_class_check",
      sql`${table.failureClass} is null or ${table.failureClass} in ('provider', 'timeout', 'rate_limit', 'schema', 'policy', 'budget', 'cancelled', 'unknown')`,
    ),
    check(
      "cost_reservations_evidence_check",
      sql`(${table.status} = 'settled' and ${table.settledAt} is not null) or (${table.status} <> 'settled' and ${table.settledAt} is null)`,
    ),
  ],
);

export const modelCalls = pgTable(
  "model_calls",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    promptVersionId: uuid("prompt_version_id")
      .notNull()
      .references(() => promptVersions.id, { onDelete: "restrict" }),
    costReservationId: uuid("cost_reservation_id")
      .notNull()
      .references(() => costReservations.id, { onDelete: "restrict" }),
    stepKey: text("step_key").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull().default("started"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull(),
    configHash: text("config_hash").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull().default({}),
    outputSummary: jsonb("output_summary").$type<Record<string, unknown>>().notNull().default({}),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCny: real("cost_cny").notNull().default(0),
    failureClass: text("failure_class"),
    errorCode: text("error_code"),
    escalationReason: text("escalation_reason"),
    providerRequestId: text("provider_request_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("model_calls_job_step_attempt_unique").on(
      table.jobId,
      table.stepKey,
      table.attempt,
    ),
    uniqueIndex("model_calls_cost_reservation_unique").on(table.costReservationId),
    index("model_calls_job_created_idx").on(table.jobId, table.createdAt),
    index("model_calls_chapter_created_idx").on(table.chapterId, table.createdAt),
    index("model_calls_user_work_idx").on(table.userId, table.workId),
    check("model_calls_status_check", sql`${table.status} in ('started', 'succeeded', 'failed')`),
    check(
      "model_calls_failure_class_check",
      sql`${table.failureClass} is null or ${table.failureClass} in ('provider', 'timeout', 'rate_limit', 'schema', 'policy', 'budget', 'cancelled', 'unknown')`,
    ),
    check(
      "model_calls_usage_check",
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.costCny} >= 0`,
    ),
  ],
);

export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    stepKey: text("step_key"),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    costCny: real("cost_cny").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_records_job_step_unique")
      .on(table.jobId, table.stepKey)
      .where(sql`${table.stepKey} is not null`),
    index("usage_records_job_created_idx").on(table.jobId, table.createdAt),
  ],
);

export const agentGrants = pgTable(
  "agent_grants",
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
    taskId: uuid("task_id").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    toolNames: jsonb("tool_names").$type<string[]>().notNull(),
    resourceScope: jsonb("resource_scope").$type<Record<string, unknown>>().notNull(),
    budget: jsonb("budget").$type<Record<string, unknown>>().notNull(),
    maxImpact: jsonb("max_impact").$type<Record<string, unknown>>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id, { onDelete: "restrict" }),
    revocationReason: text("revocation_reason"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_grants_user_work_idx").on(table.userId, table.workId),
    index("agent_grants_branch_task_idx").on(table.branchId, table.taskId),
    index("agent_grants_expires_idx").on(table.expiresAt),
    check(
      "agent_grants_role_check",
      sql`${table.role} in ('planner', 'context_curator', 'writer', 'critic', 'reviser', 'fact_extractor', 'canon_curator')`,
    ),
    check("agent_grants_status_check", sql`${table.status} in ('active', 'revoked')`),
    check("agent_grants_version_check", sql`${table.version} > 0`),
    check(
      "agent_grants_revocation_check",
      sql`(${table.status} = 'active' and ${table.revokedAt} is null and ${table.revokedBy} is null and ${table.revocationReason} is null) or (${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.revokedBy} is not null and ${table.revocationReason} is not null)`,
    ),
  ],
);

export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => agentGrants.id, { onDelete: "cascade" }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    toolName: text("tool_name").notNull(),
    sideEffect: text("side_effect"),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    inputHash: text("input_hash").notNull(),
    inputSummary: jsonb("input_summary").$type<Record<string, unknown>>().notNull(),
    outputSummary: jsonb("output_summary").$type<Record<string, unknown>>(),
    affectedResources: integer("affected_resources").notNull(),
    estimatedCostCny: real("estimated_cost_cny").notNull(),
    estimatedTokens: integer("estimated_tokens").notNull(),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_tool_calls_grant_created_idx").on(table.grantId, table.createdAt),
    index("agent_tool_calls_user_work_idx").on(table.userId, table.workId),
    check("agent_tool_calls_decision_check", sql`${table.decision} in ('allow', 'deny')`),
    check(
      "agent_tool_calls_side_effect_check",
      sql`${table.sideEffect} is null or ${table.sideEffect} in ('S0', 'S1', 'S2', 'S3', 'S4')`,
    ),
    check(
      "agent_tool_calls_status_check",
      sql`${table.status} in ('authorized', 'denied', 'succeeded', 'failed')`,
    ),
    check("agent_tool_calls_affected_check", sql`${table.affectedResources} > 0`),
    check("agent_tool_calls_cost_check", sql`${table.estimatedCostCny} >= 0`),
    check("agent_tool_calls_tokens_check", sql`${table.estimatedTokens} >= 0`),
  ],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    workId: uuid("work_id").references(() => works.id, { onDelete: "set null" }),
    branchId: uuid("branch_id").references(() => workBranches.id, { onDelete: "set null" }),
    mode: text("mode").notNull().default("settings"),
    status: text("status").notNull().default("awaiting_confirmation"),
    sourceKind: text("source_kind").notNull(),
    sourceName: text("source_name"),
    sourceText: text("source_text").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("import_jobs_user_created_idx").on(table.userId, table.createdAt),
    check("import_jobs_mode_check", sql`${table.mode} in ('settings', 'manuscript_text')`),
    check(
      "import_jobs_status_check",
      sql`${table.status} in ('awaiting_confirmation', 'completed')`,
    ),
    check("import_jobs_source_kind_check", sql`${table.sourceKind} in ('paste', 'file')`),
  ],
);

export const importCandidates = pgTable(
  "import_candidates",
  {
    id: uuid("id").primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    candidateType: text("candidate_type").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    sourceExcerpt: text("source_excerpt").notNull(),
    confidence: real("confidence").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("import_candidates_job_idx").on(table.importJobId),
    check(
      "import_candidates_type_check",
      sql`${table.candidateType} in ('character', 'faction', 'map', 'power_system', 'golden_finger')`,
    ),
    check(
      "import_candidates_status_check",
      sql`${table.status} in ('accepted', 'pending', 'conflict')`,
    ),
    check(
      "import_candidates_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export const importConflicts = pgTable(
  "import_conflicts",
  {
    id: uuid("id").primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conflictType: text("conflict_type").notNull(),
    summary: text("summary").notNull(),
    primaryCandidateId: uuid("primary_candidate_id")
      .notNull()
      .references(() => importCandidates.id, { onDelete: "cascade" }),
    secondaryCandidateId: uuid("secondary_candidate_id")
      .notNull()
      .references(() => importCandidates.id, { onDelete: "cascade" }),
    decision: text("decision").notNull().default("pending"),
    reason: text("reason"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("import_conflicts_job_idx").on(table.importJobId),
    check("import_conflicts_type_check", sql`${table.conflictType} in ('contradictory_setting')`),
    check(
      "import_conflicts_decision_check",
      sql`${table.decision} in ('pending', 'use_primary', 'use_secondary')`,
    ),
  ],
);

export const importReports = pgTable(
  "import_reports",
  {
    id: uuid("id").primaryKey(),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    acceptedCandidateIds: jsonb("accepted_candidate_ids").$type<string[]>().notNull(),
    pendingCandidateIds: jsonb("pending_candidate_ids").$type<string[]>().notNull(),
    unparsed: jsonb("unparsed").$type<Array<{ sourceExcerpt: string; reason: string }>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("import_reports_job_unique").on(table.importJobId)],
);

export type SceneBeatJson = {
  id: string;
  order: number;
  description: string;
};

export type SceneInformationReleaseJson = {
  id: string;
  order: number;
  description: string;
  constraint: string | null;
};

export type SummarySourceRangeJson = {
  nodeId: string;
  versionNodeId: string | null;
  objectVersion: number;
  chapterFrom: number;
  chapterTo: number | null;
};

export type VolumePlotLineJson = {
  name: string;
  status: string;
  note: string;
};

export const outlineNodes = pgTable(
  "outline_nodes",
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
    level: text("level").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => outlineNodes.id, {
      onDelete: "restrict",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("planned"),
    locked: boolean("locked").notNull().default(false),
    version: integer("version").notNull().default(1),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    tension: integer("tension"),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outline_nodes_user_work_idx").on(table.userId, table.workId),
    index("outline_nodes_branch_parent_idx").on(table.branchId, table.parentId, table.sortOrder),
    uniqueIndex("outline_nodes_parent_order_unique").on(
      table.branchId,
      sql`coalesce(${table.parentId}::text, 'root')`,
      table.sortOrder,
    ),
    uniqueIndex("outline_nodes_branch_chapter_unique")
      .on(table.branchId, table.chapterId)
      .where(sql`${table.chapterId} is not null`),
    uniqueIndex("outline_nodes_branch_book_unique")
      .on(table.branchId)
      .where(sql`${table.level} = 'book'`),
    check(
      "outline_nodes_level_check",
      sql`${table.level} in ('book', 'volume', 'act', 'chapter', 'scene')`,
    ),
    check("outline_nodes_status_check", sql`${table.status} in ('planned', 'active', 'done')`),
    check(
      "outline_nodes_tension_check",
      sql`${table.tension} is null or (${table.tension} >= 0 and ${table.tension} <= 100)`,
    ),
    check(
      "outline_nodes_parent_check",
      sql`(${table.level} = 'book' and ${table.parentId} is null) or (${table.level} <> 'book' and ${table.parentId} is not null)`,
    ),
    check(
      "outline_nodes_chapter_check",
      sql`(${table.level} = 'chapter' and ${table.chapterId} is not null) or (${table.level} <> 'chapter' and ${table.chapterId} is null)`,
    ),
  ],
);

export const volumeContracts = pgTable(
  "volume_contracts",
  {
    id: uuid("id").primaryKey(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => outlineNodes.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    objective: text("objective").notNull(),
    conflict: text("conflict").notNull(),
    turningPoints: jsonb("turning_points").$type<string[]>().notNull().default([]),
    exitConditions: jsonb("exit_conditions").$type<string[]>().notNull().default([]),
    plotLines: jsonb("plot_lines").$type<VolumePlotLineJson[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("volume_contracts_node_unique").on(table.nodeId),
    index("volume_contracts_user_work_idx").on(table.userId, table.workId),
  ],
);

export const sceneCards = pgTable(
  "scene_cards",
  {
    id: uuid("id").primaryKey(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => outlineNodes.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    povType: text("pov_type"),
    povId: uuid("pov_id"),
    povBranchId: uuid("pov_branch_id"),
    povLabel: text("pov_label"),
    povVersionNodeId: uuid("pov_version_node_id"),
    povObjectVersion: integer("pov_object_version"),
    locationType: text("location_type"),
    locationId: uuid("location_id"),
    locationBranchId: uuid("location_branch_id"),
    locationLabel: text("location_label"),
    locationVersionNodeId: uuid("location_version_node_id"),
    locationObjectVersion: integer("location_object_version"),
    storyEra: text("story_era"),
    storyTimeLabel: text("story_time_label"),
    storySortKey: integer("story_sort_key"),
    beats: jsonb("beats").$type<SceneBeatJson[]>().notNull().default([]),
    informationReleases: jsonb("information_releases")
      .$type<SceneInformationReleaseJson[]>()
      .notNull()
      .default([]),
    tension: integer("tension"),
    version: integer("version").notNull().default(1),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("scene_cards_node_unique").on(table.nodeId),
    index("scene_cards_user_work_idx").on(table.userId, table.workId),
    check(
      "scene_cards_pov_check",
      sql`(${table.povType} is null and ${table.povId} is null and ${table.povBranchId} is null) or (${table.povType} is not null and ${table.povId} is not null and ${table.povBranchId} is not null)`,
    ),
    check(
      "scene_cards_location_check",
      sql`(${table.locationType} is null and ${table.locationId} is null and ${table.locationBranchId} is null) or (${table.locationType} is not null and ${table.locationId} is not null and ${table.locationBranchId} is not null)`,
    ),
    check(
      "scene_cards_story_time_check",
      sql`(${table.storyEra} is null and ${table.storyTimeLabel} is null and ${table.storySortKey} is null) or (${table.storyEra} is not null and ${table.storyTimeLabel} is not null and ${table.storySortKey} is not null)`,
    ),
    check(
      "scene_cards_tension_check",
      sql`${table.tension} is null or (${table.tension} >= 0 and ${table.tension} <= 100)`,
    ),
  ],
);

export const searchDocuments = pgTable(
  "search_documents",
  {
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    entityType: text("entity_type"),
    title: text("title").notNull().default(""),
    content: text("content").notNull().default(""),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "cascade" }),
    objectVersion: integer("object_version").notNull(),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    fromChapter: integer("from_chapter").notNull(),
    toChapter: integer("to_chapter"),
    fromEra: text("from_era"),
    fromStoryTimeLabel: text("from_story_time_label"),
    fromStorySortKey: integer("from_story_sort_key"),
    toEra: text("to_era"),
    toStoryTimeLabel: text("to_story_time_label"),
    toStorySortKey: integer("to_story_sort_key"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "search_documents_pkey",
      columns: [table.branchId, table.sourceType, table.sourceId, table.versionNodeId],
    }),
    index("search_documents_user_work_branch_idx").on(
      table.userId,
      table.workId,
      table.branchId,
      table.sourceType,
    ),
    index("search_documents_branch_chapter_idx").on(
      table.branchId,
      table.fromChapter,
      table.toChapter,
    ),
    check(
      "search_documents_source_type_check",
      sql`${table.sourceType} in ('entity', 'fact', 'timeline_event', 'map_node')`,
    ),
    check(
      "search_documents_entity_type_check",
      sql`${table.entityType} is null or ${table.entityType} in ('world_rule', 'character', 'faction', 'map', 'power_system', 'golden_finger', 'item', 'timeline_event')`,
    ),
    check(
      "search_documents_validity_check",
      sql`${table.toChapter} is null or ${table.toChapter} >= ${table.fromChapter}`,
    ),
    check(
      "search_documents_from_story_time_check",
      sql`(${table.fromEra} is null and ${table.fromStoryTimeLabel} is null and ${table.fromStorySortKey} is null) or (${table.fromEra} is not null and ${table.fromStoryTimeLabel} is not null and ${table.fromStorySortKey} is not null)`,
    ),
    check(
      "search_documents_to_story_time_check",
      sql`(${table.toEra} is null and ${table.toStoryTimeLabel} is null and ${table.toStorySortKey} is null) or (${table.fromEra} is not null and ${table.toEra} is not null and ${table.toStoryTimeLabel} is not null and ${table.toStorySortKey} is not null)`,
    ),
  ],
);

export const summaryRecords = pgTable(
  "summary_records",
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
    level: text("level").notNull(),
    scopeId: uuid("scope_id").notNull(),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("stale"),
    version: integer("version").notNull().default(1),
    contentHash: text("content_hash").notNull(),
    inputHash: text("input_hash").notNull(),
    compilerVersion: text("compiler_version").notNull(),
    modelVersion: text("model_version").notNull(),
    sourceRanges: jsonb("source_ranges").$type<SummarySourceRangeJson[]>().notNull(),
    fromChapter: integer("from_chapter").notNull(),
    toChapter: integer("to_chapter"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidationReason: text("invalidation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("summary_records_branch_scope_unique").on(
      table.branchId,
      table.level,
      table.scopeId,
    ),
    index("summary_records_user_work_branch_status_idx").on(
      table.userId,
      table.workId,
      table.branchId,
      table.status,
    ),
    index("summary_records_branch_range_idx").on(
      table.branchId,
      table.fromChapter,
      table.toChapter,
    ),
    check(
      "summary_records_level_check",
      sql`${table.level} in ('chapter', 'stage', 'volume', 'book')`,
    ),
    check("summary_records_status_check", sql`${table.status} in ('fresh', 'stale', 'rebuilding')`),
    check("summary_records_version_check", sql`${table.version} > 0`),
    check(
      "summary_records_content_hash_check",
      sql`${table.contentHash} ~ '^[a-fA-F0-9]{64}$' and ${table.inputHash} ~ '^[a-fA-F0-9]{64}$'`,
    ),
    check(
      "summary_records_range_check",
      sql`${table.toChapter} is null or ${table.toChapter} >= ${table.fromChapter}`,
    ),
    check(
      "summary_records_invalidation_check",
      sql`(${table.status} = 'fresh' and ${table.invalidatedAt} is null and ${table.invalidationReason} is null) or (${table.status} <> 'fresh' and ${table.invalidatedAt} is not null and length(trim(${table.invalidationReason})) > 0)`,
    ),
  ],
);

export const summaryRebuildRuns = pgTable(
  "summary_rebuild_runs",
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
    status: text("status").notNull().default("queued"),
    levels: jsonb("levels").$type<string[]>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    compilerVersion: text("compiler_version").notNull(),
    modelVersion: text("model_version").notNull(),
    checkpointRevision: integer("checkpoint_revision").notNull().default(0),
    totalItems: integer("total_items").notNull().default(0),
    completedItems: integer("completed_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("summary_rebuild_runs_branch_idempotency_unique").on(
      table.branchId,
      table.idempotencyKey,
    ),
    index("summary_rebuild_runs_user_work_branch_idx").on(
      table.userId,
      table.workId,
      table.branchId,
      table.createdAt,
    ),
    check(
      "summary_rebuild_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    check(
      "summary_rebuild_runs_counts_check",
      sql`${table.checkpointRevision} >= 0 and ${table.totalItems} >= 0 and ${table.completedItems} >= 0 and ${table.completedItems} <= ${table.totalItems} and ${table.failedItems} >= 0 and ${table.failedItems} <= ${table.totalItems}`,
    ),
  ],
);

export const summaryRebuildItems = pgTable(
  "summary_rebuild_items",
  {
    id: uuid("id").primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => summaryRebuildRuns.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    level: text("level").notNull(),
    scopeId: uuid("scope_id").notNull(),
    status: text("status").notNull().default("pending"),
    inputHash: text("input_hash"),
    outputSummaryId: uuid("output_summary_id").references(() => summaryRecords.id, {
      onDelete: "set null",
    }),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("summary_rebuild_items_run_ordinal_unique").on(table.runId, table.ordinal),
    uniqueIndex("summary_rebuild_items_run_scope_unique").on(
      table.runId,
      table.level,
      table.scopeId,
    ),
    index("summary_rebuild_items_run_status_idx").on(table.runId, table.status, table.ordinal),
    check(
      "summary_rebuild_items_level_check",
      sql`${table.level} in ('chapter', 'stage', 'volume', 'book')`,
    ),
    check(
      "summary_rebuild_items_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed')`,
    ),
    check("summary_rebuild_items_ordinal_check", sql`${table.ordinal} >= 0`),
    check("summary_rebuild_items_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export type StoryLedgerEvidenceJson = {
  kind: string;
  sourceId: string | null;
  label: string;
  quote: string;
  locator: string;
  confidence: number | null;
  strength: "weak" | "strong";
};

export type StoryLedgerHistoryJson = {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  chapter: {
    id: string;
    number: number;
    title: string;
  } | null;
  event: {
    eventId: string;
    label: string;
    chapterNumber: number | null;
    validFromChapter: number | null;
    validToChapter: number | null;
  } | null;
  reason: string;
  evidence: StoryLedgerEvidenceJson[];
  actorId: string;
  createdAt: string;
};

const ledgerStatusCheck = (column: AnyPgColumn) =>
  sql`${column} in ('planned', 'planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned', 'deferred')`;

const ledgerResponsibleRoleCheck = (column: AnyPgColumn) =>
  sql`${column} in ('protagonist', 'antagonist', 'supporting', 'ensemble', 'author')`;

const ledgerSourceCheck = (
  status: AnyPgColumn,
  sourceChapterId: AnyPgColumn,
  sourceEventId: AnyPgColumn,
) =>
  sql`(${status} not in ('planted', 'progressed', 'paid_off', 'failed_payoff', 'abandoned') or ${sourceChapterId} is not null or ${sourceEventId} is not null)`;

const ledgerHistoryCheck = (status: AnyPgColumn, history: AnyPgColumn) =>
  sql`(${status} = 'planned' or jsonb_array_length(${history}) > 0)`;

const ledgerEvidenceCheck = (status: AnyPgColumn, evidence: AnyPgColumn) =>
  sql`(${status} not in ('paid_off', 'failed_payoff') or jsonb_array_length(${evidence}) > 0)`;

export const plotThreads = pgTable(
  "plot_threads",
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
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("planned"),
    responsibleRole: text("responsible_role").notNull(),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    sourceEventId: uuid("source_event_id").references(() => timelineEvents.id, {
      onDelete: "set null",
    }),
    targetFromChapter: integer("target_from_chapter").notNull(),
    targetToChapter: integer("target_to_chapter").notNull(),
    prerequisiteEventIds: jsonb("prerequisite_event_ids").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<StoryLedgerEvidenceJson[]>().notNull().default([]),
    history: jsonb("history").$type<StoryLedgerHistoryJson[]>().notNull().default([]),
    threadType: text("thread_type").notNull(),
    stakes: text("stakes").notNull(),
    tension: integer("tension"),
    version: integer("version").notNull().default(1),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("plot_threads_user_work_idx").on(table.userId, table.workId),
    index("plot_threads_branch_status_idx").on(table.branchId, table.status),
    index("plot_threads_branch_target_idx").on(table.branchId, table.targetToChapter),
    check(
      "plot_threads_thread_type_check",
      sql`${table.threadType} in ('main', 'subplot', 'character', 'faction', 'world', 'mystery', 'romance')`,
    ),
    check("plot_threads_status_check", ledgerStatusCheck(table.status)),
    check("plot_threads_responsible_role_check", ledgerResponsibleRoleCheck(table.responsibleRole)),
    check(
      "plot_threads_source_check",
      ledgerSourceCheck(table.status, table.sourceChapterId, table.sourceEventId),
    ),
    check("plot_threads_history_check", ledgerHistoryCheck(table.status, table.history)),
    check("plot_threads_evidence_check", ledgerEvidenceCheck(table.status, table.evidence)),
    check(
      "plot_threads_target_window_check",
      sql`${table.targetToChapter} >= ${table.targetFromChapter}`,
    ),
    check(
      "plot_threads_tension_check",
      sql`${table.tension} is null or (${table.tension} >= 0 and ${table.tension} <= 100)`,
    ),
  ],
);

export const foreshadows = pgTable(
  "foreshadows",
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
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("planned"),
    responsibleRole: text("responsible_role").notNull(),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    sourceEventId: uuid("source_event_id").references(() => timelineEvents.id, {
      onDelete: "set null",
    }),
    targetFromChapter: integer("target_from_chapter").notNull(),
    targetToChapter: integer("target_to_chapter").notNull(),
    prerequisiteEventIds: jsonb("prerequisite_event_ids").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<StoryLedgerEvidenceJson[]>().notNull().default([]),
    history: jsonb("history").$type<StoryLedgerHistoryJson[]>().notNull().default([]),
    importance: text("importance").notNull().default("must"),
    readerPromise: text("reader_promise").notNull(),
    relatedCharacterIds: jsonb("related_character_ids").$type<string[]>().notNull().default([]),
    relatedFactionIds: jsonb("related_faction_ids").$type<string[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("foreshadows_user_work_idx").on(table.userId, table.workId),
    index("foreshadows_branch_status_idx").on(table.branchId, table.status),
    index("foreshadows_branch_target_idx").on(table.branchId, table.targetToChapter),
    check("foreshadows_importance_check", sql`${table.importance} in ('must', 'optional')`),
    check("foreshadows_status_check", ledgerStatusCheck(table.status)),
    check("foreshadows_responsible_role_check", ledgerResponsibleRoleCheck(table.responsibleRole)),
    check(
      "foreshadows_source_check",
      ledgerSourceCheck(table.status, table.sourceChapterId, table.sourceEventId),
    ),
    check("foreshadows_history_check", ledgerHistoryCheck(table.status, table.history)),
    check("foreshadows_evidence_check", ledgerEvidenceCheck(table.status, table.evidence)),
    check(
      "foreshadows_target_window_check",
      sql`${table.targetToChapter} >= ${table.targetFromChapter}`,
    ),
  ],
);

export const characterArcs = pgTable(
  "character_arcs",
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
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("planned"),
    responsibleRole: text("responsible_role").notNull(),
    sourceChapterId: uuid("source_chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    sourceEventId: uuid("source_event_id").references(() => timelineEvents.id, {
      onDelete: "set null",
    }),
    targetFromChapter: integer("target_from_chapter").notNull(),
    targetToChapter: integer("target_to_chapter").notNull(),
    prerequisiteEventIds: jsonb("prerequisite_event_ids").$type<string[]>().notNull().default([]),
    evidence: jsonb("evidence").$type<StoryLedgerEvidenceJson[]>().notNull().default([]),
    history: jsonb("history").$type<StoryLedgerHistoryJson[]>().notNull().default([]),
    characterId: uuid("character_id")
      .notNull()
      .references(() => entities.id, { onDelete: "restrict" }),
    startState: text("start_state").notNull(),
    desire: text("desire").notNull(),
    fear: text("fear").notNull(),
    lie: text("lie").notNull(),
    truth: text("truth").notNull(),
    endState: text("end_state").notNull(),
    version: integer("version").notNull().default(1),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("character_arcs_user_work_idx").on(table.userId, table.workId),
    index("character_arcs_branch_status_idx").on(table.branchId, table.status),
    index("character_arcs_branch_target_idx").on(table.branchId, table.targetToChapter),
    index("character_arcs_character_idx").on(table.characterId),
    check("character_arcs_status_check", ledgerStatusCheck(table.status)),
    check(
      "character_arcs_responsible_role_check",
      ledgerResponsibleRoleCheck(table.responsibleRole),
    ),
    check(
      "character_arcs_source_check",
      ledgerSourceCheck(table.status, table.sourceChapterId, table.sourceEventId),
    ),
    check("character_arcs_history_check", ledgerHistoryCheck(table.status, table.history)),
    check("character_arcs_evidence_check", ledgerEvidenceCheck(table.status, table.evidence)),
    check(
      "character_arcs_target_window_check",
      sql`${table.targetToChapter} >= ${table.targetFromChapter}`,
    ),
  ],
);

export type GoldenThreeChapterPinJson = {
  chapterId: string;
  chapterNumber: number;
  chapterTitle: string;
  chapterVersionId: string;
  chapterVersion: number;
  versionNodeId: string;
  contentHash: string;
  wordCount: number;
  content: string;
};

export type GoldenThreeReviewSnapshotJson = {
  dimension: string;
  score: number;
  evidenceChapterId: string;
  evidenceChapterVersionId: string;
  evidencePassage: string;
  evidenceLocator: string;
  reviewerOrigin: string;
  required: boolean;
  passed: boolean;
};

export type GoldenThreeStyleProfileJson = {
  strategy: string;
  candidateLabel: string;
  excerpts: Array<{
    chapterId: string;
    chapterVersionId: string;
    excerpt: string;
  }>;
};

export const goldenThreeCandidates = pgTable(
  "golden_three_candidates",
  {
    id: uuid("id").primaryKey(),
    batchId: uuid("batch_id").notNull(),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    label: text("label").notNull(),
    strategy: text("strategy").notNull(),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    promptKey: text("prompt_key").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    promptHash: text("prompt_hash").notNull(),
    modelProvider: text("model_provider").notNull(),
    model: text("model").notNull(),
    modelParameters: jsonb("model_parameters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    contextPackVersionId: uuid("context_pack_version_id").references(() => contextPackVersions.id, {
      onDelete: "set null",
    }),
    contextManifestHash: text("context_manifest_hash").notNull(),
    chapterPins: jsonb("chapter_pins").$type<GoldenThreeChapterPinJson[]>().notNull(),
    generationJobId: uuid("generation_job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    modelCallId: uuid("model_call_id").references(() => modelCalls.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("golden_three_candidates_idempotency_strategy_unique").on(
      table.workId,
      table.branchId,
      table.idempotencyKey,
      table.strategy,
    ),
    uniqueIndex("golden_three_candidates_batch_strategy_unique").on(table.batchId, table.strategy),
    index("golden_three_candidates_user_work_idx").on(table.userId, table.workId),
    index("golden_three_candidates_branch_created_idx").on(table.branchId, table.createdAt),
    check(
      "golden_three_candidates_strategy_check",
      sql`${table.strategy} in ('hook_focus', 'character_focus', 'world_focus')`,
    ),
    check(
      "golden_three_candidates_status_check",
      sql`${table.status} in ('draft', 'reviewed', 'selected', 'locked')`,
    ),
    check("golden_three_candidates_prompt_hash_check", sql`${table.promptHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "golden_three_candidates_context_hash_check",
      sql`${table.contextManifestHash} ~ '^[a-f0-9]{64}$'`,
    ),
    check(
      "golden_three_candidates_pins_check",
      sql`jsonb_typeof(${table.chapterPins}) = 'array' and jsonb_array_length(${table.chapterPins}) = 1`,
    ),
  ],
);

export const goldenThreeReviews = pgTable(
  "golden_three_reviews",
  {
    id: uuid("id").primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => goldenThreeCandidates.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    score: integer("score").notNull(),
    evidenceChapterId: uuid("evidence_chapter_id").notNull(),
    evidenceChapterVersionId: uuid("evidence_chapter_version_id").notNull(),
    evidencePassage: text("evidence_passage").notNull(),
    evidenceLocator: text("evidence_locator").notNull(),
    reviewerOrigin: text("reviewer_origin").notNull(),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("golden_three_reviews_candidate_dimension_unique").on(
      table.candidateId,
      table.dimension,
    ),
    index("golden_three_reviews_user_work_idx").on(table.userId, table.workId),
    check(
      "golden_three_reviews_dimension_check",
      sql`${table.dimension} in ('opening_hook', 'protagonist_appeal', 'world_rules', 'core_conflict', 'reader_promise', 'chapter_end_hook')`,
    ),
    check("golden_three_reviews_score_check", sql`${table.score} between 1 and 5`),
    check(
      "golden_three_reviews_origin_check",
      sql`${table.reviewerOrigin} in ('model', 'author', 'critic')`,
    ),
    check(
      "golden_three_reviews_evidence_check",
      sql`length(trim(${table.evidencePassage})) > 0 and length(trim(${table.evidenceLocator})) > 0`,
    ),
  ],
);

export const styleBaselines = pgTable(
  "style_baselines",
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
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    version: integer("version").notNull().default(1),
    profile: jsonb("profile").$type<GoldenThreeStyleProfileJson>().notNull(),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("style_baselines_source_unique").on(
      table.workId,
      table.branchId,
      table.sourceType,
      table.sourceId,
    ),
    index("style_baselines_user_work_idx").on(table.userId, table.workId),
    check("style_baselines_source_type_check", sql`${table.sourceType} = 'golden_three'`),
  ],
);

export const goldenThreeLocks = pgTable(
  "golden_three_locks",
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
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => goldenThreeCandidates.id, { onDelete: "restrict" }),
    versionNodeId: uuid("version_node_id")
      .notNull()
      .references(() => versionNodes.id, { onDelete: "restrict" }),
    styleBaselineId: uuid("style_baseline_id")
      .notNull()
      .references(() => styleBaselines.id, { onDelete: "restrict" }),
    chapterPins: jsonb("chapter_pins").$type<GoldenThreeChapterPinJson[]>().notNull(),
    reviewSnapshot: jsonb("review_snapshot").$type<GoldenThreeReviewSnapshotJson[]>().notNull(),
    overridePolicy: text("override_policy"),
    overrideRationale: text("override_rationale"),
    lockedBy: uuid("locked_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("golden_three_locks_branch_unique").on(table.workId, table.branchId),
    uniqueIndex("golden_three_locks_candidate_unique").on(table.candidateId),
    index("golden_three_locks_user_work_idx").on(table.userId, table.workId),
    check(
      "golden_three_locks_override_check",
      sql`(${table.overridePolicy} is null and ${table.overrideRationale} is null) or (${table.overridePolicy} = 'author_override_v1' and ${table.overrideRationale} is not null and length(trim(${table.overrideRationale})) >= 10)`,
    ),
    check(
      "golden_three_locks_pins_check",
      sql`jsonb_typeof(${table.chapterPins}) = 'array' and jsonb_array_length(${table.chapterPins}) = 3`,
    ),
  ],
);

export type QualityDimensionEvidenceJson = {
  kind: string;
  sourceId: string | null;
  sourceVersionId: string | null;
  chapterId: string;
  chapterVersionId: string | null;
  quote: string;
  startOffset: number;
  endOffset: number;
  locator: string;
  explanation: string;
};

export type QualityDimensionJson = {
  dimension: string;
  label: string;
  score: number;
  rationale: string;
  evidence: QualityDimensionEvidenceJson[];
};

export const qualityReports = pgTable(
  "quality_reports",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    rubricVersion: text("rubric_version").notNull(),
    ruleVersion: text("rule_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    dimensions: jsonb("dimensions").$type<QualityDimensionJson[]>().notNull(),
    summary: text("summary").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("quality_reports_user_work_idx").on(table.userId, table.workId),
    index("quality_reports_chapter_created_idx").on(table.chapterId, table.createdAt),
    index("quality_reports_version_created_idx").on(table.chapterVersionId, table.createdAt),
    check(
      "quality_reports_rubric_version_check",
      sql`${table.rubricVersion} = 'm1-quality-rubric-v1'`,
    ),
    check("quality_reports_rule_version_check", sql`${table.ruleVersion} = 'm1-critic-rules-v1'`),
    check("quality_reports_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "quality_reports_dimensions_check",
      sql`jsonb_typeof(${table.dimensions}) = 'array' and jsonb_array_length(${table.dimensions}) = 6`,
    ),
  ],
);

export const qualityFindings = pgTable(
  "quality_findings",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => qualityReports.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    dimension: text("dimension").notNull(),
    qualityDimension: text("quality_dimension").notNull(),
    severity: text("severity").notNull(),
    structural: boolean("structural").notNull().default(false),
    code: text("code").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    evidence: jsonb("evidence").$type<QualityDimensionEvidenceJson[]>().notNull(),
    sourceRefs: jsonb("source_refs").$type<Array<Record<string, unknown>>>().notNull(),
    affectedObjects: jsonb("affected_objects").$type<Array<Record<string, unknown>>>().notNull(),
    recommendation: text("recommendation").notNull(),
    status: text("status").notNull().default("open"),
    ignoredReason: text("ignored_reason"),
    dismissedBy: uuid("dismissed_by").references(() => users.id, { onDelete: "set null" }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("quality_findings_report_dedupe_unique").on(table.reportId, table.dedupeKey),
    index("quality_findings_user_work_idx").on(table.userId, table.workId),
    index("quality_findings_chapter_status_idx").on(
      table.chapterId,
      table.chapterVersionId,
      table.status,
    ),
    check(
      "quality_findings_dimension_check",
      sql`${table.dimension} in ('continuity', 'style', 'reader_experience')`,
    ),
    check(
      "quality_findings_quality_dimension_check",
      sql`${table.qualityDimension} in ('hook', 'pacing', 'information_density', 'character_voice', 'prose', 'continuity')`,
    ),
    check("quality_findings_severity_check", sql`${table.severity} in ('P0', 'P1', 'P2', 'P3')`),
    check(
      "quality_findings_status_check",
      sql`${table.status} in ('open', 'dismissed', 'superseded')`,
    ),
    check(
      "quality_findings_ignored_reason_check",
      sql`(${table.status} = 'dismissed' and ${table.ignoredReason} is not null and length(trim(${table.ignoredReason})) > 0) or (${table.status} <> 'dismissed' and ${table.ignoredReason} is null and ${table.dismissedBy} is null and ${table.dismissedAt} is null)`,
    ),
    check(
      "quality_findings_evidence_check",
      sql`jsonb_typeof(${table.evidence}) = 'array' and jsonb_array_length(${table.evidence}) > 0`,
    ),
    check(
      "quality_findings_source_refs_check",
      sql`jsonb_typeof(${table.sourceRefs}) = 'array' and jsonb_array_length(${table.sourceRefs}) > 0`,
    ),
    check(
      "quality_findings_affected_objects_check",
      sql`jsonb_typeof(${table.affectedObjects}) = 'array' and jsonb_array_length(${table.affectedObjects}) > 0`,
    ),
  ],
);

export type VolumeAuditFindingJson = {
  id: string;
  chapterId: string | null;
  chapterVersionId: string | null;
  chapterNumber: number | null;
  dimension: string;
  qualityDimension: string;
  severity: string;
  structural: boolean;
  code: string;
  evidence: Array<Record<string, unknown>>;
  sourceRefs: Array<Record<string, unknown>>;
  affectedObjects: Array<Record<string, unknown>>;
  recommendation: string;
  upstreamFindingId: string | null;
  createdAt: string;
};

export type VolumeAuditCoverageJson = {
  chapterId: string;
  chapterNumber: number;
  title: string;
  chapterVersionId: string | null;
  wordCount: number;
  qualityReportId: string | null;
  qualityFindingCount: number;
};

export type VolumeAuditSummaryJson = {
  total: number;
  blockers: number;
  warnings: number;
  unresolvedLedger: number;
  motivation: number;
  antagonist: number;
  powerInflation: number;
  mapTime: number;
  knowledgeLeak: number;
  other: number;
};

export const volumeAuditReports = pgTable(
  "volume_audit_reports",
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
    volumeNodeId: uuid("volume_node_id")
      .notNull()
      .references(() => outlineNodes.id, { onDelete: "cascade" }),
    chapterFrom: integer("chapter_from").notNull(),
    chapterTo: integer("chapter_to").notNull(),
    ruleVersion: text("rule_version").notNull(),
    sourceHash: text("source_hash").notNull(),
    status: text("status").notNull(),
    findings: jsonb("findings").$type<VolumeAuditFindingJson[]>().notNull(),
    coverage: jsonb("coverage").$type<VolumeAuditCoverageJson[]>().notNull(),
    summary: jsonb("summary").$type<VolumeAuditSummaryJson>().notNull(),
    signoffDecision: text("signoff_decision"),
    signoffRationale: text("signoff_rationale"),
    signedOffBy: uuid("signed_off_by").references(() => users.id, { onDelete: "restrict" }),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("volume_audit_reports_user_work_idx").on(table.userId, table.workId),
    index("volume_audit_reports_volume_created_idx").on(table.volumeNodeId, table.createdAt),
    check("volume_audit_reports_range_check", sql`${table.chapterTo} >= ${table.chapterFrom}`),
    check(
      "volume_audit_reports_rule_version_check",
      sql`${table.ruleVersion} = 'm1-volume-audit-v1'`,
    ),
    check("volume_audit_reports_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
    check(
      "volume_audit_reports_status_check",
      sql`${table.status} in ('passed', 'warnings', 'blocked')`,
    ),
    check(
      "volume_audit_reports_signoff_check",
      sql`(${table.signoffDecision} is null and ${table.signoffRationale} is null and ${table.signedOffBy} is null and ${table.signedOffAt} is null) or (${table.signoffDecision} in ('accepted', 'changes_requested') and length(trim(${table.signoffRationale})) >= 10 and ${table.signedOffBy} is not null and ${table.signedOffAt} is not null)`,
    ),
    check("volume_audit_reports_version_check", sql`${table.version} > 0`),
    check("volume_audit_reports_findings_check", sql`jsonb_typeof(${table.findings}) = 'array'`),
    check("volume_audit_reports_coverage_check", sql`jsonb_typeof(${table.coverage}) = 'array'`),
  ],
);

export type StyleProfileJson = {
  guides: string[];
  samples: Array<{
    chapterId: string;
    chapterVersionId: string;
    excerpt: string;
    locator: string;
  }>;
  metrics: {
    averageSentenceLength: number;
    exclamationRate: number;
    dialogueRatio: number;
  };
};

export type StyleDriftTrendJson = {
  chapterId: string;
  chapterVersionId: string;
  chapterNumber: number;
  exclamationRate: number;
  averageSentenceLength: number;
  dialogueRatio: number;
  deviationScore: number;
};

export type StyleDriftGrowthEvidenceJson = {
  markerId: string;
  startState: string;
  endState: string;
  reason: string;
};

export const styleProfiles = pgTable(
  "style_profiles",
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
    scope: text("scope").notNull(),
    scopeId: uuid("scope_id").references(() => entities.id, { onDelete: "restrict" }),
    dimension: text("dimension").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    approvalStatus: text("approval_status").notNull().default("pending"),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceVersionId: uuid("source_version_id").notNull(),
    sourceVersionNodeId: uuid("source_version_node_id").references(() => versionNodes.id, {
      onDelete: "set null",
    }),
    sourceLabel: text("source_label").notNull(),
    profile: jsonb("profile").$type<StyleProfileJson>().notNull(),
    approvalRationale: text("approval_rationale"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    versionNodeId: uuid("version_node_id").references(() => versionNodes.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("style_profiles_character_version_unique")
      .on(table.workId, table.branchId, table.dimension, table.scopeId, table.version)
      .where(sql`${table.scope} = 'character'`),
    uniqueIndex("style_profiles_work_version_unique")
      .on(table.workId, table.branchId, table.dimension, table.version)
      .where(sql`${table.scope} = 'work'`),
    index("style_profiles_user_work_idx").on(table.userId, table.workId),
    index("style_profiles_branch_status_idx").on(table.branchId, table.approvalStatus),
    check("style_profiles_scope_check", sql`${table.scope} in ('work', 'character')`),
    check(
      "style_profiles_scope_id_check",
      sql`(${table.scope} = 'work' and ${table.scopeId} is null) or (${table.scope} = 'character' and ${table.scopeId} is not null)`,
    ),
    check(
      "style_profiles_dimension_check",
      sql`${table.dimension} in ('character_voice', 'prose')`,
    ),
    check("style_profiles_version_check", sql`${table.version} > 0`),
    check(
      "style_profiles_approval_status_check",
      sql`${table.approvalStatus} in ('pending', 'approved', 'rejected', 'superseded')`,
    ),
    check(
      "style_profiles_source_type_check",
      sql`${table.sourceType} in ('author_sample', 'approved_chapter_version', 'golden_three')`,
    ),
    check(
      "style_profiles_approval_check",
      sql`(${table.approvalStatus} = 'approved' and ${table.approvedBy} is not null and ${table.approvedAt} is not null and ${table.approvalRationale} is not null and length(trim(${table.approvalRationale})) > 0) or (${table.approvalStatus} <> 'approved' and ${table.approvedBy} is null and ${table.approvedAt} is null and ${table.approvalRationale} is null)`,
    ),
    check(
      "style_profiles_body_check",
      sql`jsonb_typeof(${table.profile}) = 'object' and jsonb_typeof(${table.profile}->'samples') = 'array' and jsonb_array_length(${table.profile}->'samples') > 0`,
    ),
  ],
);

export const styleDriftReports = pgTable(
  "style_drift_reports",
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
    scope: text("scope").notNull(),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id").references(() => chapterVersions.id, {
      onDelete: "restrict",
    }),
    baselineProfileId: uuid("baseline_profile_id")
      .notNull()
      .references(() => styleProfiles.id, { onDelete: "restrict" }),
    baselineVersion: integer("baseline_version").notNull(),
    baselineDimension: text("baseline_dimension").notNull(),
    baselineSourceType: text("baseline_source_type").notNull(),
    ruleVersion: text("rule_version").notNull(),
    modelProvider: text("model_provider").notNull(),
    model: text("model").notNull(),
    modelParameters: jsonb("model_parameters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    promptKey: text("prompt_key").notNull(),
    promptVersion: integer("prompt_version").notNull(),
    profileVersion: integer("profile_version").notNull(),
    windowFromChapter: integer("window_from_chapter").notNull(),
    windowToChapter: integer("window_to_chapter").notNull(),
    sourceHash: text("source_hash").notNull(),
    summary: text("summary").notNull(),
    trend: jsonb("trend").$type<StyleDriftTrendJson[]>().notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("style_drift_reports_user_work_idx").on(table.userId, table.workId),
    index("style_drift_reports_branch_scope_created_idx").on(
      table.branchId,
      table.scope,
      table.createdAt,
    ),
    check(
      "style_drift_reports_scope_check",
      sql`${table.scope} in ('chapter', 'volume', 'cross_volume')`,
    ),
    check(
      "style_drift_reports_window_check",
      sql`${table.windowToChapter} >= ${table.windowFromChapter}`,
    ),
    check(
      "style_drift_reports_scope_refs_check",
      sql`(${table.scope} = 'chapter' and ${table.chapterId} is not null and ${table.chapterVersionId} is not null and ${table.windowFromChapter} = ${table.windowToChapter}) or (${table.scope} <> 'chapter' and ${table.chapterId} is null and ${table.chapterVersionId} is null)`,
    ),
    check(
      "style_drift_reports_dimension_check",
      sql`${table.baselineDimension} in ('character_voice', 'prose')`,
    ),
    check(
      "style_drift_reports_source_type_check",
      sql`${table.baselineSourceType} in ('author_sample', 'approved_chapter_version', 'golden_three')`,
    ),
    check(
      "style_drift_reports_rule_version_check",
      sql`${table.ruleVersion} = 'm1-style-drift-v1'`,
    ),
    check("style_drift_reports_source_hash_check", sql`${table.sourceHash} ~ '^[a-f0-9]{64}$'`),
    check("style_drift_reports_trend_check", sql`jsonb_typeof(${table.trend}) = 'array'`),
  ],
);

export const styleDriftFindings = pgTable(
  "style_drift_findings",
  {
    id: uuid("id").primaryKey(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => styleDriftReports.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    baselineProfileId: uuid("baseline_profile_id")
      .notNull()
      .references(() => styleProfiles.id, { onDelete: "restrict" }),
    baselineVersion: integer("baseline_version").notNull(),
    dimension: text("dimension").notNull(),
    classification: text("classification").notNull(),
    severity: text("severity").notNull(),
    code: text("code").notNull(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    chapterVersionId: uuid("chapter_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    quote: text("quote").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    locator: text("locator").notNull(),
    explanation: text("explanation").notNull(),
    recommendation: text("recommendation").notNull(),
    growthEvidence: jsonb("growth_evidence").$type<StyleDriftGrowthEvidenceJson>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("style_drift_findings_report_idx").on(table.reportId, table.classification),
    index("style_drift_findings_user_work_idx").on(table.userId, table.workId),
    check(
      "style_drift_findings_dimension_check",
      sql`${table.dimension} in ('character_voice', 'prose')`,
    ),
    check(
      "style_drift_findings_classification_check",
      sql`${table.classification} in ('drift', 'intentional_development')`,
    ),
    check("style_drift_findings_severity_check", sql`${table.severity} in ('P1', 'P2', 'P3')`),
    check(
      "style_drift_findings_code_check",
      sql`${table.code} in ('CHARACTER_VOICE_DRIFT', 'WORK_STYLE_DRIFT', 'INTENTIONAL_CHARACTER_DEVELOPMENT')`,
    ),
    check(
      "style_drift_findings_span_check",
      sql`${table.startOffset} >= 0 and ${table.endOffset} > ${table.startOffset}`,
    ),
    check(
      "style_drift_findings_growth_check",
      sql`(${table.classification} = 'intentional_development' and ${table.code} = 'INTENTIONAL_CHARACTER_DEVELOPMENT' and ${table.growthEvidence} is not null) or (${table.classification} = 'drift' and ${table.code} <> 'INTENTIONAL_CHARACTER_DEVELOPMENT' and ${table.growthEvidence} is null)`,
    ),
  ],
);

export type RevisionSelectedFindingJson = {
  findingId: string;
  code: string;
  severity: string;
  qualityDimension: string;
  recommendation: string;
  evidence: QualityDimensionEvidenceJson[];
};

export type RevisionBlockJson = {
  id: string;
  start: number;
  end: number;
  label?: string;
};

export type RevisionConstraintsJson = {
  preserveOutsideSelection: true;
  protectLockedContent: true;
  authorInstruction?: string;
};

export type RevisionDiffJson = {
  sourceVersionId: string;
  resultVersionId: string;
  beforeHash: string;
  afterHash: string;
  changes: Array<{
    blockId: string;
    beforeStart: number;
    beforeEnd: number;
    afterStart: number;
    afterEnd: number;
    before: string;
    after: string;
  }>;
  unresolvedFindingIds: string[];
};

export const revisionPlans = pgTable(
  "revision_plans",
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("active"),
    maxRounds: integer("max_rounds").notNull(),
    maxCostCny: real("max_cost_cny").notNull(),
    maxTokens: integer("max_tokens").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("revision_plans_chapter_idempotency_unique").on(
      table.userId,
      table.chapterId,
      table.idempotencyKey,
    ),
    index("revision_plans_user_work_idx").on(table.userId, table.workId),
    index("revision_plans_chapter_created_idx").on(table.chapterId, table.createdAt),
    check(
      "revision_plans_status_check",
      sql`${table.status} in ('active', 'awaiting_feedback', 'completed', 'rejected')`,
    ),
    check("revision_plans_max_rounds_check", sql`${table.maxRounds} between 1 and 2`),
    check("revision_plans_budget_check", sql`${table.maxCostCny} > 0 and ${table.maxTokens} > 0`),
    check("revision_plans_version_check", sql`${table.version} > 0`),
  ],
);

export const revisionRounds = pgTable(
  "revision_rounds",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => revisionPlans.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    status: text("status").notNull().default("queued"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    sourceVersionId: uuid("source_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    resultVersionId: uuid("result_version_id").references(() => chapterVersions.id, {
      onDelete: "restrict",
    }),
    versionNodeId: uuid("version_node_id").references(() => versionNodes.id, {
      onDelete: "restrict",
    }),
    selectedFindings: jsonb("selected_findings").$type<RevisionSelectedFindingJson[]>().notNull(),
    blocks: jsonb("blocks").$type<RevisionBlockJson[]>().notNull(),
    constraints: jsonb("constraints").$type<RevisionConstraintsJson>().notNull(),
    diff: jsonb("diff").$type<RevisionDiffJson>(),
    unresolvedFindingIds: jsonb("unresolved_finding_ids").$type<string[]>().notNull().default([]),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("revision_rounds_plan_round_unique").on(table.planId, table.roundNumber),
    uniqueIndex("revision_rounds_job_unique").on(table.jobId),
    index("revision_rounds_chapter_created_idx").on(table.chapterId, table.createdAt),
    check("revision_rounds_round_number_check", sql`${table.roundNumber} between 1 and 2`),
    check(
      "revision_rounds_status_check",
      sql`${table.status} in ('queued', 'running', 'waiting_review', 'accepted', 'rejected', 'rewrite_requested', 'failed')`,
    ),
    check(
      "revision_rounds_selected_findings_check",
      sql`jsonb_typeof(${table.selectedFindings}) = 'array' and jsonb_array_length(${table.selectedFindings}) > 0`,
    ),
    check(
      "revision_rounds_blocks_check",
      sql`jsonb_typeof(${table.blocks}) = 'array' and jsonb_array_length(${table.blocks}) > 0`,
    ),
    check(
      "revision_rounds_unresolved_check",
      sql`jsonb_typeof(${table.unresolvedFindingIds}) = 'array'`,
    ),
    check("revision_rounds_version_check", sql`${table.version} > 0`),
  ],
);

export const revisionFeedbackEvents = pgTable(
  "revision_feedback_events",
  {
    id: uuid("id").primaryKey(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => revisionPlans.id, { onDelete: "cascade" }),
    roundId: uuid("round_id")
      .notNull()
      .references(() => revisionRounds.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => workBranches.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    findingId: uuid("finding_id").references(() => qualityFindings.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    targetVersionId: uuid("target_version_id")
      .notNull()
      .references(() => chapterVersions.id, { onDelete: "restrict" }),
    evaluationOptIn: boolean("evaluation_opt_in").notNull().default(false),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("revision_feedback_plan_created_idx").on(table.planId, table.createdAt),
    index("revision_feedback_round_created_idx").on(table.roundId, table.createdAt),
    index("revision_feedback_chapter_finding_idx").on(table.chapterId, table.findingId),
    check(
      "revision_feedback_action_check",
      sql`${table.action} in ('accept', 'reject', 'rewrite')`,
    ),
    check("revision_feedback_reason_check", sql`length(trim(${table.reason})) > 0`),
  ],
);
