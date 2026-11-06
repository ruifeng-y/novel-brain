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
      sql`${table.nodeType} in ('chapter_version', 'outline_version', 'story_bible_version', 'entity_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback')`,
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
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    modelConfigId: uuid("model_config_id")
      .notNull()
      .references(() => modelConfigs.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    status: text("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    currentStep: text("current_step").notNull().default("prepare"),
    idempotencyKey: text("idempotency_key").notNull(),
    budget: jsonb("budget").$type<Record<string, unknown>>().notNull(),
    checkpoint: jsonb("checkpoint").$type<Record<string, unknown>>().notNull(),
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
      table.idempotencyKey,
    ),
    index("jobs_user_work_created_idx").on(table.userId, table.workId, table.createdAt),
    index("jobs_chapter_created_idx").on(table.chapterId, table.createdAt),
    check("jobs_type_check", sql`${table.type} in ('generate_chapter')`),
    check(
      "jobs_status_check",
      sql`${table.status} in ('queued', 'preparing', 'running', 'paused', 'waiting_review', 'completed', 'failed', 'cancelled')`,
    ),
    check("jobs_progress_check", sql`${table.progress} >= 0 and ${table.progress} <= 100`),
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
    check(
      "job_steps_step_check",
      sql`${table.stepKey} in ('prepare', 'compile_context', 'draft', 'verify', 'revise', 'extract_facts', 'await_review')`,
    ),
    check(
      "job_steps_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed', 'skipped')`,
    ),
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
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("job_checkpoints_job_created_idx").on(table.jobId, table.createdAt)],
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
    stepKey: text("step_key").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    inputHash: text("input_hash").notNull(),
    output: text("output").notNull().default(""),
    citations: jsonb("citations").$type<unknown[]>().notNull().default([]),
    usage: jsonb("usage").$type<Record<string, unknown>>().notNull().default({}),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("agent_runs_job_step_unique").on(table.jobId, table.stepKey),
    index("agent_runs_job_step_idx").on(table.jobId, table.stepKey),
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
