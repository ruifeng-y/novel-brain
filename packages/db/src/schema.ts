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
      sql`${table.nodeType} in ('chapter_version', 'outline_version', 'canon_commit', 'snapshot', 'change_apply', 'branch_merge', 'rollback')`,
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chapter_versions_chapter_version_unique").on(table.chapterId, table.version),
    uniqueIndex("chapter_versions_node_unique").on(table.versionNodeId),
    index("chapter_versions_user_work_idx").on(table.userId, table.workId),
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
