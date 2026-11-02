import { sql } from 'drizzle-orm';
import {
  boolean,
  bigserial,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
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

export const accountPurgeReceipts = pgTable(
  'account_purge_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    emailHash: text('email_hash').notNull(),
    status: text('status').notNull(),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    deletionScheduledFor: timestamp('deletion_scheduled_for', { withTimezone: true }),
    purgedAt: timestamp('purged_at', { withTimezone: true }).notNull(),
    summary: jsonb('summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('account_purge_receipts_user_unique').on(table.userId),
    index('account_purge_receipts_purged_idx').on(table.purgedAt),
  ],
);

export type AccountPurgeReceiptRow = typeof accountPurgeReceipts.$inferSelect;
export type NewAccountPurgeReceiptRow = typeof accountPurgeReceipts.$inferInsert;

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

export const passwordResets = pgTable(
  'password_resets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('password_resets_token_hash_unique').on(table.tokenHash),
    index('password_resets_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export type PasswordResetRow = typeof passwordResets.$inferSelect;
export type NewPasswordResetRow = typeof passwordResets.$inferInsert;

export const emailChangeRequests = pgTable(
  'email_change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    newEmail: text('new_email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('email_change_requests_user_created_idx').on(table.userId, table.createdAt),
    index('email_change_requests_email_idx').on(table.newEmail),
  ],
);

export type EmailChangeRequestRow = typeof emailChangeRequests.$inferSelect;
export type NewEmailChangeRequestRow = typeof emailChangeRequests.$inferInsert;

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
    bio: text('bio').notNull().default(''),
    avatarUrl: text('avatar_url'),
    status: userStatusEnum('status').notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    lastExportAt: timestamp('last_export_at', { withTimezone: true }),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    deletionScheduledFor: timestamp('deletion_scheduled_for', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    index('users_status_idx').on(table.status),
    index('users_deletion_scheduled_idx').on(table.status, table.deletionScheduledFor),
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

export const penNames = pgTable(
  'pen_names',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    bio: text('bio').notNull().default(''),
    avatarUrl: text('avatar_url'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('pen_names_user_name_unique').on(table.userId, table.name),
    uniqueIndex('pen_names_one_default_unique')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
  ],
);

export type PenNameRow = typeof penNames.$inferSelect;
export type NewPenNameRow = typeof penNames.$inferInsert;

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

export const workBranchKindEnum = pgEnum('work_branch_kind', [
  'rewrite',
  'what_if',
  'alternate_ending',
  'experiment',
]);

export const workBranchForkPointKindEnum = pgEnum('work_branch_fork_point_kind', [
  'current',
  'chapter_version',
]);

export const branchCommitKindEnum = pgEnum('branch_commit_kind', [
  'chapter_version',
  'edit',
  'change',
  'undo',
  'rollback',
  'merge',
]);

export type WorkBranchForkSnapshotValue = {
  settings?: Record<string, string>;
  outlines?: Record<string, string>;
  chapters?: Record<string, string>;
  facts?: Record<string, string>;
  characters?: Record<string, string>;
  maps?: Record<string, string>;
};

export const works = pgTable(
  'works',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    penName: text('pen_name').notNull(),
    penNameId: uuid('pen_name_id').references(() => penNames.id, { onDelete: 'set null' }),
    genrePack: text('genre_pack').notNull(),
    genreVariant: text('genre_variant'),
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
    isSnapshot: boolean('is_snapshot').notNull().default(false),
    parentBranchId: uuid('parent_branch_id'),
    baselineBranchId: uuid('baseline_branch_id'),
    baselineMaterializedAt: timestamp('baseline_materialized_at', { withTimezone: true }),
    stateBranchId: uuid('state_branch_id').references((): AnyPgColumn => workBranches.id, {
      onDelete: 'set null',
    }),
    baseCommitId: uuid('base_commit_id'),
    kind: workBranchKindEnum('kind').notNull().default('experiment'),
    reason: text('reason').notNull().default(''),
    forkPointKind: workBranchForkPointKindEnum('fork_point_kind').notNull().default('current'),
    forkChapterId: uuid('fork_chapter_id'),
    forkChapterVersionId: uuid('fork_chapter_version_id'),
    forkChapterNumber: integer('fork_chapter_number'),
    forkSnapshot: jsonb('fork_snapshot')
      .$type<WorkBranchForkSnapshotValue>()
      .notNull()
      .default(sql`'{}'::jsonb`),
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

export type StoryBibleCardValue = {
  key: string;
  summary: string;
  details: string;
};

export const storyBibles = pgTable(
  'story_bibles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    oneSentenceStory: text('one_sentence_story').notNull(),
    protagonist: text('protagonist').notNull(),
    worldIronLaw: text('world_iron_law').notNull(),
    cards: jsonb('cards')
      .$type<StoryBibleCardValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    version: integer('version').notNull().default(1),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('story_bibles_work_branch_unique').on(table.workId, table.branchId)],
);

export type StoryBibleRow = typeof storyBibles.$inferSelect;
export type NewStoryBibleRow = typeof storyBibles.$inferInsert;

export const storyBibleChangeKindEnum = pgEnum('story_bible_change_kind', [
  'saved',
  'locked',
  'locked_change',
]);

export const storyBibleRevisions = pgTable(
  'story_bible_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    storyBibleId: uuid('story_bible_id')
      .notNull()
      .references(() => storyBibles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: storyBibleChangeKindEnum('kind').notNull(),
    reason: text('reason').notNull(),
    changedCards: jsonb('changed_cards').$type<string[]>().notNull(),
    beforeCards: jsonb('before_cards').$type<StoryBibleCardValue[]>().notNull(),
    afterCards: jsonb('after_cards').$type<StoryBibleCardValue[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('story_bible_revisions_branch_created_idx').on(
      table.workId,
      table.branchId,
      table.createdAt,
    ),
    index('story_bible_revisions_bible_created_idx').on(table.storyBibleId, table.createdAt),
  ],
);

export type StoryBibleRevisionRow = typeof storyBibleRevisions.$inferSelect;
export type NewStoryBibleRevisionRow = typeof storyBibleRevisions.$inferInsert;

export const foreshadowStatusEnum = pgEnum('foreshadow_status', [
  'planted',
  'paid_off',
  'abandoned',
]);

export const foreshadowImportanceEnum = pgEnum('foreshadow_importance', ['must', 'optional']);

export const foreshadows = pgTable(
  'foreshadows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    setupChapter: integer('setup_chapter'),
    plannedPayoffChapter: integer('planned_payoff_chapter'),
    status: foreshadowStatusEnum('status').notNull().default('planted'),
    importance: foreshadowImportanceEnum('importance').notNull().default('optional'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('foreshadows_work_branch_status_idx').on(table.workId, table.branchId, table.status),
  ],
);

export type ForeshadowRow = typeof foreshadows.$inferSelect;
export type NewForeshadowRow = typeof foreshadows.$inferInsert;

export const storyThreadTypeEnum = pgEnum('story_thread_type', [
  'main',
  'sub',
  'character',
  'faction',
  'mystery',
  'romance',
]);

export const storyThreadStatusEnum = pgEnum('story_thread_status', [
  'active',
  'resolved',
  'abandoned',
]);

export type StoryThreadMilestone = {
  chapterNumber: number;
  description: string;
};

export type StoryThreadTensionPoint = {
  chapterNumber: number;
  tension: number;
};

export const storyThreads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: storyThreadTypeEnum('type').notNull(),
    summary: text('summary').notNull().default(''),
    stakes: text('stakes').notNull(),
    participantIds: jsonb('participant_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    plannedPayoffChapter: integer('planned_payoff_chapter'),
    status: storyThreadStatusEnum('status').notNull().default('active'),
    milestones: jsonb('milestones')
      .$type<StoryThreadMilestone[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    tensionCurve: jsonb('tension_curve')
      .$type<StoryThreadTensionPoint[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('threads_work_branch_type_status_idx').on(
      table.workId,
      table.branchId,
      table.type,
      table.status,
    ),
    uniqueIndex('threads_work_branch_name_unique').on(table.workId, table.branchId, table.name),
  ],
);

export type StoryThreadRow = typeof storyThreads.$inferSelect;
export type NewStoryThreadRow = typeof storyThreads.$inferInsert;

export const storyArcStatusEnum = pgEnum('story_arc_status', ['active', 'completed', 'abandoned']);

export const characterArcs = pgTable(
  'character_arcs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    startState: text('start_state').notNull().default(''),
    desire: text('desire').notNull().default(''),
    fear: text('fear').notNull().default(''),
    lie: text('lie').notNull().default(''),
    truth: text('truth').notNull().default(''),
    turn: text('turn').notNull().default(''),
    endState: text('end_state').notNull().default(''),
    status: storyArcStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('character_arcs_work_branch_character_unique').on(
      table.workId,
      table.branchId,
      table.characterId,
    ),
    index('character_arcs_work_branch_status_idx').on(table.workId, table.branchId, table.status),
  ],
);

export type CharacterArcRow = typeof characterArcs.$inferSelect;
export type NewCharacterArcRow = typeof characterArcs.$inferInsert;

export const outlineLevelEnum = pgEnum('outline_level', [
  'book',
  'volume',
  'act',
  'chapter',
  'scene',
]);

export const chapterOutlines = pgTable(
  'chapter_outlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    level: outlineLevelEnum('level').notNull().default('chapter'),
    parentId: uuid('parent_id').references((): AnyPgColumn => chapterOutlines.id, {
      onDelete: 'cascade',
    }),
    orderIndex: integer('order_index').notNull().default(0),
    title: text('title').notNull().default(''),
    summary: text('summary').notNull().default(''),
    details: text('details').notNull().default(''),
    chapterNumber: integer('chapter_number'),
    chapterGoal: text('chapter_goal').notNull().default(''),
    pov: text('pov').notNull().default(''),
    sceneBeats: jsonb('scene_beats')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    chapterEndHook: text('chapter_end_hook').notNull().default(''),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chapter_outlines_work_branch_chapter_unique')
      .on(table.workId, table.branchId, table.chapterNumber)
      .where(sql`${table.chapterNumber} is not null`),
    uniqueIndex('chapter_outlines_one_book_unique')
      .on(table.workId, table.branchId)
      .where(sql`${table.level} = 'book'`),
    index('chapter_outlines_work_branch_parent_order_idx').on(
      table.workId,
      table.branchId,
      table.parentId,
      table.orderIndex,
    ),
    index('chapter_outlines_title_trgm_idx').using(
      'gin',
      sql`${table.title} gin_trgm_ops`,
    ),
    index('chapter_outlines_summary_trgm_idx').using(
      'gin',
      sql`${table.summary} gin_trgm_ops`,
    ),
    index('chapter_outlines_details_trgm_idx').using(
      'gin',
      sql`${table.details} gin_trgm_ops`,
    ),
    index('chapter_outlines_goal_trgm_idx').using(
      'gin',
      sql`${table.chapterGoal} gin_trgm_ops`,
    ),
    index('chapter_outlines_pov_trgm_idx').using('gin', sql`${table.pov} gin_trgm_ops`),
    index('chapter_outlines_hook_trgm_idx').using(
      'gin',
      sql`${table.chapterEndHook} gin_trgm_ops`,
    ),
    index('chapter_outlines_beats_trgm_idx').using(
      'gin',
      sql`((${table.sceneBeats})::text) gin_trgm_ops`,
    ),
  ],
);

export type ChapterOutlineRow = typeof chapterOutlines.$inferSelect;
export type NewChapterOutlineRow = typeof chapterOutlines.$inferInsert;

export type EntityCustomFieldValue = string | number | boolean | string[] | null;

export const entityCustomFields = pgTable(
  'entity_custom_fields',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    options: jsonb('options')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('entity_custom_fields_work_branch_key_unique').on(
      table.workId,
      table.branchId,
      table.key,
    ),
    index('entity_custom_fields_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type EntityCustomFieldRow = typeof entityCustomFields.$inferSelect;
export type NewEntityCustomFieldRow = typeof entityCustomFields.$inferInsert;

export const entities = pgTable(
  'entities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    aliases: jsonb('aliases')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    type: text('type').notNull(),
    subtype: text('subtype').notNull().default(''),
    summary: text('summary').notNull().default(''),
    description: text('description').notNull().default(''),
    tags: jsonb('tags')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    scope: text('scope').notNull().default('work'),
    status: text('status').notNull().default('draft'),
    source: text('source').notNull().default('作者录入'),
    customFields: jsonb('custom_fields')
      .$type<Record<string, EntityCustomFieldValue>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('entities_work_branch_type_name_unique')
      .on(table.workId, table.branchId, table.type, table.name)
      .where(sql`${table.deletedAt} is null`),
    index('entities_work_branch_type_status_idx').on(
      table.workId,
      table.branchId,
      table.type,
      table.status,
    ),
    index('entities_work_branch_subtype_idx').on(table.workId, table.branchId, table.subtype),
    index('entities_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
    index('entities_summary_trgm_idx').using('gin', sql`${table.summary} gin_trgm_ops`),
    index('entities_description_trgm_idx').using(
      'gin',
      sql`${table.description} gin_trgm_ops`,
    ),
    index('entities_aliases_trgm_idx').using(
      'gin',
      sql`((${table.aliases})::text) gin_trgm_ops`,
    ),
    index('entities_tags_trgm_idx').using(
      'gin',
      sql`((${table.tags})::text) gin_trgm_ops`,
    ),
    index('entities_custom_fields_trgm_idx').using(
      'gin',
      sql`((${table.customFields})::text) gin_trgm_ops`,
    ),
  ],
);

export type EntityRow = typeof entities.$inferSelect;
export type NewEntityRow = typeof entities.$inferInsert;

export const characterProfiles = pgTable(
  'character_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    desire: text('desire').notNull().default(''),
    fear: text('fear').notNull().default(''),
    secret: text('secret').notNull().default(''),
    voice: text('voice').notNull().default(''),
    arc: text('arc').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('character_profiles_entity_unique').on(table.entityId),
    index('character_profiles_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type CharacterProfileRow = typeof characterProfiles.$inferSelect;
export type NewCharacterProfileRow = typeof characterProfiles.$inferInsert;

export type CharacterKnowledgeValue = {
  id: string;
  title: string;
  objectiveTruth: string;
  characterBelief: string;
  validFrom: string;
  validTo: string | null;
  source: string;
};

export type CharacterStateValue = {
  body: string;
  power: string;
  location: string;
  possessions: string;
  disguise: string;
  knowledge: CharacterKnowledgeValue[];
};

export const characterStates = pgTable(
  'character_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    power: text('power').notNull().default(''),
    location: text('location').notNull().default(''),
    possessions: text('possessions').notNull().default(''),
    disguise: text('disguise').notNull().default(''),
    knowledge: jsonb('knowledge')
      .$type<CharacterKnowledgeValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('character_states_character_unique').on(table.characterId),
    index('character_states_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type CharacterStateRow = typeof characterStates.$inferSelect;
export type NewCharacterStateRow = typeof characterStates.$inferInsert;

export const characterStateRevisions = pgTable(
  'character_state_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    reason: text('reason').notNull(),
    source: text('source').notNull().default('作者录入'),
    changedFields: jsonb('changed_fields').$type<string[]>().notNull(),
    beforeState: jsonb('before_state').$type<CharacterStateValue>(),
    afterState: jsonb('after_state').$type<CharacterStateValue>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('character_state_revisions_character_version_unique').on(
      table.characterId,
      table.version,
    ),
    index('character_state_revisions_character_created_idx').on(table.characterId, table.createdAt),
  ],
);

export type CharacterStateRevisionRow = typeof characterStateRevisions.$inferSelect;
export type NewCharacterStateRevisionRow = typeof characterStateRevisions.$inferInsert;

export const entityRelations = pgTable(
  'entity_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    fromEntityId: uuid('from_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    predicate: text('predicate').notNull(),
    toEntityId: uuid('to_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    validFrom: text('valid_from'),
    validTo: text('valid_to'),
    source: text('source').notNull().default('作者录入'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('entity_relations_work_branch_predicate_idx').on(
      table.workId,
      table.branchId,
      table.predicate,
    ),
    index('entity_relations_from_idx').on(table.fromEntityId),
    index('entity_relations_to_idx').on(table.toEntityId),
  ],
);

export type EntityRelationRow = typeof entityRelations.$inferSelect;
export type NewEntityRelationRow = typeof entityRelations.$inferInsert;

export type PowerLevelValue = {
  name: string;
  order: number;
  description: string;
};

export type PowerPathValue = {
  name: string;
  description: string;
  levels: string[];
};

export type PowerResourceCostValue = {
  name: string;
  amount: number;
};

export type PowerBreakthroughValue = {
  fromLevel: string;
  toLevel: string;
  conditions: string[];
  costs: string[];
  bottlenecks: string[];
  counters: string[];
  resources: PowerResourceCostValue[];
};

export const powerSystemProfiles = pgTable(
  'power_system_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    levels: jsonb('levels')
      .$type<PowerLevelValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    paths: jsonb('paths')
      .$type<PowerPathValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    breakthroughs: jsonb('breakthroughs')
      .$type<PowerBreakthroughValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('power_system_profiles_entity_unique').on(table.entityId),
    index('power_system_profiles_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type PowerSystemProfileRow = typeof powerSystemProfiles.$inferSelect;
export type NewPowerSystemProfileRow = typeof powerSystemProfiles.$inferInsert;

export type GoldenFingerGrowthPointValue = {
  stage: string;
  description: string;
};

export const goldenFingers = pgTable(
  'golden_fingers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    ownerEntityId: uuid('owner_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    rules: jsonb('rules')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    costs: jsonb('costs')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    limits: jsonb('limits')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    growthCurve: jsonb('growth_curve')
      .$type<GoldenFingerGrowthPointValue[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('golden_fingers_owner_name_unique').on(
      table.workId,
      table.branchId,
      table.ownerEntityId,
      table.name,
    ),
    index('golden_fingers_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type GoldenFingerRow = typeof goldenFingers.$inferSelect;
export type NewGoldenFingerRow = typeof goldenFingers.$inferInsert;

export type ItemTechniqueKindValue = 'item' | 'technique';

export const itemTechniqueProfiles = pgTable(
  'item_technique_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<ItemTechniqueKindValue>().notNull().default('item'),
    grade: text('grade').notNull().default(''),
    effects: jsonb('effects')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    costs: jsonb('costs')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    restrictions: jsonb('restrictions')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('item_technique_profiles_entity_unique').on(table.entityId),
    index('item_technique_profiles_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type ItemTechniqueProfileRow = typeof itemTechniqueProfiles.$inferSelect;
export type NewItemTechniqueProfileRow = typeof itemTechniqueProfiles.$inferInsert;

export const itemOwnerships = pgTable(
  'item_ownerships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    itemEntityId: uuid('item_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    ownerEntityId: uuid('owner_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    fromTime: text('from_time').notNull().default(''),
    endedAt: text('ended_at'),
    source: text('source').notNull().default('作者录入'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('item_ownerships_one_current_unique')
      .on(table.itemEntityId)
      .where(sql`${table.endedAt} is null`),
    index('item_ownerships_item_created_idx').on(table.itemEntityId, table.createdAt),
  ],
);

export type ItemOwnershipRow = typeof itemOwnerships.$inferSelect;
export type NewItemOwnershipRow = typeof itemOwnerships.$inferInsert;

export type StoryAbsoluteDateValue = {
  year: number;
  month?: number;
  day?: number;
  note: string;
};

export type StoryDurationValue = {
  amount: number;
  unit: 'minute' | 'hour' | 'day' | 'month' | 'year';
};

export const timelineEras = pgTable(
  'timeline_eras',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    timelineEntityId: uuid('timeline_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    summary: text('summary').notNull().default(''),
    startDate: jsonb('start_date').$type<StoryAbsoluteDateValue | null>(),
    endDate: jsonb('end_date').$type<StoryAbsoluteDateValue | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('timeline_eras_timeline_name_unique').on(table.timelineEntityId, table.name),
    index('timeline_eras_timeline_created_idx').on(table.timelineEntityId, table.createdAt),
  ],
);

export type TimelineEraRow = typeof timelineEras.$inferSelect;
export type NewTimelineEraRow = typeof timelineEras.$inferInsert;

export const timelineEventNodes = pgTable(
  'timeline_event_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    timelineEntityId: uuid('timeline_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    eraId: uuid('era_id').references(() => timelineEras.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    summary: text('summary').notNull().default(''),
    absoluteDate: jsonb('absolute_date').$type<StoryAbsoluteDateValue | null>(),
    relativeTime: text('relative_time').notNull().default(''),
    relativeToNodeId: uuid('relative_to_node_id').references(
      (): AnyPgColumn => timelineEventNodes.id,
      { onDelete: 'set null' },
    ),
    duration: jsonb('duration').$type<StoryDurationValue | null>(),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('timeline_event_nodes_timeline_order_idx').on(
      table.timelineEntityId,
      table.orderIndex,
      table.createdAt,
    ),
    index('timeline_event_nodes_era_idx').on(table.eraId),
  ],
);

export type TimelineEventNodeRow = typeof timelineEventNodes.$inferSelect;
export type NewTimelineEventNodeRow = typeof timelineEventNodes.$inferInsert;

export const chapterStatusEnum = pgEnum('chapter_status', [
  'planned',
  'writing',
  'review',
  'locked',
  'published',
]);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterNumber: integer('chapter_number').notNull(),
    title: text('title').notNull(),
    status: chapterStatusEnum('status').notNull().default('planned'),
    currentVersionId: uuid('current_version_id'),
    wordCount: integer('word_count').notNull().default(0),
    summary: text('summary').notNull().default(''),
    hook: text('hook').notNull().default(''),
    autosaveContent: text('autosave_content').notNull().default(''),
    autosaveUpdatedAt: timestamp('autosave_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chapters_work_branch_number_unique').on(
      table.workId,
      table.branchId,
      table.chapterNumber,
    ),
    index('chapters_work_branch_status_idx').on(table.workId, table.branchId, table.status),
    index('chapters_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
    index('chapters_summary_trgm_idx').using('gin', sql`${table.summary} gin_trgm_ops`),
    index('chapters_hook_trgm_idx').using('gin', sql`${table.hook} gin_trgm_ops`),
    index('chapters_autosave_trgm_idx').using(
      'gin',
      sql`${table.autosaveContent} gin_trgm_ops`,
    ),
  ],
);

export type ChapterRow = typeof chapters.$inferSelect;
export type NewChapterRow = typeof chapters.$inferInsert;

export const chapterVersionSourceEnum = pgEnum('chapter_version_source', [
  'generated',
  'manual',
  'restored',
]);

export const chapterVersions = pgTable(
  'chapter_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    contentHash: text('content_hash').notNull(),
    wordCount: integer('word_count').notNull(),
    modelConfigId: uuid('model_config_id').references(() => modelConfigs.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: chapterVersionSourceEnum('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chapter_versions_chapter_version_unique').on(table.chapterId, table.version),
    index('chapter_versions_chapter_created_idx').on(table.chapterId, table.createdAt),
    index('chapter_versions_content_trgm_idx').using(
      'gin',
      sql`${table.content} gin_trgm_ops`,
    ),
  ],
);

export type ChapterVersionRow = typeof chapterVersions.$inferSelect;
export type NewChapterVersionRow = typeof chapterVersions.$inferInsert;

export const branchCommits = pgTable(
  'branch_commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    sourceBranchId: uuid('source_branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    snapshotBranchId: uuid('snapshot_branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterVersionId: uuid('chapter_version_id').references(() => chapterVersions.id, {
      onDelete: 'cascade',
    }),
    parentCommitId: uuid('parent_commit_id'),
    changeRequestId: uuid('change_request_id'),
    kind: branchCommitKindEnum('kind').notNull().default('chapter_version'),
    title: text('title').notNull().default(''),
    reason: text('reason').notNull().default(''),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    message: text('message').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('branch_commits_chapter_version_unique').on(table.chapterVersionId),
    index('branch_commits_source_created_idx').on(table.sourceBranchId, table.createdAt),
    index('branch_commits_parent_idx').on(table.parentCommitId),
  ],
);

export type BranchCommitRow = typeof branchCommits.$inferSelect;
export type NewBranchCommitRow = typeof branchCommits.$inferInsert;

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workId: uuid('work_id').references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => workBranches.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    title: text('title').notNull(),
    detail: text('detail').notNull().default(''),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_work_branch_created_idx').on(table.workId, table.branchId, table.createdAt),
    index('audit_logs_action_idx').on(table.workId, table.action, table.createdAt),
    index('audit_logs_user_created_idx').on(table.userId, table.createdAt),
    index('audit_logs_user_action_created_idx').on(table.userId, table.action, table.createdAt),
    index('audit_logs_search_trgm_idx').using(
      'gin',
      sql`((${table.title} || ' ' || ${table.detail})) gin_trgm_ops`,
    ),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;

export const branchIdMappings = pgTable(
  'branch_id_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    forkBranchId: uuid('fork_branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    sourceId: uuid('source_id').notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('branch_id_mappings_fork_source_unique').on(table.forkBranchId, table.sourceId),
    index('branch_id_mappings_fork_table_idx').on(table.forkBranchId, table.tableName),
  ],
);

export type BranchIdMappingRow = typeof branchIdMappings.$inferSelect;

export const generationStatusEnum = pgEnum('generation_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const generationRequests = pgTable(
  'generation_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    instruction: text('instruction'),
    modelConfigId: uuid('model_config_id').references(() => modelConfigs.id, {
      onDelete: 'set null',
    }),
    status: generationStatusEnum('status').notNull().default('queued'),
    jobId: uuid('job_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('generation_requests_chapter_status_idx').on(
      table.workId,
      table.branchId,
      table.chapterId,
      table.status,
    ),
    index('generation_requests_chapter_created_idx').on(table.chapterId, table.createdAt),
  ],
);

export type GenerationRequestRow = typeof generationRequests.$inferSelect;
export type NewGenerationRequestRow = typeof generationRequests.$inferInsert;

export const contextPacks = pgTable(
  'context_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationRequestId: uuid('generation_request_id')
      .notNull()
      .references(() => generationRequests.id, { onDelete: 'cascade' }),
    tokenBudget: integer('token_budget').notNull(),
    sections: jsonb('sections').$type<Array<Record<string, unknown>>>().notNull(),
    sourceRefs: jsonb('source_refs').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('context_packs_generation_request_unique').on(table.generationRequestId)],
);

export type ContextPackRow = typeof contextPacks.$inferSelect;
export type NewContextPackRow = typeof contextPacks.$inferInsert;

export const draftStatusEnum = pgEnum('draft_status', ['pending', 'streaming', 'ready', 'failed']);

export const drafts = pgTable(
  'drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    generationRequestId: uuid('generation_request_id')
      .notNull()
      .references(() => generationRequests.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''),
    status: draftStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('drafts_generation_request_unique').on(table.generationRequestId),
    index('drafts_chapter_updated_idx').on(table.chapterId, table.updatedAt),
  ],
);

export type DraftRow = typeof drafts.$inferSelect;
export type NewDraftRow = typeof drafts.$inferInsert;

export const factTypeEnum = pgEnum('fact_type', ['event', 'body_state', 'character_knowledge']);

export const factProposalStatusEnum = pgEnum('fact_proposal_status', [
  'proposed',
  'confirmed',
  'rejected',
]);

export const factProposals = pgTable(
  'fact_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    generationRequestId: uuid('generation_request_id').references(() => generationRequests.id, {
      onDelete: 'set null',
    }),
    type: factTypeEnum('type').notNull(),
    statement: text('statement').notNull(),
    sourceSentence: text('source_sentence').notNull(),
    status: factProposalStatusEnum('status').notNull().default('proposed'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('fact_proposals_chapter_status_idx').on(table.chapterId, table.status),
    index('fact_proposals_branch_created_idx').on(table.branchId, table.createdAt),
  ],
);

export type FactProposalRow = typeof factProposals.$inferSelect;
export type NewFactProposalRow = typeof factProposals.$inferInsert;

export const facts = pgTable(
  'facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    sourceProposalId: uuid('source_proposal_id')
      .notNull()
      .references(() => factProposals.id, { onDelete: 'restrict' }),
    type: factTypeEnum('type').notNull(),
    statement: text('statement').notNull(),
    sourceSentence: text('source_sentence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('facts_source_proposal_unique').on(table.sourceProposalId),
    index('facts_branch_created_idx').on(table.branchId, table.createdAt),
    index('facts_work_branch_created_idx').on(table.workId, table.branchId, table.createdAt),
  ],
);

export type FactRow = typeof facts.$inferSelect;
export type NewFactRow = typeof facts.$inferInsert;

export const annotationStatusEnum = pgEnum('annotation_status', ['open', 'ignored']);

export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    generationRequestId: uuid('generation_request_id').references(() => generationRequests.id, {
      onDelete: 'cascade',
    }),
    draftId: uuid('draft_id').references(() => drafts.id, {
      onDelete: 'cascade',
    }),
    factId: uuid('fact_id').references(() => facts.id, {
      onDelete: 'set null',
    }),
    category: text('category').notNull(),
    severity: text('severity').notNull().default('warning'),
    message: text('message').notNull(),
    suggestion: text('suggestion').notNull(),
    sourceSentence: text('source_sentence').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    status: annotationStatusEnum('status').notNull().default('open'),
    ignoredReason: text('ignored_reason'),
    ignoredAt: timestamp('ignored_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('annotations_work_branch_chapter_status_idx').on(
      table.workId,
      table.branchId,
      table.chapterId,
      table.status,
    ),
    index('annotations_chapter_created_idx').on(table.chapterId, table.createdAt),
  ],
);

export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotationRow = typeof annotations.$inferInsert;

export type QualityReportValue = {
  summary: string;
  dimensions: Array<Record<string, unknown>>;
  issueCounts: Record<string, number>;
};

export const qualityReports = pgTable(
  'quality_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    generationRequestId: uuid('generation_request_id').references(() => generationRequests.id, {
      onDelete: 'set null',
    }),
    draftId: uuid('draft_id').references(() => drafts.id, {
      onDelete: 'set null',
    }),
    report: jsonb('report').$type<QualityReportValue>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('quality_reports_chapter_unique').on(table.chapterId),
    index('quality_reports_work_branch_updated_idx').on(
      table.workId,
      table.branchId,
      table.updatedAt,
    ),
  ],
);

export type QualityReportRow = typeof qualityReports.$inferSelect;
export type NewQualityReportRow = typeof qualityReports.$inferInsert;

export const canonCommits = pgTable(
  'canon_commits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    snapshotId: uuid('snapshot_id').notNull(),
    message: text('message').notNull(),
    eventLog: jsonb('event_log').$type<Array<Record<string, unknown>>>().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('canon_commits_branch_created_idx').on(table.branchId, table.createdAt)],
);

export const canonSnapshots = pgTable(
  'canon_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    commitId: uuid('commit_id')
      .notNull()
      .references(() => canonCommits.id, { onDelete: 'restrict' }),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('canon_snapshots_commit_unique').on(table.commitId),
    index('canon_snapshots_branch_created_idx').on(table.branchId, table.createdAt),
  ],
);

export type CanonCommitRow = typeof canonCommits.$inferSelect;
export type CanonSnapshotRow = typeof canonSnapshots.$inferSelect;

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'preparing',
  'running',
  'waiting_review',
  'completed',
  'failed',
  'canceled',
  'paused',
]);

