import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
