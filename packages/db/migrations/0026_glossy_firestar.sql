CREATE TABLE "quality_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"generation_request_id" uuid,
	"draft_id" uuid,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_generation_request_id_generation_requests_id_fk" FOREIGN KEY ("generation_request_id") REFERENCES "public"."generation_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "quality_reports_chapter_unique" ON "quality_reports" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "quality_reports_work_branch_updated_idx" ON "quality_reports" USING btree ("work_id","branch_id","updated_at");