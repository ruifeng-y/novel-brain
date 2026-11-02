CREATE TYPE "public"."batch_chapter_status" AS ENUM('pending', 'running', 'waiting_review', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."batch_review_status" AS ENUM('pending', 'approved', 'sent_to_desk', 'rejected', 'ignored');--> statement-breakpoint
CREATE TABLE "job_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"chapter_number" integer NOT NULL,
	"status" "batch_chapter_status" DEFAULT 'pending' NOT NULL,
	"review_status" "batch_review_status" DEFAULT 'pending' NOT NULL,
	"generation_job_id" uuid,
	"draft_id" uuid,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"error" jsonb,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_reports" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_chapters" ADD CONSTRAINT "job_chapters_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_chapters" ADD CONSTRAINT "job_chapters_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_chapters" ADD CONSTRAINT "job_chapters_branch_id_work_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."work_branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_chapters" ADD CONSTRAINT "job_chapters_generation_job_id_jobs_id_fk" FOREIGN KEY ("generation_job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_chapters" ADD CONSTRAINT "job_chapters_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_reports" ADD CONSTRAINT "job_reports_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_chapters_job_chapter_unique" ON "job_chapters" USING btree ("job_id","chapter_number");--> statement-breakpoint
CREATE INDEX "job_chapters_work_branch_status_idx" ON "job_chapters" USING btree ("work_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "job_chapters_job_position_idx" ON "job_chapters" USING btree ("job_id","chapter_number");--> statement-breakpoint
CREATE INDEX "job_reports_updated_idx" ON "job_reports" USING btree ("updated_at");