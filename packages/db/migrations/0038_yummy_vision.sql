CREATE TABLE "quality_findings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_version_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"quality_dimension" text NOT NULL,
	"severity" text NOT NULL,
	"structural" boolean DEFAULT false NOT NULL,
	"code" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_refs" jsonb NOT NULL,
	"affected_objects" jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"ignored_reason" text,
	"dismissed_by" uuid,
	"dismissed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_findings_dimension_check" CHECK ("quality_findings"."dimension" in ('continuity', 'style', 'reader_experience')),
	CONSTRAINT "quality_findings_quality_dimension_check" CHECK ("quality_findings"."quality_dimension" in ('hook', 'pacing', 'information_density', 'character_voice', 'prose', 'continuity')),
	CONSTRAINT "quality_findings_severity_check" CHECK ("quality_findings"."severity" in ('P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "quality_findings_status_check" CHECK ("quality_findings"."status" in ('open', 'dismissed', 'superseded')),
	CONSTRAINT "quality_findings_ignored_reason_check" CHECK (("quality_findings"."status" = 'dismissed' and "quality_findings"."ignored_reason" is not null and length(trim("quality_findings"."ignored_reason")) > 0) or ("quality_findings"."status" <> 'dismissed' and "quality_findings"."ignored_reason" is null and "quality_findings"."dismissed_by" is null and "quality_findings"."dismissed_at" is null)),
	CONSTRAINT "quality_findings_evidence_check" CHECK (jsonb_typeof("quality_findings"."evidence") = 'array' and jsonb_array_length("quality_findings"."evidence") > 0),
	CONSTRAINT "quality_findings_source_refs_check" CHECK (jsonb_typeof("quality_findings"."source_refs") = 'array' and jsonb_array_length("quality_findings"."source_refs") > 0),
	CONSTRAINT "quality_findings_affected_objects_check" CHECK (jsonb_typeof("quality_findings"."affected_objects") = 'array' and jsonb_array_length("quality_findings"."affected_objects") > 0)
);
--> statement-breakpoint
CREATE TABLE "quality_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"chapter_version_id" uuid NOT NULL,
	"rubric_version" text NOT NULL,
	"rule_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"dimensions" jsonb NOT NULL,
	"summary" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quality_reports_rubric_version_check" CHECK ("quality_reports"."rubric_version" = 'm1-quality-rubric-v1'),
	CONSTRAINT "quality_reports_rule_version_check" CHECK ("quality_reports"."rule_version" = 'm1-critic-rules-v1'),
	CONSTRAINT "quality_reports_source_hash_check" CHECK ("quality_reports"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "quality_reports_dimensions_check" CHECK (jsonb_typeof("quality_reports"."dimensions") = 'array' and jsonb_array_length("quality_reports"."dimensions") = 6)
);
--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_report_id_quality_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."quality_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_findings" ADD CONSTRAINT "quality_findings_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_chapter_version_id_chapter_versions_id_fk" FOREIGN KEY ("chapter_version_id") REFERENCES "public"."chapter_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_findings_report_dedupe_unique" ON "quality_findings" USING btree ("report_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "quality_findings_user_work_idx" ON "quality_findings" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "quality_findings_chapter_status_idx" ON "quality_findings" USING btree ("chapter_id","chapter_version_id","status");--> statement-breakpoint
CREATE INDEX "quality_reports_user_work_idx" ON "quality_reports" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "quality_reports_chapter_created_idx" ON "quality_reports" USING btree ("chapter_id","created_at");--> statement-breakpoint
CREATE INDEX "quality_reports_version_created_idx" ON "quality_reports" USING btree ("chapter_version_id","created_at");--> statement-breakpoint
ALTER TABLE "quality_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quality_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quality_reports_tenant_policy" ON "quality_reports"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "quality_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quality_findings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "quality_findings_tenant_policy" ON "quality_findings"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
