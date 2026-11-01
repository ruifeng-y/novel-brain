import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const systemJobStatusEnum = pgEnum('system_job_status', [
  'pending',
  'running',
  'completed',
  'failed',
]);

export const systemJobs = pgTable(
  'system_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    status: systemJobStatusEnum('status').notNull().default('pending'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('system_jobs_type_idx').on(table.type),
    index('system_jobs_status_idx').on(table.status),
  ],
);

export type SystemJobRow = typeof systemJobs.$inferSelect;
export type NewSystemJobRow = typeof systemJobs.$inferInsert;

export const emailCodePurposeEnum = pgEnum('email_code_purpose', ['register']);

export const emailCodes = pgTable(
  'email_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    purpose: emailCodePurposeEnum('purpose').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('email_codes_lookup_idx').on(table.email, table.purpose, table.createdAt)],
);

export type EmailCodeRow = typeof emailCodes.$inferSelect;
export type NewEmailCodeRow = typeof emailCodes.$inferInsert;

export const userStatusEnum = pgEnum('user_status', [
  'active',
  'disabled',
  'pending_deletion',
  'deleted',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    status: userStatusEnum('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    index('users_status_idx').on(table.status),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;

export const modelPurposeEnum = pgEnum('model_purpose', ['planning', 'prose', 'check']);

export const modelConfigs = pgTable(
  'model_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('deepseek'),
    baseUrl: text('base_url').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    model: text('model').notNull(),
    purpose: modelPurposeEnum('purpose').notNull().default('prose'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('model_configs_user_updated_idx').on(table.userId, table.updatedAt),
    uniqueIndex('model_configs_user_purpose_unique').on(table.userId, table.purpose),
    uniqueIndex('model_configs_one_default_unique')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ],
);

export type ModelConfigRow = typeof modelConfigs.$inferSelect;
export type NewModelConfigRow = typeof modelConfigs.$inferInsert;

export const workStatusEnum = pgEnum('work_status', [
  'preparing',
  'serializing',
  'paused',
  'completed',
  'archived',
]);

export const workBranchStatusEnum = pgEnum('work_branch_status', ['active', 'archived']);

export const works = pgTable(
  'works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    penName: text('pen_name').notNull(),
    genrePack: text('genre_pack').notNull(),
    scale: text('scale').notNull(),
    targetPlatform: text('target_platform').notNull(),
    status: workStatusEnum('status').notNull().default('preparing'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('works_user_status_updated_idx').on(table.userId, table.status, table.updatedAt),
  ],
);

export const workBranches = pgTable(
  'work_branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    isMain: boolean('is_main').notNull().default(false),
    parentBranchId: uuid('parent_branch_id'),
    baseCommitId: uuid('base_commit_id'),
    status: workBranchStatusEnum('status').notNull().default('active'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('work_branches_work_id_name_unique').on(table.workId, table.name),
    uniqueIndex('work_branches_one_main_unique')
      .on(table.workId)
      .where(sql`${table.isMain} = true`),
    index('work_branches_work_status_idx').on(table.workId, table.status),
  ],
);

export type WorkRow = typeof works.$inferSelect;
export type NewWorkRow = typeof works.$inferInsert;
export type WorkBranchRow = typeof workBranches.$inferSelect;
export type NewWorkBranchRow = typeof workBranches.$inferInsert;
