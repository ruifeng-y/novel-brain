CREATE TABLE "search_rebuild_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" integer DEFAULT 0 NOT NULL,
	"stage_offset" integer DEFAULT 0 NOT NULL,
	"indexed" integer DEFAULT 0 NOT NULL,
	"expected_total" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_rebuild_runs_status_check" CHECK ("search_rebuild_runs"."status" in ('queued', 'running', 'completed', 'failed')),
	CONSTRAINT "search_rebuild_runs_progress_check" CHECK ("search_rebuild_runs"."stage" >= 0 and "search_rebuild_runs"."stage_offset" >= 0 and "search_rebuild_runs"."indexed" >= 0 and "search_rebuild_runs"."expected_total" >= 0)
);
--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" ADD CONSTRAINT "search_rebuild_runs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" ADD CONSTRAINT "search_rebuild_runs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" ADD CONSTRAINT "search_rebuild_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_rebuild_runs_scope_idx" ON "search_rebuild_runs" USING btree ("user_id","work_id","branch_id","started_at");--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "search_rebuild_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "search_rebuild_runs_tenant_policy" ON "search_rebuild_runs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
