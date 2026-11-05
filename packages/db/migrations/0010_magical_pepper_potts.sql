CREATE TABLE "import_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_type" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_excerpt" text NOT NULL,
	"confidence" real NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_candidates_type_check" CHECK ("import_candidates"."candidate_type" in ('character', 'faction', 'map', 'power_system', 'golden_finger')),
	CONSTRAINT "import_candidates_status_check" CHECK ("import_candidates"."status" in ('accepted', 'pending', 'conflict')),
	CONSTRAINT "import_candidates_confidence_check" CHECK ("import_candidates"."confidence" >= 0 and "import_candidates"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "import_conflicts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conflict_type" text NOT NULL,
	"summary" text NOT NULL,
	"primary_candidate_id" uuid NOT NULL,
	"secondary_candidate_id" uuid NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_conflicts_type_check" CHECK ("import_conflicts"."conflict_type" in ('contradictory_setting')),
	CONSTRAINT "import_conflicts_decision_check" CHECK ("import_conflicts"."decision" in ('pending', 'use_primary', 'use_secondary'))
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid,
	"branch_id" uuid,
	"mode" text DEFAULT 'settings' NOT NULL,
	"status" text DEFAULT 'awaiting_confirmation' NOT NULL,
	"source_kind" text NOT NULL,
	"source_name" text,
	"source_text" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_jobs_mode_check" CHECK ("import_jobs"."mode" in ('settings')),
	CONSTRAINT "import_jobs_status_check" CHECK ("import_jobs"."status" in ('awaiting_confirmation', 'completed')),
	CONSTRAINT "import_jobs_source_kind_check" CHECK ("import_jobs"."source_kind" in ('paste', 'file'))
);
--> statement-breakpoint
CREATE TABLE "import_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_job_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"accepted_candidate_ids" jsonb NOT NULL,
	"pending_candidate_ids" jsonb NOT NULL,
	"unparsed" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_candidates" ADD CONSTRAINT "import_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_conflicts" ADD CONSTRAINT "import_conflicts_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_conflicts" ADD CONSTRAINT "import_conflicts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_conflicts" ADD CONSTRAINT "import_conflicts_primary_candidate_id_import_candidates_id_fk" FOREIGN KEY ("primary_candidate_id") REFERENCES "public"."import_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_conflicts" ADD CONSTRAINT "import_conflicts_secondary_candidate_id_import_candidates_id_fk" FOREIGN KEY ("secondary_candidate_id") REFERENCES "public"."import_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reports" ADD CONSTRAINT "import_reports_import_job_id_import_jobs_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reports" ADD CONSTRAINT "import_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_candidates_job_idx" ON "import_candidates" USING btree ("import_job_id");--> statement-breakpoint
CREATE INDEX "import_conflicts_job_idx" ON "import_conflicts" USING btree ("import_job_id");--> statement-breakpoint
CREATE INDEX "import_jobs_user_created_idx" ON "import_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_reports_job_unique" ON "import_reports" USING btree ("import_job_id");--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_jobs_tenant_policy" ON "import_jobs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_candidates_tenant_policy" ON "import_candidates"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_conflicts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_conflicts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_conflicts_tenant_policy" ON "import_conflicts"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "import_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "import_reports_tenant_policy" ON "import_reports"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
