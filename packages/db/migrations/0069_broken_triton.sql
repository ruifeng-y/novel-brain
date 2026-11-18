CREATE TABLE "eval_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"dataset_sha256" text NOT NULL,
	"dataset_version" text NOT NULL,
	"case_key" text NOT NULL,
	"kind" text NOT NULL,
	"genre" text NOT NULL,
	"difficulty" text NOT NULL,
	"source_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"known_issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_cases_dataset_hash_check" CHECK ("eval_cases"."dataset_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "eval_cases_source_hash_check" CHECK ("eval_cases"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "eval_cases_kind_check" CHECK ("eval_cases"."kind" in ('chapter', 'long_horizon_case')),
	CONSTRAINT "eval_cases_difficulty_check" CHECK ("eval_cases"."difficulty" in ('easy', 'medium', 'hard'))
);
--> statement-breakpoint
CREATE TABLE "eval_gates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"baseline_run_id" uuid NOT NULL,
	"candidate_run_id" uuid NOT NULL,
	"rollout_allowed" boolean NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changed_provenance" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"p0_baseline" real NOT NULL,
	"p0_candidate" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_gates_run_distinct_check" CHECK ("eval_gates"."baseline_run_id" <> "eval_gates"."candidate_run_id"),
	CONSTRAINT "eval_gates_p0_check" CHECK ("eval_gates"."p0_baseline" >= 0 and "eval_gates"."p0_candidate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_key" text NOT NULL,
	"dataset_sha256" text NOT NULL,
	"rubric_version" text NOT NULL,
	"rubric_sha256" text NOT NULL,
	"status" text NOT NULL,
	"report_sha256" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"continuity_evaluation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_runs_dataset_hash_check" CHECK ("eval_runs"."dataset_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "eval_runs_rubric_hash_check" CHECK ("eval_runs"."rubric_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "eval_runs_report_hash_check" CHECK ("eval_runs"."report_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "eval_runs_status_check" CHECK ("eval_runs"."status" in ('passed', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "eval_scores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"sample_id" text NOT NULL,
	"dimension" text NOT NULL,
	"scorer_type" text NOT NULL,
	"scorer_id" text NOT NULL,
	"value" real NOT NULL,
	"confidence" real NOT NULL,
	"evidence_quote" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_scores_dimension_check" CHECK ("eval_scores"."dimension" in ('p0_fact_loss', 'knowledge_boundary_violation', 'outline_adherence', 'hook_prose_score', 'continuity_conflicts_per_50k')),
	CONSTRAINT "eval_scores_scorer_type_check" CHECK ("eval_scores"."scorer_type" in ('deterministic', 'human_blind', 'model_assisted')),
	CONSTRAINT "eval_scores_confidence_check" CHECK ("eval_scores"."confidence" >= 0 and "eval_scores"."confidence" <= 1),
	CONSTRAINT "eval_scores_evidence_check" CHECK (length(trim("eval_scores"."evidence_quote")) > 0)
);
--> statement-breakpoint
ALTER TABLE "eval_gates" ADD CONSTRAINT "eval_gates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_gates" ADD CONSTRAINT "eval_gates_baseline_run_id_eval_runs_id_fk" FOREIGN KEY ("baseline_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_gates" ADD CONSTRAINT "eval_gates_candidate_run_id_eval_runs_id_fk" FOREIGN KEY ("candidate_run_id") REFERENCES "public"."eval_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_scores" ADD CONSTRAINT "eval_scores_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_dataset_case_unique" ON "eval_cases" USING btree ("dataset_sha256","case_key");--> statement-breakpoint
CREATE INDEX "eval_cases_genre_difficulty_idx" ON "eval_cases" USING btree ("genre","difficulty");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_gates_user_runs_unique" ON "eval_gates" USING btree ("user_id","baseline_run_id","candidate_run_id");--> statement-breakpoint
CREATE INDEX "eval_gates_user_created_idx" ON "eval_gates" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_runs_user_run_key_unique" ON "eval_runs" USING btree ("user_id","run_key");--> statement-breakpoint
CREATE INDEX "eval_runs_user_created_idx" ON "eval_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "eval_runs_dataset_status_idx" ON "eval_runs" USING btree ("dataset_sha256","status");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_scores_run_scorer_unique" ON "eval_scores" USING btree ("run_id","sample_id","dimension","scorer_type","scorer_id");--> statement-breakpoint
CREATE INDEX "eval_scores_user_run_idx" ON "eval_scores" USING btree ("user_id","run_id");
--> statement-breakpoint
ALTER TABLE "eval_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eval_runs_tenant_policy" ON "eval_runs"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "eval_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_scores" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eval_scores_tenant_policy" ON "eval_scores"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "eval_gates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_gates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "eval_gates_tenant_policy" ON "eval_gates"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
