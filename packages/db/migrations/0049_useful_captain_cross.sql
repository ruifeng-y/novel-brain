CREATE TABLE "change_impacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"change_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"affected_type" text NOT NULL,
	"affected_id" uuid,
	"chapter_id" uuid,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_impacts_category_check" CHECK ("change_impacts"."category" in ('safe', 'repairable', 'structural')),
	CONSTRAINT "change_impacts_confidence_check" CHECK ("change_impacts"."confidence" >= 0 and "change_impacts"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"before" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"after" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT 'author' NOT NULL,
	"risk" text DEFAULT 'low' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_target_type_check" CHECK ("change_requests"."target_type" in ('entity', 'chapter', 'outline', 'fact', 'ledger', 'work')),
	CONSTRAINT "change_requests_source_check" CHECK ("change_requests"."source" in ('author', 'ai', 'import', 'batch')),
	CONSTRAINT "change_requests_risk_check" CHECK ("change_requests"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "change_requests_status_check" CHECK ("change_requests"."status" in ('draft', 'analyzing', 'awaiting_confirmation', 'applying', 'applied', 'rejected', 'cancelled', 'failed', 'branched')),
	CONSTRAINT "change_requests_version_check" CHECK ("change_requests"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "import_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"source_text" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_chunks_sequence_check" CHECK ("import_chunks"."sequence" >= 0),
	CONSTRAINT "import_chunks_status_check" CHECK ("import_chunks"."status" in ('pending', 'processed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "merge_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"merge_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"expected_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_decisions_action_check" CHECK ("merge_decisions"."action" in ('accept', 'reject')),
	CONSTRAINT "merge_decisions_version_check" CHECK ("merge_decisions"."expected_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "merge_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"source_branch_id" uuid NOT NULL,
	"target_branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_node_id" uuid,
	"target_node_id" uuid,
	"object_type" text NOT NULL,
	"object_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"source_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"target_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"diff" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"risk" text DEFAULT 'low' NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merge_items_object_type_check" CHECK ("merge_items"."object_type" in ('chapter', 'entity', 'fact', 'outline', 'ledger')),
	CONSTRAINT "merge_items_risk_check" CHECK ("merge_items"."risk" in ('low', 'medium', 'high')),
	CONSTRAINT "merge_items_status_check" CHECK ("merge_items"."status" in ('pending', 'accepted', 'rejected', 'applied', 'stale')),
	CONSTRAINT "merge_items_version_check" CHECK ("merge_items"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "import_jobs" DROP CONSTRAINT "import_jobs_status_check";--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "chunk_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "processed_chunks" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "change_impacts" ADD CONSTRAINT "change_impacts_change_id_change_requests_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_impacts" ADD CONSTRAINT "change_impacts_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_impacts" ADD CONSTRAINT "change_impacts_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_impacts" ADD CONSTRAINT "change_impacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_impacts" ADD CONSTRAINT "change_impacts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decisions" ADD CONSTRAINT "merge_decisions_merge_item_id_merge_items_id_fk" FOREIGN KEY ("merge_item_id") REFERENCES "public"."merge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_decisions" ADD CONSTRAINT "merge_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_items" ADD CONSTRAINT "merge_items_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_items" ADD CONSTRAINT "merge_items_source_branch_id_work_branches_id_fk" FOREIGN KEY ("source_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_items" ADD CONSTRAINT "merge_items_target_branch_id_work_branches_id_fk" FOREIGN KEY ("target_branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_items" ADD CONSTRAINT "merge_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_items" ADD CONSTRAINT "merge_items_source_node_id_version_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_items" ADD CONSTRAINT "merge_items_target_node_id_version_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_impacts_change_idx" ON "change_impacts" USING btree ("change_id","category");--> statement-breakpoint
CREATE INDEX "change_impacts_user_work_idx" ON "change_impacts" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "change_requests_user_branch_idempotency_unique" ON "change_requests" USING btree ("user_id","branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "change_requests_branch_status_idx" ON "change_requests" USING btree ("branch_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "change_requests_user_work_idx" ON "change_requests" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_chunks_job_sequence_unique" ON "import_chunks" USING btree ("import_job_id","sequence");--> statement-breakpoint
CREATE INDEX "import_chunks_job_status_idx" ON "import_chunks" USING btree ("import_job_id","status","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_decisions_item_version_unique" ON "merge_decisions" USING btree ("merge_item_id","expected_version");--> statement-breakpoint
CREATE INDEX "merge_decisions_user_created_idx" ON "merge_decisions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "merge_items_source_target_object_unique" ON "merge_items" USING btree ("source_branch_id","target_branch_id","object_type","object_key");--> statement-breakpoint
CREATE INDEX "merge_items_target_status_idx" ON "merge_items" USING btree ("target_branch_id","status");--> statement-breakpoint
CREATE INDEX "merge_items_user_work_idx" ON "merge_items" USING btree ("user_id","work_id");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_chunk_count_check" CHECK ("import_jobs"."chunk_count" > 0);--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_processed_chunks_check" CHECK ("import_jobs"."processed_chunks" >= 0 and "import_jobs"."processed_chunks" <= "import_jobs"."chunk_count");--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" in ('queued', 'processing', 'awaiting_confirmation', 'partial', 'failed', 'completed'));
--> statement-breakpoint
ALTER TABLE "change_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "change_requests_tenant_policy" ON "change_requests"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "change_impacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "change_impacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "change_impacts_tenant_policy" ON "change_impacts"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "merge_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merge_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "merge_items_tenant_policy" ON "merge_items"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "merge_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "merge_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "merge_decisions_tenant_policy" ON "merge_decisions"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_chunks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_chunks_tenant_policy" ON "import_chunks"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "search_documents_trgm_idx" ON "search_documents"
	USING gin (("title" || ' ' || "content" || ' ' || "aliases"::text) gin_trgm_ops);
