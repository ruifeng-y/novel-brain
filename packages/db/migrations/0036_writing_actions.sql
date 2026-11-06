CREATE TABLE "writing_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"action" text NOT NULL,
	"source_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"output_kind" text NOT NULL,
	"version_node_id" uuid NOT NULL,
	"chapter_version_id" uuid,
	"affected_range" jsonb,
	"artifact" jsonb NOT NULL,
	"prompt_key" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"prompt_hash" text NOT NULL,
	"model_provider" text NOT NULL,
	"model" text NOT NULL,
	"model_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "writing_actions_action_check" CHECK ("writing_actions"."action" in ('continue', 'rewrite', 'expand', 'condense', 'change_pov', 'add_hook', 'generate_title', 'generate_summary', 'selection_rewrite')),
	CONSTRAINT "writing_actions_output_kind_check" CHECK ("writing_actions"."output_kind" in ('chapter_text', 'title_options', 'summary', 'hooks')),
	CONSTRAINT "writing_actions_version_check" CHECK ("writing_actions"."version" > 0),
	CONSTRAINT "writing_actions_chapter_output_check" CHECK (("writing_actions"."output_kind" = 'chapter_text' and "writing_actions"."chapter_version_id" is not null) or ("writing_actions"."output_kind" <> 'chapter_text' and "writing_actions"."chapter_version_id" is null)),
	CONSTRAINT "writing_actions_prompt_hash_check" CHECK ("writing_actions"."prompt_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_required_scope_check";--> statement-breakpoint
ALTER TABLE "version_nodes" DROP CONSTRAINT "version_nodes_node_type_check";--> statement-breakpoint
DROP INDEX "jobs_chapter_idempotency_unique";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source_version_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "action" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "action_input" jsonb;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_source_version_id_chapter_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_actions" ADD CONSTRAINT "writing_actions_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "writing_actions_job_unique" ON "writing_actions" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "writing_actions_chapter_version_unique" ON "writing_actions" USING btree ("chapter_id","version");--> statement-breakpoint
CREATE INDEX "writing_actions_user_work_idx" ON "writing_actions" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "writing_actions_chapter_created_idx" ON "writing_actions" USING btree ("chapter_id","created_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_version_id_chapter_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_chapter_idempotency_unique" ON "jobs" USING btree ("user_id","chapter_id","type","idempotency_key");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_writing_action_scope_check" CHECK (("jobs"."type" = 'write_action' and "jobs"."action" is not null and "jobs"."source_version_id" is not null and "jobs"."action_input" is not null) or ("jobs"."type" <> 'write_action' and "jobs"."action" is null and "jobs"."source_version_id" is null and "jobs"."action_input" is null));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_chapter', 'agent_workflow', 'write_action'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_scope_check" CHECK (("jobs"."type" = 'agent_workflow') or ("jobs"."type" in ('generate_chapter', 'write_action') and "jobs"."chapter_id" is not null and "jobs"."model_config_id" is not null));--> statement-breakpoint
ALTER TABLE "version_nodes" ADD CONSTRAINT "version_nodes_node_type_check" CHECK ("version_nodes"."node_type" in ('chapter_version', 'outline_version', 'ledger_version', 'story_bible_version', 'entity_version', 'canon_commit', 'writing_action_output', 'snapshot', 'change_apply', 'branch_merge', 'rollback'));--> statement-breakpoint
ALTER TABLE "writing_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "writing_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "writing_actions_tenant_policy" ON "writing_actions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
