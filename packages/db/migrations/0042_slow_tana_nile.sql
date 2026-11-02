ALTER TABLE "users" ADD COLUMN "last_export_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deletion_scheduled_for" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "users_deletion_scheduled_idx" ON "users" USING btree ("status","deletion_scheduled_for");