CREATE TABLE "cost_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"reserved_cost_cny" real NOT NULL,
	"settled_tokens" integer DEFAULT 0 NOT NULL,
	"settled_cost_cny" real DEFAULT 0 NOT NULL,
	"failure_class" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "cost_reservations_status_check" CHECK ("cost_reservations"."status" in ('reserved', 'settled', 'released')),
	CONSTRAINT "cost_reservations_amounts_check" CHECK ("cost_reservations"."reserved_tokens" >= 0 and "cost_reservations"."reserved_cost_cny" >= 0 and "cost_reservations"."settled_tokens" >= 0 and "cost_reservations"."settled_cost_cny" >= 0),
	CONSTRAINT "cost_reservations_failure_class_check" CHECK ("cost_reservations"."failure_class" is null or "cost_reservations"."failure_class" in ('provider', 'timeout', 'rate_limit', 'schema', 'policy', 'budget', 'cancelled', 'unknown')),
	CONSTRAINT "cost_reservations_evidence_check" CHECK (("cost_reservations"."status" = 'settled' and "cost_reservations"."settled_at" is not null) or ("cost_reservations"."status" <> 'settled' and "cost_reservations"."settled_at" is null))
);
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_id" uuid,
	"job_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"prompt_version_id" uuid NOT NULL,
	"cost_reservation_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'started' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"config_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_hash" text,
	"input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cny" real DEFAULT 0 NOT NULL,
	"failure_class" text,
	"error_code" text,
	"escalation_reason" text,
	"provider_request_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_calls_status_check" CHECK ("model_calls"."status" in ('started', 'succeeded', 'failed')),
	CONSTRAINT "model_calls_failure_class_check" CHECK ("model_calls"."failure_class" is null or "model_calls"."failure_class" in ('provider', 'timeout', 'rate_limit', 'schema', 'policy', 'budget', 'cancelled', 'unknown')),
	CONSTRAINT "model_calls_usage_check" CHECK ("model_calls"."input_tokens" >= 0 and "model_calls"."output_tokens" >= 0 and "model_calls"."cost_cny" >= 0)
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"step_key" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"role" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"system_hash" text NOT NULL,
	"input_hash" text NOT NULL,
	"context_pack_id" uuid,
	"compiler_version" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_role_check" CHECK ("prompt_versions"."role" in ('planner', 'context_curator', 'writer', 'critic', 'reviser', 'fact_extractor', 'canon_curator')),
	CONSTRAINT "prompt_versions_version_check" CHECK ("prompt_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "prompt_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model_config_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "output_hash" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "input_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "output_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "failure_class" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "escalation_reason" text;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_reservations" ADD CONSTRAINT "cost_reservations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_cost_reservation_id_cost_reservations_id_fk" FOREIGN KEY ("cost_reservation_id") REFERENCES "public"."cost_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_context_pack_id_context_pack_versions_id_fk" FOREIGN KEY ("context_pack_id") REFERENCES "public"."context_pack_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_reservations_job_idempotency_unique" ON "cost_reservations" USING btree ("job_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "cost_reservations_job_status_idx" ON "cost_reservations" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "cost_reservations_user_work_idx" ON "cost_reservations" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "cost_reservations_agent_run_idx" ON "cost_reservations" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_calls_job_step_attempt_unique" ON "model_calls" USING btree ("job_id","step_key","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "model_calls_cost_reservation_unique" ON "model_calls" USING btree ("cost_reservation_id");--> statement-breakpoint
CREATE INDEX "model_calls_job_created_idx" ON "model_calls" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "model_calls_chapter_created_idx" ON "model_calls" USING btree ("chapter_id","created_at");--> statement-breakpoint
CREATE INDEX "model_calls_user_work_idx" ON "model_calls" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_job_step_hash_unique" ON "prompt_versions" USING btree ("job_id","step_key","key","prompt_hash");--> statement-breakpoint
CREATE INDEX "prompt_versions_user_work_idx" ON "prompt_versions" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "prompt_versions_job_created_idx" ON "prompt_versions" USING btree ("job_id","created_at");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_prompt_version_id_prompt_versions_id_fk" FOREIGN KEY ("prompt_version_id") REFERENCES "public"."prompt_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_model_config_id_model_configs_id_fk" FOREIGN KEY ("model_config_id") REFERENCES "public"."model_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "agent_runs" SET "role" = 'critic' WHERE "role" = 'verifier';--> statement-breakpoint
CREATE INDEX "agent_runs_chapter_created_idx" ON "agent_runs" USING btree ("chapter_id","started_at");--> statement-breakpoint
CREATE INDEX "agent_runs_user_work_idx" ON "agent_runs" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check" CHECK ("agent_runs"."status" in ('running', 'succeeded', 'failed'));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_role_check" CHECK ("agent_runs"."role" in ('planner', 'context_curator', 'writer', 'critic', 'reviser', 'fact_extractor', 'canon_curator'));--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_failure_class_check" CHECK ("agent_runs"."failure_class" is null or "agent_runs"."failure_class" in ('provider', 'timeout', 'rate_limit', 'schema', 'policy', 'budget', 'cancelled', 'unknown'));--> statement-breakpoint
ALTER TABLE "prompt_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompt_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "prompt_versions_tenant_policy" ON "prompt_versions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "cost_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cost_reservations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cost_reservations_tenant_policy" ON "cost_reservations"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "model_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "model_calls" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "model_calls_tenant_policy" ON "model_calls"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
