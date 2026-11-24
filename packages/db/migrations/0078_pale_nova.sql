DROP INDEX "canon_commits_chapter_unique";--> statement-breakpoint
CREATE INDEX "canon_commits_chapter_idx" ON "canon_commits" USING btree ("chapter_id");