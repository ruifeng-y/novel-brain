import { sql } from 'drizzle-orm';
import {
  boolean,
  bigserial,
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
    chapterNumber: integer('chapter_number').notNull(),
    chapterGoal: text('chapter_goal').notNull(),
    pov: text('pov').notNull(),
    sceneBeats: jsonb('scene_beats').$type<string[]>().notNull(),
    chapterEndHook: text('chapter_end_hook').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('chapter_outlines_work_branch_chapter_unique').on(
      table.workId,
      table.branchId,
      table.chapterNumber,
    ),
  ],
);

export type ChapterOutlineRow = typeof chapterOutlines.$inferSelect;
export type NewChapterOutlineRow = typeof chapterOutlines.$inferInsert;

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
  ],
);

export type ChapterVersionRow = typeof chapterVersions.$inferSelect;
export type NewChapterVersionRow = typeof chapterVersions.$inferInsert;

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
