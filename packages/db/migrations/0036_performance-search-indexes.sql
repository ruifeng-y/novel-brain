CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_logs_search_trgm_idx" ON "audit_logs" USING gin ((("title" || ' ' || "detail")) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_title_trgm_idx" ON "chapter_outlines" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_summary_trgm_idx" ON "chapter_outlines" USING gin ("summary" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_details_trgm_idx" ON "chapter_outlines" USING gin ("details" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_goal_trgm_idx" ON "chapter_outlines" USING gin ("chapter_goal" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_pov_trgm_idx" ON "chapter_outlines" USING gin ("pov" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_hook_trgm_idx" ON "chapter_outlines" USING gin ("chapter_end_hook" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_outlines_beats_trgm_idx" ON "chapter_outlines" USING gin ((("scene_beats")::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapter_versions_content_trgm_idx" ON "chapter_versions" USING gin ("content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_title_trgm_idx" ON "chapters" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_summary_trgm_idx" ON "chapters" USING gin ("summary" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_hook_trgm_idx" ON "chapters" USING gin ("hook" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_autosave_trgm_idx" ON "chapters" USING gin ("autosave_content" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_name_trgm_idx" ON "entities" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_summary_trgm_idx" ON "entities" USING gin ("summary" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_description_trgm_idx" ON "entities" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_aliases_trgm_idx" ON "entities" USING gin ((("aliases")::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_tags_trgm_idx" ON "entities" USING gin ((("tags")::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "entities_custom_fields_trgm_idx" ON "entities" USING gin ((("custom_fields")::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "facts_work_branch_created_idx" ON "facts" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_requests_chapter_created_idx" ON "generation_requests" USING btree ("chapter_id","created_at");
