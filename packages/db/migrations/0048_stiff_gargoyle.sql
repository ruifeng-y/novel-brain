ALTER TABLE "works" ADD COLUMN "archived_from_status" "work_status";--> statement-breakpoint
ALTER TABLE "works" ADD COLUMN "archived_at" timestamp with time zone;