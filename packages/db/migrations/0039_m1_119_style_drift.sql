CREATE TABLE "style_drift_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"baseline_profile_id" uuid NOT NULL,
	"baseline_version" integer NOT NULL,
	"dimension" text NOT NULL,
	"classification" text NOT NULL,
	"severity" text NOT NULL,
	"code" text NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_version_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"locator" text NOT NULL,
	"explanation" text NOT NULL,
	"recommendation" text NOT NULL,
	"growth_evidence" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_drift_findings_dimension_check" CHECK ("style_drift_findings"."dimension" in ('character_voice', 'prose')),
	CONSTRAINT "style_drift_findings_classification_check" CHECK ("style_drift_findings"."classification" in ('drift', 'intentional_development')),
	CONSTRAINT "style_drift_findings_severity_check" CHECK ("style_drift_findings"."severity" in ('P1', 'P2', 'P3')),
	CONSTRAINT "style_drift_findings_code_check" CHECK ("style_drift_findings"."code" in ('CHARACTER_VOICE_DRIFT', 'WORK_STYLE_DRIFT', 'INTENTIONAL_CHARACTER_DEVELOPMENT')),
	CONSTRAINT "style_drift_findings_span_check" CHECK ("style_drift_findings"."start_offset" >= 0 and "style_drift_findings"."end_offset" > "style_drift_findings"."start_offset"),
	CONSTRAINT "style_drift_findings_growth_check" CHECK (("style_drift_findings"."classification" = 'intentional_development' and "style_drift_findings"."code" = 'INTENTIONAL_CHARACTER_DEVELOPMENT' and "style_drift_findings"."growth_evidence" is not null) or ("style_drift_findings"."classification" = 'drift' and "style_drift_findings"."code" <> 'INTENTIONAL_CHARACTER_DEVELOPMENT' and "style_drift_findings"."growth_evidence" is null))
);
--> statement-breakpoint
CREATE TABLE "style_drift_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"chapter_id" uuid,
	"chapter_version_id" uuid,
	"baseline_profile_id" uuid NOT NULL,
	"baseline_version" integer NOT NULL,
	"baseline_dimension" text NOT NULL,
	"baseline_source_type" text NOT NULL,
	"rule_version" text NOT NULL,
	"model_provider" text NOT NULL,
	"model" text NOT NULL,
	"model_parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prompt_key" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"profile_version" integer NOT NULL,
	"window_from_chapter" integer NOT NULL,
	"window_to_chapter" integer NOT NULL,
	"source_hash" text NOT NULL,
	"summary" text NOT NULL,
	"trend" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_drift_reports_scope_check" CHECK ("style_drift_reports"."scope" in ('chapter', 'volume', 'cross_volume')),
	CONSTRAINT "style_drift_reports_window_check" CHECK ("style_drift_reports"."window_to_chapter" >= "style_drift_reports"."window_from_chapter"),
	CONSTRAINT "style_drift_reports_scope_refs_check" CHECK (("style_drift_reports"."scope" = 'chapter' and "style_drift_reports"."chapter_id" is not null and "style_drift_reports"."chapter_version_id" is not null and "style_drift_reports"."window_from_chapter" = "style_drift_reports"."window_to_chapter") or ("style_drift_reports"."scope" <> 'chapter' and "style_drift_reports"."chapter_id" is null and "style_drift_reports"."chapter_version_id" is null)),
	CONSTRAINT "style_drift_reports_dimension_check" CHECK ("style_drift_reports"."baseline_dimension" in ('character_voice', 'prose')),
	CONSTRAINT "style_drift_reports_source_type_check" CHECK ("style_drift_reports"."baseline_source_type" in ('author_sample', 'approved_chapter_version', 'golden_three')),
	CONSTRAINT "style_drift_reports_rule_version_check" CHECK ("style_drift_reports"."rule_version" = 'm1-style-drift-v1'),
	CONSTRAINT "style_drift_reports_source_hash_check" CHECK ("style_drift_reports"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "style_drift_reports_trend_check" CHECK (jsonb_typeof("style_drift_reports"."trend") = 'array')
);
--> statement-breakpoint
CREATE TABLE "style_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"dimension" text NOT NULL,
	"name" text NOT NULL,
	"version" integer NOT NULL,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_version_id" uuid NOT NULL,
	"source_version_node_id" uuid,
	"source_label" text NOT NULL,
	"profile" jsonb NOT NULL,
	"approval_rationale" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"version_node_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "style_profiles_scope_check" CHECK ("style_profiles"."scope" in ('work', 'character')),
	CONSTRAINT "style_profiles_scope_id_check" CHECK (("style_profiles"."scope" = 'work' and "style_profiles"."scope_id" is null) or ("style_profiles"."scope" = 'character' and "style_profiles"."scope_id" is not null)),
	CONSTRAINT "style_profiles_dimension_check" CHECK ("style_profiles"."dimension" in ('character_voice', 'prose')),
	CONSTRAINT "style_profiles_version_check" CHECK ("style_profiles"."version" > 0),
	CONSTRAINT "style_profiles_approval_status_check" CHECK ("style_profiles"."approval_status" in ('pending', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "style_profiles_source_type_check" CHECK ("style_profiles"."source_type" in ('author_sample', 'approved_chapter_version', 'golden_three')),
	CONSTRAINT "style_profiles_approval_check" CHECK (("style_profiles"."approval_status" = 'approved' and "style_profiles"."approved_by" is not null and "style_profiles"."approved_at" is not null and "style_profiles"."approval_rationale" is not null and length(trim("style_profiles"."approval_rationale")) > 0) or ("style_profiles"."approval_status" <> 'approved' and "style_profiles"."approved_by" is null and "style_profiles"."approved_at" is null and "style_profiles"."approval_rationale" is null)),
	CONSTRAINT "style_profiles_body_check" CHECK (jsonb_typeof("style_profiles"."profile") = 'object' and jsonb_typeof("style_profiles"."profile"->'samples') = 'array' and jsonb_array_length("style_profiles"."profile"->'samples') > 0)
);
--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_report_id_style_drift_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."style_drift_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_baseline_profile_id_style_profiles_id_fk" FOREIGN KEY ("baseline_profile_id") REFERENCES "public"."style_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_findings" ADD CONSTRAINT "style_drift_findings_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_baseline_profile_id_style_profiles_id_fk" FOREIGN KEY ("baseline_profile_id") REFERENCES "public"."style_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_drift_reports" ADD CONSTRAINT "style_drift_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_scope_id_entities_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_source_version_node_id_version_nodes_id_fk" FOREIGN KEY ("source_version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_version_node_id_version_nodes_id_fk" FOREIGN KEY ("version_node_id") REFERENCES "public"."version_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "style_profiles" ADD CONSTRAINT "style_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "style_drift_findings_report_idx" ON "style_drift_findings" USING btree ("report_id","classification");--> statement-breakpoint
CREATE INDEX "style_drift_findings_user_work_idx" ON "style_drift_findings" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "style_drift_reports_user_work_idx" ON "style_drift_reports" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "style_drift_reports_branch_scope_created_idx" ON "style_drift_reports" USING btree ("branch_id","scope","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "style_profiles_character_version_unique" ON "style_profiles" USING btree ("work_id","branch_id","dimension","scope_id","version") WHERE "style_profiles"."scope" = 'character';--> statement-breakpoint
CREATE UNIQUE INDEX "style_profiles_work_version_unique" ON "style_profiles" USING btree ("work_id","branch_id","dimension","version") WHERE "style_profiles"."scope" = 'work';--> statement-breakpoint
CREATE INDEX "style_profiles_user_work_idx" ON "style_profiles" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "style_profiles_branch_status_idx" ON "style_profiles" USING btree ("branch_id","approval_status");--> statement-breakpoint
ALTER TABLE "style_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "style_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "style_profiles_tenant_policy" ON "style_profiles"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "style_drift_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "style_drift_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "style_drift_reports_tenant_policy" ON "style_drift_reports"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "style_drift_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "style_drift_findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "style_drift_findings_tenant_policy" ON "style_drift_findings"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
