CREATE TABLE "volume_audit_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"volume_node_id" uuid NOT NULL,
	"chapter_from" integer NOT NULL,
	"chapter_to" integer NOT NULL,
	"rule_version" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" text NOT NULL,
	"findings" jsonb NOT NULL,
	"coverage" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"signoff_decision" text,
	"signoff_rationale" text,
	"signed_off_by" uuid,
	"signed_off_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "volume_audit_reports_range_check" CHECK ("volume_audit_reports"."chapter_to" >= "volume_audit_reports"."chapter_from"),
	CONSTRAINT "volume_audit_reports_rule_version_check" CHECK ("volume_audit_reports"."rule_version" = 'm1-volume-audit-v1'),
	CONSTRAINT "volume_audit_reports_source_hash_check" CHECK ("volume_audit_reports"."source_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "volume_audit_reports_status_check" CHECK ("volume_audit_reports"."status" in ('passed', 'warnings', 'blocked')),
	CONSTRAINT "volume_audit_reports_signoff_check" CHECK (("volume_audit_reports"."signoff_decision" is null and "volume_audit_reports"."signoff_rationale" is null and "volume_audit_reports"."signed_off_by" is null and "volume_audit_reports"."signed_off_at" is null) or ("volume_audit_reports"."signoff_decision" in ('accepted', 'changes_requested') and length(trim("volume_audit_reports"."signoff_rationale")) >= 10 and "volume_audit_reports"."signed_off_by" is not null and "volume_audit_reports"."signed_off_at" is not null)),
	CONSTRAINT "volume_audit_reports_version_check" CHECK ("volume_audit_reports"."version" > 0),
	CONSTRAINT "volume_audit_reports_findings_check" CHECK (jsonb_typeof("volume_audit_reports"."findings") = 'array'),
	CONSTRAINT "volume_audit_reports_coverage_check" CHECK (jsonb_typeof("volume_audit_reports"."coverage") = 'array')
);
--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ADD CONSTRAINT "volume_audit_reports_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ADD CONSTRAINT "volume_audit_reports_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ADD CONSTRAINT "volume_audit_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ADD CONSTRAINT "volume_audit_reports_volume_node_id_outline_nodes_id_fk" FOREIGN KEY ("volume_node_id") REFERENCES "public"."outline_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ADD CONSTRAINT "volume_audit_reports_signed_off_by_users_id_fk" FOREIGN KEY ("signed_off_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ADD CONSTRAINT "volume_audit_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "volume_audit_reports_user_work_idx" ON "volume_audit_reports" USING btree ("user_id","work_id");--> statement-breakpoint
CREATE INDEX "volume_audit_reports_volume_created_idx" ON "volume_audit_reports" USING btree ("volume_node_id","created_at");
--> statement-breakpoint
ALTER TABLE "volume_audit_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "volume_audit_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "volume_audit_reports_tenant_policy" ON "volume_audit_reports"
	USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid)
	WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::uuid);