export const jobStepStatusEnum = pgEnum('job_step_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    status: jobStatusEnum('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    progress: integer('progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(1),
    checkpoint: jsonb('checkpoint').$type<Record<string, unknown>>(),
    error: jsonb('error').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('jobs_work_status_created_idx').on(table.workId, table.status, table.createdAt),
    index('jobs_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export type JobRow = typeof jobs.$inferSelect;
export type NewJobRow = typeof jobs.$inferInsert;

export const jobSteps = pgTable(
  'job_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    stepKey: text('step_key').notNull(),
    status: jobStepStatusEnum('status').notNull().default('pending'),
    input: jsonb('input').$type<Record<string, unknown>>(),
    output: jsonb('output').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('job_steps_job_step_unique').on(table.jobId, table.stepKey)],
);

export type JobStepRow = typeof jobSteps.$inferSelect;
export type NewJobStepRow = typeof jobSteps.$inferInsert;

export const jobCheckpoints = pgTable(
  'job_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    state: jsonb('state').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('job_checkpoints_job_created_idx').on(table.jobId, table.createdAt)],
);

export type JobCheckpointRow = typeof jobCheckpoints.$inferSelect;

export const jobEvents = pgTable(
  'job_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sequence: bigserial('sequence', { mode: 'number' }).notNull(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('job_events_sequence_unique').on(table.sequence),
    index('job_events_job_sequence_idx').on(table.jobId, table.sequence),
  ],
);

export type JobEventRow = typeof jobEvents.$inferSelect;

export const exportFormatEnum = pgEnum('export_format', ['txt', 'markdown', 'docx', 'epub']);

export const exportStatusEnum = pgEnum('export_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    format: exportFormatEnum('format').notNull(),
    scope: jsonb('scope').$type<Record<string, unknown>>().notNull(),
    options: jsonb('options').$type<Record<string, unknown>>().notNull(),
    status: exportStatusEnum('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    chapterCount: integer('chapter_count').notNull().default(0),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    error: jsonb('error').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('export_jobs_work_branch_created_idx').on(table.workId, table.branchId, table.createdAt),
    index('export_jobs_user_status_idx').on(table.userId, table.status),
  ],
);

export type ExportJobRow = typeof exportJobs.$inferSelect;
export type NewExportJobRow = typeof exportJobs.$inferInsert;

export const accountExportStatusEnum = pgEnum('account_export_status', [
  'queued',
  'running',
  'completed',
  'failed',
]);

export const accountExportJobs = pgTable(
  'account_export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: accountExportStatusEnum('status').notNull().default('queued'),
    progress: integer('progress').notNull().default(0),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    fileSize: integer('file_size'),
    summary: jsonb('summary')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    error: jsonb('error').$type<Record<string, unknown>>(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('account_export_jobs_user_created_idx').on(table.userId, table.createdAt)],
);

export type AccountExportJobRow = typeof accountExportJobs.$inferSelect;
export type NewAccountExportJobRow = typeof accountExportJobs.$inferInsert;

export const batchChapterStatusEnum = pgEnum('batch_chapter_status', [
  'pending',
  'running',
  'waiting_review',
  'completed',
  'failed',
  'canceled',
]);

export const batchReviewStatusEnum = pgEnum('batch_review_status', [
  'pending',
  'approved',
  'sent_to_desk',
  'rejected',
  'ignored',
]);

export const jobChapters = pgTable(
  'job_chapters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    chapterNumber: integer('chapter_number').notNull(),
    status: batchChapterStatusEnum('status').notNull().default('pending'),
    reviewStatus: batchReviewStatusEnum('review_status').notNull().default('pending'),
    generationJobId: uuid('generation_job_id').references(() => jobs.id, {
      onDelete: 'set null',
    }),
    draftId: uuid('draft_id').references(() => drafts.id, { onDelete: 'set null' }),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    cost: real('cost').notNull().default(0),
    error: jsonb('error').$type<Record<string, unknown>>(),
    reviewNote: text('review_note'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('job_chapters_job_chapter_unique').on(table.jobId, table.chapterNumber),
    index('job_chapters_work_branch_status_idx').on(table.workId, table.branchId, table.status),
    index('job_chapters_job_position_idx').on(table.jobId, table.chapterNumber),
  ],
);

export type JobChapterRow = typeof jobChapters.$inferSelect;
export type NewJobChapterRow = typeof jobChapters.$inferInsert;

export const jobReports = pgTable(
  'job_reports',
  {
    jobId: uuid('job_id')
      .primaryKey()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    report: jsonb('report').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('job_reports_updated_idx').on(table.updatedAt)],
);

export type JobReportRow = typeof jobReports.$inferSelect;
export type NewJobReportRow = typeof jobReports.$inferInsert;

export const changeTargetTypeEnum = pgEnum('change_target_type', [
  'entity',
  'outline',
  'chapter',
  'fact',
  'knowledge',
  'plot_line',
  'map',
  'faction',
  'power_item',
  'timeline',
  'story_bible',
  'work',
]);

export const changeSourceEnum = pgEnum('change_source', ['author', 'ai', 'import', 'batch']);

export const changeRiskEnum = pgEnum('change_risk', ['low', 'medium', 'high']);

export const changeRequestStatusEnum = pgEnum('change_request_status', [
  'draft',
  'analyzing',
  'waiting_confirmation',
  'applying',
  'applied',
  'undone',
  'rejected',
  'canceled',
  'failed',
  'branched',
]);

export const changeClassificationEnum = pgEnum('change_classification', [
  'safe',
  'repairable',
  'structural',
]);

export const changeCheckStepEnum = pgEnum('change_check_step', [
  'structure',
  'hard_rules',
  'fact_diff',
  'knowledge_pov',
  'narrative',
  'downstream',
]);

export const changeCheckStatusEnum = pgEnum('change_check_status', [
  'passed',
  'warning',
  'conflict',
]);

export type ChangeDiffEntry = {
  field: string;
  before: unknown;
  after: unknown;
};

export const changeRequests = pgTable(
  'change_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    targetType: changeTargetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id'),
    title: text('title').notNull(),
    reason: text('reason').notNull(),
    oldValue: jsonb('old_value').$type<Record<string, unknown>>().notNull(),
    newValue: jsonb('new_value').$type<Record<string, unknown>>().notNull(),
    diff: jsonb('diff').$type<ChangeDiffEntry[]>().notNull(),
    source: changeSourceEnum('source').notNull(),
    risk: changeRiskEnum('risk').notNull(),
    status: changeRequestStatusEnum('status').notNull().default('draft'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchedBranchId: uuid('branched_branch_id').references(() => workBranches.id, {
      onDelete: 'set null',
    }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('change_requests_work_branch_status_idx').on(
      table.workId,
      table.branchId,
      table.status,
      table.targetType,
    ),
    index('change_requests_work_branch_created_idx').on(
      table.workId,
      table.branchId,
      table.createdAt,
    ),
  ],
);

export type ChangeRequestRow = typeof changeRequests.$inferSelect;
export type NewChangeRequestRow = typeof changeRequests.$inferInsert;

export const changeImpactReports = pgTable(
  'change_impact_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeRequestId: uuid('change_request_id')
      .notNull()
      .references(() => changeRequests.id, { onDelete: 'cascade' }),
    affected: jsonb('affected').$type<Record<string, unknown>>().notNull(),
    classification: changeClassificationEnum('classification').notNull(),
    confidence: real('confidence').notNull(),
    summary: text('summary').notNull(),
    suggestions: jsonb('suggestions').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('change_impact_reports_change_unique').on(table.changeRequestId)],
);

