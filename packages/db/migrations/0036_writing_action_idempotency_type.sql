DROP INDEX "jobs_chapter_idempotency_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_chapter_idempotency_unique" ON "jobs" USING btree ("user_id","chapter_id","type","idempotency_key");