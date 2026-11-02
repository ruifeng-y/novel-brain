CREATE TYPE "public"."export_kind" AS ENUM('manuscript', 'outline', 'version');--> statement-breakpoint
ALTER TYPE "public"."export_format" ADD VALUE 'json';--> statement-breakpoint
ALTER TYPE "public"."export_format" ADD VALUE 'zip';--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "kind" "export_kind" DEFAULT 'manuscript' NOT NULL;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD COLUMN "version_commit_id" uuid;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_version_commit_id_branch_commits_id_fk" FOREIGN KEY ("version_commit_id") REFERENCES "public"."branch_commits"("id") ON DELETE cascade ON UPDATE no action;