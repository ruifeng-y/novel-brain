import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
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
        }>
      >()
      .notNull(),
    readiness: jsonb("readiness").$type<Record<string, unknown>>().notNull(),
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
      sql`${table.type} in ('world_rule', 'character', 'golden_finger')`,
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
  (table) => [index("agent_runs_job_step_idx").on(table.jobId, table.stepKey)],
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
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull(),
    completionTokens: integer("completion_tokens").notNull(),
    costCny: real("cost_cny").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_records_job_created_idx").on(table.jobId, table.createdAt)],
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