export type ChangeImpactReportRow = typeof changeImpactReports.$inferSelect;

export const changeValidations = pgTable(
  'change_validations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    changeRequestId: uuid('change_request_id')
      .notNull()
      .references(() => changeRequests.id, { onDelete: 'cascade' }),
    step: changeCheckStepEnum('step').notNull(),
    status: changeCheckStatusEnum('status').notNull(),
    summary: text('summary').notNull(),
    suggestion: text('suggestion').notNull(),
    confidence: real('confidence').notNull(),
    ignored: boolean('ignored').notNull().default(false),
    ignoredReason: text('ignored_reason'),
    ignoredAt: timestamp('ignored_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('change_validations_change_step_unique').on(table.changeRequestId, table.step),
  ],
);

export type ChangeValidationRow = typeof changeValidations.$inferSelect;

export const mapLevelEnum = pgEnum('map_level', [
  'world',
  'realm',
  'continent',
  'region',
  'city',
  'location',
]);

export const mapNodes = pgTable(
  'map_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    parentNodeId: uuid('parent_node_id').references((): AnyPgColumn => mapNodes.id, {
      onDelete: 'cascade',
    }),
    level: mapLevelEnum('level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('map_nodes_entity_unique').on(table.entityId),
    uniqueIndex('map_nodes_one_world_per_branch')
      .on(table.workId, table.branchId)
      .where(sql`${table.level} = 'world'`),
    index('map_nodes_work_branch_level_idx').on(table.workId, table.branchId, table.level),
    index('map_nodes_parent_idx').on(table.parentNodeId),
  ],
);

