CREATE TABLE "work_blueprints" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"current_step" text DEFAULT 'prepare' NOT NULL,
	"input_hash" text NOT NULL,
	"estimate" jsonb NOT NULL,
	"draft_hash" text,
	"story_bible_draft" jsonb,
	"core_settings_draft" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outline_draft" jsonb,
	"missing_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conflicts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acknowledgements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost" jsonb DEFAULT '{"inputTokens":0,"outputTokens":0,"totalTokens":0,"costCny":0}'::jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_blueprints_status_check" CHECK ("work_blueprints"."status" in ('queued', 'running', 'waiting_model_config', 'budget_paused', 'waiting_review', 'failed', 'confirmed', 'cancelled')),
	CONSTRAINT "work_blueprints_step_check" CHECK ("work_blueprints"."current_step" in ('prepare', 'story_bible', 'core_settings', 'outline', 'validate', 'await_review')),
	CONSTRAINT "work_blueprints_version_check" CHECK ("work_blueprints"."version" > 0),
	CONSTRAINT "work_blueprints_progress_check" CHECK ("work_blueprints"."progress" >= 0 and "work_blueprints"."progress" <= 100),
	CONSTRAINT "work_blueprints_input_hash_check" CHECK ("work_blueprints"."input_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "work_blueprints_draft_hash_check" CHECK ("work_blueprints"."draft_hash" is null or "work_blueprints"."draft_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "work_blueprints_confirmed_check" CHECK ("work_blueprints"."status" <> 'confirmed' or ("work_blueprints"."confirmed_at" is not null and "work_blueprints"."confirmed_by" is not null and "work_blueprints"."draft_hash" is not null and "work_blueprints"."story_bible_draft" is not null and "work_blueprints"."outline_draft" is not null))
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_required_scope_check";--> statement-breakpoint
ALTER TABLE "version_nodes" DROP CONSTRAINT "version_nodes_node_type_check";--> statement-breakpoint
ALTER TABLE "work_blueprints" ADD CONSTRAINT "work_blueprints_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blueprints" ADD CONSTRAINT "work_blueprints_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blueprints" ADD CONSTRAINT "work_blueprints_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blueprints" ADD CONSTRAINT "work_blueprints_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_blueprints" ADD CONSTRAINT "work_blueprints_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_blueprints_work_branch_unique" ON "work_blueprints" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_blueprints_job_unique" ON "work_blueprints" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "work_blueprints_user_work_created_idx" ON "work_blueprints" USING btree ("user_id","work_id","created_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_chapter', 'agent_workflow', 'write_action', 'batch_plan', 'export_work', 'generate_blueprint'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_scope_check" CHECK (("jobs"."type" in ('agent_workflow', 'batch_plan', 'export_work')) or ("jobs"."type" = 'generate_blueprint' and "jobs"."chapter_id" is null and "jobs"."model_config_id" is not null) or ("jobs"."type" in ('generate_chapter', 'write_action') and "jobs"."chapter_id" is not null and "jobs"."model_config_id" is not null));--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_node_type_check" CHECK ("version_nodes"."node_type" in ('chapter_version', 'outline_version', 'ledger_version', 'story_bible_version', 'entity_version', 'canon_commit', 'writing_action_output', 'snapshot', 'change_apply', 'branch_merge', 'rollback', 'blueprint_version'));--> statement-breakpoint
ALTER TABLE "work_blueprints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_blueprints" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "work_blueprints_tenant_policy" ON "work_blueprints"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
