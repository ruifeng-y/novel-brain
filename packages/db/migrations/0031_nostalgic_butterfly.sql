CREATE TYPE "public"."work_branch_fork_point_kind" AS ENUM('current', 'chapter_version');--> statement-breakpoint
CREATE TYPE "public"."work_branch_kind" AS ENUM('rewrite', 'what_if', 'alternate_ending', 'experiment');--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "kind" "work_branch_kind" DEFAULT 'experiment' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "fork_point_kind" "work_branch_fork_point_kind" DEFAULT 'current' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "fork_chapter_id" uuid;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "fork_chapter_version_id" uuid;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "fork_chapter_number" integer;--> statement-breakpoint
ALTER TABLE "work_branches" ADD COLUMN "fork_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL;