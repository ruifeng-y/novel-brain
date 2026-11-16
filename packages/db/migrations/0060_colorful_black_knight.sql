CREATE TABLE "work_export_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"format" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"request" jsonb NOT NULL,
	"source_descriptor" jsonb NOT NULL,
	"manifest" jsonb,
	"artifact_payload" text,
	"checksum" text,
	"byte_size" integer,
	"file_name" text,
	"content_type" text,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "work_export_receipts_format_check" CHECK ("work_export_receipts"."format" in ('txt', 'markdown', 'docx', 'epub')),
	CONSTRAINT "work_export_receipts_status_check" CHECK ("work_export_receipts"."status" in ('queued', 'running', 'completed', 'failed', 'expired')),
	CONSTRAINT "work_export_receipts_checksum_check" CHECK ("work_export_receipts"."checksum" is null or "work_export_receipts"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "work_export_receipts_byte_size_check" CHECK ("work_export_receipts"."byte_size" is null or "work_export_receipts"."byte_size" >= 0)
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_check";--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_required_scope_check";--> statement-breakpoint
ALTER TABLE "work_export_receipts" ADD CONSTRAINT "work_export_receipts_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_export_receipts" ADD CONSTRAINT "work_export_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_export_receipts" ADD CONSTRAINT "work_export_receipts_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_export_receipts" ADD CONSTRAINT "work_export_receipts_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_export_receipts_idempotency_unique" ON "work_export_receipts" USING btree ("user_id","work_id","branch_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "work_export_receipts_user_created_idx" ON "work_export_receipts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "work_export_receipts_work_branch_created_idx" ON "work_export_receipts" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "work_export_receipts_expires_idx" ON "work_export_receipts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_export_work_idempotency_unique" ON "jobs" USING btree ("user_id","work_id","branch_id","idempotency_key") WHERE "jobs"."type" = 'export_work';--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_check" CHECK ("jobs"."type" in ('generate_chapter', 'agent_workflow', 'write_action', 'batch_plan', 'export_work'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_required_scope_check" CHECK (("jobs"."type" in ('agent_workflow', 'batch_plan', 'export_work')) or ("jobs"."type" in ('generate_chapter', 'write_action') and "jobs"."chapter_id" is not null and "jobs"."model_config_id" is not null));
--> statement-breakpoint
ALTER TABLE "work_export_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "work_export_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "work_export_receipts_tenant_policy" ON "work_export_receipts";--> statement-breakpoint
CREATE POLICY "work_export_receipts_tenant_policy" ON "work_export_receipts"
	USING (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) in ('account_deletion', 'work_export_cleanup')
	)
	WITH CHECK (
		"user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid
		OR current_setting('app.system_role', true) in ('account_deletion', 'work_export_cleanup')
	);
