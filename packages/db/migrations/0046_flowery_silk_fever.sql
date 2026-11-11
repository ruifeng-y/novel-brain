CREATE TABLE "batch_review_decision_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_review_decision_batches_request_hash_check" CHECK ("batch_review_decision_batches"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "batch_review_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"queue_item_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"chapter_id" uuid,
	"action" text NOT NULL,
	"risk" text NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"expected_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_review_decisions_target_type_check" CHECK ("batch_review_decisions"."target_type" in ('chapter', 'volume')),
	CONSTRAINT "batch_review_decisions_action_check" CHECK ("batch_review_decisions"."action" in ('approve', 'reject')),
	CONSTRAINT "batch_review_decisions_risk_check" CHECK ("batch_review_decisions"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "batch_review_decisions_expected_version_check" CHECK ("batch_review_decisions"."expected_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "batch_review_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"chapter_id" uuid,
	"chapter_version_id" uuid,
	"target_version" integer NOT NULL,
	"chapter_number" integer,
	"chapter_title" text,
	"volume_title" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"risk" text NOT NULL,
	"risk_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"quality" jsonb NOT NULL,
	"claimed_by" uuid,
	"claimed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batch_review_items_target_type_check" CHECK ("batch_review_items"."target_type" in ('chapter', 'volume')),
	CONSTRAINT "batch_review_items_status_check" CHECK ("batch_review_items"."status" in ('pending', 'claimed', 'approved', 'rejected', 'stale')),
	CONSTRAINT "batch_review_items_risk_check" CHECK ("batch_review_items"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "batch_review_items_target_version_check" CHECK ("batch_review_items"."target_version" > 0),
	CONSTRAINT "batch_review_items_version_check" CHECK ("batch_review_items"."version" > 0),
	CONSTRAINT "batch_review_items_risk_reasons_check" CHECK (jsonb_typeof("batch_review_items"."risk_reasons") = 'array'),
	CONSTRAINT "batch_review_items_target_check" CHECK (("batch_review_items"."target_type" = 'chapter' and "batch_review_items"."chapter_id" is not null) or ("batch_review_items"."target_type" = 'volume' and "batch_review_items"."chapter_id" is null)),
	CONSTRAINT "batch_review_items_claim_check" CHECK (("batch_review_items"."status" = 'claimed' and "batch_review_items"."claimed_by" is not null and "batch_review_items"."claimed_at" is not null) or ("batch_review_items"."status" <> 'claimed' and ("batch_review_items"."claimed_by" is null or "batch_review_items"."status" in ('approved', 'rejected'))))
);
--> statement-breakpoint
CREATE TABLE "job_work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"item_type" text NOT NULL,
	"work_item_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"chapter_id" uuid,
	"outline_node_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"priority_class" text DEFAULT 'batch' NOT NULL,
	"sort_order" integer NOT NULL,
	"input_version" jsonb NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cost" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_work_items_type_check" CHECK ("job_work_items"."item_type" in ('book', 'volume', 'chapter', 'step')),
	CONSTRAINT "job_work_items_status_check" CHECK ("job_work_items"."status" in ('pending', 'ready', 'running', 'paused', 'waiting_review', 'succeeded', 'failed', 'skipped', 'cancelled')),
	CONSTRAINT "job_work_items_priority_class_check" CHECK ("job_work_items"."priority_class" in ('interactive', 'batch')),
	CONSTRAINT "job_work_items_key_check" CHECK ("job_work_items"."work_item_key" ~ '^[a-z][a-z0-9:._-]{0,119}$'),
	CONSTRAINT "job_work_items_sort_order_check" CHECK ("job_work_items"."sort_order" >= 0),
	CONSTRAINT "job_work_items_attempt_check" CHECK ("job_work_items"."attempt" >= 0),
	CONSTRAINT "job_work_items_priority_check" CHECK ("job_work_items"."priority" >= 0 and "job_work_items"."priority" <= 1000),
	CONSTRAINT "job_work_items_parent_check" CHECK (("job_work_items"."item_type" = 'book' and "job_work_items"."parent_id" is null) or ("job_work_items"."item_type" <> 'book' and "job_work_items"."parent_id" is not null)),
	CONSTRAINT "job_work_items_chapter_check" CHECK (("job_work_items"."item_type" in ('chapter', 'step') and "job_work_items"."chapter_id" is not null) or ("job_work_items"."item_type" in ('book', 'volume') and "job_work_items"."chapter_id" is null)),
	CONSTRAINT "job_work_items_input_version_check" CHECK (jsonb_typeof("job_work_items"."input_version") = 'object'),
	CONSTRAINT "job_work_items_dependencies_check" CHECK (jsonb_typeof("job_work_items"."dependencies") = 'array'),
	CONSTRAINT "job_work_items_output_refs_check" CHECK (jsonb_typeof("job_work_items"."output_refs") = 'array')
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_required_scope_check";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "parent_job_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "job_type" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "work_item_key" text;--> statement-breakpoint
ALTER TABLE "batch_review_decision_batches" ADD CONSTRAINT "batch_review_decision_batches_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decision_batches" ADD CONSTRAINT "batch_review_decision_batches_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decision_batches" ADD CONSTRAINT "batch_review_decision_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_batch_id_batch_review_decision_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch_review_decision_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_queue_item_id_batch_review_items_id_fk" FOREIGN KEY ("queue_item_id") REFERENCES "public"."batch_review_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ADD CONSTRAINT "batch_review_decisions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_plan_id_jobs_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_work_item_id_job_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."job_work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch_review_items" ADD CONSTRAINT "batch_review_items_claimed_by_users_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_parent_id_job_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."job_work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_outline_node_id_outline_nodes_id_fk" FOREIGN KEY ("outline_node_id") REFERENCES "public"."outline_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batch_review_decision_batches_idempotency_unique" ON "batch_review_decision_batches" USING btree ("user_id","work_id","branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "batch_review_decision_batches_user_created_idx" ON "batch_review_decision_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_review_decisions_batch_item_unique" ON "batch_review_decisions" USING btree ("batch_id","queue_item_id");--> statement-breakpoint
CREATE INDEX "batch_review_decisions_user_created_idx" ON "batch_review_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "batch_review_decisions_target_idx" ON "batch_review_decisions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "batch_review_items_plan_work_item_unique" ON "batch_review_items" USING btree ("plan_id","work_item_id");--> statement-breakpoint
CREATE INDEX "batch_review_items_queue_idx" ON "batch_review_items" USING btree ("user_id","branch_id","status","risk");--> statement-breakpoint
CREATE INDEX "batch_review_items_plan_idx" ON "batch_review_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "batch_review_items_target_idx" ON "batch_review_items" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_items_job_key_unique" ON "job_work_items" USING btree ("job_id","work_item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "job_work_items_job_idempotency_unique" ON "job_work_items" USING btree ("job_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "job_work_items_job_type_order_idx" ON "job_work_items" USING btree ("job_id","item_type","sort_order");--> statement-breakpoint
CREATE INDEX "job_work_items_job_user_order_idx" ON "job_work_items" USING btree ("job_id","user_id","sort_order","id");--> statement-breakpoint
CREATE INDEX "job_work_items_job_status_priority_idx" ON "job_work_items" USING btree ("job_id","status","priority","sort_order");--> statement-breakpoint
CREATE INDEX "job_work_items_user_work_created_idx" ON "job_work_items" USING btree ("user_id","work_id","created_at");--> statement-breakpoint
CREATE INDEX "job_work_items_parent_idx" ON "job_work_items" USING btree ("parent_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_parent_job_id_jobs_id_fk" FOREIGN KEY ("parent_job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_batch_plan_idempotency_unique" ON "jobs" USING btree ("user_id","work_id","branch_id","idempotency_key") WHERE "jobs"."type" = 'batch_plan';--> statement-breakpoint
CREATE INDEX "jobs_parent_created_idx" ON "jobs" USING btree ("parent_job_id","created_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_job_type_check" CHECK ("jobs"."job_type" is null or "jobs"."job_type" in ('book', 'volume', 'chapter', 'step'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_batch_plan_scope_check" CHECK ("jobs"."type" <> 'batch_plan' or ("jobs"."job_type" = 'book' and "jobs"."work_item_key" = 'book' and "jobs"."chapter_id" is null and "jobs"."model_config_id" is null));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_chapter', 'agent_workflow', 'write_action', 'batch_plan'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_scope_check" CHECK (("jobs"."type" in ('agent_workflow', 'batch_plan')) or ("jobs"."type" in ('generate_chapter', 'write_action') and "jobs"."chapter_id" is not null and "jobs"."model_config_id" is not null));--> statement-breakpoint
ALTER TABLE "batch_review_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_review_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "batch_review_items_tenant_policy" ON "batch_review_items"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "batch_review_decision_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_review_decision_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "batch_review_decision_batches_tenant_policy" ON "batch_review_decision_batches"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "batch_review_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "batch_review_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "batch_review_decisions_tenant_policy" ON "batch_review_decisions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "job_work_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_work_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "job_work_items_tenant_policy" ON "job_work_items"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
