CREATE TABLE "golden_three_candidates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"label" text NOT NULL,
	"strategy" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prompt_key" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"prompt_hash" text NOT NULL,
	"model_provider" text NOT NULL,
	"model" text NOT NULL,
	"model_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"context_pack_version_id" uuid,
	"context_manifest_hash" text NOT NULL,
	"chapter_pins" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "golden_three_candidates_strategy_check" CHECK ("golden_three_candidates"."strategy" in ('hook_focus', 'character_focus', 'world_focus')),
	CONSTRAINT "golden_three_candidates_status_check" CHECK ("golden_three_candidates"."status" in ('draft', 'reviewed', 'selected', 'locked')),
	CONSTRAINT "golden_three_candidates_prompt_hash_check" CHECK ("golden_three_candidates"."prompt_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "golden_three_candidates_context_hash_check" CHECK ("golden_three_candidates"."context_manifest_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "golden_three_candidates_pins_check" CHECK (jsonb_typeof("golden_three_candidates"."chapter_pins") = 'array' and jsonb_array_length("golden_three_candidates"."chapter_pins") = 3)
);
--> statement-breakpoint
CREATE TABLE "golden_three_locks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"version_node_id" uuid NOT NULL,
	"style_baseline_id" uuid NOT NULL,
	"chapter_pins" jsonb NOT NULL,
	"review_snapshot" jsonb NOT NULL,
	"override_policy" text,
	"override_rationale" text,
	"locked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "golden_three_locks_override_check" CHECK (("golden_three_locks"."override_policy" is null and "golden_three_locks"."override_rationale" is null) or ("golden_three_locks"."override_policy" = 'author_override_v1' and "golden_three_locks"."override_rationale" is not null and length(trim("golden_three_locks"."override_rationale")) >= 10)),
	CONSTRAINT "golden_three_locks_pins_check" CHECK (jsonb_typeof("golden_three_locks"."chapter_pins") = 'array' and jsonb_array_length("golden_three_locks"."chapter_pins") = 3)
);
--> statement-breakpoint
CREATE TABLE "golden_three_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"score" integer NOT NULL,
	"evidence_chapter_id" uuid NOT NULL,
	"evidence_chapter_version_id" uuid NOT NULL,
	"evidence_passage" text NOT NULL,
	"evidence_locator" text NOT NULL,
	"reviewer_origin" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "golden_three_reviews_dimension_check" CHECK ("golden_three_reviews"."dimension" in ('opening_hook', 'protagonist_appeal', 'world_rules', 'core_conflict', 'reader_promise', 'chapter_end_hook')),
	CONSTRAINT "golden_three_reviews_score_check" CHECK ("golden_three_reviews"."score" between 1 and 5),
	CONSTRAINT "golden_three_reviews_origin_check" CHECK ("golden_three_reviews"."reviewer_origin" in ('model', 'author', 'critic')),
	CONSTRAINT "golden_three_reviews_evidence_check" CHECK (length(trim("golden_three_reviews"."evidence_passage")) > 0 and length(trim("golden_three_reviews"."evidence_locator")) > 0)
);
--> statement-breakpoint
CREATE TABLE "style_baselines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"profile" jsonb NOT NULL,
	"version_node_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_baselines_source_type_check" CHECK ("style_baselines"."source_type" = 'golden_three')
);
--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ADD CONSTRAINT "golden_three_candidates_context_pack_version_id_context_pack_versions_id_fk" FOREIGN KEY ("context_pack_version_id") REFERENCES "public"."context_pack_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_candidate_id_golden_three_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."golden_three_candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_style_baseline_id_style_baselines_id_fk" FOREIGN KEY ("style_baseline_id") REFERENCES "public"."style_baselines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_locks" ADD CONSTRAINT "golden_three_locks_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_reviews" ADD CONSTRAINT "golden_three_reviews_candidate_id_golden_three_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."golden_three_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_reviews" ADD CONSTRAINT "golden_three_reviews_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_reviews" ADD CONSTRAINT "golden_three_reviews_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "golden_three_reviews" ADD CONSTRAINT "golden_three_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_baselines" ADD CONSTRAINT "style_baselines_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_baselines" ADD CONSTRAINT "style_baselines_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_baselines" ADD CONSTRAINT "style_baselines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_baselines" ADD CONSTRAINT "style_baselines_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_baselines" ADD CONSTRAINT "style_baselines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "golden_three_candidates_idempotency_strategy_unique" ON "golden_three_candidates" USING btree ("work_id","branch_id","idempotency_key","strategy");--> statement-breakpoint
CREATE UNIQUE INDEX "golden_three_candidates_batch_strategy_unique" ON "golden_three_candidates" USING btree ("batch_id","strategy");--> statement-breakpoint
CREATE INDEX "golden_three_candidates_user_work_idx" ON "golden_three_candidates" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "golden_three_candidates_branch_created_idx" ON "golden_three_candidates" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "golden_three_locks_branch_unique" ON "golden_three_locks" USING btree ("work_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "golden_three_locks_candidate_unique" ON "golden_three_locks" USING btree ("candidate_id");--> statement-breakpoint
CREATE INDEX "golden_three_locks_user_work_idx" ON "golden_three_locks" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "golden_three_reviews_candidate_dimension_unique" ON "golden_three_reviews" USING btree ("candidate_id","dimension");--> statement-breakpoint
CREATE INDEX "golden_three_reviews_user_work_idx" ON "golden_three_reviews" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "style_baselines_source_unique" ON "style_baselines" USING btree ("work_id","branch_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "style_baselines_user_work_idx" ON "style_baselines" USING btree ("user_id","work_id");
--> statement-breakpoint
ALTER TABLE "golden_three_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "golden_three_candidates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "golden_three_candidates_tenant_policy" ON "golden_three_candidates"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "golden_three_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "golden_three_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "golden_three_reviews_tenant_policy" ON "golden_three_reviews"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "style_baselines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "style_baselines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "style_baselines_tenant_policy" ON "style_baselines"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "golden_three_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "golden_three_locks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "golden_three_locks_tenant_policy" ON "golden_three_locks"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
