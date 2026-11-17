CREATE TABLE "moderation_appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"correction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "moderation_appeals_status_check" CHECK ("moderation_appeals"."status" in ('submitted', 'withdrawn')),
	CONSTRAINT "moderation_appeals_reason_check" CHECK (length("moderation_appeals"."reason") between 10 and 2000),
	CONSTRAINT "moderation_appeals_correction_check" CHECK ("moderation_appeals"."correction" is null or length("moderation_appeals"."correction") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "moderation_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"publish_preview_id" uuid NOT NULL,
	"export_id" uuid NOT NULL,
	"status" text NOT NULL,
	"rule_version" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_cases_status_check" CHECK ("moderation_cases"."status" in ('clear', 'needs_review', 'appeal_submitted')),
	CONSTRAINT "moderation_cases_rule_version_check" CHECK (length("moderation_cases"."rule_version") > 0),
	CONSTRAINT "moderation_cases_evidence_check" CHECK (jsonb_typeof("moderation_cases"."evidence") = 'array' and jsonb_array_length("moderation_cases"."evidence") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "moderation_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"type" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_events_type_check" CHECK ("moderation_events"."type" in ('case_created', 'appeal_submitted', 'appeal_withdrawn')),
	CONSTRAINT "moderation_events_status_check" CHECK ("moderation_events"."from_status" is null or "moderation_events"."from_status" in ('clear', 'needs_review', 'appeal_submitted')),
	CONSTRAINT "moderation_events_to_status_check" CHECK ("moderation_events"."to_status" in ('clear', 'needs_review', 'appeal_submitted')),
	CONSTRAINT "moderation_events_reason_check" CHECK ("moderation_events"."reason" is null or length("moderation_events"."reason") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "ai_disclosure_required" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_publish_preview_id_publish_previews_id_fk" FOREIGN KEY ("publish_preview_id") REFERENCES "public"."publish_previews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_export_id_work_export_receipts_id_fk" FOREIGN KEY ("export_id") REFERENCES "public"."work_export_receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_case_id_moderation_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."moderation_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "moderation_appeals_case_created_idx" ON "moderation_appeals" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_appeals_user_created_idx" ON "moderation_appeals" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_cases_preview_unique" ON "moderation_cases" USING btree ("publish_preview_id");--> statement-breakpoint
CREATE INDEX "moderation_cases_user_created_idx" ON "moderation_cases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_cases_work_branch_created_idx" ON "moderation_cases" USING btree ("work_id","branch_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_events_case_created_idx" ON "moderation_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_events_user_created_idx" ON "moderation_events" USING btree ("user_id","created_at");
--> statement-breakpoint
ALTER TABLE "moderation_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "moderation_cases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "moderation_cases_tenant_policy" ON "moderation_cases"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "moderation_appeals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "moderation_appeals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "moderation_appeals_tenant_policy" ON "moderation_appeals"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "moderation_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "moderation_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "moderation_events_tenant_policy" ON "moderation_events"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
