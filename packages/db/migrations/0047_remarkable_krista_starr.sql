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
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_parent_id_job_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."job_work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_work_items" ADD CONSTRAINT "job_work_items_outline_node_id_outline_nodes_id_fk" FOREIGN KEY ("outline_node_id") REFERENCES "public"."outline_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_scope_check" CHECK (("jobs"."type" in ('agent_workflow', 'batch_plan')) or ("jobs"."type" in ('generate_chapter', 'write_action') and "jobs"."chapter_id" is not null and "jobs"."model_config_id" is not null));