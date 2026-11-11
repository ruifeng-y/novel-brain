CREATE TABLE "revision_feedback_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"finding_id" uuid,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"target_version_id" uuid NOT NULL,
	"evaluation_opt_in" boolean DEFAULT false NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_feedback_action_check" CHECK ("revision_feedback_events"."action" in ('accept', 'reject', 'rewrite')),
	CONSTRAINT "revision_feedback_reason_check" CHECK (length(trim("revision_feedback_events"."reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "revision_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"max_rounds" integer NOT NULL,
	"max_cost_cny" real NOT NULL,
	"max_tokens" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "revision_plans_status_check" CHECK ("revision_plans"."status" in ('active', 'awaiting_feedback', 'completed', 'rejected')),
	CONSTRAINT "revision_plans_max_rounds_check" CHECK ("revision_plans"."max_rounds" between 1 and 2),
	CONSTRAINT "revision_plans_budget_check" CHECK ("revision_plans"."max_cost_cny" > 0 and "revision_plans"."max_tokens" > 0),
	CONSTRAINT "revision_plans_version_check" CHECK ("revision_plans"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "revision_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"round_number" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"job_id" uuid,
	"source_version_id" uuid NOT NULL,
	"result_version_id" uuid,
	"version_node_id" uuid,
	"selected_findings" jsonb NOT NULL,
	"blocks" jsonb NOT NULL,
	"constraints" jsonb NOT NULL,
	"diff" jsonb,
	"unresolved_finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "revision_rounds_round_number_check" CHECK ("revision_rounds"."round_number" between 1 and 2),
	CONSTRAINT "revision_rounds_status_check" CHECK ("revision_rounds"."status" in ('queued', 'running', 'waiting_review', 'accepted', 'rejected', 'rewrite_requested', 'failed')),
	CONSTRAINT "revision_rounds_selected_findings_check" CHECK (jsonb_typeof("revision_rounds"."selected_findings") = 'array' and jsonb_array_length("revision_rounds"."selected_findings") > 0),
	CONSTRAINT "revision_rounds_blocks_check" CHECK (jsonb_typeof("revision_rounds"."blocks") = 'array' and jsonb_array_length("revision_rounds"."blocks") > 0),
	CONSTRAINT "revision_rounds_unresolved_check" CHECK (jsonb_typeof("revision_rounds"."unresolved_finding_ids") = 'array'),
	CONSTRAINT "revision_rounds_version_check" CHECK ("revision_rounds"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "writing_actions" DROP CONSTRAINT "writing_actions_action_check";--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_plan_id_revision_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."revision_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_round_id_revision_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."revision_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_finding_id_quality_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."quality_findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_target_version_id_chapter_versions_id_fk" FOREIGN KEY ("target_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ADD CONSTRAINT "revision_feedback_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_plans" ADD CONSTRAINT "revision_plans_source_version_id_chapter_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_plan_id_revision_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."revision_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_source_version_id_chapter_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_result_version_id_chapter_versions_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_rounds" ADD CONSTRAINT "revision_rounds_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "revision_feedback_plan_created_idx" ON "revision_feedback_events" USING btree ("plan_id","created_at");--> statement-breakpoint
CREATE INDEX "revision_feedback_round_created_idx" ON "revision_feedback_events" USING btree ("round_id","created_at");--> statement-breakpoint
CREATE INDEX "revision_feedback_chapter_finding_idx" ON "revision_feedback_events" USING btree ("chapter_id","finding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_plans_chapter_idempotency_unique" ON "revision_plans" USING btree ("user_id","chapter_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "revision_plans_user_work_idx" ON "revision_plans" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "revision_plans_chapter_created_idx" ON "revision_plans" USING btree ("chapter_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_rounds_plan_round_unique" ON "revision_rounds" USING btree ("plan_id","round_number");--> statement-breakpoint
CREATE UNIQUE INDEX "revision_rounds_job_unique" ON "revision_rounds" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "revision_rounds_chapter_created_idx" ON "revision_rounds" USING btree ("chapter_id","created_at");--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_action_check" CHECK ("writing_actions"."action" in ('continue', 'rewrite', 'expand', 'condense', 'change_pov', 'add_hook', 'generate_title', 'generate_summary', 'selection_rewrite', 'targeted_revision'));
--> statement-breakpoint
ALTER TABLE "revision_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "revision_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "revision_plans_tenant_policy" ON "revision_plans"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "revision_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "revision_rounds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "revision_rounds_tenant_policy" ON "revision_rounds"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "revision_feedback_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "revision_feedback_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "revision_feedback_events_tenant_policy" ON "revision_feedback_events"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