export type MapNodeRow = typeof mapNodes.$inferSelect;
export type NewMapNodeRow = typeof mapNodes.$inferInsert;

export const mapConnections = pgTable(
  'map_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    fromNodeId: uuid('from_node_id')
      .notNull()
      .references(() => mapNodes.id, { onDelete: 'cascade' }),
    toNodeId: uuid('to_node_id')
      .notNull()
      .references(() => mapNodes.id, { onDelete: 'cascade' }),
    travelMinutes: integer('travel_minutes').notNull(),
    label: text('label').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('map_connections_work_branch_pair_unique').on(
      table.workId,
      table.branchId,
      table.fromNodeId,
      table.toNodeId,
    ),
    index('map_connections_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type MapConnectionRow = typeof mapConnections.$inferSelect;
export type NewMapConnectionRow = typeof mapConnections.$inferInsert;

export const mapImages = pgTable(
  'map_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => mapNodes.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    size: integer('size').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('map_images_node_unique').on(table.nodeId),
    index('map_images_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type MapImageRow = typeof mapImages.$inferSelect;
export type NewMapImageRow = typeof mapImages.$inferInsert;

export const mapMarkers = pgTable(
  'map_markers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    imageId: uuid('image_id')
      .notNull()
      .references(() => mapImages.id, { onDelete: 'cascade' }),
    nodeId: uuid('node_id')
      .notNull()
      .references(() => mapNodes.id, { onDelete: 'cascade' }),
    xPercent: real('x_percent').notNull(),
    yPercent: real('y_percent').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('map_markers_image_node_unique').on(table.imageId, table.nodeId),
    index('map_markers_work_branch_idx').on(table.workId, table.branchId),
  ],
);

export type MapMarkerRow = typeof mapMarkers.$inferSelect;
export type NewMapMarkerRow = typeof mapMarkers.$inferInsert;

export const characterPresences = pgTable(
  'character_presences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workId: uuid('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => workBranches.id, { onDelete: 'cascade' }),
    characterEntityId: uuid('character_entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    locationNodeId: uuid('location_node_id')
      .notNull()
      .references(() => mapNodes.id, { onDelete: 'cascade' }),
    storyTime: text('story_time').notNull(),
    source: text('source').notNull().default('作者录入'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('character_presences_branch_character_location_time_unique').on(
      table.workId,
      table.branchId,
      table.characterEntityId,
      table.locationNodeId,
      table.storyTime,
    ),
    index('character_presences_branch_character_time_idx').on(
      table.workId,
      table.branchId,
      table.characterEntityId,
      table.storyTime,
    ),
  ],
);

export type CharacterPresenceRow = typeof characterPresences.$inferSelect;
export type NewCharacterPresenceRow = typeof characterPresences.$inferInsert;
