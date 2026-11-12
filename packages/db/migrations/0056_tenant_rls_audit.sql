-- Custom SQL migration file, put your code below! --
ALTER TABLE "model_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_configs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "model_configs_tenant_policy" ON "model_configs";--> statement-breakpoint
CREATE POLICY "model_configs_tenant_policy" ON "model_configs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "password_resets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_resets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "password_resets_tenant_policy" ON "password_resets";--> statement-breakpoint
CREATE POLICY "password_resets_tenant_policy" ON "password_resets"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pen_names" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pen_names" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "pen_names_tenant_policy" ON "pen_names";--> statement-breakpoint
CREATE POLICY "pen_names_tenant_policy" ON "pen_names"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "sessions_tenant_policy" ON "sessions";--> statement-breakpoint
CREATE POLICY "sessions_tenant_policy" ON "sessions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "search_rebuild_runs_tenant_policy" ON "search_rebuild_runs";--> statement-breakpoint
CREATE POLICY "search_rebuild_runs_tenant_policy" ON "search_rebuild_runs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
